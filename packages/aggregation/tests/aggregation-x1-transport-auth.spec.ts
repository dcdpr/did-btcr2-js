import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr, Script, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import { expect } from 'chai';

import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update, GenesisDocumentLike } from '@did-btcr2/method';
import { DidBtcr2, GenesisDocument, resolveBtcr2SenderPk } from '@did-btcr2/method';

import {
  AggregationParticipant,
  AggregationParticipantRunner,
  AggregationServiceRunner,
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  HTTP_ROUTE,
  HttpServerTransport,
  KeyPairAggregationSigner,
  SILENT_LOGGER,
  signEnvelope,
  type BaseBody,
  type HttpRequestLike,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

/**
 * Trustless transport authentication for EXTERNAL (x1) did:btcr2 identifiers (ADR 066).
 */

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

const hexOf = (b: Uint8Array): string => bytesToHex(b);

/** An x1 identity: a signing keypair, a genesis document whose capabilityInvocation[0]
 *  is that keypair, and the x1 DID minted from the canonical hash of that document. */
function makeExternalIdentity(network = 'mutinynet'): {
  keys: SchnorrKeyPair;
  did: string;
  genesisDocument: Record<string, unknown>;
} {
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
  const did = DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', network });
  return { keys, did, genesisDocument };
}

function req(method: string, url: string, headers: Record<string, string> = {}, body?: string): HttpRequestLike {
  return { method, url, headers, body };
}

/** Cryptographically valid SignedBTCR2Update, verifiable against the sender's own key
 *  (the service checks the update proof against the opt-in participantPk). */
function createSignedUpdate(did: string, keys: SchnorrKeyPair, version = 2): SignedBTCR2Update {
  const context = [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1',
  ];
  const verificationMethodId = `${did}#initialKey`;
  const unsigned: UnsignedBTCR2Update = {
    '@context'      : context,
    patch           : [
      { op: 'add', path: '/service/-', value: { id: `${did}#svc`, type: 'Test', serviceEndpoint: 'https://example.com' } },
    ],
    sourceHash      : `zQmSourceHash${did.slice(-6)}`,
    targetHash      : `zQmTargetHash${did.slice(-6)}`,
    targetVersionId : version,
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

function buildDummyTx(outputScript: Uint8Array, prevOutValue: bigint, signal?: Uint8Array): Transaction {
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script: outputScript } });
  tx.addOutput({ script: outputScript, amount: prevOutValue - 500n });
  if(signal) tx.addOutput({ script: Script.encode(['RETURN', signal]), amount: 0n });
  return tx;
}

