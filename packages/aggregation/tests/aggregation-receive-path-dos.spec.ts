import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { p2tr, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import { expect } from 'chai';
import type { BaseMessage } from '../src/index.js';
import {
  AggregationCohort,
  AggregationService,
  AggregationServiceRunner,
  BeaconSigningSession,
  MAX_RETAINED_REJECTIONS,
  ServiceCohortPhase,
  createCohortOptInMessage,
  createNonceContributionMessage,
  createSignatureAuthorizationMessage,
  createSubmitUpdateMessage,
  createValidationAckMessage,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;
const VALUE = 100_000n;

/** Three bytes: passes the `instanceof Uint8Array` wire guard, nothing else. */
const SHORT_PK = Uint8Array.from([0x02, 0x03, 0x04]);
/**
 * 33 bytes with a legal compressed prefix whose x coordinate (2^256-1) exceeds
 * the field modulus, so it is not a curve point. Passes a length check and only
 * fails once something tries to decode it.
 */
const NON_POINT_PK = Uint8Array.from([0x02, ...new Array<number>(32).fill(0xff)]);

function newDid(keys: SchnorrKeyPair): string {
  return DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
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

/**
 * A two-member cohort driven through the service state machine alone, with
 * every message delivered by hand so a test can inject one from an outsider.
 * `extraOptIns` are senders that opt in but are never accepted: a pending
 * opt-in is the state an attacker reaches unaided, since opt-ins are open to
 * anyone while a cohort is advertised.
 */
function formCohort(extraOptIns: Array<{ did: string; keys: SchnorrKeyPair }> = []) {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = newDid(serviceKeys);
  const keys = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
  const dids = keys.map(newDid);
  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });

  const cohortId = service.createCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  service.advertise(cohortId);

  const optIn = (did: string, k: SchnorrKeyPair) => service.receive(createCohortOptInMessage({
    from            : did,
    to              : serviceDid,
    cohortId,
    participantPk   : k.publicKey.compressed,
    communicationPk : k.publicKey.compressed,
  }));
  dids.forEach((did, i) => optIn(did, keys[i]!));
  extraOptIns.forEach(o => optIn(o.did, o.keys));
  dids.forEach(did => service.acceptParticipant(cohortId, did));
  service.finalizeKeygen(cohortId);

  const submit = (did: string, k: SchnorrKeyPair) => service.receive(createSubmitUpdateMessage({
    from         : did,
    to           : serviceDid,
    cohortId,
    signedUpdate : createSignedUpdate(did, k) as unknown as Record<string, unknown>,
  }));
  const ack = (did: string, approved = true) => service.receive(createValidationAckMessage({
    from : did, to : serviceDid, cohortId, approved,
  }));

  return { service, serviceDid, keys, dids, cohortId, submit, ack };
}

/**
 * A cohort parked at Advertised, so a test can hand it an opt-in of its own
 * making. Opt-ins are open while a cohort is advertised and cohort ids travel in
 * a broadcast advert, so this is the state any stranger reaches unaided.
 */
function advertisedCohort() {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = newDid(serviceKeys);
  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });

  const cohortId = service.createCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  service.advertise(cohortId);

  const optIn = (from: string, participantPk: Uint8Array, communicationPk: Uint8Array = participantPk) =>
    service.receive(createCohortOptInMessage({
      from, to : serviceDid, cohortId, participantPk, communicationPk,
    }));

  /** Two honest members opting in and being accepted, for the survival checks. */
  const members = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
  const memberDids = members.map(newDid);
  const formHonestly = () => {
    memberDids.forEach((did, i) => optIn(did, members[i]!.publicKey.compressed));
    memberDids.forEach(did => service.acceptParticipant(cohortId, did));
    return service.finalizeKeygen(cohortId);
  };

  return { service, serviceDid, cohortId, optIn, members, memberDids, formHonestly };
}

