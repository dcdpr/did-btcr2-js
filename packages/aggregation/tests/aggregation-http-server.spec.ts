import { SchnorrKeyPair } from '@did-btcr2/keys';
import { expect } from 'chai';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_READY,
  HTTP_ENVELOPE_VERSION,
  HTTP_ROUTE,
  HttpServerTransport,
  HttpTransportError,
  type HttpRequestLike,
  type Logger,
  NonceCache,
  RateLimiter,
  SILENT_LOGGER,
  SSE_EVENT,
  type SignedEnvelope,
  type SseStream,
  buildRequestAuth,
  signEnvelope,
  verifyEnvelope,
} from '../src/index.js';
import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';

interface SseMock {
  stream:       SseStream;
  events:       Array<{ event: string; data: string; id?: string }>;
  comments:     string[];
  isClosed:     () => boolean;
  triggerClose: () => void;
}

function makeSseMock(): SseMock {
  const events:    Array<{ event: string; data: string; id?: string }> = [];
  const comments:  string[] = [];
  let   closed    = false;
  const closeHandlers: Array<() => void> = [];

  const stream: SseStream = {
    writeEvent(event, data, id) {
      if(closed) throw new Error('stream closed');
      events.push({ event, data, id });
    },
    writeComment(comment) {
      if(closed) return;
      comments.push(comment);
    },
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

  return {
    stream,
    events,
    comments,
    isClosed     : () => closed,
    triggerClose : () => {
      if(closed) return;
      closed = true;
      for(const cb of closeHandlers) cb();
    },
  };
}

function req(
  method:  string,
  url:     string,
  headers: Record<string, string> = {},
  body?:   string,
): HttpRequestLike {
  return { method, url, headers, body };
}

interface RecordingLogger {
  logger: Logger;
  calls:  Record<keyof Logger, unknown[][]>;
}

function makeRecordingLogger(): RecordingLogger {
  const calls: Record<keyof Logger, unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  const logger: Logger = {
    debug : (...args) => { calls.debug.push(args); },
    info  : (...args) => { calls.info.push(args); },
    warn  : (...args) => { calls.warn.push(args); },
    error : (...args) => { calls.error.push(args); },
  };
  return { logger, calls };
}

/** A key pair whose public key is real and whose sign always throws `error`. */
function throwingKeys(keys: SchnorrKeyPair, error: Error = new Error('signer offline')): SchnorrKeyPair {
  return {
    publicKey : keys.publicKey,
    secretKey : { sign: (): never => { throw error; } },
  } as unknown as SchnorrKeyPair;
}

function makeKDid(): { keys: SchnorrKeyPair; did: string } {
  const keys = SchnorrKeyPair.generate();
  return { keys, did: DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' }) };
}

/** Injected clock start (unix milliseconds, a whole second). */
const T0_MS  = 1_700_000_000_000;
const T0_SEC = T0_MS / 1000;

describe('HttpServerTransport', () => {
  let serverKeys: SchnorrKeyPair;
  let serverDid:  string;
  let peerKeys:   SchnorrKeyPair;
  let peerDid:    string;
  let otherKeys:  SchnorrKeyPair;
  let otherDid:   string;
  let server:     HttpServerTransport;

  beforeEach(() => {
    serverKeys = SchnorrKeyPair.generate();
    serverDid  = DidBtcr2.create(serverKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    peerKeys   = SchnorrKeyPair.generate();
    peerDid    = DidBtcr2.create(peerKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    otherKeys  = SchnorrKeyPair.generate();
    otherDid   = DidBtcr2.create(otherKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  });

  afterEach(() => {
    server?.stop();
  });

  function makeServer(overrides: Partial<ConstructorParameters<typeof HttpServerTransport>[0]> = {}): HttpServerTransport {
    return new HttpServerTransport({
      logger              : SILENT_LOGGER,
      heartbeatIntervalMs : 0,
      resolveSenderPk     : resolveBtcr2SenderPk,
      ...overrides,
    });
  }

  describe('handleRequest - basics', () => {
    it('responds to OPTIONS preflight with 204 and CORS headers (with Origin)', async () => {
      server = makeServer();
      const res = await server.handleRequest(req('OPTIONS', '/v1/messages', { origin: 'https://x.example.com' }));
      expect(res.status).to.equal(204);
      expect(res.headers['access-control-allow-origin']).to.equal('*');
    });

    it('returns metadata at /v1/.well-known/aggregation', async () => {
      server = makeServer();
      const res = await server.handleRequest(req('GET', HTTP_ROUTE.WELL_KNOWN));
      expect(res.status).to.equal(200);
      const body = JSON.parse(res.body);
      expect(body.envelopeVersion).to.equal(HTTP_ENVELOPE_VERSION);
    });

    it('returns 404 for unknown routes', async () => {
      server = makeServer();
      const res = await server.handleRequest(req('GET', '/v1/nope'));
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /v1/messages', () => {
    it('dispatches a valid envelope to the registered handler', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      let received: Record<string, unknown> | undefined;
      server.registerMessageHandler(serverDid, COHORT_OPT_IN, (m) => { received = m; });

      const msg = new BaseMessage({
        type : COHORT_OPT_IN,
        from : peerDid,
        to   : serverDid,
        body : { cohortId: 'c1', participantPk: peerKeys.publicKey.compressed },
      });
      const envelope = signEnvelope(msg, { did: peerDid, keys: peerKeys }, { to: serverDid });

      const res = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, { 'content-type': 'application/json' }, JSON.stringify(envelope)));
      expect(res.status).to.equal(202);
      expect(received?.type).to.equal(COHORT_OPT_IN);
      expect(received?.cohortId).to.equal('c1'); // body flattened
    });

    it('rejects a tampered envelope with 401', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: peerDid, to: serverDid, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(msg, { did: peerDid, keys: peerKeys }, { to: serverDid });
      envelope.sig = envelope.sig.replace(/^../, '00');

      const res = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, JSON.stringify(envelope)));
      expect(res.status).to.equal(401);
    });

    it('rejects a replayed envelope with 409', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: peerDid, to: serverDid, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(msg, { did: peerDid, keys: peerKeys }, { to: serverDid });
      const body = JSON.stringify(envelope);

      const first = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, body));
      expect(first.status).to.equal(202);

      const second = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, body));
      expect(second.status).to.equal(409);
    });

    it('rejects with 429 when rate-limited', async () => {
      // Force a tiny bucket so we can exhaust it in one request.
      const { RateLimiter } = await import('../src/index.js');
      const limiter = new RateLimiter({ rps: 0, burst: 1 });
      server = makeServer({ rateLimiter: limiter });
      server.registerActor(serverDid, serverKeys);

      const sendOne = async (): Promise<number> => {
        const msg = new BaseMessage({ type: COHORT_OPT_IN, from: peerDid, to: serverDid, body: { cohortId: 'c1' } });
        const env = signEnvelope(msg, { did: peerDid, keys: peerKeys }, { to: serverDid });
        const res = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, JSON.stringify(env)));
        return res.status;
      };

      expect(await sendOne()).to.equal(202);
      expect(await sendOne()).to.equal(429);
    });

    it('rejects with 404 when recipient is not a registered actor', async () => {
      server = makeServer();
      // Do NOT register serverDid as an actor.

      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: peerDid, to: serverDid, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(msg, { did: peerDid, keys: peerKeys }, { to: serverDid });

      const res = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, JSON.stringify(envelope)));
      expect(res.status).to.equal(404);
    });

    it('rejects with 400 when body is not valid JSON', async () => {
      server = makeServer();
      const res = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, 'not json'));
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /v1/adverts', () => {
    it('caches advert and pushes to current broadcast subscribers', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const sse = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), sse.stream);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(advert, { did: serverDid, keys: serverKeys });
      const res = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, JSON.stringify(envelope)));
      expect(res.status).to.equal(202);

      expect(sse.events).to.have.lengthOf(1);
      expect(sse.events[0].event).to.equal(SSE_EVENT.ADVERT);
    });

    it('rejects adverts from non-registered actors with 403', async () => {
      server = makeServer();
      // peerDid is not a registered actor.
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: peerDid, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(advert, { did: peerDid, keys: peerKeys });

      const res = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, JSON.stringify(envelope)));
      expect(res.status).to.equal(403);
    });
  });

  describe('handleSse - broadcast subscription', () => {
    it('replays the cached advert to a late subscriber', () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      server.publishRepeating(advert, serverDid, 60_000);

      const sse = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), sse.stream);

      expect(sse.events).to.have.lengthOf(1);
      expect(sse.events[0].event).to.equal(SSE_EVENT.ADVERT);
    });

    it('does not replay the advert after the stop function is called', () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      const stop = server.publishRepeating(advert, serverDid, 60_000);
      stop();

      const sse = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), sse.stream);

      expect(sse.events).to.have.lengthOf(0);
    });
  });

  describe('handleSse - inbox subscription', () => {
    const inboxPath = (did: string): string => `/v1/actors/${encodeURIComponent(did)}/inbox`;

    it('closes the stream without an Authorization header', () => {
      server = makeServer();
      const sse = makeSseMock();
      server.handleSse(req('GET', inboxPath(peerDid)), sse.stream);
      expect(sse.isClosed()).to.be.true;
    });

    it('closes the stream when auth fails verification', () => {
      server = makeServer();
      const sse = makeSseMock();

      // Auth signed for the wrong path.
      const badAuth = buildRequestAuth(peerDid, peerKeys, '/v1/wrong/path');
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: badAuth }), sse.stream);
      expect(sse.isClosed()).to.be.true;
    });

    it('closes the stream when auth DID does not match path DID', () => {
      server = makeServer();
      const sse = makeSseMock();

      // peerKeys signed for peerDid but hitting otherDid's inbox - should fail because
      // the pubkey we resolve for otherDid != peerKeys.
      const mismatchAuth = buildRequestAuth(peerDid, peerKeys, inboxPath(otherDid));
      server.handleSse(req('GET', inboxPath(otherDid), { authorization: mismatchAuth }), sse.stream);
      expect(sse.isClosed()).to.be.true;
    });

    it('opens an inbox subscription with valid auth', () => {
      server = makeServer();
      const sse = makeSseMock();

      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth }), sse.stream);

      expect(sse.isClosed()).to.be.false;
    });

    it('replays buffered messages on first subscribe', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      // Server sends to peer BEFORE peer subscribes.
      const msg = new BaseMessage({ type: COHORT_READY, from: serverDid, to: peerDid, body: { cohortId: 'c1' } });
      await server.sendMessage(msg, serverDid, peerDid);

      // Now peer subscribes.
      const sse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth }), sse.stream);

      expect(sse.events).to.have.lengthOf(1);
      expect(sse.events[0].event).to.equal(SSE_EVENT.MESSAGE);
      const env = JSON.parse(sse.events[0].data) as SignedEnvelope;
      expect(env.message.type).to.equal(COHORT_READY);
    });

    it('delivers live sendMessage to active subscriber', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const sse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth }), sse.stream);
      expect(sse.events).to.have.lengthOf(0);

      const msg = new BaseMessage({ type: COHORT_READY, from: serverDid, to: peerDid, body: { cohortId: 'c1' } });
      await server.sendMessage(msg, serverDid, peerDid);

      expect(sse.events).to.have.lengthOf(1);
    });

    it('replays only events newer than Last-Event-ID', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      // Pre-populate inbox with two messages.
      for(const i of [1, 2]) {
        const m = new BaseMessage({ type: COHORT_READY, from: serverDid, to: peerDid, body: { cohortId: `c${i}` } });
        await server.sendMessage(m, serverDid, peerDid);
      }

      // A first subscription gets both events; take the id of the first one from it.
      const first = makeSseMock();
      const firstAuth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: firstAuth }), first.stream);
      expect(first.events).to.have.lengthOf(2);
      const firstId = first.events[0].id!;
      first.triggerClose();

      const sse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth, 'last-event-id': firstId }), sse.stream);

      expect(sse.events).to.have.lengthOf(1);
      expect(sse.events[0].id).to.equal(first.events[1].id);
      const env = JSON.parse(sse.events[0].data) as SignedEnvelope;
      expect((env.message.body as { cohortId: string }).cohortId).to.equal('c2');
    });

    it('replays every retained event for a Last-Event-ID of another buffer', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      for(const i of [1, 2]) {
        const m = new BaseMessage({ type: COHORT_READY, from: serverDid, to: peerDid, body: { cohortId: `c${i}` } });
        await server.sendMessage(m, serverDid, peerDid);
      }

      // The id form of an earlier server (for example before a restart): a different epoch.
      const sse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth, 'last-event-id': '0123456789abcdef-1' }), sse.stream);
      expect(sse.events).to.have.lengthOf(2);
    });

    it('closes the stream for a replayed auth header', () => {
      server = makeServer();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));

      const first = makeSseMock();
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth }), first.stream);
      expect(first.isClosed()).to.be.false;

      const replay = makeSseMock();
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth }), replay.stream);
      expect(replay.isClosed()).to.be.true;
      expect(first.isClosed()).to.be.false;
    });

    it('closes the stream for a throttled inbox GET with a fresh auth header', () => {
      server = makeServer({ now: () => T0_MS, rateLimiter: new RateLimiter({ rps: 0, burst: 1 }) });
      const subscribe = (): SseMock => {
        const sse = makeSseMock();
        const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid), { timestamp: T0_SEC });
        server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth }), sse.stream);
        return sse;
      };

      const first = subscribe();
      expect(first.isClosed()).to.be.false;

      const throttled = subscribe();
      expect(throttled.isClosed()).to.be.true;
      expect(first.isClosed()).to.be.false;
    });
  });

  describe('sendMessage', () => {
    it('throws when sender is not a registered actor', async () => {
      server = makeServer();
      const msg = new BaseMessage({ type: COHORT_READY, from: serverDid, to: peerDid, body: { cohortId: 'c1' } });
      try {
        await server.sendMessage(msg, serverDid, peerDid);
        expect.fail('expected throw');
      } catch(err) {
        expect((err as { type: string }).type).to.equal('UNKNOWN_SENDER');
      }
    });

    it('throws when recipient is missing', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const msg = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      try {
        await server.sendMessage(msg, serverDid);
        expect.fail('expected throw');
      } catch(err) {
        expect((err as { type: string }).type).to.equal('MISSING_RECIPIENT');
      }
    });
  });

  describe('CORS policy', () => {
    it('permissive mode echoes wildcard origin', async () => {
      server = makeServer({ cors: { mode: 'permissive' } });
      const res = await server.handleRequest(req('OPTIONS', '/v1/messages', { origin: 'https://x.example.com' }));
      expect(res.headers['access-control-allow-origin']).to.equal('*');
    });

    it('allowlist mode echoes only allowed origins', async () => {
      server = makeServer({ cors: { mode: 'allowlist', origins: ['https://ok.example.com'] } });

      const allowed = await server.handleRequest(req('OPTIONS', '/v1/messages', { origin: 'https://ok.example.com' }));
      expect(allowed.headers['access-control-allow-origin']).to.equal('https://ok.example.com');

      const blocked = await server.handleRequest(req('OPTIONS', '/v1/messages', { origin: 'https://evil.example.com' }));
      expect(blocked.headers['access-control-allow-origin']).to.be.undefined;
    });

    it('same-origin mode emits no CORS headers', async () => {
      server = makeServer({ cors: { mode: 'same-origin' } });
      const res = await server.handleRequest(req('OPTIONS', '/v1/messages', { origin: 'https://x.example.com' }));
      expect(res.headers['access-control-allow-origin']).to.be.undefined;
    });
  });

  describe('stop()', () => {
    it('closes broadcast and inbox subscribers and clears the advert cache', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      server.publishRepeating(advert, serverDid, 60_000);

      const broadcastSse = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), broadcastSse.stream);

      const inboxSse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, `/v1/actors/${encodeURIComponent(peerDid)}/inbox`);
      server.handleSse(
        req('GET', `/v1/actors/${encodeURIComponent(peerDid)}/inbox`, { authorization: auth }),
        inboxSse.stream,
      );

      server.stop();
      expect(broadcastSse.isClosed()).to.be.true;
      expect(inboxSse.isClosed()).to.be.true;

      // After stop, a new broadcast subscriber should not receive a cached advert.
      const later = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), later.stream);
      expect(later.events).to.have.lengthOf(0);
    });
  });

  describe('replay cache and rate limiter order', () => {
    let clockMs: number;

    beforeEach(() => {
      clockMs = T0_MS;
    });

    const nowSec = (): number => Math.floor(clockMs / 1000);

    const optIn = (from: string, keys: SchnorrKeyPair, opts: { timestamp?: number; cohortId?: string } = {}): string => {
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from, to: serverDid, body: { cohortId: opts.cohortId ?? 'c1' } });
      return JSON.stringify(signEnvelope(msg, { did: from, keys }, { to: serverDid, timestamp: opts.timestamp ?? nowSec() }));
    };

    const post = async (body: string, route: string = HTTP_ROUTE.MESSAGES): Promise<{ status: number; error?: string }> => {
      const res = await server.handleRequest(req('POST', route, {}, body));
      return { status: res.status, error: (JSON.parse(res.body) as { error?: string }).error };
    };

    const advert = (cohortId: string): string => JSON.stringify(signEnvelope(
      new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId } }),
      { did: serverDid, keys: serverKeys },
      { timestamp: nowSec() },
    ));

    it('replays of a captured envelope do not drain the bucket of its sender', async () => {
      server = makeServer({ now: () => clockMs, rateLimiter: new RateLimiter({ rps: 0, burst: 2 }) });
      server.registerActor(serverDid, serverKeys);

      const captured = optIn(peerDid, peerKeys);
      expect((await post(captured)).status).to.equal(202);

      for(let i = 0; i < 5; i++) {
        expect(await post(captured)).to.deep.equal({ status: 409, error: 'replay' });
      }

      // The last token of the burst is still there for a fresh envelope of the victim.
      expect((await post(optIn(peerDid, peerKeys, { cohortId: 'c2' }))).status).to.equal(202);
      expect(await post(optIn(peerDid, peerKeys, { cohortId: 'c3' }))).to.deep.equal({ status: 429, error: 'rate_limited' });
    });

    it('accepts a throttled envelope (429) after the refill', async () => {
      server = makeServer({ now: () => clockMs, rateLimiter: new RateLimiter({ rps: 1, burst: 1 }) });
      server.registerActor(serverDid, serverKeys);

      expect((await post(optIn(peerDid, peerKeys))).status).to.equal(202);
      const throttled = optIn(peerDid, peerKeys, { cohortId: 'c2' });
      expect(await post(throttled)).to.deep.equal({ status: 429, error: 'rate_limited' });

      clockMs += 1000;
      expect((await post(throttled)).status).to.equal(202);
    });

    it('throttled envelopes store no nonce, so they cannot evict the entry of another sender', async () => {
      const nonceCache = new NonceCache({ maxEntries: 3 });
      server = makeServer({ now: () => clockMs, nonceCache, rateLimiter: new RateLimiter({ rps: 0, burst: 1 }) });
      server.registerActor(serverDid, serverKeys);

      const victim = optIn(peerDid, peerKeys);
      expect((await post(victim)).status).to.equal(202);

      // One accepted envelope of the attacker, then a flood of throttled ones.
      expect((await post(optIn(otherDid, otherKeys, { cohortId: 'a0' }))).status).to.equal(202);
      for(let i = 1; i <= 5; i++) {
        expect((await post(optIn(otherDid, otherKeys, { cohortId: `a${i}` }))).status).to.equal(429);
      }
      expect(nonceCache.size()).to.equal(2);

      expect(await post(victim)).to.deep.equal({ status: 409, error: 'replay' });
    });

    it('a full cache evicts the oldest live entry, its replay passes, and the warning is throttled', async () => {
      const recording = makeRecordingLogger();
      const nonceCache = new NonceCache({ maxEntries: 3 });
      server = makeServer({ now: () => clockMs, nonceCache, logger: recording.logger });
      server.registerActor(serverDid, serverKeys);

      const victim = optIn(peerDid, peerKeys);
      expect((await post(victim)).status).to.equal(202);

      const others = [makeKDid(), makeKDid(), makeKDid()];
      expect((await post(optIn(others[0]!.did, others[0]!.keys))).status).to.equal(202);
      expect((await post(optIn(others[1]!.did, others[1]!.keys))).status).to.equal(202);
      expect(await post(victim)).to.deep.equal({ status: 409, error: 'replay' });
      expect(recording.calls.warn).to.have.lengthOf(0);

      // The third envelope of another DID evicts the victim entry (the accepted residual of eviction).
      expect((await post(optIn(others[2]!.did, others[2]!.keys))).status).to.equal(202);
      expect(recording.calls.warn).to.have.lengthOf(1);
      expect(recording.calls.warn[0]![1]).to.deep.equal({ evicted: 1, windowSec: 60 });

      // The replay now passes, and its store evicts again within the same warning window.
      expect((await post(victim)).status).to.equal(202);
      expect(nonceCache.size()).to.equal(3);
      expect(recording.calls.warn).to.have.lengthOf(1);

      // One second later, one more eviction is still in the same window.
      clockMs = T0_MS + 1000;
      expect((await post(optIn(others[0]!.did, others[0]!.keys, { cohortId: 'c2' }))).status).to.equal(202);
      expect(recording.calls.warn).to.have.lengthOf(1);

      // At T0 + skew a new window starts. The second warning counts the 3 evictions after the first.
      clockMs = T0_MS + 60_000;
      expect((await post(optIn(others[1]!.did, others[1]!.keys, { cohortId: 'c2' }))).status).to.equal(202);
      expect(recording.calls.warn).to.have.lengthOf(2);
      expect(recording.calls.warn[1]![1]).to.deep.equal({ evicted: 3, windowSec: 60 });
    });

    it('accepts an envelope at timestamp now + skew, and its replay at now + 2 x skew is 409', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);

      const skew = 60;
      const edge = optIn(peerDid, peerKeys, { timestamp: T0_SEC + skew });
      expect((await post(edge)).status).to.equal(202);

      // At the expiry second of the entry, a store of another DID must not purge it.
      clockMs = T0_MS + 2 * skew * 1000;
      expect((await post(optIn(otherDid, otherKeys))).status).to.equal(202);
      expect(await post(edge)).to.deep.equal({ status: 409, error: 'replay' });

      // One second later the skew check refuses it.
      clockMs += 1000;
      expect(await post(edge)).to.deep.equal({ status: 401, error: 'invalid_envelope' });
    });

    it('refuses an envelope whose timestamp is not a number, also after 2 x skew', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);

      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: peerDid, to: serverDid, body: { cohortId: 'c1' } });
      const body = JSON.stringify(signEnvelope(msg, { did: peerDid, keys: peerKeys }, {
        to        : serverDid,
        timestamp : 'abc' as unknown as number,
      }));
      expect(await post(body)).to.deep.equal({ status: 401, error: 'invalid_envelope' });

      clockMs = T0_MS + (2 * 60 + 1) * 1000;
      expect(await post(body)).to.deep.equal({ status: 401, error: 'invalid_envelope' });
    });

    it('POST /v1/adverts: a replayed advert is 409, and a fresh advert after the burst is 429', async () => {
      server = makeServer({ now: () => clockMs, rateLimiter: new RateLimiter({ rps: 0, burst: 1 }) });
      server.registerActor(serverDid, serverKeys);

      const first = advert('c1');
      expect((await post(first, HTTP_ROUTE.ADVERTS)).status).to.equal(202);
      expect(await post(first, HTTP_ROUTE.ADVERTS)).to.deep.equal({ status: 409, error: 'replay' });
      expect(await post(advert('c2'), HTTP_ROUTE.ADVERTS)).to.deep.equal({ status: 429, error: 'rate_limited' });
    });

    it('uses the injected clock for the envelope skew check', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);

      // Signed for the injected clock, which is far from the wall clock.
      expect((await post(optIn(peerDid, peerKeys))).status).to.equal(202);

      const stale = optIn(peerDid, peerKeys, { timestamp: T0_SEC - 61, cohortId: 'c2' });
      expect(await post(stale)).to.deep.equal({ status: 401, error: 'invalid_envelope' });
    });
  });

  describe('sign at delivery', () => {
    const inboxPath = (did: string): string => `/v1/actors/${encodeURIComponent(did)}/inbox`;
    let clockMs: number;

    beforeEach(() => {
      clockMs = T0_MS;
    });

    const nowSec = (): number => Math.floor(clockMs / 1000);

    const subscribeInbox = (lastEventId?: string): SseMock => {
      const sse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid), { timestamp: nowSec() });
      const headers: Record<string, string> = { authorization: auth };
      if(lastEventId !== undefined) headers['last-event-id'] = lastEventId;
      server.handleSse(req('GET', inboxPath(peerDid), headers), sse.stream);
      return sse;
    };

    const ready = (from: string, cohortId: string): BaseMessage =>
      new BaseMessage({ type: COHORT_READY, from, to: peerDid, body: { cohortId } });

    const envelopeOf = (sse: SseMock, index: number): SignedEnvelope =>
      JSON.parse(sse.events[index]!.data) as SignedEnvelope;

    it('signs a stale buffered event again, keeps its id, and reuses the new envelope within skew / 2', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);

      // A live subscriber at T sees the event and its id.
      const live = subscribeInbox();
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);
      expect(live.events).to.have.lengthOf(1);
      const original = envelopeOf(live, 0);
      expect(original.timestamp).to.equal(T0_SEC);
      live.triggerClose();

      // At T + 90 s the original envelope is out of skew.
      clockMs = T0_MS + 90_000;
      expect(() => verifyEnvelope(original, serverKeys.publicKey, { now: () => clockMs }))
        .to.throw(HttpTransportError).with.property('type', 'ENVELOPE_TIMESTAMP_SKEW');

      const late = subscribeInbox();
      expect(late.events).to.have.lengthOf(1);
      expect(late.events[0]!.id).to.equal(live.events[0]!.id);
      const resigned = envelopeOf(late, 0);
      expect(resigned.timestamp).to.equal(T0_SEC + 90);
      expect(resigned.nonce).to.not.equal(original.nonce);
      expect(resigned.to).to.equal(peerDid);
      expect(resigned.message).to.deep.equal(original.message);
      verifyEnvelope(resigned, serverKeys.publicKey, { now: () => clockMs, expectedTo: peerDid });

      // Within skew / 2 a later subscriber gets the same envelope.
      clockMs = T0_MS + 100_000;
      const again = subscribeInbox();
      expect(again.events).to.have.lengthOf(1);
      expect(again.events[0]!.data).to.equal(late.events[0]!.data);
    });

    it('delivers a buffered event within skew / 2 without a new signature', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);

      const first = subscribeInbox();
      clockMs = T0_MS + 30_000;
      const second = subscribeInbox();
      expect(second.events[0]!.data).to.equal(first.events[0]!.data);
      expect(envelopeOf(second, 0).timestamp).to.equal(T0_SEC);
    });

    it('signs a buffered event again one second over skew / 2', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);

      const first = subscribeInbox();
      const original = envelopeOf(first, 0);
      clockMs = T0_MS + 31_000;
      const second = subscribeInbox();
      const resigned = envelopeOf(second, 0);
      expect(resigned.timestamp).to.equal(T0_SEC + 31);
      expect(resigned.nonce).to.not.equal(original.nonce);
      expect(second.events[0]!.id).to.equal(first.events[0]!.id);
    });

    it('signs a live event once for every live subscriber', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);

      const a = subscribeInbox();
      const b = subscribeInbox();
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);
      expect(a.events).to.have.lengthOf(1);
      expect(b.events).to.have.lengthOf(1);
      expect(b.events[0]!.data).to.equal(a.events[0]!.data);

      // Within skew / 2 a later subscriber gets the same envelope from the buffer.
      clockMs = T0_MS + 30_000;
      const c = subscribeInbox();
      expect(c.events).to.have.lengthOf(1);
      expect(c.events[0]!.data).to.equal(a.events[0]!.data);
    });

    it('skips a stale event of a sender that is no longer an actor; later events still arrive', async () => {
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, serverKeys);
      server.registerActor(otherDid, otherKeys);

      await server.sendMessage(ready(otherDid, 'gone'), otherDid, peerDid);
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);
      server.unregisterActor(otherDid);

      clockMs = T0_MS + 90_000;
      const sse = subscribeInbox();
      expect(sse.events).to.have.lengthOf(1);
      expect(envelopeOf(sse, 0).from).to.equal(serverDid);
      verifyEnvelope(envelopeOf(sse, 0), serverKeys.publicKey, { now: () => clockMs });
    });

    it('skips only the event whose sign throws at delivery, with a log line', async () => {
      const recording = makeRecordingLogger();
      server = makeServer({ now: () => clockMs, logger: recording.logger });
      server.registerActor(serverDid, serverKeys);
      server.registerActor(otherDid, otherKeys);

      await server.sendMessage(ready(otherDid, 'broken'), otherDid, peerDid);
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);
      server.registerActor(otherDid, throwingKeys(otherKeys));

      clockMs = T0_MS + 90_000;
      const sse = subscribeInbox();
      expect(sse.events).to.have.lengthOf(1);
      expect(envelopeOf(sse, 0).from).to.equal(serverDid);
      expect(recording.calls.warn).to.have.lengthOf(1);
    });

    it('sendMessage gives a sign throw to the caller', async () => {
      const signError = new Error('signer offline');
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, throwingKeys(serverKeys, signError));
      let thrown: unknown;
      try {
        await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);
      } catch(err) {
        thrown = err;
      }
      expect(thrown).to.equal(signError);
    });

    it('publishRepeating gives a sign throw to the caller', () => {
      const signError = new Error('signer offline');
      server = makeServer({ now: () => clockMs });
      server.registerActor(serverDid, throwingKeys(serverKeys, signError));
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      expect(() => server.publishRepeating(advert, serverDid, 60_000)).to.throw(signError);
    });

    it('signs a stale local advert again for a late subscriber within the TTL', () => {
      server = makeServer({ now: () => clockMs, advertTtlMs: 300_000 });
      server.registerActor(serverDid, serverKeys);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      server.publishRepeating(advert, serverDid, 60_000);

      clockMs = T0_MS + 120_000;
      const sse = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), sse.stream);
      expect(sse.events).to.have.lengthOf(1);
      const env = JSON.parse(sse.events[0]!.data) as SignedEnvelope;
      expect(env.timestamp).to.equal(T0_SEC + 120);
      expect(env.to).to.equal(undefined);
      verifyEnvelope(env, serverKeys.publicKey, { now: () => clockMs, expectedTo: undefined });
    });

    it('skips a stale local advert whose sender is no longer an actor', () => {
      server = makeServer({ now: () => clockMs, advertTtlMs: 300_000 });
      server.registerActor(serverDid, serverKeys);
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      server.publishRepeating(advert, serverDid, 60_000);
      server.unregisterActor(serverDid);

      clockMs = T0_MS + 120_000;
      const sse = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), sse.stream);
      expect(sse.events).to.have.lengthOf(0);
      expect(sse.isClosed()).to.be.false;
    });

    it('relays a posted advert verbatim, also to a late subscriber', async () => {
      server = makeServer({ now: () => clockMs, advertTtlMs: 300_000 });
      server.registerActor(serverDid, serverKeys);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
      const body = JSON.stringify(signEnvelope(advert, { did: serverDid, keys: serverKeys }, { timestamp: nowSec() }));

      const live = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), live.stream);
      const res = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, body));
      expect(res.status).to.equal(202);
      expect(live.events[0]!.data).to.equal(body);

      clockMs = T0_MS + 120_000;
      const late = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), late.stream);
      expect(late.events).to.have.lengthOf(1);
      expect(late.events[0]!.data).to.equal(body);
    });

    it('POST /v1/adverts refuses the envelope of a live local advert (409 local_advert); the advert stays local', async () => {
      server = makeServer({ now: () => clockMs, advertTtlMs: 300_000 });
      server.registerActor(serverDid, serverKeys);
      const stop = server.publishRepeating(
        new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } }),
        serverDid,
        60_000,
      );

      // Anyone can read the local envelope from GET /v1/adverts and POST it back.
      clockMs = T0_MS + 40_000;
      const reader = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), reader.stream);
      const delivered = reader.events[0]!.data;
      const res = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, delivered));
      expect(res.status).to.equal(409);
      expect(JSON.parse(res.body)).to.deep.equal({ error: 'local_advert' });

      // A late subscriber gets an envelope that the server signs again at delivery.
      clockMs = T0_MS + 150_000;
      const late = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), late.stream);
      expect(late.events).to.have.lengthOf(1);
      expect(late.events[0]!.id).to.equal(reader.events[0]!.id);
      const env = JSON.parse(late.events[0]!.data) as SignedEnvelope;
      expect(env.timestamp).to.equal(T0_SEC + 150);
      verifyEnvelope(env, serverKeys.publicKey, { now: () => clockMs, expectedTo: undefined });

      // The stop function clears the advert.
      stop();
      const after = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), after.stream);
      expect(after.events).to.have.lengthOf(0);
    });

    it('POST /v1/adverts accepts a posted advert after the local advert expires', async () => {
      server = makeServer({ now: () => clockMs, advertTtlMs: 60_000 });
      server.registerActor(serverDid, serverKeys);
      server.publishRepeating(
        new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } }),
        serverDid,
        60_000,
      );

      clockMs = T0_MS + 61_000;
      const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c2' } });
      const body = JSON.stringify(signEnvelope(advert, { did: serverDid, keys: serverKeys }, { timestamp: nowSec() }));
      const res = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, body));
      expect(res.status).to.equal(202);

      const late = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), late.stream);
      expect(late.events).to.have.lengthOf(1);
      expect(late.events[0]!.data).to.equal(body);
    });

    it('POST /v1/adverts refuses a directed inbox envelope of an actor, and the cached advert does not change', async () => {
      server = makeServer({ now: () => clockMs, advertTtlMs: 300_000 });
      server.registerActor(serverDid, serverKeys);
      server.publishRepeating(
        new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } }),
        serverDid,
        60_000,
      );

      // The peer gets a directed message of the actor, and the server signs it again at delivery.
      await server.sendMessage(ready(serverDid, 'c1'), serverDid, peerDid);
      clockMs = T0_MS + 90_000;
      const inbox = subscribeInbox();
      const directed = inbox.events[0]!.data;
      expect((JSON.parse(directed) as SignedEnvelope).to).to.equal(peerDid);

      const res = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, directed));
      expect(res.status).to.equal(401);
      expect(JSON.parse(res.body)).to.deep.equal({ error: 'invalid_envelope' });

      const late = makeSseMock();
      server.handleSse(req('GET', HTTP_ROUTE.ADVERTS), late.stream);
      expect(late.events).to.have.lengthOf(1);
      const env = JSON.parse(late.events[0]!.data) as SignedEnvelope;
      expect(env.message.type).to.equal(COHORT_ADVERT);
      expect(env.to).to.equal(undefined);
    });
  });
});
