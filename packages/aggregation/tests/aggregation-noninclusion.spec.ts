import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { SchnorrMultikey } from '@did-btcr2/integrity';
import { SchnorrKeyPair } from '@did-btcr2/keys';
import {
  CACHED_ZERO,
  base64UrlToHash,
  blockHash,
  didToIndex,
  hashToBase64Url,
  leafValue,
  verifyProof,
  verifySerializedProof,
  zeroHashRoot,
} from '@did-btcr2/smt';
import { canonicalHash, canonicalHashBytes, encode } from '@did-btcr2/std';
import { hexToBytes, randomBytes } from '@noble/hashes/utils';
import { Script, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import {
  AggregationCohort,
  AggregationParticipant,
  AggregationService,
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  BaseMessage,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  createSubmitNonIncludedMessage,
  createSubmitUpdateMessage,
  KeyPairAggregationSigner,
  NONCE_CONTRIBUTION,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_NONINCLUDED,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
  getBeaconStrategy,
} from '../src/index.js';
import { DidBtcr2 } from '@did-btcr2/method';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

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
    invocationTarget   : did,
  };
  const multikey = SchnorrMultikey.fromSecretKey(verificationMethodId, did, keys.secretKey.bytes);
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config) as SignedBTCR2Update;
}

function buildDummyTx(outputScript: Uint8Array, prevOutValue: bigint, signal?: Uint8Array): Transaction {
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script: outputScript } });
  tx.addOutput({ script: outputScript, amount: prevOutValue - 500n });
  // A member binds its signing approval to the validated signal: include it in
  // an OP_RETURN so approveNonce accepts the tx.
  if(signal) tx.addOutput({ script: Script.encode([ 'RETURN', signal ]), amount: 0n });
  return tx;
}