/** The same cohort, carried through validation into an open MuSig2 signing round. */
function toSigning() {
  const ctx = formCohort();
  const { service, cohortId, dids, keys, submit, ack } = ctx;
  dids.forEach((did, i) => submit(did, keys[i]!));
  service.buildAndDistribute(cohortId);
  dids.forEach(did => ack(did));

  const cohort = service.getCohort(cohortId)!;
  const payment = p2tr(musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys)));
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: VALUE, script: payment.script } });
  tx.addOutput({ script: payment.script, amount: VALUE - 500n });
  service.startSigning(cohortId, { tx, prevOutScripts: [payment.script], prevOutValues: [VALUE] });
  const sessionId = service.getSigningSessionId(cohortId)!;

  // Member-side sessions, so the test can produce real nonces and partial sigs.
  const sessions = dids.map(() => new BeaconSigningSession({
    cohort, pendingTx : tx, prevOutScripts : [payment.script], prevOutValues : [VALUE],
  }));
  const nonces = sessions.map((s, i) => s.generateNonceContribution(
    keys[i]!.publicKey.compressed, keys[i]!.secretKey.bytes,
  ));

  const sendNonce = (i: number, nonceContribution: Uint8Array = nonces[i]!, from = dids[i]!) =>
    service.receive(createNonceContributionMessage({
      from, to : ctx.serviceDid, cohortId, sessionId, nonceContribution,
    }));
  const sendPartialSig = (partialSignature: Uint8Array, from: string) =>
    service.receive(createSignatureAuthorizationMessage({
      from, to : ctx.serviceDid, cohortId, sessionId, partialSignature,
    }));
  /** Aggregate the nonces the service holds and hand them to the member sessions. */
  const openPartialSigRound = () => {
    service.sendAggregatedNonce(cohortId);
    const aggregatedNonce = musig2.nonceAggregate(nonces);
    sessions.forEach(s => { s.aggregatedNonce = aggregatedNonce; });
    return sessions.map((s, i) => s.generatePartialSignature(keys[i]!.secretKey.bytes));
  };

  return { ...ctx, sessionId, nonces, sendNonce, sendPartialSig, openPartialSigRound };
}

/** Drain and return only the rejection codes recorded for a cohort. */
function codes(service: AggregationService, cohortId: string): string[] {
  return service.drainRejections(cohortId).map(r => r.code);
}

