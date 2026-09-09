import { IdentifierError, INVALID_DID } from '@did-btcr2/common';
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

    it('rejects an uppercase method-specific id', () => {
      // A Bech32m decoder accepts an all-uppercase string. The specification says the
      // method-specific id MUST be lowercase, so the decoder refuses it first.
      const [{ did }] = data;
      const upper = `did:btcr2:${did.slice('did:btcr2:'.length).toUpperCase()}`;
      expect(() => Identifier.decode(upper)).to.throw(/lowercase/i);
      expect(Identifier.isValid(upper)).to.equal(false);
    });

    it('rejects a mixed-case method-specific id', () => {
      const [{ did }] = data;
      const encoded = did.slice('did:btcr2:'.length);
      const mixed = `did:btcr2:${encoded.slice(0, 4).toUpperCase()}${encoded.slice(4)}`;
      expect(() => Identifier.decode(mixed)).to.throw(/lowercase/i);
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
    // The leading nibble (btcr2_version) MUST be 0. The previous decoder only checked the version inside
    // a `while (nibble === 0xF)` loop, so a forged leading nibble of 0x1-0xE never tripped the guard and
    // was silently accepted as a higher version. These tests pin the flat single-nibble check.

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
      // F is reserved for the future version-extension scheme; v1 rejects it.
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

    it('rejects reserved network_value 8', () => {
      expect(() => Identifier.decode(forge('k', 0x08, validKeyBytes))).to.throw(/network/i);
    });

    it('rejects reserved network_value 11', () => {
      expect(() => Identifier.decode(forge('k', 0x0B, validKeyBytes))).to.throw(/network/i);
    });

    it('rejects out-of-range network_value 15', () => {
      expect(() => Identifier.decode(forge('k', 0x0F, validKeyBytes))).to.throw(/network/i);
    });

    it('rejects custom network_value 12 to 14 as not supported', () => {
      // The specification says a custom value SHOULD be rejected when the implementation
      // supports no custom network. This implementation supports none (ADR 107).
      for (const value of [0x0C, 0x0D, 0x0E]) {
        expect(() => Identifier.decode(forge('k', value, validKeyBytes)))
          .to.throw(/custom network not supported/i);
      }
    });

    it('names a reserved network_value as reserved', () => {
      expect(() => Identifier.decode(forge('k', 0x09, validKeyBytes))).to.throw(/reserved/i);
    });
  });

  describe('genesisBytes validation', () => {
    it('rejects KEY with non-pubkey trailing bytes', () => {
      // 33 zero bytes - not a valid compressed pubkey (leading byte must be 0x02 or 0x03)
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

    it('rejects EXTERNAL with too-short trailing bytes (31)', () => {
      expect(() => Identifier.decode(forge('x', 0x00, new Uint8Array(31))))
        .to.throw(/genesisBytes/i);
    });

    it('rejects EXTERNAL with too-long trailing bytes (33)', () => {
      expect(() => Identifier.decode(forge('x', 0x00, new Uint8Array(33))))
        .to.throw(/genesisBytes/i);
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

  // The specification maps every failure of the Bech32m decoder to INVALID_DID. The
  // decoder itself throws a plain Error or TypeError; decode() must not leak it.
  describe('Bech32m decoding failures', () => {
    const validDid = data[0].did;

    function expectInvalidDid(did: string): void {
      let caught: unknown;
      try {
        Identifier.decode(did);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught, did).to.be.instanceOf(IdentifierError);
      expect(caught).to.have.property('type', INVALID_DID);
      expect((caught as Error).message).to.match(/Bech32m decoding failed/);
    }

    it('rejects a bad checksum with INVALID_DID', () => {
      const last = validDid.at(-1);
      expectInvalidDid(validDid.slice(0, -1) + (last === 'q' ? 'p' : 'q'));
    });

    it('rejects non-zero padding with INVALID_DID', () => {
      // Two 5-bit words carry one byte and two padding bits; the low bits of the last word are set.
      expectInvalidDid(`did:btcr2:${bech32m.encode('k', [5, 3])}`);
    });

    it('rejects excess padding with INVALID_DID', () => {
      // Three 5-bit words carry one byte and seven padding bits, more than one byte allows.
      expectInvalidDid(`did:btcr2:${bech32m.encode('k', [5, 0, 0])}`);
    });

    it('rejects a body that is too short for the decoder with INVALID_DID', () => {
      expectInvalidDid('did:btcr2:k1qqbbb');
    });

    it('rejects a character outside the Bech32m alphabet with INVALID_DID', () => {
      expectInvalidDid(validDid.slice(0, -3) + 'b1o');
    });
  });
});

describe('Decode Identifier: specification examples', () => {
  // "DID-BTCR2 Identifier Encoding" and "DID-BTCR2 Identifier Decoding" in the
  // specification. The vectors come from the specification text, not from the
  // output of this implementation.
  const GENERATOR_POINT = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const ENCODING_EXAMPLE = 'did:btcr2:k1qqp8n0nx0muaewav2ksx99wwsu9swq5mlndjmn3gm9vl9q2mzmup0xqhmkf96';
  const DECODING_EXAMPLE = 'did:btcr2:x1qhjw6jnhwcyu5wau4x0cpwvz74c3g82c3uaehqpaf7lzfgmnwsd7spmmf54';
  const DECODING_EXAMPLE_HASH = 'e4ed4a777609ca3bbca99f80b982f571141d588f3b9b803d4fbe24a373741be8';

  it('decodes the encoding example to the generator point on bitcoin', () => {
    const components = Identifier.decode(ENCODING_EXAMPLE);
    expect(components).to.include({ idType: 'KEY', version: 1, network: 'bitcoin' });
    expect(bytesToHex(components.genesisBytes)).to.equal(GENERATOR_POINT);
  });

  it('decodes the decoding example to its SHA-256 hash on mutinynet', () => {
    const components = Identifier.decode(DECODING_EXAMPLE);
    expect(components).to.include({ idType: 'EXTERNAL', version: 1, network: 'mutinynet' });
    expect(bytesToHex(components.genesisBytes)).to.equal(DECODING_EXAMPLE_HASH);
  });
});
