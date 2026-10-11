import { canonicalHash, DidDocumentError, INVALID_DID_DOCUMENT } from '@did-btcr2/common';
import { p256 } from '@noble/curves/nist.js';
import { base58, base64urlnopad } from '@scure/base';
import { expect } from 'chai';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import type { Btcr2VerificationMethod, DidDocumentLike } from '../src/utils/did-document.js';
import {
  BTCR2_DID_DOCUMENT_CONTEXT,
  DidDocument,
  DidVerificationMethod,
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
    return { ...Resolver.deterministic(Identifier.decode(did)).verificationMethod[0]! };
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
      did, deterministic.verificationMethod[0]!.publicKeyMultibase!, deterministic.service
    );
    const keyRef = `${did}#initialKey`;
    expect(document.id).to.equal(did);
    expect(document.verificationMethod[0]!.id).to.equal(keyRef);
    for(const relationship of ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'] as const) {
      expect(document[relationship]).to.deep.equal([keyRef]);
    }
    expect(document.toJSON()).to.deep.equal(deterministic.toJSON());
  });
});
