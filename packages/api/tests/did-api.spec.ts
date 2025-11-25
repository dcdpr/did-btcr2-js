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
