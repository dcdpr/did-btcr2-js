import { expect } from 'chai';
import { KeyManagerError } from '@did-btcr2/common';
import { BIP340Cryptosuite } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
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

  it('createFromKms() throws KEY_NOT_FOUND if the KMS has no key with the id', () => {
    const kmsApi = new KeyManagerApi();
    expect(() => csApi.createFromKms('#k', 'did:btcr2:test', 'urn:kms:secp256k1:nope', kmsApi))
      .to.throw(KeyManagerError).with.property('type', 'KEY_NOT_FOUND');
  });

  describe('createFromKms() signs through the KMS signer', () => {
    const config = {
      type               : 'DataIntegrityProof' as const,
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : 'did:btcr2:test#key-1',
      proofPurpose       : 'assertionMethod'
    };
    const document = { id: 'urn:uuid:1', a: 1 };

    it('creates a proof that verifies', () => {
      const kmsApi = new KeyManagerApi();
      const cs = csApi.createFromKms('#key-1', 'did:btcr2:test', kmsApi.generateKey(), kmsApi);
      const proof = cs.createProof(document, config);
      expect(csApi.verifyProof({ ...document, proof }, cs)).to.deep.equal({ verified: true, verifiedDocument: document });
    });

    it('verifies with a watch-only key, and createProof throws KEY_NOT_SIGNER', () => {
      const signing = new KeyManagerApi();
      const keyId = signing.generateKey();
      const proof = csApi.createFromKms('#key-1', 'did:btcr2:test', keyId, signing).createProof(document, config);
      const watching = new KeyManagerApi();
      const watchId = watching.import(new SchnorrKeyPair({ publicKey: signing.getPublicKey(keyId) }));
      const cs = csApi.createFromKms('#key-1', 'did:btcr2:test', watchId, watching);
      expect(cs.verifyProof({ ...document, proof }).verified).to.equal(true);
      expect(() => cs.createProof(document, config)).to.throw(KeyManagerError).with.property('type', 'KEY_NOT_SIGNER');
    });
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
