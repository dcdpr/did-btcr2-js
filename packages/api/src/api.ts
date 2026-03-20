import {
  BitcoinConnection,
  BitcoinCoreRpcClient,
  BitcoinRestClient,
  type BlockV3,
  type HttpExecutor,
  type NetworkName,
  type RawTransactionRest,
  type RawTransactionV2,
  type RestConfig,
  type RpcConfig
} from '@did-btcr2/bitcoin';
import type {
  Bytes,
  CryptosuiteName,
  DocumentBytes,
  Entropy,
  HashBytes,
  Hex,
  HexString,
  JSONObject,
  KeyBytes,
  PatchOperation,
  ProofBytes,
  SchnorrKeyPairObject,
  SignatureBytes
} from '@did-btcr2/common';
import {
  IdentifierTypes,
  NotImplementedError
} from '@did-btcr2/common';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  BTCR2Update,
  DataIntegrityConfig,
  DataIntegrityProofObject,
  type FromPublicKey,
  type Multikey,
  MultikeyObject,
  SchnorrMultikey,
  SignedBTCR2Update,
  UnsignedBTCR2Update,
  VerificationResult
} from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import {
  type GenerateKeyOptions,
  type ImportKeyOptions,
  KeyIdentifier,
  KeyManager,
  Kms,
  type SignOptions,
} from '@did-btcr2/kms';
import type { Btcr2DidDocument, DidCreateOptions, ResolutionOptions } from '@did-btcr2/method';
import { DidBtcr2, DidDocument, DidDocumentBuilder, Identifier, IdentifierComponents } from '@did-btcr2/method';
import { Did, type DidResolutionResult, type DidService, type DidVerificationMethod } from '@web5/dids';

export { DidDocument, DidDocumentBuilder, Identifier, IdentifierTypes };
export type {
  BlockV3,
  Bytes,
  CryptosuiteName,
  DidResolutionResult,
  DidService,
  DidVerificationMethod,
  DocumentBytes,
  HashBytes,
  Hex,
  HttpExecutor,
  JSONObject,
  KeyBytes,
  MultikeyObject,
  NetworkName,
  PatchOperation,
  ProofBytes,
  RawTransactionV2,
  RestConfig,
  RpcConfig,
  SchnorrKeyPairObject,
  SignatureBytes
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Pluggable logger interface. All methods are optional-call; the default
 * implementation is a silent no-op.
 * @public
 */
export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

const noopFn = () => {};

/** @internal */
const NOOP_LOGGER: Logger = {
  debug : noopFn,
  info  : noopFn,
  warn  : noopFn,
  error : noopFn,
};

// ---------------------------------------------------------------------------
// Validation helpers (module-private)
// ---------------------------------------------------------------------------

/** @internal */
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
}

/** @internal */
function assertBytes(value: unknown, name: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new Error(`${name} must be a non-empty Uint8Array.`);
  }
}

/** @internal */
function assertCompressedPubkey(value: unknown, name: string): asserts value is Uint8Array {
  assertBytes(value, name);
  if (value.length !== 33) {
    throw new Error(
      `${name} must be a 33-byte compressed public key, got ${value.length} bytes.`
    );
  }
}

// ---------------------------------------------------------------------------
// Constrained type aliases
// ---------------------------------------------------------------------------

/**
 * The two supported DID identifier types.
 *
 * Note: the upstream `DidCreateOptions.idType` is typed as `string` rather
 * than a union. This local alias provides compile-time safety at the API
 * facade level. Upstream runtime validation in `Identifier.encode()` still
 * catches invalid values.
 * @public
 */
export type IdType = 'KEY' | 'EXTERNAL';

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

/**
 * A branded string representing a DID identifier (e.g. `did:btcr2:k1q...`).
 * Use branded types to prevent accidentally passing a txid where a DID is
 * expected, or vice versa, at compile time.
 *
 * @example
 * ```ts
 * const did = api.generateDid().did as DidString;
 * api.resolveDid(did); // OK
 * api.btc.getTransaction(did); // Type error — DidString is not TxId
 * ```
 * @public
 */
export type DidString = string & { readonly __brand: 'DidString' };

/**
 * A branded string representing a Bitcoin transaction ID (64-char hex).
 * @public
 */
export type TxId = string & { readonly __brand: 'TxId' };

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of a DID resolution attempt. Wraps the standard
 * {@link DidResolutionResult} with a discriminated `ok` flag for ergonomic
 * pattern matching without exception handling.
 *
 * @example
 * ```ts
 * const result = await api.tryResolveDid(did);
 * if (result.ok) {
 *   console.log(result.document);
 * } else {
 *   console.log(result.error, result.errorMessage);
 * }
 * ```
 * @public
 */
export type ResolutionResult =
  | { ok: true;  document: Btcr2DidDocument; metadata: DidResolutionResult['didDocumentMetadata']; raw: DidResolutionResult }
  | { ok: false; error: string; errorMessage?: string; raw: DidResolutionResult };

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Bitcoin API configuration options.
 * The `network` field is required and determines default REST/RPC endpoints.
 * Optional `rest` and `rpc` fields override individual endpoints on top of
 * the network defaults.
 *
 * @example
 * ```ts
 * // Use regtest defaults (localhost Polar + Esplora)
 * { network: 'regtest' }
 *
 * // Use testnet4 with a custom REST endpoint
 * { network: 'testnet4', rest: { host: 'https://my-mempool.example/api' } }
 *
 * // Use regtest with custom RPC credentials, default REST
 * { network: 'regtest', rpc: { host: 'http://mynode:18443', username: 'u', password: 'p' } }
 * ```
 * @public
 */
export type BitcoinApiConfig = {
  /** Bitcoin network name (e.g., 'regtest', 'testnet4', 'bitcoin'). */
  network: NetworkName;
  /** Override REST client settings on top of network defaults. */
  rest?: Partial<RestConfig>;
  /** Override RPC client settings on top of network defaults. */
  rpc?: RpcConfig;
  /**
   * Optional HTTP executor for sans-I/O usage. Defaults to global `fetch`.
   * Inject a custom executor to intercept requests in tests or route through
   * a proxy without monkey-patching globals.
   */
  executor?: HttpExecutor;
  /**
   * Optional request timeout in milliseconds for REST calls.
   * When set, wraps the HTTP executor with an `AbortSignal.timeout()`.
   * Has no effect when a custom `executor` is provided (the custom
   * executor is responsible for its own timeouts).
   */
  timeoutMs?: number;
};

