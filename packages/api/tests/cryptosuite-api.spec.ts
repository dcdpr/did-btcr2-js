import { expect } from 'chai';
import { BIP340Cryptosuite } from '@did-btcr2/cryptosuite';
import { CryptosuiteApi, KeyManagerApi, KeyPairApi, MultikeyApi } from '../src/index.js';

/**
 * CryptosuiteApi Test
 */
describe('CryptosuiteApi', () => {
  const csApi = new CryptosuiteApi();
  const mkApi = new MultikeyApi();
  const kpApi = new KeyPairApi();

  it('createFromKms() creates a cryptosuite from a KMS key', () => {
    const kmsApi = new KeyManagerApi();
    const keyId = kmsApi.generateKey();
    const cs = csApi.createFromKms('#key-1', 'did:btcr2:test', keyId, kmsApi);
    expect(cs).to.be.instanceOf(BIP340Cryptosuite);
  });

  it('create() returns a BIP340Cryptosuite', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:example:cs', kp);
    const cs = csApi.create(mk);
    expect(cs).to.be.instanceOf(BIP340Cryptosuite);
  });

  it('toDataIntegrityProof() converts cryptosuite to proof instance', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:example:cs', kp);
    const cs = csApi.create(mk);
    const dip = csApi.toDataIntegrityProof(cs);
    expect(dip).to.exist;
  });

  it('createProof() and verifyProof() round-trip with explicit cs', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = csApi.create(mk);
    const document = {
      '@context'        : ['https://www.w3.org/ns/did/v1'],
      sourceDocument    : { id: 'did:btcr2:test', verificationMethod: [], service: [] },
      patch             : [{ op: 'add', path: '/test', value: 'x' }],
      sourceVersionId   : 1,
      targetVersionId   : 2,
    };
    const config = {
      '@context'           : ['https://www.w3.org/ns/did/v1'],
      type                 : 'DataIntegrityProof' as const,
      cryptosuite          : 'bip340-jcs-2025',
      verificationMethod   : 'did:btcr2:test#key-1',
      proofPurpose         : 'assertionMethod',
      domain               : 'did:btcr2:test',
    };
    const proofObj = csApi.createProof(document as any, config, cs);
    expect(proofObj).to.exist;
    expect(proofObj).to.have.property('type');

    const signedDoc = { ...document, proof: proofObj } as any;
    const result = csApi.verifyProof(signedDoc, cs);
    expect(result).to.exist;
    expect(result).to.have.property('verified');
  });

  // --- stateful ---

  it('use() sets the current cryptosuite', () => {
    const api = new CryptosuiteApi();
    expect(api.current).to.be.undefined;
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:example:cs', kp);
    const cs = api.create(mk);
    api.use(cs);
    expect(api.current).to.equal(cs);
  });

  it('createProof() uses current cryptosuite when none passed', () => {
    const api = new CryptosuiteApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:btcr2:test', kp);
    const cs = api.create(mk);
    api.use(cs);
    const document = {
      '@context'        : ['https://www.w3.org/ns/did/v1'],
      sourceDocument    : { id: 'did:btcr2:test', verificationMethod: [], service: [] },
      patch             : [{ op: 'add', path: '/test', value: 'x' }],
      sourceVersionId   : 1,
      targetVersionId   : 2,
    };
    const config = {
      '@context'           : ['https://www.w3.org/ns/did/v1'],
      type                 : 'DataIntegrityProof' as const,
      cryptosuite          : 'bip340-jcs-2025',
      verificationMethod   : 'did:btcr2:test#key-1',
      proofPurpose         : 'assertionMethod',
      domain               : 'did:btcr2:test',
    };
    const proofObj = api.createProof(document as any, config);
    expect(proofObj).to.have.property('type');
  });

  it('createProof() throws when no current cryptosuite and none passed', () => {
    const api = new CryptosuiteApi();
    expect(() => api.createProof({} as any, {} as any)).to.throw('No current cryptosuite set');
  });

  it('clear() removes the current cryptosuite', () => {
    const api = new CryptosuiteApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:example:cs', kp);
    const cs = api.create(mk);
    api.use(cs);
    api.clear();
    expect(api.current).to.be.undefined;
  });

  it('use() returns this for chaining', () => {
    const api = new CryptosuiteApi();
    const kp = kpApi.generate();
    const mk = mkApi.create('#key-1', 'did:example:cs', kp);
    const cs = api.create(mk);
    const ret = api.use(cs);
    expect(ret).to.equal(api);
  });
});
