import { getNetwork } from '@did-btcr2/bitcoin';
import {
  canonicalHash,
  canonicalHashBytes,
  canonicalize,
  DateUtils,
  encode as encodeHash,
  decode as decodeHash,
  INTERNAL_ERROR,
  INVALID_DID_DOCUMENT,
  INVALID_DID_UPDATE,
  JSONPatch,
  JSONUtils,
  LATE_PUBLISHING_ERROR,
  ResolveError
} from '@did-btcr2/common';
import type { HashBytes } from '@did-btcr2/common';
import type {
  SignedBTCR2Update,
  UnsignedBTCR2Update
} from './btcr2-update.js';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  SchnorrMultikey
} from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../did-btcr2.js';
import { Appendix } from '../utils/appendix.js';
import { DidDocument, ID_PLACEHOLDER_VALUE } from '../utils/did-document.js';
import { BeaconFactory } from './beacon/factory.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from './beacon/interfaces.js';
import { BeaconUtils } from './beacon/utils.js';
import type { DidComponents} from './identifier.js';
import { Identifier } from './identifier.js';
import type { SMTProof } from './interfaces.js';
import type { CASAnnouncement, Sidecar, SidecarData } from './types.js';
import { equalBytes } from '@noble/curves/utils.js';

/**
 * The response object for DID Resolution.
 */
export interface DidResolutionResponse {
  didDocument: DidDocument;
  metadata: {
    confirmations?: number;
    versionId: string;
    updated?: string;
    deactivated?: boolean;
  }
}

/** The resolver needs a genesis document whose hash matches genesisHash. */
export interface NeedGenesisDocument {
  readonly kind: 'NeedGenesisDocument';
  /** Hex-encoded SHA-256 hash from the DID identifier's genesisBytes. */
  readonly genesisHash: string;
}

/** The resolver needs beacon signals for these beacon service addresses. */
export interface NeedBeaconSignals {
  readonly kind: 'NeedBeaconSignals';
  /** The beacon services that need signal data. Pass directly to BeaconSignalDiscovery. */
  readonly beaconServices: ReadonlyArray<BeaconService>;
}

/** The resolver needs a CAS Announcement whose canonical hash matches announcementHash. */
export interface NeedCASAnnouncement {
  readonly kind: 'NeedCASAnnouncement';
  /** Hex-encoded canonical hash of the CAS Announcement. */
  readonly announcementHash: string;
  /** The beacon service that produced this signal. */
  readonly beaconServiceId: string;
}

/** The resolver needs a SignedBTCR2Update whose canonical hash matches updateHash. */
export interface NeedSignedUpdate {
  readonly kind: 'NeedSignedUpdate';
  /** Hex-encoded canonical hash of the signed update. */
  readonly updateHash: string;
  /** The beacon service that produced this signal. */
  readonly beaconServiceId: string;
}

/** The resolver needs an SMT Proof whose root hash matches smtRootHash. */
export interface NeedSMTProof {
  readonly kind: 'NeedSMTProof';
  /** Hex-encoded SHA-256 root hash of the Sparse Merkle Tree. */
  readonly smtRootHash: string;
  /** The beacon service that produced this signal. */
  readonly beaconServiceId: string;
}

/** Discriminated union of all data the resolver may request from the caller. */
export type DataNeed = NeedGenesisDocument | NeedBeaconSignals | NeedCASAnnouncement | NeedSignedUpdate | NeedSMTProof;

/**
 * Output of {@link Resolver.resolve}. Analogous to Rust's `ResolverState` enum.
 * Either the resolver needs data from the caller, or resolution is complete.
 */
export type ResolverState =
  | { status: 'action-required'; needs: ReadonlyArray<DataNeed> }
  | { status: 'resolved'; result: DidResolutionResponse };

/**
 * Return type from {@link SinglePartyBeacon.processSignals}.
 * Contains successfully resolved updates and any data needs that must be
 * satisfied before the remaining signals can be processed.
 */
export interface BeaconProcessResult {
  updates: Array<[SignedBTCR2Update, BlockMetadata]>;
  needs: Array<DataNeed>;
}

// ─── provide() payload guards ────────────────────────────────────────────────
// Runtime shape checks so a malformed payload fails fast at the provide()
// boundary rather than flowing downstream as an unchecked `as` cast.

/** True if `value` is a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True if `value` has the shape of a CAS Announcement (a flat record of string hashes). */
function isCASAnnouncement(value: unknown): value is CASAnnouncement {
  return isRecord(value) && Object.values(value).every(v => typeof v === 'string');
}

