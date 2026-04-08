import type { NetworkName } from '@did-btcr2/bitcoin';
import type { DocumentBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { KeyIdentifier } from '@did-btcr2/kms';
import type { Btcr2DidDocument, DidCreateOptions, ResolutionOptions } from '@did-btcr2/method';
import type { DidResolutionResult } from '@web5/dids';
import { BitcoinApi } from './bitcoin.js';
import { CasApi, type CasConfig } from './cas.js';
import { CryptoApi } from './crypto.js';
import { DidApi } from './did.js';
import { assertString, NOOP_LOGGER } from './helpers.js';
import { KeyManagerApi } from './kms.js';
import { DidMethodApi } from './method.js';
import type { ApiConfig, BitcoinApiConfig, Logger, ResolutionResult } from './types.js';

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
  #casConfig?: CasConfig;
  #cas?: CasApi;
  #btcr2?: DidMethodApi;
  #log: Logger;
  #disposed = false;

  constructor(config?: ApiConfig) {
    this.#btcConfig = config?.btc;
    this.#casConfig = config?.cas;
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
   * CAS API sub-facade (lazily initialized).
   * Only available when `cas` config was provided to the constructor.
   * @throws {Error} If the instance has been disposed or no CAS config was provided.
   */
  get cas(): CasApi {
    this.#assertNotDisposed();
    if (!this.#cas) {
      if (!this.#casConfig) {
        throw new Error(
          'CAS not configured. Pass a cas config to createApi(), e.g.: '
          + 'createApi({ cas: { helia: await createHelia() } })'
        );
      }
      this.#cas = new CasApi(this.#casConfig);
    }
    return this.#cas;
  }

  /**
   * DID Method API sub-facade (lazily initialized with bitcoin + CAS wiring).
   * @throws {Error} If the instance has been disposed.
   */
  get btcr2(): DidMethodApi {
    this.#assertNotDisposed();
    if (!this.#btcr2) {
      this.#btcr2 = new DidMethodApi(
        this.#btcConfig ? this.btc : undefined,
        this.#casConfig ? this.cas : undefined,
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
   * Note: the underlying `BitcoinConnection` does not hold persistent
   * connections, so this is primarily a guard against accidental reuse.
   */
  dispose(): void {
    this.#btc = undefined;
    this.#cas = undefined;
    this.#btcr2 = undefined;
    this.#btcConfig = undefined;
    this.#casConfig = undefined;
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
