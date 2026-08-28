import { expect } from 'chai';
import {
  BeaconFactory,
  BeaconUtils,
  BitcoinConnection,
  DidBtcr2,
  KeyManagerSigner,
  LocalKeyManager,
  LocalSigner,
  Resolver,
  rootCauseMessage,
  SchnorrKeyPair,
  Updater,
} from '../src/index.js';
import type {
  BeaconService,
  BroadcastOptions,
  BroadcastResult,
  Btcr2DidDocument,
  CASAnnouncement,
  DidCreateOptions,
  GenerateKeyOptions,
  IdentifierComponents,
  ImportKeyOptions,
  KeyIdentifier,
  KeyManager,
  KmsSignOptions,
  ResolutionOptions,
  Sidecar,
  SignedBTCR2Update,
  Signer,
  SigningScheme,
  SignOptions,
  SMTProof,
  VerifyOptions,
} from '../src/index.js';

/**
 * The write path and the BYO surface must be importable from the api package
 * alone: no second install to obtain a signer or to name a type that appears
 * in a public signature. Compilation of the type-position usages below is
 * half of the assertion; the value checks are the other half.
 */
type SurfaceTypes = {
  beaconService: BeaconService;
  broadcastOptions: BroadcastOptions;
  broadcastResult: BroadcastResult;
  btcr2DidDocument: Btcr2DidDocument;
  casAnnouncement: CASAnnouncement;
  didCreateOptions: DidCreateOptions;
  generateKeyOptions: GenerateKeyOptions;
  identifierComponents: IdentifierComponents;
  importKeyOptions: ImportKeyOptions;
  keyIdentifier: KeyIdentifier;
  keyManager: KeyManager;
  kmsSignOptions: KmsSignOptions;
  resolutionOptions: ResolutionOptions;
  sidecar: Sidecar;
  signedUpdate: SignedBTCR2Update;
  signer: Signer;
  signingScheme: SigningScheme;
  signOptions: SignOptions;
  smtProof: SMTProof;
  verifyOptions: VerifyOptions;
};

/**
 * Index re-export surface test
 */
describe('index re-exports', () => {
  it('exports the signer implementations and their key classes as values', () => {
    for (const value of [LocalSigner, SchnorrKeyPair, KeyManagerSigner, LocalKeyManager]) {
      expect(value).to.be.a('function');
    }
  });

  it('exports the method drivers and BitcoinConnection as values', () => {
    for (const value of [BeaconFactory, BeaconUtils, DidBtcr2, Resolver, Updater, BitcoinConnection]) {
      expect(value).to.exist;
    }
  });

  it('a signer obtained through the api surface satisfies Signer', () => {
    const kp = SchnorrKeyPair.generate();
    const localSigner: Signer = new LocalSigner(kp.secretKey.bytes);
    const kmsSigner: Signer = new KeyManagerSigner(new LocalKeyManager());
    expect(localSigner.publicKey).to.be.instanceOf(Uint8Array);
    expect(kmsSigner).to.exist;
  });

  it('the two SignOptions shapes are distinct and both nameable', () => {
    const kmsOptions: KmsSignOptions = { scheme: 'bip340' };
    const signerOptions: SignOptions = { merkleRoot: null };
    // Compile-time direction guard: the plain SignOptions is the Signer-level
    // shape and must not carry `scheme`; KmsSignOptions must. Rewiring either
    // re-export to the other package's shape stops this compiling.
    const plainOmitsScheme: 'scheme' extends keyof SignOptions ? never : true = true;
    const kmsCarriesScheme: 'scheme' extends keyof KmsSignOptions ? true : never = true;
    expect(kmsOptions.scheme).to.equal('bip340');
    expect(signerOptions.merkleRoot).to.equal(null);
    expect(plainOmitsScheme && kmsCarriesScheme).to.equal(true);
  });

  it('every re-exported type name is usable in type position', () => {
    const witness: SurfaceTypes | undefined = undefined;
    expect(witness).to.equal(undefined);
  });

  it('exports rootCauseMessage as a value', () => {
    expect(rootCauseMessage).to.be.a('function');
    expect(rootCauseMessage(new Error('outer', { cause: new Error('inner') }))).to.equal('inner');
  });
});