/**
 * Top-level API configuration options.
 * @public
 */
export type ApiConfig = {
  btc?: BitcoinApiConfig;
  kms?: KeyManager;
  /** Optional logger. Defaults to a silent no-op logger. */
  logger?: Logger;
};

// ---------------------------------------------------------------------------
// KeyPair sub-facade
// ---------------------------------------------------------------------------

/**
 * Schnorr keypair operations.
 * @public
 */
export class KeyPairApi {
  /**
   * Generate a new Schnorr keypair.
   * @returns The generated Schnorr keypair.
   */
  generate(): SchnorrKeyPair {
    return SchnorrKeyPair.generate();
  }

  /**
   * Create a Schnorr keypair from secret key bytes or hex string.
   * @param data The secret key bytes or hex string.
   * @returns The created Schnorr keypair.
   */
  fromSecret(data: KeyBytes | HexString): SchnorrKeyPair {
    return SchnorrKeyPair.fromSecret(data);
  }

  /** Create a secret key from entropy (bytes or bigint). */
  secretKeyFrom(ent: Entropy): Secp256k1SecretKey {
    return new Secp256k1SecretKey(ent);
  }

  /** Create a compressed public key from bytes. */
  publicKeyFrom(byt: Bytes): CompressedSecp256k1PublicKey {
    return new CompressedSecp256k1PublicKey(byt);
  }

  /** Deserialize a keypair from a JSON object. */
  fromJSON(obj: SchnorrKeyPairObject): SchnorrKeyPair {
    return SchnorrKeyPair.fromJSON(obj);
  }

  /** Serialize a keypair to a JSON object. */
  toJSON(kp: SchnorrKeyPair): SchnorrKeyPairObject {
    return kp.exportJSON();
  }

  /** Compare two keypairs for equality. */
  equals(kp1: SchnorrKeyPair, kp2: SchnorrKeyPair): boolean {
    return SchnorrKeyPair.equals(kp1, kp2);
  }
}

// ---------------------------------------------------------------------------
// Cryptosuite sub-facade
// ---------------------------------------------------------------------------

/**
 * Schnorr cryptosuite operations.
 *
 * Optionally stateful: call {@link use} to set a current cryptosuite, then
 * call {@link createProof}, {@link verifyProof}, or {@link toDataIntegrityProof}
 * without passing an explicit instance. Pass an explicit instance to any
 * method to override the current one for that call.
 * @public
 */
export class CryptosuiteApi {
  #current?: BIP340Cryptosuite;

  /** The currently active cryptosuite, or `undefined` if none is set. */
  get current(): BIP340Cryptosuite | undefined {
    return this.#current;
  }

  /**
   * Set the current cryptosuite for subsequent operations.
   * @param cs The cryptosuite to activate.
   * @returns `this` for chaining.
   */
  use(cs: BIP340Cryptosuite): this {
    this.#current = cs;
    return this;
  }

  /** Clear the current cryptosuite. */
  clear(): void {
    this.#current = undefined;
  }

  /**
   * Create a new Schnorr cryptosuite from a multikey.
   * @param multikey The Schnorr multikey to use.
   * @returns The created Schnorr cryptosuite.
   */
  create(multikey: SchnorrMultikey): BIP340Cryptosuite {
    return new BIP340Cryptosuite(multikey);
  }

  /**
   * Convenience: resolve a key from the KMS and create a cryptosuite in one step.
   * @param id The multikey ID (e.g. '#initialKey').
   * @param controller The DID that controls this key.
   * @param keyId The KMS key identifier to resolve.
   * @param kms The KeyManagerApi instance holding the key.
   * @returns The created Schnorr cryptosuite.
   */
  createFromKms(
    id: string,
    controller: string,
    keyId: KeyIdentifier,
    kms: KeyManagerApi
  ): BIP340Cryptosuite {
    const pubBytes = kms.getPublicKey(keyId);
    const mk = SchnorrMultikey.fromPublicKey({ id, controller, publicKeyBytes: pubBytes });
    return new BIP340Cryptosuite(mk as SchnorrMultikey);
  }

  /**
   * Convert a cryptosuite to a Data Integrity Proof instance.
   * Uses the current cryptosuite when `cryptosuite` is omitted.
   * @param cryptosuite Optional explicit cryptosuite to convert.
   * @returns The Data Integrity Proof instance.
   */
  toDataIntegrityProof(cryptosuite?: BIP340Cryptosuite): BIP340DataIntegrityProof {
    const cs = cryptosuite ?? this.#requireCurrent();
    return cs.toDataIntegrityProof();
  }

  /**
   * Create a proof for a document.
   * Uses the current cryptosuite when `cryptosuite` is omitted.
   * @param document The document to create the proof for.
   * @param config Configuration for the proof creation.
   * @param cryptosuite Optional explicit cryptosuite; defaults to current.
   * @returns The created proof.
   */
  createProof(
    document: BTCR2Update,
    config: DataIntegrityConfig,
    cryptosuite?: BIP340Cryptosuite
  ): DataIntegrityProofObject {
    const cs = cryptosuite ?? this.#requireCurrent();
    return cs.createProof(document, config);
  }

  /**
   * Verify a proof for a document.
   * Uses the current cryptosuite when `cryptosuite` is omitted.
   * @param document The document to verify the proof for.
   * @param cryptosuite Optional explicit cryptosuite; defaults to current.
   * @returns The full verification result.
   */
  verifyProof(document: SignedBTCR2Update, cryptosuite?: BIP340Cryptosuite): VerificationResult {
    const cs = cryptosuite ?? this.#requireCurrent();
    return cs.verifyProof(document);
  }

  #requireCurrent(): BIP340Cryptosuite {
    if (!this.#current) {
      throw new Error(
        'No current cryptosuite set. Call cryptosuite.use(cs) first, or pass an explicit instance.'
      );
    }
    return this.#current;
  }
}

