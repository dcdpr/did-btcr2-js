import type { BitcoinConnection, NetworkName } from '@did-btcr2/bitcoin';
import type { DocumentBytes, KeyBytes, PatchOperation } from '@did-btcr2/common';
import { decode as decodeHash, IdentifierHrp, IdentifierTypes, INVALID_DID_UPDATE, ResolveError, UpdateError } from '@did-btcr2/common';
import type { Signer } from '@did-btcr2/keypair';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import type { BeaconService, BroadcastOptions, BroadcastResult, Btcr2DidDocument, CASAnnouncement, CASBroadcastOptions, DidCreateOptions, DidDocument, NeedCASAnnouncement, NeedGenesisDocument, NeedSignedUpdate, ResolutionOptions, SignedBTCR2Update, SMTProof } from '@did-btcr2/method';
import { BeaconError, BeaconFactory, BeaconSignalDiscovery, BeaconUtils, DidBtcr2, Identifier, Resolver, selectSpendableUtxo } from '@did-btcr2/method';
import type { DidResolutionResult, DidVerificationMethod } from '@web5/dids';
import type { BitcoinApi } from './bitcoin.js';
import type { CasApi } from './cas.js';
import { assertBytes, assertCompressedPubkey, assertString, NOOP_LOGGER, rootCauseMessage } from './helpers.js';
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
   * patch, which is what {@link DidMethodApi.deactivate} broadcasts.
   */
  static readonly DEACTIVATION_PATCH: Readonly<PatchOperation> = Object.freeze({
    op    : 'add',
    path  : '/deactivated',
    value : true,
  });

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
   * Resolve a DID by driving the sans-I/O `Resolver` state machine (from @did-btcr2/method).
   * If a Bitcoin connection is configured on the API, it is used automatically
   * to fetch beacon signals. Sidecar data flows through `options.sidecar`.
   * If the DID names a network other than the connection's, resolution is
   * refused before any chain read.
   * @param did The DID to resolve.
   * @param options Resolution options.
   * @returns The resolution result.
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
        `Failed to resolve DID ${did}: ${rootCauseMessage(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Update an existing DID document by driving the sans-I/O {@link Updater} state
   * machine (from @did-btcr2/method). This method handles the I/O side:
   * - Signing: supplies the {@link Signer} to `NeedSigningKey`.
   * - Funding: reads the UTXOs at the beacon address and refuses the update if
   *   none is spendable. A spendable UTXO is confirmed and above the dust
   *   limit. The beacon applies the same rule at broadcast.
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
   * Every write path (`updateDid`, `UpdateBuilder.execute`, `deactivate`)
   * passes through here, so the refusal holds for all of them.
   *
   * The caller can omit `verificationMethodId` and `beaconId`. The api then
   * derives them, after the guards above and before any signature. The
   * verification method is the one method on the source document that
   * publishes the signer's key. The Updater refuses every other method, so
   * the signer's key identifies the method.
   *
   * The beacon is the only beacon service, with no chain read. If the
   * document has several beacon services, the beacon is the one whose
   * address holds a spendable UTXO. If no method or no beacon matches, the
   * api refuses the update. If several match, the api refuses the update and
   * names the candidates.
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
    verificationMethodId?: string;
    beaconId?: string;
    signer: Signer;
    bitcoin?: BitcoinConnection;
    publishToCas?: PublishToCasMode;
    broadcastOptions?: BroadcastOptions;
  }): Promise<DidUpdateResult> {
    // A deactivated document takes no further update: resolution halts at the
    // deactivation, so anything signed and broadcast on top of it spends a
    // beacon UTXO on an announcement no resolver will ever read. Refused here,
    // at the single chokepoint every write path (updateDid, the builder,
    // deactivate) passes through, before any connection is touched.
    if(sourceDocument?.deactivated) {
      throw new UpdateError(
        `DID document ${sourceDocument.id} is deactivated and cannot be updated. `
        + 'Deactivation is irreversible: resolution halts at the deactivation, so '
        + 'no later update is ever applied.',
        INVALID_DID_UPDATE, { did: sourceDocument.id }
      );
    }

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
    // signing method. The beacon is the one beacon that holds a spendable
    // UTXO. The api never picks one of several silently. The derivation runs
    // after the guards above, so a refused update reads nothing.
    verificationMethodId ??= this.#deriveVerificationMethodId(sourceDocument, signer);
    beaconId ??= await this.#deriveBeaconId(sourceDocument, btcConnection);

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
            // The beacon spends only a confirmed UTXO above the dust limit. The
            // guard applies that rule through the beacon's own selector, so an
            // address that is funded but not spendable fails here, before any
            // CAS publication, with the reason the beacon gives at broadcast.
            try {
              selectSpendableUtxo(utxos, need.beaconAddress);
            } catch (err) {
              if(!(err instanceof BeaconError)) throw err;
              throw new UpdateError(
                `Beacon address ${need.beaconAddress} cannot fund this update. ${err.message} `
                + 'Wait for a confirmation, or fund the address above the dust limit, '
                + 'before you broadcast the update.',
                INVALID_DID_UPDATE, { beaconAddress: need.beaconAddress, utxos: utxos.length }
              );
            }
            this.#log.debug('Beacon address funded with a spendable UTXO (%d UTXOs)', utxos.length);
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
   * whose address holds a spendable UTXO (confirmed, above the dust limit).
   * If no beacon holds one, the helper refuses and names every address. If
   * several beacons hold one, the helper refuses and names them. The api
   * never decides which UTXO to spend.
   */
  async #deriveBeaconId(document: Btcr2DidDocument, bitcoin: BitcoinConnection): Promise<string> {
    const beacons = this.getBeacons(document);
    if(beacons.length === 1) return beacons[0]!.id;
    if(beacons.length === 0) {
      throw new UpdateError(
        `DID document ${document.id} has no beacon service. The api cannot derive beaconId.`,
        INVALID_DID_UPDATE, { did: document.id }
      );
    }
    const funded: BeaconInfo[] = [];
    for(const beacon of beacons) {
      const utxos = await bitcoin.rest.address.getUtxos(beacon.address);
      try {
        selectSpendableUtxo(utxos, beacon.address);
        funded.push(beacon);
      } catch (err) {
        // This address is unfunded, unconfirmed, or dust, so it is not a
        // candidate. A different error is a fault of the UTXO list itself.
        // The api throws that error again.
        if(!(err instanceof BeaconError)) throw err;
      }
    }
    if(funded.length === 1) return funded[0]!.id;
    if(funded.length === 0) {
      const list = beacons.map(beacon => `${beacon.id} (${beacon.address})`).join(', ');
      throw new UpdateError(
        `No beacon of DID ${document.id} holds a spendable UTXO. The api cannot derive beaconId. `
        + 'A spendable UTXO is confirmed and above the dust limit. '
        + `Fund one of: ${list}.`,
        INVALID_DID_UPDATE, { did: document.id, beacons }
      );
    }
    const ids = funded.map(beacon => beacon.id);
    throw new UpdateError(
      `${funded.length} beacons of DID ${document.id} hold a spendable UTXO: ${ids.join(', ')}. `
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
   * The caller can omit `verificationMethodId` and `beaconId`.
   * {@link DidMethodApi.update} derives them.
   *
   * @param params The update parameters minus `patches` (the deactivation
   *   patch is supplied for you).
   * @returns The broadcast artifacts, exactly as {@link DidMethodApi.update}.
   */
  async deactivate(params: {
    sourceDocument: Btcr2DidDocument;
    sourceVersionId: number;
    verificationMethodId?: string;
    beaconId?: string;
    signer: Signer;
    bitcoin?: BitcoinConnection;
    publishToCas?: PublishToCasMode;
    broadcastOptions?: BroadcastOptions;
  }): Promise<DidUpdateResult> {
    if(params.sourceDocument?.deactivated) {
      throw new UpdateError(
        `DID document ${params.sourceDocument.id} is already deactivated. `
        + 'Deactivation is irreversible: a further deactivation update could '
        + 'never be read back, because resolution halts at the first.',
        INVALID_DID_UPDATE, { did: params.sourceDocument.id }
      );
    }
    return this.update({
      ...params,
      patches : [{ ...DidMethodApi.DEACTIVATION_PATCH }],
    });
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
