import { expect } from 'chai';
import { canonicalHashBytes, IdentifierTypes, JSONPatch } from '@did-btcr2/common';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import { DidDocument } from '../src/utils/did-document.js';
import deterministicData from './data/deterministic-data.js';
import externalData from './data/external-data.js';

/**
 * Regression tests: the resolver must operate on full plain-JSON
 * documents. A class wrapper drops any field outside its known property set
 * (both at construction and via its toJSON subset used by the patch deep-clone),
 * which diverged the patched-document hashes from any plain-JSON implementation.
 */
describe('resolver plain-document handling', () => {
  const fixture = externalData[0]!;

  /** A valid EXTERNAL genesis document carrying a field outside the class's known set. */
  function genesisWithExtraField(): Record<string, unknown> {
    return {
      ...JSON.parse(JSON.stringify(fixture.genesisDocument)),
      alsoKnownAs : ['did:web:example.com'],
    };
  }

  function didFor(genesis: Record<string, unknown>): string {
    return DidBtcr2.create(canonicalHashBytes(genesis), { idType: IdentifierTypes.EXTERNAL, network: 'bitcoin' });
  }

  it('external() returns a plain object preserving fields outside the class property set', () => {
    const genesis = genesisWithExtraField();
    const doc = Resolver.external(Identifier.decode(didFor(genesis)), genesis);

    expect(doc).to.not.be.instanceOf(DidDocument);
    expect(doc.id).to.not.include('did:btcr2:_');
    expect((doc as unknown as Record<string, unknown>).alsoKnownAs).to.deep.equal(['did:web:example.com']);
    // Nested placeholders are replaced throughout, not just at the top level.
    expect(doc.verificationMethod[0]!.id).to.match(/^did:btcr2:x1.*#key-0$/);
  });

  it('patching the external() output is hash-symmetric with a plain-JSON implementation', () => {
    const genesis = genesisWithExtraField();
    const doc = Resolver.external(Identifier.decode(didFor(genesis)), genesis);

    // Independent plain-JSON baseline: replace placeholders, then patch.
    const baselineDoc = JSON.parse(JSON.stringify(genesis).replaceAll('did:btcr2:_', doc.id));
    const patch = [{ op: 'add' as const, path: '/alsoKnownAs/1', value: 'did:web:two.example' }];

    const patched = JSONPatch.apply(doc, patch);
    const baselinePatched = JSONPatch.apply(baselineDoc, patch);

    expect(patched).to.deep.equal(baselinePatched);
    expect(canonicalHashBytes(patched)).to.deep.equal(canonicalHashBytes(baselinePatched));
    // The extra field survived patching (the class-subset path would have dropped it).
    expect((patched as unknown as Record<string, unknown>).alsoKnownAs).to.have.length(2);
  });

  it('deterministic() returns a plain object with the defaulted relationship arrays', () => {
    const doc = Resolver.deterministic(Identifier.decode(deterministicData[0]!.did));

    expect(doc).to.not.be.instanceOf(DidDocument);
    const keyRef = `${doc.id}#initialKey`;
    for (const rel of ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'] as const) {
      expect(doc[rel], rel).to.deep.equal([keyRef]);
    }
  });

  it('patching the deterministic() output keeps every field (no toJSON-subset drop)', () => {
    const doc = Resolver.deterministic(Identifier.decode(deterministicData[0]!.did));
    const baselineDoc = JSON.parse(JSON.stringify(doc));
    const patch = [{ op: 'add' as const, path: '/alsoKnownAs', value: ['did:web:example.com'] }];

    const patched = JSONPatch.apply(doc, patch);
    const baselinePatched = JSONPatch.apply(baselineDoc, patch);

    expect(patched).to.deep.equal(baselinePatched);
    expect(canonicalHashBytes(patched)).to.deep.equal(canonicalHashBytes(baselinePatched));
  });
});