describe('H5: one inbound message cannot kill a cohort', () => {

  describe('cohort formation and update collection', () => {
    it('drops a non-member VALIDATION_ACK instead of throwing, and the round still validates', () => {
      const { service, serviceDid, cohortId, dids, keys, submit, ack } = formCohort();
      dids.forEach((did, i) => submit(did, keys[i]!));
      service.buildAndDistribute(cohortId);
      service.drainRejections(cohortId);

      const outsider = newDid(SchnorrKeyPair.generate());
      expect(() => service.receive(createValidationAckMessage({
        from : outsider, to : serviceDid, cohortId, approved : true,
      }))).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['NOT_A_MEMBER']);
      expect(service.validationProgress(cohortId).approved.has(outsider)).to.be.false;
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      // The members' own acks still carry the cohort to Validated.
      dids.forEach(did => ack(did));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);
    });

    it('drops a SUBMIT_UPDATE from a pending opt-in that was never accepted', () => {
      const attackerKeys = SchnorrKeyPair.generate();
      const attackerDid = newDid(attackerKeys);
      const { service, serviceDid, cohortId, dids, keys, submit } = formCohort([{ did: attackerDid, keys: attackerKeys }]);

      // The update is genuinely signed by the sender's own opt-in key, so it
      // passes proof verification: only membership rules it out.
      expect(() => service.receive(createSubmitUpdateMessage({
        from         : attackerDid,
        to           : serviceDid,
        cohortId,
        signedUpdate : createSignedUpdate(attackerDid, attackerKeys) as unknown as Record<string, unknown>,
      }))).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['NOT_A_MEMBER']);
      expect(service.collectedUpdates(cohortId).has(attackerDid)).to.be.false;
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);

      dids.forEach((did, i) => submit(did, keys[i]!));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);
    });

    it('drops an update whose proof carries a non-string verificationMethod', () => {
      const { service, serviceDid, cohortId, dids, keys } = formCohort();
      const update = createSignedUpdate(dids[0]!, keys[0]!) as unknown as Record<string, unknown>;
      (update.proof as Record<string, unknown>).verificationMethod = 42;

      expect(() => service.receive(createSubmitUpdateMessage({
        from : dids[0]!, to : serviceDid, cohortId, signedUpdate : update,
      }))).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['UPDATE_VERIFICATION_FAILED']);
      expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.be.false;
    });

    it('counts a member VALIDATION_ACK once, so a retry cannot settle the round early', () => {
      const { service, cohortId, dids, keys, submit, ack } = formCohort();
      dids.forEach((did, i) => submit(did, keys[i]!));
      service.buildAndDistribute(cohortId);
      service.drainRejections(cohortId);

      ack(dids[0]!);
      // A retry with the opposite answer: counted twice it would satisfy
      // hasAllValidationResponses and fail the cohort while member 1 is pending.
      expect(() => ack(dids[0]!, false)).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['DUPLICATE_RESPONSE']);
      const progress = service.validationProgress(cohortId);
      expect(progress.approved.has(dids[0]!)).to.be.true;
      expect(progress.rejected.size).to.equal(0);
      expect([...progress.pending]).to.deep.equal([dids[1]!]);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);
    });
  });

  describe('opt-in keys', () => {
    it('rejects an opt-in whose participantPk is too short, and the cohort still forms', () => {
      const { service, cohortId, optIn, formHonestly } = advertisedCohort();
      const attackerDid = newDid(SchnorrKeyPair.generate());

      expect(() => optIn(attackerDid, SHORT_PK)).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['INVALID_PARTICIPANT_KEY']);
      // Nothing stored, so the key never reaches the sorted cohort key list.
      expect(service.pendingOptIns(cohortId).has(attackerDid)).to.be.false;
      expect(() => service.acceptParticipant(cohortId, attackerDid)).to.throw(/No pending opt-in/);

      expect(() => formHonestly()).to.not.throw();
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });

    it('rejects an opt-in whose 33-byte participantPk is not a curve point', () => {
      const { service, cohortId, optIn, formHonestly } = advertisedCohort();
      const attackerDid = newDid(SchnorrKeyPair.generate());

      expect(() => optIn(attackerDid, NON_POINT_PK)).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['INVALID_PARTICIPANT_KEY']);
      expect(service.pendingOptIns(cohortId).has(attackerDid)).to.be.false;
      expect(() => service.acceptParticipant(cohortId, attackerDid)).to.throw(/No pending opt-in/);

      // Key aggregation is where a 33-byte non-point detonates, so keygen is the
      // proof that none was retained.
      expect(() => formHonestly()).to.not.throw();
      expect(service.getCohort(cohortId)!.beaconAddress).to.match(/^tb1p/);
    });

    it('rejects an opt-in whose communicationPk is malformed', () => {
      const { service, cohortId, optIn, formHonestly } = advertisedCohort();
      const attackerKeys = SchnorrKeyPair.generate();
      const attackerDid = newDid(attackerKeys);

      expect(() => optIn(attackerDid, attackerKeys.publicKey.compressed, SHORT_PK)).to.not.throw();

      expect(codes(service, cohortId)).to.deep.equal(['INVALID_PARTICIPANT_KEY']);
      expect(service.pendingOptIns(cohortId).has(attackerDid)).to.be.false;

      // A stored communicationPk is handed to transport.registerPeer, which
      // refuses anything that is not a compressed key.
      expect(() => optIn(attackerDid, attackerKeys.publicKey.compressed, NON_POINT_PK)).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['INVALID_PARTICIPANT_KEY']);
      expect(service.pendingOptIns(cohortId).has(attackerDid)).to.be.false;

      expect(() => formHonestly()).to.not.throw();
    });

    it('keeps accepting honest opt-ins', () => {
      const { service, cohortId, optIn, members, memberDids } = advertisedCohort();
      memberDids.forEach((did, i) => optIn(did, members[i]!.publicKey.compressed));

      expect(service.drainRejections(cohortId)).to.be.empty;
      expect([...service.pendingOptIns(cohortId).keys()]).to.deep.equal(memberDids);

      memberDids.forEach(did => service.acceptParticipant(cohortId, did));
      const cohort = service.getCohort(cohortId)!;
      expect(cohort.participants).to.deep.equal(memberDids);
      expect(cohort.cohortKeys).to.have.length(2);

      service.finalizeKeygen(cohortId);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });

    it('leaves participants and cohort keys in step when acceptParticipant refuses', () => {
      const { service, cohortId, optIn, members, memberDids } = advertisedCohort();
      memberDids.forEach((did, i) => optIn(did, members[i]!.publicKey.compressed));

      // pendingOptIns hands back the live records the operator holds. The
      // receive path now refuses a malformed key on arrival, so this stands in
      // for a driver that supplies its own opt-in record (a resumed or
      // externally persisted cohort) and calls the operator action directly.
      const record = service.pendingOptIns(cohortId).get(memberDids[0]!)!;
      record.participantPk = SHORT_PK;

      expect(() => service.acceptParticipant(cohortId, memberDids[0]!)).to.throw(/compressed secp256k1/);

      // A cohort carrying more members than keys can never finish a signing
      // round: every round waits for one contribution per participant.
      const cohort = service.getCohort(cohortId)!;
      expect(cohort.participants).to.not.include(memberDids[0]!);
      expect(cohort.participants.length).to.equal(cohort.cohortKeys.length);
      expect(cohort.participantKeys.has(memberDids[0]!)).to.be.false;

      // The refusal is not sticky: with a real key the same DID still joins.
      record.participantPk = members[0]!.publicKey.compressed;
      expect(() => service.acceptParticipant(cohortId, memberDids[0]!)).to.not.throw();
      expect(() => service.acceptParticipant(cohortId, memberDids[1]!)).to.not.throw();
      expect(() => service.finalizeKeygen(cohortId)).to.not.throw();
    });

    it('refuses a 33-byte non-point at acceptParticipant rather than at keygen', () => {
      const { service, cohortId, optIn, members, memberDids } = advertisedCohort();
      memberDids.forEach((did, i) => optIn(did, members[i]!.publicKey.compressed));

      const record = service.pendingOptIns(cohortId).get(memberDids[0]!)!;
      record.participantPk = NON_POINT_PK;

      expect(() => service.acceptParticipant(cohortId, memberDids[0]!)).to.throw(/compressed secp256k1/);

      const cohort = service.getCohort(cohortId)!;
      expect(cohort.participants).to.not.include(memberDids[0]!);
      expect(cohort.participants.length).to.equal(cohort.cohortKeys.length);
    });

    it('a cohort refuses a key that is not a compressed secp256k1 point', () => {
      const cohort = new AggregationCohort({ network: 'mutinynet' });
      const good = SchnorrKeyPair.generate().publicKey.compressed;
      cohort.cohortKeys = [good];

      expect(() => { cohort.cohortKeys = [good, SHORT_PK]; }).to.throw(/compressed secp256k1/);
      expect(() => { cohort.cohortKeys = [good, NON_POINT_PK]; }).to.throw(/compressed secp256k1/);
      expect(cohort.cohortKeys).to.deep.equal([good]);
    });
  });

  describe('signing round', () => {
    it('drops a duplicate nonce contribution and keeps the first', () => {
      const { service, cohortId, dids, sendNonce, sendPartialSig, openPartialSigRound } = toSigning();
      sendNonce(0);
      // An innocent transport retry, indistinguishable from a hostile replay.
      expect(() => sendNonce(0)).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['DUPLICATE_RESPONSE']);

      // The round is untouched, and the retained nonce is the one the member
      // holds: it signs against the aggregate and the round completes.
      sendNonce(1);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.NoncesCollected);
      const sigs = openPartialSigRound();
      sigs.forEach((sig, i) => sendPartialSig(sig, dids[i]!));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    });

    it('rejects a malformed 66-byte nonce on arrival, and the sender can retry', () => {
      const { service, cohortId, sendNonce } = toSigning();
      sendNonce(0);

      // 66 bytes of filler: the length check passes, the points do not decode.
      expect(() => sendNonce(1, new Uint8Array(66).fill(7))).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['INVALID_NONCE']);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);

      // Nothing was stored for the sender, so a valid contribution still lands.
      sendNonce(1);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.NoncesCollected);
      expect(() => service.sendAggregatedNonce(cohortId)).to.not.throw();
    });

    it('rejects a wrong-length nonce contribution', () => {
      const { service, cohortId, sendNonce } = toSigning();
      expect(() => sendNonce(0, new Uint8Array(65))).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['INVALID_NONCE']);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
    });

    it('drops a nonce contribution from a non-member', () => {
      const { service, cohortId, sendNonce, nonces } = toSigning();
      const outsider = newDid(SchnorrKeyPair.generate());
      expect(() => sendNonce(0, nonces[0]!, outsider)).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['NOT_A_MEMBER']);
    });

    it('blames a bad partial signature instead of failing the round, and accepts the retry', () => {
      const { service, cohortId, dids, sendNonce, sendPartialSig, openPartialSigRound } = toSigning();
      sendNonce(0);
      sendNonce(1);
      const sigs = openPartialSigRound();
      service.drainRejections(cohortId);

      const corrupted = Uint8Array.from(sigs[0]!);
      corrupted[0] ^= 0xff;
      expect(() => sendPartialSig(corrupted, dids[0]!)).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['INVALID_PARTIAL_SIG']);

      // The honest member's contribution is unaffected, and the blamed member's
      // corrected signature still completes the round (BIP-327 §2.3.5).
      sendPartialSig(sigs[1]!, dids[1]!);
      expect(service.getResult(cohortId)).to.be.undefined;
      expect(() => sendPartialSig(sigs[0]!, dids[0]!)).to.not.throw();
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      expect(service.getResult(cohortId)!.signature).to.have.length(64);
    });

    it('drops a duplicate partial signature and keeps the first', () => {
      const { service, cohortId, dids, sendNonce, sendPartialSig, openPartialSigRound } = toSigning();
      sendNonce(0);
      sendNonce(1);
      const sigs = openPartialSigRound();
      service.drainRejections(cohortId);

      sendPartialSig(sigs[0]!, dids[0]!);
      expect(() => sendPartialSig(sigs[0]!, dids[0]!)).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['DUPLICATE_RESPONSE']);

      sendPartialSig(sigs[1]!, dids[1]!);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    });

    it('drops a partial signature from a non-member', () => {
      const { service, cohortId, sendNonce, sendPartialSig, openPartialSigRound } = toSigning();
      sendNonce(0);
      sendNonce(1);
      const sigs = openPartialSigRound();
      service.drainRejections(cohortId);

      const outsider = newDid(SchnorrKeyPair.generate());
      expect(() => sendPartialSig(sigs[0]!, outsider)).to.not.throw();
      expect(codes(service, cohortId)).to.deep.equal(['NOT_A_MEMBER']);
    });
  });

  describe('runner', () => {
    it('a non-member VALIDATION_ACK is surfaced as an event, not a cohort failure', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = newDid(serviceKeys);
      const members = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
      const memberDids = members.map(newDid);
      const attackerKeys = SchnorrKeyPair.generate();
      const attackerDid = newDid(attackerKeys);

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);
      const senderTransport = new MockTransport(bus);
      senderTransport.registerActor(memberDids[0]!, members[0]!);
      senderTransport.registerActor(memberDids[1]!, members[1]!);
      senderTransport.registerActor(attackerDid, attackerKeys);

      const runner = new AggregationServiceRunner({
        transport              : serviceTransport,
        did                    : serviceDid,
        keys                   : serviceKeys,
        onProvideTxData        : async () => { throw new Error('signing is not reached in this test'); },
        advertRepeatIntervalMs : 0,
      });
      const rejections: string[] = [];
      runner.on('message-rejected', r => rejections.push(r.code));
      runner.on('error', () => { /* a failed cohort would land here */ });

      const { cohortId, completion } = runner.advertiseCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      let settled: string | undefined;
      void completion.then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

      const send = async (message: BaseMessage, from: string) =>
        senderTransport.sendMessage(message, from, serviceDid);

      for(const [i, did] of memberDids.entries()) {
        await send(createCohortOptInMessage({
          from            : did,
          to              : serviceDid,
          cohortId,
          participantPk   : members[i]!.publicKey.compressed,
          communicationPk : members[i]!.publicKey.compressed,
        }), did);
      }
      for(const [i, did] of memberDids.entries()) {
        await send(createSubmitUpdateMessage({
          from         : did,
          to           : serviceDid,
          cohortId,
          signedUpdate : createSignedUpdate(did, members[i]!) as unknown as Record<string, unknown>,
        }), did);
      }
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      await send(createValidationAckMessage({
        from : attackerDid, to : serviceDid, cohortId, approved : true,
      }), attackerDid);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(rejections).to.deep.equal(['NOT_A_MEMBER']);
      // The cohort is still live: its state survived and nothing settled it.
      expect(settled, 'cohort completion settled').to.be.undefined;
      expect(runner.session.getCohort(cohortId)).to.exist;
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      runner.stop();
      await completion.catch(() => { /* rejected by stop() */ });
    });

    it('a malformed opt-in key is surfaced as an event, not a cohort failure', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = newDid(serviceKeys);
      const members = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
      const memberDids = members.map(newDid);
      const attackerKeys = SchnorrKeyPair.generate();
      const attackerDid = newDid(attackerKeys);

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);
      const senderTransport = new MockTransport(bus);
      senderTransport.registerActor(memberDids[0]!, members[0]!);
      senderTransport.registerActor(memberDids[1]!, members[1]!);
      senderTransport.registerActor(attackerDid, attackerKeys);

      const runner = new AggregationServiceRunner({
        transport              : serviceTransport,
        did                    : serviceDid,
        keys                   : serviceKeys,
        onProvideTxData        : async () => { throw new Error('signing is not reached in this test'); },
        advertRepeatIntervalMs : 0,
      });
      const rejections: string[] = [];
      runner.on('message-rejected', r => rejections.push(r.code));
      runner.on('error', () => { /* a failed cohort would land here */ });

      const { cohortId, completion } = runner.advertiseCohort({
        minParticipants  : 2,
        network          : 'mutinynet',
        beaconType       : 'CASBeacon',
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      let settled: string | undefined;
      void completion.then(() => { settled = 'resolved'; }, () => { settled = 'rejected'; });

      const send = async (message: BaseMessage, from: string) =>
        senderTransport.sendMessage(message, from, serviceDid);

      // The default accept policy takes everyone, so one opt-in is all it takes
      // to reach the sorted cohort key list.
      await send(createCohortOptInMessage({
        from            : attackerDid,
        to              : serviceDid,
        cohortId,
        participantPk   : SHORT_PK,
        communicationPk : attackerKeys.publicKey.compressed,
      }), attackerDid);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(rejections).to.deep.equal(['INVALID_PARTICIPANT_KEY']);
      expect(settled, 'cohort completion settled').to.be.undefined;
      expect(runner.session.getCohort(cohortId)).to.exist;
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Advertised);

      // The cohort is not merely alive, it still works: the honest members join
      // and keygen completes.
      for(const [i, did] of memberDids.entries()) {
        await send(createCohortOptInMessage({
          from            : did,
          to              : serviceDid,
          cohortId,
          participantPk   : members[i]!.publicKey.compressed,
          communicationPk : members[i]!.publicKey.compressed,
        }), did);
      }
      expect(runner.session.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
      expect(runner.session.getCohort(cohortId)!.participants).to.deep.equal(memberDids);

      runner.stop();
      await completion.catch(() => { /* rejected by stop() */ });
    });
  });

  describe('rejection bookkeeping', () => {
    it('bounds the retained rejection log', () => {
      const { service, serviceDid, cohortId } = formCohort();
      const outsider = newDid(SchnorrKeyPair.generate());
      const flood = MAX_RETAINED_REJECTIONS + 50;
      for(let i = 0; i < flood; i++) {
        service.receive(createSubmitUpdateMessage({
          from         : outsider,
          to           : serviceDid,
          cohortId,
          signedUpdate : { spam: i } as unknown as Record<string, unknown>,
        }));
      }
      expect(service.drainRejections(cohortId)).to.have.length(MAX_RETAINED_REJECTIONS);
    });
  });
});
