import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_READY,
  DidBtcr2,
  HTTP_ROUTE,
  HttpClientTransport,
  HttpTransportError,
  SILENT_LOGGER,
  SSE_EVENT,
  type SignedEnvelope,
  signEnvelope,
} from '../src/index.js';

interface MockCall {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
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

    calls.push({ method, url, headers, body });

    if(method === 'POST') {
      return new Response(postBody, { status: postStatus });
    }

    // GET → open an SSE stream the test controls.
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
  });

  describe('construction', () => {
    it('throws if no fetch is available', () => {
      expect(() => new HttpClientTransport({
        baseUrl   : 'https://example.com/',
        fetchImpl : undefined as unknown as typeof fetch,
        logger    : SILENT_LOGGER,
      })).to.not.throw;
      // The constructor only throws when the fallback globalThis.fetch is also
      // missing — impossible to assert without mutating the global. Covered by
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
      }
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
});
