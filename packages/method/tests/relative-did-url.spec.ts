import { DidDocumentError, INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/std';
import type { Signer } from '@did-btcr2/keys';
import { LocalSigner } from '@did-btcr2/keys';
import { hexToBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import type { NeedBroadcast, NeedFunding, NeedSigningKey } from '../src/core/updater.js';
import { Appendix } from '../src/utils/appendix.js';
import { DidDocument } from '../src/utils/did-document.js';
import { expandRelativeDidUrls } from '../src/utils/relative-did-url.js';
import type { Btcr2DidDocument, DidVerificationMethod } from '../src/utils/did-document.js';
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
    // DID Core v1.1, section 3.2.1: RFC 3986, section 5, resolves a relative DID URL against
    // the DID. The base has the scheme "did", the authority "<method-name>:<method-specific-id>",
    // an empty path, and no query. Each row is a relative DID URL, the text after the DID in
    // the result, and the rule of RFC 3986 that the row shows. The rules B, C, and E are the
    // rules of section 5.2.4 (remove_dot_segments).
    const RELATIVE_FORMS: Array<[ string, string, string ]> = [
      [ '', '', 'the empty reference gives the DID (5.2.2)' ],
      [ '#k', '#k', 'a fragment' ],
      [ '#', '#', 'an empty fragment' ],
      [ '?v=1', '?v=1', 'a query' ],
      [ '?', '?', 'an empty query' ],
      [ '?v=1#k', '?v=1#k', 'a query and a fragment' ],
      [ '/keys#k', '/keys#k', 'an absolute path' ],
      [ 'keys#k', '/keys#k', 'a relative path: the merge adds "/" (5.2.3)' ],
      [ 'keys/1', '/keys/1', 'a relative path with two segments' ],
      [ './a:b#k', '/a:b#k', 'a first segment with a colon after "./"' ],
      [ '/./g', '/g', 'rule B: the prefix "/./"' ],
      [ 'g/./h', '/g/h', 'rule B: "/./" in the path' ],
      [ './g/.', '/g/', 'rule B: "/." at the end of the path' ],
      [ '.', '/', 'rule B: "." alone' ],
      [ '/a/../k', '/k', 'rule C: "/../" removes the segment before it' ],
      [ 'g/../h', '/h', 'rule C: "/../" after a relative segment' ],
      [ '../keys#k', '/keys#k', 'rule C: "/../" at the root removes no segment' ],
      [ '/../g', '/g', 'rule C: the prefix "/../" of an absolute path' ],
      [ '../../../g', '/g', 'rule C: more "/../" than segments' ],
      [ 'a/b/c/./../../g', '/a/g', 'rules B and C in one path' ],
      [ 'g/..', '/', 'rule C: "/.." at the end of the path' ],
      [ '..', '/', 'rule C: ".." alone' ],
      [ 'g.', '/g.', 'rule E: a segment that ends with a dot' ],
      [ '..g', '/..g', 'rule E: a segment that starts with two dots' ],
      [ 'g?y/../x', '/g?y/../x', 'the query keeps its dot segments' ],
      [ 'g#s/./x', '/g#s/./x', 'the fragment keeps its dot segments' ],
    ];

    for(const [ reference, suffix, rule ] of RELATIVE_FORMS) {
      it(`resolves ${JSON.stringify(reference)} to "<did>${suffix}": ${rule}`, () => {
        expect(Appendix.absoluteDidUrl(reference, DID)).to.equal(`${DID}${suffix}`);
      });
    }

    // A value with a scheme is not a relative reference (RFC 3986, section 4.2). The result of
    // RFC 3986 for "//host#k" has an authority, and a DID URL has no authority.
    for(const [ value, kind ] of [
      [ `${DID}#initialKey`, 'an absolute DID URL' ],
      [ `${OTHER_DID}#initialKey`, 'an absolute DID URL under another DID' ],
      [ 'urn:x:1', 'a URN' ],
      [ '//host#k', 'a network-path reference' ],
    ]) {
      it(`returns ${kind} unchanged: ${JSON.stringify(value)}`, () => {
        expect(Appendix.absoluteDidUrl(value, DID)).to.equal(value);
      });
    }

    it('returns undefined for an input that is not a string', () => {
      for(const input of [ undefined, null, 42, {}, [ '#k' ] ]) {
        expect(Appendix.absoluteDidUrl(input, DID), JSON.stringify(input)).to.equal(undefined);
      }
    });

    it('returns undefined for a did that is not a string: {}, 42, or an object with no prototype', () => {
      for(const did of [ {}, 42, Object.create(null) ]) {
        expect(Appendix.absoluteDidUrl('#k', did as unknown as string)).to.equal(undefined);
      }
    });
  });

  describe('expandRelativeDidUrls (DID Resolution v1, section 4.4, step 6)', () => {
    const RELATIONSHIPS = [ 'authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation' ];

    // Each row is a verificationMethod id and the text after the DID in the id of the copy.
    for(const [ id, suffix ] of [
      [ '#k', '#k' ],
      [ '?key=1', '?key=1' ],
      [ '/keys/1', '/keys/1' ],
      [ 'keys/1', '/keys/1' ],
      [ '', '' ],
    ]) {
      it(`expands the verificationMethod id ${JSON.stringify(id)} to "<did>${suffix}"`, () => {
        const copy = expandRelativeDidUrls({ id: DID, verificationMethod: [{ id, type: 'Multikey' }] }, DID);
        expect(copy.verificationMethod).to.deep.equal([{ id: `${DID}${suffix}`, type: 'Multikey' }]);
      });
    }

    it('expands each string item of the five verification relationships and the id of an embedded method', () => {
      const document = Object.fromEntries(RELATIONSHIPS.map(name => [ name, [ '#k', { id: '#embedded', type: 'Multikey' } ] ]));
      const copy = expandRelativeDidUrls({ id: DID, ...document }, DID);
      for(const name of RELATIONSHIPS) {
        expect(copy[name], name).to.deep.equal([ `${DID}#k`, { id: `${DID}#embedded`, type: 'Multikey' } ]);
      }
    });

    it('expands the id of a method that conditionAnd of a VerifiableCondition2021 method holds, at depth 1 and 2', () => {
      const condition = (id: string, conditionAnd: Array<object>) => ({ id, type: 'VerifiableCondition2021', conditionAnd });
      const copy = expandRelativeDidUrls({
        id                 : DID,
        verificationMethod : [ condition('#1', [ { id: '#1-1', type: 'Multikey' }, condition('#1-2', [ { id: '#2-1', type: 'Multikey' } ]) ]) ],
      }, DID);
      expect(copy.verificationMethod).to.deep.equal([ condition(`${DID}#1`, [
        { id: `${DID}#1-1`, type: 'Multikey' },
        condition(`${DID}#1-2`, [ { id: `${DID}#2-1`, type: 'Multikey' } ])
      ]) ]);
    });

    it('expands a service id, and keeps the serviceEndpoint value: a map in it keeps its id, and a string stays', () => {
      const copy = expandRelativeDidUrls({
        id      : DID,
        service : [
          { id: '?service=files', type: 'Files', serviceEndpoint: { id: '#inner', nested: [ { id: '#deep' } ] } },
          { id: '#beacon', type: 'SingletonBeacon', serviceEndpoint: 'bitcoin:mkHtHHQuUusioti869qvhZAn3VKsHmSdTm' },
        ],
      }, DID);
      expect(copy.service).to.deep.equal([
        { id: `${DID}?service=files`, type: 'Files', serviceEndpoint: { id: '#inner', nested: [ { id: '#deep' } ] } },
        { id: `${DID}#beacon`, type: 'SingletonBeacon', serviceEndpoint: 'bitcoin:mkHtHHQuUusioti869qvhZAn3VKsHmSdTm' },
      ]);
    });

    it('expands the ids in a member that DID Core does not define', () => {
      const copy = expandRelativeDidUrls({ id: DID, extProp: { id: 'top', nested: [ { id: '#ext' } ] } }, DID);
      expect(copy.extProp).to.deep.equal({ id: `${DID}/top`, nested: [ { id: `${DID}#ext` } ] });
    });

    it('keeps the document id, @context, controller, alsoKnownAs, an id with a scheme or "//", an id that is not a string, and a relationship item of another type', () => {
      const document = {
        '@context'         : [ 'https://www.w3.org/ns/did/v1.1', { id: '@id', type: '@type' } ],
        id                 : DID,
        controller         : [ DID, '#controller' ],
        alsoKnownAs        : [ '#aka', 'https://example.com/aka' ],
        verificationMethod : [ 'urn:x:1', `${DID}#k`, 'https://example.com/k', '//host#k', 42 ].map(id => ({ id, type: 'Multikey' })),
        authentication     : [ 42, 'urn:x:1', '//host#k', null ],
      };
      expect(expandRelativeDidUrls(document, DID)).to.deep.equal(document);
    });

    it('does not change the input, and the copy shares no map or array with the input', () => {
      const document = {
        '@context'         : [ 'https://www.w3.org/ns/did/v1.1', { id: '@id' } ],
        id                 : DID,
        verificationMethod : [ { id: '#k', type: 'Multikey', extra: { id: '#x' } } ],
        service            : [ { id: '#s', type: 'Files', serviceEndpoint: { id: '#inner', uris: [ 'https://example.com' ] } } ],
      };
      const before = structuredClone(document);
      const copy = expandRelativeDidUrls(document, DID) as typeof document;
      expect(document).to.deep.equal(before);
      for(const [ copied, original ] of [
        [ copy['@context'], document['@context'] ],
        [ copy['@context'][1], document['@context'][1] ],
        [ copy.verificationMethod, document.verificationMethod ],
        [ copy.verificationMethod[0]!.extra, document.verificationMethod[0]!.extra ],
        [ copy.service[0]!.serviceEndpoint, document.service[0]!.serviceEndpoint ],
        [ copy.service[0]!.serviceEndpoint.uris, document.service[0]!.serviceEndpoint.uris ],
      ]) {
        expect(copied).to.not.equal(original);
      }
    });

    it('keeps a "__proto__" member as an own data member, expands its id, and keeps Object.prototype as the prototype of the copy', () => {
      const document = JSON.parse(`{ "id": "${DID}", "__proto__": { "id": "#top" }, "extProp": { "__proto__": { "id": "#p" } } }`);
      const copy = expandRelativeDidUrls(document, DID);
      for(const [ map, id ] of [ [ copy, '#top' ], [ copy.extProp, '#p' ] ] as const) {
        expect(Object.getPrototypeOf(map), id).to.equal(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(map, '__proto__'), id).to.deep.equal({
          value        : { id: `${DID}${id}` },
          writable     : true,
          enumerable   : true,
          configurable : true,
        });
      }
    });
  });

  describe('DidBtcr2.getSigningMethod', () => {
    // DidBtcr2.getSigningMethod returns the method that can sign an update: the result of
    // Updater.signingMethod. Each error is an UpdateError of the type INVALID_DID_UPDATE.

    /** Call `fn` and return what it threw, or undefined. */
    function thrownBy(fn: () => unknown): any {
      try {
        fn();
      } catch(error) {
        return error;
      }
      return undefined;
    }

    /** Expect an UpdateError of the type INVALID_DID_UPDATE with `message` and `data`. */
    function expectRefusal(thrown: any, message: string, data: Record<string, unknown>): void {
      expect(thrown, 'expected the input to be refused').to.be.instanceOf(UpdateError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.equal(message);
      expect(thrown.data).to.deep.equal(data);
    }

    /** A Multikey method with the id `id`, the DID as the controller, and the key MULTIBASE. */
    function multikey(id: string): DidVerificationMethod {
      return { id, type: 'Multikey', controller: DID, publicKeyMultibase: MULTIBASE } as DidVerificationMethod;
    }

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
      document.verificationMethod![0]!.id = `${DID}#initialKey`;
      const vm = DidBtcr2.getSigningMethod(document, `${DID}#initialKey`);
      expect(vm.id).to.equal(`${DID}#initialKey`);
    });

    it('uses #initialKey if the caller gives no id, also if another method comes first', () => {
      const document = relativeDocument();
      document.verificationMethod!.unshift(multikey('#otherKey'));
      document.capabilityInvocation!.unshift('#otherKey');
      document.assertionMethod!.unshift('#otherKey');
      expect(DidBtcr2.getSigningMethod(document)).to.deep.equal(document.verificationMethod![1]);
    });

    it('refuses a document without #initialKey if the caller gives no id, and does not use assertionMethod', () => {
      const document = relativeDocument();
      document.verificationMethod![0]!.id = '#otherKey';
      for(const relationship of [ 'authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation' ] as const) {
        document[relationship] = [ '#otherKey' ];
      }
      expectRefusal(
        thrownBy(() => DidBtcr2.getSigningMethod(document)),
        'Invalid verificationMethodId: not authorized for capabilityInvocation',
        { verificationMethodId: `${DID}#initialKey`, capabilityInvocation: [ '#otherKey' ] }
      );
    });

    it('refuses a reference whose DID is a different subject', () => {
      expectRefusal(
        thrownBy(() => DidBtcr2.getSigningMethod(relativeDocument(), `${OTHER_DID}#initialKey`)),
        `Invalid verificationMethodId: expected "${DID}" followed by a fragment, a query, or a path; got "${OTHER_DID}#initialKey".`,
        { verificationMethodId: `${OTHER_DID}#initialKey` }
      );
    });

    it('refuses an unknown fragment', () => {
      expectRefusal(
        thrownBy(() => DidBtcr2.getSigningMethod(relativeDocument(), `${DID}#unknownKey`)),
        'Invalid verificationMethodId: not authorized for capabilityInvocation',
        { verificationMethodId: `${DID}#unknownKey`, capabilityInvocation: [ '#initialKey' ] }
      );
    });

    it('refuses a method with a key that only authentication lists or embeds', () => {
      const referenced = relativeDocument();
      referenced.verificationMethod!.push(multikey('#authKey'));
      referenced.authentication!.push('#authKey');
      const embedded = relativeDocument();
      embedded.authentication!.push(multikey('#authKey'));
      for(const document of [ referenced, embedded ]) {
        expectRefusal(
          thrownBy(() => DidBtcr2.getSigningMethod(document, '#authKey')),
          'Invalid verificationMethodId: not authorized for capabilityInvocation',
          { verificationMethodId: `${DID}#authKey`, capabilityInvocation: [ '#initialKey' ] }
        );
      }
    });

    it('refuses the document of another DID method', () => {
      const document = { ...relativeDocument(), id: 'did:example:123' } as Btcr2DidDocument;
      expectRefusal(
        thrownBy(() => DidBtcr2.getSigningMethod(document)),
        'Expected a did:btcr2 identifier for the root capability; got "did:example:123".',
        { did: 'did:example:123' }
      );
    });

    it('refuses a method of the type JsonWebKey2020', () => {
      const document = relativeDocument();
      document.verificationMethod![0]!.type = 'JsonWebKey2020';
      expectRefusal(
        thrownBy(() => DidBtcr2.getSigningMethod(document)),
        'Invalid update: verificationMethod.type must equal "Multikey"',
        { verificationMethodId: `${DID}#initialKey`, field: 'type', actual: 'JsonWebKey2020' }
      );
    });

    it('finds a method that capabilityInvocation embeds and verificationMethod does not list (ADR 112)', () => {
      const document = relativeDocument();
      document.capabilityInvocation!.push(multikey('#embeddedKey'));
      const vm = DidBtcr2.getSigningMethod(document, `${DID}#embeddedKey`);
      expect(vm.id).to.equal('#embeddedKey');
    });

    it('refuses an empty id: it resolves to the DID, and the DID is not a method id', () => {
      // RFC 3986, section 5.2.2: the empty reference resolves to the DID. A method id must be
      // the DID, then a fragment, a query, or a path.
      const document = relativeDocument();
      document.verificationMethod![0]!.id = '';
      expectRefusal(
        thrownBy(() => DidBtcr2.getSigningMethod(document, '')),
        `Invalid verificationMethodId: expected "${DID}" followed by a fragment, a query, or a path; got "${DID}".`,
        { verificationMethodId: DID }
      );
    });
  });

  describe('Appendix.capabilityInvocationEntry and verificationMethodOfEntry (ADR 112)', () => {
    const embedded = {
      id                 : '#embeddedKey',
      type               : 'Multikey',
      controller         : DID,
      publicKeyMultibase : MULTIBASE,
    };

    it('finds a reference entry in either spelling', () => {
      const document = relativeDocument();
      expect(Appendix.capabilityInvocationEntry(document, '#initialKey')).to.equal('#initialKey');
      expect(Appendix.capabilityInvocationEntry(document, `${DID}#initialKey`)).to.equal('#initialKey');
    });

    it('finds an embedded entry by its id', () => {
      const document = relativeDocument();
      document.capabilityInvocation!.push(embedded);
      expect(Appendix.capabilityInvocationEntry(document, `${DID}#embeddedKey`)).to.deep.equal(embedded);
    });

    it('returns undefined when no entry identifies the id, or when the id is unusable', () => {
      const document = relativeDocument();
      expect(Appendix.capabilityInvocationEntry(document, '#unknownKey')).to.equal(undefined);
      expect(Appendix.capabilityInvocationEntry(document, `${OTHER_DID}#initialKey`)).to.equal(undefined);
      expect(Appendix.capabilityInvocationEntry(document, 42)).to.equal(undefined);
      expect(Appendix.capabilityInvocationEntry({ ...document, capabilityInvocation: undefined }, '#initialKey')).to.equal(undefined);
    });

    it('resolves a reference entry to the verificationMethod member in either spelling', () => {
      const document = relativeDocument();
      expect(Appendix.verificationMethodOfEntry(document, '#initialKey')?.publicKeyMultibase).to.equal(MULTIBASE);
      expect(Appendix.verificationMethodOfEntry(document, `${DID}#initialKey`)?.publicKeyMultibase).to.equal(MULTIBASE);
    });

    it('returns an embedded entry as the method itself', () => {
      const document = relativeDocument();
      expect(Appendix.verificationMethodOfEntry(document, embedded)).to.equal(embedded);
    });

    it('returns undefined for a reference that names no member', () => {
      const document = relativeDocument();
      expect(Appendix.verificationMethodOfEntry(document, '#ghost')).to.equal(undefined);
      expect(Appendix.verificationMethodOfEntry(document, `${OTHER_DID}#initialKey`)).to.equal(undefined);
    });
  });

  describe('Appendix.getVerificationMethods', () => {
    const embedded = {
      id                 : '#embeddedKey',
      type               : 'Multikey',
      controller         : DID,
      publicKeyMultibase : MULTIBASE,
    };

    it('returns the verificationMethod members and the methods that a relationship embeds, and no reference', () => {
      const document = relativeDocument();
      expect(Appendix.getVerificationMethods(document)).to.deep.equal(document.verificationMethod);
      document.capabilityInvocation = ['#initialKey', embedded];
      expect(Appendix.getVerificationMethods(document)).to.deep.equal([ ...document.verificationMethod!, embedded ]);
    });

    it('returns only the embedded methods of a document with no verificationMethod member', () => {
      const document = relativeDocument() as any;
      delete document.verificationMethod;
      delete document.authentication;
      document.assertionMethod = [embedded];
      expect(Appendix.getVerificationMethods(document)).to.deep.equal([embedded]);
    });

    it('throws a DidDocumentError for an absent document', () => {
      expect(() => Appendix.getVerificationMethods(undefined as any))
        .to.throw(DidDocumentError, 'Required parameter missing: \'didDocument\'');
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
      absoluteVmId = document.verificationMethod![0]!.id;
      absoluteBeaconId = document.service![0]!.id;

      const relative = (id: string) => id.startsWith(did) ? id.slice(did.length) : id;
      document.verificationMethod = document.verificationMethod!.map(vm => ({ ...vm, id: relative(vm.id) }));
      document.service = document.service!.map(s => ({ ...s, id: relative(s.id) }));
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
      })).to.throw(
        `Invalid verificationMethodId: expected "${document.id}" followed by a fragment, a query, or a path; `
        + `got "${OTHER_DID}#initialKey".`
      );
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

    it('refuses a beaconId that is not a string, and does not match it with a service id that is not a string', () => {
      document.service = document.service!.map(s => ({ ...s, id: 42 as unknown as string }));
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : absoluteVmId,
        beaconId             : 42 as unknown as string,
      })).to.throw('No beacon service found for provided beaconId');
    });

    it('finds a service with the id "" by the beaconId "": both resolve to the DID', () => {
      // RFC 3986, section 5.2.2: the empty reference resolves to the DID.
      document.service = document.service!.map(s => ({ ...s, id: '' }));
      expect(() => DidBtcr2.update({
        sourceDocument       : document,
        patches              : [],
        sourceVersionId      : 1,
        verificationMethodId : absoluteVmId,
        beaconId             : '',
      })).to.not.throw();
    });

    /**
     * A copy of the document with one more method and one more capabilityInvocation entry. The
     * method has the id `methodId` and the key of the first method. The entry is `entry`.
     */
    function withSigningMethod(methodId: string, entry: string): Btcr2DidDocument {
      const copy = new DidDocument(JSON.parse(JSON.stringify(document)));
      copy.verificationMethod!.push({ ...copy.verificationMethod![0]!, id: methodId });
      copy.capabilityInvocation!.push(entry);
      return copy;
    }

    for(const relativeId of [ '?key=1', '/keys/1' ]) {
      it(`authorizes the method "<did>${relativeId}" through the entry ${JSON.stringify(relativeId)}, and the reverse spelling`, () => {
        const absoluteId = `${did}${relativeId}`;
        for(const [ methodId, entry ] of [ [ absoluteId, relativeId ], [ relativeId, absoluteId ] ]) {
          for(const verificationMethodId of [ relativeId, absoluteId ]) {
            const label = `method ${methodId}, entry ${entry}, verificationMethodId ${verificationMethodId}`;
            const state = DidBtcr2.update({
              sourceDocument  : withSigningMethod(methodId, entry),
              patches         : [],
              sourceVersionId : 1,
              verificationMethodId,
              beaconId        : absoluteBeaconId,
            }).advance();
            if(state.status !== 'action-required') throw new Error('expected action-required');
            expect((state.needs[0] as NeedSigningKey).verificationMethodId, label).to.equal(absoluteId);
          }
        }
      });
    }

    it('finds the beacon service "?service=x" by the beaconId "<did>?service=x", and the reverse spelling', () => {
      for(const [ serviceId, beaconId ] of [ [ '?service=x', `${did}?service=x` ], [ `${did}?service=x`, '?service=x' ] ]) {
        const copy = new DidDocument(JSON.parse(JSON.stringify(document)));
        copy.service!.push({ ...copy.service![0]!, id: serviceId });
        expect(() => DidBtcr2.update({
          sourceDocument       : copy,
          patches              : [],
          sourceVersionId      : 1,
          verificationMethodId : absoluteVmId,
          beaconId,
        }), `service ${serviceId}, beaconId ${beaconId}`).to.not.throw();
      }
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
