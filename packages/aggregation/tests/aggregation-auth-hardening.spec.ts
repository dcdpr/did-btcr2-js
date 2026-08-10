import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { Script, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';

import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update, GenesisDocumentLike } from '@did-btcr2/method';
import { DidBtcr2, GenesisDocument, resolveBtcr2SenderPk } from '@did-btcr2/method';

import {
  AggregationParticipant,
  AggregationService,
  BaseMessage,
  KeyPairAggregationSigner,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  SILENT_LOGGER,
  authenticateEnvelopeContent,
  createAggregatedNonceMessage,
  createAuthorizationRequestMessage,
  createFallbackAuthorizationRequestMessage,
  createCohortOptInMessage,
  createValidationAckMessage,
  signEnvelope,
} from '../src/index.js';
import { beaconOutputScript } from './helpers/beacon-script.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

function makeIdentity(network = 'mutinynet'): { keys: SchnorrKeyPair; did: string } {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network });
  return { keys, did };
}

/** An x1 identity: signing keypair + self-verifying genesis document. */
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

/** Cryptographically valid SignedBTCR2Update for a participant (real BIP-340 proof). */
function createSignedUpdate(did: string, keys: SchnorrKeyPair, version = 2): SignedBTCR2Update {
  const context = [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1',
  ];
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
    verificationMethod : `${did}#initialKey`,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
    capabilityAction   : 'Write',
  };
  const multikey = SchnorrMultikey.fromSecretKey(`${did}#initialKey`, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config);
}

function buildSignalTx(outputScript: Uint8Array, prevOutValue: bigint, signal: Uint8Array): Transaction {
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({
    txid        : '00'.repeat(32),
    index       : 0,
    witnessUtxo : { amount: prevOutValue, script: outputScript },
  });
  tx.addOutput({ script: outputScript, amount: prevOutValue - 500n });
  tx.addOutput({ script: Script.encode(['RETURN', signal]), amount: 0n });
  return tx;
}

/** Route outgoing messages to their addressed party; broadcasts (no `to`) go to everyone. */
function route(msgs: BaseMessage[], parties: Record<string, { receive(m: BaseMessage): void }>): void {
  for(const m of msgs) {
    if(m.to === undefined) {
      for(const target of Object.values(parties)) target.receive(m);
      continue;
    }
    parties[m.to]?.receive(m);
  }
}