/**
 * True if `value` has the shape of a signed BTCR2 update. targetVersionId must be an
 * integer of at least 2: an update targets the version after the one it patches, and
 * genesis is version 1, so no conformant update can target a lower version (ADR 068).
 */
function isSignedBTCR2Update(value: unknown): value is SignedBTCR2Update {
  if(!isRecord(value)) return false;
  return Array.isArray(value.patch)
    && typeof value.sourceHash === 'string'
    && typeof value.targetHash === 'string'
    && Number.isInteger(value.targetVersionId)
    && (value.targetVersionId as number) >= 2
    && isRecord(value.proof);
}

/** True if `value` has the shape of an SMT inclusion / non-inclusion proof. */
function isSMTProof(value: unknown): value is SMTProof {
  if(!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.collapsed === 'string'
    && Array.isArray(value.hashes);
}

/**
 * Different possible Resolver states representing phases in the resolution process.
 */
enum ResolverPhase {
  GenesisDocument = 'GenesisDocument',
  BeaconDiscovery = 'BeaconDiscovery',
  BeaconProcess   = 'BeaconProcess',
  ApplyUpdates    = 'ApplyUpdates',
  Complete        = 'Complete',
}

/**
 * Sans-I/O state machine for did:btcr2 resolution.
 *
 * Created by {@link DidBtcr2.resolve} (the factory). The caller drives resolution
 * by repeatedly calling {@link resolve} and {@link provide}:
 *
 * ```typescript
 * const resolver = DidBtcr2.resolve(did, { sidecar });
 * let state = resolver.resolve();
 *
 * while (state.status === 'action-required') {
 *   for (const need of state.needs) { ... fetch & provide ... }
 *   state = resolver.resolve();
 * }
 * const { didDocument, metadata } = state.result;
 * ```
 *
 * The Resolver performs **zero I/O**. All external data (Bitcoin signals, CAS
 * data, genesis documents) flows through the advance/provide protocol.
 *
 * @class Resolver
 */
export class Resolver {
  // --- Immutable inputs ---
  readonly #didComponents: DidComponents;
  readonly #versionId?: string;
  readonly #versionTime?: string;

  /**
   * The specific phase the Resolver is current in.
   */
  #phase: ResolverPhase;
  #sidecarData: SidecarData;
  #currentDocument: DidDocument | null;
  #providedGenesisDocument: object | null = null;
  #beaconServicesSignals: Map<BeaconService, Array<BeaconSignal>> = new Map();
  #processedServices: Set<string> = new Set();
  #requestCache: Set<string> = new Set();
  #unsortedUpdates: Array<[SignedBTCR2Update, BlockMetadata]> = [];
  #resolvedResponse: DidResolutionResponse | null = null;

  /**
   * Monotonic DID-document version counter and the update-hash history that backs
   * duplicate confirmation, both carried across the entire resolution. The spec's
   * read algorithm keeps a single version counter and a single update-hash history
   * for the whole signal-processing loop, re-deriving beacons from the contemporary
   * document on each pass. This sans-I/O resolver splits that one loop into discovery
   * rounds, so the two must persist across rounds rather than restart each pass.
   * Restarting them would reject a legitimate linear history whose later updates are
   * announced on beacons that earlier updates added: round two would forget it had
   * already reached version two, see version three, and raise a late-publishing error.
   */
  #currentVersionId = 1;
  #updateHashHistory: HashBytes[] = [];

  /**
   * Opt-in upper bound on multi-round beacon-discovery passes. `Infinity` (the
   * default) leaves discovery unbounded; termination is already guaranteed by
   * de-duplicating already-queried beacon addresses. A positive value is a
   * caller-imposed resource guard; a non-positive value or omission means no limit.
   */
  readonly #maxDiscoveryRounds: number;
  /** Count of beacon-discovery passes driven by updates adding new beacon services. */
  #discoveryRounds = 0;

  /**
   * @internal Use {@link DidBtcr2.resolve} to create instances.
   */
  constructor(
    didComponents: DidComponents,
    sidecarData: SidecarData,
    currentDocument: DidDocument | null,
    options?: { versionId?: string; versionTime?: string; genesisDocument?: object; maxDiscoveryRounds?: number }
  ) {
    this.#didComponents = didComponents;
    this.#sidecarData = sidecarData;
    this.#currentDocument = currentDocument;
    this.#versionId = options?.versionId;
    this.#versionTime = options?.versionTime;
    // Discovery is unbounded by default; a positive maxDiscoveryRounds opts into a
    // finite resource guard. A non-positive or omitted value means no limit.
    const rounds = options?.maxDiscoveryRounds;
    this.#maxDiscoveryRounds = typeof rounds === 'number' && rounds > 0 ? rounds : Infinity;

    // If a genesis document was provided (from sidecar), pre-seed it for validation
    if(options?.genesisDocument) {
      this.#providedGenesisDocument = options.genesisDocument;
    }

    // If current document was established by the factory, skip GenesisDocument phase
    this.#phase = currentDocument
      ? ResolverPhase.BeaconDiscovery
      : ResolverPhase.GenesisDocument;
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#if-genesis_bytes-is-a-secp256k1-public-key | 7.2.d.1 if genesis bytes is a secp256k1 Public Key}.
   * @param {DidComponents} didComponents The decoded components of the did.
   * @returns {DidDocument} The resolved DID Document object.
   */
  static deterministic(didComponents: DidComponents): DidDocument {
    // Deconstruct the bytes from the given components
    const genesisBytes = didComponents.genesisBytes;

    // Encode the did from the didComponents
    const did = Identifier.encode(genesisBytes, didComponents);

    // Construct a new CompressedSecp256k1PublicKey and deconstruct the publicKey and publicKeyMultibase
    const { multibase } = new CompressedSecp256k1PublicKey(genesisBytes);

    // Generate the service field for the DID Document
    const service = BeaconUtils.generateBeaconServices({
      id         : did,
      publicKey  : genesisBytes,
      network    : getNetwork(didComponents.network),
      beaconType : 'SingletonBeacon'
    });

    return new DidDocument({
      id                 : did,
      verificationMethod : [{
        id                 : `${did}#initialKey`,
        type               : 'Multikey',
        controller         : did,
        publicKeyMultibase : multibase.encoded
      }],
      service
    });
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#if-genesis_bytes-is-a-sha-256-hash | 7.2.d.2 if genesis_bytes is a SHA-256 Hash}.
   * @param {DidComponents} didComponents BTCR2 DID components used to resolve the DID Document
   * @param {object} genesisDocument The genesis document for resolving the DID Document.
   * @returns {DidDocument} The resolved DID Document object
   * @throws {ResolveError} InvalidDidDocument if not conformant to DID Core v1.1
   */
  static external(
    didComponents: DidComponents,
    genesisDocument: object,
  ): DidDocument {
    // Canonicalize and sha256 hash the genesis document
    const genesisDocumentHash = canonicalHashBytes(genesisDocument);

    // Compare genesis bytes from identifier against the document hash (byte comparison)
    if (!equalBytes(didComponents.genesisBytes, genesisDocumentHash)) {
      throw new ResolveError(
        `Initial document mismatch: genesisBytes !== genesisDocumentHash`,
        INVALID_DID_DOCUMENT, {
          genesisBytes        : encodeHash(didComponents.genesisBytes, 'hex'),
          genesisDocumentHash : encodeHash(genesisDocumentHash, 'hex')
        }
      );
    }

    // Encode the did from the didComponents
    const did = Identifier.encode(didComponents.genesisBytes, didComponents);

    // Replace the placeholder did with the did throughout the currentDocument.
    const currentDocument = JSON.parse(
      JSON.stringify(genesisDocument).replaceAll(ID_PLACEHOLDER_VALUE, did)
    );

    // Return a W3C conformant DID Document
    return new DidDocument(currentDocument);
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-sidecar-data | Process Sidecar Data}
   * @param {Sidecar} sidecar The sidecar data to process.
   * @returns {SidecarData} The processed sidecar data containing maps of updates, CAS announcements, and SMT proofs.
   */
  static sidecarData(sidecar: Sidecar = {} as Sidecar): SidecarData {
    // BTCR2 Signed Updates map
    const updateMap = new Map<string, SignedBTCR2Update>();
    if(sidecar.updates?.length)
      for(const update of sidecar.updates) {
        updateMap.set(canonicalHash(update, { encoding: 'hex' }), update);
      }

    // CAS Announcements map
    const casMap = new Map<string, CASAnnouncement>();
    if(sidecar.casUpdates?.length)
      for(const update of sidecar.casUpdates) {
        casMap.set(canonicalHash(update, { encoding: 'hex' }), update);
      }

    // SMT Proofs map. proof.id is base64url per the SMT Proof spec; key by the
    // hex root hash so lookups match the hex signalBytes from the OP_RETURN.
    const smtMap = new Map<string, SMTProof>();
    if(sidecar.smtProofs?.length)
      for(const proof of sidecar.smtProofs) {
        smtMap.set(encodeHash(decodeHash(proof.id, 'base64urlnopad'), 'hex'), proof);
      }

    return { updateMap, casMap, smtMap };
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-updates | 7.2.f Process updates Array}.
   * @param {DidDocument} currentDocument The current DID Document to apply the updates to.
   * @param {Array<[SignedBTCR2Update, BlockMetadata]>} unsortedUpdates The unsorted array of BTCR2 Signed Updates and their associated Block Metadata.
   * @param {string} [versionTime] The optional version time to limit updates to.
   * @param {string} [versionId] The optional version id to limit updates to.
   * @param {{ currentVersionId: number; updateHashHistory: HashBytes[] }} [resolutionState]
   *   Version counter and update-hash history carried from earlier discovery rounds.
   *   Standalone callers omit it and start fresh at version 1 with an empty history.
   * @returns {DidResolutionResponse} The updated DID Document, number of confirmations, and version id.
   */
  static updates(
    currentDocument: DidDocument,
    unsortedUpdates: Array<[SignedBTCR2Update, BlockMetadata]>,
    versionTime?: string,
    versionId?: string,
    resolutionState: { currentVersionId: number; updateHashHistory: HashBytes[] } =
    { currentVersionId: 1, updateHashHistory: [] }
  ): DidResolutionResponse {
    // Continue the version counter and update-hash history from earlier discovery
    // rounds so the whole resolution is one monotonic sequence, matching the spec's
    // single signal-processing loop. updateHashHistory is shared by reference, so the
    // appends made below are visible to the next round.
    let currentVersionId = resolutionState.currentVersionId;
    const updateHashHistory: HashBytes[] = resolutionState.updateHashHistory;

    // 1. Sort updates by targetVersionId (ascending), using blockheight as tie-breaker
    const updates = unsortedUpdates.sort(([upd0, blk0], [upd1, blk1]) =>
      upd0.targetVersionId - upd1.targetVersionId || blk0.height - blk1.height
    );

    // Create a default response object
    const response: DidResolutionResponse = {
      didDocument : currentDocument,
      metadata    : {
        versionId     : `${currentVersionId}`,
        confirmations : 0,
        updated       : '',
        deactivated   : currentDocument.deactivated || false
      }
    };

    // Iterate over each (update block) pair
    for(const [update, block] of updates) {
      // Get the hash of the current document as raw bytes
      const currentDocumentHash = canonicalHashBytes(response.didDocument);

      // Safely convert block.time to timestamp
      const blocktime = DateUtils.blocktimeToTimestamp(block.time);

      // TODO: How to detect if block is unconfirmed and exit gracefully or return without it

      // Set the updated field to the blocktime of the current update
      response.metadata.updated = DateUtils.toISOStringNonFractional(blocktime);

      // Set confirmations to the block confirmations
      response.metadata.confirmations = block.confirmations;

      // Check update.targetVersionId against currentVersionId.
      // If update.targetVersionId <= currentVersionId, this update re-announces a version
      // that has already been applied. Confirm it is a true duplicate, then skip it: a
      // duplicate does not advance the version counter (the increment and the
      // metadata.versionId it sets run only on the apply path below), and confirmation
      // compares against the update-hash history without appending to it, because the
      // history already holds the applied update at updateHashHistory[targetVersionId - 2].
      // Holding the increment off the duplicate path is the deliberate did:btcr2 deviation
      // recorded in ADR 067: the read algorithm's "Increment current_version_id" belongs
      // to the apply branch, not to every tuple. Duplicates are confirmed whatever their
      // blocktime, before the versionTime check below, so a re-announcement mined after
      // versionTime can neither truncate the in-window history nor dodge late-publishing
      // detection (ADR 068).
      if(update.targetVersionId <= currentVersionId) {
        this.confirmDuplicate(update, updateHashHistory);
        continue;
      }

      // if resolutionOptions.versionTime is defined and the blocktime is more recent, return
      // currentDocument. Evaluated only for tuples that would change state (apply or late
      // publishing). The spec places this check before the duplicate branch, where the sort
      // by targetVersionId lets a duplicate of an early version mined after versionTime end
      // resolution before genuine in-window updates are processed; checking it here is the
      // deliberate deviation recorded in ADR 068.
      if(versionTime) {
        // Safely convert versionTime to timestamp
        if(blocktime > DateUtils.dateStringToTimestamp(versionTime)) {
          return response;
        }
      }

      // If update.targetVersionId == currentVersionId + 1, apply the update
      if (update.targetVersionId === currentVersionId + 1) {
        // Check if update.sourceHash !== currentDocumentHash (byte comparison)
        const sourceHashBytes = decodeHash(update.sourceHash, 'base64urlnopad');
        if (!equalBytes(sourceHashBytes, currentDocumentHash)) {
          throw new ResolveError(
            `Hash mismatch: update.sourceHash !== currentDocumentHash`,
            INVALID_DID_UPDATE, {
              sourceHash          : update.sourceHash,
              currentDocumentHash : encodeHash(currentDocumentHash, 'hex')
            }
          );
        }
        // Apply the update to the currentDocument and set it in the response
        response.didDocument = this.applyUpdate(response.didDocument, update);

        // Create unsigned_update by removing the proof property from update.
        const unsignedUpdate = JSONUtils.deleteKeys(update, ['proof']) as UnsignedBTCR2Update;
        // Push the canonicalized unsigned update hash bytes to the updateHashHistory
        updateHashHistory.push(canonicalHashBytes(unsignedUpdate));
      }

      // Otherwise update.targetVersionId > currentVersionId + 1: a version was skipped,
      // so throw LATE_PUBLISHING error. The duplicate case already continued above.
      else {
        throw new ResolveError(
          `Version Id Mismatch: targetVersionId cannot be > currentVersionId + 1`,
          LATE_PUBLISHING_ERROR, {
            targetVersionId  : update.targetVersionId,
            currentVersionId : currentVersionId + 1
          }
        );
      }

      // Increment currentVersionId
      currentVersionId++;

      // Set response.versionId to be the new currentVersionId
      response.metadata.versionId = `${currentVersionId}`;

      // If resolutionOptions.versionId is defined and <= currentVersionId, return currentDocument
      const versionIdNumber = Number(versionId);
      if(!isNaN(versionIdNumber) && versionIdNumber <= currentVersionId) {
        return response;
      }

      // Check if the current document is deactivated before further processing
      if(response.didDocument.deactivated) {
        // Set the response deactivated flag to true
        response.metadata.deactivated = response.didDocument.deactivated;
        // If deactivated, stop processing further updates and return the response
        return response;
      }
    }

    // Return response data
    return response;
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/#confirm-duplicate-update | 7.2.f.1 Confirm Duplicate Update}.
   * This step confirms that an update with a lower-than-expected targetVersionId is a true duplicate.
   * @param {SignedBTCR2Update} update The BTCR2 Signed Update to confirm as a duplicate.
   * @param {HashBytes[]} updateHashHistory The accumulated hash history for comparison.
   * @returns {void} Does not return a value, but throws an error if the update is not a valid duplicate.
   */
  private static confirmDuplicate(update: SignedBTCR2Update, updateHashHistory: HashBytes[]): void {
    // A conformant update targets the version after the one it patches, so targetVersionId
    // is an integer of at least 2 (genesis is version 1). Anything else cannot name an
    // applied update: it is a malformed update, not a duplicate, and without this guard it
    // would read a nonexistent history slot below and crash on the byte comparison (ADR 068).
    if (!Number.isInteger(update.targetVersionId) || update.targetVersionId < 2) {
      throw new ResolveError(
        `Invalid duplicate: targetVersionId must be an integer >= 2`,
        INVALID_DID_UPDATE, { targetVersionId: update.targetVersionId }
      );
    }

    // Create unsigned_update by removing the proof property from update.
    const { proof: _, ...unsignedUpdate } = update;

    // Hash unsignedUpdate with JSON Document Hashing algorithm (raw bytes)
    const unsignedUpdateHash = canonicalHashBytes(unsignedUpdate);

    // Let historicalUpdateHash equal updateHashHistory[updateHashIndex].
    const historicalUpdateHash = updateHashHistory[update.targetVersionId - 2];

    // The resolver's own loop records one history entry per applied version, so this slot
    // always exists on that path; a standalone caller, however, can pass a resolutionState
    // whose version counter outruns its history. A duplicate that cannot be checked against
    // an applied update is unconfirmable, which is late-publishing evidence, not a pass.
    if (historicalUpdateHash === undefined) {
      throw new ResolveError(
        `Invalid duplicate: no applied update in history for targetVersionId`,
        LATE_PUBLISHING_ERROR, {
          targetVersionId : update.targetVersionId,
          historyLength   : updateHashHistory.length
        }
      );
    }

    // Check if the updateHash matches the historical hash (byte comparison)
    if (!equalBytes(historicalUpdateHash, unsignedUpdateHash)) {
      throw new ResolveError(
        `Invalid duplicate: unsigned update hash does not match historical hash`,
        LATE_PUBLISHING_ERROR, {
          unsignedUpdateHash : encodeHash(unsignedUpdateHash, 'hex'),
          historicalHash     : encodeHash(historicalUpdateHash, 'hex')
        }
      );
    }
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update | 7.2.f.3 Apply Update}.
   * @param {DidDocument} currentDocument The current DID Document to apply the update to.
   * @param {SignedBTCR2Update} update The BTCR2 Signed Update to apply.
   * @returns {DidDocument} The updated DID Document after applying the update.
   * @throws {ResolveError} If the update is invalid or cannot be applied.
   */
  private static applyUpdate(
    currentDocument: DidDocument,
    update: SignedBTCR2Update
  ): DidDocument {
    // Get the capability id from the to update proof.
    const capabilityId = update.proof?.capability;
    // Since this field is optional, check that it exists
    if (!capabilityId) {
      // If it does not exist, throw INVALID_DID_UPDATE error
      throw new ResolveError('No root capability found in update', INVALID_DID_UPDATE, update);
    }

    // Get the root capability object by dereferencing the capabilityId
    const rootCapability = Appendix.dereferenceZcapId(capabilityId);

    // Deconstruct the invocationTarget and controller from the root capability
    const { invocationTarget, controller: rootController } = rootCapability;
    // Check that both invocationTarget and rootController equal currentDocument.id
    if (![invocationTarget, rootController].every((id) => id === currentDocument.id)) {
      // If they do not all match, throw INVALID_DID_UPDATE error
      throw new ResolveError(
        'Invalid root capability',
        INVALID_DID_UPDATE, { rootCapability, currentDocument }
      );
    }

    // Get the verificationMethod field from the update proof as verificationMethodId.
    const verificationMethodId = update.proof?.verificationMethod;
    // Since this field is optional, check that it exists
    if(!verificationMethodId) {
      // If it does not exist, throw INVALID_DID_UPDATE error
      throw new ResolveError('No verificationMethod found in update', INVALID_DID_UPDATE, update);
    }

    // Get the verificationMethod from the DID Document using the verificationMethodId.
    const vm = DidBtcr2.getSigningMethod(currentDocument, verificationMethodId);

    // Construct a new SchnorrMultikey.
    const multikey = SchnorrMultikey.fromVerificationMethod(vm);

    // Construct a new BIP340Cryptosuite with the SchnorrMultikey.
    const cryptosuite = new BIP340Cryptosuite(multikey);

    // Canonicalize the update
    const canonicalUpdate = canonicalize(update);

    // Construct a DataIntegrityProof with the cryptosuite
    const diProof = new BIP340DataIntegrityProof(cryptosuite);

    // Call the verifyProof method
    const verificationResult = diProof.verifyProof(canonicalUpdate, 'capabilityInvocation');

    // If the result is not verified, throw INVALID_DID_UPDATE error
    if (!verificationResult.verified) {
      throw new ResolveError(
        'Invalid update: proof not verified',
        INVALID_DID_UPDATE, verificationResult
      );
    }

    // Apply the update.patch to the currentDocument to get the updatedDocument.
    const updatedDocument = JSONPatch.apply(currentDocument, update.patch) as DidDocument;

    // Verify that updatedDocument is conformant to DID Core v1.1.
    DidDocument.validate(updatedDocument);

    // Canonicalize and hash the updatedDocument to get the currentDocumentHash (raw bytes).
    const currentDocumentHash = canonicalHashBytes(updatedDocument);

    // Prepare the update targetHash for comparison with currentDocumentHash.
    const updateTargetHash = decodeHash(update.targetHash);

    // Make sure the update.targetHash equals currentDocumentHash.
    if (!equalBytes(updateTargetHash, currentDocumentHash)) {
      // If they do not match, throw INVALID_DID_UPDATE error.
      throw new ResolveError(
        `Invalid update: update.targetHash !== currentDocumentHash`,
        INVALID_DID_UPDATE, { updateTargetHash, currentDocumentHash }
      );
    }

    //  Return final updatedDocument.
    return updatedDocument;
  }

  /**
   * Advance the state machine. Returns either:
   * - `{ status: 'action-required', needs }` - caller must provide data via {@link provide}
   * - `{ status: 'resolved', result }` - resolution complete
   *
   * Analogous to Rust's `Resolver::resolve()`.
   */
  resolve(): ResolverState {
    // Internal loop: keeps advancing through phases until data is needed or done
    while(true) {
      switch(this.#phase) {

        // Phase: GenesisDocument
        // Only entered for EXTERNAL (x HRP) identifiers when genesis doc was not in sidecar.
        case ResolverPhase.GenesisDocument: {
          if(this.#providedGenesisDocument) {
            // Genesis doc was provided, establish the current document
            this.#currentDocument = Resolver.external(
              this.#didComponents, this.#providedGenesisDocument
            );
            this.#providedGenesisDocument = null;
            this.#phase = ResolverPhase.BeaconDiscovery;
            continue;
          }

          // Need genesis document from caller
          const genesisHash = encodeHash(this.#didComponents.genesisBytes, 'hex');
          return {
            status : 'action-required',
            needs  : [{ kind: 'NeedGenesisDocument', genesisHash }]
          };
        }

        // Phase: BeaconDiscovery
        // Extract beacon services, emit NeedBeaconSignals for addresses not yet queried.
        case ResolverPhase.BeaconDiscovery: {
          const beaconServices = BeaconUtils.getBeaconServices(this.#currentDocument!);

          // Filter to services whose addresses haven't been requested yet
          const newServices = beaconServices.filter(service => {
            const address = BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string);
            return !this.#requestCache.has(address);
          });

          if(newServices.length > 0) {
            // Mark addresses as requested so we don't re-request on subsequent rounds
            for(const service of newServices) {
              const address = BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string);
              this.#requestCache.add(address);
            }

            return {
              status : 'action-required',
              needs  : [{ kind: 'NeedBeaconSignals', beaconServices: newServices }]
            };
          }

          // No new beacon services to query, move to processing
          this.#phase = ResolverPhase.BeaconProcess;
          continue;
        }

        // Phase: BeaconProcess
        // Process each beacon's signals. Collect updates and data needs.
        case ResolverPhase.BeaconProcess: {
          const allNeeds: Array<DataNeed> = [];

          for(const [service, signals] of this.#beaconServicesSignals) {
            // Skip already-processed services and services with no signals
            if(this.#processedServices.has(service.id) || !signals.length) continue;

            // Establish a typed beacon and process its signals
            const beacon = BeaconFactory.establish(service);
            const result = beacon.processSignals(signals, this.#sidecarData);

            if(result.needs.length > 0) {
              // This service has unmet data needs, collect them
              allNeeds.push(...result.needs);
            } else {
              // All signals for this service resolved, collect updates, mark processed
              this.#unsortedUpdates.push(...result.updates);
              this.#processedServices.add(service.id);
            }
          }

          if(allNeeds.length > 0) {
            return { status: 'action-required', needs: allNeeds };
          }

          this.#phase = ResolverPhase.ApplyUpdates;
          continue;
        }

        // Phase: ApplyUpdates
        // Apply collected updates, then check for new beacon services (multi-round).
        case ResolverPhase.ApplyUpdates: {
          if(this.#unsortedUpdates.length > 0) {
            // Apply this round's updates, continuing the resolution-wide version
            // counter and update-hash history rather than restarting them. Without
            // this carry, a linear history split across discovery rounds would be
            // rejected at round two as late publishing.
            this.#resolvedResponse = Resolver.updates(
              this.#currentDocument!,
              this.#unsortedUpdates,
              this.#versionTime,
              this.#versionId,
              { currentVersionId: this.#currentVersionId, updateHashHistory: this.#updateHashHistory }
            );
            // updates() reports the version it reached via metadata.versionId; carry
            // it forward so the next round continues the monotonic sequence.
            this.#currentVersionId = Number(this.#resolvedResponse.metadata.versionId);
            this.#currentDocument = this.#resolvedResponse.didDocument;
            this.#unsortedUpdates = [];

            // Check for new beacon services added by updates (multi-round discovery)
            const beaconServices = BeaconUtils.getBeaconServices(this.#currentDocument);
            const hasNewServices = beaconServices.some(service => {
              const address = BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string);
              return !this.#requestCache.has(address);
            });

            if(hasNewServices) {
              // Discovery is unbounded by default: termination is guaranteed by
              // address de-duplication (#requestCache), so a well-formed DID
              // resolves in however many rounds its history requires. An opt-in
              // maxDiscoveryRounds lets a caller bound the work as a resource
              // guard. Exceeding it is a limit the caller imposed, not a malformed
              // document, so it surfaces as INTERNAL_ERROR, not INVALID_DID_DOCUMENT.
              if(++this.#discoveryRounds > this.#maxDiscoveryRounds) {
                throw new ResolveError(
                  `Exceeded the configured maximum of ${this.#maxDiscoveryRounds} beacon-discovery `
                  + 'rounds. Raise or remove ResolutionOptions.maxDiscoveryRounds to resolve this DID.',
                  INTERNAL_ERROR,
                  { maxDiscoveryRounds: this.#maxDiscoveryRounds, discoveryRounds: this.#discoveryRounds }
                );
              }
              // Loop back to discover signals for new beacon services
              this.#phase = ResolverPhase.BeaconDiscovery;
              continue;
            }
          }

          this.#phase = ResolverPhase.Complete;
          continue;
        }

        // Phase: Complete
        case ResolverPhase.Complete: {
          return {
            status : 'resolved',
            result : this.#resolvedResponse ?? {
              didDocument : this.#currentDocument!,
              metadata    : {
                versionId   : this.#versionId ?? '1',
                deactivated : this.#currentDocument!.deactivated || false
              }
            }
          };
        }
      }
    }
  }

  /**
   * Provide data the resolver requested in a previous {@link resolve} call.
   * Call once per need, then call {@link resolve} again to continue.
   *
   * Analogous to Rust's `Resolver::process_responses()`.
   *
   * @param need The DataNeed being fulfilled (from the `needs` array).
   * @param data The data payload corresponding to the need kind.
   */
  provide(need: NeedGenesisDocument, data: object): void;
  provide(need: NeedBeaconSignals, data: Map<BeaconService, Array<BeaconSignal>>): void;
  provide(need: NeedCASAnnouncement, data: CASAnnouncement): void;
  provide(need: NeedSignedUpdate, data: SignedBTCR2Update): void;
  provide(need: NeedSMTProof, data: SMTProof): void;
  provide(need: DataNeed, data: object | Map<BeaconService, Array<BeaconSignal>> | CASAnnouncement | SignedBTCR2Update | SMTProof): void {
    switch(need.kind) {
      case 'NeedGenesisDocument': {
        if(!isRecord(data)) {
          throw new ResolveError(
            'Provided data for NeedGenesisDocument must be a document object.',
            INVALID_DID_UPDATE, { kind: need.kind }
          );
        }
        this.#providedGenesisDocument = data;
        break;
      }

      case 'NeedBeaconSignals': {
        if(!(data instanceof Map)) {
          throw new ResolveError(
            'Provided data for NeedBeaconSignals must be a Map of beacon services to signals.',
            INVALID_DID_UPDATE, { kind: need.kind }
          );
        }
        for(const [service, serviceSignals] of data) {
          this.#beaconServicesSignals.set(service, serviceSignals);
        }
        break;
      }

      case 'NeedCASAnnouncement': {
        if(!isCASAnnouncement(data)) {
          throw new ResolveError(
            'Provided data for NeedCASAnnouncement is not a CAS announcement.',
            INVALID_DID_UPDATE, { kind: need.kind }
          );
        }
        // Fail fast if the provided announcement is not the one the on-chain
        // signal requested: its canonical hash must equal the need's hash.
        const announcementHash = canonicalHash(data, { encoding: 'hex' });
        if(announcementHash !== need.announcementHash) {
          throw new ResolveError(
            `CAS announcement hash mismatch: expected ${need.announcementHash}, got ${announcementHash}.`,
            INVALID_DID_UPDATE, { expected: need.announcementHash, actual: announcementHash }
          );
        }
        this.#sidecarData.casMap.set(announcementHash, data);
        break;
      }

      case 'NeedSignedUpdate': {
        if(!isSignedBTCR2Update(data)) {
          throw new ResolveError(
            'Provided data for NeedSignedUpdate is not a signed BTCR2 update.',
            INVALID_DID_UPDATE, { kind: need.kind }
          );
        }
        // Fail fast if the provided update is not the one the on-chain signal
        // requested: its canonical hash must equal the need's hash.
        const updateHash = canonicalHash(data, { encoding: 'hex' });
        if(updateHash !== need.updateHash) {
          throw new ResolveError(
            `Signed update hash mismatch: expected ${need.updateHash}, got ${updateHash}.`,
            INVALID_DID_UPDATE, { expected: need.updateHash, actual: updateHash }
          );
        }
        this.#sidecarData.updateMap.set(updateHash, data);
        break;
      }

      case 'NeedSMTProof': {
        if(!isSMTProof(data)) {
          throw new ResolveError(
            'Provided data for NeedSMTProof is not an SMT proof.',
            INVALID_DID_UPDATE, { kind: need.kind }
          );
        }
        // proof.id is base64url per spec; smtRootHash is the hex on-chain signal.
        const proofIdHex = encodeHash(decodeHash(data.id, 'base64urlnopad'), 'hex');
        if(proofIdHex !== need.smtRootHash) {
          throw new ResolveError(
            `SMT proof root hash mismatch: expected ${need.smtRootHash}, got ${proofIdHex}`,
            INVALID_DID_UPDATE, { expected: need.smtRootHash, actual: proofIdHex }
          );
        }
        this.#sidecarData.smtMap.set(need.smtRootHash, data);
        break;
      }
    }
  }
}
