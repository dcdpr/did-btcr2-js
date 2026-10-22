import { canonicalHashBytes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';

import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_READY,
  HTTP_ENVELOPE_VERSION,
  HTTP_ROUTE,
  HttpClientTransport,
  HttpServerTransport,
  type HttpRequestLike,
  type HttpServerTransportConfig,
  type Logger,
  SILENT_LOGGER,
  SSE_EVENT,
  type SignedEnvelope,
  type SseStream,
  buildRequestAuth,
  signEnvelope,
  verifyEnvelope,
} from '../src/index.js';

/**
 * Malformed-input suite of the transports.
 * - Server part: a malformed request must get a defined answer (a 4xx or 5xx status,
 *   or a closed stream), and never a rejection or a throw.
 * - Client part: the client must drop a malformed SSE event and keep the stream open.
 */

interface SseMock {
  stream:   SseStream;
  isClosed: () => boolean;
}

function makeSseMock(): SseMock {
  let closed = false;
  const closeHandlers: Array<() => void> = [];
  const stream: SseStream = {
    writeEvent() { if(closed) throw new Error('stream closed'); },
    writeComment() { /* no-op */ },
    close() {
      if(closed) return;
      closed = true;
      for(const cb of closeHandlers) cb();
    },
    onClose(cb) {
      if(closed) cb();
      else closeHandlers.push(cb);
    },
  };
  return { stream, isClosed: () => closed };
}

function makeRecordingLogger(): { logger: Logger; errors: unknown[][]; warns: unknown[][] } {
  const errors: unknown[][] = [];
  const warns: unknown[][] = [];
  const logger: Logger = {
    debug : () => {},
    info  : () => {},
    warn  : (...args) => { warns.push(args); },
    error : (...args) => { errors.push(args); },
  };
  return { logger, errors, warns };
}

interface ClientSse {
  fetch: typeof fetch;
  /** The count of requests to `pathname`. */
  gets(pathname: string): number;
  push(pathname: string, event: string, data: string): void;
}

/** A fetch stub for the client: each GET opens an SSE stream that the test writes to. */
function makeClientSse(): ClientSse {
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const counts  = new Map<string, number>();
  const encoder = new TextEncoder();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);
    if((init?.method ?? 'GET').toUpperCase() === 'POST') return new Response('', { status: 202 });
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    streams.set(url.pathname, ctrl);
    init?.signal?.addEventListener('abort', () => {
      try { ctrl.close(); } catch { /* already closed */ }
    }, { once: true });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return {
    fetch : fetchImpl,
    gets  : (pathname) => counts.get(pathname) ?? 0,
    push(pathname, event, data) {
      const ctrl = streams.get(pathname);
      if(!ctrl) throw new Error(`No SSE stream open at ${pathname}`);
      ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
    },
  };
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `condition` every 5 ms. Reject after `timeoutMs`. */
async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while(!condition()) {
    if(Date.now() - start > timeoutMs) throw new Error('Timeout: the condition did not become true');
    await settle(5);
  }
}

function req(method: string, url: string, headers: Record<string, string> = {}, body?: string): HttpRequestLike {
  return { method, url, headers, body };
}

/** Injected clock of the server (unix milliseconds, a whole second). */
const T0_MS  = 1_700_000_000_000;
const T0_SEC = T0_MS / 1000;

