import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Canonicalization, CanonicalizationError } from '../src/index.js';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('canonicalization', () => {
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

  it('throws on unsupported algorithm to canonicalize', () => {
    const originalNormalizeAlgorithm = Canonicalization.normalizeAlgorithm;
    (Canonicalization as any).normalizeAlgorithm = () => { return 'rdfc'; };
    expect(() => Canonicalization.canonicalize(simpleObject, 'unsupported' as any))
      .to.throw(CanonicalizationError, 'Unsupported algorithm');
    (Canonicalization as any).normalizeAlgorithm = originalNormalizeAlgorithm;
  });

  it('throws on unsupported encoding to encode', () => {
    const originalNormalizeEncoding = Canonicalization.normalizeEncoding;
    (Canonicalization as any).normalizeEncoding = () => { return 'base64'; };
    expect(() => Canonicalization.encode(new Uint8Array(32), 'unsupported' as any))
      .to.throw(CanonicalizationError, 'Unsupported encoding');
    (Canonicalization as any).normalizeEncoding = originalNormalizeEncoding;
  });

  it('canonicalizes with JCS by default', () => {
    const result = Canonicalization.process(simpleObject);
    const again = Canonicalization.process(simpleObject);
    expect(result).to.equal(again);
    expect(result).to.match(/^[0-9a-f]+$/);
  });

  it('supports base58 and multibase encoding', () => {
    const base58 = Canonicalization.process(simpleObject, { encoding: 'base58' });
    expect(base58.startsWith('z')).to.be.false;
  });

  it('throws on unsupported algorithms', () => {
    expect(() => Canonicalization.process(simpleObject, { algorithm: 'rdfc' as any }))
      .to.throw(CanonicalizationError, 'Unsupported algorithm');
  });

  it('exposes static normalization helpers', () => {
    expect(() => Canonicalization.normalizeAlgorithm('jcs')).to.not.throw();
    expect(() => Canonicalization.normalizeEncoding('hex')).to.not.throw();
    expect(() => Canonicalization.normalizeAlgorithm('bad' as any)).to.throw(CanonicalizationError);
    expect(() => Canonicalization.normalizeEncoding('bad' as any)).to.throw(CanonicalizationError);
  });

  it('produces a canonical hash for a complex object', () => {
    const result = Canonicalization.andHash(complexObject);
    expect(result).to.deep.equal(hashComplexObject);
  });

  it('produces a hex-encoded SHA-256 hash of a canonicalized object', () => {
    const result = Canonicalization.andHashToHex(canonicalComplexObject);
    expect(result).to.equal('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938');
  });

  it('produces a base58 encoded SHA-256 hash of a canonicalized object', () => {
    const result = Canonicalization.andHashToBase58(canonicalComplexObject);
    expect(result).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
  });

  it('produces a valid base58 encoding of SHA-256 hash bytes', () => {
    const result = Canonicalization.toBase58(hashComplexObject);
    expect(result).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
  });

});
