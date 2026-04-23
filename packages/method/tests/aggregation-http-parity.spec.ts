import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';

import {
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DidBtcr2,
  HttpClientTransport,
  HttpServerTransport,
  SILENT_LOGGER,
} from '../src/index.js';

import { bridgeClientToServer } from './helpers/http-bridge.js';

describe('HTTP transport parity (client ↔ server in-process)', () => {
  let serverKeys:      SchnorrKeyPair;
  let serverDid:       string;
  let participantKeys: SchnorrKeyPair;
  let participantDid:  string;

  let server: HttpServerTransport;
  let client: HttpClientTransport;

  beforeEach(() => {
    serverKeys      = SchnorrKeyPair.generate();
    serverDid       = DidBtcr2.create(serverKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    participantKeys = SchnorrKeyPair.generate();
    participantDid  = DidBtcr2.create(participantKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

    server = new HttpServerTransport({ logger: SILENT_LOGGER, heartbeatIntervalMs: 0 });
    server.registerActor(serverDid, serverKeys);

    client = new HttpClientTransport({
      baseUrl          : 'https://example.com/',
      fetchImpl        : bridgeClientToServer(server),
      logger           : SILENT_LOGGER,
      reconnectBackoff : () => 0,
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
    // Server sends while the client is NOT yet subscribed — message lands in the buffer.
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

  it('round-trips advert → opt-in → opt-in-accept across both transports', async () => {
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
});

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
