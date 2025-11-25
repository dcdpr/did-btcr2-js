import { expect } from 'chai';
import {
  CryptosuiteApi,
  DataIntegrityProofApi,
  KeyPairApi,
  MultikeyApi,
} from '../src/index.js';

/**
 * DataIntegrityProofApi Test
 */
describe('DataIntegrityProofApi', () => {
  const dipApi = new DataIntegrityProofApi();
  const csApi = new CryptosuiteApi();
  const mkApi = new MultikeyApi();
  const kpApi = new KeyPairApi();

  const makeDocument = () => ({
    '@context'        : ['https://www.w3.org/ns/did/v1'],
    sourceDocument    : { id: 'did:btcr2:test', verificationMethod: [], service: [] },
    patch             : [{ op: 'add', path: '/test', value: 'x' }],
    sourceVersionId   : 1,
    targetVersionId   : 2,
  });

  const makeConfig = () => ({
    '@context'           : ['https://www.w3.org/ns/did/v1'],
    type                 : 'DataIntegrityProof' as const,
    cryptosuite          : 'bip340-jcs-2025',
    verificationMethod   : 'did:btcr2:test#key-1',
    proofPurpose         : 'assertionMethod',
    domain               : 'did:btcr2:test',
  });

  it('create() returns a BIP340DataIntegrityProof', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:example:dip', kp);
    const cs = csApi.create(mk);
    const proof = dipApi.create(cs);
    expect(proof).to.exist;
  });

  it('addProof() adds a proof to a document with explicit instance', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = dipApi.create(cs);
    const signed = dipApi.addProof(makeDocument() as any, makeConfig(), proofInst);
    expect(signed).to.exist;
    expect(signed).to.have.property('proof');
  });

  it('signDocument() creates and signs in one call', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const signed = dipApi.signDocument(mk, makeDocument() as any, makeConfig());
    expect(signed).to.exist;
    expect(signed).to.have.property('proof');
  });

  it('verifyProof() verifies a serialized proof with explicit instance', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = dipApi.create(cs);
    const signed = dipApi.addProof(makeDocument() as any, makeConfig(), proofInst);
    const serialized = JSON.stringify(signed);
    const result = dipApi.verifyProof(
      serialized,
      'assertionMethod',
      'application/json',
      'did:btcr2:test',
      undefined,
      proofInst
    );
    expect(result).to.exist;
    expect(result).to.have.property('verified');
  });

  // --- stateful ---

  it('use() sets the current proof instance', () => {
    const api = new DataIntegrityProofApi();
    expect(api.current).to.be.undefined;
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = api.create(cs);
    api.use(proofInst);
    expect(api.current).to.equal(proofInst);
  });

  it('addProof() uses current proof instance when none passed', () => {
    const api = new DataIntegrityProofApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = api.create(cs);
    api.use(proofInst);
    const signed = api.addProof(makeDocument() as any, makeConfig());
    expect(signed).to.have.property('proof');
  });

  it('verifyProof() uses current proof instance when none passed', () => {
    const api = new DataIntegrityProofApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = api.create(cs);
    api.use(proofInst);
    const signed = api.addProof(makeDocument() as any, makeConfig());
    const serialized = JSON.stringify(signed);
    const result = api.verifyProof(
      serialized,
      'assertionMethod',
      'application/json',
      'did:btcr2:test'
    );
    expect(result).to.have.property('verified');
  });

  it('addProof() throws when no current proof and none passed', () => {
    const api = new DataIntegrityProofApi();
    expect(() => api.addProof({} as any, {} as any)).to.throw('No current proof instance set');
  });

  it('clear() removes the current proof instance', () => {
    const api = new DataIntegrityProofApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = api.create(cs);
    api.use(proofInst);
    api.clear();
    expect(api.current).to.be.undefined;
  });

  it('use() returns this for chaining', () => {
    const api = new DataIntegrityProofApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const proofInst = api.create(cs);
    const ret = api.use(proofInst);
    expect(ret).to.equal(api);
  });
});
