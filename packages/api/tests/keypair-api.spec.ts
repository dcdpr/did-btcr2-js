import { expect } from 'chai';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { KeyPairApi } from '../src/index.js';

/**
 * KeyPairApi Test
 */
describe('KeyPairApi', () => {
  const kpApi = new KeyPairApi();

  it('generate() returns a SchnorrKeyPair', () => {
    const kp = kpApi.generate();
    expect(kp).to.be.instanceOf(SchnorrKeyPair);
  });

  it('fromSecret() creates keypair from secret bytes', () => {
    const kp = kpApi.generate();
    const restored = kpApi.fromSecret(kp.secretKey!.bytes);
    expect(restored).to.be.instanceOf(SchnorrKeyPair);
    expect(kpApi.equals(kp, restored)).to.equal(true);
  });

  it('fromSecret() creates keypair from hex string', () => {
    const kp = kpApi.generate();
    const hex = kp.secretKey!.hex;
    const restored = kpApi.fromSecret(hex);
    expect(kpApi.equals(kp, restored)).to.equal(true);
  });

  it('secretKeyFrom() creates a Secp256k1SecretKey from bytes', () => {
    const kp = kpApi.generate();
    const sk = kpApi.secretKeyFrom(kp.secretKey!.bytes);
    expect(sk).to.exist;
    expect(sk.bytes).to.be.instanceOf(Uint8Array);
  });

  it('publicKeyFrom() creates a CompressedSecp256k1PublicKey', () => {
    const kp = kpApi.generate();
    const pk = kpApi.publicKeyFrom(kp.publicKey.compressed);
    expect(pk).to.exist;
    expect(pk.compressed).to.be.instanceOf(Uint8Array);
  });

  it('fromJSON() / toJSON() round-trips', () => {
    const kp = kpApi.generate();
    const json = kpApi.toJSON(kp);
    expect(json).to.have.property('secretKey');
    expect(json).to.have.property('publicKey');
    const restored = kpApi.fromJSON(json);
    expect(kpApi.equals(kp, restored)).to.equal(true);
  });

  it('equals() returns false for different keypairs', () => {
    const kp1 = kpApi.generate();
    const kp2 = kpApi.generate();
    expect(kpApi.equals(kp1, kp2)).to.equal(false);
  });
});
