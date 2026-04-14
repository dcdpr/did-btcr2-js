import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2tr, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import { expect } from 'chai';
import {
  AggregationCohort,
  AggregationParticipant,
  AggregationParticipantRunner,
  AggregationService,
  AggregationServiceRunner,
  BeaconSigningSession,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  DidBtcr2,
  NostrTransport,
  ParticipantCohortPhase,
  ServiceCohortPhase,
  SigningSessionPhase,
  TransportFactory,
} from '../src/index.js';
import { MessageBus, MockTransport } from './helpers/mock-transport.js';

/** Creates a fake SignedBTCR2Update for tests that don't need cryptographic validity. */
function createFakeSignedUpdate(did: string, version = 2): SignedBTCR2Update {
  return {
    '@context' : [
      'https://www.w3.org/ns/credentials/v2',
      'https://w3id.org/security/data-integrity/v2',
    ],
    patch : [
      { op: 'add', path: '/service/-', value: { id: `${did}#svc`, type: 'Test', serviceEndpoint: 'https://example.com' } },
    ],
    sourceHash      : `zQmSourceHash${did.slice(-6)}`,
    targetHash      : `zQmTargetHash${did.slice(-6)}`,
    targetVersionId : version,
    proof           : {
      '@context'         : ['https://w3id.org/security/data-integrity/v2'],
      type               : 'DataIntegrityProof' as const,
      proofPurpose       : 'capabilityInvocation',
      verificationMethod : `${did}#key-0`,
      cryptosuite        : 'bip-340-jcs-2025',
      proofValue         : `zFakeProof${did.slice(-6)}`,
    },
  };
}

function buildDummyTx(outputScript: Uint8Array, prevOutValue: bigint): Transaction {
  const tx = new Transaction({ version: 2 });
  tx.addInput({
    txid        : '00'.repeat(32),
    index       : 0,
    witnessUtxo : { amount: prevOutValue, script: outputScript },
  });
  tx.addOutput({ script: outputScript, amount: prevOutValue - 500n });
  return tx;
}