// ---------------------------------------------------------------------------
// Data Integrity Proof sub-facade
// ---------------------------------------------------------------------------

/**
 * Data Integrity Proof operations.
 *
 * Optionally stateful: call {@link use} to set a current proof instance, then
 * call {@link addProof} or {@link verifyProof} without passing an explicit
 * instance. Pass an explicit instance to override for that call.
 * @public
 */
export class DataIntegrityProofApi {
  #current?: BIP340DataIntegrityProof;

  /** The currently active proof instance, or `undefined` if none is set. */
  get current(): BIP340DataIntegrityProof | undefined {
    return this.#current;
  }

  /**
   * Set the current proof instance for subsequent operations.
   * @param p The proof instance to activate.
   * @returns `this` for chaining.
   */
  use(p: BIP340DataIntegrityProof): this {
    this.#current = p;
    return this;
  }

  /** Clear the current proof instance. */
  clear(): void {
    this.#current = undefined;
  }

  /**
   * Create a BIP340DataIntegrityProof instance with the given cryptosuite.
   * @param cryptosuite The cryptosuite to use for proof operations.
   * @returns The created BIP340DataIntegrityProof instance.
   */
  create(cryptosuite: BIP340Cryptosuite): BIP340DataIntegrityProof {
    return new BIP340DataIntegrityProof(cryptosuite);
  }

  /**
   * Add a proof to a document.
   * Uses the current proof instance when `proof` is omitted.
   * @param document The document to add the proof to.
   * @param config Configuration for adding the proof.
   * @param proof Optional explicit proof instance; defaults to current.
   * @returns A document with a proof added.
   */
  addProof(
    document: UnsignedBTCR2Update,
    config: DataIntegrityConfig,
    proof?: BIP340DataIntegrityProof
  ): SignedBTCR2Update {
    const p = proof ?? this.#requireCurrent();
    return p.addProof(document, config);
  }

  /**
   * Convenience: create a cryptosuite, proof instance, and sign a document
   * in one call. Requires a multikey with signing capability.
   * @param multikey The Schnorr multikey (must include secret key).
   * @param document The unsigned document to sign.
   * @param config The Data Integrity proof configuration.
   * @returns The signed document with proof attached.
   */
  signDocument(
    multikey: SchnorrMultikey,
    document: UnsignedBTCR2Update,
    config: DataIntegrityConfig
  ): SignedBTCR2Update {
    const cs = new BIP340Cryptosuite(multikey);
    const proofInst = new BIP340DataIntegrityProof(cs);
    return proofInst.addProof(document, config);
  }

  /**
   * Verify a proof using a BIP340DataIntegrityProof instance.
   * Uses the current proof instance when `proof` is omitted.
   * @param document The document to verify the proof for.
   * @param expectedPurpose The expected proof purpose.
   * @param mediaType The media type of the document.
   * @param expectedDomain The expected domain for the proof.
   * @param expectedChallenge The expected challenge for the proof.
   * @param proof Optional explicit proof instance; defaults to current.
   * @returns The result of verifying the proof.
   */
  verifyProof(
    document: string,
    expectedPurpose: string,
    mediaType?: string,
    expectedDomain?: string,
    expectedChallenge?: string,
    proof?: BIP340DataIntegrityProof,
  ): VerificationResult {
    const p = proof ?? this.#requireCurrent();
    return p.verifyProof(
      document,
      expectedPurpose,
      mediaType,
      expectedDomain,
      expectedChallenge
    );
  }

  #requireCurrent(): BIP340DataIntegrityProof {
    if (!this.#current) {
      throw new Error(
        'No current proof instance set. Call proof.use(p) first, or pass an explicit instance.'
      );
    }
    return this.#current;
  }
}

// ---------------------------------------------------------------------------
// Multikey sub-facade
// ---------------------------------------------------------------------------

/**
 * Schnorr multikey operations.
 *
 * Optionally stateful: call {@link use} to set a current multikey, then
 * call {@link sign}, {@link verify}, or {@link toVerificationMethod} without
 * passing an explicit instance. Pass an explicit instance to any method to
 * override the current one for that call.
 * @public
 */
export class MultikeyApi {
  #current?: SchnorrMultikey;

  /** The currently active multikey, or `undefined` if none is set. */
  get current(): SchnorrMultikey | undefined {
    return this.#current;
  }

  /**
   * Set the current multikey for subsequent operations.
   * @param mk The multikey to activate.
   * @returns `this` for chaining.
   */
  use(mk: SchnorrMultikey): this {
    this.#current = mk;
    return this;
  }

  /** Clear the current multikey. */
  clear(): void {
    this.#current = undefined;
  }

  /**
   * Create a new Schnorr multikey from a keypair.
   * @param id The multikey ID.
   * @param controller The multikey controller.
   * @param keyPair The Schnorr keypair to use.
   * @returns The created Schnorr multikey.
   */
  create(id: string, controller: string, keyPair: SchnorrKeyPair): SchnorrMultikey {
    return new SchnorrMultikey({ id, controller, keyPair });
  }

  /**
   * Create a Schnorr multikey from raw secret key bytes.
   * @param id The multikey ID.
   * @param controller The multikey controller.
   * @param secretKeyBytes The secret key bytes.
   * @returns The created Schnorr multikey.
   */
  fromSecretKey(id: string, controller: string, secretKeyBytes: Bytes): SchnorrMultikey {
    return SchnorrMultikey.fromSecretKey(id, controller, secretKeyBytes);
  }

  /**
   * Create a verification-only multikey from public key bytes.
   * @param params The id, controller, and publicKeyBytes.
   * @returns The created Multikey.
   */
  fromPublicKey(params: FromPublicKey): Multikey {
    return SchnorrMultikey.fromPublicKey(params);
  }

  /**
   * Convenience: resolve a key from the KMS and create a multikey in one step.
   * @param id The multikey ID.
   * @param controller The multikey controller DID.
   * @param keyId The KMS key identifier to resolve.
   * @param kms The KeyManagerApi instance holding the key.
   * @returns The created Multikey (verification-only; public key from KMS).
   */
  fromKms(id: string, controller: string, keyId: KeyIdentifier, kms: KeyManagerApi): Multikey {
    const pubBytes = kms.getPublicKey(keyId);
    return SchnorrMultikey.fromPublicKey({ id, controller, publicKeyBytes: pubBytes });
  }

