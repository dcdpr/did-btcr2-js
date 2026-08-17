import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type {
  Btcr2DataIntegrityConfig,
  GenesisDocumentLike,
  SignedBTCR2Update,
  UnsignedBTCR2Update,
} from '@did-btcr2/method';
import { DidBtcr2, GenesisDocument, resolveBtcr2SenderPk } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils';
import { Script, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import type { Event, EventTemplate } from 'nostr-tools';
import { finalizeEvent, nip44 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';

import type { BaseBody, HttpRequestLike } from '../src/index.js';
import {
  AGGREGATED_NONCE,
  AggregationParticipant,
  AggregationParticipantRunner,
  AggregationService,
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  FALLBACK_AUTHORIZATION_REQUEST,
  HTTP_ROUTE,
  HttpClientTransport,
  HttpServerTransport,
  KeyPairAggregationSigner,
  NostrTransport,
  ParticipantCohortPhase,
  SILENT_LOGGER,
  SSE_EVENT,
  ServiceCohortPhase,
  buildFallbackLeaf,
  buildRecoveryLeaves,
  createFallbackAuthorizationRequestMessage,
  signEnvelope,
} from '../src/index.js';

/**
 * Transport sender authentication and inner/outer `from` binding (audit H6).
 *
 * Every message in the protocol declares its own sender DID, and the protocol acts on
 * that claim. Each transport authenticates a *key* (a signed Nostr event, a signed HTTP
 * envelope); these tests pin that the claim is bound to that key on every receive path,
 * and that the participant state machine refuses service-originated messages that do not
 * come from its cohort's service.
 */

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;
const NET = getNetwork('mutinynet');
const VALUE = 100_000n;

const k1Did = (keys: SchnorrKeyPair): string =>
  DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

/** An x1 identity: keys, a genesis whose capabilityInvocation[0] is those keys, and the
 *  x1 DID minted from that genesis (ADR 066). */
function externalIdentity(): { keys: SchnorrKeyPair; did: string; genesisDocument: Record<string, unknown> } {
  const keys = SchnorrKeyPair.generate();
  const genesisDocument: Record<string, unknown> = {
    'id'                 : 'did:btcr2:_',
    '@context'           : ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
    'verificationMethod' : [{
      'id'                 : 'did:btcr2:_#key-0',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:_',
      'publicKeyMultibase' : keys.publicKey.multibase.encoded,
    }],
    'authentication'       : ['did:btcr2:_#key-0'],
    'assertionMethod'      : ['did:btcr2:_#key-0'],
    'capabilityInvocation' : ['did:btcr2:_#key-0'],
    'capabilityDelegation' : ['did:btcr2:_#key-0'],
    'service'              : [{
      'id'              : 'did:btcr2:_#service-0',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:mhME7XiWpho6Ft4pvT3U3h6X8hHtE58ZDJ',
    }],
  };
  const genesisBytes = GenesisDocument.toGenesisBytes(genesisDocument as GenesisDocumentLike);
  return { keys, did: DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network: 'mutinynet' }), genesisDocument };
}

function createSignedUpdate(did: string, keys: SchnorrKeyPair): SignedBTCR2Update {
  const context = [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1',
  ];
  const verificationMethodId = `${did}#initialKey`;
  const unsigned: UnsignedBTCR2Update = {
    '@context'      : context,
    patch           : [ { op: 'add', path: '/service/-', value: { id: `${did}#svc`, type: 'Test', serviceEndpoint: 'https://example.com' } } ],
    sourceHash      : `zQmSourceHash${did.slice(-6)}`,
    targetHash      : `zQmTargetHash${did.slice(-6)}`,
    targetVersionId : 2,
  };
  const config: Btcr2DataIntegrityConfig = {
    '@context'         : context,
    cryptosuite        : 'bip340-jcs-2025',
    type               : 'DataIntegrityProof',
    verificationMethod : verificationMethodId,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
    capabilityAction   : 'Write',
  };
  const multikey = SchnorrMultikey.fromSecretKey(verificationMethodId, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config);
}

