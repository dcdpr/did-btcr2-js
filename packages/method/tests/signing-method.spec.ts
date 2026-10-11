import { VERIFICATION_METHOD_ERROR } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { base58, hex } from '@scure/base';
import { expect } from 'chai';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import type { DidVerificationMethod } from '../src/utils/did-document.js';
import { signingMethodProblem } from '../src/utils/signing-method.js';

/**
 * The conditions on the method that signs a BTCR2 Update: the type Multikey, the DID as the
 * controller, and a secp256k1 public key in the BIP340 Multikey encoding. The value of
 * publicKeyMultibase must also be the base58btc text of the key.
 */

describe('signingMethodProblem', () => {
  // The function returns the first condition that fails, in this order.
  const KEY_MESSAGE = 'publicKeyMultibase must encode a secp256k1 public key as a BIP340 Multikey';

  /** The cause of a value that decodes to the key but is not the base58btc text of the key. */
  const NOT_CANONICAL = {
    type    : VERIFICATION_METHOD_ERROR,
    message : 'Invalid publicKeyMultibase: not the base58btc encoding of the key'
  };

  /** The DID and the KEY template method of a regtest k1 DID whose compressed key starts with `prefix`. */
  function keyTemplate(prefix: 0x02 | 0x03): { did: string; method: DidVerificationMethod; publicKey: Uint8Array } {
    // The key of secret 1 starts with 0x02, the key of secret 6 starts with 0x03.
    const secret = new Uint8Array(32);
    secret[31] = prefix === 0x02 ? 1 : 6;
    const publicKey = secp256k1.getPublicKey(secret, true);
    expect(publicKey[0]).to.equal(prefix);
    const did = Identifier.encode(publicKey, { idType: 'KEY', version: 1, network: 'regtest' });
    return { did, method: Resolver.deterministic(Identifier.decode(did)).verificationMethod[0]!, publicKey };
  }

  /** The base58btc multibase (`z` header) of `bytes`. */
  function z(bytes: Uint8Array): string {
    return `z${base58.encode(bytes)}`;
  }

  /**
   * Other text for the key of `canonical`, which the base58btc decoder of the cryptosuite
   * reads as the same 35 bytes. The decoder ignores a code unit above 0xff between the `z`
   * header and the first base58 digit: here U+0100, and the two code units of U+1F600.
   */
  function otherText(canonical: string): string[] {
    return [ `z\u0100${canonical.slice(1)}`, `z\u{1F600}${canonical.slice(1)}` ];
  }

  /** Expect the publicKeyMultibase problem with `cause`, the type and the message of the decode error. */
  function expectKeyProblem(problem: ReturnType<typeof signingMethodProblem>, cause: { type: string; message: string }): void {
    expect(problem).to.deep.equal({ field: 'publicKeyMultibase', message: KEY_MESSAGE, cause });
  }

  /** The decode error of a key that is not a valid compressed point. */
  const NOT_A_POINT = { type: 'CONSTRUCTOR_ERROR', message: 'Invalid argument: not a valid secp256k1 compressed point' };

  it('accepts the KEY template method of a key that starts with 0x02 and of a key that starts with 0x03', () => {
    for(const prefix of [ 0x02, 0x03 ] as const) {
      const { did, method } = keyTemplate(prefix);
      expect(signingMethodProblem(method, did), `prefix 0x0${prefix}`).to.equal(undefined);
    }
  });

  it('names the type for a method of the type JsonWebKey2020', () => {
    const { did, method } = keyTemplate(0x02);
    expect(signingMethodProblem({ ...method, type: 'JsonWebKey2020' }, did))
      .to.deep.equal({ field: 'type', message: 'type must equal "Multikey"' });
  });

  it('names the controller for another DID, for a DID URL of the DID, and for an absent controller', () => {
    const { did, method } = keyTemplate(0x02);
    const other = keyTemplate(0x03).did;
    const expected = { field: 'controller', message: `controller must equal "${did}"` };
    // The controller must equal the DID. A DID URL of the DID, absolute or relative, is not the DID.
    for(const controller of [ other, `${did}#initialKey`, '#initialKey' ]) {
      expect(signingMethodProblem({ ...method, controller }, did), controller).to.deep.equal(expected);
    }
    const { controller: _omit, ...noController } = method;
    expect(signingMethodProblem(noController, did)).to.deep.equal(expected);
  });

  it('names the key with the decode error as the cause for the zQ3s prefix alone', () => {
    const { did, method } = keyTemplate(0x02);
    // The prefix alone decodes to 3 bytes.
    expect(base58.decode('Q3s')).to.have.length(3);
    expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase: 'zQ3s' }, did), {
      type    : VERIFICATION_METHOD_ERROR,
      message : 'Invalid publicKeyMultibase length: 3'
    });
  });

  it('names the key with the decode error as the cause for 35 bytes with the 0xe701 prefix and no valid point', () => {
    const { did, method } = keyTemplate(0x02);
    // The x coordinate 5 is not on the curve, so 0x02 and x is not a compressed point.
    const notAPoint = new Uint8Array(33);
    notAPoint[0] = 0x02;
    notAPoint[32] = 5;
    const publicKeyMultibase = z(new Uint8Array([ 0xe7, 0x01, ...notAPoint ]));
    expect(publicKeyMultibase.startsWith('zQ3sh')).to.equal(true);
    expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase }, did), NOT_A_POINT);
  });

  it('names the key with the decode error as the cause for a valid x coordinate with the parity byte 0x04', () => {
    const { did, method, publicKey } = keyTemplate(0x02);
    // The x coordinate of the template key is on the curve. A compressed point starts with
    // 0x02 or 0x03, so the byte 0x04 makes the 33 bytes not a compressed point.
    const publicKeyMultibase = z(new Uint8Array([ 0xe7, 0x01, 0x04, ...publicKey.slice(1) ]));
    expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase }, did), NOT_A_POINT);
  });

  it('names the key with the decode error as the cause for 35 bytes with the P-256 prefix 0x8024 and a valid secp256k1 key', () => {
    const { did, method, publicKey } = keyTemplate(0x02);
    // The 33 bytes of the template key with the multicodec prefix of a P-256 key: the zDn form.
    // The length and the point are valid, so only the prefix check refuses the key.
    const publicKeyMultibase = z(new Uint8Array([ 0x80, 0x24, ...publicKey ]));
    expect(publicKeyMultibase.startsWith('zDn')).to.equal(true);
    expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase }, did), {
      type    : VERIFICATION_METHOD_ERROR,
      message : 'Invalid publicKeyMultibase prefix: expected secp256k1 multicodec [0xe7, 0x01], got [0x80, 0x24]'
    });
  });

  it('names the key with the decode error as the cause for an Ed25519 Multikey', () => {
    const { did, method } = keyTemplate(0x02);
    // The multicodec prefix 0xed01 and a 32-byte key: the z6Mk form of an Ed25519 key.
    const publicKeyMultibase = z(new Uint8Array([ 0xed, 0x01, ...new Uint8Array(32).fill(7) ]));
    expect(publicKeyMultibase.startsWith('z6Mk')).to.equal(true);
    expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase }, did), {
      type    : VERIFICATION_METHOD_ERROR,
      message : 'Invalid publicKeyMultibase length: 34'
    });
  });

  it('names the key with the decode error as the cause for a valid key in the base16 multibase', () => {
    const { did, method, publicKey } = keyTemplate(0x02);
    // The same 35 bytes as the template key, with the base16 header f in place of z.
    const publicKeyMultibase = `f${hex.encode(new Uint8Array([ 0xe7, 0x01, ...publicKey ]))}`;
    expect(method.publicKeyMultibase).to.equal(z(new Uint8Array([ 0xe7, 0x01, ...publicKey ])));
    const problem = signingMethodProblem({ ...method, publicKeyMultibase }, did);
    expect(problem).to.deep.include({ field: 'publicKeyMultibase', message: KEY_MESSAGE });
    expect(problem!.cause!.type).to.equal('Error');
    expect(problem!.cause!.message).to.match(/prefixed with z/);
  });

  it('names the key with the canonical-text cause for other text that the decoder reads as the same key', () => {
    for(const prefix of [ 0x02, 0x03 ] as const) {
      const { did, method } = keyTemplate(prefix);
      for(const publicKeyMultibase of otherText(method.publicKeyMultibase!)) {
        // The decoder reads the text as the template key, so only the text comparison refuses it.
        const decoded = SchnorrMultikey.fromVerificationMethod({ ...method, publicKeyMultibase });
        expect(decoded.publicKey.multibase.encoded, publicKeyMultibase).to.equal(method.publicKeyMultibase);
        expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase }, did), NOT_CANONICAL);
      }
    }
  });

  it('accepts the base58btc text of the key that the other text encodes', () => {
    const { did, method, publicKey } = keyTemplate(0x02);
    const canonical = z(new Uint8Array([ 0xe7, 0x01, ...publicKey ]));
    expect(otherText(canonical)).to.not.include(canonical);
    expect(signingMethodProblem({ ...method, publicKeyMultibase: canonical }, did)).to.equal(undefined);
  });

  it('compares the whole text with the base58btc text of the key, not only the prefix', () => {
    // The decoder accepts other text only before the first base58 digit, so no such text
    // keeps the zQ3s prefix. This test replaces the decoder with one that also reads a
    // changed last character as the template key.
    const { did, method } = keyTemplate(0x02);
    const canonical = method.publicKeyMultibase!;
    const changed = `${canonical.slice(0, -1)}${canonical.endsWith('2') ? '3' : '2'}`;
    const original = SchnorrMultikey.fromVerificationMethod;
    SchnorrMultikey.fromVerificationMethod = (vm) => original.call(SchnorrMultikey, {
      ...vm,
      publicKeyMultibase : vm.publicKeyMultibase === changed ? canonical : vm.publicKeyMultibase
    });
    try {
      expect(SchnorrMultikey.fromVerificationMethod({ ...method, publicKeyMultibase: changed }).publicKey.multibase.encoded).to.equal(canonical);
      expectKeyProblem(signingMethodProblem({ ...method, publicKeyMultibase: changed }, did), NOT_CANONICAL);
      expect(signingMethodProblem(method, did)).to.equal(undefined);
    } finally {
      SchnorrMultikey.fromVerificationMethod = original;
    }
  });

  it('names the key without a cause for a key that is not a string and for an absent key', () => {
    const { did, method } = keyTemplate(0x02);
    const expected = { field: 'publicKeyMultibase', message: KEY_MESSAGE };
    expect(signingMethodProblem({ ...method, publicKeyMultibase: 42 }, did)).to.deep.equal(expected);
    const { publicKeyMultibase: _omit, ...noKey } = method;
    expect(signingMethodProblem(noKey, did)).to.deep.equal(expected);
  });

  it('names the type for a value that is not an object', () => {
    const { did } = keyTemplate(0x02);
    for(const value of [ undefined, null, 'Multikey' ]) {
      expect(signingMethodProblem(value, did), String(value))
        .to.deep.equal({ field: 'type', message: 'type must equal "Multikey"' });
    }
  });

  it('names the first condition that fails: the type, then the controller, then the key', () => {
    const { did, method } = keyTemplate(0x02);
    const other = keyTemplate(0x03).did;
    const allFail = { ...method, type: 'JsonWebKey2020', controller: other, publicKeyMultibase: 'zQ3s' };
    expect(signingMethodProblem(allFail, did))
      .to.deep.equal({ field: 'type', message: 'type must equal "Multikey"' });
    expect(signingMethodProblem({ ...allFail, type: 'Multikey' }, did))
      .to.deep.equal({ field: 'controller', message: `controller must equal "${did}"` });
    expectKeyProblem(signingMethodProblem({ ...allFail, type: 'Multikey', controller: did }, did), {
      type    : VERIFICATION_METHOD_ERROR,
      message : 'Invalid publicKeyMultibase length: 3'
    });
  });
});
