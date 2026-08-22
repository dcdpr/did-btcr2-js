import type { Signer } from '@did-btcr2/keypair';
import { LocalSigner } from '@did-btcr2/keypair';
import { hexToBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import type { NeedBroadcast, NeedFunding, NeedSigningKey } from '../src/core/updater.js';
import { Appendix } from '../src/utils/appendix.js';
import { DidDocument } from '../src/utils/did-document.js';
import type { Btcr2DidDocument } from '../src/utils/did-document.js';
import data from './data/deterministic-data.js';

/**
 * DID Core permits a verification method or service `id` inside a DID document
 * to be written as a relative DID URL (`#initialKey`), denoting that fragment of
 * the document subject. References into the document may use either spelling, so
 * a document that mixes them must still resolve. The danubetech uni-resolver
 * driver emits the relative form throughout.
 */

const DID = 'did:btcr2:x1qk8wjcft0ypu2ju5v89p590jaklr30w7tprlpk9rt22f4y2qlq2j7fvyr2z';
const OTHER_DID = 'did:btcr2:x1qh9vyxphx0rhgpmwpa0p3u0qd5m8kf9lnya2tutsyfsf7z27jt09kargft7';
const MULTIBASE = 'zQ3shYMYeFyoPBrzjERPMFZJT4KDtukvTjLxE3utF7WheeZqK';

/** A document whose verification method id is a relative DID URL. */
function relativeDocument(): Btcr2DidDocument {
  return new DidDocument({
    '@context'           : ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
    id                   : DID,
    verificationMethod   : [{
      id                 : '#initialKey',
      type               : 'Multikey',
      controller         : DID,
      publicKeyMultibase : MULTIBASE,
    }],
    authentication       : ['#initialKey'],
    assertionMethod      : ['#initialKey'],
    capabilityInvocation : ['#initialKey'],
    capabilityDelegation : ['#initialKey'],
    service              : [{
      id              : '#initialP2PKH',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:mkHtHHQuUusioti869qvhZAn3VKsHmSdTm',
    }],
  });
}

describe('relative DID URLs in a DID document', () => {
  describe('Appendix.absoluteDidUrl', () => {
    it('resolves a fragment-only reference against the DID', () => {
      expect(Appendix.absoluteDidUrl('#initialKey', DID)).to.equal(`${DID}#initialKey`);
    });

    it('leaves an absolute DID URL unchanged', () => {
      expect(Appendix.absoluteDidUrl(`${DID}#initialKey`, DID)).to.equal(`${DID}#initialKey`);
    });

    it('returns undefined for a non-string or empty input', () => {
      expect(Appendix.absoluteDidUrl(undefined, DID)).to.equal(undefined);
      expect(Appendix.absoluteDidUrl(42, DID)).to.equal(undefined);
      expect(Appendix.absoluteDidUrl('', DID)).to.equal(undefined);
    });
  });

  describe('DidBtcr2.getSigningMethod', () => {
    it('matches a relative verification method id against an absolute reference', () => {
      const vm = DidBtcr2.getSigningMethod(relativeDocument(), `${DID}#initialKey`);
      expect(vm.id).to.equal('#initialKey');
      expect(vm.publicKeyMultibase).to.equal(MULTIBASE);
    });

    it('matches a relative verification method id against a relative reference', () => {
      const vm = DidBtcr2.getSigningMethod(relativeDocument(), '#initialKey');
      expect(vm.id).to.equal('#initialKey');
    });

    it('still matches when both the document and the reference are absolute', () => {
      const document = relativeDocument();
      document.verificationMethod[0]!.id = `${DID}#initialKey`;
      const vm = DidBtcr2.getSigningMethod(document, `${DID}#initialKey`);
      expect(vm.id).to.equal(`${DID}#initialKey`);
    });

    it('falls back to the default #initialKey fragment when no id is given', () => {
      const vm = DidBtcr2.getSigningMethod(relativeDocument());
      expect(vm.id).to.equal('#initialKey');
    });

    it('does not match a reference whose DID is a different subject', () => {
      expect(() => DidBtcr2.getSigningMethod(relativeDocument(), `${OTHER_DID}#initialKey`))
        .to.throw();
    });

    it('does not match an unknown fragment', () => {
      expect(() => DidBtcr2.getSigningMethod(relativeDocument(), `${DID}#unknownKey`))
        .to.throw();
    });

    it('does not return a malformed method when the target id is unusable', () => {
      // An unusable target and an unusable method id both resolve to undefined; without a
      // guard they compare equal and the malformed method is returned as the signing method.
      const document = relativeDocument();
      document.verificationMethod[0]!.id = '';
      document.assertionMethod = [];
      expect(() => DidBtcr2.getSigningMethod(document, '')).to.throw();
    });
  });

  describe('Appendix.relationshipMethodId', () => {
    it('resolves a relative reference entry against the DID', () => {
      expect(Appendix.relationshipMethodId('#initialKey', DID)).to.equal(`${DID}#initialKey`);
    });

    it('resolves an embedded method by its own relative id', () => {
      const embedded = { id: '#initialKey', type: 'Multikey', controller: DID };
      expect(Appendix.relationshipMethodId(embedded, DID)).to.equal(`${DID}#initialKey`);
    });

    it('leaves an absolute entry unchanged, including one naming another subject', () => {
      expect(Appendix.relationshipMethodId(`${OTHER_DID}#initialKey`, DID))
        .to.equal(`${OTHER_DID}#initialKey`);
    });

    it('returns undefined for an entry that names no method', () => {
      expect(Appendix.relationshipMethodId({ type: 'Multikey' }, DID)).to.equal(undefined);
      expect(Appendix.relationshipMethodId([], DID)).to.equal(undefined);
      expect(Appendix.relationshipMethodId(null, DID)).to.equal(undefined);
    });
  });

  describe('DidBtcr2.update on a document written with relative DID URLs', () => {
    // The deterministic document for a k1 DID, rewritten so every id it defines and every
    // reference into it is a relative DID URL. The keys are untouched, so the fixture's
    // secret key still signs for the method: this is the danubetech document shape with a
    // secret we hold.
    const fixture = data[0]!;
    const did = fixture.did;
    const signer: Signer = new LocalSigner(hexToBytes(fixture.secretKey));

    let document: Btcr2DidDocument;
    let absoluteVmId: string;
    let absoluteBeaconId: string;

    beforeEach(() => {
      const deterministic = Resolver.deterministic(Identifier.decode(did));
      document = new DidDocument(JSON.parse(JSON.stringify(deterministic)));
      absoluteVmId = document.verificationMethod[0]!.id;
      absoluteBeaconId = document.service[0]!.id;

      const relative = (id: string) => id.startsWith(did) ? id.slice(did.length) : id;
      document.verificationMethod = document.verificationMethod.map(vm => ({ ...vm, id: relative(vm.id) }));
      document.service = document.service.map(s => ({ ...s, id: relative(s.id) }));
      for(const relationship of ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'] as const) {
        document[relationship] = document[relationship]?.map(
          entry => typeof entry === 'string' ? relative(entry) : entry
        );
      }
    });

    it('authorizes an absolute verificationMethodId against a relative capabilityInvocation entry', () => {
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : absoluteVmId,
        beaconId             : absoluteBeaconId,
      })).to.not.throw();
    });

    it('authorizes a relative verificationMethodId and beaconId', () => {
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : '#initialKey',
        beaconId             : '#initialP2PKH',
      })).to.not.throw();
    });

    it('still refuses a verificationMethodId naming a different subject', () => {
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : `${OTHER_DID}#initialKey`,
        beaconId             : absoluteBeaconId,
      })).to.throw(/capabilityInvocation/i);
    });

    it('still refuses a beaconId naming a different subject', () => {
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : absoluteVmId,
        beaconId             : `${OTHER_DID}#initialP2PKH`,
      })).to.throw(/beacon/i);
    });

    it('refuses an unusable beaconId rather than matching an unusable service id', () => {
      document.service = document.service.map(s => ({ ...s, id: '' }));
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : absoluteVmId,
        beaconId             : '',
      })).to.throw();
    });

    it('signs an update whose proof names the method by absolute DID URL', () => {
      const updater = DidBtcr2.update({
        sourceDocument       : document,
        patches              : [{ op: 'add', path: '/service/-', value: { id: '#dwn', type: 'DWN', serviceEndpoint: 'https://dwn.example' } }],
        sourceVersionId      : 1,
        verificationMethodId : '#initialKey',
        beaconId             : '#initialP2PKH',
      });

      // Signing goes through the cryptosuite, which compares the proof's verificationMethod
      // against the key's absolute id: a proof left spelled `#initialKey` throws here.
      let state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedSigningKey, signer);

      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      updater.provide(state.needs[0] as NeedFunding);

      state = updater.advance();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const broadcastNeed = state.needs[0] as NeedBroadcast;
      expect(broadcastNeed.did).to.equal(did);
      expect(broadcastNeed.signedUpdate.proof.verificationMethod).to.equal(`${did}#initialKey`);
    });
  });
});
