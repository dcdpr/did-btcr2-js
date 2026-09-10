import { getNetwork } from '@did-btcr2/bitcoin';
import {
  canonicalHash,
  canonicalHashBytes,
  canonicalize,
  DateUtils,
  encode as encodeHash,
  decode as decodeHash,
  INTERNAL_ERROR,
  INVALID_DID,
  INVALID_DID_UPDATE,
  INVALID_OPTIONS,
  JSONPatch,
  JSONUtils,
  LATE_PUBLISHING_ERROR,
  NOT_FOUND,
  ResolveError
} from '@did-btcr2/common';
import type { HashBytes } from '@did-btcr2/common';
import type {
  SignedBTCR2Update,
  UnsignedBTCR2Update
} from './btcr2-update.js';
import { BTCR2_UPDATE_CONTEXT, isBtcr2UpdateContext } from './btcr2-update.js';
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
 * Default minimum number of Bitcoin block confirmations a Beacon Signal
 * transaction must have before resolution processes it. The specification
 * mandates `6` when `ResolutionOptions.minConf` is not set: six confirmations
 * is the accepted standard for a settled Bitcoin transaction. A resolution
 * request can raise or lower it through `minConf`.
 */
export const DEFAULT_MIN_CONF = 6;

/**
 * The response object for DID Resolution. `metadata` is the DID document metadata
 * of the specification: `versionId`, `confirmations`, and `deactivated` are always
 * present; `updated` is present after the resolver applies an update.
 */