// ------------------------------------------------------------------ nostr harness

interface Subscription { filter: Record<string, unknown>; onevent: (event: Event) => unknown }

/**
 * Stand in for the relay pool. `nostr-tools` verifies each event's BIP-340 signature
 * before `onevent` fires (SimplePool passes the real `verifyEvent`), so events reaching
 * the transport always carry an authentic `pubkey`; these tests build them with
 * `finalizeEvent` for the same reason and feed them straight to the subscription the
 * relay filter would have matched.
 */
class RelayHarness {
  readonly subscriptions: Subscription[] = [];
  #subscribeMany?: unknown;
  #publish?: unknown;

  install(): void {
    const proto = SimplePool.prototype as unknown as Record<string, unknown>;
    this.#subscribeMany = proto.subscribeMany;
    this.#publish = proto.publish;
    const subscriptions = this.subscriptions;
    proto.subscribeMany = function(_relays: string[], filter: Record<string, unknown>, handlers: { onevent: (event: Event) => unknown }) {
      subscriptions.push({ filter, onevent: handlers.onevent });
      return { close: (): void => { /* nothing to close */ } };
    };
    proto.publish = function(): Promise<string>[] { return []; };
  }

  restore(): void {
    const proto = SimplePool.prototype as unknown as Record<string, unknown>;
    if(this.#subscribeMany) proto.subscribeMany = this.#subscribeMany;
    if(this.#publish) proto.publish = this.#publish;
    this.subscriptions.length = 0;
  }

  /** Deliver to the broadcast subscription (the one filtering on a `t` tag). */
  broadcast(event: Event): void {
    for(const sub of this.subscriptions) {
      if(sub.filter['#t']) void sub.onevent(event);
    }
  }

  /** Deliver to the directed subscription of the actor whose x-only key is `pkHex`. */
  directed(event: Event, pkHex: string): void {
    for(const sub of this.subscriptions) {
      const p = sub.filter['#p'] as string[] | undefined;
      if(p?.includes(pkHex)) void sub.onevent(event);
    }
  }
}

const wireReplacer = (_key: string, value: unknown): unknown =>
  value instanceof Uint8Array ? { __bytes: bytesToHex(value) } : value;

/** A plaintext (kind 1) aggregation event: `from` is claimed, `signWith` is authentic. */
function plainEvent(type: string, from: string, body: Record<string, unknown>, signWith: SchnorrKeyPair): Event {
  const message = new BaseMessage({ type, from, body: body as BaseBody });
  return finalizeEvent({
    kind       : 1,
    created_at : Math.floor(Date.now() / 1000),
    tags       : [ [ 'p', bytesToHex(signWith.publicKey.x) ], [ 't', type ] ],
    content    : JSON.stringify(message, wireReplacer),
  } as EventTemplate, signWith.secretKey.bytes);
}

/** A NIP-44 encrypted (kind 1059) aggregation event addressed to `recipient`. */
function sealedEvent(
  type: string,
  from: string,
  body: Record<string, unknown>,
  signWith: SchnorrKeyPair,
  recipient: SchnorrKeyPair,
): Event {
  const message = new BaseMessage({ type, from, to: k1Did(recipient), body: body as BaseBody });
  const conversationKey = nip44.v2.utils.getConversationKey(
    signWith.secretKey.bytes,
    bytesToHex(recipient.publicKey.x),
  );
  return finalizeEvent({
    kind       : 1059,
    created_at : Math.floor(Date.now() / 1000),
    tags       : [ [ 'p', bytesToHex(signWith.publicKey.x) ], [ 'p', bytesToHex(recipient.publicKey.x) ], [ 't', type ] ],
    content    : nip44.v2.encrypt(JSON.stringify(message, wireReplacer), conversationKey),
  } as EventTemplate, signWith.secretKey.bytes);
}

const advertBody = (cohortId: string, communicationPk: Uint8Array): Record<string, unknown> => ({
  cohortId,
  network          : 'mutinynet',
  communicationPk,
  beaconType       : 'SMTBeacon',
  minParticipants  : 2,
  recoveryKey      : TEST_RECOVERY_KEY,
  recoverySequence : TEST_RECOVERY_SEQUENCE,
  fundingModel     : 'operator-funded',
});

// ------------------------------------------------------------------- http harness

interface MockSse {
  fetch: typeof fetch;
  push(pathname: string, event: string, data: string): void;
}

function mockSse(): MockSse {
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if((init?.method ?? 'GET').toUpperCase() === 'POST') return new Response('', { status: 202 });
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
    streams.set(url.pathname, ctrl);
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return {
    fetch : fetchImpl,
    push(pathname, event, data) {
      const ctrl = streams.get(pathname);
      if(!ctrl) throw new Error(`No SSE stream open at ${pathname}`);
      ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
    },
  };
}

const settle = (ms = 25): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const req = (method: string, url: string, body?: string): HttpRequestLike =>
  ({ method, url, headers: { 'content-type': 'application/json' }, body });

// ------------------------------------------------- participant state machine harness

/** A one-member cohort driven through both state machines by hand, no transport. */
function soloCohort() {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = k1Did(serviceKeys);
  const memberKeys = SchnorrKeyPair.generate();
  const memberDid = k1Did(memberKeys);
  const outsiderDid = k1Did(SchnorrKeyPair.generate());

  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });
  const member = new AggregationParticipant({ did: memberDid, signer: new KeyPairAggregationSigner(memberKeys) });

