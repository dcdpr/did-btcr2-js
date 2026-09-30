import type { BitcoinConnection, NetworkName } from '@did-btcr2/bitcoin';
import { StaticFeeEstimator } from '@did-btcr2/bitcoin';
import type { DocumentBytes, HashBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import { canonicalHash, decode as decodeHash, IdentifierHrp, IdentifierTypes, INVALID_DID_UPDATE, JSONPatch, MISSING_UPDATE_DATA, NOT_FOUND, ResolveError, UpdateError } from '@did-btcr2/common';
import type { Signer } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import type { BeaconFunding, BeaconService, BroadcastOptions, BroadcastResult, Btcr2DidDocument, CASAnnouncement, CASBroadcastOptions, DidCreateOptions, DidDocument, NeedCASAnnouncement, NeedGenesisDocument, NeedSignedUpdate, ResolutionOptions, RootCapability, SignedBTCR2Update, SMTProof, UnsignedBTCR2Update } from '@did-btcr2/method';
import { Appendix, BeaconError, BeaconFactory, BeaconSignalDiscovery, BeaconUtils, DEACTIVATION_PATCH, DidBtcr2, GenesisDocument, Identifier, Resolver, selectBeaconFunding, Updater } from '@did-btcr2/method';
import type { DidResolutionResult, DidVerificationMethod } from '@web5/dids';
import type { BitcoinApi } from './bitcoin.js';
import type { CasApi } from './cas.js';
import type { GenesisDocumentSpec } from './genesis.js';
import { assertGenesisDocument, buildGenesisDocument } from './genesis.js';
import { assertBytes, assertCompressedPubkey, assertString, NOOP_LOGGER, rootCauseMessage } from './helpers.js';
import type { Logger } from './types.js';

/**
 * Result of {@link DidMethodApi.createExternalFromDocument}: the EXTERNAL
 * identifier, the genesis bytes it encodes, and the initial DID document.
 * @public
 */
export interface ExternalCreateResult {
  /** The EXTERNAL (`x`) identifier. */
  did: string;
  /** The SHA-256 hash of the canonical genesis document: the genesis bytes of `did`. */
  genesisBytes: HashBytes;
  /**
   * The initial DID document: the genesis document with `did` in place of the
   * placeholder id. Pass it to {@link DidMethodApi.getBeacons} for the beacon
   * addresses to fund.
   */
  didDocument: Btcr2DidDocument;
}

/**
 * Policy for publishing update artifacts to the configured CAS during
 * {@link DidMethodApi.update}. CAS publication is optional and never required:
 * every update, for every beacon type, can be completed and distributed via
 * sidecar alone. Publishing is opt-in, so the default is `'never'`.
 *
 * - `'never'` (default): publish nothing. The caller distributes the returned
 *   artifacts (signed update, announcement, proof) via sidecar themselves.
 * - `'auto'`: best-effort. Publish the signed update (all beacon types) and the
 *   CAS Announcement (CAS beacons) when a writable CAS is configured; otherwise
 *   skip publication silently for every beacon type and return the artifacts for
 *   sidecar distribution. Never blocks an update for lack of a writable CAS.
 * - `'always'`: require a writable CAS. A read-only or absent CAS throws
 *   up-front for every beacon type. Use this to opt into a hard guarantee that
 *   the artifacts reached the CAS.
 * @public
 */
export type PublishToCasMode = 'auto' | 'always' | 'never';

/**
 * Result of {@link DidMethodApi.update}: the signed update plus every broadcast
 * artifact a resolver (or a sidecar distributor) needs afterwards.
 * @public
 */
export interface DidUpdateResult {
  /** The signed update that was broadcast. */
  signedUpdate: SignedBTCR2Update;
  /** Transaction id of the on-chain beacon signal. */
  txid: string;
  /**
   * The CAS Announcement whose hash rode in the OP_RETURN output (CAS beacons
   * only). Capture it for sidecar distribution when it was not published to CAS.
   */
  announcement?: CASAnnouncement;
  /**
   * SMT inclusion proof for the update, with the leaf nonce embedded (SMT
   * beacons only). Not content-addressable; always distribute via sidecar.
   */
  proof?: SMTProof;
  /** Which artifacts were published to the configured CAS. */
  publishedToCas: {
    /** The canonical signed update bytes were published. */
    update: boolean;
    /** The canonical CAS Announcement bytes were published (CAS beacons only). */
    announcement: boolean;
  };
}

/**
 * The source state of an update: a DID document and the `versionId` that a
 * resolution of the DID returned for it. The update targets `versionId + 1`.
 * The specification requires that `targetVersionId` comes from a fresh
 * resolution, not from a local count. An update on an old version can never
 * be applied.
 * @public
 */
export interface SourceState {
  /** The source DID document: the `didSourceDocument` of the specification. */
  document: Btcr2DidDocument;
  /** The `versionId` of `document`, from the resolution that returned it. */
  versionId: number;
}

/**
 * The source of an update on the top facade: a DID, which the api resolves
 * at call time, or a {@link SourceState} that the caller resolved.
 * @public
 */
export type UpdateSource = string | SourceState;

/**
 * Options of the "Announce DID Update" step of the specification: the beacon
 * that announces the update and the Bitcoin transaction of the Beacon Signal.
 * The fee and change fields come from {@link BroadcastOptions}.
 * @public
 */
export interface AnnounceOptions extends BroadcastOptions {
  /**
   * The id of the beacon service that announces the update. If absent, the
   * api uses the only beacon service of the source document. If the document
   * has several, the api uses the one whose address can fund the signal.
   */
  beaconId?: string;
  /**
   * The signer of the beacon transaction input. Default: the update signer.
   * Supply a separate signer if a key other than the verification method key
   * controls the beacon address.
   */
  signer?: Signer;
  /** The CAS publication policy. Default: `'never'`. See {@link PublishToCasMode}. */
  publishToCas?: PublishToCasMode;
  /** The Bitcoin connection of the announcement. Default: the connection of the api. */
  bitcoin?: BitcoinConnection;
  /**
   * A fixed fee rate of the beacon transaction, in satoshis for each virtual
   * byte. It must be a positive finite number. Do not set it together with
   * `feeEstimator`.
   */
  feeRate?: number;
}

/**
 * Options of an update or a deactivation.
 * @public
 */
export interface UpdateOptions {
  /**
   * The id of the verification method that signs the update. If absent, the
   * api uses the one verification method that publishes the key of the signer.
   */
  verificationMethodId?: string;
  /** Options of the announcement. */
  announce?: AnnounceOptions;
}

/**
 * Options of {@link DidBtcr2Api.updateDid} and {@link DidBtcr2Api.deactivateDid}.
 * @public
 */
export interface DidUpdateOptions extends UpdateOptions {
  /**
   * Options of the resolution of the source. They apply only if the source is
   * a DID. Supply sidecar data here if no party published the prior updates
   * of the DID to a CAS. Leave `versionId` and `versionTime` unset.
   */
  resolutionOptions?: ResolutionOptions;
}

/**
 * A beacon service on a DID document, reduced to what a caller funding the
 * beacon needs: the service id, the beacon type, and the bare Bitcoin address.
 * @public
 */
export interface BeaconInfo {
  /** The beacon service id, as spelled in the DID document. */
  id: string;
  /** Beacon type: `SingletonBeacon`, `CASBeacon`, or `SMTBeacon`. */
  type: string;
  /** The Bitcoin address to fund, with the `bitcoin:` URI scheme removed. */
  address: string;
}

/**
 * The error types of `selectBeaconFunding` that mean "this address cannot
 * fund the signal". Each error of these types has `data.reason`. Other
 * errors (an invalid change address, an unsupported address type) are not
 * a funding state, so the api throws them again.
 */
const FUNDING_ERROR_TYPES = new Set(['UNFUNDED_BEACON_ADDRESS', 'NO_SPENDABLE_BEACON_UTXO', 'INSUFFICIENT_FUNDS']);

/** True if `err` is a {@link BeaconError} that says why an address cannot fund the signal. */
function isFundingError(err: unknown): err is BeaconError {
  return err instanceof BeaconError && FUNDING_ERROR_TYPES.has(err.type);
}

/**
 * DID method operations sub-facade: create, resolve, update, deactivate.
 *
 * Lazily initialized by {@link DidBtcr2Api} because it depends on
 * {@link BitcoinApi} which requires network configuration.
 * @public
 */
export class DidMethodApi {
  /**
   * The JSON Patch operation that deactivates a DID document: it sets the
   * `deactivated` flag that resolvers halt on. Deactivation is not a separate
   * primitive in did:btcr2; it is an ordinary update carrying exactly this
   * patch, which is what {@link DidMethodApi.deactivate} broadcasts. The
   * constant is the `DEACTIVATION_PATCH` of `@did-btcr2/method`.
   */
  static readonly DEACTIVATION_PATCH: Readonly<PatchOperation> = DEACTIVATION_PATCH;

  /**
   * The network an identifier is minted for when the caller names none and no
   * Bitcoin connection is configured to inherit one from. Regtest, so that an
   * offline facade can never hand out a mainnet beacon address by omission.
   * Every creation path on the api, {@link DidBtcr2Api.generateDid} included,
   * falls back to this one value.
   */
  static readonly FALLBACK_NETWORK: NetworkName = 'regtest';

  #btc?: BitcoinApi;
  #cas?: CasApi;
  #log: Logger;

  constructor(btc?: BitcoinApi, cas?: CasApi, logger?: Logger) {
    this.#btc = btc;
    this.#cas = cas;
    this.#log = logger ?? NOOP_LOGGER;
  }

  /**
   * The network new DIDs are minted on when the caller names none: the network
   * of the configured Bitcoin connection, else
   * {@link DidMethodApi.FALLBACK_NETWORK}. Never `undefined`: an offline
   * facade mints regtest identifiers, not mainnet ones.
   */
  get defaultNetwork(): NetworkName {
    return this.#btc?.network ?? DidMethodApi.FALLBACK_NETWORK;
  }

  /**
   * Create a deterministic (k1) DID from a public key.
   * Sets idType to KEY automatically.
   *
   * When `options.network` is omitted, the DID is minted for the network of the
   * configured Bitcoin connection, so it targets the same chain this facade
   * reads. With no Bitcoin connection configured it is minted for
   * {@link DidMethodApi.FALLBACK_NETWORK} (regtest), never mainnet.
   * @param genesisBytes The compressed public key bytes (33 bytes).
   * @param options Creation options (idType is set for you).
   * @returns The created DID identifier string.
   */
  createDeterministic(genesisBytes: KeyBytes, options: Omit<DidCreateOptions, 'idType'> = {}): string {
    assertCompressedPubkey(genesisBytes, 'genesisBytes');
    return DidBtcr2.create(genesisBytes, {
      ...options,
      ...this.#networkOption(options.network),
      idType : IdentifierTypes.KEY,
    });
  }

  /**
   * Create a non-deterministic (x1) DID from external genesis document bytes.
   * Sets idType to EXTERNAL automatically.
   *
   * When `options.network` is omitted, the DID is minted for the network of the
   * configured Bitcoin connection. With no Bitcoin connection configured it is
   * minted for {@link DidMethodApi.FALLBACK_NETWORK} (regtest), never mainnet.
   * @param genesisBytes The genesis document bytes.
   * @param options Creation options (idType is set for you).
   * @returns The created DID identifier string.
   */
  createExternal(genesisBytes: DocumentBytes, options: Omit<DidCreateOptions, 'idType'> = {}): string {
    assertBytes(genesisBytes, 'genesisBytes');
    return DidBtcr2.create(genesisBytes, {
      ...options,
      ...this.#networkOption(options.network),
      idType : IdentifierTypes.EXTERNAL,
    });
  }

  /**
   * The `network` slice of a create-options object: the caller's choice when
   * they made one, else {@link DidMethodApi.defaultNetwork} (the configured
   * connection's network, else the regtest fallback).
   *
   * Always a named network, never `undefined`. `DidBtcr2.create` destructures
   * with `network = 'bitcoin'`, so letting an `undefined` through, a caller
   * passing `{ network: undefined }` included, would mint a mainnet identifier:
   * the very default this indirection exists to stop reaching by omission.
   * Spread after the caller's options, this slice overrides such a value.
   */
  #networkOption(requested?: string): { network: string } {
    return { network: requested ?? this.defaultNetwork };
  }

  /**
   * The DID document a DID resolves to before any update has been announced,
   * computed with zero I/O: no Bitcoin connection, no CAS, no network at all.
   *
   * For KEY (`k`) identifiers the whole document, beacon services included, is
   * a pure function of the public key inside the identifier. That matters for
   * bootstrapping: the beacon address a caller must fund before their first
   * update is knowable offline, so it need not be fetched from a chain the DID
   * has not touched yet. For EXTERNAL (`x`) identifiers the genesis document is
   * the caller's own input and must be supplied; it is validated against the
   * hash inside the identifier.
   * @param did The DID whose initial document to derive.
   * @param genesisDocument The genesis document (EXTERNAL DIDs only).
   * @returns The initial DID document.
   */
  getInitialDocument(did: string, genesisDocument?: object): Btcr2DidDocument {
    assertString(did, 'did');
    const components = Identifier.decode(did);
    if(components.hrp === IdentifierHrp.k) {
      return Resolver.deterministic(components);
    }
    if(!genesisDocument) {
      throw new Error(
        `Cannot derive the initial document for EXTERNAL DID ${did} without its genesis document. `
        + 'Pass the genesis document as the second argument, or use resolve() with a CAS configured.'
      );
    }
    return Resolver.external(components, genesisDocument);
  }

  /**
   * The beacon services of a DID document, each paired with the Bitcoin address
   * that must hold a confirmed UTXO before that beacon can broadcast a signal.
   * Combine with {@link DidMethodApi.getInitialDocument} to learn the address
   * to fund without any chain round-trip.
   * @param document The DID document to read beacon services from.
   * @returns One {@link BeaconInfo} per beacon service on the document.
   */
  getBeacons(document: Btcr2DidDocument): BeaconInfo[] {
    return BeaconUtils.getBeaconServices(document as DidDocument)
      .map((service: BeaconService) => ({
        id      : service.id,
        type    : service.type,
        address : BeaconUtils.parseBitcoinAddress(String(service.serviceEndpoint)),
      }));
  }

  /**
   * Build a Genesis Document from keys, beacons, and services, with zero I/O.
   *
   * The document carries the placeholder id `did:btcr2:_`, one Multikey
   * verification method per key, the verification relationships, one beacon
   * service per beacon, and the other services. Its canonical SHA-256 hash is
   * the genesis bytes of an EXTERNAL (`x`) identifier; pass the document to
   * {@link DidMethodApi.createExternalFromDocument} to mint one. The caller
   * keeps the document: an EXTERNAL identifier resolves only with it.
   *
   * When `spec.network` is omitted, the beacon addresses are derived for the
   * network of the configured Bitcoin connection, else for
   * {@link DidMethodApi.FALLBACK_NETWORK} (regtest), never mainnet. When
   * `spec.beacons` is omitted, the document gets one Singleton beacon with the
   * P2WPKH address of the first key. The builder refuses a spec with no
   * `capabilityInvocation` method or no beacon: such a DID can never be updated.
   * @param spec The keys, beacons, and services. See {@link GenesisDocumentSpec}.
   * @returns The genesis document.
   * @throws {DidDocumentError} If the spec is not valid.
   */
  buildGenesisDocument(spec: Omit<GenesisDocumentSpec, 'network'> & { network?: NetworkName }): Btcr2DidDocument {
    if (spec === null || typeof spec !== 'object') {
      throw new Error('spec must be an object.');
    }
    return buildGenesisDocument({ ...spec, network: spec.network ?? this.defaultNetwork });
  }

  /**
   * Create an EXTERNAL (`x`) DID from its genesis document, with zero I/O.
   *
   * The document must be a Genesis Document: a JSON object with the id
   * `did:btcr2:_`, the two required contexts, and the placeholder in every
   * verification method and service id. The api hashes the document as given
   * (JCS canonical form, SHA-256), encodes the identifier for the network, and
   * derives the initial DID document, which validates the document as a DID
   * document. Hash the same JSON you keep or publish: a document with one
   * changed byte hashes to a different identifier.
   *
   * When `options.network` is omitted, the DID is minted for the network of the
   * configured Bitcoin connection, else for {@link DidMethodApi.FALLBACK_NETWORK}
   * (regtest), never mainnet. The network is not checked against the beacon
   * addresses of the document.
   * @param genesisDocument The genesis document.
   * @param options Creation options (idType is set for you).
   * @returns The identifier, its genesis bytes, and the initial DID document.
   * @throws {DidDocumentError} If the document is not a valid genesis document.
   */
  createExternalFromDocument(
    genesisDocument: object,
    options: Omit<DidCreateOptions, 'idType'> = {},
  ): ExternalCreateResult {
    assertGenesisDocument(genesisDocument);
    const genesisBytes = GenesisDocument.toGenesisBytes(genesisDocument);
    const did = this.createExternal(genesisBytes, options);
    const didDocument = Resolver.external(Identifier.decode(did), genesisDocument);
    return { did, genesisBytes, didDocument };
  }

  /**
   * The "Construct BTCR2 Unsigned Update" step of the specification, with zero
   * I/O. The api applies the patch to the source document, validates the target
   * document, and computes `sourceHash` and `targetHash`. The target version is
   * `source.versionId + 1`.
   *
   * Use this step and {@link DidMethodApi.signUpdate} to make a signed update
   * without an announcement, for example for a test vector or for an aggregate
   * beacon. {@link DidMethodApi.update} does all steps and broadcasts.
   * @param source The source document and the `versionId` that its resolution returned.
   * @param patch The JSON Patch operations that change the source document.
   * @returns The unsigned update.
   * @throws {UpdateError} If the patch does not give a valid DID document.
   */
  constructUpdate(source: SourceState, patch: PatchOperation[]): UnsignedBTCR2Update {
    if (source === null || typeof source !== 'object') {
      throw new Error('source must be an object.');
    }
    return Updater.construct(source.document, patch, source.versionId);
  }

  /**
   * The "Construct BTCR2 Signed Update" step of the specification, with zero
   * I/O. The api makes sure that the verification method publishes the key of
   * the signer. Then it adds a Data Integrity proof that invokes the root
   * capability of the DID.
   * @param did The DID that the update changes.
   * @param unsignedUpdate The result of {@link DidMethodApi.constructUpdate}.
   * @param verificationMethod The verification method that signs the update.
   * @param signer The signer with the key of the verification method.
   * @returns The signed update.
   * @throws {UpdateError} If the DID, the verification method, or the signer is not valid.
   */
  signUpdate(
    did: string,
    unsignedUpdate: UnsignedBTCR2Update,
    verificationMethod: DidVerificationMethod,
    signer: Signer,
  ): SignedBTCR2Update {
    assertString(did, 'did');
    const publicKeyMultibase = verificationMethod?.publicKeyMultibase;
    if(!publicKeyMultibase) {
      throw new UpdateError(
        'The verification method must have a publicKeyMultibase: the api compares it with the key of the signer.',
        INVALID_DID_UPDATE, { verificationMethodId: verificationMethod?.id }
      );
    }
    return Updater.sign(did, unsignedUpdate, { ...verificationMethod, publicKeyMultibase }, signer);
  }

  /**
   * The "JSON Document Hashing" algorithm of the specification: the JCS
   * canonical form, SHA-256, and base64url with no padding. `sourceHash` and
   * `targetHash` of an update, the `updateId` of an SMT proof, and a CAS key
   * use this form.
   * @param document The JSON document.
   * @returns The hash, base64url with no padding.
   */
  hashDocument(document: object): string {
    if (document === null || typeof document !== 'object') {
      throw new Error('document must be an object.');
    }
    return canonicalHash(document);
  }

  /**
   * Apply JSON Patch operations to a document, with zero I/O. The source
   * document does not change. The first operation that fails, a failed `test`
   * included, fails the whole patch, as in an update. For a DID document, the
   * result is the target document of an update with this patch. The api does
   * not validate the result as a DID document; {@link DidMethodApi.constructUpdate} does.
   * @param document The source document.
   * @param patch The JSON Patch operations.
   * @returns A new document with the operations applied.
   * @throws {MethodError} `JSON_PATCH_APPLY_ERROR` if an operation is not valid or does not apply.
   */
  applyPatch(document: object, patch: PatchOperation[]): Record<string, unknown> {
    if (document === null || typeof document !== 'object') {
      throw new Error('document must be an object.');
    }
    return JSONPatch.apply(document, patch, { strict: true });
  }

  /**
   * The root capability of a DID, as the "Derive Root Capability from
   * did:btcr2 Identifier" algorithm of the specification gives it. The proof
   * of each update invokes this capability.
   * @param did The DID.
   * @returns The root capability.
   */
  rootCapability(did: string): RootCapability {
    assertString(did, 'did');
    return Appendix.deriveRootCapability(did);
  }

  /**
   * Resolve a DID by driving the sans-I/O `Resolver` state machine (from @did-btcr2/method).
   * If a Bitcoin connection is configured on the API, it is used automatically
   * to fetch beacon signals. Sidecar data flows through `options.sidecar`.
   * If the DID names a network other than the connection's, resolution is
   * refused before any chain read.
   *
   * A failure rejects with a plain `Error` whose `cause` chain carries the
   * typed failure: `ResolveError` of type `NOT_FOUND` when the genesis
   * document of an EXTERNAL DID is not in the sidecar and the CAS does not
   * return it, `MISSING_UPDATE_DATA` when a signed update or a CAS
   * announcement is not in the sidecar and the CAS does not return it.
   * @param did The DID to resolve.
   * @param options Resolution options.
   * @returns The resolution result. `didResolutionMetadata.contentType` is
   *          `application/did`, the media type of a bare DID document.
   */
  async resolve(did: string, options?: ResolutionOptions): Promise<DidResolutionResult> {
    assertString(did, 'did');
    this.#log.debug('Resolving DID', did);
    try {
      const resolver = DidBtcr2.resolve(did, options);
      const mismatch = this.#networkMismatch(did, this.#btc?.network);
      if(mismatch) {
        throw new ResolveError(
          `The DID names the network "${mismatch.didNetwork}", but the Bitcoin connection `
          + `targets "${mismatch.connectionNetwork}". Resolution through this connection reads `
          + 'the wrong chain and cannot find the updates of this DID. '
          + 'Use a Bitcoin connection for the network of the DID.',
          'ResolveError', { did, ...mismatch }
        );
      }
      let state = resolver.resolve();

      while(state.status === 'action-required') {
        for(const need of state.needs) {
          switch(need.kind) {
            case 'NeedBeaconSignals': {
              if(!this.#btc) {
                throw new Error(
                  'Bitcoin connection required to fetch beacon signals. '
                  + 'Configure a BitcoinApi on the DidBtcr2Api instance.'
                );
              }
              this.#log.debug(
                'Fetching beacon signals for %d service(s) via %s',
                need.beaconServices.length,
                this.#btc.signalDiscovery
              );
              // Which path reads the chain is fixed by the connection, not by the DID:
              // see BitcoinApiConfig.signalDiscovery.
              const discover = this.#btc.signalDiscovery === 'fullnode'
                ? BeaconSignalDiscovery.fullnode
                : BeaconSignalDiscovery.indexer;
              const signals = await discover([...need.beaconServices], this.#btc.connection);
              resolver.provide(need, signals);
              break;
            }
            case 'NeedGenesisDocument': {
              // The specification raises NOT_FOUND when the genesis document cannot be
              // retrieved. Without a CAS driver the sidecar was the only source.
              if(!this.#cas) {
                throw new ResolveError(
                  `Genesis document required but not in sidecar (hash: ${need.genesisHash}), `
                  + 'and no CAS driver configured. Either provide the genesis document via '
                  + 'options.sidecar.genesisDocument or configure a CAS driver.',
                  NOT_FOUND, { genesisHash: need.genesisHash }
                );
              }
              this.#log.debug('Fetching genesis document from CAS: %s', need.genesisHash);
              let doc: object | null;
              try {
                doc = await this.#cas.retrieve(decodeHash(need.genesisHash, 'hex'));
              } catch (err) {
                // CasApi.retrieve refuses content that does not hash to the address with
                // MISSING_UPDATE_DATA. For the genesis document the specification code is NOT_FOUND.
                if(err instanceof ResolveError && err.type === MISSING_UPDATE_DATA) {
                  throw new ResolveError(
                    `Genesis document unusable from CAS (hash: ${need.genesisHash}): ${err.message}`,
                    NOT_FOUND, { genesisHash: need.genesisHash, cause: err }
                  );
                }
                throw err;
              }
              if(!doc) {
                throw new ResolveError(
                  `Genesis document not found in CAS (hash: ${need.genesisHash}).`,
                  NOT_FOUND, { genesisHash: need.genesisHash }
                );
              }
              resolver.provide(need as NeedGenesisDocument, doc);
              break;
            }
            case 'NeedCASAnnouncement': {
              // The specification raises MISSING_UPDATE_DATA when update data is not
              // available from the sidecar or from the CAS.
              if(!this.#cas) {
                throw new ResolveError(
                  `CAS announcement required but not in sidecar (hash: ${need.announcementHash}), `
                  + 'and no CAS driver configured. Either provide it via '
                  + 'options.sidecar.casUpdates or configure a CAS driver.',
                  MISSING_UPDATE_DATA, { announcementHash: need.announcementHash }
                );
              }
              this.#log.debug('Fetching CAS announcement from CAS: %s', need.announcementHash);
              const announcement = await this.#cas.retrieve(decodeHash(need.announcementHash, 'hex'));
              if(!announcement) {
                throw new ResolveError(
                  `CAS announcement not found in CAS (hash: ${need.announcementHash}).`,
                  MISSING_UPDATE_DATA, { announcementHash: need.announcementHash }
                );
              }
              resolver.provide(need as NeedCASAnnouncement, announcement as CASAnnouncement);
              break;
            }
            case 'NeedSignedUpdate': {
              if(!this.#cas) {
                throw new ResolveError(
                  `Signed update required but not in sidecar (hash: ${need.updateHash}), `
                  + 'and no CAS driver configured. Either provide it via '
                  + 'options.sidecar.updates or configure a CAS driver.',
                  MISSING_UPDATE_DATA, { updateHash: need.updateHash }
                );
              }
              this.#log.debug('Fetching signed update from CAS: %s', need.updateHash);
              const update = await this.#cas.retrieve(decodeHash(need.updateHash, 'hex'));
              if(!update) {
                throw new ResolveError(
                  `Signed update not found in CAS (hash: ${need.updateHash}).`,
                  MISSING_UPDATE_DATA, { updateHash: need.updateHash }
                );
              }
              resolver.provide(need as NeedSignedUpdate, update as SignedBTCR2Update);
              break;
            }
            case 'NeedSMTProof': {
              // An SMT proof has no content address on chain: the signal is the
              // tree root, and the proof of one DID is not derivable from it. Sidecar
              // is the only channel. Without it the need is unfulfillable. The
              // specification raises MISSING_UPDATE_DATA when the proof table has
              // no entry for the signal root.
              throw new ResolveError(
                `SMT proof required but not in sidecar (root hash: ${need.smtRootHash}). `
                + 'SMT proofs cannot be fetched from a CAS; provide the proof via '
                + 'options.sidecar.smtProofs.',
                MISSING_UPDATE_DATA, { smtRootHash: need.smtRootHash }
              );
            }
            default: {
              // The switch is exhaustive over today's DataNeed union; this guards
              // against a newer method package emitting a need this api version
              // does not know how to fulfill, which would otherwise spin the
              // while-loop forever.
              throw new Error(
                `Unsupported resolver data need: ${String((need as { kind?: string }).kind)}.`
              );
            }
          }
        }
        state = resolver.resolve();
      }

      this.#log.debug('DID resolved successfully', did, state.result.metadata);
      // The specification: a resolver that returns a bare DID document records the
      // media type application/did in the resolution metadata.
      return {
        didResolutionMetadata : { contentType: 'application/did' },
        didDocument           : state.result.didDocument as unknown as DidResolutionResult['didDocument'],
        didDocumentMetadata   : state.result.metadata,
      };
    } catch (err) {
      this.#log.error('DID resolution failed', did, err);
      throw new Error(
        `Failed to resolve DID ${did}: ${rootCauseMessage(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Update an existing DID document by driving the sans-I/O {@link Updater} state
   * machine (from @did-btcr2/method). The arguments follow the update operation
   * of the specification: the source document with its version, the JSON Patch
   * document, and the signer. `options.verificationMethodId` is the fourth
   * input of the specification; `options.announce` configures the announcement.
   *
   * This method handles the I/O side:
   * - Signing: supplies the {@link Signer} to `NeedSigningKey`.
   * - Beacon input: `announce.signer` signs the beacon transaction input. It
   *   defaults to `signer`. Pass a separate signer when the beacon address
   *   belongs to a key other than the verification method key.
   * - Funding: reads the UTXOs at the beacon address and refuses the update if
   *   they cannot fund the signal at the fee rate of `announce`. The api calls
   *   the funding rule of the beacon (`selectBeaconFunding`), so the beacon
   *   applies the same rule at broadcast.
   * - CAS publication: publishes the signed update (and, for CAS beacons, the
   *   announcement) to the configured CAS per the `publishToCas` policy,
   *   **before** the on-chain broadcast, so any OP_RETURN update hash is
   *   fetchable from CAS at resolution time without sidecar data.
   * - Broadcast: establishes a beacon via {@link BeaconFactory} and calls
   *   `broadcastSignal()` with the bitcoin connection configured on the API.
   * - Network check: refuses the update if the DID names a network other
   *   than the connection's, before any I/O.
   *
   * A deactivated source document is refused before anything else runs.
   * Resolution halts at the deactivation, so an update signed on top of it
   * would spend a beacon UTXO on an announcement no resolver ever reads.
   * Every write path (`updateDid`, `deactivateDid`, `deactivate`) passes
   * through here, so the refusal holds for all of them.
   *
   * The caller can omit `verificationMethodId` and `announce.beaconId`. The
   * api then derives them, after the guards above and before any signature.
   * The verification method is the one method on the source document that
   * publishes the signer's key. The Updater refuses every other method, so
   * the signer's key identifies the method.
   *
   * The beacon is the only beacon service, with no chain read. If the
   * document has several beacon services, the beacon is the one whose
   * address can fund the signal. If no method or no beacon matches, the
   * api refuses the update. If several match, the api refuses the update and
   * names the candidates.
   *
   * For multi-party aggregation of SMT/CAS beacons, do not use this method. Make
   * the signed update with {@link DidMethodApi.constructUpdate} and
   * {@link DidMethodApi.signUpdate}, and give it to the aggregation service.
   *
   * @param source The source document and the `versionId` that its resolution returned.
   * @param patch The JSON Patch document: the operations that change the source document.
   * @param signer The signer of the update proof, with the key of the verification method.
   * @param options The verification method id and the announcement options.
   * @returns The broadcast artifacts: signed update, signal txid, per-beacon-type
   *   sidecar data, and which artifacts were published to CAS.
   */
  async update(
    source: SourceState,
    patch: PatchOperation[],
    signer: Signer,
    options: UpdateOptions = {},
  ): Promise<DidUpdateResult> {
    const { document: sourceDocument, versionId: sourceVersionId } = source;
    const {
      beaconId: announceBeaconId,
      signer: beaconSigner = signer,
      publishToCas = 'never',
      bitcoin,
      feeRate,
      ...broadcastOptions
    } = options.announce ?? {};
    let beaconId = announceBeaconId;
    let verificationMethodId = options.verificationMethodId;

    if(feeRate !== undefined) {
      if(broadcastOptions.feeEstimator) {
        throw new UpdateError(
          'Set `announce.feeRate` or `announce.feeEstimator`, not both.',
          INVALID_DID_UPDATE, { feeRate }
        );
      }
      if(typeof feeRate !== 'number' || !Number.isFinite(feeRate) || feeRate <= 0) {
        throw new UpdateError(
          `\`announce.feeRate\` must be a positive finite number of sats/vB; got ${String(feeRate)}.`,
          INVALID_DID_UPDATE, { feeRate }
        );
      }
      broadcastOptions.feeEstimator = new StaticFeeEstimator(feeRate);
    }

    // A deactivated document takes no further update: resolution halts at the
    // deactivation, so anything signed and broadcast on top of it spends a
    // beacon UTXO on an announcement no resolver will ever read. Refused here,
    // at the single chokepoint every write path (updateDid, deactivateDid,
    // deactivate) passes through, before any connection is touched.
    if(sourceDocument?.deactivated) {
      throw new UpdateError(
        `DID document ${sourceDocument.id} is deactivated and cannot be updated. `
        + 'Deactivation is irreversible: resolution halts at the deactivation, so '
        + 'no later update is ever applied.',
        INVALID_DID_UPDATE, { did: sourceDocument.id }
      );
    }

    // Bitcoin connection resolution order: the per-call `announce.bitcoin` wins
    // over the BitcoinApi injected at DidBtcr2Api construction time. One of the two must
    // be present; this can't be encoded in the type system, so it's a runtime check.
    const btcConnection = bitcoin ?? this.#btc?.connection;
    if(!btcConnection) {
      throw new UpdateError(
        'Bitcoin connection required for update. Pass `announce.bitcoin` '
        + 'or configure a BitcoinApi on the DidBtcr2Api instance.',
        INVALID_DID_UPDATE, { beaconId }
      );
    }

    // A DID and its connection must name the same network. An update through a
    // connection on another chain announces where no resolver of this DID
    // reads, and spends the beacon UTXO for nothing. Refused before any I/O.
    const mismatch = this.#networkMismatch(sourceDocument.id, btcConnection.name);
    if(mismatch) {
      throw new UpdateError(
        `DID ${sourceDocument.id} names the network "${mismatch.didNetwork}", but the Bitcoin `
        + `connection targets "${mismatch.connectionNetwork}". An update through this connection `
        + 'announces on the wrong chain, where no resolver of this DID reads it. '
        + 'Use a Bitcoin connection for the network of the DID.',
        INVALID_DID_UPDATE, { did: sourceDocument.id, ...mismatch }
      );
    }

    // The caller can omit two ids. The Updater refuses a method whose key
    // differs from the signer's key, so the signer's key identifies the
    // signing method. The beacon is the one beacon whose address can fund
    // the signal. The api never picks one of several silently. The derivation runs
    // after the guards above, so a refused update reads nothing.
    verificationMethodId ??= this.#deriveVerificationMethodId(sourceDocument, signer);
    beaconId ??= await this.#deriveBeaconId(sourceDocument, btcConnection, broadcastOptions);

    this.#log.debug('Updating DID', sourceDocument.id, { beaconId, verificationMethodId });

    // Factory validates and returns a sans-I/O state machine
    const updater = DidBtcr2.update({
      sourceDocument,
      patches : patch,
      sourceVersionId,
      verificationMethodId,
      beaconId,
    });

    // Decide the CAS publication plan before any signing or spending happens, so
    // a policy violation ('always' with no writable CAS) fails fast instead of
    // after the update is signed. Runs after the factory so an invalid beaconId
    // still throws the canonical error.
    const publishCas = this.#planCasPublication(publishToCas, beaconId);

    // Drive the state machine. All I/O (signing delegation, CAS publication,
    // Bitcoin broadcast) happens inside the need-handlers below - the Updater
    // itself is pure.
    let broadcastResult: BroadcastResult | undefined;
    const publishedToCas = { update: false, announcement: false };
    let state = updater.advance();
    while(state.status === 'action-required') {
      for(const need of state.needs) {
        switch(need.kind) {
          case 'NeedSigningKey': {
            this.#log.debug('Providing signer for', need.verificationMethodId);
            updater.provide(need, signer);
            break;
          }
          case 'NeedFunding': {
            this.#log.debug('Checking funding for beacon address %s', need.beaconAddress);
            const utxos = await btcConnection.rest.address.getUtxos(need.beaconAddress);
            if(!utxos.length) {
              throw new UpdateError(
                `Beacon address ${need.beaconAddress} is unfunded. `
                + 'Send BTC to this address before broadcasting the update.',
                INVALID_DID_UPDATE, { beaconAddress: need.beaconAddress }
              );
            }
            // The guard calls the funding rule of the beacon (ADR 102) with the
            // fee estimator and the change address of the broadcast. An address
            // that cannot fund the signal at this fee rate thus fails here,
            // before any CAS publication, with the reason of the beacon.
            let funding: BeaconFunding;
            try {
              funding = await selectBeaconFunding(utxos, {
                beaconAddress : need.beaconAddress,
                network       : btcConnection.data,
                feeEstimator  : broadcastOptions.feeEstimator,
                changeAddress : broadcastOptions.changeAddress,
              });
            } catch (err) {
              if(!isFundingError(err)) throw err;
              const reason = String(err.data?.reason);
              throw new UpdateError(
                `Beacon address ${need.beaconAddress} cannot fund this update: ${reason}. `
                + 'Before you broadcast the update, wait for a confirmation, fund the address, '
                + 'or set a lower `announce.feeRate`.',
                INVALID_DID_UPDATE, { beaconAddress: need.beaconAddress, utxos: utxos.length, reason }
              );
            }
            this.#log.debug(
              'Beacon address funds the signal: %d of %d UTXOs, fee %s sats',
              funding.utxos.length, utxos.length, funding.feeSats
            );
            updater.provide(need);
            break;
          }
          case 'NeedBroadcast': {
            const options: CASBroadcastOptions = { ...broadcastOptions };

            // Publication order: signed update, then announcement (inside the
            // beacon, via casPublish), then the tx broadcast. Publishing before
            // spending means a CAS failure aborts while the beacon UTXO is
            // intact; content addressing makes a retry after a failed broadcast
            // idempotent (same bytes, same address).
            if(publishCas) {
              this.#log.debug('Publishing signed update to CAS');
              await publishCas.publish(need.signedUpdate);
              publishedToCas.update = true;
              if(need.beaconService.type === 'CASBeacon') {
                options.casPublish = async (announcement) => {
                  this.#log.debug('Publishing CAS announcement to CAS');
                  await publishCas.publish(announcement);
                  publishedToCas.announcement = true;
                };
              }
            }

            this.#log.debug(
              'Broadcasting signed update via %s beacon', need.beaconService.type
            );
            const beacon = BeaconFactory.establish(need.beaconService, need.did);
            broadcastResult = await beacon.broadcastSignal(
              need.signedUpdate, beaconSigner, btcConnection, options
            );
            updater.provide(need);
            break;
          }
          default: {
            // The switch is exhaustive over today's UpdaterDataNeed union; this
            // guards against a newer method package emitting a need this api
            // version cannot fulfill, which would otherwise spin the while-loop
            // forever (the updater re-emits unfulfilled needs on every advance()).
            throw new UpdateError(
              `Unsupported updater data need: ${String((need as { kind?: string }).kind)}.`,
              INVALID_DID_UPDATE, { beaconId }
            );
          }
        }
      }
      state = updater.advance();
    }

    if(!broadcastResult) {
      throw new UpdateError(
        'Updater completed without reaching the broadcast phase.',
        INVALID_DID_UPDATE, { beaconId }
      );
    }

    this.#log.debug('DID update complete', sourceDocument.id);
    return {
      signedUpdate : state.result.signedUpdate,
      txid         : broadcastResult.txid,
      ...(broadcastResult.announcement ? { announcement: broadcastResult.announcement } : {}),
      ...(broadcastResult.proof ? { proof: broadcastResult.proof } : {}),
      publishedToCas,
    };
  }

  /**
   * Resolve the `publishToCas` policy against the configured CAS. Returns the
   * {@link CasApi} to publish with, or `null` when publication is skipped
   * (`'never'`, or `'auto'` with no writable CAS). Throws only under `'always'`
   * when no writable CAS is available; `'auto'` never blocks an update, because
   * CAS publication is optional and the artifacts are always distributable via
   * sidecar.
   */
  #planCasPublication(
    mode: PublishToCasMode,
    beaconId: string,
  ): CasApi | null {
    if(mode === 'never') return null;

    if(this.#cas && this.#cas.writable) return this.#cas;

    // No writable CAS. 'auto' is best-effort: skip publication and let the
    // caller distribute the returned artifacts via sidecar. 'always' opted into
    // a hard guarantee that cannot be met, so it fails up-front.
    if(mode === 'always') {
      const casState = this.#cas
        ? 'the configured CAS is read-only (e.g. an HTTP gateway)'
        : 'no CAS is configured';
      throw new UpdateError(
        `publishToCas is 'always' but ${casState}. Configure a writable CAS `
        + '(cas.rpcUrl, cas.blockstore, or a custom cas.executor with publish support), '
        + 'or use publishToCas \'auto\'/\'never\'.',
        INVALID_DID_UPDATE, { beaconId, publishToCas: mode }
      );
    }

    return null;
  }

  /**
   * The networks a DID and a Bitcoin connection name, if they differ.
   * Returns null when they agree, when there is no connection network, when
   * the DID does not decode (the calling path reports that itself), and when
   * the DID names a custom network, which decodes to a number and has no name
   * to compare.
   */
  #networkMismatch(
    did: string,
    connectionNetwork: NetworkName | undefined,
  ): { didNetwork: string; connectionNetwork: NetworkName } | null {
    if(!connectionNetwork) return null;
    let didNetwork: string | number;
    try {
      didNetwork = Identifier.decode(did).network;
    } catch {
      return null;
    }
    if(typeof didNetwork !== 'string' || didNetwork === connectionNetwork) return null;
    return { didNetwork, connectionNetwork };
  }

  /**
   * This helper returns the id of the one verification method on `document`
   * that publishes the signer's key. The Updater refuses a signer whose key
   * differs from the `publicKeyMultibase` of the method, so the signer's key
   * identifies the method. The api refuses zero matches and several matches.
   * It never picks a method silently.
   */
  #deriveVerificationMethodId(document: Btcr2DidDocument, signer: Signer): string {
    const signerKey = new CompressedSecp256k1PublicKey(signer.publicKey).multibase.encoded;
    const matches = (document.verificationMethod ?? [])
      .filter((method: DidVerificationMethod) => method.publicKeyMultibase === signerKey);
    if(matches.length === 1) return matches[0]!.id;
    if(matches.length === 0) {
      throw new UpdateError(
        `No verification method on DID ${document.id} publishes the signer's key. `
        + 'The api cannot derive verificationMethodId. Sign with a key that the document lists. '
        + 'As an alternative, pass verificationMethodId.',
        INVALID_DID_UPDATE, { did: document.id, signerKey }
      );
    }
    const ids = matches.map((method: DidVerificationMethod) => method.id);
    throw new UpdateError(
      `${matches.length} verification methods on DID ${document.id} publish the signer's key: `
      + `${ids.join(', ')}. Pass verificationMethodId to choose one.`,
      INVALID_DID_UPDATE, { did: document.id, signerKey, verificationMethodIds: ids }
    );
  }

  /**
   * This helper returns the id of the beacon that the update announces
   * through, if the caller names none. One beacon service is the only
   * choice, so the helper uses it with no chain read. The funding guard
   * reports the state of that beacon.
   *
   * If the document has several beacon services, the helper uses the one
   * whose address can fund the signal. It calls the funding rule of the
   * beacon (`selectBeaconFunding`) with the fee estimator and the change
   * address of the broadcast. If no address can fund the signal, the helper
   * refuses and gives the reason for each beacon. If several can, the helper
   * refuses and names them. The api never decides which UTXO to spend.
   */
  async #deriveBeaconId(
    document: Btcr2DidDocument,
    bitcoin: BitcoinConnection,
    fees: Pick<BroadcastOptions, 'feeEstimator' | 'changeAddress'>,
  ): Promise<string> {
    const beacons = this.getBeacons(document);
    if(beacons.length === 1) return beacons[0]!.id;
    if(beacons.length === 0) {
      throw new UpdateError(
        `DID document ${document.id} has no beacon service. The api cannot derive beaconId.`,
        INVALID_DID_UPDATE, { did: document.id }
      );
    }
    const funded: BeaconInfo[] = [];
    const unfunded: Array<BeaconInfo & { reason: string }> = [];
    for(const beacon of beacons) {
      const utxos = await bitcoin.rest.address.getUtxos(beacon.address);
      try {
        await selectBeaconFunding(utxos, {
          beaconAddress : beacon.address,
          network       : bitcoin.data,
          feeEstimator  : fees.feeEstimator,
          changeAddress : fees.changeAddress,
        });
        funded.push(beacon);
      } catch (err) {
        // This address cannot fund the signal, so it is not a candidate. The
        // error gives the reason. A different error is a fault of the UTXO
        // list or of the options. The api throws that error again.
        if(!isFundingError(err)) throw err;
        unfunded.push({ ...beacon, reason: String(err.data?.reason) });
      }
    }
    if(funded.length === 1) return funded[0]!.id;
    if(funded.length === 0) {
      // The message names each beacon relative to the DID, which it names once.
      const list = unfunded.map(beacon => {
        const id = beacon.id.startsWith(`${document.id}#`) ? beacon.id.slice(document.id.length) : beacon.id;
        return `${id} (${beacon.address}): ${beacon.reason}`;
      }).join('; ');
      throw new UpdateError(
        `No beacon of DID ${document.id} can fund the signal. The api cannot derive beaconId. `
        + `${list}. Wait for a confirmation, fund one beacon address, or set a lower \`announce.feeRate\`.`,
        INVALID_DID_UPDATE, { did: document.id, beacons: unfunded }
      );
    }
    const ids = funded.map(beacon => beacon.id);
    throw new UpdateError(
      `${funded.length} beacons of DID ${document.id} can fund the signal: ${ids.join(', ')}. `
      + 'Pass beaconId to choose which one spends.',
      INVALID_DID_UPDATE, { did: document.id, funded: ids }
    );
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
   * Deactivate a DID by broadcasting an update that sets the `deactivated`
   * flag ({@link DidMethodApi.DEACTIVATION_PATCH}). Deactivation is an
   * ordinary update in did:btcr2: it rides the same sign / CAS-publication /
   * beacon-broadcast path as {@link DidMethodApi.update}, and resolvers halt
   * at the flag.
   *
   * Deactivation is irreversible. An already-deactivated source document is
   * refused up-front: a second deactivation would sign and broadcast a
   * well-formed update that no resolver can ever read back, because
   * resolution stops at the first deactivation.
   *
   * The operation follows the deactivate operation of the specification: the
   * update operation with a fixed patch. The caller can omit
   * `verificationMethodId` and `announce.beaconId`, as in
   * {@link DidMethodApi.update}.
   *
   * @param source The source document and the `versionId` that its resolution returned.
   * @param signer The signer of the update proof, with the key of the verification method.
   * @param options The verification method id and the announcement options.
   * @returns The broadcast artifacts, exactly as {@link DidMethodApi.update}.
   */
  async deactivate(
    source: SourceState,
    signer: Signer,
    options: UpdateOptions = {},
  ): Promise<DidUpdateResult> {
    if(source.document?.deactivated) {
      throw new UpdateError(
        `DID document ${source.document.id} is already deactivated. `
        + 'Deactivation is irreversible: a further deactivation update could '
        + 'never be read back, because resolution halts at the first.',
        INVALID_DID_UPDATE, { did: source.document.id }
      );
    }
    return this.update(source, [{ ...DidMethodApi.DEACTIVATION_PATCH }], signer, options);
  }
}
