import { canonicalHash, DidDocumentError, INVALID_DID_DOCUMENT } from '@did-btcr2/common';
import { p256 } from '@noble/curves/nist.js';
import { base58, base64urlnopad } from '@scure/base';
import { expect } from 'chai';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import { DidDocumentBuilder } from '../src/utils/did-document-builder.js';
import type { Btcr2VerificationMethod, DidDocumentLike, ExternalData } from '../src/utils/did-document.js';
import {
  BTCR2_DID_DOCUMENT_CONTEXT,
  DidDocument,
  DidVerificationMethod,
  GenesisDocument,
} from '../src/utils/did-document.js';
import deterministicData from './data/deterministic-data.js';
import externalData from './data/external-data.js';

/**
 * DID Document validation and the DidVerificationMethod class.
 *
 * The `@context` check accepts each document that has the btcr2 base contexts. W3C DID Core
 * 4.1 allows more contexts, so the check does not refuse them. The `verificationMethod` check
 * reads only the structure of each method: a string `id`, `type`, and `controller` (CID 2.2).
 * A method can have any type and any key material. Only the method that signs an update must
 * be a secp256k1 Multikey: signing-method.spec.ts tests that condition.
 */

/**
 * Build a valid NON-genesis DID document from an external fixture by substituting
 * the `did:btcr2:_` placeholder with the fixture's real identifier. Genesis
 * documents (placeholder id) bypass `isValidContext` via `validateGenesis`, so a
 * real id is required to exercise the context rules through `DidDocument.isValid`.
 */
