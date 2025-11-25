import { expect } from 'chai';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { KeyManagerApi, KeyPairApi, MultikeyApi } from '../src/index.js';

/**
 * MultikeyApi Test
 */
describe('MultikeyApi', () => {
  const mkApi = new MultikeyApi();
  const kpApi = new KeyPairApi();

  it('create() returns a SchnorrMultikey', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('key-1', 'did:example:123', kp);
    expect(mk).to.be.instanceOf(SchnorrMultikey);
  });

  it('fromSecretKey() creates multikey from secret bytes', () => {
    const kp = kpApi.generate();
    const mk = mkApi.fromSecretKey('key-2', 'did:example:456', kp.secretKey!.bytes);
    expect(mk).to.be.instanceOf(SchnorrMultikey);
  });

  it('fromPublicKey() creates a verification-only multikey', () => {
    const kp = kpApi.generate();
    const mk = mkApi.fromPublicKey({
      id             : 'key-3',
      controller     : 'did:example:789',
      publicKeyBytes : kp.publicKey.compressed
    });
    expect(mk).to.exist;
  });

  it('fromKms() creates a multikey from a KMS key', () => {
    const kmsApi = new KeyManagerApi();
    const keyId = kmsApi.generateKey();
    const mk = mkApi.fromKms('#key-1', 'did:example:kms', keyId, kmsApi);
    expect(mk).to.exist;
  });

  it('toVerificationMethod() returns a DID verification method', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('key-1', 'did:example:123', kp);
    const vm = mkApi.toVerificationMethod(mk);
    expect(vm).to.have.property('id');
    expect(vm).to.have.property('type', 'Multikey');
    expect(vm).to.have.property('publicKeyMultibase');
  });

  it('fromVerificationMethod() reconstructs a multikey', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('key-1', 'did:example:123', kp);
    const vm = mkApi.toVerificationMethod(mk);
    const restored = mkApi.fromVerificationMethod(vm);
    expect(restored).to.be.instanceOf(SchnorrMultikey);
  });

  it('sign() and verify() round-trip with explicit multikey', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('key-1', 'did:example:123', kp);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const sig = mkApi.sign(data, mk);
    expect(sig).to.be.instanceOf(Uint8Array);
    expect(mkApi.verify(data, sig, mk)).to.equal(true);
  });

  it('verify() returns false for wrong data', () => {
    const kp = kpApi.generate();
    const mk = mkApi.create('key-1', 'did:example:123', kp);
    const data = new Uint8Array([1, 2, 3]);
    const sig = mkApi.sign(data, mk);
    const wrongData = new Uint8Array([9, 8, 7]);
    expect(mkApi.verify(wrongData, sig, mk)).to.equal(false);
  });

  // --- stateful ---

  it('use() sets the current multikey', () => {
    const api = new MultikeyApi();
    const kp = kpApi.generate();
    const mk = api.create('key-1', 'did:example:123', kp);
    expect(api.current).to.be.undefined;
    api.use(mk);
    expect(api.current).to.equal(mk);
  });

  it('sign() and verify() use current multikey when none passed', () => {
    const api = new MultikeyApi();
    const kp = kpApi.generate();
    const mk = api.create('key-1', 'did:example:123', kp);
    api.use(mk);
    const data = new Uint8Array([10, 20, 30]);
    const sig = api.sign(data);
    expect(sig).to.be.instanceOf(Uint8Array);
    expect(api.verify(data, sig)).to.equal(true);
  });

  it('toVerificationMethod() uses current multikey when none passed', () => {
    const api = new MultikeyApi();
    const kp = kpApi.generate();
    const mk = api.create('key-1', 'did:example:123', kp);
    api.use(mk);
    const vm = api.toVerificationMethod();
    expect(vm).to.have.property('id');
    expect(vm).to.have.property('type', 'Multikey');
  });

  it('sign() throws when no current multikey and none passed', () => {
    const api = new MultikeyApi();
    expect(() => api.sign(new Uint8Array([1]))).to.throw('No current multikey set');
  });

  it('clear() removes the current multikey', () => {
    const api = new MultikeyApi();
    const kp = kpApi.generate();
    const mk = api.create('key-1', 'did:example:123', kp);
    api.use(mk);
    api.clear();
    expect(api.current).to.be.undefined;
  });

  it('use() returns this for chaining', () => {
    const api = new MultikeyApi();
    const kp = kpApi.generate();
    const mk = api.create('key-1', 'did:example:123', kp);
    const ret = api.use(mk);
    expect(ret).to.equal(api);
  });
});