  /**
   * Reconstruct a multikey from a DID document's verification method.
   * @param verificationMethod The verification method to convert.
   * @returns The reconstructed multikey.
   */
  fromVerificationMethod(verificationMethod: DidVerificationMethod): SchnorrMultikey {
    return SchnorrMultikey.fromVerificationMethod(verificationMethod);
  }

  /**
   * Produce a DID Verification Method JSON from a multikey.
   * Uses the current multikey when `mk` is omitted.
   * @param mk Optional explicit multikey; defaults to current.
   */
  toVerificationMethod(mk?: SchnorrMultikey): DidVerificationMethod {
    const m = mk ?? this.#requireCurrent();
    return m.toVerificationMethod();
  }

  /**
   * Sign bytes via the multikey (requires secret).
   * Uses the current multikey when `mk` is omitted.
   * @param data The data to sign.
   * @param mk Optional explicit multikey; defaults to current.
   */
  sign(data: Bytes, mk?: SchnorrMultikey): SignatureBytes {
    const m = mk ?? this.#requireCurrent();
    return m.sign(data);
  }

  /**
   * Verify signature via multikey.
   * Uses the current multikey when `mk` is omitted.
   * @param data The data that was signed.
   * @param signature The signature to verify.
   * @param mk Optional explicit multikey; defaults to current.
   */
  verify(data: Bytes, signature: SignatureBytes, mk?: SchnorrMultikey): boolean {
    const m = mk ?? this.#requireCurrent();
    return m.verify(signature, data);
  }

  #requireCurrent(): SchnorrMultikey {
    if (!this.#current) {
      throw new Error(
        'No current multikey set. Call multikey.use(mk) first, or pass an explicit instance.'
      );
    }
    return this.#current;
  }
}

// ---------------------------------------------------------------------------
// Crypto sub-facade (aggregates keypair, multikey, cryptosuite, proof)
// ---------------------------------------------------------------------------

/**
 * Aggregated cryptographic operations sub-facade.
 *
 * Provides direct access to the four sub-facades ({@link keypair},
 * {@link multikey}, {@link cryptosuite}, {@link proof}) plus top-level
 * convenience methods that orchestrate the full signing/verification
 * pipeline using their stateful defaults.
 *
 * @example Stateful pipeline
 * ```ts
 * const api = createApi();
 * const kp  = api.crypto.keypair.generate();
 * const mk  = api.crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
 *
 * // Set the active multikey — flows through to cryptosuite and proof
 * api.crypto.activate(mk);
 *
 * // Now sign without threading instances
 * const signed = api.crypto.signDocument(unsignedDoc, proofConfig);
 * ```
 * @public
 */
export class CryptoApi {
  /** Schnorr keypair operations. */
  readonly keypair = new KeyPairApi();

  /** Schnorr Multikey operations (optionally stateful). */
  readonly multikey = new MultikeyApi();

  /** Schnorr Cryptosuite operations (optionally stateful). */
  readonly cryptosuite = new CryptosuiteApi();

  /** Data Integrity Proof operations (optionally stateful). */
  readonly proof = new DataIntegrityProofApi();

  /**
   * Activate a multikey and propagate through the full pipeline.
   * Sets the current multikey, creates a cryptosuite from it, and creates
   * a proof instance from the cryptosuite — all three sub-facades become
   * ready for stateful operations.
   * @param mk The multikey to activate (must include a secret key for signing).
   * @returns `this` for chaining.
   */
  activate(mk: SchnorrMultikey): this {
    this.multikey.use(mk);
    const cs = this.cryptosuite.create(mk);
    this.cryptosuite.use(cs);
    const p = this.proof.create(cs);
    this.proof.use(p);
    return this;
  }

  /**
   * Clear stateful defaults from all sub-facades.
   */
  deactivate(): void {
    this.multikey.clear();
    this.cryptosuite.clear();
    this.proof.clear();
  }

  /**
   * Sign data using the current multikey.
   * Shorthand for `crypto.multikey.sign(data)`.
   * @param data The data to sign.
   * @returns The signature bytes.
   */
  sign(data: Bytes): SignatureBytes {
    return this.multikey.sign(data);
  }

  /**
   * Verify a signature using the current multikey.
   * Shorthand for `crypto.multikey.verify(data, signature)`.
   * @param data The data that was signed.
   * @param signature The signature to verify.
   * @returns `true` if the signature is valid.
   */
  verify(data: Bytes, signature: SignatureBytes): boolean {
    return this.multikey.verify(data, signature);
  }

  /**
   * Sign a BTCR2 update document using the current proof instance.
   * Shorthand for `crypto.proof.addProof(document, config)`.
   *
   * Requires {@link activate} to have been called first, or the three
   * sub-facades to have been configured individually.
   * @param document The unsigned BTCR2 update document.
   * @param config The Data Integrity proof configuration.
   * @returns The signed document with proof attached.
   */
  signDocument(document: UnsignedBTCR2Update, config: DataIntegrityConfig): SignedBTCR2Update {
    return this.proof.addProof(document, config);
  }

  /**
   * Verify a signed BTCR2 update document using the current cryptosuite.
   * Shorthand for `crypto.cryptosuite.verifyProof(document)`.
   * @param document The signed document to verify.
   * @returns The full verification result.
   */
  verifyDocument(document: SignedBTCR2Update): VerificationResult {
    return this.cryptosuite.verifyProof(document);
  }
}

// ---------------------------------------------------------------------------
// Bitcoin sub-facade
// ---------------------------------------------------------------------------

/**
 * Bitcoin network operations sub-facade.
 * Always backed by a {@link BitcoinConnection} so it can be passed to
 * resolve/update without extra configuration.
 *
 * Lazily initialized by {@link DidBtcr2Api} to avoid connection overhead
 * when Bitcoin features are not used.
 * @public
 */
export class BitcoinApi {
  /** The underlying BitcoinConnection used for all operations. */
  readonly connection: BitcoinConnection;

