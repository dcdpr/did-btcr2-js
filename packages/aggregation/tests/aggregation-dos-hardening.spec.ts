import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { getNetwork } from '@did-btcr2/bitcoin';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { p2tr, Script, SigHash, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';

import {
  AGGREGATION_WIRE_VERSION,
  AggregationParticipant,
  AggregationParticipantRunner,
  AggregationService,
  AggregationServiceRunner,
  BaseMessage,
  BeaconSigningSession,
  COHORT_OPT_IN,
  DEFAULT_FUNDING_MODEL,
  DEFAULT_MAX_PARTICIPANTS,
  HttpServerTransport,
  InMemoryRateLimitStore,
  KeyPairAggregationSigner,
  NonceCache,
  ParticipantCohortPhase,
  RateLimiter,
  SILENT_LOGGER,
  SUBMIT_UPDATE,
  ServiceCohortPhase,
  buildRecoveryLeaves,
  buildRecoverySpend,
  createCohortAdvertMessage,
  createCohortOptInMessage,
  createNonceContributionMessage,
  createSignatureAuthorizationMessage,
  createSubmitUpdateMessage,
  createValidationAckMessage,
  signEnvelope,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';
import { beaconOutputScript } from './helpers/beacon-script.js';
import type { AggregationCohort, CohortConfig } from '../src/index.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

function makeIdentity(network = 'mutinynet'): { keys: SchnorrKeyPair; did: string } {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network });
  return { keys, did };
}

/** Cryptographically valid SignedBTCR2Update for a participant (real BIP-340 proof). */
function createSignedUpdate(
  did: string,
  keys: SchnorrKeyPair,
  opts?: { capabilityDid?: string },
): SignedBTCR2Update {
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
    targetVersionId : 2,
  } as UnsignedBTCR2Update;
  const config: Btcr2DataIntegrityConfig = {
    '@context'         : context,
    cryptosuite        : 'bip340-jcs-2025',
    type               : 'DataIntegrityProof',
    verificationMethod : `${did}#initialKey`,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(opts?.capabilityDid ?? did)}`,
    capabilityAction   : 'Write',
  };
  const multikey = SchnorrMultikey.fromSecretKey(`${did}#initialKey`, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config);
}

interface Fixture {
  service: AggregationService;
  cohortId: string;
  serviceId: { keys: SchnorrKeyPair; did: string };
  alice: { keys: SchnorrKeyPair; did: string };
  bob: { keys: SchnorrKeyPair; did: string };
}

/** Service with one advertised cohort and alice+bob accepted, keygen finalized (CohortSet). */
function driveToCohortSet(opts?: { preFinalizeOptIns?: Array<{ keys: SchnorrKeyPair; did: string }> }): Fixture {
  const serviceId = makeIdentity();
  const alice = makeIdentity();
  const bob = makeIdentity();
  const service = new AggregationService({ did: serviceId.did, publicKey: serviceId.keys.publicKey });
  const cohortId = service.createCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  service.advertise(cohortId);
  const optIn = (p: { keys: SchnorrKeyPair; did: string }): void => {
    service.receive(createCohortOptInMessage({
      from            : p.did,
      to              : serviceId.did,
      cohortId,
      participantPk   : p.keys.publicKey.compressed,
      communicationPk : p.keys.publicKey.compressed,
    }));
  };
  optIn(alice);
  optIn(bob);
  for(const extra of opts?.preFinalizeOptIns ?? []) optIn(extra);
  service.acceptParticipant(cohortId, alice.did);
  service.acceptParticipant(cohortId, bob.did);
  service.finalizeKeygen(cohortId);
  return { service, cohortId, serviceId, alice, bob };
}

/** CohortSet -> DataDistributed: both members submit valid updates, then build+distribute. */
function driveToDataDistributed(fx: Fixture): string {
  for(const p of [fx.alice, fx.bob]) {
    fx.service.receive(createSubmitUpdateMessage({
      from         : p.did,
      to           : fx.serviceId.did,
      cohortId     : fx.cohortId,
      signedUpdate : createSignedUpdate(p.did, p.keys) as unknown as Record<string, unknown>,
    }));
  }
  fx.service.buildAndDistribute(fx.cohortId);
  const signal = fx.service.getCohort(fx.cohortId)!.signalBytes!;
  return bytesToHex(signal);
}

/** DataDistributed -> Validated: both members ack the distributed signal. */
function driveToValidated(fx: Fixture): string {
  const signalBytesHex = driveToDataDistributed(fx);
  for(const p of [fx.alice, fx.bob]) {
    fx.service.receive(createValidationAckMessage({
      from     : p.did,
      to       : fx.serviceId.did,
      cohortId : fx.cohortId,
      approved : true,
      signalBytesHex,
    }));
  }
  return signalBytesHex;
}

/** The beacon output script the funded UTXO commits to (internal key + recovery tree). */
function beaconScript(fx: Fixture): Uint8Array {
  const cohort = fx.service.getCohort(fx.cohortId)!;
  const leaves = buildRecoveryLeaves(DEFAULT_FUNDING_MODEL, {
    recoveryKey       : hexToBytes(TEST_RECOVERY_KEY),
    recoverySequence  : TEST_RECOVERY_SEQUENCE,
    cohortKeys        : cohort.cohortKeys,
    fallbackThreshold : cohort.effectiveFallbackThreshold,
  });
  return p2tr(cohort.internalKey, leaves, getNetwork('mutinynet'), true).script;
}

/** Validated -> SigningStarted, with the service-side signing session in place. */
function driveToSigningStarted(fx: Fixture): { tx: Transaction; script: Uint8Array; value: bigint } {
  driveToValidated(fx);
  const script = beaconScript(fx);
  const value = 100000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { amount: value, script } });
  tx.addOutput({ script, amount: value - 500n });
  fx.service.startSigning(fx.cohortId, { tx, prevOutScripts: [script], prevOutValues: [value] });
  return { tx, script, value };
}

/** A minimal cohort config (CAS, mutinynet) for runner-driven tests. */
const CAS_CONFIG = (minParticipants = 1): CohortConfig => ({
  minParticipants,
  network          : 'mutinynet',
  beaconType       : 'CASBeacon',
  recoveryKey      : TEST_RECOVERY_KEY,
  recoverySequence : TEST_RECOVERY_SEQUENCE,
});

/** The well-formed beacon spend for a cohort (self-change + OP_RETURN signal). */
function dummyTxData(cohort: AggregationCohort): { tx: Transaction; prevOutScripts: Uint8Array[]; prevOutValues: bigint[] } {
  const script = beaconOutputScript(cohort);
  const prevOutValue = 100000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script } });
  tx.addOutput({ script, amount: prevOutValue - 500n });
  if(cohort.signalBytes) tx.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes ]), amount: 0n });
  return { tx, prevOutScripts: [ script ], prevOutValues: [ prevOutValue ] };
}

/** A service runner over the in-memory bus, driven via advertiseCohort. */
function makeServiceRunner(
  bus: MessageBus,
  opts: Partial<ConstructorParameters<typeof AggregationServiceRunner>[0]> = {},
): AggregationServiceRunner {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const transport = new MockTransport(bus);
  transport.registerActor(did, keys);
  // `runner` is referenced inside onProvideTxData, which only runs mid-protocol
  // (long after assignment), so the self-reference is safe.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    advertRepeatIntervalMs : 0,
    onProvideTxData        : async ({ cohortId }) => dummyTxData(runner.session.getCohort(cohortId)!),
    ...opts,
  });
  return runner;
}