describe('x1 transport authentication (ADR 066)', () => {
  let serverKeys: SchnorrKeyPair;
  let serverDid:  string;
  let server:     HttpServerTransport;

  beforeEach(() => {
    serverKeys = SchnorrKeyPair.generate();
    serverDid  = DidBtcr2.create(serverKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  });

  afterEach(() => {
    server?.stop();
  });

  const makeServer = (overrides: Partial<ConstructorParameters<typeof HttpServerTransport>[0]> = {}): HttpServerTransport =>
    new HttpServerTransport({
      logger              : SILENT_LOGGER,
      heartbeatIntervalMs : 0,
      resolveSenderPk     : resolveBtcr2SenderPk,
      ...overrides,
    });

  const optInEnvelope = (
    from: string,
    signWith: SchnorrKeyPair,
    body: Record<string, unknown>,
  ): string => {
    const msg = new BaseMessage({ type: COHORT_OPT_IN, from, to: serverDid, body: body as BaseBody });
    return JSON.stringify(signEnvelope(msg, { did: from, keys: signWith }, { to: serverDid }));
  };

  const post = (body: string): Promise<{ status: number }> =>
    server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, { 'content-type': 'application/json' }, body));

  describe('HttpServerTransport bootstrap', () => {
    it('accepts an x1 opt-in with a matching genesis and registers the genesis-derived key', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const x1 = makeExternalIdentity();

      const res = await post(optInEnvelope(x1.did, x1.keys, {
        cohortId        : 'c1',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : x1.keys.publicKey.compressed,
        genesisDocument : x1.genesisDocument,
      }));

      expect(res.status).to.equal(202);
      const derived = resolveBtcr2SenderPk(x1.did, { genesisDocument: x1.genesisDocument })!;
      expect(hexOf(server.getPeerPk(x1.did)!)).to.equal(hexOf(derived.compressed));
      expect(hexOf(derived.compressed)).to.equal(hexOf(x1.keys.publicKey.compressed));
    });

    it('rejects an x1 opt-in that carries no genesis document (401)', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const x1 = makeExternalIdentity();

      const res = await post(optInEnvelope(x1.did, x1.keys, {
        cohortId        : 'c1',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : x1.keys.publicKey.compressed,
      }));

      expect(res.status).to.equal(401);
      expect(server.getPeerPk(x1.did)).to.equal(undefined);
    });

    it('rejects an x1 opt-in whose genesis does not hash to the DID (401)', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const victim = makeExternalIdentity();
      const other  = makeExternalIdentity();

      // victim DID, but carrying another identity's genesis: the hash commitment fails.
      const res = await post(optInEnvelope(victim.did, victim.keys, {
        cohortId        : 'c1',
        participantPk   : victim.keys.publicKey.compressed,
        communicationPk : victim.keys.publicKey.compressed,
        genesisDocument : other.genesisDocument,
      }));

      expect(res.status).to.equal(401);
      expect(server.getPeerPk(victim.did)).to.equal(undefined);
    });

    it('rejects an x1 opt-in whose communicationPk disagrees with the genesis-derived key (401)', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const x1 = makeExternalIdentity();
      const stranger = SchnorrKeyPair.generate();

      const res = await post(optInEnvelope(x1.did, x1.keys, {
        cohortId        : 'c1',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : stranger.publicKey.compressed, // advertises a different key
        genesisDocument : x1.genesisDocument,
      }));

      expect(res.status).to.equal(401);
      expect(server.getPeerPk(x1.did)).to.equal(undefined);
    });

    it('rejects an x1 opt-in signed by a key other than the genesis key (401)', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const x1 = makeExternalIdentity();
      const attacker = SchnorrKeyPair.generate();

      // Real genesis + honest communicationPk, but the envelope is signed by an attacker
      // who does not control the genesis key: cross-check passes, signature verify fails.
      const res = await post(optInEnvelope(x1.did, attacker, {
        cohortId        : 'c1',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : x1.keys.publicKey.compressed,
        genesisDocument : x1.genesisDocument,
      }));

      expect(res.status).to.equal(401);
      expect(server.getPeerPk(x1.did)).to.equal(undefined);
    });

    it('lets a bootstrapped x1 peer send a later message with no genesis (registered peer)', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      const x1 = makeExternalIdentity();

      const first = await post(optInEnvelope(x1.did, x1.keys, {
        cohortId        : 'c1',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : x1.keys.publicKey.compressed,
        genesisDocument : x1.genesisDocument,
      }));
      expect(first.status).to.equal(202);

      // A distinct follow-up message (fresh nonce), no genesis: resolves via the registry.
      const second = await post(optInEnvelope(x1.did, x1.keys, {
        cohortId        : 'c2',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : x1.keys.publicKey.compressed,
      }));
      expect(second.status).to.equal(202);
    });

    it('rejects an over-large body before parsing it (413) on /v1/messages and /v1/adverts', async () => {
      server = makeServer({ maxBodyBytes: 100 });
      server.registerActor(serverDid, serverKeys);
      const x1 = makeExternalIdentity();

      const body = optInEnvelope(x1.did, x1.keys, {
        cohortId        : 'c1',
        participantPk   : x1.keys.publicKey.compressed,
        communicationPk : x1.keys.publicKey.compressed,
        genesisDocument : x1.genesisDocument,
      });
      expect(body.length).to.be.greaterThan(100);

      const messages = await server.handleRequest(req('POST', HTTP_ROUTE.MESSAGES, {}, body));
      expect(messages.status).to.equal(413);
      const adverts = await server.handleRequest(req('POST', HTTP_ROUTE.ADVERTS, {}, body));
      expect(adverts.status).to.equal(413);
    });

    it('rejects an inner message.from that differs from the authenticated envelope.from (no poisoning)', async () => {
      server = makeServer();
      server.registerActor(serverDid, serverKeys);
      // The attacker controls their own resolvable k1 DID and signs the envelope with it,
      // but the inner opt-in claims to come from a victim x1 DID. The transport must not
      // let the attacker seat the victim into the cohort or poison the registry for it.
      const attackerKeys = SchnorrKeyPair.generate();
      const attackerDid  = DidBtcr2.create(attackerKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const victim = makeExternalIdentity();

      const msg = new BaseMessage({
        type : COHORT_OPT_IN,
        from : victim.did, // spoofed inner sender
        to   : serverDid,
        body : {
          cohortId        : 'c1',
          participantPk   : attackerKeys.publicKey.compressed,
          communicationPk : attackerKeys.publicKey.compressed,
        } as BaseBody,
      });
      const env = signEnvelope(msg, { did: attackerDid, keys: attackerKeys }, { to: serverDid });

      const res = await server.handleRequest(
        req('POST', HTTP_ROUTE.MESSAGES, { 'content-type': 'application/json' }, JSON.stringify(env)));
      expect(res.status).to.equal(401);
      expect(server.getPeerPk(victim.did)).to.equal(undefined);
      expect(server.getPeerPk(attackerDid)).to.equal(undefined);
    });

    it('does not register a bootstrapped x1 peer when the request is rejected downstream (404)', async () => {
      server = makeServer();
      // No actor is registered for the recipient, so the request is rejected 404 after the
      // bootstrap authenticates the sender. No peer-registry state must survive.
      const nonexistent = DidBtcr2.create(SchnorrKeyPair.generate().publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const x1 = makeExternalIdentity();

      const msg = new BaseMessage({
        type : COHORT_OPT_IN,
        from : x1.did,
        to   : nonexistent,
        body : {
          cohortId        : 'c1',
          participantPk   : x1.keys.publicKey.compressed,
          communicationPk : x1.keys.publicKey.compressed,
          genesisDocument : x1.genesisDocument,
        } as BaseBody,
      });
      const env = signEnvelope(msg, { did: x1.did, keys: x1.keys }, { to: nonexistent });

      const res = await server.handleRequest(
        req('POST', HTTP_ROUTE.MESSAGES, { 'content-type': 'application/json' }, JSON.stringify(env)));
      expect(res.status).to.equal(404);
      expect(server.getPeerPk(x1.did)).to.equal(undefined);
    });
  });

  describe('AggregationParticipant opt-in', () => {
    const advertFor = (participantDid: string): BaseMessage => new BaseMessage({
      type : COHORT_ADVERT,
      from : serverDid,
      to   : participantDid,
      body : {
        cohortId         : 'c1',
        minParticipants  : 2,
        beaconType       : 'CASBeacon',
        network          : 'mutinynet',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
        communicationPk  : serverKeys.publicKey.compressed,
      },
    });

    it('an x1 participant attaches its genesis and advertises the genesis-derived key', () => {
      const x1 = makeExternalIdentity();
      const participant = new AggregationParticipant({
        did             : x1.did,
        signer          : new KeyPairAggregationSigner(x1.keys),
        genesisDocument : x1.genesisDocument,
      });
      participant.receive(advertFor(x1.did));
      const [optIn] = participant.joinCohort('c1');

      expect(optIn.body?.genesisDocument).to.deep.equal(x1.genesisDocument);
      expect(hexOf(optIn.body!.communicationPk!)).to.equal(hexOf(x1.keys.publicKey.compressed));

      // Comm-key parity: the participant signs/advertises exactly the key the resolver
      // derives from the genesis (ADR 066 section 4.4).
      const derived = resolveBtcr2SenderPk(x1.did, { genesisDocument: x1.genesisDocument })!;
      expect(hexOf(derived.compressed)).to.equal(hexOf(participant.publicKey));
    });

    it('a k1 participant omits the genesis document', () => {
      const keys = SchnorrKeyPair.generate();
      const did  = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const participant = new AggregationParticipant({ did, signer: new KeyPairAggregationSigner(keys) });
      participant.receive(advertFor(did));
      const [optIn] = participant.joinCohort('c1');

      expect(optIn.body?.genesisDocument).to.equal(undefined);
    });
  });

  describe('full cohort (symmetry)', () => {
    it('completes a mixed k1 + x1 cohort over the in-memory transport with a valid aggregate signature', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid  = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys   = SchnorrKeyPair.generate();
      const aliceDid    = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bob         = makeExternalIdentity('mutinynet'); // x1

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      const aliceTransport   = new MockTransport(bus);
      const bobTransport     = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);
      aliceTransport.registerActor(aliceDid, aliceKeys);
      bobTransport.registerActor(bob.did, bob.keys);

      const service = new AggregationServiceRunner({
        transport       : serviceTransport,
        did             : serviceDid,
        keys            : serviceKeys,
        config          : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon', recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE },
        onProvideTxData : async () => {
          const cohort = service.session.cohorts[0];
          const aggPk  = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
          const payment = p2tr(aggPk);
          const prevOutValue = 100000n;
          const tx = buildDummyTx(payment.script, prevOutValue, cohort.signalBytes!);
          return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
        },
      });

      const aliceRunner = new AggregationParticipantRunner({
        transport       : aliceTransport,
        did             : aliceDid,
        keys            : aliceKeys,
        shouldJoin      : async () => true,
        onProvideUpdate : async () => createSignedUpdate(aliceDid, aliceKeys),
      });
      const bobRunner = new AggregationParticipantRunner({
        transport       : bobTransport,
        did             : bob.did,
        keys            : bob.keys,
        genesisDocument : bob.genesisDocument,
        shouldJoin      : async () => true,
        onProvideUpdate : async () => createSignedUpdate(bob.did, bob.keys),
      });

      // The x1 participant reaches Complete when it processes the aggregated nonce and
      // sends its partial signature; await that event rather than sampling it after
      // service.run() resolves (the participant completion flushes on its own microtask).
      const bobComplete = new Promise<string>((resolve) =>
        bobRunner.on('cohort-complete', () => resolve('cohort-complete')));

      await aliceRunner.start();
      await bobRunner.start();
      const [result, bobStatus] = await Promise.all([service.run(), bobComplete]);

      expect(result.signature.length).to.equal(64);
      expect(result.signedTx).to.exist;
      expect(bobStatus).to.equal('cohort-complete');
    });
  });
});
