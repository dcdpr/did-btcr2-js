import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { KeyBytes, PatchOperation } from '@did-btcr2/common';
import { canonicalHash, INVALID_DID_UPDATE, JSONPatch, UpdateError } from '@did-btcr2/common';
import { SchnorrMultikey, type DataIntegrityConfig, type SignedBTCR2Update, type UnsignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { DidDocument, type Btcr2DidDocument, type DidVerificationMethod } from '../utils/did-document.js';
import { BeaconFactory } from './beacon/factory.js';
import type { BeaconService } from './beacon/interfaces.js';

// ─── DataNeed types ──────────────────────────────────────────────────────────

/**
 * The updater needs the caller to supply a signing key (or a KMS-backed signature)
 * for the given verification method. The unsigned update is attached so the caller
 * can inspect it before producing a signature.
 */
export interface NeedSigningKey {
  readonly kind: 'NeedSigningKey';
  /** The verification method ID that requires a signing key. */
  readonly verificationMethodId: string;
  /** The unsigned update that will be signed. */
  readonly unsignedUpdate: UnsignedBTCR2Update;
}

/**
 * The updater needs the caller to ensure the beacon address is funded before
 * broadcasting. The caller checks the beacon address for UTXOs, funds it if
 * needed, and then calls `updater.provide(need)` to continue.
 *
 * If the beacon is already funded, the caller can provide immediately (no-op).
 */
export interface NeedFunding {
  readonly kind: 'NeedFunding';
  /** The Bitcoin address that must have a spendable UTXO for broadcast. */
  readonly beaconAddress: string;
  /** The beacon service this address belongs to. */
  readonly beaconService: BeaconService;
}

/**
 * The updater needs the caller to broadcast the signed update via the beacon.
 *
 * The caller decides how: for single-party beacons, call
 * `Updater.announce(beaconService, signedUpdate, secretKey, bitcoin)` or
 * `BeaconFactory.establish(beaconService).broadcastSignal(...)`. For multi-party
 * aggregate beacons, hand off to the aggregation protocol.
 *
 * After the broadcast succeeds, the caller calls `updater.provide(need)` (with no
 * data) to transition the updater to Complete.
 */
export interface NeedBroadcast {
  readonly kind: 'NeedBroadcast';
  /** The beacon service to broadcast through. Inspect `beaconService.type` to decide the path. */
  readonly beaconService: BeaconService;
  /** The signed update ready for broadcast. */
  readonly signedUpdate: SignedBTCR2Update;
}

/** Discriminated union of all data needs the updater may request from the caller. */
export type UpdaterDataNeed = NeedSigningKey | NeedFunding | NeedBroadcast;

/**
 * The result returned by the updater when it reaches the Complete phase.
 */
export interface UpdaterResult {
  /** The signed update that was constructed, signed, and broadcast. */
  signedUpdate: SignedBTCR2Update;
}

/**
 * Output of {@link Updater.advance}. Either the updater needs data from the
 * caller, or the update is complete.
 */
export type UpdaterState =
  | { status: 'action-required'; needs: ReadonlyArray<UpdaterDataNeed> }
  | { status: 'complete'; result: UpdaterResult };

/**
 * Internal phases of the Updater state machine.
 * @internal
 */
enum UpdaterPhase {
  Construct = 'Construct',
  Sign      = 'Sign',
  Fund      = 'Fund',
  Broadcast = 'Broadcast',
  Complete  = 'Complete',
}

/**
 * Parameters for constructing an {@link Updater}. Built by
 * {@link https://dcdpr.github.io/did-btcr2/operations/update.html | DidBtcr2.update}.
 */
export interface UpdaterParams {
  sourceDocument: Btcr2DidDocument;
  patches: PatchOperation[];
  sourceVersionId: number;
  verificationMethod: DidVerificationMethod;
  beaconService: BeaconService;
}

/**
 * Sans-I/O state machine for did:btcr2 updates — the counterpart to {@link Resolver}.
 *
 * Created by {@link DidBtcr2.update} (the factory). The caller drives the update by
 * repeatedly calling {@link advance} and {@link provide}:
 *
 * ```typescript
 * const updater = DidBtcr2.update({ sourceDocument, patches, ... });
 * let state = updater.advance();
 *
 * while(state.status === 'action-required') {
 *   for(const need of state.needs) {
 *     switch(need.kind) {
 *       case 'NeedSigningKey':
 *         updater.provide(need, secretKeyBytes);
 *         break;
 *       case 'NeedFunding':
 *         // Check UTXOs at need.beaconAddress, fund if needed
 *         updater.provide(need);
 *         break;
 *       case 'NeedBroadcast':
 *         await Updater.announce(need.beaconService, need.signedUpdate, secretKey, bitcoin);
 *         updater.provide(need);
 *         break;
 *     }
 *   }
 *   state = updater.advance();
 * }
 *
 * const { signedUpdate } = state.result;
 * ```
 *
 * The Updater performs **zero I/O**. All external work (signing with a KMS or raw
 * key, funding checks, Bitcoin transaction construction, broadcast) flows through
 * the advance/provide protocol. This mirrors the {@link Resolver} pattern and makes
 * the update path transport-agnostic and KMS-ready.
 *
 * The class also exposes static utility methods ({@link construct}, {@link sign},
 * {@link announce}) for callers that need direct access to individual update steps
 * outside the state machine (e.g., test vector generation scripts).
 *
 * @class Updater
 */
export class Updater {
  #phase: UpdaterPhase = UpdaterPhase.Construct;
  readonly #sourceDocument: Btcr2DidDocument;
  readonly #patches: PatchOperation[];
  readonly #sourceVersionId: number;
  readonly #verificationMethod: DidVerificationMethod;
  readonly #beaconService: BeaconService;

  #unsignedUpdate: UnsignedBTCR2Update | null = null;
  #signedUpdate: SignedBTCR2Update | null = null;

  /**
   * @internal — Use {@link DidBtcr2.update} to create instances.
   */
  constructor(params: UpdaterParams) {
    this.#sourceDocument = params.sourceDocument;
    this.#patches = params.patches;
    this.#sourceVersionId = params.sourceVersionId;
    this.#verificationMethod = params.verificationMethod;
    this.#beaconService = params.beaconService;
  }

  // ─── Public static utility methods ─────────────────────────────────────────
  // Used by generate-vector.ts and other scripts that need direct access to
  // individual update steps outside the state machine flow.

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update | 7.3.b Construct BTCR2 Unsigned Update}.
   *
   * @param {Btcr2DidDocument} sourceDocument The source DID document to be updated.
   * @param {PatchOperation[]} patches The JSON Patch operations to apply.
   * @param {number} sourceVersionId The version ID of the source document.
   * @returns {UnsignedBTCR2Update} The constructed UnsignedBTCR2Update object.
   * @throws {UpdateError} If the target document fails DID Core validation.
   */
  static construct(
    sourceDocument: Btcr2DidDocument,
    patches: PatchOperation[],
    sourceVersionId: number,
  ): UnsignedBTCR2Update {
    const unsignedUpdate: UnsignedBTCR2Update = {
      '@context'      : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      patch           : patches,
      targetHash      : '',
      targetVersionId : sourceVersionId + 1,
      sourceHash      : canonicalHash(sourceDocument),
    };

    const targetDocument = JSONPatch.apply(sourceDocument, patches);

    try {
      DidDocument.isValid(targetDocument);
    } catch (error) {
      throw new UpdateError(
        'Error validating targetDocument: ' + (error instanceof Error ? error.message : String(error)),
        INVALID_DID_UPDATE, targetDocument
      );
    }

    unsignedUpdate.targetHash = canonicalHash(targetDocument);
    return unsignedUpdate;
  }

  /**
   * Implements subsection {@link http://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-signed-update | 7.3.c Construct BTCR2 Signed Update }.
   *
   * @param {string} did The did-btcr2 identifier to derive the root capability from.
   * @param {UnsignedBTCR2Update} unsignedUpdate The unsigned update to sign.
   * @param {DidVerificationMethod} verificationMethod The verification method for signing.
   * @param {KeyBytes} secretKey The secret key bytes.
   * @returns {SignedBTCR2Update} The signed update with a Data Integrity proof.
   */
  static sign(
    did: string,
    unsignedUpdate: UnsignedBTCR2Update,
    verificationMethod: DidVerificationMethod,
    secretKey: KeyBytes,
  ): SignedBTCR2Update {
    const controller = verificationMethod.controller;
    const id = verificationMethod.id.slice(verificationMethod.id.indexOf('#'));
    const multikey = SchnorrMultikey.fromSecretKey(id, controller, secretKey);

    const config: DataIntegrityConfig = {
      '@context' : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      cryptosuite        : 'bip340-jcs-2025',
      type               : 'DataIntegrityProof',
      verificationMethod : verificationMethod.id,
      proofPurpose       : 'capabilityInvocation',
      capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
      capabilityAction   : 'Write',
    };

    const diproof = multikey.toCryptosuite().toDataIntegrityProof();
    return diproof.addProof(unsignedUpdate, config);
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#announce-did-update | 7.3.d Announce DID Update}.
   * Announces a signed update to the Bitcoin blockchain via the specified beacon.
   *
   * @param {BeaconService} beaconService The beacon service to broadcast through.
   * @param {SignedBTCR2Update} update The signed update to announce.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   */
  static async announce(
    beaconService: BeaconService,
    update: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection
  ): Promise<SignedBTCR2Update> {
    const beacon = BeaconFactory.establish(beaconService);
    return beacon.broadcastSignal(update, secretKey, bitcoin);
  }

  // ─── Private instance wrappers ─────────────────────────────────────────────
  // Delegate to the public statics with bound instance fields for cleaner
  // advance/provide code.

  #construct(): UnsignedBTCR2Update {
    return Updater.construct(this.#sourceDocument, this.#patches, this.#sourceVersionId);
  }

  #sign(secretKey: KeyBytes): SignedBTCR2Update {
    return Updater.sign(this.#sourceDocument.id, this.#unsignedUpdate!, this.#verificationMethod, secretKey);
  }

  // ─── State machine ─────────────────────────────────────────────────────────

  /**
   * Advance the state machine. Returns either:
   * - `{ status: 'action-required', needs }` — caller must provide data via {@link provide}
   * - `{ status: 'complete', result }` — update is signed and broadcast
   */
  advance(): UpdaterState {
    while(true) {
      switch(this.#phase) {

        // Phase: Construct
        // Build the unsigned update from source doc + patches. Pure, synchronous.
        case UpdaterPhase.Construct: {
          this.#unsignedUpdate = this.#construct();
          this.#phase = UpdaterPhase.Sign;
          continue;
        }

        // Phase: Sign
        // Emit NeedSigningKey — the caller supplies the secret key (or a KMS signature).
        case UpdaterPhase.Sign: {
          return {
            status : 'action-required',
            needs  : [{
              kind                 : 'NeedSigningKey',
              verificationMethodId : this.#verificationMethod.id,
              unsignedUpdate       : this.#unsignedUpdate!,
            }],
          };
        }

        // Phase: Fund
        // Emit NeedFunding with the beacon address. The caller checks UTXOs,
        // funds the address if needed, and provides to continue.
        case UpdaterPhase.Fund: {
          const beaconAddress = this.#beaconService.serviceEndpoint.replace('bitcoin:', '');
          return {
            status : 'action-required',
            needs  : [{
              kind           : 'NeedFunding',
              beaconAddress,
              beaconService  : this.#beaconService,
            }],
          };
        }

        // Phase: Broadcast
        // Emit NeedBroadcast with the signed update + beacon service. The caller performs
        // the actual on-chain announcement (or hands off to the aggregation protocol).
        case UpdaterPhase.Broadcast: {
          return {
            status : 'action-required',
            needs  : [{
              kind          : 'NeedBroadcast',
              beaconService : this.#beaconService,
              signedUpdate  : this.#signedUpdate!,
            }],
          };
        }

        // Phase: Complete
        case UpdaterPhase.Complete: {
          return {
            status : 'complete',
            result : { signedUpdate: this.#signedUpdate! },
          };
        }
      }
    }
  }

  /**
   * Provide data the updater requested in a previous {@link advance} call.
   * Call once per need, then call {@link advance} again to continue.
   *
   * @param need The DataNeed being fulfilled (from the `needs` array).
   * @param data The data payload corresponding to the need kind (omit for NeedFunding/NeedBroadcast).
   */
  provide(need: NeedSigningKey, data: KeyBytes): void;
  provide(need: NeedFunding): void;
  provide(need: NeedBroadcast): void;
  provide(need: UpdaterDataNeed, data?: KeyBytes): void {
    switch(need.kind) {
      case 'NeedSigningKey': {
        if(this.#phase !== UpdaterPhase.Sign) {
          throw new UpdateError(
            `Cannot provide NeedSigningKey: updater phase is ${this.#phase}, expected Sign.`,
            INVALID_DID_UPDATE, { phase: this.#phase }
          );
        }
        if(!data) {
          throw new UpdateError(
            'NeedSigningKey requires secret key bytes.',
            INVALID_DID_UPDATE
          );
        }
        if(!this.#unsignedUpdate) {
          throw new UpdateError(
            'Internal error: unsigned update missing in Sign phase.',
            INVALID_DID_UPDATE
          );
        }
        this.#signedUpdate = this.#sign(data);
        this.#phase = UpdaterPhase.Fund;
        break;
      }

      case 'NeedFunding': {
        if(this.#phase !== UpdaterPhase.Fund) {
          throw new UpdateError(
            `Cannot provide NeedFunding: updater phase is ${this.#phase}, expected Fund.`,
            INVALID_DID_UPDATE, { phase: this.#phase }
          );
        }
        // Caller has confirmed funding (or it was already funded). Continue.
        this.#phase = UpdaterPhase.Broadcast;
        break;
      }

      case 'NeedBroadcast': {
        if(this.#phase !== UpdaterPhase.Broadcast) {
          throw new UpdateError(
            `Cannot provide NeedBroadcast: updater phase is ${this.#phase}, expected Broadcast.`,
            INVALID_DID_UPDATE, { phase: this.#phase }
          );
        }
        // Caller has broadcast externally. Transition to Complete.
        this.#phase = UpdaterPhase.Complete;
        break;
      }
    }
  }
}
