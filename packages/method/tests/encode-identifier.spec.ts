import { expect } from 'chai';
import { hex } from '@scure/base';
import { Identifier } from '../src/index.js';
import data from './data/encode-data.js';

const validKeyBytes = hex.decode('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000');
const validHashBytes = hex.decode('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1');

describe('Encode Identifier', () => {
  describe('happy path', () => {
    it('encodes each fixture into its expected identifier string', () => {
      for(const { did, genesisBytes, options } of data) {
        expect(Identifier.encode(genesisBytes, options)).to.equal(did);
      }
    });
  });

  describe('idType validation', () => {
    it('rejects lowercase "key"', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'key' as never, version : 1, network : 'bitcoin'
      })).to.throw(/idType/i);
    });

    it('rejects unknown idType', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'INVALID' as never, version : 1, network : 'bitcoin'
      })).to.throw(/idType/i);
    });

    it('rejects undefined idType', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : undefined as never, version : 1, network : 'bitcoin'
      })).to.throw();
    });
  });

  describe('version validation', () => {
    it('rejects version 0', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 0, network : 'bitcoin'
      })).to.throw(/version/i);
    });

    it('rejects version 2', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 2, network : 'bitcoin'
      })).to.throw(/version/i);
    });

    it('rejects negative version', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : -1, network : 'bitcoin'
      })).to.throw(/version/i);
    });

    it('rejects NaN version', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : NaN, network : 'bitcoin'
      })).to.throw(/version/i);
    });

    it('rejects non-numeric version', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : '1' as never, network : 'bitcoin'
      })).to.throw(/version/i);
    });
  });

  describe('network validation', () => {
    it('rejects unknown network name', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 1, network : 'unknown' as never
      })).to.throw(/network/i);
    });

    it('defaults undefined network to bitcoin', () => {
      // network is optional at the encoder layer and defaults to "bitcoin", matching DidBtcr2.create.
      const withUndefined = Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 1, network : undefined as never
      });
      const withBitcoin = Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 1, network : 'bitcoin'
      });
      expect(withUndefined).to.equal(withBitcoin);
    });

    it('rejects null network', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 1, network : null as never
      })).to.throw(/network/i);
    });

    it('rejects empty string network', () => {
      expect(() => Identifier.encode(validKeyBytes, {
        idType : 'KEY', version : 1, network : '' as never
      })).to.throw(/network/i);
    });
  });

  describe('genesisBytes validation', () => {
    it('rejects KEY with wrong-length bytes', () => {
      expect(() => Identifier.encode(new Uint8Array(32), {
        idType : 'KEY', version : 1, network : 'bitcoin'
      })).to.throw(/compressed secp256k1/i);
    });

    it('rejects KEY with bytes that are not a valid compressed pubkey', () => {
      // 33 bytes of zeros - wrong leading byte (must be 0x02 or 0x03)
      expect(() => Identifier.encode(new Uint8Array(33), {
        idType : 'KEY', version : 1, network : 'bitcoin'
      })).to.throw(/compressed secp256k1/i);
    });

    it('rejects EXTERNAL with non-32-byte bytes (too short)', () => {
      expect(() => Identifier.encode(new Uint8Array(31), {
        idType : 'EXTERNAL', version : 1, network : 'bitcoin'
      })).to.throw(/32-byte/i);
    });

    it('rejects EXTERNAL with non-32-byte bytes (too long)', () => {
      expect(() => Identifier.encode(new Uint8Array(33), {
        idType : 'EXTERNAL', version : 1, network : 'bitcoin'
      })).to.throw(/32-byte/i);
    });

    it('accepts EXTERNAL with exact 32 bytes', () => {
      expect(() => Identifier.encode(validHashBytes, {
        idType : 'EXTERNAL', version : 1, network : 'bitcoin'
      })).to.not.throw();
    });
  });
});
