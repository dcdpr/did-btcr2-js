import type { NetworkName } from '@did-btcr2/bitcoin';
import type { DocumentBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import { INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/common';
import type { Signer } from '@did-btcr2/keypair';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { KeyIdentifier } from '@did-btcr2/key-manager';
import type { Btcr2DidDocument, DidCreateOptions, ResolutionOptions } from '@did-btcr2/method';
import type { DidResolutionResult } from '@web5/dids';
import { BitcoinApi } from './bitcoin.js';
import { CasApi, DEFAULT_CAS_GATEWAY, type CasConfig } from './cas.js';
import { CryptoApi } from './crypto.js';
import { DidApi } from './did.js';
import { assertString, NOOP_LOGGER, resolutionErrorCode, rootCauseMessage } from './helpers.js';
import { KeyManagerApi } from './key-manager.js';
import { DidMethodApi, type DidUpdateOptions, type DidUpdateResult, type SourceState, type UpdateSource } from './method.js';
import type { ApiConfig, BitcoinApiConfig, Logger, ResolutionResult } from './types.js';

/**
 * Main DidBtcr2Api facade: the primary entry point for the SDK.
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
   *
   * When no `cas` config was provided to the constructor, defaults to a
   * read-only {@link HttpGatewayCasExecutor} backed by the public IPFS
   * gateway (`https://ipfs.io`). Override via `createApi({ cas: { ... } })`.
   * @throws {Error} If the instance has been disposed.
   */
  get cas(): CasApi {
    this.#assertNotDisposed();
    if (!this.#cas) {
      this.#cas = new CasApi(this.#casConfig ?? { gateway: DEFAULT_CAS_GATEWAY });
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
        this.cas,
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
   *
   * When `options.network` is omitted, the DID is minted for the network of the
   * configured Bitcoin connection, else for {@link DidMethodApi.FALLBACK_NETWORK}
   * (regtest). It is never minted for mainnet by omission.
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
   * @param options.network Network for the generated DID. Defaults to the network
   *   of the configured Bitcoin connection, else {@link DidMethodApi.FALLBACK_NETWORK}
   *   (regtest): the same fallback every creation path on this facade shares.
   * @returns The generated DID string and KMS key identifier.
   */
  generateDid(options?: { setActive?: boolean; network?: NetworkName }): { did: string; keyId: KeyIdentifier } {
    this.#assertNotDisposed();
    // Read the config rather than `this.btc.network`: touching the getter would
    // force the lazy BitcoinApi into existence just to read a string, and would
    // throw outright when no Bitcoin connection was configured.
    const { keyPair, did } = this.did.generate(
      options?.network ?? this.#btcConfig?.network ?? DidMethodApi.FALLBACK_NETWORK
    );
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
   *          `ok: false` with error details on failure. `error` is the DID
   *          Resolution error code of the nearest typed failure in the cause
   *          chain (for example `NOT_FOUND`, `INVALID_DID`, `MISSING_UPDATE_DATA`),
   *          else `INTERNAL_ERROR`.
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
    } catch (err) {
      const errorMessage = rootCauseMessage(err);
      const error = resolutionErrorCode(err);
      return {
        ok           : false,
        error,
        errorMessage,
        cause        : err,
        raw          : {
          didDocument            : null,
          didDocumentMetadata    : {},
          didResolutionMetadata  : { error, errorMessage },
        } as unknown as DidResolutionResult,
      };
    }
  }

  /**
   * Update a DID document. The arguments follow the update operation of the
   * specification: the source, the JSON Patch document, and the signer.
   * `options.verificationMethodId` is the fourth input of the specification;
   * `options.announce` configures the announcement.
   *
   * The source is a DID or a resolved state. If it is a DID, the facade
   * resolves the DID first, with `options.resolutionOptions`, to get the
   * source document and its `versionId`. Supply sidecar data there if no
   * party published the prior updates of the DID to a CAS. Without it, the
   * source state past version 1 is unreachable and the update fails. If the
   * source is a {@link SourceState}, the facade does not resolve and ignores
   * `resolutionOptions`. The `versionId` of the state must come from the
   * resolution that returned its document.
   *
   * A deactivated source document is refused before signing: resolution
   * halts at the deactivation, so no later update is ever applied.
   *
   * The caller can omit `verificationMethodId` and `announce.beaconId`. The
   * method facade then derives them. The verification method is the one that
   * publishes the signer's key. The beacon is the one that holds the only
   * spendable UTXO. If none or several match, the method facade refuses the
   * update and names the candidates. See {@link DidMethodApi.update}.
   * @param source The DID, or a resolved {@link SourceState}.
   * @param patch The JSON Patch document: the operations that change the source document.
   * @param signer The signer of the update proof, with the key of the verification method.
   * @param options The verification method id, the resolution options, and
   *   the announcement options (beacon, beacon input signer, fee, change
   *   address, and the CAS publication policy, default `'never'`).
   * @returns The broadcast artifacts: signed update, signal txid, per-beacon-type
   *   sidecar data, and which artifacts were published to CAS.
   */
  async updateDid(
    source: UpdateSource,
    patch: PatchOperation[],
    signer: Signer,
    options: DidUpdateOptions = {},
  ): Promise<DidUpdateResult> {
    this.#assertNotDisposed();
    const { resolutionOptions, ...updateOptions } = options;
    const state = await this.#resolveUpdateSource(source, resolutionOptions);
    return await this.btcr2.update(state, patch, signer, updateOptions);
  }

  /**
   * Deactivate a DID permanently: sign an update that carries the
   * deactivation patch, and announce it. The arguments follow the deactivate
   * operation of the specification: the source and the signer.
   *
   * Deactivation is irreversible; an already-deactivated document is refused.
   * The source and the options follow the rules of
   * {@link DidBtcr2Api.updateDid}.
   * @param source The DID, or a resolved {@link SourceState}.
   * @param signer The signer of the update proof, with the key of the verification method.
   * @param options The options of {@link DidBtcr2Api.updateDid}.
   * @returns The broadcast artifacts, exactly as {@link DidBtcr2Api.updateDid}.
   */
  async deactivateDid(
    source: UpdateSource,
    signer: Signer,
    options: DidUpdateOptions = {},
  ): Promise<DidUpdateResult> {
    this.#assertNotDisposed();
    const { resolutionOptions, ...updateOptions } = options;
    const state = await this.#resolveUpdateSource(source, resolutionOptions);
    return await this.btcr2.deactivate(state, signer, updateOptions);
  }

  /**
   * Get the source state of a write operation. If the source is a DID, the
   * helper resolves it with the caller's resolution options and takes the
   * document and its `versionId` from the resolution. If the source is a
   * state, the helper returns it. {@link DidBtcr2Api.updateDid} and
   * {@link DidBtcr2Api.deactivateDid} share this helper.
   */
  async #resolveUpdateSource(
    source: UpdateSource,
    resolutionOptions?: ResolutionOptions,
  ): Promise<SourceState> {
    if (typeof source !== 'string') {
      if (source == null || typeof source !== 'object') {
        throw new UpdateError(
          'The update source must be a DID or a resolved state { document, versionId }.',
          INVALID_DID_UPDATE,
          { source }
        );
      }
      return source;
    }

    const did = source;
    assertString(did, 'source');
    const resolution = await this.resolveDid(did, resolutionOptions);
    if (!resolution.didDocument) {
      const meta = resolution.didResolutionMetadata;
      const detail = meta?.error ? `: ${meta.error}` : '.';
      const extra = meta?.errorMessage ? ` ${meta.errorMessage}` : '';
      throw new Error(
        `Failed to resolve DID ${did} for update${detail}${extra}`,
        { cause: meta }
      );
    }

    const rawVersionId = resolution.didDocumentMetadata?.versionId;
    if (rawVersionId === undefined || rawVersionId === null) {
      throw new Error(
        `Resolution of DID ${did} succeeded but returned no versionId in metadata. `
        + 'Pass a resolved state { document, versionId } as the source.'
      );
    }
    const versionId = Number(rawVersionId);
    if (!Number.isFinite(versionId)) {
      throw new Error(
        `Resolution of DID ${did} returned a non-numeric versionId: ${String(rawVersionId)}.`
      );
    }

    return { document: resolution.didDocument as Btcr2DidDocument, versionId };
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
