import { expect } from 'chai';
import {
  BTCR2_DID_DOCUMENT_CONTEXT,
  DidDocument,
  DidVerificationMethod,
  isMultikeyVerificationMethod,
  MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX,
} from '../src/utils/did-document.js';
import externalData from './data/external-data.js';

/**
 * DID Document validation: extensible `@context` (STD-1) and uniform Multikey
 * enforcement (STD-2).
 *
 * `@context` validation accepts any document that carries the btcr2 base
 * contexts, allowing additional proof-suite or extension contexts per W3C DID
 * Core 4.1 rather than rejecting them with a strict whitelist. Verification-method
 * validation enforces the btcr2 Multikey + `zQ3s` invariant uniformly: at
 * `DidVerificationMethod` construction and across a document's `verificationMethod`
 * array, not only for the one method being signed with at update time.
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

describe('DidDocument @context validation (STD-1: extensibility)', () => {
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

describe('isMultikeyVerificationMethod (STD-2: shared Multikey invariant)', () => {
  const validVm = {
    id                 : 'did:btcr2:_#key-0',
    type               : 'Multikey',
    controller         : 'did:btcr2:_',
    publicKeyMultibase : 'zQ3shiAVyapkPizvsLJZ8mYqPZetmbNNjgLVWTe5CLKZjvs34',
  };

  it('accepts a Multikey method with a zQ3s public key', () => {
    expect(isMultikeyVerificationMethod(validVm)).to.equal(true);
  });

  it('rejects a method whose type is not Multikey', () => {
    expect(isMultikeyVerificationMethod({ ...validVm, type: 'JsonWebKey2020' })).to.equal(false);
  });

  it('rejects a method whose publicKeyMultibase is not a zQ3s key', () => {
    // z6Mk... is a valid multibase prefix for Ed25519, not Schnorr secp256k1.
    expect(isMultikeyVerificationMethod({ ...validVm, publicKeyMultibase: 'z6MkhaXgBZD' })).to.equal(false);
  });

  it('rejects a method with no publicKeyMultibase', () => {
    const { publicKeyMultibase: _omit, ...noKey } = validVm;
    expect(isMultikeyVerificationMethod(noKey)).to.equal(false);
  });

  it('rejects values missing the structural id/type/controller shape', () => {
    expect(isMultikeyVerificationMethod(null)).to.equal(false);
    expect(isMultikeyVerificationMethod('Multikey')).to.equal(false);
    expect(isMultikeyVerificationMethod({ type: 'Multikey' })).to.equal(false);
  });

  it('uses the exported prefix constant as the source of truth', () => {
    expect(validVm.publicKeyMultibase.startsWith(MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX)).to.equal(true);
  });
});

describe('DidVerificationMethod construction (STD-2: enforce at construction)', () => {
  const base = {
    id                 : 'did:btcr2:_#key-0',
    type               : 'Multikey',
    controller         : 'did:btcr2:_',
    publicKeyMultibase : 'zQ3shiAVyapkPizvsLJZ8mYqPZetmbNNjgLVWTe5CLKZjvs34',
  };

  it('constructs a well-formed Multikey verification method', () => {
    const vm = new DidVerificationMethod(base);
    expect(vm.type).to.equal('Multikey');
    expect(vm.publicKeyMultibase).to.equal(base.publicKeyMultibase);
  });

  it('throws when the type is not Multikey', () => {
    expect(() => new DidVerificationMethod({ ...base, type: 'JsonWebKey2020' }))
      .to.throw('type must be "Multikey"');
  });

  it('throws when the publicKeyMultibase is not a zQ3s key', () => {
    expect(() => new DidVerificationMethod({ ...base, publicKeyMultibase: 'z6MkhaXgBZD' }))
      .to.throw('publicKeyMultibase must start with "zQ3s"');
  });
});

describe('DidDocument.isValid verificationMethod array (STD-2: enforce at the document boundary)', () => {
  it('rejects a document whose verification method is not a Multikey', () => {
    const doc = validDocument();
    const vms = doc.verificationMethod as Array<Record<string, unknown>>;
    vms[0]!.type = 'JsonWebKey2020';
    expect(() => DidDocument.isValid(doc)).to.throw('Invalid "verificationMethod"');
  });

  it('rejects a document whose verification method key is not a zQ3s key', () => {
    const doc = validDocument();
    const vms = doc.verificationMethod as Array<Record<string, unknown>>;
    vms[0]!.publicKeyMultibase = 'z6MkhaXgBZD';
    expect(() => DidDocument.isValid(doc)).to.throw('Invalid "verificationMethod"');
  });
});
