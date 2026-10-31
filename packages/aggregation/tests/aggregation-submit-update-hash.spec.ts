import { SchnorrKeyPair } from '@did-btcr2/keys';
import { DidBtcr2 } from '@did-btcr2/method';
import { didToIndex, hashToBase64Url, verifySerializedProof, zeroHashRoot } from '@did-btcr2/smt';
import { encode } from '@did-btcr2/std';
import { randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import {
  AggregationService,
  BaseMessage,
  SUBMIT_UPDATE,
  ServiceCohortPhase,
  createCohortOptInMessage,
} from '../src/index.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

const NO_STRING_REASON = 'SUBMIT_UPDATE has no updateHash string';
const BAD_FORM_REASON = 'SUBMIT_UPDATE updateHash is not 32 bytes in base64url';

/** A well-formed `updateHash`: 32 bytes, base64url with no padding. */
const HASH = hashToBase64Url(new Uint8Array(32).fill(0x11));

function newDid(keys: SchnorrKeyPair): string {
  return DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
}

/** A two-member cohort that collects updates. */
function formCohort(beaconType = 'CASBeacon') {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = newDid(serviceKeys);
  const keys = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
  const dids = keys.map(newDid);
  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });

  const cohortId = service.createCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType,
    recoveryKey      : TEST_RECOVERY_KEY,
    recoverySequence : TEST_RECOVERY_SEQUENCE,
  });
  service.advertise(cohortId);
  dids.forEach((did, i) => service.receive(createCohortOptInMessage({
    from            : did,
    to              : serviceDid,
    cohortId,
    participantPk   : keys[i]!.publicKey.compressed,
    communicationPk : keys[i]!.publicKey.compressed,
  })));
  dids.forEach(did => service.acceptParticipant(cohortId, did));
  service.finalizeKeygen(cohortId);

  /** Send a SUBMIT_UPDATE with the body `{ cohortId, ...body }`. The body can have any form. */
  const submit = (from: string, body: Record<string, unknown>) => service.receive(new BaseMessage({
    type : SUBMIT_UPDATE,
    from,
    to   : serviceDid,
    body : { cohortId, ...body },
  }));

  return { service, serviceDid, cohortId, dids, submit };
}

