import type { DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { base64UrlToHash, blockHash, didToIndex, verifySerializedProof } from '@did-btcr2/smt';
import { hexToBytes } from '@noble/hashes/utils';
import { p2tr, Script, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import { expect } from 'chai';
import {
  AggregationCohort,
  AggregationParticipant,
  AggregationService,
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
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
  const config: DataIntegrityConfig = {
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
      cohort.addUpdate(aliceDid, createSignedUpdate(aliceDid, SchnorrKeyPair.generate()));
      expect(cohort.hasAllResponses()).to.be.false;
      cohort.addNonInclusion(bobDid);
      expect(cohort.hasAllResponses()).to.be.true;
      expect(cohort.hasAllUpdates()).to.be.false; // not all SUBMITTED
    });

    it('addNonInclusion rejects an unknown participant and a conflicting submitter', () => {
      const { cohort, aliceDid } = directCohort('CASBeacon');
      expect(() => cohort.addNonInclusion('did:btcr2:stranger')).to.throw(/UNKNOWN_PARTICIPANT|not in cohort/);
      cohort.addUpdate(aliceDid, createSignedUpdate(aliceDid, SchnorrKeyPair.generate()));
      expect(() => cohort.addNonInclusion(aliceDid)).to.throw(/CONFLICTING_RESPONSE|already submitted/);
    });

    it('buildCASAnnouncement omits a decliner (absence is the non-inclusion signal)', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('CASBeacon');
      cohort.addUpdate(aliceDid, createSignedUpdate(aliceDid, alice));
      cohort.addNonInclusion(bobDid);
      const announcement = cohort.buildCASAnnouncement();
      expect(Object.keys(announcement)).to.deep.equal([aliceDid]);
      expect(announcement[bobDid]).to.be.undefined;
    });

    it('buildSMTTree slots a verifiable non-inclusion leaf for a decliner', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('SMTBeacon');
      cohort.addUpdate(aliceDid, createSignedUpdate(aliceDid, alice));
      cohort.addNonInclusion(bobDid);
      const proofs = cohort.buildSMTTree();

      // Every participant gets a proof, including the decliner.
      expect(proofs.has(aliceDid)).to.be.true;
      expect(proofs.has(bobDid)).to.be.true;

      const bobProof = proofs.get(bobDid)!;
      // A non-inclusion proof carries a nonce but no updateId by construction.
      expect(bobProof.nonce).to.be.a('string');
      expect(bobProof.updateId).to.be.undefined;

      // The non-inclusion leaf is SHA-256(SHA-256(nonce)); the proof verifies to the root.
      const candidate = blockHash(blockHash(base64UrlToHash(bobProof.nonce!)));
      expect(verifySerializedProof(bobProof, didToIndex(bobDid), candidate)).to.be.true;

      // The submitter's proof is an inclusion proof (has an updateId).
      expect(proofs.get(aliceDid)!.updateId).to.be.a('string');
    });
  });

  describe('beacon strategy: decliner validates its own slot', () => {
    it('CAS strategy matches a decliner iff it is absent from the map', () => {
      const strategy = getBeaconStrategy('CASBeacon')!;
      const body = { casAnnouncement: { 'did:btcr2:alice': 'aliceHash' } } as never;
      // Decliner (bob) is absent -> matches.
      expect(strategy.validateParticipantView({ participantDid: 'did:btcr2:bob', included: false, body }).matches).to.be.true;
      // A "decliner" that is actually present in the map -> does NOT match (forged).
      expect(strategy.validateParticipantView({ participantDid: 'did:btcr2:alice', included: false, body }).matches).to.be.false;
    });

    it('SMT strategy validates a non-inclusion proof without an updateId', () => {
      const { cohort, aliceDid, bobDid, alice } = directCohort('SMTBeacon');
      cohort.addUpdate(aliceDid, createSignedUpdate(aliceDid, alice));
      cohort.addNonInclusion(bobDid);
      const proofs = cohort.buildSMTTree();
      const strategy = getBeaconStrategy('SMTBeacon')!;

      const bobResult = strategy.validateParticipantView({
        participantDid : bobDid,
        included       : false,
        body           : { smtProof: proofs.get(bobDid)! as unknown as Record<string, unknown> } as never,
      });
      expect(bobResult.matches).to.be.true;

      // Feeding the decliner an INCLUSION proof (one with an updateId) must fail
      // the non-inclusion check.
      const aliceProof = proofs.get(aliceDid)!;
      const forged = strategy.validateParticipantView({
        participantDid : bobDid,
        included       : false,
        body           : { smtProof: aliceProof as unknown as Record<string, unknown> } as never,
      });
      expect(forged.matches).to.be.false;
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
      const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
      const payment = p2tr(aggPk);
      const prevOutValue = 100000n;
      const tx = buildDummyTx(payment.script, prevOutValue, cohort.signalBytes!);
      await send(serviceTransport, serviceDid, service.startSigning(cohortId, { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] }));
      await send(aliceTransport, aliceDid, alice.approveNonce(cohortId));
      await send(bobTransport, bobDid, bob.approveNonce(cohortId));
      await send(serviceTransport, serviceDid, service.sendAggregatedNonce(cohortId));
      await send(aliceTransport, aliceDid, alice.generatePartialSignature(cohortId));
      await send(bobTransport, bobDid, bob.generatePartialSignature(cohortId));
    }

    it('CAS: decliner is absent from the map, validates absence, and still signs', async () => {
      const cohortId = await formCohort('CASBeacon');

      // Alice submits; Bob declines.
      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, createSignedUpdate(aliceDid, aliceKeys)));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CollectingUpdates);
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
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

    it('SMT: decliner carries a non-inclusion leaf, validates it, and still signs', async () => {
      const cohortId = await formCohort('SMTBeacon');

      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, createSignedUpdate(aliceDid, aliceKeys)));
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);

      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));

      // Bob received and validated a non-inclusion proof (nonce, no updateId).
      expect(bob.getValidation(cohortId)?.matches).to.be.true;
      expect(bob.getValidation(cohortId)?.included).to.be.false;
      expect(bob.getValidation(cohortId)?.smtProof?.updateId).to.be.undefined;
      expect(bob.getValidation(cohortId)?.smtProof?.nonce).to.be.a('string');
      // Alice received an inclusion proof.
      expect(alice.getValidation(cohortId)?.matches).to.be.true;
      expect(alice.getValidation(cohortId)?.smtProof?.updateId).to.be.a('string');

      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      await send(bobTransport, bobDid, bob.approveValidation(cohortId));
      await driveSigningToComplete(cohortId);

      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      expect(service.getResult(cohortId)?.signature).to.have.lengthOf(64);
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
      service.receive(createSubmitUpdateMessage({ from: aliceDid, to: serviceDid, cohortId, signedUpdate: createSignedUpdate(aliceDid, aliceKeys, 3) as unknown as Record<string, unknown> }) as never);
      expect(service.drainRejections(cohortId).some(r => /already submitted/i.test(r.reason))).to.be.true;
    });

    it('rejects a SUBMIT_UPDATE from a member that already declined, and vice versa', async () => {
      const cohortId = await formCohort('CASBeacon');
      await send(bobTransport, bobDid, bob.declineUpdate(cohortId));
      // decline then submit
      service.receive(createSubmitUpdateMessage({ from: bobDid, to: serviceDid, cohortId, signedUpdate: createSignedUpdate(bobDid, bobKeys) as unknown as Record<string, unknown> }) as never);
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
