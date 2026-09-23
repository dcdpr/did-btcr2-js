import { expect } from 'chai';
import {
  Appendix,
  BEACON_ADDRESS_TYPES,
  BEACON_TYPES,
  BeaconFactory,
  BeaconUtils,
  BitcoinConnection,
  buildGenesisDocument,
  canonicalHash,
  DEFAULT_BEACON_ADDRESS_TYPE,
  DidBtcr2,
  JSONPatch,
  KeyManagerSigner,
  LocalKeyManager,
  LocalSigner,
  Resolver,
  rootCauseMessage,
  SchnorrKeyPair,
  Updater,
  VERIFICATION_RELATIONSHIPS,
} from '../src/index.js';
import type {
  BeaconAddressType,
  BeaconService,
  BeaconType,
  BroadcastOptions,
  BroadcastResult,
  Btcr2DidDocument,
  CASAnnouncement,
  DidComponents,
  DidCreateOptions,
  ExternalCreateResult,
  GenerateKeyOptions,
  GenesisBeaconSpec,
  GenesisDocumentSpec,
  GenesisVerificationMethodSpec,
  IdentifierCheck,
  IdentifierComponents,
  IdentifierReport,
  IdentifierValidateOptions,
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
  VerificationRelationship,
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
  didComponents: DidComponents;
  didCreateOptions: DidCreateOptions;
  generateKeyOptions: GenerateKeyOptions;
  identifierCheck: IdentifierCheck;
  identifierComponents: IdentifierComponents;
  identifierReport: IdentifierReport;
  identifierValidateOptions: IdentifierValidateOptions;
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
  beaconAddressType: BeaconAddressType;
  beaconType: BeaconType;
  externalCreateResult: ExternalCreateResult;
  genesisBeaconSpec: GenesisBeaconSpec;
  genesisDocumentSpec: GenesisDocumentSpec;
  genesisVerificationMethodSpec: GenesisVerificationMethodSpec;
  verificationRelationship: VerificationRelationship;
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

  it('exports the genesis document builder and its constants as values', () => {
    expect(buildGenesisDocument).to.be.a('function');
    expect(BEACON_TYPES).to.deep.equal(['SingletonBeacon', 'CASBeacon', 'SMTBeacon']);
    expect(BEACON_ADDRESS_TYPES).to.deep.equal(['p2pkh', 'p2wpkh', 'p2tr']);
    expect(VERIFICATION_RELATIONSHIPS).to.deep.equal([
      'authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation',
    ]);
    expect(DEFAULT_BEACON_ADDRESS_TYPE).to.equal('p2wpkh');
  });

  it('exports rootCauseMessage as a value', () => {
    expect(rootCauseMessage).to.be.a('function');
    expect(rootCauseMessage(new Error('outer', { cause: new Error('inner') }))).to.equal('inner');
  });

  it('exports canonicalHash, JSONPatch, and Appendix as values for a vector tool', () => {
    // JSON Document Hashing is independent of the property order, and the default encoding is base64url.
    expect(canonicalHash({ b: 1, a: 2 })).to.equal(canonicalHash({ a: 2, b: 1 }));
    expect(canonicalHash({ a: 2, b: 1 })).to.match(/^[A-Za-z0-9_-]{43}$/);

    const source = { a: 1 };
    expect(JSONPatch.apply(source, [{ op: 'add', path: '/b', value: 2 }])).to.deep.equal({ a: 1, b: 2 });
    expect(source).to.deep.equal({ a: 1 });

    const did = 'did:btcr2:k1qqp8n0nx0muaewav2ksx99wwsu9swq5mlndjmn3gm9vl9q2mzmup0xqhmkf96';
    expect(Appendix.deriveRootCapability(did)).to.deep.equal({
      '@context'       : 'https://w3id.org/zcap/v1',
      id               : `urn:zcap:root:${encodeURIComponent(did)}`,
      controller       : did,
      invocationTarget : did,
    });
  });
});
