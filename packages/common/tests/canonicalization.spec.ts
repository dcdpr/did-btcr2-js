import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Canonicalization, CanonicalizationError } from '../src/index.js';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('canonicalization', () => {
  const canonicalization = new Canonicalization();
  const simpleObject = { b: 2, a: 1 };
  const complexObject = {
    z : [3, 2, 1],
    a : {
      d : 'string',
      c : 42,
      b : [true, false],
    },
    m : null,
  };
  const canonicalComplexObject = '{"a":{"b":[true,false],"c":42,"d":"string"},"m":null,"z":[3,2,1]}';
  const hashComplexObject = Uint8Array.from(
    Buffer.from('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938', 'hex')
  );

  it('should default to jcs algorithm', () => {
    expect(canonicalization.algorithm).to.equal('jcs');
  });

  it('throws on unsupported algorithm to canonicalize', async () => {
    // Save original normalizeAlgorithm
    const originalNormalizeAlgorithm = Canonicalization.normalizeAlgorithm;

    // Override to return unsupported algorithm
    (Canonicalization as any).normalizeAlgorithm = () => { return 'rdfc'; };

    // Test canonicalize method
    await expect(canonicalization.canonicalize(simpleObject, 'unsupported' as any))
      .to.be.rejectedWith(CanonicalizationError, 'Unsupported algorithm');

    // Restore original method
    (Canonicalization as any).normalizeAlgorithm = originalNormalizeAlgorithm;
  });

  it('throws on unsupported encoding to encode', () => {
    // Save original normalizeEncoding
    const originalNormalizeEncoding = Canonicalization.normalizeEncoding;

    // Override to return unsupported encoding
    (Canonicalization as any).normalizeEncoding = () => { return 'base64'; };

    // Test encode method
    expect(() => canonicalization.encode(new Uint8Array(32), 'unsupported' as any))
      .to.throw(CanonicalizationError, 'Unsupported encoding');

    // Restore original method
    (Canonicalization as any).normalizeEncoding = originalNormalizeEncoding;
  });

  it('canonicalizes with JCS by default', async () => {
    const result = await canonicalization.process(simpleObject);
    const again = await canonicalization.process(simpleObject);
    expect(result).to.equal(again);
    expect(result).to.match(/^[0-9a-f]+$/);
  });

  it('supports base58 and multibase encoding', async () => {
    const base58 = await canonicalization.process(simpleObject, { encoding: 'base58' });
    const multibase = await canonicalization.process(simpleObject, { encoding: 'base58', multibase: true });
    expect(base58.startsWith('z')).to.be.false;
    expect(multibase.startsWith('z')).to.be.true;
    expect(multibase.slice(1)).to.equal(base58);
  });

  it('throws on unsupported algorithms', async () => {
    await expect(canonicalization.process(simpleObject, { algorithm: 'rdfc' as any }))
      .to.be.rejectedWith(CanonicalizationError, 'Unsupported algorithm');
  });

  it('exposes static normalization helpers', () => {
    expect(() => Canonicalization.normalizeAlgorithm('jcs')).to.not.throw();
    expect(() => Canonicalization.normalizeEncoding('hex')).to.not.throw();
    expect(() => Canonicalization.normalizeAlgorithm('bad' as any)).to.throw(CanonicalizationError);
    expect(() => Canonicalization.normalizeEncoding('bad' as any)).to.throw(CanonicalizationError);
  });

  it('produces a canonical hash for a complex object', async () => {
    const result = await canonicalization.canonicalhash(complexObject);
    expect(result).to.deep.equal(hashComplexObject);
  });

  it('produces a hex-encoded SHA-256 hash of a canonicalized object', async () => {
    const result = canonicalization.hashhex(canonicalComplexObject);
    expect(result).to.equal('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938');
  });

  it('produces a base58 encoded SHA-256 hash of a canonicalized object', async () => {
    const result = canonicalization.hashbase58(canonicalComplexObject);
    expect(result).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
  });
});
