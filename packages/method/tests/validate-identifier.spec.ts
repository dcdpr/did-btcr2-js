import { canonicalHashBytes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bech32m, hex } from '@scure/base';
import { expect } from 'chai';
import { GenesisDocument, Identifier } from '../src/index.js';
import data from './data/decode-data.js';

const validKeyBytes = hex.decode('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000');
const validHashBytes = hex.decode('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1');

/** The check names in run order. A valid identifier with no genesis document runs the first seven. */
const CHECKS = ['prefix', 'lowercase', 'bech32m', 'version', 'network', 'genesisBytes', 'roundTrip'];

/** Builds a did:btcr2 identifier from raw bytes, so that a test can drive one nibble or one byte. */
function forge(hrp: string, firstByte: number, tail: Uint8Array): string {
  const dataBytes = new Uint8Array([firstByte, ...tail]);
  return `did:btcr2:${bech32m.encodeFromBytes(hrp, dataBytes)}`;
}

/** The last check of a report. A failed report ends with its failed check. */
function last(report: ReturnType<typeof Identifier.validate>) {
  return report.checks[report.checks.length - 1];
}

/** A genesis document, its genesis bytes, and the EXTERNAL identifier that encodes them. */
function externalFixture(network = 'regtest') {
  const keyPair = SchnorrKeyPair.generate();
  const document = JSON.parse(JSON.stringify(GenesisDocument.fromPublicKey(keyPair.publicKey.compressed, network)));
  const genesisBytes = canonicalHashBytes(document);
  const did = Identifier.encode(genesisBytes, { idType: 'EXTERNAL', network });
  return { document, genesisBytes, did };
}