  /** REST client for the active network. */
  get rest(): BitcoinRestClient {
    return this.connection.rest;
  }

  /**
   * RPC client for the active network, or `undefined` if not configured.
   * Use {@link requireRpc} when RPC is expected to be available.
   */
  get rpc(): BitcoinCoreRpcClient | undefined {
    return this.connection.rpc;
  }

  /** Whether an RPC client is available for this network. */
  get hasRpc(): boolean {
    return this.connection.rpc !== undefined;
  }

  /**
   * RPC client for the active network.
   * @throws {Error} If RPC was not configured for this network.
   */
  requireRpc(): BitcoinCoreRpcClient {
    const client = this.connection.rpc;
    if (!client) {
      throw new Error(
        'RPC client not configured. Pass an rpc config when creating the BitcoinApi, e.g.: '
        + '{ network: \'regtest\', rpc: { host: \'http://localhost:18443\', username: \'u\', password: \'p\' } }'
      );
    }
    return client;
  }

  /**
   * Create a BitcoinApi for a specific network with optional endpoint overrides.
   * Uses BitcoinConnection.forNetwork() — no env vars consulted.
   * @param cfg The network and optional REST/RPC overrides.
   */
  constructor(cfg: BitcoinApiConfig) {
    let executor = cfg.executor;
    // Wrap the default fetch with a timeout if configured and no custom
    // executor was provided.
    if (!executor && cfg.timeoutMs !== undefined) {
      const ms = cfg.timeoutMs;
      executor = (req) => fetch(req.url, {
        method  : req.method,
        headers : req.headers,
        body    : req.body,
        signal  : AbortSignal.timeout(ms),
      });
    }
    this.connection = BitcoinConnection.forNetwork(cfg.network, {
      rest : cfg.rest,
      rpc  : cfg.rpc,
      executor,
    });
  }

  /**
   * Fetch a transaction by txid via REST.
   * @param txid The transaction ID (64-character hex string).
   * @returns The fetched transaction.
   */
  async getTransaction(txid: string): Promise<RawTransactionRest> {
    assertString(txid, 'txid');
    return await this.rest.transaction.get(txid);
  }

  /**
   * Broadcast a raw tx (hex) via REST.
   * @param rawTxHex The raw transaction hex string.
   */
  async send(rawTxHex: string) {
    assertString(rawTxHex, 'rawTxHex');
    return await this.rest.transaction.send(rawTxHex);
  }

  /**
   * Get UTXOs for an address via REST.
   * @param address The Bitcoin address.
   */
  async getUtxos(address: string) {
    assertString(address, 'address');
    return await this.rest.address.getUtxos(address);
  }

  /**
   * Get a block by hash or height via REST.
   * @param params Block identifier — at least one of `hash` or `height` is required.
   */
  async getBlock(params: { hash?: string; height?: number }) {
    if (!params.hash && params.height === undefined) {
      throw new Error('getBlock requires at least one of hash or height.');
    }
    return await this.rest.block.get({ blockhash: params.hash, height: params.height });
  }

  /** Convert BTC to satoshis (integer-safe string-split arithmetic). */
  static btcToSats(btc: number): number {
    return BitcoinConnection.btcToSats(btc);
  }

  /** Convert satoshis to BTC (integer-safe string-split arithmetic). */
  static satsToBtc(sats: number): number {
    return BitcoinConnection.satsToBtc(sats);
  }
}

// ---------------------------------------------------------------------------
// KeyManager sub-facade
// ---------------------------------------------------------------------------

/**
 * Key management operations sub-facade.
 *
 * Wraps a {@link KeyManager} interface. By default uses the built-in
 * {@link Kms} implementation; a custom implementation can be injected
 * via {@link ApiConfig}.
 * @public
 */
export class KeyManagerApi {
  /** The backing KeyManager instance. */
  readonly kms: KeyManager;

  /** Create a new KeyManagerApi, optionally backed by a custom KeyManager. */
  constructor(kms?: KeyManager) {
    this.kms = kms ?? new Kms();
  }

  /** Generate a new key directly in the KMS. */
  generateKey(options?: GenerateKeyOptions): KeyIdentifier {
    return this.kms.generateKey(options);
  }

  /** Set the active key by its identifier. */
  setActive(id: KeyIdentifier): void {
    this.kms.setActiveKey(id);
  }

  /** Get the public key bytes for a key identifier. */
  getPublicKey(id?: KeyIdentifier): Bytes {
    return this.kms.getPublicKey(id);
  }

  /** Import a Schnorr keypair into the KMS. */
  import(kp: SchnorrKeyPair, options?: ImportKeyOptions): KeyIdentifier {
    return this.kms.importKey(kp, options);
  }

  /**
   * Export a Schnorr keypair from the KMS.
   * Only supported when the backing KMS is the built-in {@link Kms} class.
   * @throws {Error} If the backing KMS does not support key export.
   */
  export(id: KeyIdentifier): SchnorrKeyPair {
    if (!(this.kms instanceof Kms)) {
      throw new Error(
        'Key export is not supported by the current KeyManager implementation. '
        + 'Export is only available with the built-in Kms class.'
      );
    }
    return this.kms.exportKey(id);
  }

  /** List all managed key identifiers. */
  listKeys(): KeyIdentifier[] {
    return this.kms.listKeys();
  }

  /** Remove a key from the KMS. */
  removeKey(id: KeyIdentifier, options: { force?: boolean } = {}): void {
    return this.kms.removeKey(id, options);
  }

  /**
   * Sign data via the KMS.
   * @param data The data to sign (must be non-empty).
   * @param id Optional key identifier; uses the active key if omitted.
   * @param options Signing options (scheme defaults to 'schnorr').
   */
  sign(data: Bytes, id?: KeyIdentifier, options?: SignOptions): SignatureBytes {
    assertBytes(data, 'data');
    return this.kms.sign(data, id, options);
  }

  /** Verify a signature via the KMS. */
  verify(signature: SignatureBytes, data: Bytes, id?: KeyIdentifier, options?: SignOptions): boolean {
    return this.kms.verify(signature, data, id, options);
  }

  /** Compute a SHA-256 digest. */
  digest(data: Uint8Array): HashBytes {
    return this.kms.digest(data);
  }
}

