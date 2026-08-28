import type { NetworkName } from '@did-btcr2/bitcoin';
import type { DocumentBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import { INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/common';
import type { Signer } from '@did-btcr2/keypair';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { KeyIdentifier } from '@did-btcr2/key-manager';
import type { BroadcastOptions, Btcr2DidDocument, DidCreateOptions, ResolutionOptions } from '@did-btcr2/method';
import type { DidResolutionResult } from '@web5/dids';
import { BitcoinApi } from './bitcoin.js';
import { CasApi, DEFAULT_CAS_GATEWAY, type CasConfig } from './cas.js';
import { CryptoApi } from './crypto.js';
import { DidApi } from './did.js';
import { assertString, NOOP_LOGGER, rootCauseMessage } from './helpers.js';
import { KeyManagerApi } from './key-manager.js';
import { DidMethodApi, type DidUpdateResult, type PublishToCasMode } from './method.js';
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
    } catch (err) {
      const errorMessage = rootCauseMessage(err);
      return {
        ok           : false,
        error        : 'internalError',
        errorMessage,
        cause        : err,
        raw          : {
          didDocument            : null,
          didDocumentMetadata    : {},
          didResolutionMetadata  : { error: 'internalError', errorMessage },
        } as unknown as DidResolutionResult,
      };
    }
  }

  /**
   * Update a DID document: resolve the current state, apply patches, sign, and announce.
   * Automatically injects the configured Bitcoin connection.
   *
   * The facade accepts the source pair, `sourceDocument` and
   * `sourceVersionId`, together or not at all. If you supply both, the
   * facade skips resolution, ignores `resolutionOptions`, and requires
   * `sourceDocument.id` to equal `did`. If you supply one without the other,
   * the facade refuses the call before any resolution. A document from one
   * source and a version number from another describe a state that no
   * resolver holds. If you supply neither, the facade resolves the DID first
   * to obtain both.
   *
   * In that case `resolutionOptions` passes through to the resolution.
   * Supply sidecar data there if no party published the DID's prior updates
   * to a CAS. Without it, the source state past version 1 is
   * unreachable and the update fails. Leave `versionId`/`versionTime` unset;
   * an update built on a historical version can never be applied.
   *
   * A deactivated source document, whether supplied or resolved, is refused
   * before signing: resolution halts at the deactivation, so no later update
   * is ever applied.
   *
   * The caller can omit `verificationMethodId` and `beaconId`. The method
   * facade then derives them. The verification method is the one that
   * publishes the signer's key. The beacon is the one that holds the only
   * spendable UTXO. If none or several match, the method facade refuses the
   * update and names the candidates. See {@link DidMethodApi.update}.
   * @param params The update parameters. `publishToCas` (default `'never'`)
   *   controls whether update artifacts are published to the configured CAS
   *   before the on-chain broadcast; publication is opt-in and never required.
   *   `broadcastOptions` passes fee estimator / change address through to the
   *   beacon transaction.
   * @returns The broadcast artifacts: signed update, signal txid, per-beacon-type
   *   sidecar data, and which artifacts were published to CAS.
   */
  async updateDid({
    did,
    patches,
    verificationMethodId,
    beaconId,
    signer,
    sourceDocument,
    sourceVersionId,
    resolutionOptions,
    publishToCas,
    broadcastOptions,
  }: {
    did: string;
    patches: PatchOperation[];
    verificationMethodId?: string;
    beaconId?: string;
    signer: Signer;
    sourceDocument?: Btcr2DidDocument;
    sourceVersionId?: number;
    resolutionOptions?: ResolutionOptions;
    publishToCas?: PublishToCasMode;
    broadcastOptions?: BroadcastOptions;
  }): Promise<DidUpdateResult> {
    this.#assertNotDisposed();
    assertString(did, 'did');

    const { doc, versionId } = await this.#resolveUpdateSource(did, sourceDocument, sourceVersionId, resolutionOptions);

    return await this.btcr2.update({
      sourceDocument    : doc,
      patches,
      sourceVersionId   : versionId,
      verificationMethodId,
      beaconId,
      signer,
      publishToCas,
      broadcastOptions,
    });
  }

  /**
   * Deactivate a DID permanently: resolve the current state (unless
   * `sourceDocument` and `sourceVersionId` are provided), sign an update
   * carrying the deactivation patch, and announce it. Automatically injects
   * the configured Bitcoin connection.
   *
   * Deactivation is irreversible; an already-deactivated document is refused.
   * The source pair and `resolutionOptions` follow the rules of
   * {@link DidBtcr2Api.updateDid}. Supply both fields or neither. A supplied
   * document must describe `did`.
   * The caller can omit `verificationMethodId` and `beaconId`, as in
   * {@link DidBtcr2Api.updateDid}.
   * @param params The deactivation parameters: {@link DidBtcr2Api.updateDid}'s
   *   minus `patches` (the deactivation patch is supplied for you).
   * @returns The broadcast artifacts, exactly as {@link DidBtcr2Api.updateDid}.
   */
  async deactivateDid({
    did,
    verificationMethodId,
    beaconId,
    signer,
    sourceDocument,
    sourceVersionId,
    resolutionOptions,
    publishToCas,
    broadcastOptions,
  }: {
    did: string;
    verificationMethodId?: string;
    beaconId?: string;
    signer: Signer;
    sourceDocument?: Btcr2DidDocument;
    sourceVersionId?: number;
    resolutionOptions?: ResolutionOptions;
    publishToCas?: PublishToCasMode;
    broadcastOptions?: BroadcastOptions;
  }): Promise<DidUpdateResult> {
    this.#assertNotDisposed();
    assertString(did, 'did');

    const { doc, versionId } = await this.#resolveUpdateSource(did, sourceDocument, sourceVersionId, resolutionOptions);

    return await this.btcr2.deactivate({
      sourceDocument    : doc,
      sourceVersionId   : versionId,
      verificationMethodId,
      beaconId,
      signer,
      publishToCas,
      broadcastOptions,
    });
  }

  /**
   * Obtain the source document and version for a write operation. If the
   * caller supplies the pair whole, the helper returns it after it confirms
   * that the document's id is `did`. If the caller supplies neither, the
   * helper resolves the DID with the caller's resolution options and takes
   * both values from the resolution. The helper refuses a half-supplied pair
   * before any resolution. {@link DidBtcr2Api.updateDid} and
   * {@link DidBtcr2Api.deactivateDid} share this helper.
   */
  async #resolveUpdateSource(
    did: string,
    sourceDocument?: Btcr2DidDocument,
    sourceVersionId?: number,
    resolutionOptions?: ResolutionOptions,
  ): Promise<{ doc: Btcr2DidDocument; versionId: number }> {
    if ((sourceDocument == null) !== (sourceVersionId == null)) {
      throw new UpdateError(
        `Provide both sourceDocument and sourceVersionId for DID ${did}, or neither. `
        + 'A document from one source and a version number from another describe a state '
        + 'no resolver holds. A resolver rejects an update built on that state.',
        INVALID_DID_UPDATE,
        { did }
      );
    }

    if (sourceDocument != null && sourceVersionId != null) {
      if (sourceDocument.id !== did) {
        throw new UpdateError(
          `sourceDocument.id ${sourceDocument.id} does not match the DID under update, ${did}.`,
          INVALID_DID_UPDATE,
          { did, sourceDocumentId: sourceDocument.id }
        );
      }
      return { doc: sourceDocument, versionId: sourceVersionId };
    }

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
        + 'Provide sourceDocument and sourceVersionId explicitly.'
      );
    }
    const versionId = Number(rawVersionId);
    if (!Number.isFinite(versionId)) {
      throw new Error(
        `Resolution of DID ${did} returned a non-numeric versionId: ${String(rawVersionId)}.`
      );
    }

    return { doc: resolution.didDocument as Btcr2DidDocument, versionId };
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
