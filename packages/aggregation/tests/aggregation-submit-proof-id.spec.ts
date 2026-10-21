import { BIP340Cryptosuite, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Btcr2DataIntegrityConfig, Btcr2DidDocument, SignedBTCR2Update } from '@did-btcr2/method';
import { BTCR2_UPDATE_CONTEXT, DidBtcr2, Resolver, Updater } from '@did-btcr2/method';
import { expect } from 'chai';
import {
  AggregationService,
  ServiceCohortPhase,
  createCohortOptInMessage,
  createSubmitUpdateMessage,
} from '../src/index.js';

const TEST_RECOVERY_KEY = 'a'.repeat(64);
const TEST_RECOVERY_SEQUENCE = 144;

/** The text after the DID in the id of the method that signs: a fragment, a query, or a path. */
const METHOD_ID_FORMS = [ '#key-1', '?key=1', '/keys/1' ];

const SENDER_MISMATCH_REASON = 'Update proof verificationMethod is not a DID URL of the sender DID';
const NO_PROOF_REASON = 'SUBMIT_UPDATE signedUpdate has no proof object';
const NO_PROOF_STRINGS_REASON = 'Update proof has no verificationMethod or proofValue string';

/** The KEY document of `keys`, as a plain JSON copy. */
function keyDocument(keys: SchnorrKeyPair): Btcr2DidDocument {
  const document = Resolver.deterministic({
    genesisBytes : keys.publicKey.compressed,
    hrp          : 'k',
    idType       : 'KEY',
    version      : 1,
    network      : 'mutinynet',
  });
  return JSON.parse(JSON.stringify(document)) as Btcr2DidDocument;
}

/**
 * Sign an update of the KEY document of `owner` with Updater.sign. The document also lists a
 * method with the id `<did of owner><form>` in verificationMethod and in capabilityInvocation.
 * That method has the type Multikey, the DID of `owner` as its controller, and the key of
 * `signerKeys`. The proof names that method.
 */
function signedUpdate(owner: SchnorrKeyPair, form: string, signerKeys: SchnorrKeyPair): SignedBTCR2Update {
  const document = keyDocument(owner);
  const methodId = `${document.id}${form}`;
  document.verificationMethod!.push({
    id                 : methodId,
    type               : 'Multikey',
    controller         : document.id,
    publicKeyMultibase : keyDocument(signerKeys).verificationMethod![0]!.publicKeyMultibase,
  });
  document.capabilityInvocation!.push(methodId);
  const unsigned = Updater.construct(document, [{ op: 'add', path: '/alsoKnownAs', value: [ 'https://example.com/member' ] }], 1);
  return Updater.sign(document, unsigned, methodId, new LocalSigner(signerKeys.raw.secret!));
}

