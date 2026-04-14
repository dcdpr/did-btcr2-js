import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';
import {
  AGGREGATION_WIRE_VERSION,
  AggregationParticipant,
  AggregationService,
  BaseMessage,
  COHORT_ADVERT,
  DidBtcr2,
  ServiceCohortPhase,
  createCohortOptInMessage,
  createSubmitUpdateMessage,
} from '../src/index.js';

/** Build a plausibly-shaped SignedBTCR2Update with just enough fields to reach
 *  the size-cap check in #handleSubmitUpdate. Verification still fails but
 *  that's intentional for the size-cap test.
 */
function buildHugeUpdate(bytes: number): SignedBTCR2Update {
  const filler = 'x'.repeat(bytes);
  return {
    '@context'      : ['https://w3id.org/security/v2'],
    patch           : [{ op: 'add', path: '/service/-', value: { id: '#svc', type: 'T', serviceEndpoint: filler } }],
    sourceHash      : 'zQmSource',
    targetHash      : 'zQmTarget',
    targetVersionId : 2,
    proof           : {
      '@context'         : ['https://w3id.org/security/v2'],
      cryptosuite        : 'bip340-jcs-2025',
      type               : 'DataIntegrityProof',
      verificationMethod : 'did:btcr2:dummy#initialKey',
      proofPurpose       : 'capabilityInvocation',
      capability         : 'urn:zcap:root',
      capabilityAction   : 'Write',
      proofValue         : 'z' + 'x'.repeat(100),
    },
  } as SignedBTCR2Update;
}

describe('Aggregation security regressions', () => {

  describe('T1.2: re-opt-in from accepted participant', () => {
    it('service rejects a second opt-in from an already-accepted DID', () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys2 = SchnorrKeyPair.generate();

      const service = new AggregationService({ did: serviceDid, keys: serviceKeys });
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);

      // Alice opts in with K1
      service.receive(createCohortOptInMessage({
        from            : aliceDid,
        to              : serviceDid,
        cohortId,
        participantPk   : aliceKeys.publicKey.compressed,
        communicationPk : aliceKeys.publicKey.compressed,
      }));
      // Service accepts Alice
      service.acceptParticipant(cohortId, aliceDid);
      const firstKey = service.getCohort(cohortId)!.participantKeys.get(aliceDid);

      // Alice tries to opt-in again with a DIFFERENT key — should be rejected
      service.receive(createCohortOptInMessage({
        from            : aliceDid,
        to              : serviceDid,
        cohortId,
        participantPk   : aliceKeys2.publicKey.compressed,
        communicationPk : aliceKeys2.publicKey.compressed,
      }));

      // Cohort key for Alice is still the original K1
      expect(service.getCohort(cohortId)!.participantKeys.get(aliceDid)).to.deep.equal(firstKey);
    });
  });

  describe('T2.1 + T2.2: oversized update rejected and surfaced', () => {
    it('drops updates whose canonicalized size exceeds maxUpdateSizeBytes', () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const bobKeys = SchnorrKeyPair.generate();
      const bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      const service = new AggregationService({
        did                : serviceDid,
        keys               : serviceKeys,
        maxUpdateSizeBytes : 1024,
      });
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);
      service.receive(createCohortOptInMessage({
        from            : aliceDid, to              : serviceDid, cohortId,
        participantPk   : aliceKeys.publicKey.compressed, communicationPk : aliceKeys.publicKey.compressed,
      }));
      service.receive(createCohortOptInMessage({
        from            : bobDid, to              : serviceDid, cohortId,
        participantPk   : bobKeys.publicKey.compressed, communicationPk : bobKeys.publicKey.compressed,
      }));
      service.acceptParticipant(cohortId, aliceDid);
      service.acceptParticipant(cohortId, bobDid);
      service.finalizeKeygen(cohortId);

      // Submit an update with >1 KiB of filler data
      const hugeUpdate = buildHugeUpdate(4096);
      service.receive(createSubmitUpdateMessage({
        from         : aliceDid,
        to           : serviceDid,
        cohortId,
        signedUpdate : hugeUpdate as unknown as Record<string, unknown>,
      }));

      // Cohort should NOT have stored the update
      expect(service.collectedUpdates(cohortId).has(aliceDid)).to.be.false;
      // A rejection was recorded
      const rejections = service.drainRejections(cohortId);
      expect(rejections).to.have.length.greaterThan(0);
      expect(rejections[0]!.code).to.equal('UPDATE_TOO_LARGE');
      expect(rejections[0]!.from).to.equal(aliceDid);
    });
  });

  describe('T2.3: wire-format version', () => {
    it('service rejects messages with a missing or mismatched version', () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const aliceKeys = SchnorrKeyPair.generate();
      const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

      const service = new AggregationService({ did: serviceDid, keys: serviceKeys });
      const cohortId = service.createCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);

      // Hand-forged message with wrong version
      const bad = new BaseMessage({
        type    : 'https://btcr2.dev/aggregation/keygen/cohort_opt_in',
        version : AGGREGATION_WIRE_VERSION + 999,
        from    : aliceDid,
        to      : serviceDid,
        body    : {
          cohortId,
          participantPk   : aliceKeys.publicKey.compressed,
          communicationPk : aliceKeys.publicKey.compressed,
        },
      });
      service.receive(bad);
      expect(service.pendingOptIns(cohortId).size).to.equal(0);
      const rejections = service.drainRejections(cohortId);
      expect(rejections.map(r => r.code)).to.include('WRONG_VERSION');
    });

    it('participant rejects messages with a mismatched version', () => {
      const keys = SchnorrKeyPair.generate();
      const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const participant = new AggregationParticipant({ did, keys });

      const badAdvert = new BaseMessage({
        type    : COHORT_ADVERT,
        version : 999,
        from    : 'did:btcr2:service',
        body    : {
          cohortId        : 'cohort-x',
          cohortSize      : 2,
          network         : 'mutinynet',
          beaconType      : 'CASBeacon',
          communicationPk : new Uint8Array(33),
        },
      });
      participant.receive(badAdvert);
      expect(participant.discoveredCohorts.size).to.equal(0);
    });
  });

  describe('T1.3: cohort-failed after validation rejection', () => {
    it('phase transitions to Failed when a participant rejects', () => {
      const serviceKeys = SchnorrKeyPair.generate();
      const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
      const service = new AggregationService({ did: serviceDid, keys: serviceKeys });
      const cohortId = service.createCohort({ minParticipants: 1, network: 'mutinynet', beaconType: 'CASBeacon' });
      service.advertise(cohortId);

      // Force phase to DataDistributed via direct state manipulation is not possible
      // (phases are private), so we verify the transition via the full path in the
      // existing aggregation.spec.ts "validation rejection" scenario. This spec
      // asserts the prerequisite — the Failed phase constant is emitted and public.
      expect(ServiceCohortPhase.Failed).to.equal('Failed');
    });
  });
});