describe('Aggregation', () => {

  describe('AggregationCohort', () => {
    it('creates with defaults', () => {
      const cohort = new AggregationCohort({ minParticipants: 3, network: 'mutinynet' });
      expect(cohort.id).to.be.a('string').with.length.greaterThan(0);
      expect(cohort.minParticipants).to.equal(3);
      expect(cohort.network).to.equal('mutinynet');
      expect(cohort.beaconType).to.equal('CASBeacon');
      expect(cohort.participants).to.have.length(0);
    });

    it('cohortKeys are sorted on assignment', () => {
      const kp1 = SchnorrKeyPair.generate();
      const kp2 = SchnorrKeyPair.generate();
      const cohort = new AggregationCohort({ minParticipants: 2, network: 'mainnet' });
      cohort.cohortKeys = [kp1.publicKey.compressed, kp2.publicKey.compressed];
      const keys = cohort.cohortKeys;
      for(let i = 1; i < keys.length; i++) {
        const prev = Buffer.from(keys[i - 1]);
        const curr = Buffer.from(keys[i]);
        expect(prev.compare(curr)).to.be.at.most(0);
      }
    });

    it('computeBeaconAddress returns a Taproot address', () => {
      const kp1 = SchnorrKeyPair.generate();
      const kp2 = SchnorrKeyPair.generate();
      const cohort = new AggregationCohort({ minParticipants: 2, network: 'mainnet' });
      cohort.participants.push('did:btcr2:alice', 'did:btcr2:bob');
      cohort.cohortKeys = [kp1.publicKey.compressed, kp2.publicKey.compressed];
      const addr = cohort.computeBeaconAddress();
      expect(addr).to.be.a('string');
      expect(addr.startsWith('bc1p')).to.be.true;
      expect(cohort.trMerkleRoot.length).to.equal(32);
    });
  });

  describe('BeaconSigningSession', () => {
    let cohort: AggregationCohort;
    let kp1: SchnorrKeyPair;
    let kp2: SchnorrKeyPair;
    let tx: Transaction;
    let prevOutScripts: Uint8Array[];
    let prevOutValues: bigint[];

    beforeEach(() => {
      kp1 = SchnorrKeyPair.generate();
      kp2 = SchnorrKeyPair.generate();
      cohort = new AggregationCohort({ minParticipants: 2, network: 'mainnet' });
      cohort.participants.push('did:btcr2:alice', 'did:btcr2:bob');
      cohort.cohortKeys = [kp1.publicKey.compressed, kp2.publicKey.compressed];
      cohort.computeBeaconAddress();

      const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
      const payment = p2tr(aggPk);
      prevOutScripts = [payment.script];
      prevOutValues = [100000n];
      tx = buildDummyTx(payment.script, 100000n);
    });

    it('full MuSig2 round trip produces 64-byte Schnorr signature', () => {
      // Service-side session collects nonces and partial sigs
      const serviceSession = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });

      // Each participant generates a nonce contribution via their own session
      const p1Session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const p2Session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });

      const nonce1 = p1Session.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      const nonce2 = p2Session.generateNonceContribution(kp2.publicKey.compressed, kp2.secretKey.bytes);

      serviceSession.addNonceContribution('did:btcr2:alice', nonce1);
      serviceSession.addNonceContribution('did:btcr2:bob', nonce2);
      expect(serviceSession.phase).to.equal(SigningSessionPhase.NonceContributionsReceived);

      const aggregatedNonce = serviceSession.generateAggregatedNonce();
      expect(serviceSession.phase).to.equal(SigningSessionPhase.AwaitingPartialSignatures);

      // Each participant gets the aggregated nonce and produces a partial sig
      p1Session.aggregatedNonce = aggregatedNonce;
      p2Session.aggregatedNonce = aggregatedNonce;
      const partialSig1 = p1Session.generatePartialSignature(kp1.secretKey.bytes);
      const partialSig2 = p2Session.generatePartialSignature(kp2.secretKey.bytes);

      serviceSession.addPartialSignature('did:btcr2:alice', partialSig1);
      serviceSession.addPartialSignature('did:btcr2:bob', partialSig2);
      expect(serviceSession.phase).to.equal(SigningSessionPhase.PartialSignaturesReceived);

      const finalSig = serviceSession.generateFinalSignature();
      expect(finalSig).to.be.instanceOf(Uint8Array);
      expect(finalSig.length).to.equal(64);
      expect(serviceSession.isComplete()).to.be.true;
    });

    it('rejects nonces that are not 66 bytes', () => {
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      expect(() => session.addNonceContribution('did:btcr2:alice', new Uint8Array(32))).to.throw('expected 66 bytes');
    });

    it('rejects duplicate nonce contributions', () => {
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const partSession = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const nonce = partSession.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      session.addNonceContribution('did:btcr2:alice', nonce);
      expect(() => session.addNonceContribution('did:btcr2:alice', nonce)).to.throw('Duplicate nonce');
    });

    it('addNonceContribution() throws when called in wrong phase', () => {
      // Move session past the nonce-collection phase by collecting all nonces
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const p1 = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const p2 = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      session.addNonceContribution('did:btcr2:alice', p1.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes));
      session.addNonceContribution('did:btcr2:bob',   p2.generateNonceContribution(kp2.publicKey.compressed, kp2.secretKey.bytes));
      expect(session.phase).to.equal(SigningSessionPhase.NonceContributionsReceived);

      // Phase is now NonceContributionsReceived — adding more nonces is invalid
      const extraNonce = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues })
        .generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      expect(() => session.addNonceContribution('did:btcr2:charlie', extraNonce))
        .to.throw(/not expected|INVALID_PHASE/i);
    });

    it('generateAggregatedNonce() throws before all nonces collected', () => {
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      // No contributions yet — phase is still AwaitingNonceContributions
      expect(() => session.generateAggregatedNonce()).to.throw(/INVALID_PHASE|phase/i);
    });

    it('addPartialSignature() throws before aggregated nonce is produced', () => {
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      // Phase is AwaitingNonceContributions — can't add partial sigs yet
      expect(() => session.addPartialSignature('did:btcr2:alice', new Uint8Array(32))).to.throw(/not expected|INVALID_PHASE/i);
    });

    it('addPartialSignature() rejects duplicate partial signatures', () => {
      // Drive session through to AwaitingPartialSignatures
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const p1 = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      const p2 = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      session.addNonceContribution('did:btcr2:alice', p1.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes));
      session.addNonceContribution('did:btcr2:bob',   p2.generateNonceContribution(kp2.publicKey.compressed, kp2.secretKey.bytes));
      const aggregatedNonce = session.generateAggregatedNonce();
      p1.aggregatedNonce = aggregatedNonce;
      const partialSig = p1.generatePartialSignature(kp1.secretKey.bytes);
      session.addPartialSignature('did:btcr2:alice', partialSig);
      expect(() => session.addPartialSignature('did:btcr2:alice', partialSig)).to.throw('Duplicate partial signature');
    });

    it('generateFinalSignature() throws before all partial sigs collected', () => {
      const session = new BeaconSigningSession({ cohort, pendingTx: tx, prevOutScripts, prevOutValues });
      // Still in AwaitingNonceContributions — can't produce final sig
      expect(() => session.generateFinalSignature()).to.throw(/INVALID_PHASE|phase/i);
    });
  });

  describe('NostrTransport', () => {
    it('getActorPk() returns a registered actor key', () => {
      const transport = new NostrTransport();
      const kp = SchnorrKeyPair.generate();
      transport.registerActor('did:btcr2:me', kp);
      expect(transport.getActorPk('did:btcr2:me')).to.deep.equal(kp.publicKey.compressed);
    });

    it('getActorPk() returns undefined for unknown DID', () => {
      const transport = new NostrTransport();
      expect(transport.getActorPk('did:btcr2:unknown')).to.be.undefined;
    });

    it('registerPeer() rejects invalid keys', () => {
      const transport = new NostrTransport();
      const invalidKey = new Uint8Array(32).fill(0xAB);
      expect(() => transport.registerPeer('did:btcr2:peer', invalidKey)).to.throw('Invalid communication public key');
    });

    it('registerPeer() and getPeerPk() round-trip', () => {
      const transport = new NostrTransport();
      const peerKp = SchnorrKeyPair.generate();
      transport.registerPeer('did:btcr2:peer', peerKp.publicKey.compressed);
      expect(transport.getPeerPk('did:btcr2:peer')).to.deep.equal(peerKp.publicKey.compressed);
    });

    it('registerMessageHandler throws for unknown actor', () => {
      const transport = new NostrTransport();
      expect(() => transport.registerMessageHandler('did:btcr2:unknown', COHORT_ADVERT, () => {}))
        .to.throw('not registered');
    });
  });

  describe('TransportFactory', () => {
    it('creates a NostrTransport', () => {
      const t = TransportFactory.establish({ type: 'nostr' });
      expect(t.name).to.equal('nostr');
    });

    it('throws for didcomm (not implemented)', () => {
      expect(() => TransportFactory.establish({ type: 'didcomm' })).to.throw();
    });
  });

  describe('Sans-I/O State Machines (in-process)', () => {
    let bus: MessageBus;
    let serviceTransport: MockTransport;
    let aliceTransport: MockTransport;
    let bobTransport: MockTransport;
    let service: AggregationService;
    let alice: AggregationParticipant;
    let bob: AggregationParticipant;
    let serviceDid: string;
    let aliceDid: string;
    let bobDid: string;

    beforeEach(() => {
      // Create identities
      const serviceKeys = SchnorrKeyPair.generate();
      serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bobKeys = SchnorrKeyPair.generate();
      bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      // Create state machines
      service = new AggregationService({ did: serviceDid, keys: serviceKeys });
      alice = new AggregationParticipant({ did: aliceDid, keys: aliceKeys });
      bob = new AggregationParticipant({ did: bobDid, keys: bobKeys });

      // Each actor gets its own transport (multi-process simulation)
      bus = new MessageBus();
      serviceTransport = new MockTransport(bus);
      aliceTransport = new MockTransport(bus);
      bobTransport = new MockTransport(bus);

      serviceTransport.registerActor(serviceDid, serviceKeys);
      aliceTransport.registerActor(aliceDid, aliceKeys);
      bobTransport.registerActor(bobDid, bobKeys);

      // Wire transports → state machines
      const wire = (transport: MockTransport, did: string, machine: AggregationService | AggregationParticipant, types: string[]) => {
        for(const type of types) {
          transport.registerMessageHandler(did, type, msg => machine.receive(msg as any));
        }
      };
      wire(serviceTransport, serviceDid, service, [
        COHORT_OPT_IN,
        'https://btcr2.dev/aggregation/update/submit_update',
        'https://btcr2.dev/aggregation/update/validation_ack',
        'https://btcr2.dev/aggregation/sign/nonce_contribution',
        'https://btcr2.dev/aggregation/sign/signature_authorization',
      ]);
      const participantTypes = [
        COHORT_ADVERT,
        'https://btcr2.dev/aggregation/keygen/cohort_opt_in_accept',
        'https://btcr2.dev/aggregation/keygen/cohort_ready',
        'https://btcr2.dev/aggregation/update/distribute_aggregated_data',
        'https://btcr2.dev/aggregation/sign/authorization_request',
        'https://btcr2.dev/aggregation/sign/aggregated_nonce',
      ];
      wire(aliceTransport, aliceDid, alice, participantTypes);
      wire(bobTransport, bobDid, bob, participantTypes);
    });

    /** Helper: send messages produced by a state machine via a transport. */
    async function send(transport: MockTransport, senderDid: string, msgs: any[]) {
      for(const m of msgs) await transport.sendMessage(m, senderDid, m.to);
    }

    it('Step 1: Cohort Formation — full keygen flow', async () => {
      // Service creates and advertises a cohort
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Created);

      const advertMsgs = service.advertise(cohortId);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Advertised);
      await send(serviceTransport, serviceDid, advertMsgs);

      // Both participants discovered the cohort
      expect(alice.discoveredCohorts.has(cohortId)).to.be.true;
      expect(bob.discoveredCohorts.has(cohortId)).to.be.true;
      expect(alice.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.Discovered);

      // Each participant decides to join
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      await send(bobTransport, bobDid, bob.joinCohort(cohortId));
      expect(alice.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);

      // Service sees pending opt-ins
      expect(service.pendingOptIns(cohortId).size).to.equal(2);

      // Service operator accepts each
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, aliceDid));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, bobDid));

      // Service finalizes keygen
      const readyMsgs = service.finalizeKeygen(cohortId);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
      const beaconAddress = service.getCohort(cohortId)!.beaconAddress;
      expect(beaconAddress).to.match(/^bc1p/);
      await send(serviceTransport, serviceDid, readyMsgs);

      // Both participants reached CohortReady with the same beacon address
      expect(alice.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.CohortReady);
      expect(alice.joinedCohorts.get(cohortId)?.beaconAddress).to.equal(beaconAddress);
      expect(bob.joinedCohorts.get(cohortId)?.beaconAddress).to.equal(beaconAddress);
    });

    it('Step 2-4: Full update → aggregate → validate → sign cycle', async () => {
      // ── Step 1: Setup cohort ──
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      await send(bobTransport, bobDid, bob.joinCohort(cohortId));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, aliceDid));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, bobDid));
      await send(serviceTransport, serviceDid, service.finalizeKeygen(cohortId));

      // ── Step 2: Submit updates ──
      const aliceUpdate = createFakeSignedUpdate(aliceDid);
      const bobUpdate = createFakeSignedUpdate(bobDid);
      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, aliceUpdate));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CollectingUpdates);
      await send(bobTransport, bobDid, bob.submitUpdate(cohortId, bobUpdate));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);

      // ── Step 3: Aggregate & validate ──
      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);
      expect(alice.pendingValidations.has(cohortId)).to.be.true;
      expect(alice.pendingValidations.get(cohortId)?.matches).to.be.true;

      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      await send(bobTransport, bobDid, bob.approveValidation(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);

      // ── Step 4: Sign ──
      const cohort = service.getCohort(cohortId)!;
      const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
      const payment = p2tr(aggPk);
      const prevOutValue = 100000n;
      const tx = buildDummyTx(payment.script, prevOutValue);

      await send(serviceTransport, serviceDid, service.startSigning(cohortId, {
        tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [prevOutValue],
      }));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.SigningStarted);
      expect(alice.pendingSigningRequests.has(cohortId)).to.be.true;

      // Each participant approves nonce generation
      await send(aliceTransport, aliceDid, alice.approveNonce(cohortId));
      await send(bobTransport, bobDid, bob.approveNonce(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.NoncesCollected);

      // Service sends aggregated nonce
      await send(serviceTransport, serviceDid, service.sendAggregatedNonce(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.AwaitingPartialSigs);

      // Each participant generates partial signature
      await send(aliceTransport, aliceDid, alice.generatePartialSignature(cohortId));
      await send(bobTransport, bobDid, bob.generatePartialSignature(cohortId));

      // Service should now have the final result
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      const result = service.getResult(cohortId);
      expect(result).to.not.be.undefined;
      expect(result!.signature.length).to.equal(64);
    });

    it('Step 2-4 (SMTBeacon): full update → aggregate → validate → sign cycle', async () => {
      // ── Step 1: Setup cohort with SMTBeacon type ──
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'SMTBeacon' });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      await send(bobTransport, bobDid, bob.joinCohort(cohortId));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, aliceDid));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, bobDid));
      await send(serviceTransport, serviceDid, service.finalizeKeygen(cohortId));

      // ── Step 2: Submit updates ──
      const aliceUpdate = createFakeSignedUpdate(aliceDid);
      const bobUpdate = createFakeSignedUpdate(bobDid);
      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, aliceUpdate));
      await send(bobTransport, bobDid, bob.submitUpdate(cohortId, bobUpdate));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);

      // ── Step 3: Aggregate (SMT tree) & validate ──
      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      // Verify cohort built SMT proofs
      const cohort = service.getCohort(cohortId)!;
      expect(cohort.smtProofs).to.not.be.undefined;
      expect(cohort.smtProofs!.size).to.equal(2);
      expect(cohort.signalBytes).to.be.instanceOf(Uint8Array);
      expect(cohort.signalBytes!.length).to.equal(32);

      // Both participants should have pending validations with Merkle proof verification
      expect(alice.pendingValidations.has(cohortId)).to.be.true;
      expect(alice.pendingValidations.get(cohortId)?.matches).to.be.true;
      expect(alice.pendingValidations.get(cohortId)?.smtProof).to.not.be.undefined;
      expect(bob.pendingValidations.has(cohortId)).to.be.true;
      expect(bob.pendingValidations.get(cohortId)?.matches).to.be.true;

      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      await send(bobTransport, bobDid, bob.approveValidation(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Validated);

      // ── Step 4: Sign ──
      const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
      const payment = p2tr(aggPk);
      const prevOutValue = 100000n;
      const tx = buildDummyTx(payment.script, prevOutValue);

      await send(serviceTransport, serviceDid, service.startSigning(cohortId, {
        tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [prevOutValue],
      }));

      await send(aliceTransport, aliceDid, alice.approveNonce(cohortId));
      await send(bobTransport, bobDid, bob.approveNonce(cohortId));
      await send(serviceTransport, serviceDid, service.sendAggregatedNonce(cohortId));
      await send(aliceTransport, aliceDid, alice.generatePartialSignature(cohortId));
      await send(bobTransport, bobDid, bob.generatePartialSignature(cohortId));

      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Complete);
      const result = service.getResult(cohortId);
      expect(result).to.not.be.undefined;
      expect(result!.signature.length).to.equal(64);
    });

    it('validation rejection: cohort transitions to Failed when participant rejects', async () => {
      // ── Setup cohort through to DataDistributed ──
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      await send(bobTransport, bobDid, bob.joinCohort(cohortId));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, aliceDid));
      await send(serviceTransport, serviceDid, service.acceptParticipant(cohortId, bobDid));
      await send(serviceTransport, serviceDid, service.finalizeKeygen(cohortId));

      await send(aliceTransport, aliceDid, alice.submitUpdate(cohortId, createFakeSignedUpdate(aliceDid)));
      await send(bobTransport, bobDid, bob.submitUpdate(cohortId, createFakeSignedUpdate(bobDid)));
      await send(serviceTransport, serviceDid, service.buildAndDistribute(cohortId));

      // ── Alice approves, Bob rejects ──
      await send(aliceTransport, aliceDid, alice.approveValidation(cohortId));
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.DataDistributed);

      await send(bobTransport, bobDid, bob.rejectValidation(cohortId));

      // Cohort should now be Failed (not Validated) because at least one rejected
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.Failed);

      // validationProgress should reflect the rejection
      const progress = service.validationProgress(cohortId);
      expect(progress.approved.has(aliceDid)).to.be.true;
      expect(progress.rejected.has(bobDid)).to.be.true;
      expect(progress.pending.size).to.equal(0);
      expect(progress.total).to.equal(2);
    });

    it('service.advertise() throws if cohort is unknown', () => {
      expect(() => service.advertise('nonexistent-cohort')).to.throw('Cohort nonexistent-cohort not found');
    });

    it('service.acceptParticipant() throws when there is no pending opt-in', () => {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);
      // No participants have opted in yet
      expect(() => service.acceptParticipant(cohortId, aliceDid)).to.throw(/No pending opt-in/i);
    });

    it('service.finalizeKeygen() throws if called before minParticipants reached', () => {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);
      // No participants accepted — finalizeKeygen should fail
      expect(() => service.finalizeKeygen(cohortId)).to.throw();
    });

    it('service.startSigning() throws before validation is complete', () => {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);
      // Build tx data that startSigning would need (won't get used — it throws first)
      const tx = new Transaction({ version: 2 });
      expect(() => service.startSigning(cohortId, {
        tx,
        prevOutScripts : [new Uint8Array()],
        prevOutValues  : [100000n],
      })).to.throw(/INVALID_PHASE|phase/i);
    });

    it('service.receive() silently ignores messages for unknown cohort', async () => {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      // Have alice join a DIFFERENT cohort (simulate stale/rogue message)
      const phony = alice.joinCohort(cohortId);
      // Mutate to an unknown cohortId
      const tampered = { ...phony[0]!, body: { ...phony[0]!.body, cohortId: 'ghost-cohort' } };
      // Service should silently drop it (no throw, no phase change)
      const phaseBefore = service.getCohortPhase(cohortId);
      expect(() => service.receive(tampered as any)).to.not.throw();
      expect(service.getCohortPhase(cohortId)).to.equal(phaseBefore);
    });

    it('participant.joinCohort() throws when already joined', async () => {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      expect(alice.getCohortPhase(cohortId)).to.equal(ParticipantCohortPhase.OptedIn);
      // Second join attempt should throw
      expect(() => alice.joinCohort(cohortId)).to.throw(/INVALID_PHASE|phase/i);
    });

    it('participant.submitUpdate() throws when cohort is not ready', () => {
      const cohortId = 'unknown-cohort';
      expect(() => alice.submitUpdate(cohortId, createFakeSignedUpdate(aliceDid))).to.throw();
    });

    it('participant.approveValidation() throws when not in AwaitingValidation phase', async () => {
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      await send(serviceTransport, serviceDid, service.advertise(cohortId));
      await send(aliceTransport, aliceDid, alice.joinCohort(cohortId));
      // Alice is in OptedIn — can't approve validation yet
      expect(() => alice.approveValidation(cohortId)).to.throw(/INVALID_PHASE|phase/i);
    });
  });

  describe('Runner Layer (high-level facade)', () => {
    it('AggregationServiceRunner + AggregationParticipantRunner: full round-trip', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bobKeys = SchnorrKeyPair.generate();
      const bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      const aliceTransport = new MockTransport(bus);
      const bobTransport = new MockTransport(bus);

      serviceTransport.registerActor(serviceDid, serviceKeys);
      aliceTransport.registerActor(aliceDid, aliceKeys);
      bobTransport.registerActor(bobDid, bobKeys);

      const service = new AggregationServiceRunner({
        transport       : serviceTransport,
        did             : serviceDid,
        keys            : serviceKeys,
        config          : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
        onProvideTxData : async () => {
          const cohort = service.session.cohorts[0];
          const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
          const payment = p2tr(aggPk);
          const prevOutValue = 100000n;
          const tx = buildDummyTx(payment.script, prevOutValue);
          return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
        },
      });

      const aliceRunner = new AggregationParticipantRunner({
        transport       : aliceTransport,
        did             : aliceDid,
        keys            : aliceKeys,
        shouldJoin      : async () => true,
        onProvideUpdate : async () => createFakeSignedUpdate(aliceDid),
      });

      const bobRunner = new AggregationParticipantRunner({
        transport       : bobTransport,
        did             : bobDid,
        keys            : bobKeys,
        shouldJoin      : async () => true,
        onProvideUpdate : async () => createFakeSignedUpdate(bobDid),
      });

      const serviceEvents: string[] = [];
      let capturedSigningSessionId: string | undefined;
      service.on('cohort-advertised', () => serviceEvents.push('cohort-advertised'));
      service.on('opt-in-received', () => serviceEvents.push('opt-in-received'));
      service.on('keygen-complete', () => serviceEvents.push('keygen-complete'));
      service.on('signing-started', ({ sessionId }) => {
        serviceEvents.push('signing-started');
        capturedSigningSessionId = sessionId;
      });
      service.on('signing-complete', () => serviceEvents.push('signing-complete'));

      const aliceEvents: string[] = [];
      aliceRunner.on('cohort-discovered', () => aliceEvents.push('cohort-discovered'));
      aliceRunner.on('cohort-joined', () => aliceEvents.push('cohort-joined'));
      aliceRunner.on('cohort-ready', () => aliceEvents.push('cohort-ready'));
      aliceRunner.on('cohort-complete', () => aliceEvents.push('cohort-complete'));

      await aliceRunner.start();
      await bobRunner.start();
      const result = await service.run();

      expect(result.signature.length).to.equal(64);
      expect(result.signedTx).to.exist;
      expect(serviceEvents).to.include('cohort-advertised');
      expect(serviceEvents).to.include('opt-in-received');
      expect(serviceEvents).to.include('keygen-complete');
      expect(serviceEvents).to.include('signing-started');
      expect(serviceEvents).to.include('signing-complete');
      expect(capturedSigningSessionId).to.be.a('string').and.not.equal('');
      expect(aliceEvents).to.include('cohort-discovered');
      expect(aliceEvents).to.include('cohort-joined');
      expect(aliceEvents).to.include('cohort-ready');
      expect(aliceEvents).to.include('cohort-complete');
    });

    it('AggregationParticipantRunner: shouldJoin defaults to false', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      const aliceTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);
      aliceTransport.registerActor(aliceDid, aliceKeys);

      const aliceRunner = new AggregationParticipantRunner({
        transport       : aliceTransport,
        did             : aliceDid,
        keys            : aliceKeys,
        // shouldJoin omitted — default rejects all
        onProvideUpdate : async () => createFakeSignedUpdate(aliceDid),
      });

      let discovered = false;
      let joined = false;
      aliceRunner.on('cohort-discovered', () => { discovered = true; });
      aliceRunner.on('cohort-joined', () => { joined = true; });

      await aliceRunner.start();

      // Use raw state machine to advertise without running the full service runner
      const service = new AggregationService({ did: serviceDid, keys: serviceKeys });
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      const advertMsgs = service.advertise(cohortId);
      for(const m of advertMsgs) await serviceTransport.sendMessage(m, serviceDid, m.to);

      expect(discovered).to.be.true;
      expect(joined).to.be.false;
    });

    it('AggregationParticipantRunner.joinFirst: convenience helper', async () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bobKeys = SchnorrKeyPair.generate();
      const bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      const bus = new MessageBus();
      const serviceTransport = new MockTransport(bus);
      const aliceTransport = new MockTransport(bus);
      const bobTransport = new MockTransport(bus);
      serviceTransport.registerActor(serviceDid, serviceKeys);
      aliceTransport.registerActor(aliceDid, aliceKeys);
      bobTransport.registerActor(bobDid, bobKeys);

      const bobRunner = new AggregationParticipantRunner({
        transport       : bobTransport,
        did             : bobDid,
        keys            : bobKeys,
        shouldJoin      : async () => true,
        onProvideUpdate : async () => createFakeSignedUpdate(bobDid),
      });
      await bobRunner.start();

      const aliceJoinPromise = AggregationParticipantRunner.joinFirst({
        transport       : aliceTransport,
        did             : aliceDid,
        keys            : aliceKeys,
        shouldJoin      : async () => true,
        onProvideUpdate : async () => createFakeSignedUpdate(aliceDid),
      });

      const service = new AggregationServiceRunner({
        transport       : serviceTransport,
        did             : serviceDid,
        keys            : serviceKeys,
        config          : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
        onProvideTxData : async () => {
          const cohort = service.session.cohorts[0];
          const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
          const payment = p2tr(aggPk);
          const prevOutValue = 100000n;
          const tx = buildDummyTx(payment.script, prevOutValue);
          return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
        },
      });

      const [aliceResult, serviceResult] = await Promise.all([aliceJoinPromise, service.run()]);

      expect(aliceResult.cohortId).to.equal(serviceResult.cohortId);
      expect(aliceResult.beaconAddress).to.equal(service.session.getCohort(serviceResult.cohortId)!.beaconAddress);
    });
  });
});