/** A two-member cohort that collects updates. Each member opts in with the key of its KEY DID. */
function formCohort() {
  const serviceKeys = SchnorrKeyPair.generate();
  const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
  const keys = [ SchnorrKeyPair.generate(), SchnorrKeyPair.generate() ];
  const dids = keys.map(k => DidBtcr2.create(k.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' }));
  const service = new AggregationService({ did: serviceDid, publicKey: serviceKeys.publicKey });

  const cohortId = service.createCohort({
    minParticipants  : 2,
    network          : 'mutinynet',
    beaconType       : 'CASBeacon',
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

  const submit = (from: string, update: SignedBTCR2Update) => service.receive(createSubmitUpdateMessage({
    from,
    to           : serviceDid,
    cohortId,
    signedUpdate : update as unknown as Record<string, unknown>,
  }));

  return { service, cohortId, keys, dids, submit };
}

describe('AggregationService: the DID in the proof method id of a submitted update', () => {
  for(const form of METHOD_ID_FORMS) {
    it(`accepts an update whose proof names the method <did of the sender>${form}`, () => {
      const { service, cohortId, keys, dids, submit } = formCohort();
      const update = signedUpdate(keys[0]!, form, keys[0]!);
      expect(update.proof.verificationMethod).to.equal(`${dids[0]}${form}`);

      submit(dids[0]!, update);

      expect(service.drainRejections(cohortId)).to.deep.equal([]);
      expect(service.collectedUpdates(cohortId).get(dids[0]!)).to.deep.equal(update);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CollectingUpdates);
    });
  }

  for(const form of METHOD_ID_FORMS) {
    it(`refuses an update whose proof names the method <other did>${form}, with the key of the sender`, () => {
      const { service, cohortId, keys, dids, submit } = formCohort();
      // The method of the other DID has the key of the sender, so the signature verifies with
      // the opt-in key. Only the DID in the method id is wrong.
      const other = SchnorrKeyPair.generate();
      const update = signedUpdate(other, form, keys[0]!);
      expect(update.proof.verificationMethod).to.equal(`${keyDocument(other).id}${form}`);

      submit(dids[0]!, update);

      expect(service.drainRejections(cohortId)).to.deep.equal([{
        from   : dids[0]!,
        code   : 'UPDATE_SENDER_MISMATCH',
        reason : SENDER_MISMATCH_REASON,
      }]);
      expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.equal(false);
      expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
    });
  }

  it('refuses an update whose proof names the relative id #key-1, with a valid signature of the sender', () => {
    const { service, cohortId, keys, dids, submit } = formCohort();
    // Updater.sign always names an absolute id, so the test makes the proof with the cryptosuite.
    const document = keyDocument(keys[0]!);
    const unsigned = Updater.construct(document, [{ op: 'add', path: '/alsoKnownAs', value: [ 'https://example.com/member' ] }], 1);
    const multikey = SchnorrMultikey.fromSigner('#key-1', '', new LocalSigner(keys[0]!.raw.secret!));
    const config: Btcr2DataIntegrityConfig = {
      '@context'         : [ ...BTCR2_UPDATE_CONTEXT ],
      cryptosuite        : 'bip340-jcs-2025',
      type               : 'DataIntegrityProof',
      verificationMethod : '#key-1',
      proofPurpose       : 'capabilityInvocation',
      capability         : `urn:zcap:root:${encodeURIComponent(dids[0]!)}`,
      capabilityAction   : 'Write',
      invocationTarget   : dids[0]!,
    };
    const update = multikey.toCryptosuite().toDataIntegrityProof().addProof({ ...unsigned }, config) as SignedBTCR2Update;
    expect(update.proof.verificationMethod).to.equal('#key-1');
    // The signature verifies with the key of the sender. Only the id in the proof is wrong.
    expect(new BIP340Cryptosuite(multikey).verifyProof(structuredClone(update)).verified).to.equal(true);

    submit(dids[0]!, update);

    expect(service.drainRejections(cohortId)).to.deep.equal([{
      from   : dids[0]!,
      code   : 'UPDATE_SENDER_MISMATCH',
      reason : SENDER_MISMATCH_REASON,
    }]);
    expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.equal(false);
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
  });

  it('accepts an update that a key other than the opt-in key signs', () => {
    const { service, cohortId, keys, dids, submit } = formCohort();
    // A rotated key: the document of the sender lists <did of the sender>#key-2 with another
    // key in capabilityInvocation. A resolver accepts this update, so the service must too.
    const update = signedUpdate(keys[0]!, '#key-2', SchnorrKeyPair.generate());
    expect(update.proof.verificationMethod).to.equal(`${dids[0]}#key-2`);

    submit(dids[0]!, update);

    expect(service.drainRejections(cohortId)).to.deep.equal([]);
    expect(service.collectedUpdates(cohortId).get(dids[0]!)).to.deep.equal(update);
  });

  it('accepts an update whose proofValue does not verify: the service checks only the structure', () => {
    const { service, cohortId, keys, dids, submit } = formCohort();
    const update = signedUpdate(keys[0]!, '#key-1', keys[0]!);
    update.proof.proofValue = `z${'1'.repeat(86)}`;

    submit(dids[0]!, update);

    expect(service.drainRejections(cohortId)).to.deep.equal([]);
    expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.equal(true);
  });

  for(const [ label, methodId ] of [
    [ 'the bare DID of the sender', (did: string) => did ],
    [ 'the DID of the sender and a "#" with no fragment', (did: string) => `${did}#` ],
    [ 'a longer DID with the DID of the sender as its prefix', (did: string) => `${did}x#key-1` ],
  ] as const) {
    it(`refuses an update whose proof names ${label}`, () => {
      const { service, cohortId, keys, dids, submit } = formCohort();
      const update = signedUpdate(keys[0]!, '#key-1', keys[0]!);
      update.proof.verificationMethod = methodId(dids[0]!);

      submit(dids[0]!, update);

      expect(service.drainRejections(cohortId)).to.deep.equal([{
        from   : dids[0]!,
        code   : 'UPDATE_SENDER_MISMATCH',
        reason : SENDER_MISMATCH_REASON,
      }]);
      expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.equal(false);
    });
  }

  for(const [ label, proof, reason ] of [
    [ 'no proof', undefined, NO_PROOF_REASON ],
    [ 'a null proof', null, NO_PROOF_REASON ],
    [ 'a string proof', 'proof', NO_PROOF_REASON ],
    [ 'an array proof', [], NO_PROOF_REASON ],
    [ 'a proof with no proofValue', { proofValue: undefined }, NO_PROOF_STRINGS_REASON ],
    [ 'a proof with an empty proofValue', { proofValue: '' }, NO_PROOF_STRINGS_REASON ],
    [ 'a proof with a number proofValue', { proofValue: 42 }, NO_PROOF_STRINGS_REASON ],
    [ 'a proof with no verificationMethod', { verificationMethod: undefined }, NO_PROOF_STRINGS_REASON ],
  ] as const) {
    it(`refuses an update with ${label} as UPDATE_MALFORMED`, () => {
      const { service, cohortId, keys, dids, submit } = formCohort();
      const update = signedUpdate(keys[0]!, '#key-1', keys[0]!) as unknown as Record<string, unknown>;
      update.proof = proof !== null && typeof proof === 'object' && !Array.isArray(proof)
        ? { ...(update.proof as Record<string, unknown>), ...proof }
        : proof;

      submit(dids[0]!, update as unknown as SignedBTCR2Update);

      expect(service.drainRejections(cohortId)).to.deep.equal([{ from: dids[0]!, code: 'UPDATE_MALFORMED', reason }]);
      expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.equal(false);
    });
  }
});