  const toMember = (messages: BaseMessage[]): void => messages.forEach(m => member.receive(m));
  const toService = (messages: BaseMessage[]): void => messages.forEach(m => service.receive(m));

  const cohortId = service.createCohort({
    minParticipants  : 1,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  toMember(service.advertise(cohortId));
  toService(member.joinCohort(cohortId));
  toMember(service.acceptParticipant(cohortId, memberDid));

  return { service, member, serviceDid, memberDid, memberKeys, outsiderDid, cohortId, toMember, toService };
}

type SoloCohort = ReturnType<typeof soloCohort>;

/** The real script-tree beacon output script the cohort's address commits to. */
function beaconScript(service: AggregationService, cohortId: string): Uint8Array {
  const cohort = service.getCohort(cohortId)!;
  const leaves = buildRecoveryLeaves('operator-funded', {
    recoveryKey       : cohort.recoveryKey!,
    recoverySequence  : cohort.recoverySequence!,
    cohortKeys        : cohort.cohortKeys,
    fallbackThreshold : cohort.effectiveFallbackThreshold,
  });
  return p2tr(cohort.internalKey, leaves, NET, true).script;
}

/** A well-formed beacon announcement tx: change output, then the signal OP_RETURN. */
function beaconTx(script: Uint8Array, signal: Uint8Array): Transaction {
  const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true });
  tx.addInput({ txid: '22'.repeat(32), index: 0, witnessUtxo: { script, amount: VALUE } });
  tx.addOutput({ script, amount: VALUE - 500n });
  tx.addOutput({ script: Script.encode([ 'RETURN', signal ]), amount: 0n });
  return tx;
}

/** Carry a solo cohort to CohortReady (keygen finalized). */
function readyCohort(): SoloCohort {
  const harness = soloCohort();
  harness.toMember(harness.service.finalizeKeygen(harness.cohortId));
  return harness;
}

/** Carry a solo cohort to NonceSent: the member has validated and contributed its nonce. */
function noncesContributed(): SoloCohort & { script: Uint8Array; tx: Transaction } {
  const harness = readyCohort();
  const { service, member, cohortId, toMember, toService } = harness;
  toService(member.submitUpdate(cohortId, createSignedUpdate(harness.memberDid, harness.memberKeys)));
  toMember(service.buildAndDistribute(cohortId));
  toService(member.approveValidation(cohortId));
  const script = beaconScript(service, cohortId);
  const tx = beaconTx(script, service.getCohort(cohortId)!.signalBytes!);
  toMember(service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] }));
  toService(member.approveNonce(cohortId));
  return { ...harness, script, tx };
}

