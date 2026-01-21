import { expect } from 'chai';
import {
  CanonicalizationError,
  CIDAggregateBeaconError,
  CryptosuiteError,
  DataIntegrityProofError,
  DidDocumentError,
  DidMethodError,
  KeyManagerError,
  KeyPairError,
  MethodError,
  MultikeyError,
  NotImplementedError,
  ProofError,
  PublicKeyError,
  ResolveError,
  SecretKeyError,
  SingletonBeaconError,
  SMTAggregateBeaconError,
  UpdateError
} from '../src/index.js';

describe('errors', () => {
  it('sets name/type and preserves data', () => {
    const err = new DidMethodError('msg', { type: 'CustomType', name: 'CustomName', data: { foo: 'bar' } });
    expect(err.name).to.equal('CustomName');
    expect(err.type).to.equal('CustomType');
    expect(err.data).to.deep.equal({ foo: 'bar' });
    expect(err).to.be.instanceOf(DidMethodError);
  });

  it('creates specialized errors with proper names', () => {
    expect(new MethodError('some message', 'TYPE')).to.be.instanceOf(DidMethodError);
    expect(new UpdateError('some message').name).to.equal('UpdateError');
    expect(new ResolveError('some message').name).to.equal('ResolveError');
    expect(new KeyManagerError('some message').name).to.equal('KeyManagerError');
    expect(new DidDocumentError('some message').name).to.equal('DidDocumentError');
    expect(new CryptosuiteError('some message').name).to.equal('CryptosuiteError');
    expect(new DataIntegrityProofError('some message').name).to.equal('DataIntegrityProofError');
    expect(new KeyPairError('some message').name).to.equal('KeyPairError');
    expect(new SecretKeyError('some message').name).to.equal('SecretKeyError');
    expect(new PublicKeyError('some message').name).to.equal('PublicKeyError');
    expect(new MultikeyError('some message').name).to.equal('MultikeyError');
    expect(new ProofError('some message').name).to.equal('ProofError');
    expect(new SingletonBeaconError('some message').name).to.equal('SingletonBeaconError');
    expect(new CIDAggregateBeaconError('some message').name).to.equal('CIDAggregateBeaconError');
    expect(new SMTAggregateBeaconError('some message').name).to.equal('SMTAggregateBeaconError');
    expect(new CanonicalizationError('some message').name).to.equal('CanonicalizationError');
    expect(new NotImplementedError('some message').name).to.equal('NotImplementedError');
  });
});
