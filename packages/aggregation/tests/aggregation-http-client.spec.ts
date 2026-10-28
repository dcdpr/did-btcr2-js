import { SchnorrKeyPair } from '@did-btcr2/keys';
import { expect } from 'chai';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  AggregationParticipant,
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_READY,
  HTTP_ROUTE,
  HttpClientTransport,
  HttpTransportError,
  KeyPairAggregationSigner,
  type BaseBody,
  type Logger,
  RECOMMENDED_MAX_SSE_EVENT_BYTES,
  SILENT_LOGGER,
  SSE_EVENT,
  type SignedEnvelope,
  TransportFactory,
  signEnvelope,
} from '../src/index.js';
import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';

/** The init argument of `fetch`. */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

interface MockCall {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
  redirect?: FetchInit['redirect'];
}

interface MockFetchHelper {
  fetch: typeof fetch;
  calls: MockCall[];
  pushEvent(pathname: string, event: string, data: string): void;
  closeStream(pathname: string): void;
  setPostResponse(status: number, body?: string): void;
  waitForCall(pathname: string, timeoutMs?: number): Promise<void>;
}

function makeMockFetch(): MockFetchHelper {
  const calls: MockCall[] = [];
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const encoder  = new TextEncoder();

  let postStatus = 200;
  let postBody   = '';

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL
      ? input
      : typeof input === 'string'
        ? new URL(input)
        : new URL(input.url);
    const method = (init?.method ?? 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if(init?.headers) {
      if(init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else if(Array.isArray(init.headers)) {
        for(const [k, v] of init.headers) headers[k.toLowerCase()] = v;
      } else {
        for(const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = String(v);
      }
    }

    let body: unknown;
    if(typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }

    calls.push({ method, url, headers, body, redirect: init?.redirect });

    if(method === 'POST') {
      return new Response(postBody, { status: postStatus });
    }

    // GET -> open an SSE stream the test controls.
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { ctrl = c; },
      cancel() { streams.delete(url.pathname); },
    });
    streams.set(url.pathname, ctrl);

    if(init?.signal) {
      const onAbort = (): void => {
        try { ctrl.close(); } catch { /* already closed */ }
        streams.delete(url.pathname);
      };
      if(init.signal.aborted) {
        onAbort();
      } else {
        init.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    return new Response(stream, {
      status  : 200,
      headers : { 'content-type': 'text/event-stream' },
    });
  };

  return {
    fetch : fetchImpl,
    calls,
    pushEvent(pathname, event, data) {
      const ctrl = streams.get(pathname);
      if(!ctrl) throw new Error(`No SSE stream open at ${pathname}`);
      ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
    },
    closeStream(pathname) {
      const ctrl = streams.get(pathname);
      if(ctrl) {
        try { ctrl.close(); } catch { /* already closed */ }
        streams.delete(pathname);
      }
    },
    setPostResponse(status, body = '') {
      postStatus = status;
      postBody   = body;
    },
    async waitForCall(pathname, timeoutMs = 200) {
      const start = Date.now();
      while(!calls.some((c) => c.url.pathname === pathname)) {
        if(Date.now() - start > timeoutMs) {
          throw new Error(`Timeout waiting for call to ${pathname}. Saw: ${calls.map((c) => c.url.pathname).join(', ')}`);
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

/** Lowercase the header names of a request init. */
function lowerHeaders(init: FetchInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if(init) new Headers(init).forEach((value, key) => { out[key] = value; });
  return out;
}

interface ScriptCall {
  path: string;
  headers: Record<string, string>;
  redirect?: FetchInit['redirect'];
}

type ScriptStep =
  | { kind: 'stream'; frames: string[]; end: boolean }
  | { kind: 'status'; status: number; cancelFails?: boolean; headers?: Record<string, string> }
  | { kind: 'opaque-redirect' }
  | { kind: 'reject' };

interface ScriptedFetch {
  fetch: typeof fetch;
  calls: ScriptCall[];
  /** The count of non-ok answers whose body the client cancelled. */
  cancelled(): number;
  /** The count of 200 SSE streams that the client cancelled. */
  streamsCancelled(): number;
}

/**
 * A fetch stub with a script for one path. Each request to `path` takes the next step.
 * After the last step, and for each other path, the answer is a stream that stays open
 * until the request aborts. `onExhausted` runs once, at the first request after the last step.
 */
function makeScriptedFetch(path: string, steps: ScriptStep[], onExhausted?: () => void): ScriptedFetch {
  const calls: ScriptCall[] = [];
  const encoder = new TextEncoder();
  let next = 0;
  let cancelled = 0;
  let streamsCancelled = 0;
  let exhausted = false;

  const sse = (frames: string[], end: boolean, signal?: AbortSignal | null): Response => {
    const stream = new ReadableStream<Uint8Array>({
      cancel() { streamsCancelled++; },
      start(c) {
        for(const frame of frames) c.enqueue(encoder.encode(frame));
        if(end) {
          c.close();
          return;
        }
        const onAbort = (): void => {
          try { c.close(); } catch { /* already closed */ }
        };
        if(signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    calls.push({ path: url.pathname, headers: lowerHeaders(init?.headers), redirect: init?.redirect });
    if(url.pathname !== path) return sse([], false, init?.signal);
    const step = steps[next++];
    if(!step) {
      if(!exhausted) {
        exhausted = true;
        onExhausted?.();
      }
      return sse([], false, init?.signal);
    }
    if(step.kind === 'reject') throw new TypeError('network down');
    // The answer of a browser fetch with `redirect: 'manual'` to a redirect.
    if(step.kind === 'opaque-redirect') return opaqueRedirect();
    if(step.kind === 'status') {
      const cancelFails = step.cancelFails === true;
      const body = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(encoder.encode('busy')); },
        cancel() {
          cancelled++;
          // A source cancel that throws makes `body.cancel()` reject.
          if(cancelFails) throw new Error('cancel failed');
        },
      });
      return new Response(body, { status: step.status, headers: step.headers });
    }
    return sse(step.frames, step.end, init?.signal);
  };

  return { fetch: fetchImpl, calls, cancelled: () => cancelled, streamsCancelled: () => streamsCancelled };
}

/**
 * The shape of an opaque redirect answer in a browser: status 0, type `opaqueredirect`,
 * and no body. The Response constructor refuses status 0, so the stub is a plain object.
 */
function opaqueRedirect(): Response {
  return { ok: false, status: 0, type: 'opaqueredirect', body: null } as unknown as Response;
}

/** An SSE frame. An `id` of `''` gives an `id` field with an empty value. */
function sseFrame(event: string, data: string, id?: string): string {
  return `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ''}data: ${data}\n\n`;
}

interface RecordingLogger {
  logger: Logger;
  warns: unknown[][];
  errors: unknown[][];
}

function makeRecordingLogger(): RecordingLogger {
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];
  return {
    logger : {
      debug : () => {},
      info  : () => {},
      warn  : (...args) => { warns.push(args); },
      error : (...args) => { errors.push(args); },
    },
    warns,
    errors,
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

/** Resolve with `promise`, or reject after `timeoutMs`. */
function within<T>(promise: Promise<T>, timeoutMs = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timeout: the promise did not settle')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const inboxPathOf = (did: string): string => HTTP_ROUTE.ACTOR_INBOX.replace('{did}', encodeURIComponent(did));

describe('HttpClientTransport', () => {
  let helper: MockFetchHelper;
  let keys1: SchnorrKeyPair;
  let did1:  string;
  let keys2: SchnorrKeyPair;
  let did2:  string;
  let client: HttpClientTransport;

  beforeEach(() => {
    helper = makeMockFetch();
    keys1  = SchnorrKeyPair.generate();
    did1   = DidBtcr2.create(keys1.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    keys2  = SchnorrKeyPair.generate();
    did2   = DidBtcr2.create(keys2.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  });

  afterEach(() => {
    client?.stop();
  });

  const makeClient = (): HttpClientTransport => new HttpClientTransport({
    baseUrl          : 'https://example.com/',
    fetchImpl        : helper.fetch,
    logger           : SILENT_LOGGER,
    reconnectBackoff : () => 0,
    resolveSenderPk  : resolveBtcr2SenderPk,
  });

  describe('construction', () => {
    it('throws if no fetch is available', () => {
      expect(() => new HttpClientTransport({
        baseUrl   : 'https://example.com/',
        fetchImpl : undefined as unknown as typeof fetch,
        logger    : SILENT_LOGGER,
      })).to.not.throw;
      // The constructor only throws when the fallback globalThis.fetch is also
      // missing - impossible to assert without mutating the global. Covered by
      // explicit-injection tests below.
    });
  });

  describe('registerActor / registerPeer', () => {
    it('getActorPk returns compressed key after registration', () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      expect(client.getActorPk(did1)).to.deep.equal(keys1.publicKey.compressed);
    });

    it('getPeerPk returns stored bytes after registration', () => {
      client = makeClient();
      client.registerPeer(did2, keys2.publicKey.compressed);
      expect(client.getPeerPk(did2)).to.deep.equal(keys2.publicKey.compressed);
    });

    it('registerPeer throws on invalid key bytes', () => {
      client = makeClient();
      expect(() => client.registerPeer(did2, new Uint8Array(5)))
        .to.throw(HttpTransportError).with.property('type', 'INVALID_PEER_KEY');
    });

    it('registerMessageHandler throws on unknown actor', () => {
      client = makeClient();
      expect(() => client.registerMessageHandler(did1, COHORT_ADVERT, () => {}))
        .to.throw(HttpTransportError).with.property('type', 'UNKNOWN_ACTOR');
    });

    it('unregisterMessageHandler is a no-op for unknown actor', () => {
      client = makeClient();
      // Should not throw.
      client.unregisterMessageHandler(did1, COHORT_ADVERT);
    });
  });

  describe('sendMessage', () => {
    it('POSTs a well-formed signed envelope', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);

      const msg = new BaseMessage({
        type : COHORT_OPT_IN,
        from : did1,
        to   : did2,
        body : { cohortId: 'c1', participantPk: keys1.publicKey.compressed },
      });
      await client.sendMessage(msg, did1, did2);

      const postCall = helper.calls.find((c) => c.method === 'POST');
      expect(postCall, 'POST call recorded').to.exist;
      expect(postCall!.url.pathname).to.equal(HTTP_ROUTE.MESSAGES);
      expect(postCall!.headers['content-type']).to.equal('application/json');

      const env = postCall!.body as SignedEnvelope;
      expect(env.from).to.equal(did1);
      expect(env.to).to.equal(did2);
      expect(env.message.type).to.equal(COHORT_OPT_IN);
      expect(env.sig).to.have.lengthOf(128);
    });

    it('throws HttpTransportError on non-ok response', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      helper.setPostResponse(500, 'boom');

      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      try {
        await client.sendMessage(msg, did1, did2);
        expect.fail('should have thrown');
      } catch(err) {
        expect(err).to.be.instanceOf(HttpTransportError);
        expect((err as HttpTransportError).type).to.equal('SEND_MESSAGE_HTTP');
        expect((err as HttpTransportError).data).to.deep.include({ status: 500, body: 'boom' });
      }
    });

    it('reads only the start of an error body that never ends, then cancels the body', async () => {
      let pulls = 0;
      let cancelled = false;
      const chunk = new TextEncoder().encode('x'.repeat(100));
      client = new HttpClientTransport({
        baseUrl   : 'https://example.com/',
        fetchImpl : async () => new Response(new ReadableStream<Uint8Array>({
          pull(c) {
            pulls++;
            c.enqueue(chunk);
          },
          cancel() { cancelled = true; },
        }), { status: 500 }),
        logger : SILENT_LOGGER,
      });
      client.registerActor(did1, keys1);
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      let caught: unknown;
      try { await within(client.sendMessage(msg, did1, did2)); } catch(err) { caught = err; }

      expect(caught).to.be.instanceOf(HttpTransportError);
      expect((caught as HttpTransportError).type).to.equal('SEND_MESSAGE_HTTP');
      expect((caught as HttpTransportError).data).to.deep.include({ status: 500, body: 'x'.repeat(256) });
      expect(cancelled).to.equal(true);
      expect(pulls).to.be.below(20);
    });

    it('throws on unknown sender', async () => {
      client = makeClient();
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      try {
        await client.sendMessage(msg, did1, did2);
        expect.fail('should have thrown');
      } catch(err) {
        expect((err as HttpTransportError).type).to.equal('UNKNOWN_SENDER');
      }
    });
  });

  describe('start() SSE subscriptions', () => {
    it('opens broadcast and inbox streams', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      client.start();

      await helper.waitForCall(HTTP_ROUTE.ADVERTS);
      await helper.waitForCall(`/v1/actors/${encodeURIComponent(did1)}/inbox`);

      const inboxCall = helper.calls.find((c) => c.url.pathname === `/v1/actors/${encodeURIComponent(did1)}/inbox`);
      expect(inboxCall?.headers.authorization?.startsWith('BTCR2-Sig ')).to.be.true;
    });

    it('is idempotent', () => {
      client = makeClient();
      client.start();
      client.start(); // should not throw or open duplicate broadcasts
    });

    it('opens inbox for actors registered after start()', async () => {
      client = makeClient();
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      client.registerActor(did1, keys1);
      await helper.waitForCall(`/v1/actors/${encodeURIComponent(did1)}/inbox`);
    });
  });

  describe('broadcast dispatch', () => {
    it('delivers a valid advert to a registered handler', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);

      const received = new Promise<Record<string, unknown>>((resolve) => {
        client.registerMessageHandler(did1, COHORT_ADVERT, (msg) => resolve(msg));
      });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      // Service is did2 broadcasting to all actors.
      const advert = new BaseMessage({
        type : COHORT_ADVERT,
        from : did2,
        body : { cohortId: 'c1' },
      });
      const envelope = signEnvelope(advert, { did: did2, keys: keys2 });
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(envelope));

      const delivered = await received;
      expect(delivered.type).to.equal(COHORT_ADVERT);
      expect(delivered.cohortId).to.equal('c1'); // body flattened
    });

    it('keeps the outer body: the participant records the authenticated key, not the key in body.body', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      const received: Array<Record<string, unknown>> = [];
      client.registerMessageHandler(did1, COHORT_ADVERT, (msg) => { received.push(msg); });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      const advertBody = (communicationPk: Uint8Array): Record<string, unknown> => ({
        cohortId         : 'c1',
        network          : 'mutinynet',
        communicationPk,
        beaconType       : 'SMTBeacon',
        minParticipants  : 2,
        recoveryKey      : 'a'.repeat(64),
        recoverySequence : 144,
      });
      const other = SchnorrKeyPair.generate().publicKey.compressed;
      const advert = new BaseMessage({
        type : COHORT_ADVERT,
        from : did2,
        body : { ...advertBody(keys2.publicKey.compressed), body: advertBody(other) } as unknown as BaseBody,
      });
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(signEnvelope(advert, { did: did2, keys: keys2 })));
      await waitFor(() => received.length === 1);

      const body = received[0].body as Record<string, unknown>;
      expect(body.communicationPk).to.deep.equal(keys2.publicKey.compressed);
      const participant = new AggregationParticipant({ did: did1, signer: new KeyPairAggregationSigner(keys1) });
      participant.receive(received[0] as unknown as BaseMessage);
      expect(participant.discoveredCohorts.get('c1')?.serviceCommunicationPk).to.deep.equal(keys2.publicKey.compressed);
    });

    it('drops broadcasts whose signature is invalid', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);

      let delivered = false;
      client.registerMessageHandler(did1, COHORT_ADVERT, () => { delivered = true; });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(advert, { did: did2, keys: keys2 });
      // Tamper with signature
      envelope.sig = envelope.sig.replace(/^../, '00');
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(envelope));

      // Give the dispatcher a chance to process.
      await new Promise((r) => setTimeout(r, 30));
      expect(delivered).to.be.false;
    });
  });

  describe('inbox dispatch', () => {
    it('delivers a directed message to the addressed actor', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);

      const received = new Promise<Record<string, unknown>>((resolve) => {
        client.registerMessageHandler(did1, COHORT_READY, (msg) => resolve(msg));
      });
      client.start();
      const inboxPath = `/v1/actors/${encodeURIComponent(did1)}/inbox`;
      await helper.waitForCall(inboxPath);

      // Service did2 sends to did1 (the actor).
      const msg = new BaseMessage({
        type : COHORT_READY,
        from : did2,
        to   : did1,
        body : { cohortId: 'c1' },
      });
      const envelope = signEnvelope(msg, { did: did2, keys: keys2 }, { to: did1 });
      helper.pushEvent(inboxPath, SSE_EVENT.MESSAGE, JSON.stringify(envelope));

      const delivered = await received;
      expect(delivered.type).to.equal(COHORT_READY);
      expect(delivered.to).to.equal(did1);
    });

    it('drops inbox messages addressed to a different DID', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);

      let delivered = false;
      client.registerMessageHandler(did1, COHORT_READY, () => { delivered = true; });
      client.start();
      const inboxPath = `/v1/actors/${encodeURIComponent(did1)}/inbox`;
      await helper.waitForCall(inboxPath);

      const wrongRecipient = DidBtcr2.create(
        SchnorrKeyPair.generate().publicKey.compressed,
        { idType: 'KEY', network: 'mutinynet' },
      );
      const msg = new BaseMessage({ type: COHORT_READY, from: did2, to: wrongRecipient, body: { cohortId: 'c1' } });
      const envelope = signEnvelope(msg, { did: did2, keys: keys2 }, { to: wrongRecipient });
      helper.pushEvent(inboxPath, SSE_EVENT.MESSAGE, JSON.stringify(envelope));

      await new Promise((r) => setTimeout(r, 30));
      expect(delivered).to.be.false;
    });
  });

  describe('unregisterActor', () => {
    it('aborts the inbox subscription', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      client.start();
      const inboxPath = `/v1/actors/${encodeURIComponent(did1)}/inbox`;
      await helper.waitForCall(inboxPath);

      const countBefore = helper.calls.length;
      client.unregisterActor(did1);

      // Reconnect backoff is 0, so if the abort didn't stick, we'd see repeated inbox calls.
      await new Promise((r) => setTimeout(r, 30));
      const inboxCallsAfter = helper.calls.filter((c) => c.url.pathname === inboxPath).length;
      const inboxCallsBefore = helper.calls.slice(0, countBefore).filter((c) => c.url.pathname === inboxPath).length;
      expect(inboxCallsAfter).to.equal(inboxCallsBefore);
    });
  });

  describe('publishRepeating', () => {
    it('fires the first send eagerly and repeats on interval; stop halts further sends', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);

      const msg = new BaseMessage({ type: COHORT_ADVERT, from: did1, body: { cohortId: 'c1' } });
      const stop = client.publishRepeating(msg, did1, 15);

      await new Promise((r) => setTimeout(r, 60));
      stop();
      const countAtStop = helper.calls.filter((c) => c.method === 'POST').length;

      await new Promise((r) => setTimeout(r, 40));
      const countLater = helper.calls.filter((c) => c.method === 'POST').length;

      expect(countAtStop).to.be.greaterThan(1);   // eager fire + at least one interval
      expect(countLater).to.equal(countAtStop);   // no sends after stop()
    });
  });

  describe('base URL', () => {
    const make = (baseUrl: unknown, allowInsecureHttp?: unknown): HttpClientTransport =>
      new HttpClientTransport({
        baseUrl   : baseUrl as string,
        fetchImpl : helper.fetch,
        logger    : SILENT_LOGGER,
        ...(allowInsecureHttp === undefined ? {} : { allowInsecureHttp: allowInsecureHttp as boolean }),
      });

    const expectRefusal = (fn: () => unknown, type: string): HttpTransportError => {
      let caught: unknown;
      try { fn(); } catch(err) { caught = err; }
      expect(caught).to.be.instanceOf(HttpTransportError);
      expect((caught as HttpTransportError).type).to.equal(type);
      return caught as HttpTransportError;
    };

    for(const value of ['not a url', 'ftp://svc.example/', 'ws://svc.example/', 'file:///tmp/x', 'http://[']) {
      it(`refuses ${value} with INVALID_BASE_URL`, () => {
        expectRefusal(() => make(value), 'INVALID_BASE_URL');
      });
    }

    const notStringOrUrl: Array<[string, unknown]> = [
      ['a number', 42],
      ['null', null],
      ['undefined', undefined],
      ['an object with an href that is not a URL', { href: 'https://svc.example/' }],
    ];
    for(const [label, value] of notStringOrUrl) {
      it(`refuses ${label} with INVALID_BASE_URL`, () => {
        expectRefusal(() => make(value), 'INVALID_BASE_URL');
      });
    }

    it('gives the protocol in the data of INVALID_BASE_URL', () => {
      const err = expectRefusal(() => make('ftp://svc.example/'), 'INVALID_BASE_URL');
      expect(err.data).to.deep.include({ protocol: 'ftp:' });
    });

    for(const value of ['ftp://svc.example/', 'ws://svc.example/']) {
      it(`refuses ${value} with INVALID_BASE_URL also if allowInsecureHttp is true`, () => {
        expectRefusal(() => make(value, true), 'INVALID_BASE_URL');
      });
    }

    for(const value of [
      'https://alice:secret@svc.example/',
      'https://alice@svc.example/',
      'https://:secret@svc.example/',
      'http://alice:secret@127.0.0.1/',
      'http://alice:secret@svc.example/path',
    ]) {
      it(`refuses ${value} with INVALID_BASE_URL, and the error holds no credentials`, () => {
        const err = expectRefusal(() => make(value), 'INVALID_BASE_URL');
        expect(JSON.stringify(err.data ?? {})).to.not.include('secret').and.not.include('alice');
        expect(err.message).to.not.include('secret').and.not.include('alice');
      });
    }

    it('refuses a URL object with credentials, also if allowInsecureHttp is true', () => {
      expectRefusal(() => make(new URL('https://alice:secret@svc.example/'), true), 'INVALID_BASE_URL');
    });

    for(const value of [
      'http://svc.example/',
      'http://128.0.0.1/',
      'http://0.0.0.0/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::2]/',
      'http://[::]/',
      'http://[::1:2]/',
      'http://[::10]/',
      'http://localhost.example/',
      'http://xlocalhost/',
      'http://127.0.0.1.nip.io/',
    ]) {
      it(`refuses ${value} with INSECURE_BASE_URL`, () => {
        expectRefusal(() => make(value), 'INSECURE_BASE_URL');
      });
    }

    it('refuses plain http if allowInsecureHttp is the string true, not the boolean', () => {
      expectRefusal(() => make('http://svc.example/', 'true'), 'INSECURE_BASE_URL');
    });

    it('gives only the host name in the data of INSECURE_BASE_URL', () => {
      const err = expectRefusal(() => make('http://svc.example:8080/path?q=1'), 'INSECURE_BASE_URL');
      expect(err.data).to.deep.include({ hostname: 'svc.example' });
      expect(JSON.stringify(err.data)).to.not.include('8080').and.not.include('path');
    });

    for(const value of [
      'https://svc.example/',
      'http://localhost:8080/',
      'http://LOCALHOST/',
      'http://localhost./',
      'http://app.localhost/',
      'http://app.localhost./',
      'http://127.0.0.1/',
      'http://127.255.255.254:9/',
      'http://127.1/',
      'http://0x7f000001/',
      'http://[::1]:3000/',
      'http://[0:0:0:0:0:0:0:1]/',
    ]) {
      it(`accepts ${value}`, () => {
        expect(() => make(value)).to.not.throw();
      });
    }

    it('accepts a URL object', () => {
      expect(() => make(new URL('http://127.0.0.1:8080/'))).to.not.throw();
    });

    it('copies a URL object: the trailing slash rule does not change the URL of the caller', () => {
      const baseUrl = new URL('https://svc.example/agg');
      client = make(baseUrl);
      expect(baseUrl.href).to.equal('https://svc.example/agg');
    });

    it('accepts plain http on any host if allowInsecureHttp is true', () => {
      expect(() => make('http://svc.example/', true)).to.not.throw();
    });

    it('adds a trailing slash to the base path, for a string and for a URL object', async () => {
      for(const baseUrl of ['https://svc.example/agg', new URL('https://svc.example/agg')]) {
        helper = makeMockFetch();
        client = make(baseUrl);
        client.registerActor(did1, keys1);
        const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
        await client.sendMessage(msg, did1, did2);
        expect(helper.calls[0].url.pathname).to.equal(`/agg${HTTP_ROUTE.MESSAGES}`);
      }
    });

    it('TransportFactory refuses plain http on a host that is not a loopback host', () => {
      expectRefusal(
        () => TransportFactory.establish({ type: 'http', role: 'client', baseUrl: 'http://svc.example/' }),
        'INSECURE_BASE_URL',
      );
    });

    it('TransportFactory accepts plain http if allowInsecureHttp is true', () => {
      const transport = TransportFactory.establish({
        type              : 'http',
        role              : 'client',
        baseUrl           : 'http://svc.example/',
        allowInsecureHttp : true,
        logger            : SILENT_LOGGER,
      });
      expect(transport).to.be.instanceOf(HttpClientTransport);
    });
  });

  describe('redirects', () => {
    it('sets redirect: manual on the POST, the broadcast GET, and the inbox GET', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      client.start();
      const inboxPath = inboxPathOf(did1);
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);
      await helper.waitForCall(inboxPath);
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      await client.sendMessage(msg, did1, did2);

      const post      = helper.calls.find((c) => c.method === 'POST');
      const broadcast = helper.calls.find((c) => c.url.pathname === HTTP_ROUTE.ADVERTS);
      const inbox     = helper.calls.find((c) => c.url.pathname === inboxPath);
      expect(post?.redirect).to.equal('manual');
      expect(broadcast?.redirect).to.equal('manual');
      expect(inbox?.redirect).to.equal('manual');
    });

    const redirectAnswers: Array<[string, () => Response, number]> = [
      ['a 307 answer with a Location', () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/v1/messages' } }), 307],
      ['an opaque redirect answer (status 0, no body)', opaqueRedirect, 0],
    ];
    for(const [label, answer, status] of redirectAnswers) {
      it(`sendMessage with ${label}: SEND_MESSAGE_HTTP with data.status ${status}, one fetch call`, async () => {
        const urls: string[] = [];
        client = new HttpClientTransport({
          baseUrl   : 'https://example.com/',
          fetchImpl : async (input) => {
            urls.push(String(input));
            return answer();
          },
          logger : SILENT_LOGGER,
        });
        client.registerActor(did1, keys1);
        const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
        let caught: unknown;
        try { await within(client.sendMessage(msg, did1, did2)); } catch(err) { caught = err; }

        expect(caught).to.be.instanceOf(HttpTransportError);
        expect((caught as HttpTransportError).type).to.equal('SEND_MESSAGE_HTTP');
        expect((caught as HttpTransportError).data).to.deep.include({ status, body: '', messageType: COHORT_OPT_IN });
        expect(urls).to.deep.equal([`https://example.com${HTTP_ROUTE.MESSAGES}`]);
      });
    }

    it('sendMessage passes a fetch rejection (for example a network error) to the caller unchanged', async () => {
      const failure = new TypeError('fetch failed');
      client = new HttpClientTransport({
        baseUrl   : 'https://example.com/',
        fetchImpl : async () => { throw failure; },
        logger    : SILENT_LOGGER,
      });
      client.registerActor(did1, keys1);
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      let caught: unknown;
      try { await client.sendMessage(msg, did1, did2); } catch(err) { caught = err; }
      expect(caught).to.equal(failure);
    });
  });

  describe('redirects with the fetch of Node', () => {
    let httpServer: Server;
    let baseUrl: string;
    /** The path of each request that the server received. */
    let hits: string[];

    beforeEach(async () => {
      hits = [];
      httpServer = createServer((req, res) => {
        const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
        hits.push(path);
        req.resume();
        if(path === '/elsewhere') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end();
          return;
        }
        res.writeHead(307, { location: `${baseUrl}elsewhere` });
        res.end();
      });
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/`;
    });

    afterEach(async () => {
      client?.stop();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    it('sendMessage gets the 307 answer: SEND_MESSAGE_HTTP with data.status 307, no request to the Location', async () => {
      client = new HttpClientTransport({ baseUrl, logger: SILENT_LOGGER });
      client.registerActor(did1, keys1);
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      let caught: unknown;
      try { await within(client.sendMessage(msg, did1, did2), 2000); } catch(err) { caught = err; }

      expect(caught).to.be.instanceOf(HttpTransportError);
      expect((caught as HttpTransportError).type).to.equal('SEND_MESSAGE_HTTP');
      expect((caught as HttpTransportError).data).to.deep.include({ status: 307 });
      expect(hits).to.deep.equal([HTTP_ROUTE.MESSAGES]);
    });

    it('both SSE loops get the 307 answer: logger.warn, the attempt increments, no request to the Location', async () => {
      const logs = makeRecordingLogger();
      const attempts: number[] = [];
      client = new HttpClientTransport({
        baseUrl,
        logger           : logs.logger,
        reconnectBackoff : (attempt) => {
          attempts.push(attempt);
          return 5;
        },
      });
      client.registerActor(did1, keys1);
      client.start();

      const count = (path: string): number => hits.filter((p) => p === path).length;
      await waitFor(() => count(HTTP_ROUTE.ADVERTS) >= 2 && count(inboxPathOf(did1)) >= 2, 2000);
      client.stop();

      expect(count('/elsewhere')).to.equal(0);
      expect(attempts).to.include(1);
      expect(logs.warns.some(([line]) => String(line).includes('Broadcast subscribe failed: HTTP 307'))).to.equal(true);
      expect(logs.warns.some(([line]) => String(line).includes(`Inbox subscribe failed for ${did1}: HTTP 307`))).to.equal(true);
    });
  });

  describe('default fetch', () => {
    /**
     * A fetch stub that refuses each `this` value other than `undefined` and the global
     * object, as the fetch of a browser does ("Illegal invocation").
     */
    const makeReceiverCheck = (): { fetch: typeof fetch; receivers: unknown[] } => {
      const receivers: unknown[] = [];
      const fetchImpl = function(this: unknown): Promise<Response> {
        receivers.push(this);
        if(this !== undefined && this !== globalThis) return Promise.reject(new TypeError('Illegal invocation'));
        return Promise.resolve(new Response('', { status: 202 }));
      };
      return { fetch: fetchImpl as unknown as typeof fetch, receivers };
    };

    const send = async (): Promise<void> => {
      client.registerActor(did1, keys1);
      const msg = new BaseMessage({ type: COHORT_OPT_IN, from: did1, to: did2, body: { cohortId: 'c1' } });
      await client.sendMessage(msg, did1, did2);
    };

    it('calls globalThis.fetch with no transport as this', async () => {
      const original = globalThis.fetch;
      const check = makeReceiverCheck();
      globalThis.fetch = check.fetch;
      try {
        client = new HttpClientTransport({ baseUrl: 'https://example.com/', logger: SILENT_LOGGER });
        await send();
      } finally {
        globalThis.fetch = original;
      }
      expect(check.receivers).to.have.lengthOf(1);
    });

    it('calls a fetchImpl with no transport as this', async () => {
      const check = makeReceiverCheck();
      client = new HttpClientTransport({ baseUrl: 'https://example.com/', fetchImpl: check.fetch, logger: SILENT_LOGGER });
      await send();
      expect(check.receivers).to.have.lengthOf(1);
    });
  });

  describe('reconnect backoff', () => {
    const empty: ScriptStep     = { kind: 'stream', frames: [], end: true };
    const heartbeat: ScriptStep = { kind: 'stream', frames: [': hb\n\n'], end: true };
    // `encode('')` gives one chunk of 0 bytes. It does not count as a received byte.
    const zeroChunk: ScriptStep = { kind: 'stream', frames: [''], end: true };
    const busy: ScriptStep      = { kind: 'status', status: 503 };
    const down: ScriptStep      = { kind: 'reject' };

    for(const loop of ['broadcast', 'inbox'] as const) {
      /** Run the loop through `steps`, then stop the client. Returns the attempt of each backoff call. */
      const run = async (
        steps: ScriptStep[],
        delayMs: number,
        logger: Logger = SILENT_LOGGER,
      ): Promise<{ attempts: number[]; scripted: ScriptedFetch; path: string }> => {
        const path = loop === 'broadcast' ? HTTP_ROUTE.ADVERTS : inboxPathOf(did1);
        const attempts: number[] = [];
        let finish!: () => void;
        const done = new Promise<void>((resolve) => { finish = resolve; });
        const scripted = makeScriptedFetch(path, steps, () => {
          client.stop();
          finish();
        });
        client = new HttpClientTransport({
          baseUrl          : 'https://example.com/',
          fetchImpl        : scripted.fetch,
          logger,
          reconnectBackoff : (attempt) => {
            attempts.push(attempt);
            return delayMs;
          },
          resolveSenderPk : resolveBtcr2SenderPk,
        });
        if(loop === 'inbox') client.registerActor(did1, keys1);
        client.start();
        await within(done);
        await settle(10);
        return { attempts, scripted, path };
      };

      it(`${loop}: empty 200 streams give the attempts 0, 1, 2`, async () => {
        const { attempts, scripted, path } = await run([empty, empty, empty], 1);
        expect(attempts).to.deep.equal([0, 1, 2]);
        expect(scripted.calls.filter((c) => c.path === path)).to.have.lengthOf(4);
      });

      it(`${loop}: a stream with only a heartbeat comment resets the next attempt to 0`, async () => {
        const { attempts } = await run([empty, empty, heartbeat, empty], 0);
        expect(attempts).to.deep.equal([0, 1, 0, 1]);
      });

      it(`${loop}: a stream with only a chunk of 0 bytes increments the attempt`, async () => {
        const { attempts } = await run([empty, zeroChunk, empty], 0);
        expect(attempts).to.deep.equal([0, 1, 2]);
      });

      it(`${loop}: a non-ok answer increments the attempt, and the client cancels its body`, async () => {
        const { attempts, scripted } = await run([busy, busy, empty], 0);
        expect(attempts).to.deep.equal([0, 1, 2]);
        expect(scripted.cancelled()).to.equal(2);
      });

      it(`${loop}: a body cancel that rejects makes no unhandled rejection, and the attempt increments`, async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
        process.on('unhandledRejection', onUnhandled);
        try {
          const busyCancelFails: ScriptStep = { kind: 'status', status: 503, cancelFails: true };
          const { attempts, scripted } = await run([busyCancelFails, empty], 0);
          await settle(10);
          expect(attempts).to.deep.equal([0, 1]);
          expect(scripted.cancelled()).to.equal(1);
          expect(unhandled).to.be.empty;
        } finally {
          process.removeListener('unhandledRejection', onUnhandled);
        }
      });

      it(`${loop}: a fetch rejection increments the attempt`, async () => {
        const { attempts } = await run([down, down, empty], 1);
        expect(attempts).to.deep.equal([0, 1, 2]);
      });

      it(`${loop}: a 307 redirect answer: logger.warn, the body is cancelled, the attempt increments`, async () => {
        const logs = makeRecordingLogger();
        const redirect: ScriptStep = { kind: 'status', status: 307, headers: { location: 'https://example.com/elsewhere' } };
        const { attempts, scripted, path } = await run([redirect, redirect, empty], 0, logs.logger);
        expect(attempts).to.deep.equal([0, 1, 2]);
        expect(scripted.cancelled()).to.equal(2);
        expect(logs.warns).to.have.lengthOf(2);
        expect(String(logs.warns[0][0])).to.include('HTTP 307');
        expect(scripted.calls.filter((c) => c.path === path)).to.have.lengthOf(4);
        expect(scripted.calls.every((c) => c.redirect === 'manual')).to.equal(true);
      });

      it(`${loop}: an opaque redirect answer (status 0, no body): logger.warn, the attempt increments`, async () => {
        const logs = makeRecordingLogger();
        const opaque: ScriptStep = { kind: 'opaque-redirect' };
        const { attempts, scripted, path } = await run([opaque, opaque, empty], 0, logs.logger);
        expect(attempts).to.deep.equal([0, 1, 2]);
        expect(logs.warns).to.have.lengthOf(2);
        expect(String(logs.warns[0][0])).to.include('HTTP 0');
        expect(scripted.calls.filter((c) => c.path === path)).to.have.lengthOf(4);
      });
    }
  });

  describe('Last-Event-ID', () => {
    const ready = (cohortId: string): string => JSON.stringify(signEnvelope(
      new BaseMessage({ type: COHORT_READY, from: did2, to: did1, body: { cohortId } }),
      { did: did2, keys: keys2 },
      { to: did1 },
    ));
    const badSig = (cohortId: string): string => {
      const envelope = JSON.parse(ready(cohortId)) as SignedEnvelope;
      envelope.sig = (envelope.sig.startsWith('00') ? '11' : '00') + envelope.sig.slice(2);
      return JSON.stringify(envelope);
    };
    // A backoff of 1 ms lets timers run between attempts. If each reconnect fails, the
    // test then fails at its timeout and does not hold the event loop.
    const makeScriptedClient = (scripted: ScriptedFetch, logger: Logger = SILENT_LOGGER): HttpClientTransport => new HttpClientTransport({
      baseUrl          : 'https://example.com/',
      fetchImpl        : scripted.fetch,
      logger,
      reconnectBackoff : () => 1,
      resolveSenderPk  : resolveBtcr2SenderPk,
    });

    it('sends the id of the last inbox event at each reconnect, and keeps it across stop() and start()', async () => {
      const inboxPath = inboxPathOf(did1);
      const m = SSE_EVENT.MESSAGE;
      const longId = 'z'.repeat(256);
      const scripted = makeScriptedFetch(inboxPath, [
        // The id of an event that fails verify counts. An event with no id keeps the value.
        { kind: 'stream', frames: [sseFrame(m, ready('c1'), 'e-1'), sseFrame(m, badSig('c2'), 'e-2'), sseFrame(m, ready('c1b'))], end: true },
        // An empty id clears the value.
        { kind: 'stream', frames: [sseFrame(m, ready('c3'), '')], end: true },
        // The id of an event with another name counts.
        { kind: 'stream', frames: [sseFrame('other', 'x', 'o-1')], end: true },
        // An id with a character outside 0x21 to 0x7E does not change the value.
        { kind: 'stream', frames: [sseFrame(m, ready('c4'), 'b c'), sseFrame(m, ready('c5'), 'x€'), sseFrame(m, ready('c6'), 'xé')], end: true },
        // An id of 257 characters does not change the value.
        { kind: 'stream', frames: [sseFrame(m, ready('c7'), 'y'.repeat(257))], end: true },
        // An id of 256 characters replaces the value.
        { kind: 'stream', frames: [sseFrame(m, ready('c8'), longId)], end: true },
      ]);
      client = makeScriptedClient(scripted);
      client.registerActor(did1, keys1);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_READY, (msg) => { received.push(msg.cohortId); });
      client.start();

      const inboxGets = (): ScriptCall[] => scripted.calls.filter((c) => c.path === inboxPath);
      await waitFor(() => inboxGets().length === 7);
      expect(inboxGets().map((c) => c.headers['last-event-id']))
        .to.deep.equal([undefined, 'e-2', undefined, 'o-1', 'o-1', 'o-1', longId]);
      expect(received).to.deep.equal(['c1', 'c1b', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);

      client.stop();
      client.start();
      await waitFor(() => inboxGets().length === 8);
      expect(inboxGets()[7].headers['last-event-id']).to.equal(longId);
    });

    it('does not record the id of an event that a stream end cuts', async () => {
      const inboxPath = inboxPathOf(did1);
      const m = SSE_EVENT.MESSAGE;
      const scripted = makeScriptedFetch(inboxPath, [
        // The server writes the id line first. The body ends cleanly in the data line.
        { kind: 'stream', frames: [`id: e-5\nevent: ${m}\ndata: ${ready('c0').slice(0, 40)}`], end: true },
        { kind: 'stream', frames: [sseFrame(m, ready('c1'), 'e-1'), `id: e-6\nevent: ${m}\ndata: {"v":1`], end: true },
      ]);
      client = makeScriptedClient(scripted);
      client.registerActor(did1, keys1);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_READY, (msg) => { received.push(msg.cohortId); });
      client.start();

      const inboxGets = (): ScriptCall[] => scripted.calls.filter((c) => c.path === inboxPath);
      await waitFor(() => inboxGets().length === 3);
      expect(inboxGets().map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, undefined, 'e-1']);
      expect(received).to.deep.equal(['c1']);
    });

    it('records the id before the dispatch: an event that hits the unexpected-error path still counts', async () => {
      const inboxPath = inboxPathOf(did1);
      const scripted = makeScriptedFetch(inboxPath, [
        { kind: 'stream', frames: [sseFrame(SSE_EVENT.MESSAGE, 'null', 'u-1')], end: true },
      ]);
      // A logger.debug that throws makes the drop of a malformed event throw.
      const logs = makeRecordingLogger();
      client = makeScriptedClient(scripted, { ...logs.logger, debug: () => { throw new Error('logger down'); } });
      client.registerActor(did1, keys1);
      client.start();

      const inboxGets = (): ScriptCall[] => scripted.calls.filter((c) => c.path === inboxPath);
      await waitFor(() => inboxGets().length === 2);
      expect(inboxGets()[1].headers['last-event-id']).to.equal('u-1');
      expect(logs.errors).to.have.lengthOf(1);
    });

    it('the broadcast GET sends no last-event-id, also after an advert with an id', async () => {
      const advert = JSON.stringify(signEnvelope(
        new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId: 'c1' } }),
        { did: did2, keys: keys2 },
      ));
      const scripted = makeScriptedFetch(HTTP_ROUTE.ADVERTS, [
        { kind: 'stream', frames: [sseFrame(SSE_EVENT.ADVERT, advert, 'a-1')], end: true },
      ]);
      client = makeScriptedClient(scripted);
      client.registerActor(did1, keys1);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_ADVERT, (msg) => { received.push(msg.cohortId); });
      client.start();

      const broadcastGets = (): ScriptCall[] => scripted.calls.filter((c) => c.path === HTTP_ROUTE.ADVERTS);
      await waitFor(() => broadcastGets().length === 2);
      expect(received).to.deep.equal(['c1']);
      expect(broadcastGets().map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, undefined]);
    });

    it('a new registerActor starts with no id', async () => {
      const inboxPath = inboxPathOf(did1);
      const scripted = makeScriptedFetch(inboxPath, [
        { kind: 'stream', frames: [sseFrame(SSE_EVENT.MESSAGE, ready('c1'), 'e-1')], end: false },
      ]);
      client = makeScriptedClient(scripted);
      client.registerActor(did1, keys1);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_READY, (msg) => { received.push(msg.cohortId); });
      client.start();
      await waitFor(() => received.length === 1);

      client.registerActor(did1, keys1);
      const inboxGets = (): ScriptCall[] => scripted.calls.filter((c) => c.path === inboxPath);
      await waitFor(() => inboxGets().length === 2);
      expect(inboxGets()[1].headers['last-event-id']).to.equal(undefined);
    });

    it('keeps the id per actor: the inbox GET of another actor sends no id of the first actor', async () => {
      const inboxPath = inboxPathOf(did1);
      const keys3 = SchnorrKeyPair.generate();
      const did3  = DidBtcr2.create(keys3.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const scripted = makeScriptedFetch(inboxPath, [
        { kind: 'stream', frames: [sseFrame(SSE_EVENT.MESSAGE, ready('c1'), 'e-1')], end: false },
      ]);
      client = makeScriptedClient(scripted);
      client.registerActor(did1, keys1);
      client.registerActor(did3, keys3);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_READY, (msg) => { received.push(msg.cohortId); });
      client.start();
      await waitFor(() => received.length === 1);

      client.stop();
      client.start();
      const getsOf = (path: string): ScriptCall[] => scripted.calls.filter((c) => c.path === path);
      await waitFor(() => getsOf(inboxPath).length === 2 && getsOf(inboxPathOf(did3)).length === 2);
      expect(getsOf(inboxPath).map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, 'e-1']);
      expect(getsOf(inboxPathOf(did3)).map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, undefined]);
    });
  });

  describe('SSE event size limit', () => {
    const LIMIT = 4096;
    /** An SSE frame whose data line alone is larger than LIMIT bytes. */
    const oversize = (event: string, id: string): string => sseFrame(event, 'x'.repeat(2 * LIMIT), id);

    it('the package index exports RECOMMENDED_MAX_SSE_EVENT_BYTES = 1048576 (1 MiB)', () => {
      expect(RECOMMENDED_MAX_SSE_EVENT_BYTES).to.equal(1_048_576);
    });

    for(const loop of ['inbox', 'broadcast'] as const) {
      const pathOf = (): string => (loop === 'inbox' ? inboxPathOf(did1) : HTTP_ROUTE.ADVERTS);
      const event  = loop === 'inbox' ? SSE_EVENT.MESSAGE : SSE_EVENT.ADVERT;
      const type   = loop === 'inbox' ? COHORT_READY : COHORT_ADVERT;
      /** A valid envelope from did2 for the stream of the loop. `pad` makes the event larger. */
      const valid = (cohortId: string, pad?: string): string => {
        const body = { cohortId, ...(pad !== undefined ? { pad } : {}) };
        return loop === 'inbox'
          ? JSON.stringify(signEnvelope(new BaseMessage({ type, from: did2, to: did1, body }), { did: did2, keys: keys2 }, { to: did1 }))
          : JSON.stringify(signEnvelope(new BaseMessage({ type, from: did2, body }), { did: did2, keys: keys2 }));
      };

      it(`${loop}: an event above maxSseEventBytes: logger.warn, the stream is cancelled, no attempt reset, the next attempt dispatches`, async () => {
        const logs = makeRecordingLogger();
        const attempts: number[] = [];
        const scripted = makeScriptedFetch(pathOf(), [
          // Each attempt receives bytes: a valid event, then an event above the limit.
          { kind: 'stream', frames: [sseFrame(event, valid('c1'), 'e-1'), oversize(event, 'e-2')], end: false },
          { kind: 'stream', frames: [oversize(event, 'e-3')], end: false },
          { kind: 'stream', frames: [sseFrame(event, valid('c2'))], end: false },
        ]);
        client = new HttpClientTransport({
          baseUrl          : 'https://example.com/',
          fetchImpl        : scripted.fetch,
          logger           : logs.logger,
          maxSseEventBytes : LIMIT,
          reconnectBackoff : (attempt) => {
            attempts.push(attempt);
            return 1;
          },
          resolveSenderPk : resolveBtcr2SenderPk,
        });
        client.registerActor(did1, keys1);
        const received: unknown[] = [];
        client.registerMessageHandler(did1, type, (msg) => { received.push(msg.cohortId); });
        client.start();

        await waitFor(() => received.length === 2);
        await settle(10);
        expect(received).to.deep.equal(['c1', 'c2']);
        // An attempt with an event above the limit counts as failed, also if bytes arrived.
        expect(attempts).to.deep.equal([0, 1]);
        // The streams of the two attempts with an event above the limit, and no other stream.
        expect(scripted.streamsCancelled()).to.equal(2);
        const gets = scripted.calls.filter((c) => c.path === pathOf());
        expect(gets).to.have.lengthOf(3);
        expect(logs.warns).to.have.lengthOf(2);
        for(const [line] of logs.warns) {
          expect(String(line)).to.include(String(LIMIT));
          if(loop === 'inbox') expect(String(line)).to.include(did1);
          expect(String(line).includes('skips the event')).to.equal(loop === 'inbox');
        }
        expect(logs.errors).to.be.empty;
        if(loop === 'inbox') {
          // The parser gives the id of each refused event, so the next GET resumes after it.
          expect(gets.map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, 'e-2', 'e-3']);
        } else {
          // The broadcast loop sends no id.
          expect(gets.map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, undefined, undefined]);
        }
      });

      if(loop === 'inbox') {
        /** Label, id of the refused event, the Last-Event-ID of the next GET, and `true` if the client skips the event. */
        const idCases: Array<[string, string | undefined, string | undefined, boolean]> = [
          ['an id', 'e-2', 'e-2', true],
          ['no id', undefined, 'e-1', false],
          ['an empty id', '', undefined, false],
          ['an id that the client ignores', 'e 2', 'e-1', false],
          ['the id of the event before', 'e-1', 'e-1', false],
        ];
        for(const [label, id, resumeId, skips] of idCases) {
          const outcome = skips ? 'the warn line says that the client skips the event' : 'the warn line does not say skip';
          it(`inbox: an event above maxSseEventBytes with ${label}: the next GET sends ${resumeId ?? 'no id'}, ${outcome}`, async () => {
            const logs = makeRecordingLogger();
            const scripted = makeScriptedFetch(pathOf(), [
              { kind: 'stream', frames: [sseFrame(event, valid('c1'), 'e-1'), sseFrame(event, 'x'.repeat(2 * LIMIT), id)], end: false },
              { kind: 'stream', frames: [sseFrame(event, valid('c2'), 'e-3')], end: false },
            ]);
            client = new HttpClientTransport({
              baseUrl          : 'https://example.com/',
              fetchImpl        : scripted.fetch,
              logger           : logs.logger,
              maxSseEventBytes : LIMIT,
              reconnectBackoff : () => 1,
              resolveSenderPk  : resolveBtcr2SenderPk,
            });
            client.registerActor(did1, keys1);
            const received: unknown[] = [];
            client.registerMessageHandler(did1, type, (msg) => { received.push(msg.cohortId); });
            client.start();

            await waitFor(() => received.length === 2);
            await settle(10);
            expect(received).to.deep.equal(['c1', 'c2']);
            const gets = scripted.calls.filter((c) => c.path === pathOf());
            expect(gets.map((c) => c.headers['last-event-id'])).to.deep.equal([undefined, resumeId]);
            expect(logs.warns).to.have.lengthOf(1);
            expect(String(logs.warns[0][0]).includes('skips the event')).to.equal(skips);
            expect(logs.errors).to.be.empty;
          });
        }
      }

      it(`${loop}: with no maxSseEventBytes, an event of 2 MiB is dispatched`, async function() {
        this.timeout(10_000);
        const scripted = makeScriptedFetch(pathOf(), [
          { kind: 'stream', frames: [sseFrame(event, valid('big', 'x'.repeat(2 * 1024 * 1024)))], end: false },
        ]);
        client = new HttpClientTransport({
          baseUrl          : 'https://example.com/',
          fetchImpl        : scripted.fetch,
          logger           : SILENT_LOGGER,
          reconnectBackoff : () => 1,
          resolveSenderPk  : resolveBtcr2SenderPk,
        });
        client.registerActor(did1, keys1);
        const received: unknown[] = [];
        client.registerMessageHandler(did1, type, (msg) => { received.push(msg.cohortId); });
        client.start();

        await waitFor(() => received.length === 1, 5000);
        expect(received).to.deep.equal(['big']);
        expect(scripted.streamsCancelled()).to.equal(0);
        expect(scripted.calls.filter((c) => c.path === pathOf())).to.have.lengthOf(1);
      });
    }
  });

  describe('handler failures', () => {
    let unhandled: unknown[];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

    beforeEach(() => {
      unhandled = [];
      process.on('unhandledRejection', onUnhandled);
    });

    afterEach(() => {
      process.removeListener('unhandledRejection', onUnhandled);
    });

    const makeLoggedClient = (logger: Logger): HttpClientTransport => new HttpClientTransport({
      baseUrl          : 'https://example.com/',
      fetchImpl        : helper.fetch,
      logger,
      reconnectBackoff : () => 0,
      resolveSenderPk  : resolveBtcr2SenderPk,
    });

    const failingHandlers: Array<[string, () => unknown]> = [
      ['rejects', async (): Promise<void> => { throw new Error('async handler failure'); }],
      ['throws', (): void => { throw new Error('sync handler failure'); }],
    ];
    for(const [label, failing] of failingHandlers) {
      it(`a broadcast handler that ${label}: logger.warn, the next handler runs, one GET`, async () => {
        const logs = makeRecordingLogger();
        client = makeLoggedClient(logs.logger);
        const keys3 = SchnorrKeyPair.generate();
        const did3  = DidBtcr2.create(keys3.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
        client.registerActor(did1, keys1);
        client.registerActor(did3, keys3);
        client.registerMessageHandler(did1, COHORT_ADVERT, failing);
        const received: unknown[] = [];
        client.registerMessageHandler(did3, COHORT_ADVERT, (msg) => { received.push(msg.cohortId); });
        client.start();
        await helper.waitForCall(HTTP_ROUTE.ADVERTS);

        const advert = new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId: 'c1' } });
        helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(signEnvelope(advert, { did: did2, keys: keys2 })));
        await waitFor(() => logs.warns.length === 1);
        await settle(20);

        expect(received).to.deep.equal(['c1']);
        expect(logs.warns).to.have.lengthOf(1);
        expect(String(logs.warns[0][0])).to.include(COHORT_ADVERT).and.include(did2);
        expect(logs.errors).to.be.empty;
        expect(unhandled).to.be.empty;
        expect(helper.calls.filter((c) => c.url.pathname === HTTP_ROUTE.ADVERTS)).to.have.lengthOf(1);
      });
    }

    it('calls each broadcast handler at once: the warn line of a synchronous throw comes before the handler of the next actor', async () => {
      // A call in a later microtask makes the throw a rejection, and its warn line then
      // comes after the handler of the next actor.
      const order: string[] = [];
      client = makeLoggedClient({ ...SILENT_LOGGER, warn: () => { order.push('warn'); } });
      const keys3 = SchnorrKeyPair.generate();
      const did3  = DidBtcr2.create(keys3.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      client.registerActor(did1, keys1);
      client.registerActor(did3, keys3);
      client.registerMessageHandler(did1, COHORT_ADVERT, () => {
        order.push('throw');
        throw new Error('sync handler failure');
      });
      client.registerMessageHandler(did3, COHORT_ADVERT, () => { order.push('next'); });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId: 'c1' } });
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(signEnvelope(advert, { did: did2, keys: keys2 })));
      await waitFor(() => order.length === 3);
      await settle(10);
      expect(order).to.deep.equal(['throw', 'warn', 'next']);
      expect(unhandled).to.be.empty;
    });

    it('a broadcast handler that never settles does not hold the next event', async () => {
      client = makeLoggedClient(SILENT_LOGGER);
      client.registerActor(did1, keys1);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_ADVERT, (msg) => {
        received.push(msg.cohortId);
        return new Promise<void>(() => {});
      });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      for(const cohortId of ['c1', 'c2']) {
        const advert = new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId } });
        helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(signEnvelope(advert, { did: did2, keys: keys2 })));
      }
      await waitFor(() => received.length === 2);
      expect(received).to.deep.equal(['c1', 'c2']);
    });

    it('a logger.warn that throws for a rejected broadcast handler makes no unhandled rejection', async () => {
      client = makeLoggedClient({ ...SILENT_LOGGER, warn: () => { throw new Error('logger down'); } });
      client.registerActor(did1, keys1);
      client.registerMessageHandler(did1, COHORT_ADVERT, async () => { throw new Error('async handler failure'); });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      const advert = new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId: 'c1' } });
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT, JSON.stringify(signEnvelope(advert, { did: did2, keys: keys2 })));
      await settle(30);
      expect(unhandled).to.be.empty;
      expect(helper.calls.filter((c) => c.url.pathname === HTTP_ROUTE.ADVERTS)).to.have.lengthOf(1);
    });

    it('an inbox handler that rejects: logger.warn, one GET, the next event is dispatched', async () => {
      const logs = makeRecordingLogger();
      client = makeLoggedClient(logs.logger);
      client.registerActor(did1, keys1);
      const calls: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_READY, async (msg) => {
        calls.push(msg.cohortId);
        if(msg.cohortId === 'c1') throw new Error('handler failure');
      });
      client.start();
      const inboxPath = inboxPathOf(did1);
      await helper.waitForCall(inboxPath);

      for(const cohortId of ['c1', 'c2']) {
        const msg = new BaseMessage({ type: COHORT_READY, from: did2, to: did1, body: { cohortId } });
        helper.pushEvent(inboxPath, SSE_EVENT.MESSAGE, JSON.stringify(signEnvelope(msg, { did: did2, keys: keys2 }, { to: did1 })));
      }
      await waitFor(() => calls.length === 2);
      await settle(10);

      expect(calls).to.deep.equal(['c1', 'c2']);
      expect(logs.warns).to.have.lengthOf(1);
      expect(String(logs.warns[0][0])).to.include(COHORT_READY).and.include(did2);
      expect(logs.errors).to.be.empty;
      expect(unhandled).to.be.empty;
      expect(helper.calls.filter((c) => c.url.pathname === inboxPath)).to.have.lengthOf(1);
    });
  });

  describe('broadcast recipient', () => {
    it('drops a broadcast envelope that names a recipient, from a registered peer', async () => {
      client = makeClient();
      client.registerActor(did1, keys1);
      client.registerPeer(did2, keys2.publicKey.compressed);
      const received: unknown[] = [];
      client.registerMessageHandler(did1, COHORT_ADVERT, (msg) => { received.push(msg.cohortId); });
      client.start();
      await helper.waitForCall(HTTP_ROUTE.ADVERTS);

      const advert = (cohortId: string): BaseMessage => new BaseMessage({ type: COHORT_ADVERT, from: did2, body: { cohortId } });
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT,
        JSON.stringify(signEnvelope(advert('relayed'), { did: did2, keys: keys2 }, { to: did1 })));
      helper.pushEvent(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT,
        JSON.stringify(signEnvelope(advert('broadcast'), { did: did2, keys: keys2 })));
      await waitFor(() => received.length === 1);
      await settle(10);
      expect(received).to.deep.equal(['broadcast']);
    });
  });

  describe('sender resolution failure', () => {
    for(const kind of ['broadcast', 'inbox'] as const) {
      it(`${kind}: a resolveSenderPk that throws drops the event with no warn or error line, and the stream stays open`, async () => {
        const logs = makeRecordingLogger();
        client = new HttpClientTransport({
          baseUrl          : 'https://example.com/',
          fetchImpl        : helper.fetch,
          logger           : logs.logger,
          reconnectBackoff : () => 0,
          resolveSenderPk  : () => { throw new Error('resolver down'); },
        });
        client.registerActor(did1, keys1);
        client.registerPeer(did2, keys2.publicKey.compressed);
        const keys3 = SchnorrKeyPair.generate();
        const did3  = DidBtcr2.create(keys3.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

        const type  = kind === 'broadcast' ? COHORT_ADVERT : COHORT_READY;
        const path  = kind === 'broadcast' ? HTTP_ROUTE.ADVERTS : inboxPathOf(did1);
        const event = kind === 'broadcast' ? SSE_EVENT.ADVERT : SSE_EVENT.MESSAGE;
        const envelope = (did: string, keys: SchnorrKeyPair, cohortId: string): string => {
          const to = kind === 'inbox' ? did1 : undefined;
          const msg = new BaseMessage({ type, from: did, ...(to ? { to } : {}), body: { cohortId } });
          return JSON.stringify(signEnvelope(msg, { did, keys }, to ? { to } : {}));
        };

        const received: unknown[] = [];
        client.registerMessageHandler(did1, type, (msg) => { received.push(msg.cohortId); });
        client.start();
        await helper.waitForCall(path);

        helper.pushEvent(path, event, envelope(did3, keys3, 'unresolved'));
        helper.pushEvent(path, event, envelope(did2, keys2, 'peer'));
        await waitFor(() => received.length === 1);
        await settle(10);
        expect(received).to.deep.equal(['peer']);
        expect(helper.calls.filter((c) => c.url.pathname === path)).to.have.lengthOf(1);
        expect(logs.errors).to.be.empty;
        expect(logs.warns).to.be.empty;
      });
    }
  });
});