describe('AggregationService: the updateHash of a SUBMIT_UPDATE', () => {
  for(const beaconType of [ 'CASBeacon', 'SMTBeacon' ]) {
    it(`${beaconType}: accepts a 32-byte base64url updateHash and keeps the string as sent`, () => {
      const { service, cohortId, dids, submit } = formCohort(beaconType);

      submit(dids[0]!, { updateHash: HASH });

      expect(service.drainRejections(cohortId)).to.deep.equal([]);
      expect([ ...service.collectedUpdateHashes(cohortId) ]).to.deep.equal([[ dids[0]!, HASH ]]);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CollectingUpdates);
    });
  }

  it('CASBeacon: the CAS Announcement Map holds each updateHash as the member sent it', () => {
    const { service, cohortId, dids, submit } = formCohort('CASBeacon');
    const values = dids.map(() => hashToBase64Url(randomBytes(32)));
    dids.forEach((did, i) => submit(did, { updateHash: values[i]! }));

    service.buildAndDistribute(cohortId);

    expect(service.getCohort(cohortId)!.casAnnouncement).to.deep.equal({ [dids[0]!]: values[0]!, [dids[1]!]: values[1]! });
  });

  it('SMTBeacon: the tree has each value at the index of its member, and the proofs have no nonce and no updateId', () => {
    const { service, cohortId, dids, submit } = formCohort('SMTBeacon');
    const values = dids.map(() => randomBytes(32));
    dids.forEach((did, i) => submit(did, { updateHash: hashToBase64Url(values[i]!) }));

    const messages = service.buildAndDistribute(cohortId);

    const leaves = dids.map((did, i) => ({ index: didToIndex(did), leaf: values[i]! }));
    expect(service.getCohort(cohortId)!.signalBytes).to.deep.equal(zeroHashRoot(leaves));
    expect(messages.map(m => m.to)).to.have.members(dids);
    for(const message of messages) {
      const proof = message.body!.smtProof as never;
      expect(proof).to.have.all.keys('id', 'collapsed', 'hashes');
      expect(verifySerializedProof(proof, didToIndex(message.to!), values[dids.indexOf(message.to!)]!)).to.equal(true);
    }
  });

  for(const [ label, body ] of [
    [ 'no updateHash', {} ],
    [ 'a null updateHash', { updateHash: null } ],
    [ 'a number updateHash', { updateHash: 42 } ],
    [ 'an array updateHash', { updateHash: [ HASH ] } ],
    [ 'an object updateHash', { updateHash: { value: HASH } } ],
    [ 'the bytes of a hash as updateHash', { updateHash: new Uint8Array(32) } ],
  ] as const) {
    it(`refuses ${label} with UPDATE_MALFORMED`, () => {
      const { service, cohortId, dids, submit } = formCohort();

      expect(() => submit(dids[0]!, body)).to.not.throw();

      expect(service.drainRejections(cohortId)).to.deep.equal([{ from: dids[0]!, code: 'UPDATE_MALFORMED', reason: NO_STRING_REASON }]);
      expect(service.collectedUpdateHashes(cohortId).size).to.equal(0);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });
  }

  for(const [ label, updateHash ] of [
    [ 'an empty string', '' ],
    [ 'a value with "=" padding', `${HASH}=` ],
    [ 'a value with non-zero padding bits', `${'A'.repeat(42)}B` ],
    [ 'a 31-byte value', encode(new Uint8Array(31).fill(0x11)) ],
    [ 'a 33-byte value', encode(new Uint8Array(33).fill(0x11)) ],
    [ 'a value in the base64 alphabet (not base64url)', hashToBase64Url(new Uint8Array(32).fill(0xff)).replaceAll('_', '/') ],
    [ 'the hex form of a hash', '11'.repeat(32) ],
  ] as const) {
    it(`refuses ${label} with UPDATE_MALFORMED`, () => {
      const { service, cohortId, dids, submit } = formCohort();

      expect(() => submit(dids[0]!, { updateHash })).to.not.throw();

      expect(service.drainRejections(cohortId)).to.deep.equal([{ from: dids[0]!, code: 'UPDATE_MALFORMED', reason: BAD_FORM_REASON }]);
      expect(service.collectedUpdateHashes(cohortId).size).to.equal(0);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });
  }

  it('ignores a SUBMIT_UPDATE with no cohortId, for an unknown cohort, or after all members answered', () => {
    const { service, serviceDid, cohortId, dids, submit } = formCohort();
    const send = (body: Record<string, unknown>) => service.receive(new BaseMessage({ type: SUBMIT_UPDATE, from: dids[0]!, to: serviceDid, body: body as never }));

    send({ updateHash: HASH });
    send({ cohortId: 'unknown', updateHash: HASH });
    expect(service.collectedUpdateHashes(cohortId).size).to.equal(0);

    dids.forEach(did => submit(did, { updateHash: HASH }));
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.UpdatesCollected);
    submit(dids[0]!, { updateHash: hashToBase64Url(randomBytes(32)) });

    expect(service.drainRejections(cohortId)).to.deep.equal([]);
    expect(service.collectedUpdateHashes(cohortId).get(dids[0]!)).to.equal(HASH);
  });

  it('checks membership before the form of the value', () => {
    const { service, cohortId, submit } = formCohort();
    const outsider = newDid(SchnorrKeyPair.generate());

    submit(outsider, { updateHash: encode(new Uint8Array(31)) });

    expect(service.drainRejections(cohortId).map(r => r.code)).to.deep.equal([ 'NOT_A_MEMBER' ]);
  });

  it('a refused value is not an answer: the member can send a good value, and the first good value stands', () => {
    const { service, cohortId, dids, submit } = formCohort();
    const second = hashToBase64Url(randomBytes(32));

    submit(dids[0]!, { updateHash: `${HASH}=` });
    submit(dids[0]!, { updateHash: HASH });
    submit(dids[0]!, { updateHash: second });

    expect(service.drainRejections(cohortId).map(r => r.code)).to.deep.equal([ 'UPDATE_MALFORMED', 'DUPLICATE_RESPONSE' ]);
    expect(service.collectedUpdateHashes(cohortId).get(dids[0]!)).to.equal(HASH);
  });
});
