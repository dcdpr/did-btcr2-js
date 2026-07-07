import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { DocumentBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import { decode as decodeHash, IdentifierTypes, INVALID_DID_UPDATE, NotImplementedError, UpdateError } from '@did-btcr2/common';
import type { Signer } from '@did-btcr2/keypair';
import type { BroadcastOptions, BroadcastResult, Btcr2DidDocument, CASAnnouncement, CASBroadcastOptions, DidCreateOptions, NeedCASAnnouncement, NeedGenesisDocument, NeedSignedUpdate, ResolutionOptions, SignedBTCR2Update, SMTProof } from '@did-btcr2/method';
import { BeaconFactory, BeaconSignalDiscovery, DidBtcr2 } from '@did-btcr2/method';
import type { DidResolutionResult, DidVerificationMethod } from '@web5/dids';
import type { BitcoinApi } from './bitcoin.js';
import type { CasApi } from './cas.js';
import { assertBytes, assertCompressedPubkey, assertString, NOOP_LOGGER } from './helpers.js';
import type { Logger } from './types.js';

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
 * DID method operations sub-facade: create, resolve, update, deactivate.
 *
 * Lazily initialized by {@link DidBtcr2Api} because it depends on
 * {@link BitcoinApi} which requires network configuration.
 * @public
 */
export class DidMethodApi {
  #btc?: BitcoinApi;
  #cas?: CasApi;
  #log: Logger;

  constructor(btc?: BitcoinApi, cas?: CasApi, logger?: Logger) {
    this.#btc = btc;
    this.#cas = cas;
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
   * Resolve a DID by driving the sans-I/O `Resolver` state machine (from @did-btcr2/method).
   * If a Bitcoin connection is configured on the API, it is used automatically
   * to fetch beacon signals. Sidecar data flows through `options.sidecar`.
   * @param did The DID to resolve.
   * @param options Resolution options.
   * @returns The resolution result.
   */
  async resolve(did: string, options?: ResolutionOptions): Promise<DidResolutionResult> {
    assertString(did, 'did');
    this.#log.debug('Resolving DID', did);
    try {
      const resolver = DidBtcr2.resolve(did, options);
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
                'Fetching beacon signals for %d service(s)',
                need.beaconServices.length
              );
              const signals = await BeaconSignalDiscovery.indexer(
                [...need.beaconServices], this.#btc.connection
              );
              resolver.provide(need, signals);
              break;
            }
            case 'NeedGenesisDocument': {
              if(!this.#cas) {
                throw new Error(
                  `Genesis document required but not in sidecar (hash: ${need.genesisHash}), `
                  + 'and no CAS driver configured. Either provide the genesis document via '
                  + 'options.sidecar.genesisDocument or configure a CAS driver.'
                );
              }
              this.#log.debug('Fetching genesis document from CAS: %s', need.genesisHash);
              const doc = await this.#cas.retrieve(decodeHash(need.genesisHash, 'hex'));
              if(!doc) {
                throw new Error(
                  `Genesis document not found in CAS (hash: ${need.genesisHash}).`
                );
              }
              resolver.provide(need as NeedGenesisDocument, doc);
              break;
            }
            case 'NeedCASAnnouncement': {
              if(!this.#cas) {
                throw new Error(
                  `CAS announcement required but not in sidecar (hash: ${need.announcementHash}), `
                  + 'and no CAS driver configured. Either provide it via '
                  + 'options.sidecar.casUpdates or configure a CAS driver.'
                );
              }
              this.#log.debug('Fetching CAS announcement from CAS: %s', need.announcementHash);
              const announcement = await this.#cas.retrieve(decodeHash(need.announcementHash, 'hex'));
              if(!announcement) {
                throw new Error(
                  `CAS announcement not found in CAS (hash: ${need.announcementHash}).`
                );
              }
              resolver.provide(need as NeedCASAnnouncement, announcement as CASAnnouncement);
              break;
            }
            case 'NeedSignedUpdate': {
              if(!this.#cas) {
                throw new Error(
                  `Signed update required but not in sidecar (hash: ${need.updateHash}), `
                  + 'and no CAS driver configured. Either provide it via '
                  + 'options.sidecar.updates or configure a CAS driver.'
                );
              }
              this.#log.debug('Fetching signed update from CAS: %s', need.updateHash);
              const update = await this.#cas.retrieve(decodeHash(need.updateHash, 'hex'));
              if(!update) {
                throw new Error(
                  `Signed update not found in CAS (hash: ${need.updateHash}).`
                );
              }
              resolver.provide(need as NeedSignedUpdate, update as SignedBTCR2Update);
              break;
            }
            case 'NeedSMTProof': {
              // SMT proofs are nonce-blinded, so they are not content-addressed
              // by anything on-chain and cannot be fetched from a CAS. Sidecar
              // is the only channel; without it the need is unfulfillable.
              throw new Error(
                `SMT proof required but not in sidecar (root hash: ${need.smtRootHash}). `
                + 'SMT proofs cannot be fetched from a CAS; provide the proof via '
                + 'options.sidecar.smtProofs.'
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
      return {
        didResolutionMetadata : {},
        didDocument           : state.result.didDocument as unknown as DidResolutionResult['didDocument'],
        didDocumentMetadata   : state.result.metadata,
      };
    } catch (err) {
      this.#log.error('DID resolution failed', did, err);
      throw new Error(
        `Failed to resolve DID: ${did}`,
        { cause: err }
      );
    }
  }

  /**
   * Update an existing DID document by driving the sans-I/O {@link Updater} state
   * machine (from @did-btcr2/method). This method handles the I/O side:
   * - Signing: supplies the {@link Signer} to `NeedSigningKey`.
   * - CAS publication: publishes the signed update (and, for CAS beacons, the
   *   announcement) to the configured CAS per the `publishToCas` policy,
   *   **before** the on-chain broadcast, so any OP_RETURN update hash is
   *   fetchable from CAS at resolution time without sidecar data.
   * - Broadcast: establishes a beacon via {@link BeaconFactory} and calls
   *   `broadcastSignal()` with the bitcoin connection configured on the API.
   *
   * For multi-party aggregation of SMT/CAS beacons, the caller should drive the
   * Updater directly and delegate `NeedBroadcast` to the aggregation runner
   * rather than using this high-level method.
   *
   * @param params The update parameters.
   * @returns The broadcast artifacts: signed update, signal txid, per-beacon-type
   *   sidecar data, and which artifacts were published to CAS.
   */
  async update({
    sourceDocument,
    patches,
    sourceVersionId,
    verificationMethodId,
    beaconId,
    signer,
    bitcoin,
    publishToCas = 'never',
    broadcastOptions,
  }: {
    sourceDocument: Btcr2DidDocument;
    patches: PatchOperation[];
    sourceVersionId: number;
    verificationMethodId: string;
    beaconId: string;
    signer: Signer;
    bitcoin?: BitcoinConnection;
    publishToCas?: PublishToCasMode;
    broadcastOptions?: BroadcastOptions;
  }): Promise<DidUpdateResult> {
    // Bitcoin connection resolution order: per-call `bitcoin` param wins over the
    // BitcoinApi injected at DidBtcr2Api construction time. One of the two must
    // be present; this can't be encoded in the type system, so it's a runtime check.
    const btcConnection = bitcoin ?? this.#btc?.connection;
    if(!btcConnection) {
      throw new UpdateError(
        'Bitcoin connection required for update. Pass a configured `bitcoin` parameter '
        + 'or configure a BitcoinApi on the DidBtcr2Api instance.',
        INVALID_DID_UPDATE, { beaconId }
      );
    }

    this.#log.debug('Updating DID', sourceDocument.id, { beaconId, verificationMethodId });

    // Factory validates and returns a sans-I/O state machine
    const updater = DidBtcr2.update({
      sourceDocument,
      patches,
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
            this.#log.debug('Beacon address funded (%d UTXOs)', utxos.length);
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
            const beacon = BeaconFactory.establish(need.beaconService);
            broadcastResult = await beacon.broadcastSignal(
              need.signedUpdate, signer, btcConnection, options
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
   * const { signedUpdate, txid } = await api.btcr2
   *   .buildUpdate(currentDoc)
   *   .patch({ op: 'add', path: '/service/1', value: newService })
   *   .version(2)
   *   .verificationMethodId(`${currentDoc.id}#initialKey`)
   *   .beacon(currentDoc.service[0].id)
   *   .signer(new LocalSigner(secretKey))
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
  #signer?: Signer;
  #bitcoin?: BitcoinConnection;
  #publishToCas?: PublishToCasMode;
  #broadcastOptions?: BroadcastOptions;

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

  /** Set the verification method ID used for signing the update. */
  verificationMethodId(methodId: string): this {
    this.#verificationMethodId = methodId;
    return this;
  }

  /** Set the beacon ID for the update announcement. */
  beacon(beaconId: string): this {
    this.#beaconId = beaconId;
    return this;
  }

  /**
   * Set the {@link Signer} that produces the update's BIP-340 Schnorr proof
   * and the beacon transaction's ECDSA input signature. Use `LocalSigner`
   * for in-process secret keys, `KeyManagerSigner` for KMS-managed keys
   * (AWS, Vault, HSM, etc.), or any custom adapter implementing the `Signer`
   * interface.
   */
  signer(s: Signer): this {
    this.#signer = s;
    return this;
  }

  /** Override the Bitcoin connection for this update. */
  bitcoin(connection: BitcoinConnection): this {
    this.#bitcoin = connection;
    return this;
  }

  /** Set the CAS publication policy for this update (default `'never'`; opt-in). */
  publishToCas(mode: PublishToCasMode): this {
    this.#publishToCas = mode;
    return this;
  }

  /** Set beacon broadcast options (fee estimator, change address). */
  broadcastOptions(options: BroadcastOptions): this {
    this.#broadcastOptions = options;
    return this;
  }

  /**
   * Execute the update.
   * @throws {Error} If required fields (version, verificationMethodId, beacon, signer) are missing.
   */
  async execute(): Promise<DidUpdateResult> {
    if (this.#sourceVersionId === undefined) {
      throw new Error('UpdateBuilder: sourceVersionId is required. Call .version(id) before .execute().');
    }
    if (!this.#verificationMethodId) {
      throw new Error(
        'UpdateBuilder: verificationMethodId is required. '
        + 'Call .verificationMethodId(id) before .execute().'
      );
    }
    if (!this.#beaconId) {
      throw new Error('UpdateBuilder: beaconId is required. Call .beacon(id) before .execute().');
    }
    if (!this.#signer) {
      throw new Error('UpdateBuilder: signer is required. Call .signer(s) before .execute().');
    }

    return this.#methodApi.update({
      sourceDocument       : this.#sourceDocument,
      patches              : this.#patches,
      sourceVersionId      : this.#sourceVersionId,
      verificationMethodId : this.#verificationMethodId,
      beaconId             : this.#beaconId,
      signer               : this.#signer,
      bitcoin              : this.#bitcoin,
      publishToCas         : this.#publishToCas,
      broadcastOptions     : this.#broadcastOptions,
    });
  }
}
