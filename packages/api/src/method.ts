import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { DocumentBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import { decode as decodeHash, encode as encodeHash, IdentifierTypes, INVALID_DID_UPDATE, NotImplementedError, UpdateError } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
import type { Btcr2DidDocument, CASAnnouncement, DataNeed, DidCreateOptions, NeedCASAnnouncement, NeedGenesisDocument, NeedSignedUpdate, NeedSMTProof, ResolutionOptions, SMTProof, UpdaterDataNeed } from '@did-btcr2/method';
import { BeaconFactory, BeaconSignalDiscovery, DidBtcr2 } from '@did-btcr2/method';
import type { DidResolutionResult, DidVerificationMethod } from '@web5/dids';
import type { BitcoinApi } from './bitcoin.js';
import type { CasApi } from './cas.js';
import { assertBytes, assertCompressedPubkey, assertString, NOOP_LOGGER } from './helpers.js';
import type { Logger } from './types.js';

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
    this.#log.debug('Resolving DID: %s', did);
    if(options?.sidecar) {
      this.#log.debug(
        'Sidecar provided: %s',
        [
          options.sidecar.genesisDocument && 'genesisDocument',
          options.sidecar.updates?.length && `${options.sidecar.updates.length} updates`,
          options.sidecar.casUpdates?.length && `${options.sidecar.casUpdates.length} casUpdates`,
          options.sidecar.smtProofs?.length && `${options.sidecar.smtProofs.length} smtProofs`,
        ].filter(Boolean).join(', ') || '(empty)',
      );
    }
    try {
      const resolver = DidBtcr2.resolve(did, options);
      let state = resolver.resolve();
      let iteration = 0;

      while(state.status === 'action-required') {
        iteration++;
        this.#log.debug(
          'Resolver iteration %d: %d need(s) [%s]',
          iteration,
          state.needs.length,
          state.needs.map((n) => n.kind).join(', '),
        );
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
                'Fetching beacon signals for %d service(s):',
                need.beaconServices.length,
              );
              for(const svc of need.beaconServices) {
                this.#log.debug('  - %s [%s] %s', svc.id, svc.type, svc.serviceEndpoint);
              }
              const signals = await BeaconSignalDiscovery.indexer(
                [...need.beaconServices], this.#btc.connection
              );
              for(const [svc, sigList] of signals) {
                this.#log.debug(
                  '  signals at %s: %d found%s',
                  svc.id,
                  sigList.length,
                  sigList.length > 0 ? ` (first signalBytes: ${sigList[0].signalBytes})` : '',
                );
              }
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
              this.#log.debug('Genesis document retrieved (%d bytes)', JSON.stringify(doc).length);
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
              this.#log.debug('CAS announcement retrieved');
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
              this.#log.debug('Signed update retrieved');
              resolver.provide(need as NeedSignedUpdate, update as SignedBTCR2Update);
              break;
            }
            case 'NeedSMTProof': {
              // SMT proofs cannot be retrieved from CAS by design. They MUST be
              // supplied via options.sidecar.smtProofs. If the resolver asks for
              // one that wasn't found in the initial sidecar, the sidecar either
              // omitted the proof or used a different key encoding than the
              // hex-encoded smtRootHash carried by the on-chain signal.
              this.#log.debug(
                'NeedSMTProof for root hash %s (beacon %s)',
                need.smtRootHash, need.beaconServiceId,
              );
              // Per spec, proof.id is base64urlnopad; need.smtRootHash is hex
              // (from the OP_RETURN payload). Match by decoding both to bytes.
              const proof = options?.sidecar?.smtProofs?.find((p) => {
                try {
                  return encodeHash(decodeHash(p.id, 'base64urlnopad'), 'hex') === need.smtRootHash;
                } catch {
                  return false;
                }
              });
              if(!proof) {
                const available = options?.sidecar?.smtProofs?.map((p) => p.id).join(', ') ?? '(none)';
                throw new Error(
                  `SMT proof not in sidecar. Required root hash (hex): ${need.smtRootHash}. `
                  + `Available proof ids (spec-encoded base64urlnopad): ${available}. `
                  + 'SMT proofs cannot be fetched from CAS by design; supply via options.sidecar.smtProofs. '
                  + 'Per the did:btcr2 spec, proof.id MUST be base64urlnopad-encoded.',
                );
              }
              this.#log.debug('SMT proof matched in sidecar (id=%s)', proof.id);
              resolver.provide(need as NeedSMTProof, proof as SMTProof);
              break;
            }
            default: {
              // Exhaustiveness check: if a new DataNeed variant is added without
              // a case above, TS catches it at compile time, and the throw
              // catches it at runtime if a non-TS caller hands us bad data.
              const _exhaustive: never = need;
              throw new Error(
                `Unhandled DataNeed kind: ${(_exhaustive as DataNeed).kind}. `
                + 'This is a resolver bug: please file an issue. Adding a new DataNeed '
                + 'variant requires a corresponding case in DidMethodApi.resolve().',
              );
            }
          }
        }
        state = resolver.resolve();
      }

      this.#log.debug('DID resolved: versionId=%s, deactivated=%s',
        state.result.metadata.versionId, state.result.metadata.deactivated ?? false);
      return {
        didResolutionMetadata : {},
        didDocument           : state.result.didDocument as unknown as DidResolutionResult['didDocument'],
        didDocumentMetadata   : state.result.metadata,
      };
    } catch (err) {
      this.#log.error('DID resolution failed: %s', (err as Error).message);
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
   * - Broadcast: establishes a beacon via {@link BeaconFactory} and calls
   *   `broadcastSignal()` with the bitcoin connection configured on the API.
   *
   * For multi-party aggregation of SMT/CAS beacons, the caller should drive the
   * Updater directly and delegate `NeedBroadcast` to the aggregation runner
   * rather than using this high-level method.
   *
   * @param params The update parameters.
   * @returns The signed update.
   */
  async update({
    sourceDocument,
    patches,
    sourceVersionId,
    verificationMethodId,
    beaconId,
    signer,
    bitcoin,
  }: {
    sourceDocument: Btcr2DidDocument;
    patches: PatchOperation[];
    sourceVersionId: number;
    verificationMethodId: string;
    beaconId: string;
    signer: Signer;
    bitcoin?: BitcoinConnection;
  }): Promise<SignedBTCR2Update> {
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

    // Drive the state machine. All I/O (signing delegation, Bitcoin broadcast)
    // happens inside the need-handlers below — the Updater itself is pure.
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
            this.#log.debug(
              'Broadcasting signed update via %s beacon', need.beaconService.type
            );
            const beacon = BeaconFactory.establish(need.beaconService, need.did);
            await beacon.broadcastSignal(need.signedUpdate, signer, btcConnection);
            updater.provide(need);
            break;
          }
          default: {
            // Exhaustiveness check: same pattern as resolve() above.
            const _exhaustive: never = need;
            throw new Error(
              `Unhandled UpdaterDataNeed kind: ${(_exhaustive as UpdaterDataNeed).kind}. `
              + 'Adding a new UpdaterDataNeed variant requires a corresponding case in DidMethodApi.update().',
            );
          }
        }
      }
      state = updater.advance();
    }

    this.#log.debug('DID update complete', sourceDocument.id);
    return state.result.signedUpdate;
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
   *   .verificationMethodId('#initialKey')
   *   .beacon('#beacon-0')
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

  /**
   * Execute the update.
   * @throws {Error} If required fields (version, verificationMethodId, beacon, signer) are missing.
   */
  async execute(): Promise<SignedBTCR2Update> {
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
    });
  }
}