describe('Aggregation transport + message auth hardening', () => {

  describe('authenticateEnvelopeContent (audit C1)', () => {
    const service = makeIdentity();

    function optInEnvelope(sender: { keys: SchnorrKeyPair; did: string }, opts?: { fromOverride?: string; communicationPk?: Uint8Array }) {
      const msg = createCohortOptInMessage({
        from            : opts?.fromOverride ?? sender.did,
        to              : service.did,
        cohortId        : 'cohort-1',
        participantPk   : sender.keys.publicKey.compressed,
        communicationPk : opts?.communicationPk ?? sender.keys.publicKey.compressed,
      });
      return signEnvelope(msg, { did: sender.did, keys: sender.keys }, { to: service.did });
    }

    it('accepts a valid envelope from a resolvable (k1) sender', () => {
      const sender = makeIdentity();
      const flat = authenticateEnvelopeContent(JSON.stringify(optInEnvelope(sender)), {
        resolveSenderPk : resolveBtcr2SenderPk,
        expectedTo      : service.did,
        logger          : SILENT_LOGGER,
      });
      expect(flat?.from).to.equal(sender.did);
      expect(flat?.cohortId).to.equal('cohort-1');
    });

    it('drops a forged envelope (signed by an attacker key, from: victim DID)', () => {
      const victim = makeIdentity();
      const attacker = makeIdentity();
      // Attacker signs but claims the victim's DID as the envelope sender
      const msg = createCohortOptInMessage({
        from            : victim.did,
        to              : service.did,
        cohortId        : 'cohort-1',
        participantPk   : attacker.keys.publicKey.compressed,
        communicationPk : attacker.keys.publicKey.compressed,
      });
      const envelope = signEnvelope(msg, { did: victim.did, keys: attacker.keys }, { to: service.did });
      const flat = authenticateEnvelopeContent(JSON.stringify(envelope), {
        resolveSenderPk : resolveBtcr2SenderPk,
        logger          : SILENT_LOGGER,
      });
      expect(flat).to.be.undefined;
    });

    it('drops an envelope whose inner message.from disagrees with the authenticated sender', () => {
      const sender = makeIdentity();
      const other = makeIdentity();
      const flat = authenticateEnvelopeContent(JSON.stringify(optInEnvelope(sender, { fromOverride: other.did })), {
        resolveSenderPk : resolveBtcr2SenderPk,
        logger          : SILENT_LOGGER,
      });
      expect(flat).to.be.undefined;
    });

    it('drops an envelope advertising a communication key that is not the signing key', () => {
      const sender = makeIdentity();
      const other = makeIdentity();
      const flat = authenticateEnvelopeContent(
        JSON.stringify(optInEnvelope(sender, { communicationPk: other.keys.publicKey.compressed })),
        { resolveSenderPk: resolveBtcr2SenderPk, logger: SILENT_LOGGER }
      );
      expect(flat).to.be.undefined;
    });

    it('drops a stale envelope (replay beyond the timestamp window)', () => {
      const sender = makeIdentity();
      const msg = createCohortOptInMessage({
        from            : sender.did,
        to              : service.did,
        cohortId        : 'cohort-1',
        participantPk   : sender.keys.publicKey.compressed,
        communicationPk : sender.keys.publicKey.compressed,
      });
      const stale = Math.floor(Date.now() / 1000) - 3600;
      const envelope = signEnvelope(msg, { did: sender.did, keys: sender.keys }, { timestamp: stale });
      const flat = authenticateEnvelopeContent(JSON.stringify(envelope), {
        resolveSenderPk : resolveBtcr2SenderPk,
        logger          : SILENT_LOGGER,
      });
      expect(flat).to.be.undefined;
    });

    it('drops an envelope addressed to a different recipient', () => {
      const sender = makeIdentity();
      const flat = authenticateEnvelopeContent(JSON.stringify(optInEnvelope(sender)), {
        resolveSenderPk : resolveBtcr2SenderPk,
        expectedTo      : makeIdentity().did,
        logger          : SILENT_LOGGER,
      });
      expect(flat).to.be.undefined;
    });

    it('drops a message from an unresolvable DID', () => {
      const sender = makeIdentity();
      const msg = createCohortOptInMessage({
        from            : 'did:example:unresolvable',
        to              : service.did,
        cohortId        : 'cohort-1',
        participantPk   : sender.keys.publicKey.compressed,
        communicationPk : sender.keys.publicKey.compressed,
      });
      const envelope = signEnvelope(msg, { did: 'did:example:unresolvable', keys: sender.keys });
      const flat = authenticateEnvelopeContent(JSON.stringify(envelope), {
        resolveSenderPk : resolveBtcr2SenderPk,
        logger          : SILENT_LOGGER,
      });
      expect(flat).to.be.undefined;
    });

    it('accepts an x1 sender bootstrap-authenticated by its in-band genesis document', () => {
      const sender = makeExternalIdentity();
      const msg = createCohortOptInMessage({
        from            : sender.did,
        to              : service.did,
        cohortId        : 'cohort-1',
        participantPk   : sender.keys.publicKey.compressed,
        communicationPk : sender.keys.publicKey.compressed,
        genesisDocument : sender.genesisDocument,
      });
      const envelope = signEnvelope(msg, { did: sender.did, keys: sender.keys }, { to: service.did });
      const flat = authenticateEnvelopeContent(JSON.stringify(envelope), {
        resolveSenderPk : resolveBtcr2SenderPk,
        expectedTo      : service.did,
        logger          : SILENT_LOGGER,
      });
      expect(flat?.from).to.equal(sender.did);
    });
  });

  describe('participant service-identity guards (audit H7, L21)', () => {
    function setup() {
      const svc = makeIdentity();
      const alice = makeIdentity();
      const bob = makeIdentity();
      const service = new AggregationService({ did: svc.did, publicKey: svc.keys.publicKey });
      const aliceP = new AggregationParticipant({ did: alice.did, signer: new KeyPairAggregationSigner(alice.keys) });
      const bobP = new AggregationParticipant({ did: bob.did, signer: new KeyPairAggregationSigner(bob.keys) });
      return { svc, alice, bob, service, aliceP, bobP };
    }

    /** Drive both participants to OptedIn; returns the cohortId. */
    function driveToOptedIn(ctx: ReturnType<typeof setup>): string {
      const { service, aliceP, bobP, alice, bob, svc } = ctx;
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      route(service.advertise(cohortId), { [alice.did]: aliceP, [bob.did]: bobP });
      route(aliceP.joinCohort(cohortId), { [svc.did]: service });
      route(bobP.joinCohort(cohortId), { [svc.did]: service });
      route(service.acceptParticipant(cohortId, alice.did), { [alice.did]: aliceP });
      route(service.acceptParticipant(cohortId, bob.did), { [bob.did]: bobP });
      return cohortId;
    }

    /** Continue from OptedIn to CohortReady for both participants. */
    function driveToReady(ctx: ReturnType<typeof setup>, cohortId: string): void {
      const { service, aliceP, bobP, alice, bob } = ctx;
      route(service.finalizeKeygen(cohortId), { [alice.did]: aliceP, [bob.did]: bobP });
    }

    /** Continue through update submission and distribution to AwaitingValidation. */
    function driveToValidation(ctx: ReturnType<typeof setup>, cohortId: string): void {
      const { service, aliceP, bobP, alice, bob } = ctx;
      driveToReady(ctx, cohortId);
      route(aliceP.submitUpdate(cohortId, createSignedUpdate(alice.did, alice.keys)), { [ctx.svc.did]: service });
      route(bobP.submitUpdate(cohortId, createSignedUpdate(bob.did, bob.keys)), { [ctx.svc.did]: service });
      route(service.buildAndDistribute(cohortId), { [alice.did]: aliceP, [bob.did]: bobP });
    }

    it('H7: ignores a COHORT_READY from a sender that is not the service', () => {
      const ctx = setup();
      const cohortId = driveToOptedIn(ctx);
      const readyMsgs = ctx.service.finalizeKeygen(cohortId);
      const forAlice = readyMsgs.find(m => m.to === ctx.alice.did)!;

      const attacker = makeIdentity();
      ctx.aliceP.receive(new BaseMessage({ type: forAlice.type, from: attacker.did, to: forAlice.to, body: forAlice.body }));
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);

      // Control: the genuine service message advances the phase
      ctx.aliceP.receive(forAlice);
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
    });

    it('H7: ignores a DISTRIBUTE_AGGREGATED_DATA from a sender that is not the service', () => {
      const ctx = setup();
      const cohortId = driveToOptedIn(ctx);
      driveToReady(ctx, cohortId);
      route(ctx.aliceP.submitUpdate(cohortId, createSignedUpdate(ctx.alice.did, ctx.alice.keys)), { [ctx.svc.did]: ctx.service });
      route(ctx.bobP.submitUpdate(cohortId, createSignedUpdate(ctx.bob.did, ctx.bob.keys)), { [ctx.svc.did]: ctx.service });
      const distMsgs = ctx.service.buildAndDistribute(cohortId);
      const forAlice = distMsgs.find(m => m.to === ctx.alice.did)!;

      const attacker = makeIdentity();
      ctx.aliceP.receive(new BaseMessage({ type: forAlice.type, from: attacker.did, to: forAlice.to, body: forAlice.body }));
      expect(ctx.aliceP.pendingValidations.has(cohortId)).to.be.false;

      ctx.aliceP.receive(forAlice);
      expect(ctx.aliceP.pendingValidations.has(cohortId)).to.be.true;
    });

    it('H7: ignores a FALLBACK_AUTHORIZATION_REQUEST from a sender that is not the service', () => {
      const ctx = setup();
      const cohortId = driveToOptedIn(ctx);
      driveToValidation(ctx, cohortId);
      route(ctx.aliceP.approveValidation(cohortId), { [ctx.svc.did]: ctx.service });
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.ValidationSent);

      const attacker = makeIdentity();
      ctx.aliceP.receive(createFallbackAuthorizationRequestMessage({
        from                  : attacker.did,
        to                    : ctx.alice.did,
        cohortId,
        sessionId             : 'attacker-session',
        pendingTx             : 'aa',
        prevOutScriptHex      : 'bb',
        prevOutValue          : '1000',
        fallbackLeafScriptHex : 'cc',
      }));
      expect(ctx.aliceP.pendingFallbackRequests.has(cohortId)).to.be.false;
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.ValidationSent);
    });

    it('H7: ignores an AUTHORIZATION_REQUEST from a sender that is not the service', () => {
      const ctx = setup();
      const cohortId = driveToOptedIn(ctx);
      driveToValidation(ctx, cohortId);
      route(ctx.aliceP.approveValidation(cohortId), { [ctx.svc.did]: ctx.service });
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.ValidationSent);

      const attacker = makeIdentity();
      ctx.aliceP.receive(createAuthorizationRequestMessage({
        from             : attacker.did,
        to               : ctx.alice.did,
        cohortId,
        sessionId        : 'attacker-session',
        pendingTx        : 'aa',
        prevOutScriptHex : 'bb',
        prevOutValue     : '1000',
      }));
      expect(ctx.aliceP.pendingSigningRequests.has(cohortId)).to.be.false;
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.ValidationSent);
    });

    it('H7: ignores an AGGREGATED_NONCE from a sender that is not the service', () => {
      const ctx = setup();
      const cohortId = driveToOptedIn(ctx);
      driveToValidation(ctx, cohortId);
      route(ctx.aliceP.approveValidation(cohortId), { [ctx.svc.did]: ctx.service });
      route(ctx.bobP.approveValidation(cohortId), { [ctx.svc.did]: ctx.service });

      const cohort = ctx.service.getCohort(cohortId)!;
      const script = beaconOutputScript(cohort);
      const tx = buildSignalTx(script, 100000n, cohort.signalBytes!);
      route(ctx.service.startSigning(cohortId, {
        tx,
        prevOutScripts : [script],
        prevOutValues  : [100000n],
      }), { [ctx.alice.did]: ctx.aliceP, [ctx.bob.did]: ctx.bobP });
      route(ctx.aliceP.approveNonce(cohortId), { [ctx.svc.did]: ctx.service });
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);

      const attacker = makeIdentity();
      ctx.aliceP.receive(createAggregatedNonceMessage({
        from            : attacker.did,
        to              : ctx.alice.did,
        cohortId,
        sessionId       : ctx.service.getSigningSessionId(cohortId)!,
        aggregatedNonce : new Uint8Array(66),
      }));
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);

      // Control: the genuine service aggregated nonce advances the phase
      route(ctx.bobP.approveNonce(cohortId), { [ctx.svc.did]: ctx.service });
      route(ctx.service.sendAggregatedNonce(cohortId), { [ctx.alice.did]: ctx.aliceP });
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingPartialSig);
    });

    it('L21: ignores a fallback request naming a foreign session id when a session exists', () => {
      const ctx = setup();
      const cohortId = driveToOptedIn(ctx);
      driveToValidation(ctx, cohortId);
      route(ctx.aliceP.approveValidation(cohortId), { [ctx.svc.did]: ctx.service });
      route(ctx.bobP.approveValidation(cohortId), { [ctx.svc.did]: ctx.service });

      const cohort = ctx.service.getCohort(cohortId)!;
      const script = beaconOutputScript(cohort);
      const tx = buildSignalTx(script, 100000n, cohort.signalBytes!);
      route(ctx.service.startSigning(cohortId, {
        tx,
        prevOutScripts : [script],
        prevOutValues  : [100000n],
      }), { [ctx.alice.did]: ctx.aliceP, [ctx.bob.did]: ctx.bobP });

      // Alice creates her signing session
      route(ctx.aliceP.approveNonce(cohortId), { [ctx.svc.did]: ctx.service });
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);

      // A fallback request from the real service but naming a different session
      // must not abandon the in-flight optimistic session.
      ctx.aliceP.receive(createFallbackAuthorizationRequestMessage({
        from                  : ctx.svc.did,
        to                    : ctx.alice.did,
        cohortId,
        sessionId             : 'foreign-session',
        pendingTx             : 'aa',
        prevOutScriptHex      : 'bb',
        prevOutValue          : '1000',
        fallbackLeafScriptHex : 'cc',
      }));
      expect(ctx.aliceP.pendingFallbackRequests.has(cohortId)).to.be.false;
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonceSent);

      // Control: the service's genuine fallback reuses the session id and is accepted
      route(ctx.service.startFallbackSigning(cohortId), { [ctx.alice.did]: ctx.aliceP });
      expect(ctx.aliceP.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.AwaitingFallbackSig);
    });
  });

  describe('validation ack signal binding (audit H8)', () => {
    it('service drops an ack that does not commit to the distributed signal', () => {
      const svc = makeIdentity();
      const alice = makeIdentity();
      const bob = makeIdentity();
      const service = new AggregationService({ did: svc.did, publicKey: svc.keys.publicKey });
      const aliceP = new AggregationParticipant({ did: alice.did, signer: new KeyPairAggregationSigner(alice.keys) });
      const bobP = new AggregationParticipant({ did: bob.did, signer: new KeyPairAggregationSigner(bob.keys) });
      const parties = { [svc.did]: service, [alice.did]: aliceP, [bob.did]: bobP };

      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      route(service.advertise(cohortId), parties);
      route(aliceP.joinCohort(cohortId), parties);
      route(bobP.joinCohort(cohortId), parties);
      route(service.acceptParticipant(cohortId, alice.did), parties);
      route(service.acceptParticipant(cohortId, bob.did), parties);
      route(service.finalizeKeygen(cohortId), parties);
      route(aliceP.submitUpdate(cohortId, createSignedUpdate(alice.did, alice.keys)), parties);
      route(bobP.submitUpdate(cohortId, createSignedUpdate(bob.did, bob.keys)), parties);
      route(service.buildAndDistribute(cohortId), parties);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      // A forged ack approving a DIFFERENT signal must not count as consent
      service.receive(createValidationAckMessage({
        from           : alice.did,
        to             : svc.did,
        cohortId,
        approved       : true,
        signalBytesHex : 'ab'.repeat(32),
      }));
      expect(service.validationProgress(cohortId).approved.size).to.equal(0);

      // Genuine acks commit to the distributed signal and drive the phase forward
      route(aliceP.approveValidation(cohortId), parties);
      route(bobP.approveValidation(cohortId), parties);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);
    });

    it('service drops an ack that carries no signalBytesHex', () => {
      const svc = makeIdentity();
      const alice = makeIdentity();
      const bob = makeIdentity();
      const service = new AggregationService({ did: svc.did, publicKey: svc.keys.publicKey });
      const aliceP = new AggregationParticipant({ did: alice.did, signer: new KeyPairAggregationSigner(alice.keys) });
      const bobP = new AggregationParticipant({ did: bob.did, signer: new KeyPairAggregationSigner(bob.keys) });
      const parties = { [svc.did]: service, [alice.did]: aliceP, [bob.did]: bobP };

      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      route(service.advertise(cohortId), parties);
      route(aliceP.joinCohort(cohortId), parties);
      route(bobP.joinCohort(cohortId), parties);
      route(service.acceptParticipant(cohortId, alice.did), parties);
      route(service.acceptParticipant(cohortId, bob.did), parties);
      route(service.finalizeKeygen(cohortId), parties);
      route(aliceP.submitUpdate(cohortId, createSignedUpdate(alice.did, alice.keys)), parties);
      route(bobP.submitUpdate(cohortId, createSignedUpdate(bob.did, bob.keys)), parties);
      route(service.buildAndDistribute(cohortId), parties);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      // An ack with the field absent entirely (not merely a wrong hash) is not
      // consent to the current distribution and must be dropped.
      service.receive(createValidationAckMessage({
        from           : alice.did,
        to             : svc.did,
        cohortId,
        approved       : true,
        signalBytesHex : undefined as unknown as string,
      }));
      expect(service.validationProgress(cohortId).approved.size).to.equal(0);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      // Genuine acks still advance the cohort.
      route(aliceP.approveValidation(cohortId), parties);
      route(bobP.approveValidation(cohortId), parties);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);
    });
  });
});