/** Build a 2-participant cohort directly (no transport) for cohort/strategy unit tests. */
function directCohort(beaconType: string): { cohort: AggregationCohort; aliceDid: string; bobDid: string; alice: SchnorrKeyPair; bob: SchnorrKeyPair } {
  const alice = SchnorrKeyPair.generate();
  const bob = SchnorrKeyPair.generate();
  const aliceDid = DidBtcr2.create(alice.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const bobDid = DidBtcr2.create(bob.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const cohort = new AggregationCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType,
    recoveryKey      : hexToBytes(TEST_RECOVERY_KEY),
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  cohort.participants.push(aliceDid, bobDid);
  cohort.participantKeys.set(aliceDid, alice.publicKey.compressed);
  cohort.participantKeys.set(bobDid, bob.publicKey.compressed);
  cohort.cohortKeys = [alice.publicKey.compressed, bob.publicKey.compressed];
  return { cohort, aliceDid, bobDid, alice, bob };
}

describe('Aggregate beacon cooperative non-inclusion', () => {

  describe('AggregationCohort: response gate + builders', () => {
    it('hasAllResponses gates on updates + declines, not updates alone', () => {
      const { cohort, aliceDid, bobDid } = directCohort('CASBeacon');
      expect(cohort.hasAllResponses()).to.be.false;
      cohort.addUpdate(aliceDid, canonicalHash(createSignedUpdate(aliceDid, SchnorrKeyPair.generate())));
      expect(cohort.hasAllResponses()).to.be.false;
      cohort.addNonInclusion(bobDid);
      expect(cohort.hasAllResponses()).to.be.true;
      expect(cohort.hasAllUpdates()).to.be.false; // not all SUBMITTED
    });

    it('addNonInclusion rejects an unknown participant and a conflicting submitter', () => {
      const { cohort, aliceDid } = directCohort('CASBeacon');
      expect(() => cohort.addNonInclusion('did:btcr2:stranger')).to.throw(/UNKNOWN_PARTICIPANT|not in cohort/);
      cohort.addUpdate(aliceDid, canonicalHash(createSignedUpdate(aliceDid, SchnorrKeyPair.generate())));
      expect(() => cohort.addNonInclusion(aliceDid)).to.throw(/CONFLICTING_RESPONSE|already submitted/);
    });

    it('buildCASAnnouncement omits a decliner (absence is the non-inclusion signal)', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('CASBeacon');
      const updateHash = canonicalHash(createSignedUpdate(aliceDid, alice));
      cohort.addUpdate(aliceDid, updateHash);
      cohort.addNonInclusion(bobDid);
      const announcement = cohort.buildCASAnnouncement();
      // The map holds the updateHash as the member sent it.
      expect(announcement).to.deep.equal({ [aliceDid]: updateHash });
    });

    it('buildSMTTree leaves the index of a member that sent SUBMIT_NONINCLUDED empty', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('SMTBeacon');
      const nonce = randomBytes(32);
      const updateId = canonicalHashBytes(createSignedUpdate(aliceDid, alice));
      const aliceValue = leafValue(nonce, updateId);
      cohort.addUpdate(aliceDid, hashToBase64Url(aliceValue));
      cohort.addNonInclusion(bobDid);
      const proofs = cohort.buildSMTTree();

      // Every participant gets a proof, including the decliner.
      expect([...proofs.keys()]).to.have.members([aliceDid, bobDid]);
      // The root is the root of a tree with only the leaf of Alice.
      expect(cohort.signalBytes).to.deep.equal(zeroHashRoot([{ index: didToIndex(aliceDid), leaf: aliceValue }]));
      // The cohort has no nonce and no updateId, so no proof has them.
      for(const proof of proofs.values()) {
        expect(proof).to.have.all.keys('id', 'collapsed', 'hashes');
      }

      // The index of Bob is empty: its leaf value is cachedZero[0].
      expect(verifySerializedProof(proofs.get(bobDid)!, didToIndex(bobDid), CACHED_ZERO[0]!)).to.be.true;
      expect(verifyProof(proofs.get(bobDid)!, bobDid)).to.be.true;
      // `verifyProof` returns `true` for the proof of Alice only with the nonce and the updateId of Alice.
      expect(verifyProof({ ...proofs.get(aliceDid)!, nonce: encode(nonce), updateId: hashToBase64Url(updateId) }, aliceDid)).to.be.true;
      expect(verifyProof(proofs.get(aliceDid)!, aliceDid)).to.be.false;
    });

    it('buildSMTTree leaves an index empty if the member submits the value cachedZero[0]', () => {
      const { cohort, aliceDid, bobDid } = directCohort('SMTBeacon');
      const bobNonce = randomBytes(32);
      const bobValue = leafValue(bobNonce);
      cohort.addUpdate(aliceDid, hashToBase64Url(CACHED_ZERO[0]!));
      cohort.addUpdate(bobDid, hashToBase64Url(bobValue));
      const proofs = cohort.buildSMTTree();

      // The value of an empty leaf does not change the root.
      expect(cohort.signalBytes).to.deep.equal(zeroHashRoot([{ index: didToIndex(bobDid), leaf: bobValue }]));
      // `verifyProof` still returns `true` for the proof of Bob, and the index of Alice is empty.
      expect(verifyProof({ ...proofs.get(bobDid)!, nonce: encode(bobNonce) }, bobDid)).to.be.true;
      expect(verifyProof(proofs.get(aliceDid)!, aliceDid)).to.be.true;
    });
  });

  describe('beacon strategy: decliner validates its own slot', () => {
    it('CAS strategy matches a decliner iff it is absent from the map', () => {
      const strategy = getBeaconStrategy('CASBeacon')!;
      const body = { casAnnouncement: { 'did:btcr2:alice': 'aliceHash' } } as never;
      // Decliner (bob) is absent -> matches.
      expect(strategy.validateParticipantView({ participantDid: 'did:btcr2:bob', body }).matches).to.be.true;
      // A "decliner" that is actually present in the map -> does NOT match (forged).
      expect(strategy.validateParticipantView({ participantDid: 'did:btcr2:alice', body }).matches).to.be.false;
    });

    it('SMT strategy: a member with no update validates its slot with its own nonce', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('SMTBeacon');
      const strategy = getBeaconStrategy('SMTBeacon')!;
      const aliceSubmission = strategy.prepareSubmission(canonicalHashBytes(createSignedUpdate(aliceDid, alice)));
      const bobSubmission = strategy.prepareSubmission();
      cohort.addUpdate(aliceDid, aliceSubmission.updateHash!);
      cohort.addUpdate(bobDid, bobSubmission.updateHash!);
      const proofs = cohort.buildSMTTree();
      const smtBody = (did: string) => ({ smtProof: proofs.get(did)! as unknown as Record<string, unknown> }) as never;

      const bobResult = strategy.validateParticipantView({
        participantDid : bobDid,
        updateHash     : bobSubmission.updateHash,
        nonce          : bobSubmission.nonce,
        body           : smtBody(bobDid),
      });
      expect(bobResult.matches).to.be.true;
      // The SMT Proof that Bob keeps has his nonce and no updateId.
      expect(bobResult.smtProof!.nonce).to.equal(encode(bobSubmission.nonce!));
      expect(bobResult.smtProof!.updateId).to.be.undefined;

      // With the proof of Alice or with another nonce, the slot of Bob does not match.
      expect(strategy.validateParticipantView({ participantDid: bobDid, nonce: bobSubmission.nonce, body: smtBody(aliceDid) }).matches).to.be.false;
      expect(strategy.validateParticipantView({ participantDid: bobDid, nonce: randomBytes(32), body: smtBody(bobDid) }).matches).to.be.false;
      // A body with no SMT Proof does not match.
      expect(strategy.validateParticipantView({ participantDid: bobDid, nonce: bobSubmission.nonce, body: {} as never })).to.deep.equal({ matches: false });
    });

    it('SMT strategy ignores a nonce and an updateId that the service puts in the proof', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('SMTBeacon');
      const strategy = getBeaconStrategy('SMTBeacon')!;
      const updateId = canonicalHashBytes(createSignedUpdate(aliceDid, alice));
      const aliceSubmission = strategy.prepareSubmission(updateId);
      cohort.addUpdate(aliceDid, aliceSubmission.updateHash!);
      cohort.addNonInclusion(bobDid);
      const proof = cohort.buildSMTTree().get(aliceDid)!;
      const received = { ...proof, nonce: encode(randomBytes(32)), updateId: hashToBase64Url(randomBytes(32)) };

      const result = strategy.validateParticipantView({
        participantDid : aliceDid,
        updateHash     : aliceSubmission.updateHash,
        nonce          : aliceSubmission.nonce,
        updateId,
        body           : { smtProof: received } as never,
      });
      expect(result.matches).to.be.true;
      // The SMT Proof has the tree data of the service and the values of Alice.
      expect(result.smtProof).to.deep.equal({ ...proof, nonce: encode(aliceSubmission.nonce!), updateId: hashToBase64Url(updateId) });
    });
  });

  describe('beacon strategy: prepareSubmission', () => {
    it('CAS: the updateHash is the JSON Document Hash of the update, and for no update the strategy returns no updateHash', () => {
      const { aliceDid, alice } = directCohort('CASBeacon');
      const strategy = getBeaconStrategy('CASBeacon')!;
      const update = createSignedUpdate(aliceDid, alice);
      expect(strategy.prepareSubmission(canonicalHashBytes(update))).to.deep.equal({ updateHash: canonicalHash(update) });
      expect(strategy.prepareSubmission()).to.deep.equal({});
    });

    it('SMT: the member makes a new 256-bit nonce for each round, also for no update', () => {
      const { aliceDid, alice } = directCohort('SMTBeacon');
      const strategy = getBeaconStrategy('SMTBeacon')!;
      const updateId = canonicalHashBytes(createSignedUpdate(aliceDid, alice));
      const update = strategy.prepareSubmission(updateId);
      const noUpdate = strategy.prepareSubmission();
      expect(update.nonce).to.have.length(32);
      expect(noUpdate.nonce).to.have.length(32);
      // hash(hash(nonce) + updateId) for an update, hash(hash(nonce)) for no update.
      expect(update.updateHash).to.equal(hashToBase64Url(blockHash(blockHash(update.nonce!), updateId)));
      expect(noUpdate.updateHash).to.equal(hashToBase64Url(blockHash(blockHash(noUpdate.nonce!))));
      // For two rounds with the same update, the strategy returns two values.
      expect(strategy.prepareSubmission(updateId).updateHash).to.not.equal(update.updateHash);
    });
  });

  describe('end-to-end: a cohort with one submitter and one decliner', () => {
    let bus: MessageBus;
    let serviceTransport: MockTransport, aliceTransport: MockTransport, bobTransport: MockTransport;
    let service: AggregationService, alice: AggregationParticipant, bob: AggregationParticipant;
    let serviceDid: string, aliceDid: string, bobDid: string;
    let aliceKeys: SchnorrKeyPair, bobKeys: SchnorrKeyPair;

    beforeEach(() => {
      const serviceKeys = SchnorrKeyPair.generate();
      serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      aliceKeys = SchnorrKeyPair.generate();
      aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      bobKeys = SchnorrKeyPair.generate();
      bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });
      alice = new AggregationParticipant({ did: aliceDid, signer: new KeyPairAggregationSigner(aliceKeys) });
      bob = new AggregationParticipant({ did: bobDid, signer: new KeyPairAggregationSigner(bobKeys) });

      bus = new MessageBus();
      serviceTransport = new MockTransport(bus);
      aliceTransport = new MockTransport(bus);
      bobTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);
      aliceTransport.registerActor(aliceDid, aliceKeys);
      bobTransport.registerActor(bobDid, bobKeys);

      const wire = (t: MockTransport, did: string, machine: AggregationService | AggregationParticipant, types: string[]) => {
        for(const type of types) t.registerMessageHandler(did, type, msg => machine.receive(msg as never));
      };
      wire(serviceTransport, serviceDid, service, [
        COHORT_OPT_IN, SUBMIT_UPDATE, SUBMIT_NONINCLUDED, VALIDATION_ACK, NONCE_CONTRIBUTION, SIGNATURE_AUTHORIZATION,
      ]);
      const participantTypes = [
        COHORT_ADVERT, COHORT_OPT_IN_ACCEPT, COHORT_READY, DISTRIBUTE_AGGREGATED_DATA, AUTHORIZATION_REQUEST, AGGREGATED_NONCE,
      ];
      wire(aliceTransport, aliceDid, alice, participantTypes);
      wire(bobTransport, bobDid, bob, participantTypes);
    });

    async function send(transport: MockTransport, senderDid: string, msgs: { to?: string }[]) {
      for(const m of msgs) await transport.sendMessage(m as never, senderDid, m.to as never);
    }

    async function formCohort(beaconType: string): Promise<string> {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType, recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      await send(bobTransport, bobDid, bob.joinCohort(cohortId));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, aliceDid));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, bobDid));
      await send(serviceTransport, serviceDid, service.finalizeKeygen(cohortId));
      return cohortId;
    }

    async function driveSigningToComplete(cohortId: string): Promise<void> {
      const cohort = service.getCohort(cohortId)!;
      // The transaction spends the beacon output of the cohort.
      const script = cohort.beaconScript;
      const prevOutValue = 100000n;
      const tx = buildDummyTx(script, prevOutValue, cohort.signalBytes!);
      await send(serviceTransport, serviceDid, service.startSigning(cohortId, { tx, prevOutScripts: [script], prevOutValues: [prevOutValue] }));
      await send(aliceTransport, aliceDid, alice.approveNonce(cohortId));
      await send(bobTransport, bobDid, bob.approveNonce(cohortId));
      await send(serviceTransport, serviceDid, service.sendAggregatedNonce(cohortId));
      await send(aliceTransport, aliceDid, alice.generatePartialSignature(cohortId));
      await send(bobTransport, bobDid, bob.generatePartialSignature(cohortId));
    }

    it('CAS: decliner is absent from the map, validates absence, and still signs', async () => {
      const cohortId = await formCohort('CASBeacon');

      // Alice submits, and Bob declines. Alice sends only the JSON Document Hash of her update.
      const update = createSignedUpdate(aliceDid, aliceKeys);
      const aliceMessages = alice.submitUpdate(cohortId, update);
      expect(aliceMessages.map(m => m.type)).to.deep.equal([SUBMIT_UPDATE]);
      expect(aliceMessages[0]!.body).to.deep.equal({ cohortId, updateHash: canonicalHash(update) });
      await send(aliceTransport, aliceDid, aliceMessages);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CollectingUpdates);
      const bobMessages = bob.declineUpdate(cohortId);
      expect(bobMessages.map(m => m.type)).to.deep.equal([SUBMIT_NONINCLUDED]);
      await send(bobTransport, bobDid, bobMessages);
      // One update + one decline == all responses in.
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);
      expect(bob.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonIncluded);

      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));

      // Alice validates inclusion; Bob validates absence. Both match.
      expect(alice.getValidation(cohortId)?.matches).to.be.true;
      expect(alice.getValidation(cohortId)?.included).to.be.true;
      expect(bob.getValidation(cohortId)?.matches).to.be.true;
      expect(bob.getValidation(cohortId)?.included).to.be.false;

      // The on-chain CAS map commits to Alice only.
      const announcement = service.getCohort(cohortId)!.casAnnouncement!;
      expect(Object.keys(announcement)).to.deep.equal([aliceDid]);

      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      await send(bobTransport, bobDid, bob.approveValidation(cohortId));
      await driveSigningToComplete(cohortId);

      // The decliner signed: the cohort produces a complete aggregate signature.
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      expect(service.getResult(cohortId)?.signature).to.have.lengthOf(64);
    });

    it('SMT: a decliner sends SUBMIT_UPDATE with hash(hash(nonce)), validates its slot, and still signs', async () => {
      const cohortId = await formCohort('SMTBeacon');

      const update = createSignedUpdate(aliceDid, aliceKeys);
      const aliceMessages = alice.submitUpdate(cohortId, update);
      const bobMessages = bob.declineUpdate(cohortId);
      // The two messages have the same type and the same body fields, so the
      // service cannot tell an update from no update.
      for(const messages of [aliceMessages, bobMessages]) {
        expect(messages.map(m => m.type)).to.deep.equal([SUBMIT_UPDATE]);
        expect(messages[0]!.body).to.have.all.keys('cohortId', 'updateHash');
      }
      await send(aliceTransport, aliceDid, aliceMessages);
      await send(bobTransport, bobDid, bobMessages);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);
      expect(bob.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.NonIncluded);

      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));

      // Bob validated his slot with his own nonce: hash(hash(nonce)) is the value that he sent.
      const bobProof = bob.getValidation(cohortId)!.smtProof!;
      expect(bob.getValidation(cohortId)?.matches).to.be.true;
      expect(bob.getValidation(cohortId)?.included).to.be.false;
      expect(bobProof.updateId).to.be.undefined;
      expect(hashToBase64Url(blockHash(blockHash(base64UrlToHash(bobProof.nonce!))))).to.equal(bobMessages[0]!.body!.updateHash);
      // Alice validated her slot: the updateId is the hash of her update, and the leaf value is the value that she sent.
      const aliceProof = alice.getValidation(cohortId)!.smtProof!;
      expect(alice.getValidation(cohortId)?.matches).to.be.true;
      expect(aliceProof.updateId).to.equal(canonicalHash(update));
      expect(hashToBase64Url(leafValue(base64UrlToHash(aliceProof.nonce!), base64UrlToHash(aliceProof.updateId!))))
        .to.equal(aliceMessages[0]!.body!.updateHash);

      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      await send(bobTransport, bobDid, bob.approveValidation(cohortId));
      await driveSigningToComplete(cohortId);

      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      expect(service.getResult(cohortId)?.signature).to.have.lengthOf(64);
    });

    it('SMT: the service accepts SUBMIT_NONINCLUDED and leaves the index of the member empty', async () => {
      const cohortId = await formCohort('SMTBeacon');
      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, createSignedUpdate(aliceDid, aliceKeys)));
      // The library participant does not send SUBMIT_NONINCLUDED in an SMT cohort. Another implementation can.
      await send(bobTransport, bobDid, [createSubmitNonIncludedMessage({ from: bobDid, to: serviceDid, cohortId })]);
      expect(service.drainRejections(cohortId)).to.deep.equal([]);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);

      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));
      // `verifyProof` returns `true` for the proof of Bob with the value of an empty leaf. Alice validates her slot.
      expect(verifyProof(service.getCohort(cohortId)!.smtProofs!.get(bobDid)!, bobDid)).to.be.true;
      expect(alice.getValidation(cohortId)?.matches).to.be.true;
    });

    it('ignores a SUBMIT_NONINCLUDED with no cohortId, for an unknown cohort, or after all members answered', async () => {
      const cohortId = await formCohort('CASBeacon');
      service.receive(new BaseMessage({ type: SUBMIT_NONINCLUDED, from: bobDid, to: serviceDid, body: {} as never }));
      service.receive(createSubmitNonIncludedMessage({ from: bobDid, to: serviceDid, cohortId: 'unknown' }) as never);
      expect(service.getCohort(cohortId)!.nonIncluded.size).to.equal(0);

      await send(aliceTransport, aliceDid, alice.declineUpdate(cohortId));
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);
      service.receive(createSubmitNonIncludedMessage({ from: bobDid, to: serviceDid, cohortId }) as never);
      expect(service.drainRejections(cohortId)).to.deep.equal([]);
    });

    it('declineUpdate and submitUpdate refuse a cohort that is not in the CohortReady phase', async () => {
      const cohortId = await formCohort('SMTBeacon');
      expect(() => bob.declineUpdate('unknown')).to.throw(/not in CohortReady phase/);
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
      // A member answers one time in a round.
      expect(() => bob.declineUpdate(cohortId)).to.throw(/not in CohortReady phase/);
      expect(() => bob.submitUpdate(cohortId, createSignedUpdate(bobDid, bobKeys))).to.throw(/not in CohortReady phase/);
    });

    it('rejects a SUBMIT_NONINCLUDED from a non-member without failing the cohort', async () => {
      const cohortId = await formCohort('CASBeacon');
      const stranger = SchnorrKeyPair.generate();
      const strangerDid = DidBtcr2.create(stranger.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      // A non-member decline must be dropped as a rejection, never throw out of
      // receive() (which would fail the whole cohort, a DoS).
      service.receive(createSubmitNonIncludedMessage({ from: strangerDid, to: serviceDid, cohortId }) as never);
      const rejections = service.drainRejections(cohortId);
      expect(rejections.some(r => /not a member/i.test(r.reason))).to.be.true;
      expect(service.getCohortPhase(cohortId)).to.not.equal(ServiceCohortPhase.Failed);
    });

    it('rejects a second SUBMIT_UPDATE from a member that already responded', async () => {
      const cohortId = await formCohort('CASBeacon');
      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, createSignedUpdate(aliceDid, aliceKeys)));
      // A second (different) update from alice must not silently overwrite the first.
      service.receive(createSubmitUpdateMessage({ from: aliceDid, to: serviceDid, cohortId, updateHash: canonicalHash(createSignedUpdate(aliceDid, aliceKeys, 3)) }) as never);
      expect(service.drainRejections(cohortId).some(r => /already submitted/i.test(r.reason))).to.be.true;
    });

    it('rejects a SUBMIT_UPDATE from a member that already declined, and vice versa', async () => {
      const cohortId = await formCohort('CASBeacon');
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
      // decline then submit
      service.receive(createSubmitUpdateMessage({ from: bobDid, to: serviceDid, cohortId, updateHash: canonicalHash(createSignedUpdate(bobDid, bobKeys)) }) as never);
      expect(service.drainRejections(cohortId).some(r => /already declined/i.test(r.reason))).to.be.true;
      // a second decline is also rejected
      service.receive(createSubmitNonIncludedMessage({ from: bobDid, to: serviceDid, cohortId }) as never);
      expect(service.drainRejections(cohortId).some(r => /already responded/i.test(r.reason))).to.be.true;
    });

    it('a cohort where every member declines produces an empty CAS map and still signs', async () => {
      const cohortId = await formCohort('CASBeacon');
      await send(aliceTransport, aliceDid, alice.declineUpdate(cohortId));
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);

      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));
      expect(service.getCohort(cohortId)!.casAnnouncement).to.deep.equal({});
      expect(alice.getValidation(cohortId)?.matches).to.be.true;
      expect(bob.getValidation(cohortId)?.matches).to.be.true;

      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      await send(bobTransport, bobDid, bob.approveValidation(cohortId));
      await driveSigningToComplete(cohortId);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
    });
  });
});