// ---------------------------------------------------------------------------
// DID sub-facade
// ---------------------------------------------------------------------------

/**
 * DID identifier operations sub-facade (encode, decode, generate, parse).
 * @public
 */
export class DidApi {
  /**
   * Encode a DID from genesis bytes and options.
   * @param genesisBytes The genesis document bytes.
   * @param options The creation options.
   * @returns The encoded DID string.
   */
  encode(genesisBytes: DocumentBytes, options: DidCreateOptions): string {
    assertBytes(genesisBytes, 'genesisBytes');
    return Identifier.encode(genesisBytes, options);
  }

  /**
   * Decode a DID into its components.
   * @param did The DID string to decode.
   * @returns The decoded identifier components.
   */
  decode(did: string): IdentifierComponents {
    assertString(did, 'did');
    return Identifier.decode(did);
  }

  /**
   * Generate a new DID along with its keypair.
   *
   * When no `network` is given, defaults to `'regtest'` (upstream default).
   * Pass an explicit network to generate DIDs for other networks.
   *
   * @param network Optional network to generate the DID for.
   * @returns The generated keypair and DID string.
   */
  generate(network?: NetworkName): { keyPair: SchnorrKeyPairObject; did: string } {
    if (!network) return Identifier.generate();
    const kp = SchnorrKeyPair.generate();
    const did = Identifier.encode(kp.publicKey.compressed, {
      idType : IdentifierTypes.KEY,
      network,
    });
    return { keyPair: kp.exportJSON(), did };
  }

  /**
   * Check if a DID string is valid.
   * @param did The DID string to validate.
   * @returns `true` if valid, `false` otherwise.
   */
  isValid(did: string): boolean {
    if (typeof did !== 'string' || did.length === 0) return false;
    return Identifier.isValid(did);
  }

  /**
   * Parse a DID string into a Did instance.
   * @param did The DID string to parse.
   * @returns The parsed Did instance, or `null` if parsing failed.
   */
  parse(did: string): Did | null {
    if (typeof did !== 'string' || did.length === 0) return null;
    return Did.parse(did);
  }
}

// ---------------------------------------------------------------------------
// DID Method sub-facade
// ---------------------------------------------------------------------------

/**
 * DID method operations sub-facade: create, resolve, update, deactivate.
 *
 * Lazily initialized by {@link DidBtcr2Api} because it depends on
 * {@link BitcoinApi} which requires network configuration.
 * @public
 */
export class DidMethodApi {
  #btc?: BitcoinApi;
  #log: Logger;

  constructor(btc?: BitcoinApi, logger?: Logger) {
    this.#btc = btc;
    this.#log = logger ?? NOOP_LOGGER;
  }

  /**
   * Create a deterministic (k1) DID from a public key.
   * Sets idType to KEY automatically.
   * @param genesisBytes The compressed public key bytes (33 bytes).
   * @param options Creation options (idType is set for you).
   * @returns The created DID identifier string.
   */
  createDeterministic(genesisBytes: KeyBytes, options: Omit<DidCreateOptions, 'idType'> = {}): string {
    assertCompressedPubkey(genesisBytes, 'genesisBytes');
    return DidBtcr2.create(genesisBytes, { ...options, idType: IdentifierTypes.KEY });
  }

  /**
   * Create a non-deterministic (x1) DID from external genesis document bytes.
   * Sets idType to EXTERNAL automatically.
   * @param genesisBytes The genesis document bytes.
   * @param options Creation options (idType is set for you).
   * @returns The created DID identifier string.
   */
  createExternal(genesisBytes: DocumentBytes, options: Omit<DidCreateOptions, 'idType'> = {}): string {
    assertBytes(genesisBytes, 'genesisBytes');
    return DidBtcr2.create(genesisBytes, { ...options, idType: IdentifierTypes.EXTERNAL });
  }

