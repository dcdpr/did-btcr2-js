import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { getNetwork } from '@did-btcr2/bitcoin';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { p2tr, SigHash, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';

import {
  AggregationParticipant,
  AggregationService,
  BeaconSigningSession,
  DEFAULT_FUNDING_MODEL,
  HttpServerTransport,
  InMemoryRateLimitStore,
  KeyPairAggregationSigner,
  NonceCache,
  RateLimiter,
  ServiceCohortPhase,
  buildRecoveryLeaves,
  buildRecoverySpend,
  createCohortAdvertMessage,
  createCohortOptInMessage,
  createNonceContributionMessage,
  createSignatureAuthorizationMessage,
  createSubmitUpdateMessage,
  createValidationAckMessage,
} from '../src/index.js';

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
  opts?: { docId?: string },
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
    ...(opts?.docId ? { id: opts.docId } : {}),
  } as UnsignedBTCR2Update;
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

describe('Aggregation DoS + liveness hardening', () => {

  describe('H6: non-member SUBMIT_UPDATE degrades to a rejection, not a cohort kill', () => {
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

  describe('H6: non-member VALIDATION_ACK degrades to a rejection', () => {
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

  describe('H6: bad nonce contributions degrade to rejections', () => {
    it('duplicate nonce from a member records DUPLICATE_NONCE without throwing', () => {
      const fx = driveToCohortSet();
      driveToSigningStarted(fx);
      const sessionId = fx.service.getSigningSessionId(fx.cohortId)!;
      const nonce = randomBytes(66);
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

  describe('M3: bad partial signature triggers blame-and-exclude, then retry completes', () => {
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

  describe('M6: pending opt-ins are bounded per cohort', () => {
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
  });

  describe('M6: participant cohort-state map is bounded and prunable', () => {
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

    it('ignores new adverts past maxCohorts', () => {
      const me = makeIdentity();
      const participant = new AggregationParticipant({
        did        : me.did,
        signer     : new KeyPairAggregationSigner(me.keys),
        maxCohorts : 2,
      });
      participant.receive(mkAdvert('c1'));
      participant.receive(mkAdvert('c2'));
      participant.receive(mkAdvert('c3'));
      expect(participant.discoveredCohorts.size).to.equal(2);
      expect(participant.discoveredCohorts.has('c3')).to.be.false;
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

  describe('M6: rate-limiter bucket store is bounded', () => {
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

  describe('L18: nonce cache per-DID buckets + timestamp expiry', () => {
    it('a flooding DID evicts only its own entries, never another DID\'s live entries', () => {
      const cache = new NonceCache({ maxPerDid: 2, maxEntries: 100, nowSec: () => 1000 });
      cache.store('victim', 'v1', 1000);
      cache.store('victim', 'v2', 1000);
      // Flooder churns well past its per-DID cap.
      for(let i = 0; i < 10; i++) cache.store('flooder', `f${i}`, 1000);
      // Victim entries survive; their replay protection is intact.
      expect(cache.store('victim', 'v1', 1000)).to.be.false;
      expect(cache.store('victim', 'v2', 1000)).to.be.false;
      // Flooder retained only its most recent 2.
      expect(cache.store('flooder', 'f0', 1000), 'oldest flooder entry evicted').to.be.true;
      expect(cache.store('flooder', 'f9', 1000), 'newest flooder entry retained').to.be.false;
    });

    it('expired entries are purged before any live entry is evicted under global pressure', () => {
      const cache = new NonceCache({ maxEntries: 2, windowSec: 100, nowSec: () => 10_000 });
      cache.store('x', 'stale', 9800); // older than now - window: expired
      cache.store('y', 'live', 9950);  // inside the window
      cache.store('z', 'new', 9990);   // forces eviction; purges the expired entry
      expect(cache.store('y', 'live', 9991), 'live entry still replay-protected').to.be.false;
      expect(cache.size()).to.equal(2);
    });

    it('global FIFO backstop still applies when nothing is expired', () => {
      const cache = new NonceCache({ maxEntries: 2, windowSec: 10_000, nowSec: () => 1000 });
      cache.store('a', 'n1', 1000);
      cache.store('b', 'n2', 1000);
      cache.store('c', 'n3', 1000);
      expect(cache.size()).to.equal(2);
      // Check retention BEFORE probing the evicted entry: a replay probe
      // re-inserts and would itself force an eviction.
      expect(cache.store('b', 'n2', 1000), 'younger entry retained').to.be.false;
      expect(cache.store('a', 'n1', 1000), 'oldest entry was evicted').to.be.true;
    });
  });

  describe('L17: HTTP body cap clears the largest legitimate envelope', () => {
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

  describe('L16: buildRecoverySpend zeroizes the consumed recovery secret', () => {
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

  describe('L19: update document id must match the sender DID', () => {
    it('drops a validly-signed update whose document id names a different DID', () => {
      const victim = makeIdentity();
      const fx = driveToCohortSet();
      // Alice signs correctly (her key, her verificationMethod), but the update
      // document carries the victim's DID as its id.
      const update = createSignedUpdate(fx.alice.did, fx.alice.keys, { docId: victim.did });
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

    it('accepts an update whose document id matches the sender DID', () => {
      const fx = driveToCohortSet();
      const update = createSignedUpdate(fx.alice.did, fx.alice.keys, { docId: fx.alice.did });
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
