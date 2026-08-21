import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { Appendix } from '../src/utils/appendix.js';
import { DidDocument } from '../src/utils/did-document.js';
import type { Btcr2DidDocument } from '../src/utils/did-document.js';

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
  });
});