export interface DidResolutionResponse {
  didDocument: DidDocument;
  metadata: {
    /**
     * Number of confirmations of the Bitcoin block that contains the last applied
     * unique update. `0` when the resolver applied no update.
     */
    confirmations: number;
    /** The version of the resolved document as an ASCII string. `"1"` when the resolver applied no update. */
    versionId: string;
    /**
     * XML Datetime (UTC, no fraction) of the block of the last applied update.
     * Absent until the resolver applies an update.
     */
    updated?: string;
    /** Whether the resolved document is deactivated. */
    deactivated: boolean;
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
 * Validate `ResolutionOptions.minConf`. `undefined` selects the specification
 * default, {@link DEFAULT_MIN_CONF}. Any other value must be an integer of at
 * least 1, as the specification defines the option.
 * @throws {ResolveError} `INVALID_OPTIONS` for every other value.
 */
function validateMinConf(value: unknown): number {
  if(value === undefined) return DEFAULT_MIN_CONF;
  if(typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  throw new ResolveError(
    `Invalid resolution option minConf: expected a positive integer (minimum 1), got ${shown(value)}.`,
    INVALID_OPTIONS, { minConf: value }
  );
}

/** Render an option value for an error message: a string in quotes, any other value as is. */
function shown(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** An ASCII string of an integer: an optional minus sign, then digits. */
const ASCII_INTEGER = /^-?[0-9]+$/;

/**
 * Parse `ResolutionOptions.versionId`. The specification says that the value MUST
 * parse as an integer, and DID Resolution v1 types the option as a string. The
 * accepted form is an ASCII string of an integer inside the safe integer range.
 * @returns {number | undefined} The integer, or `undefined` when the option is absent.
 * @throws {ResolveError} `INVALID_OPTIONS` for every other value.
 */
function validateVersionId(value: unknown): number | undefined {
  if(value === undefined) return undefined;
  if(typeof value === 'string' && ASCII_INTEGER.test(value) && Number.isSafeInteger(Number(value))) {
    return Number(value);
  }
  throw new ResolveError(
    `Invalid resolution option versionId: expected an ASCII string of an integer, got ${shown(value)}.`,
    INVALID_OPTIONS, { versionId: value }
  );
}

/** An XML Datetime in UTC with the `Z` designator and no fraction, for example `2026-07-01T00:00:00Z`. */
const UTC_XSD_DATETIME = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Parse `ResolutionOptions.versionTime`. DID Resolution v1 requires an XML Datetime
 * normalized to UTC without sub-second precision. The specification raises
 * `INVALID_OPTIONS` for a value that does not parse.
 * @returns {number | undefined} The instant in milliseconds since the Unix epoch, or `undefined` when the option is absent.
 * @throws {ResolveError} `INVALID_OPTIONS` for every other value.
 */
function validateVersionTime(value: unknown): number | undefined {
  if(value === undefined) return undefined;
  if(typeof value === 'string' && UTC_XSD_DATETIME.test(value) && DateUtils.isValidXsdDateTime(value)) {
    const ms = Date.parse(value);
    if(Number.isFinite(ms)) return ms;
  }
  throw new ResolveError(
    'Invalid resolution option versionTime: expected an XML Datetime in UTC without a fraction '
    + `(for example "2026-07-01T00:00:00Z"), got ${shown(value)}.`,
    INVALID_OPTIONS, { versionTime: value }
  );
}

/**
 * The phases of the resolution process. Each pass of the specification loop is
 * BeaconDiscovery (the scan of the beacon addresses the resolver did not scan yet),
 * BeaconProcess (the tuples of the signals the caller provided), and ProcessUpdate
 * (one tuple). GenesisDocument runs once, for an EXTERNAL identifier whose genesis
 * document is not in the sidecar.
 */
enum ResolverPhase {
  GenesisDocument = 'GenesisDocument',
  BeaconDiscovery = 'BeaconDiscovery',
  BeaconProcess   = 'BeaconProcess',
  ProcessUpdate   = 'ProcessUpdate',
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
  /** The parsed `ResolutionOptions.versionId`, or `undefined` when the option is absent. */
  readonly #versionId?: number;
  /** The parsed `ResolutionOptions.versionTime` in milliseconds since the Unix epoch, or `undefined`. */
  readonly #versionTime?: number;

  /**
   * The specific phase the Resolver is current in.
   */
  #phase: ResolverPhase;
  #sidecarData: SidecarData;
  #currentDocument: DidDocument | null;
  #providedGenesisDocument: object | null = null;
  #beaconServicesSignals: Map<BeaconService, Array<BeaconSignal>> = new Map();
  #processedServices: Set<string> = new Set();
  /** The beacon addresses the resolver requested signals for: `scanned_beacons` of the specification. */
  #requestCache: Set<string> = new Set();
  /**
   * The tuples of the specification's `updates` list: a signed update and the metadata of
   * the block that announced it. BeaconProcess appends; ProcessUpdate sorts the list and
   * removes one tuple per step. A tuple that one pass does not reach waits for the next.
   */
  #unsortedUpdates: Array<[SignedBTCR2Update, BlockMetadata]> = [];
  #resolvedResponse: DidResolutionResponse | null = null;

  /**
   * The state of the specification loop, carried across every pass: the version counter
   * (`current_version_id`), the update-hash history that backs duplicate confirmation
   * (`update_hash_history`), the confirmations of the block that contains the most
   * recently applied unique update (`block_confirmations`), and the header time of that
   * block as `updated`. A pass that finds a new beacon address returns to discovery, so
   * the state must not restart: a restart would reject a linear history whose later
   * updates are announced on beacons that earlier updates added.
   */
  #currentVersionId = 1;
  #updateHashHistory: HashBytes[] = [];
  #blockConfirmations = 0;
  #updated?: string;

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
   * Minimum block confirmations a Beacon Signal must have before this resolver
   * processes it: `ResolutionOptions.minConf`, default {@link DEFAULT_MIN_CONF}.
   * Applied at signal intake in the BeaconProcess phase. A signal below the
   * threshold is excluded from the resolution; the rest of the signals are
   * processed.
   */
  readonly #minConf: number;


  /**
   * @internal Use {@link DidBtcr2.resolve} to create instances.
   */
  constructor(
    didComponents: DidComponents,
    sidecarData: SidecarData,
    currentDocument: DidDocument | null,
    options?: {
      versionId?: string;
      versionTime?: string;
      genesisDocument?: object;
      maxDiscoveryRounds?: number;
      minConf?: number;
    }
  ) {
    this.#didComponents = didComponents;
    this.#sidecarData = sidecarData;
    this.#currentDocument = currentDocument;
    // The resolution options fail here, before any data need is emitted, so the
    // caller does no I/O for a request it cannot serve. DID Resolution v1 defines
    // versionId and versionTime as mutually exclusive; the specification raises
    // INVALID_OPTIONS for a request with both, and for a value that does not parse.
    if(options?.versionId !== undefined && options?.versionTime !== undefined) {
      throw new ResolveError(
        'Invalid resolution options: versionId and versionTime are mutually exclusive. Pass one of them.',
        INVALID_OPTIONS, { versionId: options.versionId, versionTime: options.versionTime }
      );
    }
    this.#versionId = validateVersionId(options?.versionId);
    this.#versionTime = validateVersionTime(options?.versionTime);
    // Discovery is unbounded by default; a positive maxDiscoveryRounds opts into a
    // finite resource guard. A non-positive or omitted value means no limit.
    const rounds = options?.maxDiscoveryRounds;
    this.#maxDiscoveryRounds = typeof rounds === 'number' && rounds > 0 ? rounds : Infinity;
    // The signal confirmation threshold.
    this.#minConf = validateMinConf(options?.minConf);

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
   * @throws {ResolveError} `INVALID_DID` if the hash of the genesis document is not the genesis bytes of the identifier
   */
  static external(
    didComponents: DidComponents,
    genesisDocument: object,
  ): DidDocument {
    // Canonicalize and sha256 hash the genesis document
    const genesisDocumentHash = canonicalHashBytes(genesisDocument);

    // Compare genesis bytes from identifier against the document hash (byte comparison).
    // The specification raises INVALID_DID when the computed hash does not match genesis_bytes.
    if (!equalBytes(didComponents.genesisBytes, genesisDocumentHash)) {
      throw new ResolveError(
        `Initial document mismatch: genesisBytes !== genesisDocumentHash`,
        INVALID_DID, {
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
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#confirm-duplicate-update | Confirm Duplicate Update}.
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
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update | Apply update}
   * and its step {@link https://dcdpr.github.io/did-btcr2/operations/resolve.html#check-update-proof | Check update.proof}.
   * @param {DidDocument} currentDocument The current DID Document to apply the update to.
   * @param {SignedBTCR2Update} update The BTCR2 Signed Update to apply.
   * @returns {DidDocument} The updated DID Document after applying the update.
   * @throws {ResolveError} `INVALID_DID_UPDATE` if the update is invalid or cannot be applied.
   */
  private static applyUpdate(
    currentDocument: DidDocument,
    update: SignedBTCR2Update
  ): DidDocument {
    // Spec "Apply update": the hash of the current document must be the decoded
    // update.sourceHash (byte comparison).
    const currentDocumentHash = canonicalHashBytes(currentDocument);
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

    // Spec "Check update.proof": the update @context must be the array that the BTCR2
    // Unsigned Update data structure pins, and the proof @context must equal it, member
    // for member and in order. The array is inside the hashed and signed bytes, so an
    // update with another array is a different update. The check runs before signature
    // verification so that the failure names the array and not the signature.
    if(!isBtcr2UpdateContext(update['@context'])) {
      throw new ResolveError(
        'Invalid update: @context is not the array the specification pins for a BTCR2 Update',
        INVALID_DID_UPDATE, { context: update['@context'], expected: [ ...BTCR2_UPDATE_CONTEXT ] }
      );
    }
    if(!isBtcr2UpdateContext(update.proof?.['@context'], update['@context'])) {
      throw new ResolveError(
        'Invalid update: proof @context does not equal the update @context',
        INVALID_DID_UPDATE, { proofContext: update.proof?.['@context'], context: update['@context'] }
      );
    }

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

    // Spec "Check update.proof": raise INVALID_DID_UPDATE if
    // currentDocument.capabilityInvocation does not contain
    // update.proof.verificationMethod. Locating the method in verificationMethod[] and
    // verifying its signature is not sufficient on its own: a key the controller
    // published only for authentication (or for no relationship at all) must not be
    // able to authorize a DID update. The write path enforces this in DidBtcr2.update();
    // without it here the read path applies an update signed by any key in the document.
    // Checked before the method is located so an unauthorized method always fails with
    // this typed error, whether or not it also appears in verificationMethod[].
    const authorizedMethodId = Appendix.relationshipMethodId(verificationMethodId, currentDocument.id);
    const authorized = authorizedMethodId !== undefined && currentDocument.capabilityInvocation?.some(
      entry => Appendix.relationshipMethodId(entry, currentDocument.id) === authorizedMethodId
    );
    if(!authorized) {
      throw new ResolveError(
        'Invalid update: verificationMethod is not authorized for capabilityInvocation',
        INVALID_DID_UPDATE, {
          verificationMethodId,
          capabilityInvocation : currentDocument.capabilityInvocation
        }
      );
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

    // Canonicalize and hash the updatedDocument (raw bytes).
    const updatedDocumentHash = canonicalHashBytes(updatedDocument);

    // Prepare the update targetHash for comparison with updatedDocumentHash.
    const updateTargetHash = decodeHash(update.targetHash);

    // Make sure the update.targetHash equals updatedDocumentHash.
    if (!equalBytes(updateTargetHash, updatedDocumentHash)) {
      // If they do not match, throw INVALID_DID_UPDATE error.
      throw new ResolveError(
        `Invalid update: update.targetHash !== updatedDocumentHash`,
        INVALID_DID_UPDATE, { updateTargetHash, updatedDocumentHash }
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

            // Keep only the signals at or above the confirmation threshold. A
            // service whose signals are all below it is treated like a service
            // with no signals: it is not processed and not marked processed.
            const eligible = this.#eligibleSignals(signals);
            if(!eligible.length) continue;

            // Establish a typed beacon and process its signals
            // The beacon is bound to the DID under resolution: a beacon service
            // `id` may be a relative DID URL, so it cannot supply the subject.
            const beacon = BeaconFactory.establish(service, this.#currentDocument!.id);
            const result = beacon.processSignals(eligible, this.#sidecarData);

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

          this.#phase = ResolverPhase.ProcessUpdate;
          continue;
        }

        // Phase: ProcessUpdate
        // Spec "Process Next Update": one tuple per step. The phase repeats until
        // the document resolves, or until an applied update adds a beacon address
        // that the resolver did not scan (then the pass returns to BeaconDiscovery).
        case ResolverPhase.ProcessUpdate: {
          const document = this.#currentDocument!;

          // Step 1: the requested version is reached. The test runs before Apply,
          // so version 1 is reachable.
          if(this.#versionId !== undefined && this.#currentVersionId === this.#versionId) {
            this.#phase = ResolverPhase.Complete;
            continue;
          }

          // Step 2: no tuple is left, or the document is deactivated. A requested
          // version that the history does not reach is NOT_FOUND.
          if(this.#unsortedUpdates.length === 0 || document.deactivated) {
            if(this.#versionId !== undefined) {
              throw new ResolveError(
                `Version ${this.#versionId} of the DID does not exist: the history `
                + (document.deactivated
                  ? `ends with the deactivation at version ${this.#currentVersionId}.`
                  : `ends at version ${this.#currentVersionId}.`),
                NOT_FOUND, { versionId: this.#versionId, currentVersionId: this.#currentVersionId }
              );
            }
            this.#phase = ResolverPhase.Complete;
            continue;
          }

          // Step 3: sort the tuples by targetVersionId (ascending), then by block
          // height, and remove the first one. The sort runs on every step because
          // a scan between two steps can add a tuple with a lower version.
          this.#unsortedUpdates.sort(([upd0, blk0], [upd1, blk1]) =>
            upd0.targetVersionId - upd1.targetVersionId || blk0.height - blk1.height
          );
          const [update, block] = this.#unsortedUpdates.shift()!;

          // Check targetVersionId, first arm: update.targetVersionId <= currentVersionId
          // re-announces an applied version. Confirm that it is a true duplicate, then
          // skip it. A duplicate does not advance the version counter, does not append
          // to the history (the slot already holds the applied update, ADR 067), and
          // does not stamp the metadata: confirmations refers to the block of the most
          // recently applied unique update. The branch runs before the versionTime
          // test (ADR 068): a re-announcement mined after versionTime can neither end
          // the resolution early nor dodge late-publishing detection.
          if(update.targetVersionId <= this.#currentVersionId) {
            Resolver.confirmDuplicate(update, this.#updateHashHistory);
            continue;
          }

          // Step 4: the versionTime stop. The block mediantime of the tuple is after
          // versionTime: resolve the current document. The boundary is inclusive, so a
          // tuple whose mediantime equals versionTime applies. The stopped tuple stamps
          // nothing: the metadata reports the last applied update.
          if(this.#versionTime !== undefined && block.mediantime * 1000 > this.#versionTime) {
            this.#phase = ResolverPhase.Complete;
            continue;
          }

          // Check targetVersionId, third arm: a version was skipped, so raise LATE_PUBLISHING.
          if(update.targetVersionId !== this.#currentVersionId + 1) {
            throw new ResolveError(
              `Version Id Mismatch: targetVersionId cannot be > currentVersionId + 1`,
              LATE_PUBLISHING_ERROR, {
                targetVersionId  : update.targetVersionId,
                currentVersionId : this.#currentVersionId + 1
              }
            );
          }

          // Second arm: update.targetVersionId == currentVersionId + 1. Apply the update,
          // append the unsigned update hash to the history, increment the version.
          this.#currentDocument = Resolver.applyUpdate(document, update);
          const unsignedUpdate = JSONUtils.deleteKeys(update, ['proof']) as UnsignedBTCR2Update;
          this.#updateHashHistory.push(canonicalHashBytes(unsignedUpdate));
          this.#currentVersionId++;

          // Step 5: block_confirmations, and the header time as `updated`. On the apply
          // path only: the stop above and the duplicate branch stamp nothing.
          this.#blockConfirmations = block.confirmations;
          this.#updated = DateUtils.toISOStringNonFractional(DateUtils.blocktimeToTimestamp(block.time));

          // The applied update can add a beacon service. "Find Beacon Signals" runs at
          // the top of every pass for the addresses that are not scanned yet, so the
          // pass returns to BeaconDiscovery before the next tuple. Discovery is
          // unbounded by default: termination is guaranteed by address
          // de-duplication (#requestCache). An opt-in maxDiscoveryRounds lets a caller
          // bound the work as a resource guard. Exceeding it is a limit the caller
          // imposed, not a malformed document, so it surfaces as INTERNAL_ERROR.
          if(this.#hasUnscannedBeacons()) {
            if(++this.#discoveryRounds > this.#maxDiscoveryRounds) {
              throw new ResolveError(
                `Exceeded the configured maximum of ${this.#maxDiscoveryRounds} beacon-discovery `
                + 'rounds. Raise or remove ResolutionOptions.maxDiscoveryRounds to resolve this DID.',
                INTERNAL_ERROR,
                { maxDiscoveryRounds: this.#maxDiscoveryRounds, discoveryRounds: this.#discoveryRounds }
              );
            }
            this.#phase = ResolverPhase.BeaconDiscovery;
          }
          continue;
        }

        // Phase: Complete
        // The document metadata of the specification: versionId is current_version_id,
        // confirmations is block_confirmations (0 when no update applied), deactivated
        // is the flag of the document. `updated` is present after the first apply.
        case ResolverPhase.Complete: {
          this.#resolvedResponse ??= {
            didDocument : this.#currentDocument!,
            metadata    : {
              versionId     : `${this.#currentVersionId}`,
              confirmations : this.#blockConfirmations,
              ...(this.#updated !== undefined ? { updated: this.#updated } : {}),
              deactivated   : this.#currentDocument!.deactivated || false
            }
          };
          return { status: 'resolved', result: this.#resolvedResponse };
        }
      }
    }
  }

  /**
   * True if the current document carries a beacon service whose address the resolver
   * did not request signals for. "Find Beacon Signals" scans such an address on the
   * next pass.
   */
  #hasUnscannedBeacons(): boolean {
    return BeaconUtils.getBeaconServices(this.#currentDocument!).some(service =>
      !this.#requestCache.has(BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string))
    );
  }

  /**
   * Return the signals of one beacon service that resolution may process: the
   * signals with at least `#minConf` confirmations. The specification removes a
   * transaction below the threshold from the set of Beacon Signals, so an
   * excluded signal emits no data need and applies no update. A signal with no
   * integer confirmation count is excluded too: that is a mempool transaction
   * from a driver that did not skip it.
   *
   * An eligible signal must carry a finite block height, block time, and block
   * median time past. A signal that passes the count but lacks them is
   * malformed. It fails fast here with a typed error, in the style of the
   * {@link provide} guards, and not later with an invalid date or a false
   * `versionTime` comparison in the ProcessUpdate phase.
   * @param {Array<BeaconSignal>} signals The signals the caller provided for one service.
   * @returns {Array<BeaconSignal>} The signals at or above the threshold, in the given order.
   * @throws {ResolveError} `INVALID_DID_UPDATE` for an eligible signal with no valid block metadata.
   */
  #eligibleSignals(signals: Array<BeaconSignal>): Array<BeaconSignal> {
    const eligible: Array<BeaconSignal> = [];
    for(const signal of signals) {
      const block = signal.blockMetadata as Partial<BlockMetadata> | undefined;
      const confirmations = block?.confirmations;
      if(!Number.isInteger(confirmations) || (confirmations as number) < this.#minConf) {
        continue;
      }
      if(!Number.isFinite(block?.height) || !Number.isFinite(block?.time) || !Number.isFinite(block?.mediantime)) {
        throw new ResolveError(
          `Beacon signal ${signal.signalBytes} has ${confirmations} confirmations `
          + 'but no valid block height, block time, or block mediantime.',
          INVALID_DID_UPDATE,
          {
            signalBytes : signal.signalBytes,
            confirmations,
            height      : block?.height,
            time        : block?.time,
            mediantime  : block?.mediantime
          }
        );
      }
      eligible.push(signal);
    }
    return eligible;
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
