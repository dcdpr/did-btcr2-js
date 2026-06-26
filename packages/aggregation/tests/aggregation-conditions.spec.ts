import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';
import {
  AggregationService,
  BaseMessage,
  COHORT_ADVERT,
  createCohortOptInMessage,
  isCohortAdvertMessage,
  validateCohortConditions,
} from '../src/index.js';
import { DidBtcr2 } from '@did-btcr2/method';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

/** Executable coverage for ADR 039 (cohort condition model). */
describe('ADR 039: cohort conditions', () => {
  const mkService = () => {
    const keys = SchnorrKeyPair.generate();
    const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    return { service: new AggregationService({ did, publicKey: keys.publicKey }), serviceDid: did };
  };
  const mkOptIn = (cohortId: string, serviceDid: string) => {
    const kp = SchnorrKeyPair.generate();
    const did = DidBtcr2.create(kp.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
    return {
      did,
      msg : createCohortOptInMessage({
        from            : did,
        to              : serviceDid,
        cohortId,
        participantPk   : kp.publicKey.compressed,
        communicationPk : kp.publicKey.compressed,
      }),
    };
  };

  describe('validateCohortConditions', () => {
    it('accepts a minimal valid condition set', () => {
      expect(validateCohortConditions({ beaconType: 'CASBeacon', minParticipants: 1, recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE })).to.deep.equal([]);
    });

    it('accepts a full set including advertised costs, dids-per-participant, timing and trigger', () => {
      expect(validateCohortConditions({
        beaconType                     : 'SMTBeacon',
        minParticipants                : 2,
        maxParticipants                : 5,
        minDidsPerParticipant          : 1,
        maxDidsPerParticipant          : 10,
        costOfEnrollment               : { amount: 1000, unit: 'sat' },
        costPerAnnouncement            : { amount: 100, unit: 'sat', basis: 'per-did' },
        minSecondsBetweenAnnouncements : 60,
        maxSecondsBetweenAnnouncements : 3600,
        pendingUpdateTrigger           : 8,
        recoveryKey                    : TEST_RECOVERY_KEY,
        recoverySequence               : TEST_RECOVERY_SEQUENCE,
      })).to.deep.equal([]);
    });

    it('rejects minParticipants < 1', () => {
      expect(validateCohortConditions({ beaconType: 'SMTBeacon', minParticipants: 0, recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE }).join(' ')).to.match(/minParticipants/);
    });

    it('rejects maxParticipants < minParticipants', () => {
      expect(validateCohortConditions({ beaconType: 'CASBeacon', minParticipants: 3, maxParticipants: 2, recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE }).join(' '))
        .to.match(/maxParticipants must be >= minParticipants/);
    });

    it('rejects an unknown beaconType', () => {
      expect(validateCohortConditions({ beaconType: 'SingletonBeacon', minParticipants: 1, recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE }).join(' ')).to.match(/beaconType/);
    });

    it('rejects a malformed advertised cost', () => {
      expect(validateCohortConditions({
        beaconType       : 'CASBeacon',
        minParticipants  : 1,
        costOfEnrollment : { amount: -5, unit: '' },
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      }).length).to.be.greaterThan(0);
    });
  });

  describe('createCohort validation', () => {
    it('throws INVALID_COHORT_CONDITIONS on a bad config', () => {
      const { service } = mkService();
      expect(() => service.createCohort({ beaconType: 'CASBeacon', minParticipants: 0, network: 'mutinynet', recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE }))
        .to.throw(/INVALID_COHORT_CONDITIONS|Invalid cohort conditions/);
    });

    it('accepts a valid config', () => {
      const { service } = mkService();
      const id = service.createCohort({ beaconType: 'CASBeacon', minParticipants: 1, maxParticipants: 2, network: 'mutinynet', recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE });
      expect(id).to.be.a('string').and.not.empty;
    });
  });

  describe('maxParticipants enforcement', () => {
    it('rejects acceptParticipant once the cohort is full (COHORT_FULL)', () => {
      const { service, serviceDid } = mkService();
      const cohortId = service.createCohort({ beaconType: 'CASBeacon', minParticipants: 1, maxParticipants: 1, network: 'mutinynet', recoveryKey: TEST_RECOVERY_KEY, recoverySequence: TEST_RECOVERY_SEQUENCE });
      service.advertise(cohortId);

      const a = mkOptIn(cohortId, serviceDid);
      const b = mkOptIn(cohortId, serviceDid);
      service.receive(a.msg);
      service.receive(b.msg);

      service.acceptParticipant(cohortId, a.did);  // fills the cohort (max 1)
      expect(() => service.acceptParticipant(cohortId, b.did)).to.throw(/COHORT_FULL|is full/);
    });
  });

  describe('advert carries the conditions', () => {
    it('advertises minParticipants/maxParticipants + advertised costs, and drops cohortSize', () => {
      const { service } = mkService();
      const cohortId = service.createCohort({
        beaconType       : 'SMTBeacon',
        minParticipants  : 2,
        maxParticipants  : 4,
        network          : 'mutinynet',
        costOfEnrollment : { amount: 500, unit: 'sat' },
        recoveryKey      : TEST_RECOVERY_KEY,
        recoverySequence : TEST_RECOVERY_SEQUENCE,
      });
      const [advert] = service.advertise(cohortId);
      expect(isCohortAdvertMessage(advert!)).to.equal(true);
      const body = advert!.body as Record<string, unknown>;
      expect(body.minParticipants).to.equal(2);
      expect(body.maxParticipants).to.equal(4);
      expect(body.costOfEnrollment).to.deep.equal({ amount: 500, unit: 'sat' });
      expect(body.cohortSize).to.equal(undefined);
    });
  });

  describe('advert guard range-checks the wire shape', () => {
    const advert = (minParticipants: number) => new BaseMessage({
      type : COHORT_ADVERT,
      from : 'did:btcr2:svc',
      body : { cohortId: 'c', minParticipants, beaconType: 'CASBeacon', network: 'mutinynet', recoveryKey: 'a'.repeat(64), recoverySequence: 144, communicationPk: new Uint8Array(33) },
    });

    it('rejects a zero-floor advert', () => {
      expect(isCohortAdvertMessage(advert(0))).to.equal(false);
    });

    it('accepts a well-formed advert', () => {
      expect(isCohortAdvertMessage(advert(2))).to.equal(true);
    });

    const advertWith = (overrides: Record<string, unknown>) => new BaseMessage({
      type : COHORT_ADVERT,
      from : 'did:btcr2:svc',
      body : { cohortId: 'c', minParticipants: 2, beaconType: 'CASBeacon', network: 'mutinynet', recoveryKey: 'a'.repeat(64), recoverySequence: 144, communicationPk: new Uint8Array(33), ...overrides },
    });

    it('rejects an advert whose recoverySequence has the BIP-68 disable bit set', () => {
      // The participant funds based on the advert and does not run
      // validateCohortConditions, so the guard must reject a disable-bit sequence.
      expect(isCohortAdvertMessage(advertWith({ recoverySequence: 0x80000000 }))).to.equal(false);
      expect(isCohortAdvertMessage(advertWith({ recoverySequence: 0x10000 }))).to.equal(false);
    });

    it('rejects an advert with an unknown fundingModel but accepts a known one', () => {
      expect(isCohortAdvertMessage(advertWith({ fundingModel: 'mystery' }))).to.equal(false);
      expect(isCohortAdvertMessage(advertWith({ fundingModel: 'operator-funded' }))).to.equal(true);
    });
  });
});
