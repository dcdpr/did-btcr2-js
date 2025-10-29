import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2.js';
import { expect } from 'chai';
import { Signer } from '../src/signer.js';

describe('Signer', () => {
  it('constructs with keyPair and network, exposes publicKey', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new Signer({ keyPair: kp, network: 'bitcoin' });
    expect(signer.network).to.equal('bitcoin');
    expect(signer.publicKey).to.deep.equal(kp.publicKey.compressed);
  });

  it('sign (Schnorr): signs a 32-byte hash that verifies with the same key', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new Signer({ keyPair: kp, network: 'testnet3' });

    const msg = new Uint8Array([1, 2, 3, 4]);
    const hash = sha256(msg);
    const sig = signer.sign(hash);

    expect(sig).to.be.instanceOf(Uint8Array);
    const ok = kp.publicKey.verify(sig, hash);
    expect(ok).to.equal(true);
  });

  it('signEcdsa: returns a signature for a 32-byte hash (basic shape check)', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new Signer({ keyPair: kp, network: 'signet' });

    const hash = sha256(new Uint8Array([9, 8, 7]));
    const sig = signer.signEcdsa(hash);

    expect(sig).to.be.instanceOf(Uint8Array);
    expect(sig.length).to.be.greaterThan(0);
  });
});