function validDocument(): Record<string, unknown> {
  const fixture = externalData[0]!;
  const raw = JSON.stringify(fixture.genesisDocument).split('did:btcr2:_').join(fixture.did);
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('DidDocument @context validation (extensibility)', () => {
  it('accepts a document carrying exactly the btcr2 base contexts', () => {
    const doc = validDocument();
    doc['@context'] = [...BTCR2_DID_DOCUMENT_CONTEXT];
    expect(DidDocument.isValid(doc)).to.equal(true);
  });

  it('accepts an additional proof-suite / extension context (no longer whitelisted away)', () => {
    const doc = validDocument();
    doc['@context'] = [...BTCR2_DID_DOCUMENT_CONTEXT, 'https://w3id.org/security/data-integrity/v2'];
    expect(DidDocument.isValid(doc)).to.equal(true);
  });

  it('accepts an inline object context entry alongside the base contexts', () => {
    const doc = validDocument();
    doc['@context'] = [...BTCR2_DID_DOCUMENT_CONTEXT, { '@vocab': 'https://example.com/vocab#' }];
    expect(DidDocument.isValid(doc)).to.equal(true);
  });

  it('rejects a document missing a required btcr2 base context', () => {
    const doc = validDocument();
    // Drop the btcr2 context, keep only the DID Core context plus an extension.
    doc['@context'] = ['https://www.w3.org/ns/did/v1.1', 'https://w3id.org/security/data-integrity/v2'];
    expect(() => DidDocument.isValid(doc)).to.throw('Invalid "@context"');
  });

  it('rejects a non-array @context', () => {
    const doc = validDocument();
    doc['@context'] = 'https://www.w3.org/ns/did/v1.1';
    expect(() => DidDocument.isValid(doc)).to.throw('Invalid "@context"');
  });

  it('rejects an empty @context array', () => {
    const doc = validDocument();
    doc['@context'] = [];
    expect(() => DidDocument.isValid(doc)).to.throw('Invalid "@context"');
  });
});

/** The base58btc multibase (`z` header) of a multicodec prefix and a 32-byte key of `fill` bytes. */
function multikey(prefix: [ number, number ], fill: number): string {
  return `z${base58.encode(new Uint8Array([ ...prefix, ...new Uint8Array(32).fill(fill) ]))}`;
}

/** An Ed25519 Multikey (multicodec 0xed01): the z6Mk form. */
const ED25519_KEY = multikey([ 0xed, 0x01 ], 7);

/** An X25519 Multikey (multicodec 0xec01): the z6LS form. */
const X25519_KEY = multikey([ 0xec, 0x01 ], 9);

/** The public JWK of the P-256 key of secret 1. */
function p256Jwk(): { kty: string; crv: string; x: string; y: string } {
  const secret = new Uint8Array(32);
  secret[31] = 1;
  const point = p256.getPublicKey(secret, false);
  return { kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(point.slice(1, 33)), y: base64urlnopad.encode(point.slice(33)) };
}

const P256_JWK = p256Jwk();

describe('DidVerificationMethod construction', () => {
  /** The KEY template method of the first deterministic fixture DID. */
  function keyTemplateMethod(): Btcr2VerificationMethod {
    const did = deterministicData[0]!.did;
    return { ...Resolver.deterministic(Identifier.decode(did)).verificationMethod![0]! };
  }

  it('keeps the values of the KEY template method', () => {
    const template = keyTemplateMethod();
    expect(template.publicKeyMultibase!.startsWith('zQ3s')).to.equal(true);
    const method = new DidVerificationMethod(template);
    expect(method).to.be.instanceOf(DidVerificationMethod);
    expect({ ...method }).to.deep.equal(template);
    expect(Object.keys(method)).to.have.members([ 'id', 'type', 'controller', 'publicKeyMultibase' ]);
  });

  it('keeps publicKeyJwk and expires of a JsonWebKey method and adds no key properties', () => {
    const did = externalData[0]!.did;
    const input = {
      id           : `${did}#p256`,
      type         : 'JsonWebKey',
      controller   : did,
      publicKeyJwk : P256_JWK,
      expires      : '2030-01-01T00:00:00Z',
    } as Btcr2VerificationMethod & { expires: string };
    const method = new DidVerificationMethod(input);
    const own = method as unknown as Record<string, unknown>;
    expect(own.publicKeyJwk).to.deep.equal(P256_JWK);
    expect(own.expires).to.equal('2030-01-01T00:00:00Z');
    expect({ ...method }).to.deep.equal(input);
    expect(Object.keys(method)).to.have.members([ 'id', 'type', 'controller', 'publicKeyJwk', 'expires' ]);
    expect(method).to.not.have.own.property('publicKeyMultibase');
    expect(method).to.not.have.own.property('secretKeyMultibase');
  });

  it('does not keep an undefined secretKeyMultibase as a property', () => {
    const method = new DidVerificationMethod({ ...keyTemplateMethod(), secretKeyMultibase: undefined });
    expect(Object.keys(method)).to.not.include('secretKeyMultibase');
    expect(method).to.not.have.own.property('secretKeyMultibase');
  });

  it('does not throw for the type JsonWebKey2020 or for an Ed25519 key', () => {
    const template = keyTemplateMethod();
    expect(new DidVerificationMethod({ ...template, type: 'JsonWebKey2020' }).type).to.equal('JsonWebKey2020');
    expect(new DidVerificationMethod({ ...template, publicKeyMultibase: ED25519_KEY }).publicKeyMultibase).to.equal(ED25519_KEY);
  });

  it('keeps a false, 0, null, and empty-string value as given', () => {
    const input = { ...keyTemplateMethod(), secretKeyMultibase: '', flag: false, count: 0, note: null, label: '' };
    const method = new DidVerificationMethod(input);
    expect({ ...method }).to.deep.equal(input);
  });

  it('keeps a "__proto__" property as data and keeps the prototype', () => {
    const input = JSON.parse(`{"__proto__":{"note":"kept"},${JSON.stringify(keyTemplateMethod()).slice(1)}`);
    const method = new DidVerificationMethod(input);
    expect(Object.getPrototypeOf(method)).to.equal(DidVerificationMethod.prototype);
    expect(Object.keys(method)).to.include('__proto__');
    expect(JSON.stringify(method)).to.include('"__proto__":{"note":"kept"}');
  });
});

describe('DidDocument verificationMethod members', () => {
  /** A copy of the valid document with the changes of `change`. */
  function changed(change: (document: Record<string, any>, did: string) => void): Record<string, any> {
    const document = validDocument() as Record<string, any>;
    change(document, document.id);
    return document;
  }

  /** Expect DidDocument.isValid and the DidDocument constructor to accept `document`. */
  function expectAccepted(document: Record<string, any>): void {
    expect(DidDocument.isValid(document as DidDocumentLike)).to.equal(true);
    expect(new DidDocument(JSON.parse(JSON.stringify(document))).toJSON()).to.deep.equal(document);
  }

  /** Expect DidDocument.isValid and the DidDocument constructor to refuse `document` for verificationMethod. */
  function expectRefused(document: Record<string, any>): void {
    for(const check of [ () => DidDocument.isValid(document as DidDocumentLike), () => new DidDocument(document as DidDocumentLike) ]) {
      let thrown: any;
      try {
        check();
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected a refusal').to.be.instanceOf(DidDocumentError);
      expect(thrown.type).to.equal(INVALID_DID_DOCUMENT);
      expect(thrown.message).to.match(/verificationMethod/);
    }
  }

  it('accepts an Ed25519 Multikey authentication method', () => {
    expectAccepted(changed((document, did) => {
      document.verificationMethod.push({ id: `${did}#ed25519`, type: 'Multikey', controller: did, publicKeyMultibase: ED25519_KEY });
      document.authentication.push(`${did}#ed25519`);
    }));
  });

  it('accepts a P-256 JsonWebKey method with a publicKeyJwk', () => {
    expectAccepted(changed((document, did) => {
      document.verificationMethod.push({ id: `${did}#p256`, type: 'JsonWebKey', controller: did, publicKeyJwk: P256_JWK });
      document.assertionMethod.push(`${did}#p256`);
    }));
  });

  it('accepts an X25519 Multikey keyAgreement method', () => {
    expectAccepted(changed((document, did) => {
      document.verificationMethod.push({ id: `${did}#x25519`, type: 'Multikey', controller: did, publicKeyMultibase: X25519_KEY });
      document.keyAgreement = [`${did}#x25519`];
    }));
  });

  it('accepts a JsonWebKey2020 method with only a publicKeyMultibase', () => {
    expectAccepted(changed((document, did) => {
      const { publicKeyMultibase } = document.verificationMethod[0];
      document.verificationMethod.push({ id: `${did}#jwk2020`, type: 'JsonWebKey2020', controller: did, publicKeyMultibase });
    }));
  });

  it('refuses a member whose type is not a string', () => {
    expectRefused(changed((document, did) => {
      document.verificationMethod.push({ id: `${did}#bad`, type: 42, controller: did, publicKeyMultibase: ED25519_KEY });
    }));
  });

  it('refuses a member with no controller', () => {
    expectRefused(changed((document, did) => {
      document.verificationMethod.push({ id: `${did}#bad`, type: 'Multikey', publicKeyMultibase: ED25519_KEY });
    }));
  });

  it('refuses a member whose id is not a string', () => {
    expectRefused(changed((document, did) => {
      document.verificationMethod.push({ id: 42, type: 'Multikey', controller: did, publicKeyMultibase: ED25519_KEY });
    }));
  });

  it('refuses a member that is not an object', () => {
    // A string is a reference to a method. verificationMethod must hold the method itself.
    const did = validDocument().id as string;
    for(const member of [ null, `${did}#key-0` ]) {
      expectRefused(changed(document => {
        document.verificationMethod.push(member);
      }));
    }
  });
});

describe('DidDocument deactivated property (ADR 142)', () => {
  it('keeps the deactivated value of the input', () => {
    for(const value of [true, false]) {
      const document = new DidDocument({ ...validDocument(), deactivated: value });
      expect(document.deactivated).to.equal(value);
      expect(document.toJSON().deactivated).to.equal(value);
    }
  });

  it('has no deactivated property if the input has none', () => {
    expect(new DidDocument(validDocument())).to.not.have.property('deactivated');
  });
});

describe('DidDocument properties (ADR 144)', () => {
  it('keeps the properties that the class does not name', () => {
    const document = validDocument();
    const did = document.id as string;
    const input = {
      ...document,
      alsoKnownAs  : ['https://example.com/alice'],
      controller   : did,
      keyAgreement : [`${did}#key-0`],
      extension    : { note: 'kept' },
    };
    const didDocument = new DidDocument(input);
    expect(didDocument.toJSON()).to.deep.equal(input);
    expect(canonicalHash(didDocument)).to.equal(canonicalHash(input));
  });

  it('keeps a "__proto__" property as data and keeps the prototype', () => {
    const input = JSON.parse(`{"__proto__":{"note":"kept"},${JSON.stringify(validDocument()).slice(1)}`);
    const didDocument = new DidDocument(input);
    expect(Object.getPrototypeOf(didDocument)).to.equal(DidDocument.prototype);
    expect(Object.keys(didDocument)).to.include('__proto__');
    expect(JSON.stringify(didDocument)).to.include('"__proto__":{"note":"kept"}');
  });

  it('adds no relationship to a k1 document', () => {
    const did = deterministicData[0]!.did;
    const input = Resolver.deterministic(Identifier.decode(did)).toJSON();
    delete input.authentication;
    const didDocument = new DidDocument(input);
    expect(didDocument).to.not.have.property('authentication');
    expect(didDocument.toJSON()).to.deep.equal(input);
  });
});

describe('DidDocument.fromKeyIdentifier', () => {
  it('makes the KEY template document of a k1 DID', () => {
    const did = deterministicData[0]!.did;
    const deterministic = Resolver.deterministic(Identifier.decode(did));
    const document = DidDocument.fromKeyIdentifier(
      did, deterministic.verificationMethod![0]!.publicKeyMultibase!, deterministic.service!
    );
    const keyRef = `${did}#initialKey`;
    expect(document.id).to.equal(did);
    expect(document.verificationMethod![0]!.id).to.equal(keyRef);
    for(const relationship of ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'] as const) {
      expect(document[relationship]).to.deep.equal([keyRef]);
    }
    expect(document.toJSON()).to.deep.equal(deterministic.toJSON());
  });
});

describe('DidDocument sets no defaults (ADR 148)', () => {
  // Spec "DID Document": a DID document must include "@context" and "id". The members
  // "verificationMethod" and "service" are optional. The class adds no member, so the
  // document hash is the hash of the input.

  const RELATIONSHIPS = ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'] as const;

  /** A copy of the external genesis fixture: a Genesis Document with every member. */
  function genesisDocument(): Record<string, any> {
    return JSON.parse(JSON.stringify(externalData[0]!.genesisDocument)) as Record<string, any>;
  }

  /**
   * A copy of `document` without the given members. If the copy has no verificationMethod,
   * each relationship embeds the method, so no relationship holds a reference to a removed
   * method.
   */
  function without(document: Record<string, any>, members: Array<string>): Record<string, any> {
    const copy = JSON.parse(JSON.stringify(document)) as Record<string, any>;
    if(members.includes('verificationMethod')) {
      const [method] = copy.verificationMethod;
      for(const relationship of RELATIONSHIPS) {
        copy[relationship] = [{ ...method }];
      }
    }
    for(const member of members) {
      delete copy[member];
    }
    return copy;
  }

  /** The error that `fn` throws, or undefined. */
  function thrownBy(fn: () => unknown): any {
    try {
      fn();
    } catch(error) {
      return error;
    }
    return undefined;
  }

  /** Expect `fn` to throw a DidDocumentError of the type INVALID_DID_DOCUMENT, and return it. */
  function expectInvalid(fn: () => unknown, label: string): any {
    const thrown = thrownBy(fn);
    expect(thrown, label).to.be.instanceOf(DidDocumentError);
    expect(thrown.type, label).to.equal(INVALID_DID_DOCUMENT);
    return thrown;
  }

  const ABSENT_MEMBERS = [['verificationMethod'], ['service'], ['verificationMethod', 'service']];

  it('constructs a DID document without verificationMethod, without service, or without both, and adds no member', () => {
    for(const members of ABSENT_MEMBERS) {
      const input = without(validDocument(), members);
      const document = new DidDocument(JSON.parse(JSON.stringify(input)));
      for(const member of members) {
        expect(document, member).to.not.have.own.property(member);
        expect(Object.keys(document.toJSON()), member).to.not.include(member);
      }
      expect(document.toJSON()).to.deep.equal(input);
      expect(canonicalHash(document)).to.equal(canonicalHash(input));
    }
  });

  it('constructs a Genesis Document without verificationMethod, without service, or without both, and adds no member', () => {
    for(const members of ABSENT_MEMBERS) {
      const input = without(genesisDocument(), members);
      const document = GenesisDocument.fromJSON(JSON.parse(JSON.stringify(input)));
      for(const member of members) {
        expect(document, member).to.not.have.own.property(member);
        expect(Object.keys(document.toJSON()), member).to.not.include(member);
      }
      expect(document.toJSON()).to.deep.equal(input);
      expect(canonicalHash(document)).to.equal(canonicalHash(input));
    }
  });

  it('refuses a null service or a null verificationMethod in a DID document', () => {
    for(const member of ['service', 'verificationMethod']) {
      const input = { ...validDocument(), [member]: null };
      // The constructor check of the member fails first. isValid names the member in quotes.
      const constructed = expectInvalid(() => new DidDocument(input as DidDocumentLike), `new DidDocument with ${member} null`);
      expect(constructed.message, `new DidDocument with ${member} null`).to.equal(`Invalid ${member}: null`);
      const validated = expectInvalid(() => DidDocument.isValid(input as DidDocumentLike), `DidDocument.isValid with ${member} null`);
      expect(validated.message, `DidDocument.isValid with ${member} null`).to.equal(`Invalid "${member}"`);
    }
  });

  it('refuses a null service or a null verificationMethod in a Genesis Document', () => {
    for(const member of ['service', 'verificationMethod']) {
      const thrown = expectInvalid(() => GenesisDocument.fromJSON({ ...genesisDocument(), [member]: null }), `${member} null`);
      expect(thrown.message).to.equal(`Invalid GenesisDocument ${member}`);
    }
  });

  it('refuses a genesis service or verificationMethod that is a string with a DidDocumentError, not a TypeError', () => {
    for(const member of ['service', 'verificationMethod']) {
      const thrown = expectInvalid(() => GenesisDocument.fromJSON({ ...genesisDocument(), [member]: 'x' }), `${member} "x"`);
      expect(thrown.message).to.equal(`Invalid GenesisDocument ${member}`);
    }
  });

  it('gives a DidDocumentError, not a TypeError, for a genesis service whose id is not a string', () => {
    // The service shape check (isDidService) does not check the type of id. Without a string check, an
    // array id that holds the placeholder passes, because Array.prototype.includes finds it.
    for(const id of [42, 5, null, { x: 1 }, ['did:btcr2:_']]) {
      const service = [{ id, type: 'X', serviceEndpoint: 'y' }];
      const thrown = expectInvalid(() => GenesisDocument.fromJSON({ ...genesisDocument(), service }), `service id ${JSON.stringify(id)}`);
      expect(thrown.message, `service id ${JSON.stringify(id)}`).to.equal('Invalid GenesisDocument service');
    }
  });

  it('refuses a DID document and a Genesis Document without "@context"', () => {
    const document = validDocument();
    delete document['@context'];
    const thrown = expectInvalid(() => new DidDocument(document as DidDocumentLike), 'new DidDocument');
    expect(thrown.message).to.equal('Invalid "@context"');
    const genesis = genesisDocument();
    delete genesis['@context'];
    const genesisThrown = expectInvalid(() => GenesisDocument.fromJSON(genesis), 'GenesisDocument.fromJSON');
    expect(genesisThrown.message).to.equal('Invalid GenesisDocument "@context"');
  });

  it('refuses a DID document and a Genesis Document whose "@context" has only one of the two contexts', () => {
    for(const context of BTCR2_DID_DOCUMENT_CONTEXT) {
      const constructed = expectInvalid(() => new DidDocument({ ...validDocument(), '@context': [context] } as DidDocumentLike), `new DidDocument with ${context}`);
      expect(constructed.message, `new DidDocument with ${context}`).to.equal('Invalid "@context"');
      const thrown = expectInvalid(() => GenesisDocument.fromJSON({ ...genesisDocument(), '@context': [context] }), `GenesisDocument.fromJSON with ${context}`);
      expect(thrown.message).to.equal('Invalid GenesisDocument "@context"');
    }
  });

  it('checks "@context" before verificationMethod and service, and verificationMethod before service, in a Genesis Document', () => {
    const noContext = without(genesisDocument(), ['@context']);
    const cases: Array<[string, Record<string, any>, string]> = [
      ['no "@context" and service null', { ...noContext, service: null }, 'Invalid GenesisDocument "@context"'],
      ['no "@context" and verificationMethod null', { ...noContext, verificationMethod: null }, 'Invalid GenesisDocument "@context"'],
      ['verificationMethod null and service null', { ...genesisDocument(), verificationMethod: null, service: null }, 'Invalid GenesisDocument verificationMethod'],
    ];
    for(const [label, genesis, message] of cases) {
      const thrown = expectInvalid(() => GenesisDocument.fromJSON(genesis), label);
      expect(thrown.message, label).to.equal(message);
    }
  });

  it('accepts a genesis method whose controller is another DID', () => {
    const genesis = genesisDocument();
    genesis.verificationMethod[0].controller = 'did:example:org';
    const document = GenesisDocument.fromJSON(genesis);
    expect(document.verificationMethod![0]!.controller).to.equal('did:example:org');
    expect(document.toJSON()).to.deep.equal(genesis);
  });

  it('refuses a genesis method with no controller or with a controller that is not a string', () => {
    for(const controller of [undefined, 42]) {
      const genesis = genesisDocument();
      if(controller === undefined) {
        delete genesis.verificationMethod[0].controller;
      } else {
        genesis.verificationMethod[0].controller = controller;
      }
      const thrown = expectInvalid(() => GenesisDocument.fromJSON(genesis), `controller ${String(controller)}`);
      expect(thrown.message).to.equal('Invalid GenesisDocument verificationMethod');
    }
  });

  it('writes the two contexts in fromKeyIdentifier, GenesisDocument.create, GenesisDocument.fromPublicKey, and DidDocumentBuilder.build', () => {
    const fixture = deterministicData[0]!;
    const deterministic = Resolver.deterministic(Identifier.decode(fixture.did));
    const method = deterministic.verificationMethod![0]!;
    const genesis = genesisDocument();
    const documents = {
      fromKeyIdentifier : DidDocument.fromKeyIdentifier(fixture.did, method.publicKeyMultibase!, deterministic.service!),
      create            : GenesisDocument.create(genesis.verificationMethod, { authentication: genesis.authentication }, genesis.service),
      fromPublicKey     : GenesisDocument.fromPublicKey(Identifier.decode(fixture.did).genesisBytes, 'bitcoin'),
      build             : new DidDocumentBuilder({ id: fixture.did }).withService(deterministic.service!).build(),
    };
    for(const [name, document] of Object.entries(documents)) {
      expect(document['@context'], name).to.deep.equal(BTCR2_DID_DOCUMENT_CONTEXT);
      // Each document holds a copy. A change to its "@context" must not change the constant.
      expect(document['@context'], name).to.not.equal(BTCR2_DID_DOCUMENT_CONTEXT);
      expect(document.toJSON()['@context'], name).to.deep.equal(BTCR2_DID_DOCUMENT_CONTEXT);
    }
  });

  it('DidDocumentBuilder keeps a given "@context" and adds no verificationMethod if the initial document has none', () => {
    const did = deterministicData[0]!.did;
    const context = [...BTCR2_DID_DOCUMENT_CONTEXT, 'https://w3id.org/security/data-integrity/v2'];
    const document = new DidDocumentBuilder({ id: did, '@context': context }).build();
    expect(document['@context']).to.deep.equal(context);
    expect(document).to.not.have.own.property('verificationMethod');
    expect(document.toJSON()).to.deep.equal({ id: did, '@context': context });
  });

  it('DidDocumentBuilder keeps the verificationMethod of the initial document', () => {
    const did = deterministicData[0]!.did;
    const deterministic = Resolver.deterministic(Identifier.decode(did));
    const method = deterministic.verificationMethod![0]!;
    const document = new DidDocumentBuilder({ id: did, verificationMethod: [method] })
      .withCapabilityInvocation([method.id])
      .withService(deterministic.service!)
      .build();
    expect(document.toJSON()).to.deep.equal({
      id                   : did,
      '@context'           : [...BTCR2_DID_DOCUMENT_CONTEXT],
      verificationMethod   : [method],
      capabilityInvocation : [method.id],
      service              : deterministic.service,
    });
  });

  it('fromExternalIdentifier refuses data without "@context"', () => {
    const data = validDocument();
    delete data['@context'];
    const thrown = expectInvalid(() => DidDocument.fromExternalIdentifier(data as ExternalData), 'fromExternalIdentifier');
    expect(thrown.message).to.equal('Invalid "@context"');
  });

  it('writes id and "@context" first in toJSON for a document with every member (ADR 144)', () => {
    const input = { ...validDocument(), deactivated: false, extension: { note: 'kept' } };
    // The input holds the members in the reverse order.
    const reversed = Object.fromEntries(Object.entries(input).reverse());
    const keys = Object.keys(new DidDocument(reversed as DidDocumentLike).toJSON());
    expect(keys).to.deep.equal([
      'id', '@context', 'verificationMethod', ...RELATIONSHIPS, 'service', 'deactivated', 'extension'
    ]);
  });
});
