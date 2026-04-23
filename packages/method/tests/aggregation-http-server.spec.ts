import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_READY,
  DidBtcr2,
  HTTP_ENVELOPE_VERSION,
  HTTP_ROUTE,
  HttpServerTransport,
  type HttpRequestLike,
  SILENT_LOGGER,
  SSE_EVENT,
  type SignedEnvelope,
  type SseStream,
  buildRequestAuth,
  signEnvelope,
} from '../src/index.js';

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
      ...overrides,
    });
  }

  describe('handleRequest — basics', () => {
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

  describe('handleSse — broadcast subscription', () => {
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

  describe('handleSse — inbox subscription', () => {
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

      // peerKeys signed for peerDid but hitting otherDid's inbox — should fail because
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

      const sse = makeSseMock();
      const auth = buildRequestAuth(peerDid, peerKeys, inboxPath(peerDid));
      server.handleSse(req('GET', inboxPath(peerDid), { authorization: auth, 'last-event-id': '1' }), sse.stream);

      expect(sse.events).to.have.lengthOf(1);
      const env = JSON.parse(sse.events[0].data) as SignedEnvelope;
      expect((env.message.body as { cohortId: string }).cohortId).to.equal('c2');
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
});