  /**
   * Resolve a DID. If a Bitcoin connection is configured on the API, it is
   * injected automatically as the driver — unless the caller explicitly
   * provides `drivers.bitcoin` (even as `undefined`) in the options.
   * @param did The DID to resolve.
   * @param options Resolution options.
   * @returns The resolution result.
   */
  async resolve(did: string, options?: ResolutionOptions): Promise<DidResolutionResult> {
    assertString(did, 'did');
    const opts: ResolutionOptions = { ...options };
    // Only inject the configured connection when the caller did not
    // explicitly provide the `bitcoin` driver key at all.
    const hasExplicitDriver = options?.drivers !== undefined
      && Object.prototype.hasOwnProperty.call(options.drivers, 'bitcoin');
    if (!hasExplicitDriver && this.#btc) {
      opts.drivers = { ...opts.drivers, bitcoin: this.#btc.connection };
    }
    this.#log.debug('Resolving DID', did);
    try {
      return await DidBtcr2.resolve(did, opts);
    } catch (err) {
      this.#log.error('DID resolution failed', did, err);
      throw new Error(
        `Failed to resolve DID: ${did}`,
        { cause: err }
      );
    }
  }

  /**
   * Update an existing DID document. If a Bitcoin connection is configured on
   * the API, it is injected automatically.
   * @param params The update parameters.
   * @returns The signed update.
   */
  async update({
    sourceDocument,
    patches,
    sourceVersionId,
    verificationMethodId,
    beaconId,
    signingMaterial,
    bitcoin,
  }: {
    sourceDocument: Btcr2DidDocument;
    patches: PatchOperation[];
    sourceVersionId: number;
    verificationMethodId: string;
    beaconId: string;
    signingMaterial?: KeyBytes | HexString;
    bitcoin?: BitcoinConnection;
  }): Promise<SignedBTCR2Update> {
    const btcConnection = bitcoin ?? this.#btc?.connection ?? undefined;
    return await DidBtcr2.update({
      sourceDocument,
      patches,
      sourceVersionId,
      verificationMethodId,
      beaconId,
      signingMaterial,
      bitcoin : btcConnection,
    });
  }

  /**
   * Get the signing method from a DID document by method ID.
   * @param didDocument The DID document.
   * @param methodId The method ID (if omitted, the first signing method is returned).
   * @returns The found signing method.
   */
  getSigningMethod(didDocument: Btcr2DidDocument, methodId?: string): DidVerificationMethod {
    return DidBtcr2.getSigningMethod(didDocument, methodId);
  }

  /**
   * Create a fluent builder for a DID update operation.
   * @param sourceDocument The current DID document to update.
   * @returns An {@link UpdateBuilder} for chaining update parameters.
   *
   * @example
   * ```ts
   * const signed = await api.btcr2
   *   .buildUpdate(currentDoc)
   *   .patch({ op: 'add', path: '/service/1', value: newService })
   *   .version(2)
   *   .signer('#initialKey')
   *   .beacon('#beacon-0')
   *   .execute();
   * ```
   */
  buildUpdate(sourceDocument: Btcr2DidDocument): UpdateBuilder {
    return new UpdateBuilder(this, sourceDocument);
  }

  /** Deactivate a DID (not yet implemented in the core method). */
  async deactivate(): Promise<SignedBTCR2Update> {
    throw new NotImplementedError(
      'DidMethodApi.deactivate is not implemented yet.',
      {
        type : 'DID_API_METHOD_NOT_IMPLEMENTED',
        name : 'NOT_IMPLEMENTED_ERROR'
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Update builder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for DID update operations. Reduces the cognitive load of
 * the 7-parameter `update()` call by letting callers chain named steps.
 *
 * Created via {@link DidMethodApi.buildUpdate}.
 * @public
 */
export class UpdateBuilder {
  #methodApi: DidMethodApi;
  #sourceDocument: Btcr2DidDocument;
  #patches: PatchOperation[] = [];
  #sourceVersionId?: number;
  #verificationMethodId?: string;
  #beaconId?: string;
  #signingMaterial?: KeyBytes | HexString;
  #bitcoin?: BitcoinConnection;

  /** @internal */
  constructor(methodApi: DidMethodApi, sourceDocument: Btcr2DidDocument) {
    this.#methodApi = methodApi;
    this.#sourceDocument = sourceDocument;
  }

  /** Add a single JSON Patch operation. Can be called multiple times. */
  patch(op: PatchOperation): this {
    this.#patches.push(op);
    return this;
  }

  /** Set all patches at once (replaces any previously added). */
  patches(ops: PatchOperation[]): this {
    this.#patches = [...ops];
    return this;
  }

  /** Set the source version ID. */
  version(id: number): this {
    this.#sourceVersionId = id;
    return this;
  }

  /** Set the verification method ID used for signing. */
  signer(methodId: string): this {
    this.#verificationMethodId = methodId;
    return this;
  }

  /** Set the beacon ID for the update announcement. */
  beacon(beaconId: string): this {
    this.#beaconId = beaconId;
    return this;
  }

  /** Set the signing material (secret key bytes or hex). */
  signingMaterial(material: KeyBytes | HexString): this {
    this.#signingMaterial = material;
    return this;
  }

  /** Override the Bitcoin connection for this update. */
  withBitcoin(connection: BitcoinConnection): this {
    this.#bitcoin = connection;
    return this;
  }

  /**
   * Execute the update.
   * @throws {Error} If required fields (version, signer, beacon) are missing.
   */
  async execute(): Promise<SignedBTCR2Update> {
    if (this.#sourceVersionId === undefined) {
      throw new Error('UpdateBuilder: sourceVersionId is required. Call .version(id) before .execute().');
    }
    if (!this.#verificationMethodId) {
      throw new Error('UpdateBuilder: verificationMethodId is required. Call .signer(id) before .execute().');
    }
    if (!this.#beaconId) {
      throw new Error('UpdateBuilder: beaconId is required. Call .beacon(id) before .execute().');
    }

    return this.#methodApi.update({
      sourceDocument       : this.#sourceDocument,
      patches              : this.#patches,
      sourceVersionId      : this.#sourceVersionId,
      verificationMethodId : this.#verificationMethodId,
      beaconId             : this.#beaconId,
      signingMaterial      : this.#signingMaterial,
      bitcoin              : this.#bitcoin,
    });
  }
}

// ---------------------------------------------------------------------------
// Main facade
// ---------------------------------------------------------------------------

/**
 * Main DidBtcr2Api facade — the primary entry point for the SDK.
 *
 * Exposes sub-facades for Bitcoin, DID Method, KeyPair, Crypto, and
 * KeyManager operations. Created via the {@link createApi} factory.
 * @public
 */
export class DidBtcr2Api {
  /** Cryptographic operations (keypair, multikey, cryptosuite, proof). */
  readonly crypto: CryptoApi;
  /** DID identifier operations (encode, decode, generate, parse). */
  readonly did: DidApi;
  /** Key management operations. */
  readonly kms: KeyManagerApi;

  #btcConfig?: BitcoinApiConfig;
  #btc?: BitcoinApi;
  #btcr2?: DidMethodApi;
  #log: Logger;
  #disposed = false;

  constructor(config?: ApiConfig) {
    this.#btcConfig = config?.btc;
    this.#log = config?.logger ?? NOOP_LOGGER;
    this.kms = new KeyManagerApi(config?.kms);
    this.did = new DidApi();
    this.crypto = new CryptoApi();
  }

  /**
   * Bitcoin API sub-facade (lazily initialized).
   * Only available when `btc` config was provided to the constructor.
   * @throws {Error} If the instance has been disposed or no Bitcoin config was provided.
   */
  get btc(): BitcoinApi {
    this.#assertNotDisposed();
    if (!this.#btc) {
      if (!this.#btcConfig) {
        throw new Error(
          'Bitcoin not configured. Pass a btc config to createApi(), e.g.: '
          + 'createApi({ btc: { network: \'regtest\' } })'
        );
      }
      this.#btc = new BitcoinApi(this.#btcConfig);
    }
    return this.#btc;
  }

  /**
   * DID Method API sub-facade (lazily initialized with bitcoin wiring).
   * @throws {Error} If the instance has been disposed.
   */
  get btcr2(): DidMethodApi {
    this.#assertNotDisposed();
    if (!this.#btcr2) {
      this.#btcr2 = new DidMethodApi(
        this.#btcConfig ? this.btc : undefined,
        this.#log
      );
    }
    return this.#btcr2;
  }

  /**
   * Whether this API instance has been disposed.
   */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Create a DID using either deterministic (KEY) or external (EXTERNAL) mode.
   * @param type The creation mode.
   * @param genesisBytes Public key bytes (deterministic) or document bytes (external).
   * @param options Creation options (idType is set for you).
   * @returns The created DID identifier string.
   */
  createDid(
    type: 'deterministic' | 'external',
    genesisBytes: KeyBytes | DocumentBytes,
    options?: Omit<DidCreateOptions, 'idType'>
  ): string {
    this.#assertNotDisposed();
    return type === 'deterministic'
      ? this.btcr2.createDeterministic(genesisBytes as KeyBytes, options)
      : this.btcr2.createExternal(genesisBytes as DocumentBytes, options);
  }

  /**
   * Generate a new DID, create the keypair, and import it into the KMS.
   * @param options Optional settings.
   * @param options.setActive Whether to set the imported key as active in the KMS (default `true`).
   * @param options.network Network for the generated DID (default `'regtest'`).
   * @returns The generated DID string and KMS key identifier.
   */
  generateDid(options?: { setActive?: boolean; network?: NetworkName }): { did: string; keyId: KeyIdentifier } {
    this.#assertNotDisposed();
    const { keyPair, did } = this.did.generate(options?.network);
    const kp = SchnorrKeyPair.fromJSON(keyPair);
    const keyId = this.kms.import(kp, { setActive: options?.setActive ?? true });
    return { did, keyId };
  }

  /**
   * Resolve a DID, automatically injecting the configured Bitcoin connection.
   * @param did The DID to resolve.
   * @param options Optional resolution options.
   * @returns The resolution result.
   */
  async resolveDid(did: string, options?: ResolutionOptions): Promise<DidResolutionResult> {
    this.#assertNotDisposed();
    return await this.btcr2.resolve(did, options);
  }

  /**
   * Resolve a DID and return a discriminated result instead of throwing.
   * Useful when resolution failure is an expected outcome (e.g. checking
   * whether a DID exists before creating it).
   * @param did The DID to resolve.
   * @param options Optional resolution options.
   * @returns A {@link ResolutionResult} with `ok: true` on success or
   *          `ok: false` with error details on failure.
   */
  async tryResolveDid(did: string, options?: ResolutionOptions): Promise<ResolutionResult> {
    this.#assertNotDisposed();
    assertString(did, 'did');
    try {
      const raw = await this.btcr2.resolve(did, options);
      if (raw.didDocument) {
        return {
          ok       : true,
          document : raw.didDocument as Btcr2DidDocument,
          metadata : raw.didDocumentMetadata,
          raw,
        };
      }
      return {
        ok           : false,
        error        : raw.didResolutionMetadata?.error ?? 'unknown',
        errorMessage : raw.didResolutionMetadata?.errorMessage as string | undefined,
        raw,
      };
    } catch (err: any) {
      return {
        ok           : false,
        error        : 'internalError',
        errorMessage : err.message,
        raw          : {
          didDocument            : null,
          didDocumentMetadata    : {},
          didResolutionMetadata  : { error: 'internalError', errorMessage: err.message },
        } as unknown as DidResolutionResult,
      };
    }
  }

  /**
   * Update a DID document: resolve the current state, apply patches, sign, and announce.
   * Automatically injects the configured Bitcoin connection.
   *
   * If `sourceDocument` and `sourceVersionId` are both provided, resolution
   * is skipped. Otherwise the DID is resolved first to obtain them.
   * @param params The update parameters.
   * @returns The signed update.
   */
  async updateDid({
    did,
    patches,
    verificationMethodId,
    beaconId,
    sourceDocument,
    sourceVersionId,
  }: {
    did: string;
    patches: PatchOperation[];
    verificationMethodId: string;
    beaconId: string;
    sourceDocument?: Btcr2DidDocument;
    sourceVersionId?: number;
  }): Promise<SignedBTCR2Update> {
    this.#assertNotDisposed();
    assertString(did, 'did');

    let doc = sourceDocument;
    let versionId = sourceVersionId;

    if (!doc || versionId === undefined) {
      const resolution = await this.resolveDid(did);
      if (!resolution.didDocument) {
        const meta = resolution.didResolutionMetadata;
        const detail = meta?.error ? `: ${meta.error}` : '.';
        const extra = meta?.errorMessage ? ` ${meta.errorMessage}` : '';
        throw new Error(
          `Failed to resolve DID ${did} for update${detail}${extra}`,
          { cause: meta }
        );
      }
      doc = doc ?? resolution.didDocument as Btcr2DidDocument;

      if (versionId === undefined) {
        const rawVersionId = resolution.didDocumentMetadata?.versionId;
        if (rawVersionId === undefined || rawVersionId === null) {
          throw new Error(
            `Resolution of DID ${did} succeeded but returned no versionId in metadata. `
            + 'Provide sourceVersionId explicitly.'
          );
        }
        const parsed = Number(rawVersionId);
        if (!Number.isFinite(parsed)) {
          throw new Error(
            `Resolution of DID ${did} returned a non-numeric versionId: ${String(rawVersionId)}.`
          );
        }
        versionId = parsed;
      }
    }

    return await this.btcr2.update({
      sourceDocument    : doc,
      patches,
      sourceVersionId   : versionId,
      verificationMethodId,
      beaconId,
    });
  }

  /**
   * Release internal references. After disposal, accessing `btc`, `btcr2`,
   * or calling top-level methods will throw.
   *
   * Note: the underlying {@link BitcoinConnection} does not hold persistent
   * connections, so this is primarily a guard against accidental reuse.
   */
  dispose(): void {
    this.#btc = undefined;
    this.#btcr2 = undefined;
    this.#btcConfig = undefined;
    this.#disposed = true;
  }

  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new Error('This DidBtcr2Api instance has been disposed and can no longer be used.');
    }
  }
}

/**
 * Create a new {@link DidBtcr2Api} instance with the given configuration.
 * @param config Optional configuration for the API.
 * @returns The created DidBtcr2Api instance.
 * @public
 */
export function createApi(config?: ApiConfig): DidBtcr2Api {
  return new DidBtcr2Api(config);
}
