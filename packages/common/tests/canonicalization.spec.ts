import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  canonicalize,
  canonicalHash,
  CanonicalizationError,
  decode,
  encode,
  hash,
} from '../src/index.js';

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

  it('throws on unsupported algorithm', () => {
    expect(() => canonicalize({}, 'rdfc' as any))
      .to.throw(CanonicalizationError, 'Unsupported algorithm');
  });

  it('throws on unsupported encoding', () => {
    expect(() => encode(new Uint8Array(32), 'base64' as any))
      .to.throw(CanonicalizationError, 'Unsupported encoding');
  });

  it('canonicalizes with JCS by default (base64urlnopad encoding)', () => {
    const result = canonicalHash(simpleObject);
    const again = canonicalHash(simpleObject);
    expect(result).to.equal(again);
    expect(result).to.equal('QyWM_3g_5wNtikMDP4MK38YOwDc4JHNUisdCuIgpJ3c');
  });

  it('supports base58 encoding', () => {
    const base58 = canonicalHash(simpleObject, { encoding: 'base58' });
    expect(base58).to.equal('5X7XVwWA1NrC4JcuT7teDrhYpVQNA9LhHR3s2Ci6XUWz');
  });

  it('supports base64urlnopad encoding', () => {
    const base64url = canonicalHash(simpleObject, { encoding: 'base64urlnopad' });
    expect(base64url).to.equal('QyWM_3g_5wNtikMDP4MK38YOwDc4JHNUisdCuIgpJ3c');
  });

  it('throws on unsupported algorithms', () => {
    expect(() => canonicalHash(simpleObject, { algorithm: 'rdfc' as any }))
      .to.throw(CanonicalizationError, 'Unsupported algorithm');
  });

  it('validates algorithm and encoding through public API', () => {
    expect(() => canonicalize({}, 'jcs')).to.not.throw();
    expect(() => encode(new Uint8Array(32), 'hex')).to.not.throw();
    expect(() => canonicalize({}, 'bad' as any)).to.throw(CanonicalizationError);
    expect(() => encode(new Uint8Array(32), 'bad' as any)).to.throw(CanonicalizationError);
  });

  it('produces a canonical hash for a complex object', () => {
    const result = hash(canonicalize(complexObject));
    expect(result).to.deep.equal(hashComplexObject);
  });

  it('produces a hex-encoded SHA-256 hash of a canonicalized object', () => {
    const result = encode(hash(canonicalComplexObject), 'hex');
    expect(result).to.equal('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938');
  });

  it('produces a base58 encoded SHA-256 hash of a canonicalized object', () => {
    const result = encode(hash(canonicalComplexObject), 'base58');
    expect(result).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
  });

  it('produces a base64urlnopad encoded SHA-256 hash of a canonicalized object', () => {
    const result = encode(hash(canonicalComplexObject), 'base64urlnopad');
    expect(result).to.equal('al4wDwZaZUH5zT3uwkukyu1tWio7IZ8W6TV0Wf-gGTg');
  });

  it('encodes and decodes hash bytes round-trip', () => {
    const hexEncoded = encode(hashComplexObject, 'hex');
    expect(hexEncoded).to.equal('6a5e300f065a6541f9cd3deec24ba4caed6d5a2a3b219f16e9357459ffa01938');
    expect(decode(hexEncoded, 'hex')).to.deep.equal(hashComplexObject);

    const b58Encoded = encode(hashComplexObject, 'base58');
    expect(b58Encoded).to.equal('8ADWw43bTgn9z3n7NjuzrM1GfJa1aNCaaK4RJpwe3sCK');
    expect(decode(b58Encoded, 'base58')).to.deep.equal(hashComplexObject);

    const b64urlEncoded = encode(hashComplexObject, 'base64urlnopad');
    expect(b64urlEncoded).to.equal('al4wDwZaZUH5zT3uwkukyu1tWio7IZ8W6TV0Wf-gGTg');
    expect(decode(b64urlEncoded, 'base64urlnopad')).to.deep.equal(hashComplexObject);
  });
});