describe('Validate Identifier', () => {
  describe('valid identifiers', () => {
    it('reports every fixture as valid with the seven checks in run order', () => {
      for (const { did, components } of data) {
        const report = Identifier.validate(did);
        expect(report.did).to.equal(did);
        expect(report.valid).to.equal(true);
        expect(report.idType).to.equal(components.idType);
        expect(report.network).to.equal(components.network);
        expect(report.checks.map((check) => check.name)).to.deep.equal(CHECKS);
        expect(report.checks.every((check) => check.ok)).to.equal(true);
      }
    });

    it('does not throw on an invalid identifier', () => {
      expect(() => Identifier.validate('not a did')).to.not.throw();
      expect(() => Identifier.validate('')).to.not.throw();
      expect(() => Identifier.validate(undefined as unknown as string)).to.not.throw();
    });
  });

  describe('prefix check', () => {
    it('fails a value that is not a string', () => {
      const report = Identifier.validate(undefined as unknown as string);
      expect(report.valid).to.equal(false);
      expect(last(report)).to.include({ name: 'prefix', ok: false });
      expect(report.checks).to.have.length(1);
    });

    it('fails a missing "did:" scheme', () => {
      const report = Identifier.validate('btcr2:k1qqpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqvgmw6r');
      expect(last(report)).to.include({ name: 'prefix', ok: false });
    });

    it('fails an unknown DID method', () => {
      const report = Identifier.validate('did:foo:k1qqpvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqvgmw6r');
      expect(last(report)).to.include({ name: 'prefix', ok: false });
    });

    it('fails an empty method-specific id', () => {
      const report = Identifier.validate('did:btcr2:');
      expect(last(report)).to.include({ name: 'prefix', ok: false });
      expect(last(report).detail).to.match(/empty/i);
    });

    it('fails an identifier with four colon-separated parts', () => {
      const report = Identifier.validate(`${data[0].did}:extra`);
      expect(last(report)).to.include({ name: 'prefix', ok: false });
    });
  });

  describe('lowercase check', () => {
    it('fails an uppercase method-specific id and stops there', () => {
      const [{ did }] = data;
      const upper = `did:btcr2:${did.slice('did:btcr2:'.length).toUpperCase()}`;
      const report = Identifier.validate(upper);
      expect(report.valid).to.equal(false);
      expect(report.checks.map((check) => check.name)).to.deep.equal(['prefix', 'lowercase']);
      expect(last(report).detail).to.match(/lowercase/i);
      expect(report.idType).to.equal(undefined);
    });
  });

  describe('bech32m check', () => {
    it('fails a bad checksum', () => {
      const [{ did }] = data;
      const corrupted = `${did.slice(0, -1)}${did.endsWith('r') ? 'q' : 'r'}`;
      const report = Identifier.validate(corrupted);
      expect(last(report)).to.include({ name: 'bech32m', ok: false });
      expect(last(report).detail).to.match(/bech32m/i);
    });

    it('fails an hrp other than "k" or "x"', () => {
      const report = Identifier.validate(forge('z', 0x00, validKeyBytes));
      expect(last(report)).to.include({ name: 'bech32m', ok: false });
      expect(last(report).detail).to.include('"z"');
    });
  });

  describe('version check', () => {
    it('fails a btcr2_version other than 0', () => {
      const report = Identifier.validate(forge('k', 0x10, validKeyBytes));
      expect(last(report)).to.include({ name: 'version', ok: false });
      expect(last(report).detail).to.include('got 1');
      expect(report.idType).to.equal('KEY');
      expect(report.network).to.equal(undefined);
    });
  });

  describe('network check', () => {
    it('fails a reserved network_value (6 to 11)', () => {
      for (const value of [0x06, 0x0B]) {
        const report = Identifier.validate(forge('k', value, validKeyBytes));
        expect(last(report)).to.include({ name: 'network', ok: false });
        expect(last(report).detail).to.match(/reserved/i);
      }
    });

    it('fails a custom network_value (12 to 15) as not supported', () => {
      for (const value of [0x0C, 0x0E, 0x0F]) {
        const report = Identifier.validate(forge('k', value, validKeyBytes));
        expect(last(report)).to.include({ name: 'network', ok: false });
        expect(last(report).detail).to.match(/custom network, not supported/i);
      }
    });
  });

  describe('genesisBytes check', () => {
    it('fails a KEY identifier whose bytes are not a public key', () => {
      const report = Identifier.validate(forge('k', 0x00, new Uint8Array(33)));
      expect(last(report)).to.include({ name: 'genesisBytes', ok: false });
      expect(report.network).to.equal('bitcoin');
    });

    it('fails an EXTERNAL identifier whose hash is not 32 bytes', () => {
      const report = Identifier.validate(forge('x', 0x00, new Uint8Array(31)));
      expect(last(report)).to.include({ name: 'genesisBytes', ok: false });
      expect(last(report).detail).to.include('got 31 bytes');
    });

    it('passes an EXTERNAL identifier with a 32-byte hash', () => {
      const report = Identifier.validate(forge('x', 0x00, validHashBytes));
      expect(report.valid).to.equal(true);
    });
  });

  describe('genesisBytesMatch check', () => {
    it('does not run without genesis bytes', () => {
      const report = Identifier.validate(data[0].did);
      expect(report.checks.map((check) => check.name)).to.not.include('genesisBytesMatch');
    });

    it('passes the public key of a KEY identifier', () => {
      const report = Identifier.validate(data[0].did, { genesisBytes: validKeyBytes });
      expect(report.valid).to.equal(true);
      expect(last(report)).to.include({ name: 'genesisBytesMatch', ok: true });
      expect(report.checks).to.have.length(8);
    });

    it('passes the genesis document hash of an EXTERNAL identifier', () => {
      const { did, genesisBytes } = externalFixture();
      const report = Identifier.validate(did, { genesisBytes });
      expect(report.valid).to.equal(true);
      expect(last(report)).to.include({ name: 'genesisBytesMatch', ok: true });
    });

    it('fails bytes of the wrong length and names the expected length', () => {
      const report = Identifier.validate(data[0].did, { genesisBytes: validHashBytes });
      expect(report.valid).to.equal(false);
      expect(last(report)).to.include({ name: 'genesisBytesMatch', ok: false });
      expect(last(report).detail).to.include('Expected 33 genesis bytes for a KEY identifier, got 32.');
    });

    it('fails bytes that differ from the genesis bytes of the identifier', () => {
      const other = SchnorrKeyPair.generate().publicKey.compressed;
      const report = Identifier.validate(data[0].did, { genesisBytes: other });
      expect(report.valid).to.equal(false);
      expect(last(report).detail).to.match(/do not equal the genesis bytes of the identifier/);
    });

    it('fails a value that is not a Uint8Array', () => {
      const report = Identifier.validate(data[0].did, { genesisBytes: 'abcd' as unknown as Uint8Array });
      expect(last(report)).to.include({ name: 'genesisBytesMatch', ok: false });
    });

    it('runs before the genesisDocument check', () => {
      const { did, document, genesisBytes } = externalFixture();
      const report = Identifier.validate(did, { genesisBytes, genesisDocument: document });
      expect(report.valid).to.equal(true);
      expect(report.checks.map((check) => check.name).slice(-2)).to.deep.equal(['genesisBytesMatch', 'genesisDocument']);
    });
  });

  describe('genesisDocument check', () => {
    it('does not run without a genesis document', () => {
      const { did } = externalFixture();
      const report = Identifier.validate(did);
      expect(report.checks.map((check) => check.name)).to.not.include('genesisDocument');
    });

    it('passes a genesis document that hashes to the genesis bytes', () => {
      const { did, document } = externalFixture();
      const report = Identifier.validate(did, { genesisDocument: document });
      expect(report.valid).to.equal(true);
      expect(last(report)).to.include({ name: 'genesisDocument', ok: true });
      expect(report.checks).to.have.length(8);
    });

    it('fails a genesis document that does not hash to the genesis bytes', () => {
      const { document } = externalFixture();
      const other = externalFixture();
      const report = Identifier.validate(other.did, { genesisDocument: document });
      expect(report.valid).to.equal(false);
      expect(last(report)).to.include({ name: 'genesisDocument', ok: false });
      expect(last(report).detail).to.match(/does not equal the genesis bytes/i);
    });

    it('fails a genesis document whose id is not the placeholder', () => {
      const { did, document } = externalFixture();
      const report = Identifier.validate(did, { genesisDocument: { ...document, id: did } });
      expect(last(report)).to.include({ name: 'genesisDocument', ok: false });
      expect(last(report).detail).to.include('did:btcr2:_');
    });

    it('fails a genesis document that is not a valid Genesis Document', () => {
      const { did, document } = externalFixture();
      const broken = {
        ...document,
        verificationMethod : [{ ...document.verificationMethod[0], controller: 'did:example:123' }],
      };
      const report = Identifier.validate(did, { genesisDocument: broken });
      expect(last(report)).to.include({ name: 'genesisDocument', ok: false });
      expect(last(report).detail).to.match(/invalid genesis document/i);
    });

    it('fails a genesis document supplied for a KEY identifier', () => {
      const { document } = externalFixture();
      const keyDid = data.find((fixture) => fixture.components.idType === 'KEY')!.did;
      const report = Identifier.validate(keyDid, { genesisDocument: document });
      expect(report.valid).to.equal(false);
      expect(last(report)).to.include({ name: 'genesisDocument', ok: false });
      expect(last(report).detail).to.match(/KEY identifier has no genesis document/i);
    });
  });
});
