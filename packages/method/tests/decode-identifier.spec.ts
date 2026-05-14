import { bytesToHex } from '@noble/hashes/utils';
import { bech32m, hex } from '@scure/base';
import { expect } from 'chai';
import { Identifier } from '../src/index.js';
import data from './data/decode-data.js';

const validKeyBytes = hex.decode('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000');
const validHashBytes = hex.decode('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1');

// Forge a did:btcr2 identifier by hand. Useful for negative tests where we need
// to drive specific byte/nibble values that the encoder would never produce.
function forge(hrp: 'k' | 'x', firstByte: number, tail: Uint8Array): string {
  const dataBytes = new Uint8Array([firstByte, ...tail]);
  return `did:btcr2:${bech32m.encodeFromBytes(hrp, dataBytes)}`;
}

describe('Decode Identifier', () => {
  describe('happy path', () => {
    it('decodes each fixture into its expected components', () => {
      for(const { did, components } of data) {
        const decoded = Identifier.decode(did);
        expect(decoded.hrp).to.equal(components.hrp);
        expect(decoded.idType).to.equal(components.idType);
        expect(decoded.version).to.equal(components.version);
        expect(decoded.network).to.equal(components.network);
        expect(bytesToHex(decoded.genesisBytes)).to.equal(components.genesisBytes);
      }
    });
  });

  describe('format validation', () => {
    it('rejects strings without "did:" prefix', () => {
      expect(() => Identifier.decode('btcr2:k1qqpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqvgmw6r'))
        .to.throw();
    });

    it('rejects unknown DID methods', () => {
      expect(() => Identifier.decode('did:foo:k1qqpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqvgmw6r'))
        .to.throw(/method/i);
    });

    it('rejects identifiers with fewer than 3 colon-separated components', () => {
      expect(() => Identifier.decode('did:btcr2')).to.throw();
    });

    it('rejects identifiers with empty method-specific-id', () => {
      expect(() => Identifier.decode('did:btcr2:')).to.throw();
    });

    it('rejects malformed bech32m payloads', () => {
      expect(() => Identifier.decode('did:btcr2:k1notavalidbech32m')).to.throw();
    });
  });

  describe('hrp validation', () => {
    it('rejects unknown hrp', () => {
      // 'z' is not a valid hrp for did:btcr2
      const forged = `did:btcr2:${bech32m.encodeFromBytes('z', new Uint8Array([0x00, ...validKeyBytes]))}`;
      expect(() => Identifier.decode(forged)).to.throw(/hrp/i);
    });
  });

  describe('btcr2_version validation', () => {
    // The bug previously fixed: first nibble 0x1-0xE was silently accepted.
    // These tests are regression coverage for spec step "btcr2_version MUST be 0".

    it('rejects btcr2_version 1 (first nibble 0x1, network nibble 0x0)', () => {
      // byte 0 = 0x10  =>  btcr2_version=1, network_value=0
      expect(() => Identifier.decode(forge('k', 0x10, validKeyBytes))).to.throw(/version/i);
    });

    it('rejects btcr2_version 2 (first nibble 0x2)', () => {
      expect(() => Identifier.decode(forge('k', 0x20, validKeyBytes))).to.throw(/version/i);
    });

    it('rejects btcr2_version 0xE (first nibble 0xE)', () => {
      expect(() => Identifier.decode(forge('k', 0xE0, validKeyBytes))).to.throw(/version/i);
    });

    it('rejects btcr2_version 0xF (first nibble 0xF)', () => {
      // F is reserved for the future version-extension scheme; v1 spec rejects it.
      expect(() => Identifier.decode(forge('k', 0xF0, validKeyBytes))).to.throw(/version/i);
    });
  });

  describe('network_value validation', () => {
    it('rejects reserved network_value 6', () => {
      expect(() => Identifier.decode(forge('k', 0x06, validKeyBytes))).to.throw(/network/i);
    });

    it('rejects reserved network_value 7', () => {
      expect(() => Identifier.decode(forge('k', 0x07, validKeyBytes))).to.throw(/network/i);
    });

    it('accepts custom network_value 12 (returns numeric 1)', () => {
      const decoded = Identifier.decode(forge('k', 0x0C, validKeyBytes));
      expect(decoded.network).to.equal(1);
    });

    it('accepts custom network_value 13 (returns numeric 2)', () => {
      const decoded = Identifier.decode(forge('k', 0x0D, validKeyBytes));
      expect(decoded.network).to.equal(2);
    });

    it('accepts custom network_value 14 (returns numeric 3)', () => {
      const decoded = Identifier.decode(forge('k', 0x0E, validKeyBytes));
      expect(decoded.network).to.equal(3);
    });
  });

  describe('genesisBytes validation', () => {
    it('rejects KEY with non-pubkey trailing bytes', () => {
      // 33 zero bytes — not a valid compressed pubkey (leading byte must be 0x02 or 0x03)
      expect(() => Identifier.decode(forge('k', 0x00, new Uint8Array(33))))
        .to.throw(/genesisBytes/i);
    });

    it('rejects KEY with too-short trailing bytes', () => {
      expect(() => Identifier.decode(forge('k', 0x00, new Uint8Array(20))))
        .to.throw(/genesisBytes/i);
    });

    it('accepts EXTERNAL with exact 32 trailing bytes', () => {
      expect(() => Identifier.decode(forge('x', 0x00, validHashBytes))).to.not.throw();
    });
  });

  describe('roundtrip', () => {
    it('encode -> decode preserves components for every fixture', () => {
      for(const { did, components } of data) {
        const decoded = Identifier.decode(did);
        expect(decoded.idType).to.equal(components.idType);
        expect(decoded.version).to.equal(components.version);
        expect(decoded.network).to.equal(components.network);
        expect(bytesToHex(decoded.genesisBytes)).to.equal(components.genesisBytes);

        // Re-encode the decoded components and verify we get the original DID back.
        const reEncoded = Identifier.encode(decoded.genesisBytes, {
          idType  : decoded.idType as 'KEY' | 'EXTERNAL',
          version : decoded.version,
          network : decoded.network as never,
        });
        expect(reEncoded).to.equal(did);
      }
    });
  });

  describe('isValid', () => {
    it('returns true for every valid fixture', () => {
      for(const { did } of data) {
        expect(Identifier.isValid(did)).to.equal(true);
      }
    });

    it('returns false for malformed DIDs', () => {
      expect(Identifier.isValid('not a did')).to.equal(false);
      expect(Identifier.isValid('did:btcr2:')).to.equal(false);
      expect(Identifier.isValid('did:foo:abcdef')).to.equal(false);
    });

    it('returns false for forged DIDs with btcr2_version != 0', () => {
      expect(Identifier.isValid(forge('k', 0x10, validKeyBytes))).to.equal(false);
    });

    it('returns false for forged DIDs with reserved network_value', () => {
      expect(Identifier.isValid(forge('k', 0x06, validKeyBytes))).to.equal(false);
    });
  });

  describe('getPublicKey', () => {
    it('extracts the compressed public key from a KEY DID', () => {
      const keyDid = data.find(d => d.components.idType === 'KEY')!.did;
      const pubkey = Identifier.getPublicKey(keyDid);
      expect(pubkey.compressed.length).to.equal(33);
    });

    it('throws for EXTERNAL DIDs', () => {
      const externalDid = data.find(d => d.components.idType === 'EXTERNAL')!.did;
      expect(() => Identifier.getPublicKey(externalDid)).to.throw(/EXTERNAL/i);
    });
  });
});
