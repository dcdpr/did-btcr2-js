import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  HttpClientTransport,
  HttpServerTransport,
  SILENT_LOGGER,
} from '../src/index.js';
import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';

import { bridgeClientToServer } from './helpers/http-bridge.js';

describe('HTTP transport parity (client <-> server in-process)', () => {
  let serverKeys:      SchnorrKeyPair;
  let serverDid:       string;
  let participantKeys: SchnorrKeyPair;
  let participantDid:  string;

  let server: HttpServerTransport;
  let client: HttpClientTransport;
  /** Offset of the server clock from the real clock (ms). */
  let offsetMs: number;

  beforeEach(() => {
    offsetMs = 0;
    serverKeys      = SchnorrKeyPair.generate();
    serverDid       = DidBtcr2.create(serverKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    participantKeys = SchnorrKeyPair.generate();
    participantDid  = DidBtcr2.create(participantKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

    server = new HttpServerTransport({
      logger              : SILENT_LOGGER,
      heartbeatIntervalMs : 0,
      advertTtlMs         : 300_000,
      resolveSenderPk     : resolveBtcr2SenderPk,
      now                 : () => Date.now() + offsetMs,
    });
    server.registerActor(serverDid, serverKeys);

    client = new HttpClientTransport({
      baseUrl          : 'https://example.com/',
      fetchImpl        : bridgeClientToServer(server),
      logger           : SILENT_LOGGER,
      reconnectBackoff : () => 0,
      resolveSenderPk  : resolveBtcr2SenderPk,
    });
    client.registerActor(participantDid, participantKeys);
  });

  afterEach(() => {
    client?.stop();
    server?.stop();
  });

  it('client.sendMessage arrives at the server handler', async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      server.registerMessageHandler(serverDid, COHORT_OPT_IN, (m) => resolve(m));
    });

    const msg = new BaseMessage({
      type : COHORT_OPT_IN,
      from : participantDid,
      to   : serverDid,
      body : { cohortId: 'c1', participantPk: participantKeys.publicKey.compressed },
    });
    await client.sendMessage(msg, participantDid, serverDid);

    const delivered = await received;
    expect(delivered.type).to.equal(COHORT_OPT_IN);
    expect(delivered.cohortId).to.equal('c1');
  });

  it('server.sendMessage is delivered to the client inbox handler', async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_OPT_IN_ACCEPT, (m) => resolve(m));
    });
    client.start();

    // Give the client's inbox SSE subscription a moment to land.
    await settle(30);

    const msg = new BaseMessage({
      type : COHORT_OPT_IN_ACCEPT,
      from : serverDid,
      to   : participantDid,
      body : { cohortId: 'c1' },
    });
    await server.sendMessage(msg, serverDid, participantDid);

    const delivered = await received;
    expect(delivered.type).to.equal(COHORT_OPT_IN_ACCEPT);
  });

  it('server.publishRepeating broadcast reaches every connected client', async () => {
    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_ADVERT, (m) => resolve(m));
    });
    client.start();
    await settle(30);

    const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
    server.publishRepeating(advert, serverDid, 60_000);

    const delivered = await received;
    expect(delivered.type).to.equal(COHORT_ADVERT);
  });

  it('client receives messages buffered before it subscribed (Last-Event-ID replay)', async () => {
    // Server sends while the client is NOT yet subscribed - message lands in the buffer.
    const pending = new BaseMessage({
      type : COHORT_READY,
      from : serverDid,
      to   : participantDid,
      body : { cohortId: 'c1' },
    });
    await server.sendMessage(pending, serverDid, participantDid);

    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_READY, (m) => resolve(m));
    });
    client.start();

    const delivered = await received;
    expect(delivered.type).to.equal(COHORT_READY);
  });

  it('round-trips advert -> opt-in -> opt-in-accept across both transports', async () => {
    const advertReceived  = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_ADVERT, (m) => resolve(m));
    });
    const optInReceived   = new Promise<Record<string, unknown>>((resolve) => {
      server.registerMessageHandler(serverDid, COHORT_OPT_IN, (m) => resolve(m));
    });
    const acceptReceived  = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_OPT_IN_ACCEPT, (m) => resolve(m));
    });

    client.start();
    await settle(30);

    // 1. Service advertises a cohort.
    const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
    server.publishRepeating(advert, serverDid, 60_000);

    const gotAdvert = await advertReceived;
    expect(gotAdvert.cohortId).to.equal('c1');

    // 2. Participant opts in.
    const optIn = new BaseMessage({
      type : COHORT_OPT_IN,
      from : participantDid,
      to   : serverDid,
      body : { cohortId: 'c1', participantPk: participantKeys.publicKey.compressed },
    });
    await client.sendMessage(optIn, participantDid, serverDid);

    const gotOptIn = await optInReceived;
    expect(gotOptIn.cohortId).to.equal('c1');

    // 3. Service accepts.
    const accept = new BaseMessage({
      type : COHORT_OPT_IN_ACCEPT,
      from : serverDid,
      to   : participantDid,
      body : { cohortId: 'c1' },
    });
    await server.sendMessage(accept, serverDid, participantDid);

    const gotAccept = await acceptReceived;
    expect(gotAccept.cohortId).to.equal('c1');
  });

  it('dispatches an inbox message once across a server-side stream close; the reconnect sends last-event-id', async () => {
    const inboxPath = `/v1/actors/${encodeURIComponent(participantDid)}/inbox`;
    const bridge = bridgeClientToServer(server);
    const inboxHeaders: Array<Record<string, string>> = [];
    let firstEventId: string | undefined;

    // Record the inbox request headers. Close the first inbox stream on the server side
    // after its first event: the bridge closes the server stream at the abort.
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if(url.pathname !== inboxPath) return bridge(input, init);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
      inboxHeaders.push(headers);
      if(inboxHeaders.length > 1) return bridge(input, init);

      const local = new AbortController();
      init?.signal?.addEventListener('abort', () => local.abort(), { once: true });
      const res = await bridge(input, { ...init, signal: local.signal });
      const decoder = new TextDecoder();
      const body = res.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          const id = /^id: (.*)$/m.exec(decoder.decode(chunk))?.[1];
          if(id !== undefined && firstEventId === undefined) {
            firstEventId = id;
            local.abort();
          }
        },
      }));
      return new Response(body, { status: res.status, headers: res.headers });
    };

    client = new HttpClientTransport({
      baseUrl          : 'https://example.com/',
      fetchImpl,
      logger           : SILENT_LOGGER,
      reconnectBackoff : () => 0,
      resolveSenderPk  : resolveBtcr2SenderPk,
    });
    client.registerActor(participantDid, participantKeys);
    const received: unknown[] = [];
    client.registerMessageHandler(participantDid, COHORT_READY, (m) => { received.push(m.cohortId); });
    client.start();

    const ready = (cohortId: string): BaseMessage =>
      new BaseMessage({ type: COHORT_READY, from: serverDid, to: participantDid, body: { cohortId } });

    await waitFor(() => inboxHeaders.length === 1);
    await server.sendMessage(ready('c1'), serverDid, participantDid);
    await waitFor(() => inboxHeaders.length === 2);
    await server.sendMessage(ready('c2'), serverDid, participantDid);
    await waitFor(() => received.length === 2);
    await settle(20);

    expect(received).to.deep.equal(['c1', 'c2']);
    expect(firstEventId).to.be.a('string');
    expect(inboxHeaders[0]['last-event-id']).to.equal(undefined);
    expect(inboxHeaders[1]['last-event-id']).to.equal(firstEventId);
  });

  it('dispatches a COHORT_READY sent while the server clock was 90 s behind, after the client connects', async () => {
    offsetMs = -90_000;
    const ready = new BaseMessage({ type: COHORT_READY, from: serverDid, to: participantDid, body: { cohortId: 'c1' } });
    await server.sendMessage(ready, serverDid, participantDid);
    offsetMs = 0;

    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_READY, (m) => resolve(m));
    });
    client.start();

    const delivered = await within(received);
    expect(delivered.cohortId).to.equal('c1');
  });

  it('delivers a local advert published at server time T - 120 s (TTL 300 s) to a client that subscribes later', async () => {
    offsetMs = -120_000;
    const advert = new BaseMessage({ type: COHORT_ADVERT, from: serverDid, body: { cohortId: 'c1' } });
    server.publishRepeating(advert, serverDid, 60_000);
    offsetMs = 0;

    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.registerMessageHandler(participantDid, COHORT_ADVERT, (m) => resolve(m));
    });
    client.start();

    const delivered = await within(received);
    expect(delivered.cohortId).to.equal('c1');
  });
});

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll `condition` every 5 ms. Reject after `timeoutMs`. */
async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
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