function makeKDid(): { keys: SchnorrKeyPair; did: string } {
  const keys = SchnorrKeyPair.generate();
  return { keys, did: DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' }) };
}

/** A message body of about `chars` characters: `{"a":[[[...]]]}` with deep nesting. */
function deepArrayMessage(chars: number): string {
  const depth = Math.floor(chars / 2);
  return `{"type":"${COHORT_OPT_IN}","a":${'['.repeat(depth)}${']'.repeat(depth)}}`;
}

/** A message body of about `chars` characters: `{"a":{"a":...}}` with deep nesting. */
function deepObjectMessage(chars: number): string {
  const depth = Math.floor(chars / 6);
  return `{"type":"${COHORT_OPT_IN}",${'"a":{'.repeat(depth)}${'}'.repeat(depth)}}`;
}

/** The JSON of an envelope with a raw message and a signature that does not verify. */
function rawEnvelope(from: string, messageJson: string, to?: string): string {
  const head = `{"v":${HTTP_ENVELOPE_VERSION},"from":${JSON.stringify(from)},`
    + (to !== undefined ? `"to":${JSON.stringify(to)},` : '')
    + `"timestamp":${T0_SEC},"nonce":"${bytesToHex(randomBytes(16))}",`;
  return `${head}"message":${messageJson},"sig":"${'ab'.repeat(64)}"}`;
}

describe('Transport hardening: malformed input', () => {
  describe('HttpServerTransport', () => {
    let server: HttpServerTransport;
    let service: { keys: SchnorrKeyPair; did: string };
    let peer: { keys: SchnorrKeyPair; did: string };

    beforeEach(() => {
      service = makeKDid();
      peer    = makeKDid();
    });

    afterEach(() => {
      server?.stop();
    });

    const makeServer = (overrides: Partial<HttpServerTransportConfig> = {}): HttpServerTransport =>
      new HttpServerTransport({
        logger              : SILENT_LOGGER,
        heartbeatIntervalMs : 0,
        resolveSenderPk     : resolveBtcr2SenderPk,
        now                 : () => T0_MS,
        ...overrides,
      });

    const answer = async (route: string, body: string): Promise<{ status: number; error?: string }> => {
      const res = await server.handleRequest(req('POST', route, { 'content-type': 'application/json' }, body));
      return { status: res.status, error: (JSON.parse(res.body) as { error?: string }).error };
    };

    const malformedBodies = [
      '{"from":"x","message":null}',
      '{"from":"x"}',
      '{"from":"x","message":[]}',
      '{"from":"x","message":"s"}',
      '{"from":5,"message":{}}',
      '{"from":"","message":{}}',
      '{}',
      '5',
      '0',
      'true',
      'false',
      '""',
      '[]',
      '"s"',
    ];

    for(const route of [HTTP_ROUTE.MESSAGES, HTTP_ROUTE.ADVERTS]) {
      for(const withResolver of [true, false]) {
        const label = withResolver ? 'with resolveSenderPk' : 'without resolveSenderPk';
        for(const body of malformedBodies) {
          it(`POST ${route} ${label}: ${body} = 400 malformed_envelope`, async () => {
            server = makeServer(withResolver ? {} : { resolveSenderPk: undefined });
            server.registerActor(service.did, service.keys);
            expect(await answer(route, body)).to.deep.equal({ status: 400, error: 'malformed_envelope' });
          });
        }
      }

      it(`POST ${route}: a body of null stays 400 invalid_json`, async () => {
        server = makeServer();
        expect(await answer(route, 'null')).to.deep.equal({ status: 400, error: 'invalid_json' });
      });
    }

    it('POST /v1/messages: a bootstrap opt-in with a malformed __bytes sentinel = 401 unknown_sender', async () => {
      server = makeServer();
      server.registerActor(service.did, service.keys);

      // A sender that resolves to no key goes to the bootstrap path, which revives the message.
      const signer = SchnorrKeyPair.generate();
      const from = 'did:btcr2:x1unresolvable';
      const message = {
        type : COHORT_OPT_IN,
        from,
        to   : service.did,
        body : { cohortId: 'c1', communicationPk: { __bytes: 'zz' }, genesisDocument: { id: 'x' } },
      };
      const body = JSON.stringify(signEnvelope(message, { did: from, keys: signer }, { to: service.did, timestamp: T0_SEC }));
      expect(await answer(HTTP_ROUTE.MESSAGES, body)).to.deep.equal({ status: 401, error: 'unknown_sender' });
    });

    it('POST /v1/messages: an authenticated k1 envelope with a malformed __bytes sentinel = 400 malformed_message', async () => {
      server = makeServer();
      server.registerActor(service.did, service.keys);

      const message = {
        type : COHORT_OPT_IN,
        from : peer.did,
        to   : service.did,
        body : { cohortId: 'c1', participantPk: { __bytes: 'zz' } },
      };
      const body = JSON.stringify(signEnvelope(message, { did: peer.did, keys: peer.keys }, { to: service.did, timestamp: T0_SEC }));
      expect(await answer(HTTP_ROUTE.MESSAGES, body)).to.deep.equal({ status: 400, error: 'malformed_message' });
    });

    it('POST /v1/adverts: an authenticated k1 envelope with a malformed __bytes sentinel = 400 malformed_message', async () => {
      server = makeServer();
      server.registerActor(service.did, service.keys);

      const message = {
        type : COHORT_ADVERT,
        from : service.did,
        body : { cohortId: 'c1', serviceCommunicationPk: { __bytes: 'zz' } },
      };
      const body = JSON.stringify(signEnvelope(message, { did: service.did, keys: service.keys }, { timestamp: T0_SEC }));
      expect(await answer(HTTP_ROUTE.ADVERTS, body)).to.deep.equal({ status: 400, error: 'malformed_message' });
    });

    for(const [shape, build] of [['arrays', deepArrayMessage], ['objects', deepObjectMessage]] as const) {
      it(`a deeply nested message of ${shape} under the body cap gets a 4xx answer, not a rejection`, async () => {
        server = makeServer();
        server.registerActor(service.did, service.keys);
        const message = build(60_000);

        const bodies = [
          // An unresolvable sender: the bootstrap path revives the message.
          { route: HTTP_ROUTE.MESSAGES, body: rawEnvelope('did:btcr2:x1unresolvable', message, service.did) },
          // A k1 sender: the signature check canonicalizes the message.
          { route: HTTP_ROUTE.MESSAGES, body: rawEnvelope(peer.did, message, service.did) },
          { route: HTTP_ROUTE.ADVERTS, body: rawEnvelope(service.did, message) },
        ];
        for(const { route, body } of bodies) {
          expect(body.length).to.be.below(64 * 1024);
          const res = await answer(route, body);
          expect(res.status).to.be.oneOf([400, 401]);
        }
      });
    }

    it('a request target that is not a valid URL = 404 from handleRequest and a closed stream from handleSse', async () => {
      const recording = makeRecordingLogger();
      server = makeServer({ logger: recording.logger });
      const res = await server.handleRequest(req('POST', 'http://['));
      expect(res.status).to.equal(404);
      expect(JSON.parse(res.body)).to.deep.equal({ error: 'not_found' });

      const sse = makeSseMock();
      expect(() => server.handleSse(req('GET', 'http://['), sse.stream)).to.not.throw();
      expect(sse.isClosed()).to.be.true;

      // A bad request target is a defined answer, not an unexpected error.
      expect(recording.errors).to.have.lengthOf(0);
    });

    it('a resolveSenderPk that throws = 500 internal_error from handleRequest, with logger.error', async () => {
      const recording = makeRecordingLogger();
      server = makeServer({
        logger          : recording.logger,
        resolveSenderPk : () => { throw new Error('resolver down'); },
      });
      server.registerActor(service.did, service.keys);

      const message = { type: COHORT_OPT_IN, from: peer.did, to: service.did, body: { cohortId: 'c1' } };
      const body = JSON.stringify(signEnvelope(message, { did: peer.did, keys: peer.keys }, { to: service.did, timestamp: T0_SEC }));
      expect(await answer(HTTP_ROUTE.MESSAGES, body)).to.deep.equal({ status: 500, error: 'internal_error' });
      expect(recording.errors).to.have.lengthOf(1);
    });

    it('a request with no headers object = 500 internal_error from handleRequest, not a rejection', async () => {
      const recording = makeRecordingLogger();
      server = makeServer({ logger: recording.logger });

      // An adapter fault: the CORS step of the 400 answer and of the 500 answer both throw.
      const bad = { method: 'POST', url: HTTP_ROUTE.MESSAGES, headers: undefined } as unknown as HttpRequestLike;
      const res = await server.handleRequest(bad);
      expect(res.status).to.equal(500);
      expect(JSON.parse(res.body)).to.deep.equal({ error: 'internal_error' });
      expect(recording.errors).to.have.lengthOf(1);
    });

    it('a logger.error that throws does not make handleRequest reject or handleSse throw', async () => {
      const logger: Logger = {
        ...SILENT_LOGGER,
        error : () => { throw new Error('logger down'); },
      };
      server = makeServer({
        logger,
        resolveSenderPk : () => { throw new Error('resolver down'); },
      });
      server.registerActor(service.did, service.keys);

      const message = { type: COHORT_OPT_IN, from: peer.did, to: service.did, body: { cohortId: 'c1' } };
      const body = JSON.stringify(signEnvelope(message, { did: peer.did, keys: peer.keys }, { to: service.did, timestamp: T0_SEC }));
      expect(await answer(HTTP_ROUTE.MESSAGES, body)).to.deep.equal({ status: 500, error: 'internal_error' });

      const path = `/v1/actors/${encodeURIComponent(peer.did)}/inbox`;
      const sse = makeSseMock();
      const auth = buildRequestAuth(peer.did, peer.keys, path, { timestamp: T0_SEC });
      expect(() => server.handleSse(req('GET', path, { authorization: auth }), sse.stream)).to.not.throw();
      expect(sse.isClosed()).to.be.true;
    });

    it('a resolveSenderPk that throws = a closed stream from handleSse, with logger.error', () => {
      const recording = makeRecordingLogger();
      server = makeServer({
        logger          : recording.logger,
        resolveSenderPk : () => { throw new Error('resolver down'); },
      });

      const path = `/v1/actors/${encodeURIComponent(peer.did)}/inbox`;
      const sse = makeSseMock();
      const auth = buildRequestAuth(peer.did, peer.keys, path, { timestamp: T0_SEC });
      expect(() => server.handleSse(req('GET', path, { authorization: auth }), sse.stream)).to.not.throw();
      expect(sse.isClosed()).to.be.true;
      expect(recording.errors).to.have.lengthOf(1);
    });
  });

  describe('HttpClientTransport', () => {
    let client: HttpClientTransport;
    let actor: { keys: SchnorrKeyPair; did: string };
    let peer: { keys: SchnorrKeyPair; did: string };
    let sse: ClientSse;
    /** The DIDs that the client gives to resolveSenderPk. */
    let resolverCalls: unknown[];

    beforeEach(() => {
      actor = makeKDid();
      peer  = makeKDid();
      sse   = makeClientSse();
      resolverCalls = [];
    });

    afterEach(() => {
      client?.stop();
    });

    const inboxPath = (): string => HTTP_ROUTE.ACTOR_INBOX.replace('{did}', encodeURIComponent(actor.did));

    const startClient = async (logger: Logger): Promise<void> => {
      client = new HttpClientTransport({
        baseUrl          : 'https://svc.example/',
        fetchImpl        : sse.fetch,
        logger,
        reconnectBackoff : () => 0,
        resolveSenderPk  : (did, opts) => {
          resolverCalls.push(did);
          return resolveBtcr2SenderPk(did, opts);
        },
      });
      client.registerActor(actor.did, actor.keys);
      client.start();
      await waitFor(() => sse.gets(HTTP_ROUTE.ADVERTS) === 1 && sse.gets(inboxPath()) === 1);
    };

    type Kind = 'inbox' | 'broadcast';
    const typeOf  = (kind: Kind): string => (kind === 'inbox' ? COHORT_READY : COHORT_ADVERT);
    const eventOf = (kind: Kind): string => (kind === 'inbox' ? SSE_EVENT.MESSAGE : SSE_EVENT.ADVERT);
    const pathOf  = (kind: Kind): string => (kind === 'inbox' ? inboxPath() : HTTP_ROUTE.ADVERTS);
    const toOf    = (kind: Kind): string | undefined => (kind === 'inbox' ? actor.did : undefined);

    /** A valid envelope from the peer, for the stream of `kind`. */
    const validEvent = (kind: Kind, cohortId: string): string => {
      const to = toOf(kind);
      const msg = new BaseMessage({ type: typeOf(kind), from: peer.did, ...(to ? { to } : {}), body: { cohortId } });
      return JSON.stringify(signEnvelope(msg, { did: peer.did, keys: peer.keys }, to ? { to } : {}));
    };

    /** An envelope from the peer with a message of `null`, signed over its canonical unsigned form. */
    const signedNullMessage = (kind: Kind): string => {
      const to = toOf(kind);
      const unsigned = {
        v         : HTTP_ENVELOPE_VERSION,
        from      : peer.did,
        ...(to ? { to } : {}),
        timestamp : Math.floor(Date.now() / 1000),
        nonce     : bytesToHex(randomBytes(16)),
        message   : null,
      };
      const sig = peer.keys.secretKey.sign(canonicalHashBytes(unsigned), { scheme: 'schnorr' });
      return JSON.stringify({ ...unsigned, sig: bytesToHex(sig) });
    };

    /** A signed envelope from the peer whose message holds a malformed `__bytes` sentinel. */
    const signedBadBytes = (kind: Kind): string => {
      const to = toOf(kind);
      const message = {
        type : typeOf(kind),
        from : peer.did,
        ...(to ? { to } : {}),
        body : { cohortId: 'c1', x: { __bytes: 'zz' } },
      };
      return JSON.stringify(signEnvelope(message, { did: peer.did, keys: peer.keys }, to ? { to } : {}));
    };

    /** A signed envelope from the peer whose inner `from` is an object that `String()` cannot convert. */
    const signedObjectFrom = (kind: Kind): string => {
      const to = toOf(kind);
      const message = {
        type : typeOf(kind),
        from : { toString: 1 },
        ...(to ? { to } : {}),
        body : { cohortId: 'c1' },
      };
      return JSON.stringify(signEnvelope(message, { did: peer.did, keys: peer.keys }, to ? { to } : {}));
    };

    const malformedEvents: Array<[string, (kind: Kind) => string]> = [
      ['null', () => 'null'],
      ['5', () => '5'],
      ['[]', () => '[]'],
      ['"s"', () => '"s"'],
      ['{}', () => '{}'],
      ['{"from":1}', () => '{"from":1}'],
      ['{"from":"x","message":null}', () => '{"from":"x","message":null}'],
      ['invalid JSON', () => 'not json{'],
      ['a signed envelope with a message of null', signedNullMessage],
      ['a signed envelope with a malformed __bytes sentinel', signedBadBytes],
      ['a signed envelope whose inner from is an object with a toString of 1', signedObjectFrom],
    ];

    it('the hand-built signed envelopes pass verifyEnvelope', () => {
      const senderPk = resolveBtcr2SenderPk(peer.did)!;
      for(const kind of ['inbox', 'broadcast'] as const) {
        for(const build of [signedNullMessage, signedBadBytes]) {
          const envelope = JSON.parse(build(kind)) as SignedEnvelope;
          expect(() => verifyEnvelope(envelope, senderPk, { expectedTo: toOf(kind) })).to.not.throw();
        }
      }
    });

    for(const kind of ['inbox', 'broadcast'] as const) {
      for(const [label, build] of malformedEvents) {
        it(`${kind} event ${label}: dropped, one GET, the next event is dispatched`, async () => {
          const recording = makeRecordingLogger();
          await startClient(recording.logger);
          const received: unknown[] = [];
          client.registerMessageHandler(actor.did, typeOf(kind), (msg: Record<string, unknown>) => { received.push(msg.cohortId); });

          sse.push(pathOf(kind), eventOf(kind), build(kind));
          sse.push(pathOf(kind), eventOf(kind), validEvent(kind, 'ok'));
          await waitFor(() => received.length === 1);
          await settle(10);

          expect(received).to.deep.equal(['ok']);
          expect(sse.gets(pathOf(kind))).to.equal(1);
          expect(recording.warns).to.have.lengthOf(0);
          expect(recording.errors).to.have.lengthOf(0);
          // A malformed event never reaches the sender resolution.
          expect(resolverCalls.every((did) => did === peer.did)).to.equal(true, `resolver calls: ${JSON.stringify(resolverCalls)}`);
        });
      }

      it(`${kind}: a logger whose debug and error throw: the next event is dispatched, one GET`, async () => {
        const throwing = (): never => { throw new Error('logger down'); };
        await startClient({ ...SILENT_LOGGER, debug: throwing, error: throwing });
        const received: unknown[] = [];
        client.registerMessageHandler(actor.did, typeOf(kind), (msg: Record<string, unknown>) => { received.push(msg.cohortId); });

        sse.push(pathOf(kind), eventOf(kind), 'null');
        sse.push(pathOf(kind), eventOf(kind), validEvent(kind, 'ok'));
        await waitFor(() => received.length === 1);
        await settle(10);

        expect(received).to.deep.equal(['ok']);
        expect(sse.gets(pathOf(kind))).to.equal(1);
      });

      it(`${kind}: a __proto__ member in a signed message body stays an own member and sets no prototype`, async () => {
        const recording = makeRecordingLogger();
        await startClient(recording.logger);
        const received: Array<Record<string, unknown>> = [];
        client.registerMessageHandler(actor.did, typeOf(kind), (msg: Record<string, unknown>) => { received.push(msg); });

        // JSON.parse keeps "__proto__" as an own member. Sign the canonical unsigned form.
        const otherPk = bytesToHex(SchnorrKeyPair.generate().publicKey.compressed);
        const to = toOf(kind);
        const message = JSON.parse(JSON.stringify({ type: typeOf(kind), from: peer.did, ...(to ? { to } : {}) })
          .replace(/}$/, `,"body":{"cohortId":"p1","__proto__":{"communicationPk":{"__bytes":"${otherPk}"}}}}`)) as Record<string, unknown>;
        const unsigned = {
          v         : HTTP_ENVELOPE_VERSION,
          from      : peer.did,
          ...(to ? { to } : {}),
          timestamp : Math.floor(Date.now() / 1000),
          nonce     : bytesToHex(randomBytes(16)),
          message,
        };
        const sig = peer.keys.secretKey.sign(canonicalHashBytes(unsigned), { scheme: 'schnorr' });
        const wire = JSON.stringify({ ...unsigned, sig: bytesToHex(sig) });
        expect(wire).to.include('"__proto__"');

        sse.push(pathOf(kind), eventOf(kind), wire);
        await waitFor(() => received.length === 1);

        const body = received[0].body as Record<string, unknown>;
        expect(received[0].cohortId).to.equal('p1');
        expect(Object.getPrototypeOf(body)).to.equal(Object.prototype);
        expect(body.communicationPk).to.equal(undefined);
        expect(received[0].communicationPk).to.equal(undefined);
        expect(recording.errors).to.have.lengthOf(0);
      });

      it(`${kind}: an unexpected throw in the dispatch of one event = logger.error, one GET, the next event is dispatched`, async () => {
        // A logger.debug that throws makes the drop of a malformed event throw.
        const recording = makeRecordingLogger();
        await startClient({ ...recording.logger, debug: () => { throw new Error('logger down'); } });
        const received: unknown[] = [];
        client.registerMessageHandler(actor.did, typeOf(kind), (msg: Record<string, unknown>) => { received.push(msg.cohortId); });

        sse.push(pathOf(kind), eventOf(kind), 'null');
        sse.push(pathOf(kind), eventOf(kind), validEvent(kind, 'ok'));
        await waitFor(() => received.length === 1);
        await settle(10);

        expect(received).to.deep.equal(['ok']);
        expect(sse.gets(pathOf(kind))).to.equal(1);
        expect(recording.errors).to.have.lengthOf(1);
      });
    }

    describe('subscription loop failures', () => {
      let unhandled: unknown[];
      const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

      beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
      });

      afterEach(() => {
        client?.stop();
        client?.unregisterActor(actor.did);
        process.removeListener('unhandledRejection', onUnhandled);
      });

      /**
       * A fetch stub. Each request to `path` gets the result of `answer`. Each other request
       * gets an SSE stream that stays open until the request aborts.
       */
      const makeLoopFetch = (path: string, answer: (n: number) => Promise<Response>): { fetch: typeof fetch; gets: () => number } => {
        let count = 0;
        const fetchImpl: typeof fetch = async (input, init) => {
          const url = input instanceof URL ? input : new URL(String(input));
          if(url.pathname === path) return answer(count++);
          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              init?.signal?.addEventListener('abort', () => {
                try { c.close(); } catch { /* already closed */ }
              }, { once: true });
            },
          });
          return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        };
        return { fetch: fetchImpl, gets: () => count };
      };

      for(const kind of ['inbox', 'broadcast'] as const) {
        it(`${kind}: a logger whose debug and warn throw, and failed requests: no unhandled rejection, the loop goes on`, async () => {
          const recording = makeRecordingLogger();
          const throwing = (): never => { throw new Error('logger down'); };
          // Even requests reject (the debug line), odd requests get 503 (the warn line).
          // The client cancels the body of each 503 answer after the warn line.
          let bodyCancels = 0;
          const loop = makeLoopFetch(pathOf(kind), async (n) => {
            if(n % 2 === 0) throw new TypeError('network down');
            const body = new ReadableStream<Uint8Array>({
              start(c) { c.enqueue(new TextEncoder().encode('busy')); },
              cancel() { bodyCancels++; },
            });
            return new Response(body, { status: 503 });
          });
          const attempts: number[] = [];
          client = new HttpClientTransport({
            baseUrl          : 'https://svc.example/',
            fetchImpl        : loop.fetch,
            logger           : { ...recording.logger, debug: throwing, warn: throwing },
            reconnectBackoff : (attempt) => {
              attempts.push(attempt);
              if(attempts.length === 6) client.stop();
              return 1;
            },
          });
          client.registerActor(actor.did, actor.keys);
          client.start();

          await waitFor(() => attempts.length === 6);
          await settle(20);
          expect(attempts).to.deep.equal([0, 1, 2, 3, 4, 5]);
          expect(loop.gets()).to.equal(6);
          expect(bodyCancels).to.equal(3);
          expect(recording.errors).to.have.lengthOf(0);
          expect(unhandled).to.be.empty;
        });

        it(`${kind}: events above maxSseEventBytes and a logger whose warn throws: no unhandled rejection, the loop goes on`, async () => {
          const recording = makeRecordingLogger();
          const frame = `event: ${eventOf(kind)}\ndata: ${'x'.repeat(2048)}\n\n`;
          const loop = makeLoopFetch(pathOf(kind), async () => new Response(frame, { status: 200 }));
          const attempts: number[] = [];
          client = new HttpClientTransport({
            baseUrl          : 'https://svc.example/',
            fetchImpl        : loop.fetch,
            logger           : { ...recording.logger, warn: () => { throw new Error('logger down'); } },
            maxSseEventBytes : 1024,
            reconnectBackoff : (attempt) => {
              attempts.push(attempt);
              if(attempts.length === 3) client.stop();
              return 1;
            },
          });
          client.registerActor(actor.did, actor.keys);
          client.start();

          await waitFor(() => attempts.length === 3);
          await settle(20);
          // Each attempt fails at the size limit, so the attempt count goes up.
          expect(attempts).to.deep.equal([0, 1, 2]);
          expect(loop.gets()).to.equal(3);
          expect(recording.errors).to.have.lengthOf(0);
          expect(unhandled).to.be.empty;
        });

        it(`${kind}: a reconnectBackoff that throws: logger.error once, the loop ends, no unhandled rejection`, async () => {
          const recording = makeRecordingLogger();
          // An empty stream that ends at once: the loop then calls reconnectBackoff.
          const loop = makeLoopFetch(pathOf(kind), async () => new Response('', { status: 200 }));
          let backoffCalls = 0;
          client = new HttpClientTransport({
            baseUrl          : 'https://svc.example/',
            fetchImpl        : loop.fetch,
            logger           : recording.logger,
            reconnectBackoff : () => {
              backoffCalls++;
              throw new Error('backoff down');
            },
          });
          client.registerActor(actor.did, actor.keys);
          client.start();

          await waitFor(() => recording.errors.length === 1);
          await settle(30);
          expect(backoffCalls).to.equal(1);
          expect(loop.gets()).to.equal(1);
          expect(recording.errors).to.have.lengthOf(1);
          expect(recording.errors[0][1]).to.be.instanceOf(Error).with.property('message', 'backoff down');
          expect(unhandled).to.be.empty;
        });

        it(`${kind}: a reconnectBackoff that throws and a logger whose error throws: no unhandled rejection, the loop ends`, async () => {
          const loop = makeLoopFetch(pathOf(kind), async () => new Response('', { status: 200 }));
          let backoffCalls = 0;
          let errorCalls = 0;
          client = new HttpClientTransport({
            baseUrl          : 'https://svc.example/',
            fetchImpl        : loop.fetch,
            logger           : {
              ...SILENT_LOGGER,
              error : () => {
                errorCalls++;
                throw new Error('logger down');
              },
            },
            reconnectBackoff : () => {
              backoffCalls++;
              throw new Error('backoff down');
            },
          });
          client.registerActor(actor.did, actor.keys);
          client.start();

          await waitFor(() => errorCalls === 1);
          await settle(30);
          expect(backoffCalls).to.equal(1);
          expect(loop.gets()).to.equal(1);
          expect(errorCalls).to.equal(1);
          expect(unhandled).to.be.empty;
        });
      }
    });

    describe('publishRepeating failures', () => {
      let unhandled: unknown[];
      const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

      beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
      });

      afterEach(() => {
        client?.stop();
        client?.unregisterActor(actor.did);
        process.removeListener('unhandledRejection', onUnhandled);
      });

      it('a fetch that rejects and a logger whose debug throws: no unhandled rejection', async () => {
        let posts = 0;
        client = new HttpClientTransport({
          baseUrl   : 'https://svc.example/',
          fetchImpl : async () => {
            posts++;
            throw new TypeError('network down');
          },
          logger : { ...SILENT_LOGGER, debug: () => { throw new Error('logger down'); } },
        });
        client.registerActor(actor.did, actor.keys);
        const advert = new BaseMessage({ type: COHORT_ADVERT, from: actor.did, body: { cohortId: 'c1' } });
        // An interval of 5 ms: the first send and the sends of the timer fail.
        const stop = client.publishRepeating(advert, actor.did, 5);
        await settle(25);
        stop();
        await settle(10);
        expect(posts).to.be.at.least(2);
        expect(unhandled).to.be.empty;
      });
    });
  });
});
