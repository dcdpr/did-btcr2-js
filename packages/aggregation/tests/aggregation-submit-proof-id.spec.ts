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
  document.verificationMethod.push({
    id                 : methodId,
    type               : 'Multikey',
    controller         : document.id,
    publicKeyMultibase : keyDocument(signerKeys).verificationMethod[0]!.publicKeyMultibase,
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
        code   : 'UPDATE_VERIFICATION_FAILED',
        reason : 'BIP-340 Data Integrity proof verification failed',
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
      code   : 'UPDATE_VERIFICATION_FAILED',
      reason : 'BIP-340 Data Integrity proof verification failed',
    }]);
    expect(service.collectedUpdates(cohortId).has(dids[0]!)).to.equal(false);
    expect(service.getCohortPhase(cohortId)).to.equal(ServiceCohortPhase.CohortSet);
  });
});