/** A participant runner over the in-memory bus that joins and approves everything by default. */
function makeParticipantRunner(
  bus: MessageBus,
  overrides: Partial<ConstructorParameters<typeof AggregationParticipantRunner>[0]> = {},
): AggregationParticipantRunner {
  const keys = SchnorrKeyPair.generate();
  const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const transport = new MockTransport(bus);
  transport.registerActor(did, keys);
  return new AggregationParticipantRunner({
    transport,
    did,
    keys,
    shouldJoin      : async () => true,
    onProvideUpdate : async () => createSignedUpdate(did, keys),
    ...overrides,
  });
}

describe('Aggregation DoS + liveness hardening', () => {

  describe('non-member SUBMIT_UPDATE degrades to a rejection, not a cohort kill', () => {
    it('records UNKNOWN_PARTICIPANT and keeps the cohort alive', () => {
      const outsider = makeIdentity();
      // The outsider opted in (so their proof verifies against a known opt-in
      // key) but was never accepted into the cohort.
      const fx = driveToCohortSet({ preFinalizeOptIns: [outsider] });
      const update = createSignedUpdate(outsider.did, outsider.keys);

      expect(() => fx.service.receive(createSubmitUpdateMessage({
        from         : outsider.did,
        to           : fx.serviceId.did,
        cohortId     : fx.cohortId,
        signedUpdate : update as unknown as Record<string, unknown>,
      }))).to.not.throw();

      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections).to.have.lengthOf(1);
      expect(rejections[0]!.code).to.equal('UNKNOWN_PARTICIPANT');
      expect(rejections[0]!.from).to.equal(outsider.did);
      expect(fx.service.collectedUpdates(fx.cohortId).size).to.equal(0);
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });
  });

  describe('non-member VALIDATION_ACK degrades to a rejection', () => {
    it('records UNKNOWN_PARTICIPANT and keeps the cohort alive', () => {
      const outsider = makeIdentity();
      const fx = driveToCohortSet();
      const signalBytesHex = driveToDataDistributed(fx);

      expect(() => fx.service.receive(createValidationAckMessage({
        from     : outsider.did,
        to       : fx.serviceId.did,
        cohortId : fx.cohortId,
        approved : true,
        signalBytesHex,
      }))).to.not.throw();

      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('UNKNOWN_PARTICIPANT');
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.DataDistributed);
    });
  });

  describe('bad nonce contributions degrade to rejections', () => {
    it('duplicate nonce from a member records DUPLICATE_NONCE without throwing', () => {
      const fx = driveToCohortSet();
      const { tx, script, value } = driveToSigningStarted(fx);
      const cohort = fx.service.getCohort(fx.cohortId)!;
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      // A cryptographically real nonce: nonce points are validated at ingestion,
      // so random bytes no longer reach the duplicate check.
      const pAlice = new BeaconSigningSession({
        id : sessionId, cohort, pendingTx : tx, prevOutScripts : [script], prevOutValues : [value],
      });
      const nonce = pAlice.generateNonceContribution(fx.alice.keys.publicKey.compressed, fx.alice.keys.secretKey.bytes);
      const mk = (): ReturnType<typeof createNonceContributionMessage> => createNonceContributionMessage({
        from              : fx.alice.did,
        to                : fx.serviceId.did,
        cohortId          : fx.cohortId,
        sessionId,
        nonceContribution : nonce,
      });
      fx.service.receive(mk());
      expect(() => fx.service.receive(mk())).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('DUPLICATE_NONCE');
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
    });

    it('wrong-length nonce records INVALID_NONCE without throwing', () => {
      const fx = driveToCohortSet();
      driveToSigningStarted(fx);
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      expect(() => fx.service.receive(createNonceContributionMessage({
        from              : fx.alice.did,
        to                : fx.serviceId.did,
        cohortId          : fx.cohortId,
        sessionId,
        nonceContribution : randomBytes(10),
      }))).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('INVALID_NONCE');
    });

    it('nonce from a non-member records UNKNOWN_PARTICIPANT without throwing', () => {
      const outsider = makeIdentity();
      const fx = driveToCohortSet();
      driveToSigningStarted(fx);
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      expect(() => fx.service.receive(createNonceContributionMessage({
        from              : outsider.did,
        to                : fx.serviceId.did,
        cohortId          : fx.cohortId,
        sessionId,
        nonceContribution : randomBytes(66),
      }))).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('UNKNOWN_PARTICIPANT');
    });

    it('wrong-typed nonce body records INVALID_NONCE without throwing', () => {
      const fx = driveToCohortSet();
      driveToSigningStarted(fx);
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      expect(() => fx.service.receive(createNonceContributionMessage({
        from              : fx.alice.did,
        to                : fx.serviceId.did,
        cohortId          : fx.cohortId,
        sessionId,
        nonceContribution : 'not-bytes' as unknown as Uint8Array,
      }))).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('INVALID_NONCE');
    });
  });

  describe('bad partial signature triggers blame-and-exclude, then retry completes', () => {
    it('blames the defector, discards their sig, keeps the session open, and completes on resubmission', () => {
      const fx = driveToCohortSet();
      const { tx, script, value } = driveToSigningStarted(fx);
      const cohort = fx.service.getCohort(fx.cohortId)!;
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;

      // Participant-side sessions produce cryptographically real contributions.
      const mkSession = (): BeaconSigningSession => new BeaconSigningSession({
        id             : sessionId,
        cohort,
        pendingTx      : tx,
        prevOutScripts : [script],
        prevOutValues  : [value],
      });
      const pAlice = mkSession();
      const pBob = mkSession();

      const nonceAlice = pAlice.generateNonceContribution(fx.alice.keys.publicKey.compressed, fx.alice.keys.secretKey.bytes);
      const nonceBob = pBob.generateNonceContribution(fx.bob.keys.publicKey.compressed, fx.bob.keys.secretKey.bytes);
      for(const [p, nonce] of [[fx.alice, nonceAlice], [fx.bob, nonceBob]] as const) {
        fx.service.receive(createNonceContributionMessage({
          from              : p.did,
          to                : fx.serviceId.did,
          cohortId          : fx.cohortId,
          sessionId,
          nonceContribution : nonce,
        }));
      }
      const aggNonceMsgs = fx.service.sendAggregatedNonce(fx.cohortId);
      const aggregatedNonce = aggNonceMsgs[0]!.body!.aggregatedNonce as Uint8Array;
      pAlice.aggregatedNonce = aggregatedNonce;
      pBob.aggregatedNonce = aggregatedNonce;

      // Alice submits a garbage (well-formed length, invalid) partial signature.
      fx.service.receive(createSignatureAuthorizationMessage({
        from             : fx.alice.did,
        to               : fx.serviceId.did,
        cohortId         : fx.cohortId,
        sessionId,
        partialSignature : randomBytes(32),
      }));
      // Bob submits a real partial; with all contributions in, final aggregation
      // runs and MUST blame Alice rather than killing the cohort.
      const bobPartial = pBob.generatePartialSignature(fx.bob.keys.secretKey.bytes);
      expect(() => fx.service.receive(createSignatureAuthorizationMessage({
        from             : fx.bob.did,
        to               : fx.serviceId.did,
        cohortId         : fx.cohortId,
        sessionId,
        partialSignature : bobPartial,
      }))).to.not.throw();

      const rejections = fx.service.drainRejections(fx.cohortId);
      const blamed = rejections.find(r => r.code === 'BAD_PARTIAL_SIG');
      expect(blamed, 'BAD_PARTIAL_SIG rejection recorded').to.not.be.undefined;
      expect(blamed!.from).to.equal(fx.alice.did);

      // The cohort is still in AwaitingPartialSigs; Alice's bad sig was discarded,
      // Bob's good one retained.
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);
      expect(fx.service.getResult(fx.cohortId)).to.be.undefined;

      // Alice resubmits a correct partial; the cohort completes on the key path.
      const alicePartial = pAlice.generatePartialSignature(fx.alice.keys.secretKey.bytes);
      fx.service.receive(createSignatureAuthorizationMessage({
        from             : fx.alice.did,
        to               : fx.serviceId.did,
        cohortId         : fx.cohortId,
        sessionId,
        partialSignature : alicePartial,
      }));

      const result = fx.service.getResult(fx.cohortId);
      expect(result, 'cohort completed after resubmission').to.not.be.undefined;
      expect(result!.signature).to.have.lengthOf(64);
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.Complete);

      // The aggregated signature verifies against the tweaked beacon output key.
      const leaves = buildRecoveryLeaves(DEFAULT_FUNDING_MODEL, {
        recoveryKey       : hexToBytes(TEST_RECOVERY_KEY),
        recoverySequence  : TEST_RECOVERY_SEQUENCE,
        cohortKeys        : cohort.cohortKeys,
        fallbackThreshold : cohort.effectiveFallbackThreshold,
      });
      const payment = p2tr(cohort.internalKey, leaves, getNetwork('mutinynet'), true);
      const sighash = tx.preimageWitnessV1(0, [script], SigHash.DEFAULT, [value]);
      expect(schnorr.verify(result!.signature, sighash, payment.tweakedPubkey)).to.be.true;
    });

    it('duplicate partial signature records DUPLICATE_PARTIAL_SIG without throwing', () => {
      const fx = driveToCohortSet();
      const { tx, script, value } = driveToSigningStarted(fx);
      const cohort = fx.service.getCohort(fx.cohortId)!;
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      // Move the service-side session to AwaitingPartialSigs with real nonces
      // (musig2 validates pubnonces as curve points at aggregation time).
      const mkSession = (): BeaconSigningSession => new BeaconSigningSession({
        id : sessionId, cohort, pendingTx : tx, prevOutScripts : [script], prevOutValues : [value],
      });
      const n1 = mkSession().generateNonceContribution(fx.alice.keys.publicKey.compressed, fx.alice.keys.secretKey.bytes);
      const n2 = mkSession().generateNonceContribution(fx.bob.keys.publicKey.compressed, fx.bob.keys.secretKey.bytes);
      fx.service.receive(createNonceContributionMessage({ from: fx.alice.did, to: fx.serviceId.did, cohortId: fx.cohortId, sessionId, nonceContribution: n1 }));
      fx.service.receive(createNonceContributionMessage({ from: fx.bob.did, to: fx.serviceId.did, cohortId: fx.cohortId, sessionId, nonceContribution: n2 }));
      fx.service.sendAggregatedNonce(fx.cohortId);

      const mk = (): ReturnType<typeof createSignatureAuthorizationMessage> => createSignatureAuthorizationMessage({
        from             : fx.alice.did,
        to               : fx.serviceId.did,
        cohortId         : fx.cohortId,
        sessionId,
        partialSignature : randomBytes(32),
      });
      fx.service.receive(mk());
      expect(() => fx.service.receive(mk())).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('DUPLICATE_PARTIAL_SIG');
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);
    });
  });

  describe('single-message cohort-kill vectors degrade to recorded rejections', () => {
    it('malformed SUBMIT_UPDATE proof (truthy non-string verificationMethod) records UPDATE_MALFORMED', () => {
      const fx = driveToCohortSet();
      const attacker = makeIdentity();
      // The exact Opus-reproduced vector: previously a raw TypeError out of
      // receive() -> failCohort. The boundary guard must drop it instead.
      expect(() => fx.service.receive(new BaseMessage({
        type : SUBMIT_UPDATE,
        from : attacker.did,
        to   : fx.serviceId.did,
        body : {
          cohortId     : fx.cohortId,
          signedUpdate : { proof: { verificationMethod: 1, proofValue: 1 } },
        },
      }))).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections).to.have.lengthOf(1);
      expect(rejections[0]!.code).to.equal('UPDATE_MALFORMED');
      expect(rejections[0]!.from).to.equal(attacker.did);
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });

    it('COHORT_OPT_IN with a valid communicationPk but malformed participantPk records OPT_IN_MALFORMED', () => {
      const serviceId = makeIdentity();
      const service = new AggregationService({ did: serviceId.did, publicKey: serviceId.keys.publicKey });
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      service.advertise(cohortId);
      const attacker = makeIdentity();
      // A non-33-byte participantPk previously reached sortKeys via the
      // auto-accept path and threw the cohort into failure.
      expect(() => service.receive(createCohortOptInMessage({
        from            : attacker.did,
        to              : serviceId.did,
        cohortId,
        participantPk   : new Uint8Array([1, 2, 3]),
        communicationPk : attacker.keys.publicKey.compressed,
      }))).to.not.throw();
      expect(service.pendingOptIns(cohortId).size).to.equal(0);
      const rejections = service.drainRejections(cohortId);
      expect(rejections).to.have.lengthOf(1);
      expect(rejections[0]!.code).to.equal('OPT_IN_MALFORMED');
      expect(rejections[0]!.from).to.equal(attacker.did);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Advertised);
    });

    it('COHORT_OPT_IN with a 33-byte off-curve participantPk records OPT_IN_MALFORMED', () => {
      const serviceId = makeIdentity();
      const service = new AggregationService({ did: serviceId.did, publicKey: serviceId.keys.publicKey });
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      service.advertise(cohortId);
      const attacker = makeIdentity();
      expect(() => service.receive(createCohortOptInMessage({
        from            : attacker.did,
        to              : serviceId.did,
        cohortId,
        participantPk   : new Uint8Array(33).fill(0xff),
        communicationPk : attacker.keys.publicKey.compressed,
      }))).to.not.throw();
      expect(service.pendingOptIns(cohortId).size).to.equal(0);
      const rejections = service.drainRejections(cohortId);
      expect(rejections.map(r => r.code)).to.include('OPT_IN_MALFORMED');
    });

    it('COHORT_OPT_IN with non-byte keys is dropped at the boundary as OPT_IN_MALFORMED', () => {
      const serviceId = makeIdentity();
      const service = new AggregationService({ did: serviceId.did, publicKey: serviceId.keys.publicKey });
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      service.advertise(cohortId);
      const attacker = makeIdentity();
      expect(() => service.receive(createCohortOptInMessage({
        from            : attacker.did,
        to              : serviceId.did,
        cohortId,
        participantPk   : 'not-bytes' as unknown as Uint8Array,
        communicationPk : attacker.keys.publicKey.compressed,
      }))).to.not.throw();
      expect(service.pendingOptIns(cohortId).size).to.equal(0);
      const rejections = service.drainRejections(cohortId);
      expect(rejections.map(r => r.code)).to.include('OPT_IN_MALFORMED');
    });

    it('wrong-length partial signature records INVALID_PARTIAL_SIG without throwing', () => {
      const fx = driveToCohortSet();
      const { tx, script, value } = driveToSigningStarted(fx);
      const cohort = fx.service.getCohort(fx.cohortId)!;
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      // Real nonces move the service session to AwaitingPartialSigs.
      const mkSession = (): BeaconSigningSession => new BeaconSigningSession({
        id : sessionId, cohort, pendingTx : tx, prevOutScripts : [script], prevOutValues : [value],
      });
      const n1 = mkSession().generateNonceContribution(fx.alice.keys.publicKey.compressed, fx.alice.keys.secretKey.bytes);
      const n2 = mkSession().generateNonceContribution(fx.bob.keys.publicKey.compressed, fx.bob.keys.secretKey.bytes);
      fx.service.receive(createNonceContributionMessage({ from: fx.alice.did, to: fx.serviceId.did, cohortId: fx.cohortId, sessionId, nonceContribution: n1 }));
      fx.service.receive(createNonceContributionMessage({ from: fx.bob.did, to: fx.serviceId.did, cohortId: fx.cohortId, sessionId, nonceContribution: n2 }));
      fx.service.sendAggregatedNonce(fx.cohortId);

      // A 64-byte partial previously escaped musig2 as an untyped throw.
      expect(() => fx.service.receive(createSignatureAuthorizationMessage({
        from             : fx.alice.did,
        to               : fx.serviceId.did,
        cohortId         : fx.cohortId,
        sessionId,
        partialSignature : randomBytes(64),
      }))).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('INVALID_PARTIAL_SIG');
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);
    });

    it('a 66-byte nonce that is not valid curve points records INVALID_NONCE without throwing', () => {
      const fx = driveToCohortSet();
      driveToSigningStarted(fx);
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      // Passes the 66-byte length check but decodes to non-points: previously
      // threw raw out of musig2 nonceAggregate at aggregation time.
      const notPoints = new Uint8Array(66).fill(0xff);
      expect(() => fx.service.receive(createNonceContributionMessage({
        from              : fx.alice.did,
        to                : fx.serviceId.did,
        cohortId          : fx.cohortId,
        sessionId,
        nonceContribution : notPoints,
      }))).to.not.throw();
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('INVALID_NONCE');
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
    });
  });

  describe('correctly-signed envelopes carrying malformed bodies (HTTP runner path)', () => {
    /** A service runner wired to an HTTP server transport with DID-aware sender resolution. */
    function makeHttpServiceRunner(): {
      serviceId: { keys: SchnorrKeyPair; did: string };
      transport: HttpServerTransport;
      runner: AggregationServiceRunner;
      } {
      const serviceId = makeIdentity();
      const transport = new HttpServerTransport({
        logger              : SILENT_LOGGER,
        heartbeatIntervalMs : 0,
        resolveSenderPk     : resolveBtcr2SenderPk,
      });
      transport.registerActor(serviceId.did, serviceId.keys);
      const runner = new AggregationServiceRunner({
        transport,
        did             : serviceId.did,
        keys            : serviceId.keys,
        onProvideTxData : async () => { throw new Error('tx data not needed in this test'); },
      });
      return { serviceId, transport, runner };
    }

    /** Post a signed envelope to the transport's messages route. */
    async function postSigned(
      transport: HttpServerTransport,
      sender: { keys: SchnorrKeyPair; did: string },
      message: Record<string, unknown>,
      to: string,
    ): Promise<number> {
      const envelope = signEnvelope(message as never, { did: sender.did, keys: sender.keys }, { to });
      const res = await transport.handleRequest({
        method  : 'POST',
        url     : '/v1/messages',
        headers : {},
        body    : JSON.stringify(envelope),
      });
      return res.status;
    }

    it('malformed SUBMIT_UPDATE body: recorded rejection, cohort survives, runner never fails', async () => {
      const { serviceId, transport, runner } = makeHttpServiceRunner();
      const { cohortId, completion } = runner.advertiseCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      let settled = false;
      void completion.then(() => { settled = true; }, () => { settled = true; });

      // Drive the cohort to CohortSet on the state machine (two honest members).
      const alice = makeIdentity();
      const bob = makeIdentity();
      for(const p of [alice, bob]) {
        runner.session.receive(createCohortOptInMessage({
          from            : p.did,
          to              : serviceId.did,
          cohortId,
          participantPk   : p.keys.publicKey.compressed,
          communicationPk : p.keys.publicKey.compressed,
        }));
      }
      runner.session.acceptParticipant(cohortId, alice.did);
      runner.session.acceptParticipant(cohortId, bob.did);
      runner.session.finalizeKeygen(cohortId);

      const errors: Error[] = [];
      const rejected: Array<{ code: string }> = [];
      runner.on('error', e => errors.push(e));
      runner.on('message-rejected', r => rejected.push(r));

      // The attacker's envelope is correctly signed and authenticates (k1 DID);
      // the carried body is the malformed payload.
      const attacker = makeIdentity();
      const status = await postSigned(transport, attacker, {
        type    : SUBMIT_UPDATE,
        version : AGGREGATION_WIRE_VERSION,
        from    : attacker.did,
        to      : serviceId.did,
        body    : { cohortId, signedUpdate: { proof: { verificationMethod: 1, proofValue: 1 } } },
      }, serviceId.did);

      expect(status, 'envelope verified and accepted by the transport').to.equal(202);
      expect(errors, 'runner never surfaced an error').to.have.lengthOf(0);
      expect(rejected.map(r => r.code)).to.include('UPDATE_MALFORMED');
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
      expect(settled, 'cohort completion never settled').to.be.false;
      runner.stop();
      transport.stop();
    });

    it('malformed COHORT_OPT_IN participantPk: recorded rejection, auto-accept never fires', async () => {
      const { serviceId, transport, runner } = makeHttpServiceRunner();
      const { cohortId, completion } = runner.advertiseCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      let settled = false;
      void completion.then(() => { settled = true; }, () => { settled = true; });

      const errors: Error[] = [];
      const rejected: Array<{ code: string }> = [];
      runner.on('error', e => errors.push(e));
      runner.on('message-rejected', r => rejected.push(r));

      const attacker = makeIdentity();
      const status = await postSigned(transport, attacker, {
        type    : COHORT_OPT_IN,
        version : AGGREGATION_WIRE_VERSION,
        from    : attacker.did,
        to      : serviceId.did,
        body    : {
          cohortId,
          participantPk   : new Uint8Array([1, 2, 3]),
          communicationPk : attacker.keys.publicKey.compressed,
        },
      }, serviceId.did);

      expect(status).to.equal(202);
      expect(errors).to.have.lengthOf(0);
      expect(rejected.map(r => r.code)).to.include('OPT_IN_MALFORMED');
      expect(runner.session.pendingOptIns(cohortId).size).to.equal(0);
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Advertised);
      expect(settled).to.be.false;
      runner.stop();
      transport.stop();
    });
  });

  describe('blame budget bounds the retry loop; session errors never wedge', () => {
    /** CohortSet -> AwaitingPartialSigs with real nonces; returns the participant-side sessions. */
    function driveToAwaitingPartialSigs(fx: Fixture): {
      sessionId: string;
      pAlice: BeaconSigningSession;
      pBob: BeaconSigningSession;
    } {
      const { tx, script, value } = driveToSigningStarted(fx);
      const cohort = fx.service.getCohort(fx.cohortId)!;
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      const mkSession = (): BeaconSigningSession => new BeaconSigningSession({
        id : sessionId, cohort, pendingTx : tx, prevOutScripts : [script], prevOutValues : [value],
      });
      const pAlice = mkSession();
      const pBob = mkSession();
      const nonceAlice = pAlice.generateNonceContribution(fx.alice.keys.publicKey.compressed, fx.alice.keys.secretKey.bytes);
      const nonceBob = pBob.generateNonceContribution(fx.bob.keys.publicKey.compressed, fx.bob.keys.secretKey.bytes);
      for(const [p, nonce] of [[fx.alice, nonceAlice], [fx.bob, nonceBob]] as const) {
        fx.service.receive(createNonceContributionMessage({
          from              : p.did,
          to                : fx.serviceId.did,
          cohortId          : fx.cohortId,
          sessionId,
          nonceContribution : nonce,
        }));
      }
      const aggNonceMsgs = fx.service.sendAggregatedNonce(fx.cohortId);
      const aggregatedNonce = aggNonceMsgs[0]!.body!.aggregatedNonce as Uint8Array;
      pAlice.aggregatedNonce = aggregatedNonce;
      pBob.aggregatedNonce = aggregatedNonce;
      return { sessionId, pAlice, pBob };
    }

    function partialMsg(
      fx: Fixture,
      from: string,
      sessionId: string,
      partialSignature: Uint8Array,
    ): ReturnType<typeof createSignatureAuthorizationMessage> {
      return createSignatureAuthorizationMessage({
        from,
        to       : fx.serviceId.did,
        cohortId : fx.cohortId,
        sessionId,
        partialSignature,
      });
    }

    it('a persistent defector exhausts the blame budget and the cohort escalates to fallback', () => {
      const fx = driveToCohortSet();
      const { sessionId, pBob } = driveToAwaitingPartialSigs(fx);

      // Bob contributes a genuine partial once; it is retained across rewinds.
      const bobPartial = pBob.generatePartialSignature(fx.bob.keys.secretKey.bytes);
      fx.service.receive(partialMsg(fx, fx.bob.did, sessionId, bobPartial));

      // Alice (the defector) resubmits garbage: blamed and rewound twice, then
      // treated as a defector - no fourth rewind, no unbounded loop.
      const garbage = randomBytes(32);
      for(let round = 0; round < 3; round++) {
        expect(() => fx.service.receive(partialMsg(fx, fx.alice.did, sessionId, garbage))).to.not.throw();
      }

      const rejections = fx.service.drainRejections(fx.cohortId);
      const blames = rejections.filter(r => r.code === 'BAD_PARTIAL_SIG');
      expect(blames).to.have.lengthOf(3);
      expect(blames.every(r => r.from === fx.alice.did)).to.be.true;
      expect(blames[2]!.reason).to.match(/defector/);

      // The round is flagged for fallback rather than stalling open-ended.
      expect(fx.service.isFallbackRequired(fx.cohortId)).to.be.true;
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);
      expect(fx.service.getResult(fx.cohortId)).to.be.undefined;

      // The deliberate way out engages and clears the flag.
      const fallbackMsgs = fx.service.startFallbackSigning(fx.cohortId);
      expect(fallbackMsgs.length).to.be.greaterThan(0);
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
      expect(fx.service.isFallbackRequired(fx.cohortId)).to.be.false;
    });

    it('a non-BAD_PARTIAL_SIG session error discards the culprit and never wedges the round', () => {
      const fx = driveToCohortSet();
      const { sessionId, pAlice, pBob } = driveToAwaitingPartialSigs(fx);
      const cohort = fx.service.getCohort(fx.cohortId)!;
      // Corrupt the cohort view: Bob's accepted key goes missing, so final
      // aggregation fails with UNKNOWN_PARTICIPANT_KEY (a SigningSessionError
      // that is not BAD_PARTIAL_SIG) naming Bob.
      cohort.participantKeys.delete(fx.bob.did);

      const alicePartial = pAlice.generatePartialSignature(fx.alice.keys.secretKey.bytes);
      const bobPartial = pBob.generatePartialSignature(fx.bob.keys.secretKey.bytes);
      fx.service.receive(partialMsg(fx, fx.alice.did, sessionId, alicePartial));
      expect(() => fx.service.receive(partialMsg(fx, fx.bob.did, sessionId, bobPartial))).to.not.throw();

      let rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('SESSION_ERROR');
      expect(rejections.find(r => r.code === 'SESSION_ERROR')!.from).to.equal(fx.bob.did);
      // No wedge: Bob's contribution was discarded and the session rewound.
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);
      expect(fx.service.getResult(fx.cohortId)).to.be.undefined;

      // Proof the session is not stuck in PartialSignaturesReceived: Alice's
      // resubmission is a typed DUPLICATE (pre-fix it hit INVALID_PHASE).
      fx.service.receive(partialMsg(fx, fx.alice.did, sessionId, alicePartial));
      rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('DUPLICATE_PARTIAL_SIG');

      // Bob's retries keep failing against the same budget and then escalate.
      fx.service.receive(partialMsg(fx, fx.bob.did, sessionId, bobPartial));
      fx.service.receive(partialMsg(fx, fx.bob.did, sessionId, bobPartial));
      expect(fx.service.isFallbackRequired(fx.cohortId)).to.be.true;
      expect(fx.service.getCohortPhase(fx.cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);
    });

    it('the service runner auto-commits to the fallback path once the blame budget is exhausted', async () => {
      const bus = new MessageBus();
      const serviceId = makeIdentity();
      const serviceTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceId.did, serviceId.keys);
      const runner = new AggregationServiceRunner({
        transport              : serviceTransport,
        did                    : serviceId.did,
        keys                   : serviceId.keys,
        advertRepeatIntervalMs : 0,
        onProvideTxData        : async () => { throw new Error('tx data not needed in this test'); },
      });
      const { cohortId, completion } = runner.advertiseCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      void completion.catch(() => undefined);

      // Drive the runner's state machine to AwaitingPartialSigs directly.
      const alice = makeIdentity();
      const bob = makeIdentity();
      for(const p of [alice, bob]) {
        runner.session.receive(createCohortOptInMessage({
          from            : p.did,
          to              : serviceId.did,
          cohortId,
          participantPk   : p.keys.publicKey.compressed,
          communicationPk : p.keys.publicKey.compressed,
        }));
      }
      runner.session.acceptParticipant(cohortId, alice.did);
      runner.session.acceptParticipant(cohortId, bob.did);
      runner.session.finalizeKeygen(cohortId);
      for(const p of [alice, bob]) {
        runner.session.receive(createSubmitUpdateMessage({
          from         : p.did,
          to           : serviceId.did,
          cohortId,
          signedUpdate : createSignedUpdate(p.did, p.keys) as unknown as Record<string, unknown>,
        }));
      }
      runner.session.buildAndDistribute(cohortId);
      const signalBytesHex = bytesToHex(runner.session.getCohort(cohortId)!.signalBytes!);
      for(const p of [alice, bob]) {
        runner.session.receive(createValidationAckMessage({
          from : p.did, to : serviceId.did, cohortId, approved : true, signalBytesHex,
        }));
      }
      const cohort = runner.session.getCohort(cohortId)!;
      const script = beaconOutputScript(cohort);
      const value = 100000n;
      const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
      tx.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { amount: value, script } });
      tx.addOutput({ script, amount: value - 500n });
      runner.session.startSigning(cohortId, { tx, prevOutScripts: [script], prevOutValues: [value] });
      const sessionId = runner.session.getSigningSessionId(cohortId)!;
      const mkSession = (): BeaconSigningSession => new BeaconSigningSession({
        id : sessionId, cohort, pendingTx : tx, prevOutScripts : [script], prevOutValues : [value],
      });
      const pAlice = mkSession();
      const pBob = mkSession();
      const nonceAlice = pAlice.generateNonceContribution(alice.keys.publicKey.compressed, alice.keys.secretKey.bytes);
      const nonceBob = pBob.generateNonceContribution(bob.keys.publicKey.compressed, bob.keys.secretKey.bytes);
      for(const [p, nonce] of [[alice, nonceAlice], [bob, nonceBob]] as const) {
        runner.session.receive(createNonceContributionMessage({
          from : p.did, to : serviceId.did, cohortId, sessionId, nonceContribution : nonce,
        }));
      }
      const aggNonceMsgs = runner.session.sendAggregatedNonce(cohortId);
      pBob.aggregatedNonce = aggNonceMsgs[0]!.body!.aggregatedNonce as Uint8Array;

      // From here on, partial signatures arrive over the bus so the runner's
      // handlers - and its auto-fallback wiring - execute.
      const aliceTransport = new MockTransport(bus);
      aliceTransport.registerActor(alice.did, alice.keys);
      const bobTransport = new MockTransport(bus);
      bobTransport.registerActor(bob.did, bob.keys);
      const fallbackStarted = new Promise<string>(resolve => {
        runner.once('fallback-started', ({ cohortId: id }) => resolve(id));
      });

      const bobPartial = pBob.generatePartialSignature(bob.keys.secretKey.bytes);
      await bobTransport.sendMessage(
        createSignatureAuthorizationMessage({ from: bob.did, to: serviceId.did, cohortId, sessionId, partialSignature: bobPartial }),
        bob.did,
        serviceId.did,
      );
      const garbage = randomBytes(32);
      for(let round = 0; round < 3; round++) {
        await aliceTransport.sendMessage(
          createSignatureAuthorizationMessage({ from: alice.did, to: serviceId.did, cohortId, sessionId, partialSignature: garbage }),
          alice.did,
          serviceId.did,
        );
      }

      const flaggedCohort = await fallbackStarted;
      expect(flaggedCohort).to.equal(cohortId);
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.FallbackRequested);
      runner.stop();
    });
  });


  describe('pending opt-ins are bounded per cohort', () => {
    it('drops opt-ins past maxPendingOptIns with OPT_IN_OVERFLOW', () => {
      const serviceId = makeIdentity();
      const service = new AggregationService({
        did              : serviceId.did,
        publicKey        : serviceId.keys.publicKey,
        maxPendingOptIns : 2,
      });
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      service.advertise(cohortId);
      for(let i = 0; i < 3; i++) {
        const p = makeIdentity();
        service.receive(createCohortOptInMessage({
          from            : p.did,
          to              : serviceId.did,
          cohortId,
          participantPk   : p.keys.publicKey.compressed,
          communicationPk : p.keys.publicKey.compressed,
        }));
      }
      expect(service.pendingOptIns(cohortId).size).to.equal(2);
      const rejections = service.drainRejections(cohortId);
      expect(rejections).to.have.lengthOf(1);
      expect(rejections[0]!.code).to.equal('OPT_IN_OVERFLOW');
    });

    it('accepted and operator-rejected opt-ins free pending capacity', () => {
      const serviceId = makeIdentity();
      const service = new AggregationService({
        did              : serviceId.did,
        publicKey        : serviceId.keys.publicKey,
        maxPendingOptIns : 2,
      });
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      service.advertise(cohortId);
      const [a, b, c, d, e] = Array.from({ length: 5 }, () => makeIdentity());
      const optIn = (p: { keys: SchnorrKeyPair; did: string }): void => {
        service.receive(createCohortOptInMessage({
          from            : p.did,
          to              : serviceId.did,
          cohortId,
          participantPk   : p.keys.publicKey.compressed,
          communicationPk : p.keys.publicKey.compressed,
        }));
      };
      optIn(a);
      optIn(b);                                   // pending: a, b (at cap)
      service.acceptParticipant(cohortId, a.did); // accept frees a's slot -> pending: b
      optIn(c);                                   // admitted -> pending: b, c
      service.rejectParticipant(cohortId, b.did); // operator reject frees b's slot -> pending: c
      optIn(d);                                   // admitted -> pending: c, d
      optIn(e);                                   // genuinely at cap -> overflow
      expect(service.pendingOptIns(cohortId).size).to.equal(2);
      expect(service.pendingOptIns(cohortId).has(c.did)).to.be.true;
      expect(service.pendingOptIns(cohortId).has(d.did)).to.be.true;
      const rejections = service.drainRejections(cohortId);
      expect(rejections).to.have.lengthOf(1);
      expect(rejections[0]!.code).to.equal('OPT_IN_OVERFLOW');
      expect(rejections[0]!.from).to.equal(e.did);
    });

    it('acceptParticipant enforces the default participant ceiling when none is advertised', () => {
      const serviceId = makeIdentity();
      const service = new AggregationService({ did: serviceId.did, publicKey: serviceId.keys.publicKey });
      const cohortId = service.createCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      service.advertise(cohortId);
      const optInAndAccept = (p: { keys: SchnorrKeyPair; did: string }): void => {
        service.receive(createCohortOptInMessage({
          from            : p.did,
          to              : serviceId.did,
          cohortId,
          participantPk   : p.keys.publicKey.compressed,
          communicationPk : p.keys.publicKey.compressed,
        }));
        service.acceptParticipant(cohortId, p.did);
      };
      for(let i = 0; i < DEFAULT_MAX_PARTICIPANTS; i++) optInAndAccept(makeIdentity());
      const extra = makeIdentity();
      service.receive(createCohortOptInMessage({
        from            : extra.did,
        to              : serviceId.did,
        cohortId,
        participantPk   : extra.keys.publicKey.compressed,
        communicationPk : extra.keys.publicKey.compressed,
      }));
      expect(() => service.acceptParticipant(cohortId, extra.did)).to.throw(/full/);
    });
  });

  describe('participant cohort-state map is bounded and prunable', () => {
    const serviceId = makeIdentity();
    const mkAdvert = (cohortId: string): ReturnType<typeof createCohortAdvertMessage> => createCohortAdvertMessage({
      from             : serviceId.did,
      cohortId,
      network          : 'mutinynet',
      minParticipants  : 2,
      beaconType       : 'CASBeacon',
      recoveryKey      : TEST_RECOVERY_KEY,
      recoverySequence : TEST_RECOVERY_SEQUENCE,
      communicationPk  : serviceId.keys.publicKey.compressed,
    });

    it('at capacity, evicts the oldest Discovered-phase entry to make room', () => {
      const me = makeIdentity();
      const participant = new AggregationParticipant({
        did        : me.did,
        signer     : new KeyPairAggregationSigner(me.keys),
        maxCohorts : 2,
      });
      participant.receive(mkAdvert('c1'));
      participant.receive(mkAdvert('c2'));
      // At capacity: c1 (the oldest not-yet-joined entry) is evicted for c3,
      // so an advert flood cannot permanently starve discovery of new cohorts.
      participant.receive(mkAdvert('c3'));
      expect(participant.discoveredCohorts.size).to.equal(2);
      expect(participant.discoveredCohorts.has('c1')).to.be.false;
      expect(participant.discoveredCohorts.has('c2')).to.be.true;
      expect(participant.discoveredCohorts.has('c3')).to.be.true;
    });

    it('never evicts a joined cohort; drops the new advert when every retained cohort is joined', () => {
      const me = makeIdentity();
      const participant = new AggregationParticipant({
        did        : me.did,
        signer     : new KeyPairAggregationSigner(me.keys),
        maxCohorts : 2,
      });
      participant.receive(mkAdvert('c1'));
      participant.receive(mkAdvert('c2'));
      participant.joinCohort('c1');
      // c2 is the only Discovered entry: evicted for c3; the joined c1 survives.
      participant.receive(mkAdvert('c3'));
      expect(participant.getCohortPhase('c1')).to.equal(ParticipantCohortPhase.OptedIn);
      expect(participant.discoveredCohorts.has('c2')).to.be.false;
      expect(participant.discoveredCohorts.has('c3')).to.be.true;
      // With every retained cohort joined, a new advert is still dropped.
      participant.joinCohort('c3');
      participant.receive(mkAdvert('c4'));
      expect(participant.getCohortPhase('c4')).to.be.undefined;
      expect(participant.getCohortPhase('c1')).to.equal(ParticipantCohortPhase.OptedIn);
      expect(participant.getCohortPhase('c3')).to.equal(ParticipantCohortPhase.OptedIn);
    });

    it('leaveCohort frees capacity and is a no-op for unknown cohorts', () => {
      const me = makeIdentity();
      const participant = new AggregationParticipant({
        did        : me.did,
        signer     : new KeyPairAggregationSigner(me.keys),
        maxCohorts : 2,
      });
      participant.receive(mkAdvert('c1'));
      participant.receive(mkAdvert('c2'));
      participant.leaveCohort('c1');
      participant.leaveCohort('does-not-exist');
      participant.receive(mkAdvert('c3'));
      expect(participant.discoveredCohorts.size).to.equal(2);
      expect(participant.discoveredCohorts.has('c3')).to.be.true;
      expect(participant.discoveredCohorts.has('c1')).to.be.false;
    });
  });

  describe('participant runner reclaims cohort-state slots', () => {
    it('drops the cohort state when shouldJoin rejects the advert', async () => {
      const bus = new MessageBus();
      const service = makeServiceRunner(bus);
      const participant = makeParticipantRunner(bus, { shouldJoin: async () => false });
      await participant.start();
      const { cohortId, completion } = service.advertiseCohort(CAS_CONFIG());
      void completion.catch(() => undefined);
      // Let the advert propagate and the async shouldJoin decision land.
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(participant.session.getCohortPhase(cohortId), 'rejected advert leaves no cohort state').to.be.undefined;
      expect(participant.session.discoveredCohorts.size).to.equal(0);
      participant.stop();
      service.stop();
    });

    it('drops the cohort state once the cohort completes', async () => {
      const bus = new MessageBus();
      const service = makeServiceRunner(bus);
      const participant = makeParticipantRunner(bus);
      await participant.start();
      const completed = new Promise<void>(resolve => participant.once('cohort-complete', () => resolve()));
      const { cohortId } = service.advertiseCohort(CAS_CONFIG());
      await completed;
      // leaveCohort runs synchronously after the cohort-complete emission.
      expect(participant.session.getCohortPhase(cohortId), 'completed cohort state reclaimed').to.be.undefined;
      participant.stop();
      service.stop();
    });

    it('drops the cohort state when the member rejects the aggregated data', async () => {
      const bus = new MessageBus();
      const service = makeServiceRunner(bus);
      const participant = makeParticipantRunner(bus, { onValidateData: async () => ({ approved: false }) });
      await participant.start();
      const failed = new Promise<void>(resolve => participant.once('cohort-failed', () => resolve()));
      const { cohortId, completion } = service.advertiseCohort(CAS_CONFIG());
      void completion.catch(() => undefined);
      await failed;
      // leaveCohort runs synchronously after the cohort-failed emission.
      expect(participant.session.getCohortPhase(cohortId), 'failed cohort state reclaimed').to.be.undefined;
      participant.stop();
      service.stop();
    });
  });

  describe('participant runner forwards bounds to the state machine', () => {
    const svc = makeIdentity();
    const mkAdvert = (cohortId: string): ReturnType<typeof createCohortAdvertMessage> => createCohortAdvertMessage({
      from             : svc.did,
      cohortId,
      network          : 'mutinynet',
      minParticipants  : 2,
      beaconType       : 'CASBeacon',
      recoveryKey      : TEST_RECOVERY_KEY,
      recoverySequence : TEST_RECOVERY_SEQUENCE,
      communicationPk  : svc.keys.publicKey.compressed,
    });

    it('forwards maxCohorts', () => {
      const me = makeIdentity();
      const transport = new MockTransport(new MessageBus());
      transport.registerActor(me.did, me.keys);
      const runner = new AggregationParticipantRunner({
        transport,
        did             : me.did,
        keys            : me.keys,
        maxCohorts      : 1,
        onProvideUpdate : async () => null,
      });
      runner.session.receive(mkAdvert('c1'));
      runner.session.receive(mkAdvert('c2'));
      expect(runner.session.discoveredCohorts.size).to.equal(1);
      expect(runner.session.discoveredCohorts.has('c2'), 'oldest Discovered evicted').to.be.true;
      runner.stop();
    });

    it('forwards maxFeeSats (the member refuses a fee above the ceiling)', async () => {
      const bus = new MessageBus();
      const service = makeServiceRunner(bus, { phaseTimeoutMs: 5_000 });
      // The dummy tx pays a 500-sat fee; cap the member at 100 sats.
      const participant = makeParticipantRunner(bus, { maxFeeSats: 100n });
      await participant.start();
      const feeError = new Promise<Error>(resolve => participant.on('error', e => {
        if((e as { type?: string }).type === 'FEE_TOO_HIGH') resolve(e);
      }));
      const { completion } = service.advertiseCohort(CAS_CONFIG());
      void completion.catch(() => undefined);
      await feeError;
      participant.stop();
      service.stop();
    });
  });

  describe('rate-limiter bucket store is bounded', () => {
    it('evicts stale buckets first when the backstop is hit', () => {
      const store = new InMemoryRateLimitStore(2, 1000);
      const limiter = new RateLimiter({ store, rps: 1, burst: 5 });
      limiter.consume('old-key', 1000);
      limiter.consume('hot-key', 2900);
      limiter.consume('new-key', 3000);
      expect(store.size()).to.equal(2);
      expect(store.get('old-key'), 'stale bucket evicted').to.be.undefined;
      expect(store.get('hot-key'), 'hot bucket retained').to.not.be.undefined;
      expect(store.get('new-key'), 'new bucket retained').to.not.be.undefined;
    });

    it('falls back to oldest-inserted eviction when every bucket is hot', () => {
      const store = new InMemoryRateLimitStore(2, 60_000);
      const limiter = new RateLimiter({ store, rps: 1, burst: 5 });
      limiter.consume('a', 5000);
      limiter.consume('b', 5000);
      limiter.consume('c', 5000);
      expect(store.size()).to.equal(2);
      expect(store.get('a'), 'oldest-inserted evicted').to.be.undefined;
      expect(store.get('b')).to.not.be.undefined;
      expect(store.get('c')).to.not.be.undefined;
    });
  });

  describe('nonce cache per-DID buckets + timestamp expiry', () => {
    it('a flooding DID is refused past its own bucket; no DID evicts another\'s live entries', () => {
      const cache = new NonceCache({ maxPerDid: 2, maxEntries: 100, nowSec: () => 1000 });
      cache.store('victim', 'v1', 1000);
      cache.store('victim', 'v2', 1000);
      // Flooder churns well past its per-DID cap: the first two admissions
      // succeed, the rest are refused (fail-closed) rather than evicting live
      // entries.
      const admissions: boolean[] = [];
      for(let i = 0; i < 10; i++) admissions.push(cache.store('flooder', `f${i}`, 1000));
      expect(admissions.slice(0, 2)).to.deep.equal([true, true]);
      expect(admissions.slice(2).every(a => !a), 'past-cap admissions refused').to.be.true;
      // Victim entries survive; their replay protection is intact.
      expect(cache.store('victim', 'v1', 1000)).to.be.false;
      expect(cache.store('victim', 'v2', 1000)).to.be.false;
      // The flooder's own live entries were never evicted either.
      expect(cache.store('flooder', 'f0', 1000), 'flooder entry retained').to.be.false;
      expect(cache.store('flooder', 'f1', 1000), 'flooder entry retained').to.be.false;
    });

    it('expired entries are purged before any live entry is evicted under global pressure', () => {
      const cache = new NonceCache({ maxEntries: 2, windowSec: 100, nowSec: () => 10_000 });
      cache.store('x', 'stale', 9800); // older than now - window: expired
      cache.store('y', 'live', 9950);  // inside the window
      cache.store('z', 'new', 9990);   // forces eviction; purges the expired entry
      expect(cache.store('y', 'live', 9991), 'live entry still replay-protected').to.be.false;
      expect(cache.size()).to.equal(2);
    });

    it('new admissions are rejected at maxEntries when nothing is expired (never evict live entries)', () => {
      const cache = new NonceCache({ maxEntries: 2, windowSec: 10_000, nowSec: () => 1000 });
      expect(cache.store('a', 'n1', 1000)).to.be.true;
      expect(cache.store('b', 'n2', 1000)).to.be.true;
      // Full of live in-window entries: the novel admission is refused
      // (fail-closed) instead of evicting a victim's entry and reopening its
      // replay window.
      expect(cache.store('c', 'n3', 1000)).to.be.false;
      expect(cache.size()).to.equal(2);
      // Both live entries retain their replay protection.
      expect(cache.store('a', 'n1', 1000), 'oldest entry retained').to.be.false;
      expect(cache.store('b', 'n2', 1000), 'younger entry retained').to.be.false;
    });
  });

  describe('HTTP body cap clears the largest legitimate envelope', () => {
    it('accepts a body above the old 64 KiB cap for parsing (rejects as invalid JSON, not 413)', async () => {
      const transport = new HttpServerTransport();
      const res = await transport.handleRequest({
        method  : 'POST',
        url     : '/v1/messages',
        headers : {},
        body    : 'x'.repeat(100 * 1024),
      });
      expect(res.status).to.equal(400);
    });

    it('still rejects a body above the update-cap-derived ceiling', async () => {
      const transport = new HttpServerTransport();
      const res = await transport.handleRequest({
        method  : 'POST',
        url     : '/v1/messages',
        headers : {},
        body    : 'x'.repeat(400 * 1024),
      });
      expect(res.status).to.equal(413);
    });

    it('honors an explicit maxBodyBytes override', async () => {
      const transport = new HttpServerTransport({ maxBodyBytes: 1024 });
      const res = await transport.handleRequest({
        method  : 'POST',
        url     : '/v1/messages',
        headers : {},
        body    : 'x'.repeat(2048),
      });
      expect(res.status).to.equal(413);
    });
  });

  describe('buildRecoverySpend zeroizes the consumed recovery secret', () => {
    const kp = SchnorrKeyPair.generate();
    const recoveryKey = schnorr.getPublicKey(kp.secretKey.bytes);
    const spendParams = (secret: Uint8Array): Parameters<typeof buildRecoverySpend>[0] => ({
      cohortKeys         : [SchnorrKeyPair.generate().publicKey.compressed, SchnorrKeyPair.generate().publicKey.compressed],
      recoverySecretKey  : secret,
      recoveryKey,
      recoverySequence   : TEST_RECOVERY_SEQUENCE,
      network            : 'bitcoin',
      utxo               : { txid: 'aa'.repeat(32), vout: 0, value: 100000n },
      destinationAddress : p2tr(schnorr.getPublicKey(SchnorrKeyPair.generate().secretKey.bytes), undefined, getNetwork('bitcoin')).address!,
      fee                : 400n,
    });

    it('wipes the secret buffer after a successful build', () => {
      const secret = kp.secretKey.bytes;
      const tx = buildRecoverySpend(spendParams(secret));
      expect(tx.getInput(0).finalScriptWitness, 'finalized witness').to.not.be.undefined;
      expect([...secret].every(b => b === 0), 'secret zeroized').to.be.true;
    });

    it('wipes a mismatched secret buffer before throwing', () => {
      const wrong = SchnorrKeyPair.generate().secretKey.bytes;
      expect(() => buildRecoverySpend(spendParams(wrong))).to.throw(/RECOVERY_KEY_MISMATCH|does not correspond/);
      expect([...wrong].every(b => b === 0), 'secret zeroized').to.be.true;
    });
  });

  describe('update proof capability must name the sender DID', () => {
    it('drops a validly-signed update whose root capability names a different DID', () => {
      const victim = makeIdentity();
      const fx = driveToCohortSet();
      // Alice signs correctly (her key, her verificationMethod), but the proof
      // invokes the root capability of the victim's DID, not her own.
      const update = createSignedUpdate(fx.alice.did, fx.alice.keys, { capabilityDid: victim.did });
      fx.service.receive(createSubmitUpdateMessage({
        from         : fx.alice.did,
        to           : fx.serviceId.did,
        cohortId     : fx.cohortId,
        signedUpdate : update as unknown as Record<string, unknown>,
      }));
      const rejections = fx.service.drainRejections(fx.cohortId);
      expect(rejections.map(r => r.code)).to.include('UPDATE_VERIFICATION_FAILED');
      expect(fx.service.collectedUpdates(fx.cohortId).has(fx.alice.did)).to.be.false;
    });

    it('accepts an update whose root capability names the sender DID', () => {
      const fx = driveToCohortSet();
      const update = createSignedUpdate(fx.alice.did, fx.alice.keys, { capabilityDid: fx.alice.did });
      fx.service.receive(createSubmitUpdateMessage({
        from         : fx.alice.did,
        to           : fx.serviceId.did,
        cohortId     : fx.cohortId,
        signedUpdate : update as unknown as Record<string, unknown>,
      }));
      expect(fx.service.collectedUpdates(fx.cohortId).has(fx.alice.did)).to.be.true;
    });
  });
});