describe('Transport sender authentication (audit H6)', () => {

  describe('NostrTransport binds message.from to the event signer', () => {
    let relay: RelayHarness;
    let serviceKeys: SchnorrKeyPair;
    let serviceDid: string;
    let attackerKeys: SchnorrKeyPair;
    let aliceKeys: SchnorrKeyPair;
    let aliceDid: string;
    let transport: NostrTransport | undefined;

    const makeTransport = (resolve = true): NostrTransport => {
      transport = new NostrTransport({
        relays          : [ 'wss://relay.invalid' ],
        logger          : SILENT_LOGGER,
        ...(resolve ? { resolveSenderPk: resolveBtcr2SenderPk } : {}),
      });
      return transport;
    };

    beforeEach(() => {
      relay = new RelayHarness();
      relay.install();
      serviceKeys = SchnorrKeyPair.generate();
      serviceDid = k1Did(serviceKeys);
      attackerKeys = SchnorrKeyPair.generate();
      aliceKeys = SchnorrKeyPair.generate();
      aliceDid = k1Did(aliceKeys);
    });

    afterEach(() => {
      transport?.unregisterActor(aliceDid);
      transport = undefined;
      relay.restore();
    });

    /** An actor with a recording handler for `type`, transport already started. */
    const listen = (type: string, resolve = true): { received: Record<string, unknown>[] } => {
      const t = makeTransport(resolve);
      t.registerActor(aliceDid, aliceKeys);
      const received: Record<string, unknown>[] = [];
      t.registerMessageHandler(aliceDid, type, (message: Record<string, unknown>) => { received.push(message); });
      t.start();
      return { received };
    };

    it('drops a broadcast advert signed by a key the claimed service does not control', () => {
      const { received } = listen(COHORT_ADVERT);
      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c1', attackerKeys.publicKey.compressed), attackerKeys));
      expect(received).to.be.empty;
    });

    it('accepts a broadcast advert signed by the service DID it names', () => {
      const { received } = listen(COHORT_ADVERT);
      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c1', serviceKeys.publicKey.compressed), serviceKeys));
      expect(received).to.have.lengthOf(1);
      expect(received[0].from).to.equal(serviceDid);
    });

    it('drops an advert that advertises a key the sender did not authenticate with', () => {
      // The service DID signs the event, so the sender is authentic, but the key the
      // cohort would encrypt to belongs to someone else.
      const { received } = listen(COHORT_ADVERT);
      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c1', attackerKeys.publicKey.compressed), serviceKeys));
      expect(received).to.be.empty;
    });

    it('drops a directed message whose from names a DID that did not sign it', () => {
      const { received } = listen(FALLBACK_AUTHORIZATION_REQUEST);
      relay.directed(
        sealedEvent(FALLBACK_AUTHORIZATION_REQUEST, serviceDid, { cohortId: 'c1', sessionId: 's', pendingTx: 'ff' }, attackerKeys, aliceKeys),
        bytesToHex(aliceKeys.publicKey.x),
      );
      expect(received).to.be.empty;
    });

    it('accepts a directed message the named service actually signed', () => {
      const { received } = listen(FALLBACK_AUTHORIZATION_REQUEST);
      relay.directed(
        sealedEvent(FALLBACK_AUTHORIZATION_REQUEST, serviceDid, { cohortId: 'c1', sessionId: 's', pendingTx: 'ff' }, serviceKeys, aliceKeys),
        bytesToHex(aliceKeys.publicKey.x),
      );
      expect(received).to.have.lengthOf(1);
    });

    it('drops a message whose sender DID resolves to no key', () => {
      // No resolver injected and the sender is not a registered peer: nothing to bind
      // the claim to, so the message is dropped rather than trusted.
      const { received } = listen(COHORT_ADVERT, false);
      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c1', serviceKeys.publicKey.compressed), serviceKeys));
      expect(received).to.be.empty;
    });

    it('authenticates a registered peer with no resolver injected', () => {
      const { received } = listen(COHORT_ADVERT, false);
      transport!.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c1', serviceKeys.publicKey.compressed), serviceKeys));
      expect(received).to.have.lengthOf(1);
    });

    it('drops a message that declares no sender DID', () => {
      const { received } = listen(COHORT_ADVERT);
      const message = { type: COHORT_ADVERT, version: 1, body: advertBody('c1', serviceKeys.publicKey.compressed) };
      relay.broadcast(finalizeEvent({
        kind       : 1,
        created_at : Math.floor(Date.now() / 1000),
        tags       : [ [ 't', COHORT_ADVERT ] ],
        content    : JSON.stringify(message, wireReplacer),
      } as EventTemplate, serviceKeys.secretKey.bytes));
      expect(received).to.be.empty;
    });

    it('drops an opt-in that claims another participant DID (slot squatting)', () => {
      // The service side of the same bind: an opt-in seats a DID into the cohort and
      // registers the key its updates are verified against.
      const victimKeys = SchnorrKeyPair.generate();
      const victimDid = k1Did(victimKeys);
      const t = makeTransport();
      t.registerActor(aliceDid, aliceKeys);
      const received: Record<string, unknown>[] = [];
      t.registerMessageHandler(aliceDid, COHORT_OPT_IN, (message: Record<string, unknown>) => { received.push(message); });
      t.start();

      relay.directed(
        plainEvent(COHORT_OPT_IN, victimDid, {
          cohortId        : 'c1',
          participantPk   : attackerKeys.publicKey.compressed,
          communicationPk : attackerKeys.publicKey.compressed,
        }, attackerKeys),
        bytesToHex(aliceKeys.publicKey.x),
      );
      expect(received).to.be.empty;
    });

    it('authenticates an EXTERNAL (x1) sender from the genesis it carries in-band', () => {
      const external = externalIdentity();
      const t = makeTransport();
      t.registerActor(aliceDid, aliceKeys);
      const received: Record<string, unknown>[] = [];
      t.registerMessageHandler(aliceDid, COHORT_OPT_IN, (message: Record<string, unknown>) => { received.push(message); });
      t.start();

      relay.directed(
        plainEvent(COHORT_OPT_IN, external.did, {
          cohortId        : 'c1',
          participantPk   : external.keys.publicKey.compressed,
          communicationPk : external.keys.publicKey.compressed,
          genesisDocument : external.genesisDocument,
        }, external.keys),
        bytesToHex(aliceKeys.publicKey.x),
      );
      expect(received).to.have.lengthOf(1);
      expect(received[0].from).to.equal(external.did);
    });

    it('drops an x1 opt-in whose genesis does not hash to the DID it claims', () => {
      const victim = externalIdentity();
      const impostor = externalIdentity();
      const t = makeTransport();
      t.registerActor(aliceDid, aliceKeys);
      const received: Record<string, unknown>[] = [];
      t.registerMessageHandler(aliceDid, COHORT_OPT_IN, (message: Record<string, unknown>) => { received.push(message); });
      t.start();

      relay.directed(
        plainEvent(COHORT_OPT_IN, victim.did, {
          cohortId        : 'c1',
          participantPk   : impostor.keys.publicKey.compressed,
          communicationPk : impostor.keys.publicKey.compressed,
          genesisDocument : impostor.genesisDocument,
        }, impostor.keys),
        bytesToHex(aliceKeys.publicKey.x),
      );
      expect(received).to.be.empty;
    });

    it('keeps a forged advert out of the runner peer registry', async () => {
      // End-to-end statement of the finding: the runner registers the advertised
      // communication key under the advertised service DID, so an unbound advert
      // redirects every later encrypted message to the attacker.
      const t = makeTransport();
      t.registerActor(aliceDid, aliceKeys);
      const runner = new AggregationParticipantRunner({
        transport       : t,
        did             : aliceDid,
        keys            : aliceKeys,
        shouldJoin      : async () => false,
        onProvideUpdate : async () => null,
      });
      await runner.start();
      t.start();

      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c-forged', attackerKeys.publicKey.compressed), attackerKeys));
      expect(runner.session.discoveredCohorts.has('c-forged')).to.be.false;
      expect(t.getPeerPk(serviceDid)).to.be.undefined;

      // The honest advert from the same service still lands.
      relay.broadcast(plainEvent(COHORT_ADVERT, serviceDid, advertBody('c-real', serviceKeys.publicKey.compressed), serviceKeys));
      expect(runner.session.discoveredCohorts.has('c-real')).to.be.true;
      expect(t.getPeerPk(serviceDid)).to.deep.equal(serviceKeys.publicKey.compressed);
      runner.stop();
    });
  });

  describe('HTTP server binds the advert to its envelope', () => {
    let serverKeys: SchnorrKeyPair;
    let serverDid: string;
    let server: HttpServerTransport;

    beforeEach(() => {
      serverKeys = SchnorrKeyPair.generate();
      serverDid = k1Did(serverKeys);
      server = new HttpServerTransport({
        logger              : SILENT_LOGGER,
        heartbeatIntervalMs : 0,
        resolveSenderPk     : resolveBtcr2SenderPk,
      });
      server.registerActor(serverDid, serverKeys);
    });

    afterEach(() => server.stop());

    const advertPost = (innerFrom: string): HttpRequestLike => {
      const message = new BaseMessage({
        type : COHORT_ADVERT,
        from : innerFrom,
        body : advertBody('c1', serverKeys.publicKey.compressed) as BaseBody,
      });
      return req('POST', HTTP_ROUTE.ADVERTS, JSON.stringify(signEnvelope(message, { did: serverDid, keys: serverKeys })));
    };

    it('rejects an advert whose inner from is not the envelope sender', async () => {
      const foreignDid = k1Did(SchnorrKeyPair.generate());
      const res = await server.handleRequest(advertPost(foreignDid));
      expect(res.status).to.equal(401);
      expect(JSON.parse(res.body as string).error).to.equal('sender_mismatch');
    });

    it('accepts an advert whose inner from is the envelope sender', async () => {
      const res = await server.handleRequest(advertPost(serverDid));
      expect(res.status).to.equal(202);
    });
  });

  describe('HTTP client binds inbound messages to their envelope', () => {
    let sse: MockSse;
    let client: HttpClientTransport;
    let serviceKeys: SchnorrKeyPair;
    let serviceDid: string;
    let attackerKeys: SchnorrKeyPair;
    let attackerDid: string;
    let aliceKeys: SchnorrKeyPair;
    let aliceDid: string;
    let inboxPath: string;

    beforeEach(async () => {
      sse = mockSse();
      serviceKeys = SchnorrKeyPair.generate();
      serviceDid = k1Did(serviceKeys);
      attackerKeys = SchnorrKeyPair.generate();
      attackerDid = k1Did(attackerKeys);
      aliceKeys = SchnorrKeyPair.generate();
      aliceDid = k1Did(aliceKeys);
      inboxPath = HTTP_ROUTE.ACTOR_INBOX.replace('{did}', encodeURIComponent(aliceDid));

      client = new HttpClientTransport({
        baseUrl         : 'http://aggregator.invalid/',
        fetchImpl       : sse.fetch,
        logger          : SILENT_LOGGER,
        resolveSenderPk : resolveBtcr2SenderPk,
      });
      client.registerActor(aliceDid, aliceKeys);
      client.start();
      await settle();
    });

    afterEach(() => client.stop());

    const record = (type: string): Record<string, unknown>[] => {
      const received: Record<string, unknown>[] = [];
      client.registerMessageHandler(aliceDid, type, (message: Record<string, unknown>) => { received.push(message); });
      return received;
    };

    it('drops a broadcast whose inner from is not the envelope sender', async () => {
      const received = record(COHORT_ADVERT);
      const message = new BaseMessage({
        type : COHORT_ADVERT,
        from : serviceDid,
        body : advertBody('c1', attackerKeys.publicKey.compressed) as BaseBody,
      });
      sse.push(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT,
        JSON.stringify(signEnvelope(message, { did: attackerDid, keys: attackerKeys })));
      await settle();
      expect(received).to.be.empty;
    });

    it('dispatches a broadcast whose inner from is the envelope sender', async () => {
      const received = record(COHORT_ADVERT);
      const message = new BaseMessage({
        type : COHORT_ADVERT,
        from : serviceDid,
        body : advertBody('c1', serviceKeys.publicKey.compressed) as BaseBody,
      });
      sse.push(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT,
        JSON.stringify(signEnvelope(message, { did: serviceDid, keys: serviceKeys })));
      await settle();
      expect(received).to.have.lengthOf(1);
    });

    it('drops a broadcast advertising a key the sender did not authenticate with', async () => {
      const received = record(COHORT_ADVERT);
      const message = new BaseMessage({
        type : COHORT_ADVERT,
        from : serviceDid,
        body : advertBody('c1', attackerKeys.publicKey.compressed) as BaseBody,
      });
      sse.push(HTTP_ROUTE.ADVERTS, SSE_EVENT.ADVERT,
        JSON.stringify(signEnvelope(message, { did: serviceDid, keys: serviceKeys })));
      await settle();
      expect(received).to.be.empty;
    });

    it('drops an inbox message whose inner from is not the envelope sender', async () => {
      const received = record(AGGREGATED_NONCE);
      const message = new BaseMessage({
        type : AGGREGATED_NONCE,
        from : serviceDid,
        to   : aliceDid,
        body : { cohortId: 'c1', sessionId: 's', aggregatedNonce: new Uint8Array(66) } as BaseBody,
      });
      sse.push(inboxPath, SSE_EVENT.MESSAGE,
        JSON.stringify(signEnvelope(message, { did: attackerDid, keys: attackerKeys }, { to: aliceDid })));
      await settle();
      expect(received).to.be.empty;
    });

    it('dispatches an inbox message whose inner from is the envelope sender', async () => {
      const received = record(AGGREGATED_NONCE);
      const message = new BaseMessage({
        type : AGGREGATED_NONCE,
        from : serviceDid,
        to   : aliceDid,
        body : { cohortId: 'c1', sessionId: 's', aggregatedNonce: new Uint8Array(66) } as BaseBody,
      });
      sse.push(inboxPath, SSE_EVENT.MESSAGE,
        JSON.stringify(signEnvelope(message, { did: serviceDid, keys: serviceKeys }, { to: aliceDid })));
      await settle();
      expect(received).to.have.lengthOf(1);
    });
  });

  describe('participant refuses service messages from anyone else', () => {

    it('ignores a COHORT_READY that does not come from the cohort service', () => {
      const { service, member, outsiderDid, cohortId } = soloCohort();
      const ready = service.finalizeKeygen(cohortId);
      ready[0].from = outsiderDid;
      member.receive(ready[0]);
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
      expect(member.joinedCohorts.has(cohortId)).to.be.false;
    });

    it('applies a COHORT_READY from the cohort service', () => {
      const { service, member, cohortId, toMember } = soloCohort();
      toMember(service.finalizeKeygen(cohortId));
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
    });

    it('ignores aggregated data that does not come from the cohort service', () => {
      const { service, member, memberDid, memberKeys, outsiderDid, cohortId, toService } = readyCohort();
      toService(member.submitUpdate(cohortId, createSignedUpdate(memberDid, memberKeys)));
      const distribute = service.buildAndDistribute(cohortId);
      distribute[0].from = outsiderDid;
      member.receive(distribute[0]);
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.UpdateSubmitted);
      expect(member.getValidation(cohortId)).to.be.undefined;
    });

    it('ignores an authorization request that does not come from the cohort service', () => {
      const { service, member, memberDid, memberKeys, outsiderDid, cohortId, toMember, toService } = readyCohort();
      toService(member.submitUpdate(cohortId, createSignedUpdate(memberDid, memberKeys)));
      toMember(service.buildAndDistribute(cohortId));
      toService(member.approveValidation(cohortId));
      const script = beaconScript(service, cohortId);
      const tx = beaconTx(script, service.getCohort(cohortId)!.signalBytes!);
      const auth = service.startSigning(cohortId, { tx, prevOutScripts: [ script ], prevOutValues: [ VALUE ] });
      auth[0].from = outsiderDid;
      member.receive(auth[0]);
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.ValidationSent);
      expect(member.pendingSigningRequests.has(cohortId)).to.be.false;
    });

    it('ignores an aggregated nonce that does not come from the cohort service', () => {
      const { service, member, outsiderDid, cohortId, toMember, toService } = noncesContributed();
      const nonce = service.sendAggregatedNonce(cohortId);
      member.receive(new BaseMessage({ ...nonce[0].toJSON(), from: outsiderDid }));
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);

      // The round is untouched: the real message still completes it.
      toMember(nonce);
      toService(member.generatePartialSignature(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    });

    it('ignores an aggregated nonce for a different signing session', () => {
      const { service, member, cohortId } = noncesContributed();
      const nonce = service.sendAggregatedNonce(cohortId);
      nonce[0].body!.sessionId = 'some-other-session';
      member.receive(nonce[0]);
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
    });

    it('applies an aggregated nonce for the active session', () => {
      const { service, member, cohortId, toMember } = noncesContributed();
      toMember(service.sendAggregatedNonce(cohortId));
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingPartialSig);
    });

    it('ignores a fallback request that does not come from the cohort service', () => {
      const { service, member, outsiderDid, cohortId, tx, script, toMember, toService } = noncesContributed();
      const cohort = service.getCohort(cohortId)!;
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
      member.receive(createFallbackAuthorizationRequestMessage({
        from                  : outsiderDid,
        to                    : member.did,
        cohortId,
        sessionId             : service.getSigningSessionId(cohortId)!,
        pendingTx             : tx.hex,
        prevOutScriptHex      : bytesToHex(script),
        prevOutValue          : VALUE.toString(),
        fallbackLeafScriptHex : bytesToHex(leaf),
      }));
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
      expect(member.pendingFallbackRequests.has(cohortId)).to.be.false;

      // The secret nonce survived: the optimistic round still completes.
      toMember(service.sendAggregatedNonce(cohortId));
      toService(member.generatePartialSignature(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    });

    it('ignores a fallback request for a different signing session', () => {
      const { service, member, serviceDid, cohortId, tx, script } = noncesContributed();
      const cohort = service.getCohort(cohortId)!;
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
      member.receive(createFallbackAuthorizationRequestMessage({
        from                  : serviceDid,
        to                    : member.did,
        cohortId,
        sessionId             : 'some-other-session',
        pendingTx             : tx.hex,
        prevOutScriptHex      : bytesToHex(script),
        prevOutValue          : VALUE.toString(),
        fallbackLeafScriptHex : bytesToHex(leaf),
      }));
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);
      expect(member.pendingFallbackRequests.has(cohortId)).to.be.false;
    });

    it('accepts the fallback request for the optimistic round', () => {
      const { service, member, serviceDid, cohortId, tx, script } = noncesContributed();
      const cohort = service.getCohort(cohortId)!;
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
      member.receive(createFallbackAuthorizationRequestMessage({
        from                  : serviceDid,
        to                    : member.did,
        cohortId,
        sessionId             : service.getSigningSessionId(cohortId)!,
        pendingTx             : tx.hex,
        prevOutScriptHex      : bytesToHex(script),
        prevOutValue          : VALUE.toString(),
        fallbackLeafScriptHex : bytesToHex(leaf),
      }));
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);
    });

    it('ignores a cohort message naming a cohort this member does not know', () => {
      const { service, member, cohortId } = soloCohort();
      const ready = service.finalizeKeygen(cohortId);
      ready[0].body!.cohortId = 'not-a-cohort-we-joined';
      member.receive(ready[0]);
      expect(member.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
    });
  });
});
