import { expect } from 'chai';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { IdentifierTypes } from '@did-btcr2/common';
import { DidApi } from '../src/index.js';

/**
 * DidApi Test
 */
describe('DidApi', () => {
  const didApi = new DidApi();

  it('generate() returns a did and keyPair', () => {
    const result = didApi.generate();
    expect(result.did).to.be.a('string').and.match(/^did:btcr2:/);
    expect(result.keyPair).to.have.property('secretKey');
    expect(result.keyPair).to.have.property('publicKey');
  });

  it('generate() with explicit network produces a DID for that network', () => {
    const result = didApi.generate('testnet4');
    expect(result.did).to.be.a('string').and.match(/^did:btcr2:/);
    const components = didApi.decode(result.did);
    expect(components.network).to.equal('testnet4');
  });

  it('generate() without network defaults to regtest', () => {
    const result = didApi.generate();
    const components = didApi.decode(result.did);
    expect(components.network).to.equal('regtest');
  });

  it('encode() and decode() round-trip for KEY type', () => {
    const kp = SchnorrKeyPair.generate();
    const did = didApi.encode(kp.publicKey.compressed, {
      idType  : IdentifierTypes.KEY,
      version : 1,
      network : 'regtest',
    });
    expect(did).to.match(/^did:btcr2:/);
    const components = didApi.decode(did);
    expect(components.idType).to.equal('KEY');
    expect(components.version).to.equal(1);
    expect(components.network).to.equal('regtest');
  });

  it('encode() rejects empty genesisBytes', () => {
    expect(() => didApi.encode(new Uint8Array(0) as any, {
      idType  : IdentifierTypes.KEY,
      version : 1,
      network : 'regtest',
    })).to.throw('genesisBytes must be a non-empty Uint8Array');
  });

  it('decode() rejects empty string', () => {
    expect(() => didApi.decode('')).to.throw('did must be a non-empty string');
  });

  it('decode() returns the hrp with the components', () => {
    const { did } = didApi.generate();
    const components = didApi.decode(did);
    expect(components.hrp).to.equal('k');
    expect(components.idType).to.equal('KEY');
  });

  it('validate() reports a valid DID with every check passed', () => {
    const { did } = didApi.generate('signet');
    const report = didApi.validate(did);
    expect(report.did).to.equal(did);
    expect(report.valid).to.equal(true);
    expect(report.idType).to.equal('KEY');
    expect(report.network).to.equal('signet');
    expect(report.checks.map((check) => check.name)).to.deep.equal(
      ['prefix', 'lowercase', 'bech32m', 'version', 'network', 'genesisBytes', 'roundTrip']
    );
  });

  it('validate() reports an invalid DID without a throw', () => {
    const { did } = didApi.generate();
    const upper = `did:btcr2:${did.slice('did:btcr2:'.length).toUpperCase()}`;
    const report = didApi.validate(upper);
    expect(report.valid).to.equal(false);
    expect(report.checks[report.checks.length - 1]).to.include({ name: 'lowercase', ok: false });
    expect(didApi.validate('').valid).to.equal(false);
    expect(didApi.validate('not-a-did').valid).to.equal(false);
  });

  it('validate() passes the genesis bytes to the check', () => {
    const { did, keyPair } = didApi.generate();
    const publicKey = SchnorrKeyPair.fromJSON(keyPair).publicKey.compressed;
    const report = didApi.validate(did, { genesisBytes: publicKey });
    expect(report.valid).to.equal(true);
    expect(report.checks[report.checks.length - 1]).to.include({ name: 'genesisBytesMatch', ok: true });
    expect(didApi.validate(did, { genesisBytes: new Uint8Array(33) }).valid).to.equal(false);
  });

  it('validate() passes the genesis document to the check', () => {
    const { did } = didApi.generate();
    const report = didApi.validate(did, { genesisDocument: { id: 'did:btcr2:_' } });
    expect(report.valid).to.equal(false);
    expect(report.checks[report.checks.length - 1]).to.include({ name: 'genesisDocument', ok: false });
  });

  it('validate() rejects a value that is not a string', () => {
    expect(() => didApi.validate(42 as unknown as string)).to.throw('did must be a string');
  });

  it('isValid() returns true for a valid DID', () => {
    const { did } = didApi.generate();
    expect(didApi.isValid(did)).to.equal(true);
  });

  it('isValid() returns false for an invalid DID', () => {
    expect(didApi.isValid('did:btcr2:invalid')).to.equal(false);
    expect(didApi.isValid('not-a-did')).to.equal(false);
  });

  it('isValid() returns false for empty string', () => {
    expect(didApi.isValid('')).to.equal(false);
  });

  it('parse() returns a Did for valid input', () => {
    const { did } = didApi.generate();
    const parsed = didApi.parse(did);
    expect(parsed).to.exist;
    expect(parsed!.method).to.equal('btcr2');
  });

  it('parse() returns null for invalid input', () => {
    const parsed = didApi.parse('not-a-did');
    expect(parsed).to.equal(null);
  });

  it('parse() returns null for empty string', () => {
    expect(didApi.parse('')).to.equal(null);
  });
});
