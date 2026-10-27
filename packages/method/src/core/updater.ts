import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { PatchOperation } from '@did-btcr2/common';
import { CanonicalizationError, canonicalHash, canonicalize, INVALID_DID_UPDATE, JSONPatch, UpdateError } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
import type { Btcr2DataIntegrityConfig, SignedBTCR2Update, UnsignedBTCR2Update } from './btcr2-update.js';
import { BTCR2_UPDATE_CONTEXT, isBtcr2UpdateContext } from './btcr2-update.js';
import { Appendix } from '../utils/appendix.js';
import { DidDocument, type Btcr2DidDocument, type DidVerificationMethod } from '../utils/did-document.js';
import { isJsonMap, NOT_A_JSON_OBJECT } from '../utils/did-core-conformance.js';
import { errorCause } from '../utils/error-cause.js';
import { messageText } from '../utils/message-text.js';
import { signingMethodProblem } from '../utils/signing-method.js';
import type { BroadcastResult } from './beacon/beacon.js';
import type { CASBroadcastOptions } from './beacon/cas-beacon.js';
import { BeaconFactory } from './beacon/factory.js';
import type { BeaconService } from './beacon/interfaces.js';

// ─── DataNeed types ──────────────────────────────────────────────────────────

/**
 * The updater needs the caller to supply a {@link Signer} for the given
 * verification method. The unsigned update is attached so the caller can
 * inspect it before producing a signature. The signer can wrap a local secret
 * key (`LocalSigner`), a KMS-managed key (`KeyManagerSigner`), or any custom backend.
 */
export interface NeedSigningKey {
  readonly kind: 'NeedSigningKey';
  /**
   * The id of the verification method that requires a signing key, as an absolute DID URL.
   * The proof names the method by this id.
   */
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
 * Optional proof the caller passes when fulfilling {@link NeedFunding}. The
 * state machine asserts the proof before transitioning to Broadcast. Sans-I/O
 * is preserved: the caller still performs the UTXO lookup; this is just a
 * contract-level handshake.
 */
export interface FundingProof {
  /** Number of spendable UTXOs the caller observed at the beacon address. Must be >= 1. */
  utxoCount: number;
  /** Optional txid the caller funded with, for diagnostics. */
  txid?: string;
}

/**
 * The updater needs the caller to broadcast the signed update via the beacon.
 *
 * The caller decides how: for single-party beacons, call
 * `Updater.announce(beaconService, did, signedUpdate, signer, bitcoin, options?)` or
 * `BeaconFactory.establish(beaconService, did).broadcastSignal(...)`. For multi-party
 * aggregate beacons, hand off to the aggregation protocol.
 *
 * Both single-party paths return a `BroadcastResult`; capture it. Beyond the txid,
 * it carries the per-beacon-type sidecar artifacts: the CAS Announcement (CAS
 * beacons) and the SMT inclusion proof (SMT beacons), whose embedded nonce exists
 * nowhere else, so a discarded proof makes the signal permanently unresolvable.
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
  /**
   * The DID being updated. Supplied because a beacon service `id` may be a
   * relative DID URL and so cannot be used to recover the subject.
   */
  readonly did: string;
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
 * Discriminated union of the updater's internal state. Each phase tag pins the
 * exact set of values the state machine has computed so far, so consumers of
 * `#state` narrow correctly under `switch (this.#state.phase)`. No nullable
 * scratch slots, no `!`-asserts.
 * @internal
 */
type InternalState =
  | { phase: 'Construct' }
  | { phase: 'Sign'; unsignedUpdate: UnsignedBTCR2Update }
  | { phase: 'Fund'; unsignedUpdate: UnsignedBTCR2Update; signedUpdate: SignedBTCR2Update }
  | { phase: 'Broadcast'; unsignedUpdate: UnsignedBTCR2Update; signedUpdate: SignedBTCR2Update }
  | { phase: 'Complete'; signedUpdate: SignedBTCR2Update };

/**
 * Parameters for constructing an {@link Updater}. Built by
 * {@link https://dcdpr.github.io/did-btcr2/operations/update.html | DidBtcr2.update}.
 */
export interface UpdaterParams {
  sourceDocument: Btcr2DidDocument;
  patches: PatchOperation[];
  sourceVersionId: number;
  /**
   * The id of the verification method that signs, absolute or relative. An entry of
   * `capabilityInvocation` must identify it (see {@link Updater.signingMethod}).
   */
  verificationMethodId: string;
  beaconService: BeaconService;
}

/**
 * Returns the absolute DID URL of a verification method id: the id that the proof names.
 * A proof travels apart from the document, so it must name the method by a DID URL.
 * {@link Appendix.absoluteDidUrl} resolves only the `#` form of a relative DID URL. This
 * function refuses another relative form (`?key=1`, `/keys/1`). It also refuses an absolute
 * URI that is not a DID URL (`urn:x:1`).
 *
 * The method must be under the DID: the DID, then a fragment, a query, or a path. DID Core
 * v1.1 lets a relative DID URL hold each of these three parts, and the result references a
 * resource in the same DID document. An id under another DID (`did:btcr2:<other>#key`) fails
 * the Retrieve Verification Method algorithm of Controlled Identifiers v1.0 (section 3.3),
 * because the controller of the method is not that other DID.
 *
 * @param {string} verificationMethodId The id of the method, absolute or relative.
 * @param {string} did The DID that a relative id resolves against.
 * @returns {string} The absolute DID URL.
 * @throws {UpdateError} `INVALID_DID_UPDATE` if the result of the resolution is not a DID URL,
 *   or if it is not under `did`.
 */
function absoluteMethodId(verificationMethodId: string, did: string): string {
  const methodId = Appendix.absoluteDidUrl(verificationMethodId, did);
  if(methodId === undefined || !methodId.startsWith('did:')) {
    const text = messageText(verificationMethodId);
    throw new UpdateError(
      'Invalid verificationMethodId: expected a DID URL or a relative DID URL that starts with "#"'
      + (text === undefined ? '.' : `; got "${text}".`),
      INVALID_DID_UPDATE, { verificationMethodId }
    );
  }
  const separator = methodId.charAt(did.length);
  if(!methodId.startsWith(did) || ![ '#', '?', '/' ].includes(separator) || methodId.length === did.length + 1) {
    throw new UpdateError(
      `Invalid verificationMethodId: expected "${did}" followed by a fragment, a query, or a path; `
      + `got "${methodId}".`,
      INVALID_DID_UPDATE, { verificationMethodId: methodId }
    );
  }
  return methodId;
}

/**
 * Returns the JSON Document Hash of `sourceDocument`, the `sourceHash` of an update.
 * @param {Btcr2DidDocument} sourceDocument The DID document that the update changes.
 * @returns {string} The hash in base64url text.
 * @throws {UpdateError} `INVALID_DID_UPDATE` if `sourceDocument` has no JCS form, for example if it
 *   holds NaN or a lone surrogate. `data.cause` holds the CanonicalizationError.
 */
function sourceHashOf(sourceDocument: Btcr2DidDocument): string {
  try {
    return canonicalHash(sourceDocument);
  } catch(error) {
    if(!(error instanceof CanonicalizationError)) throw error;
    throw new UpdateError(
      `Invalid sourceDocument: ${error.message}`,
      INVALID_DID_UPDATE, { field: 'sourceDocument', cause: errorCause(error) }
    );
  }
}

/**
 * Checks that `unsignedUpdate` is an update of `sourceDocument`. A resolver refuses an announced
 * update if its hashes do not match the documents, and then the DID no longer resolves. So the
 * write path must refuse such an update before it signs. The checks, in this order:
 *
 * 1. `unsignedUpdate` is an object with no `proof` member.
 * 2. `targetVersionId` is an integer of 2 or more, as in the shape rule of the read path.
 * 3. `@context` is the array that the specification pins for a BTCR2 Update.
 * 4. `sourceDocument` has a JCS form, and `sourceHash` is its hash.
 * 5. `patch` gives a valid DID document from `sourceDocument` ({@link Updater.construct}).
 * 6. `targetHash` is the hash of that document.
 *
 * This function does not compare other properties. The read path accepts an extra property,
 * so the write path signs it too. A `proof` member is not an extra property: Updater.sign adds
 * the proof.
 *
 * Updater.sign gets no version of `sourceDocument`. The caller must make sure that
 * `targetVersionId` is the version of `sourceDocument` plus 1. A resolver refuses another value.
 *
 * @param {Btcr2DidDocument} sourceDocument The DID document that the update changes.
 * @param {UnsignedBTCR2Update} unsignedUpdate The unsigned update to check.
 * @throws {UpdateError} `INVALID_DID_UPDATE` for the first check that fails.
 */
function checkUnsignedUpdate(sourceDocument: Btcr2DidDocument, unsignedUpdate: UnsignedBTCR2Update): void {
  if(typeof unsignedUpdate !== 'object' || unsignedUpdate === null || Array.isArray(unsignedUpdate)) {
    throw new UpdateError(
      'Invalid unsignedUpdate: expected an object.',
      INVALID_DID_UPDATE, { unsignedUpdate }
    );
  }
  if(Object.hasOwn(unsignedUpdate, 'proof')) {
    throw new UpdateError(
      'Invalid unsignedUpdate: an unsigned update must not have a proof.',
      INVALID_DID_UPDATE, { field: 'proof', actual: (unsignedUpdate as { proof?: unknown }).proof }
    );
  }
  const targetVersionId: unknown = unsignedUpdate.targetVersionId;
  if(!Number.isInteger(targetVersionId) || (targetVersionId as number) < 2) {
    throw new UpdateError(
      'Invalid unsignedUpdate: targetVersionId must be an integer of 2 or more.',
      INVALID_DID_UPDATE, { field: 'targetVersionId', actual: targetVersionId }
    );
  }
  if(!isBtcr2UpdateContext(unsignedUpdate['@context'])) {
    throw new UpdateError(
      'Invalid unsignedUpdate: @context must be the BTCR2 update context.',
      INVALID_DID_UPDATE, { field: '@context', expected: [ ...BTCR2_UPDATE_CONTEXT ], actual: unsignedUpdate['@context'] }
    );
  }
  // The read path decodes each hash with a strict base64url decoder and compares the bytes. The
  // decoder accepts one text for each hash, so the text comparison here gives the same result.
  const sourceHash = sourceHashOf(sourceDocument);
  if(unsignedUpdate.sourceHash !== sourceHash) {
    throw new UpdateError(
      'Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.',
      INVALID_DID_UPDATE, { field: 'sourceHash', expected: sourceHash, actual: unsignedUpdate.sourceHash }
    );
  }

  // The write path builds the update again from the patch. Updater.construct applies the patch
  // with the rules of the read path, so the hash of its target document is the hash that a
  // resolver computes.
  let rebuilt: UnsignedBTCR2Update;
  try {
    rebuilt = Updater.construct(sourceDocument, unsignedUpdate.patch, (targetVersionId as number) - 1);
  } catch(error) {
    throw new UpdateError(
      `Invalid unsignedUpdate: the patch does not give a valid DID document from sourceDocument: ${errorCause(error).message}`,
      INVALID_DID_UPDATE, { field: 'patch', cause: errorCause(error) }
    );
  }
  if(unsignedUpdate.targetHash !== rebuilt.targetHash) {
    throw new UpdateError(
      'Invalid unsignedUpdate: targetHash is not the hash of the document that the patch gives.',
      INVALID_DID_UPDATE, { field: 'targetHash', expected: rebuilt.targetHash, actual: unsignedUpdate.targetHash }
    );
  }
}

/**
 * Sans-I/O state machine for did:btcr2 updates: the counterpart to {@link Resolver}.
 *
 * Created by {@link DidBtcr2.update} (the factory). The caller drives the update by
 * repeatedly calling {@link advance} and {@link provide}:
 *
 * ```typescript
 * const updater = DidBtcr2.update({ sourceDocument, patches, ... });
 * const signer = new LocalSigner(secretKeyBytes); // or KeyManagerSigner / custom
 * let state = updater.advance();
 *
 * while(state.status === 'action-required') {
 *   for(const need of state.needs) {
 *     switch(need.kind) {
 *       case 'NeedSigningKey':
 *         updater.provide(need, signer);
 *         break;
 *       case 'NeedFunding':
 *         // Check UTXOs at need.beaconAddress, fund if needed
 *         updater.provide(need);
 *         break;
 *       case 'NeedBroadcast': {
 *         // Capture the BroadcastResult: broadcast.txid, plus broadcast.announcement
 *         // (CAS beacons) and broadcast.proof (SMT beacons; must be retained, the
 *         // proof's nonce exists nowhere else).
 *         const broadcast = await Updater.announce(need.beaconService, need.did, need.signedUpdate, signer, bitcoin);
 *         updater.provide(need);
 *         break;
 *       }
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
 * The class also exposes static utility methods ({@link construct}, {@link signingMethod},
 * {@link sign}, {@link announce}) for callers that need direct access to individual update
 * steps outside the state machine (e.g., test vector generation scripts).
 *
 * @class Updater
 */
export class Updater {
  #state: InternalState = { phase: 'Construct' };
  readonly #sourceDocument: Btcr2DidDocument;
  readonly #patches: PatchOperation[];
  readonly #sourceVersionId: number;
  readonly #verificationMethodId: string;
  readonly #beaconService: BeaconService;

  /**
   * @internal Use {@link DidBtcr2.update} to create instances.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if `verificationMethodId` is neither a DID URL
   *   nor a relative DID URL that starts with `#`.
   */
  constructor(params: UpdaterParams) {
    this.#sourceDocument = params.sourceDocument;
    this.#patches = params.patches;
    this.#sourceVersionId = params.sourceVersionId;
    // The absolute spelling: NeedSigningKey and the proof name the method by the same id.
    this.#verificationMethodId = absoluteMethodId(params.verificationMethodId, params.sourceDocument.id);
    this.#beaconService = params.beaconService;
  }

  // ─── Public static utility methods ─────────────────────────────────────────
  // Used by generate-vector.ts and other scripts that need direct access to
  // individual update steps outside the state machine flow.

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update | Construct BTCR2 Unsigned Update}.
   *
   * @param {Btcr2DidDocument} sourceDocument The source DID document to be updated.
   * @param {PatchOperation[]} patches The JSON Patch operations to apply.
   * @param {number} sourceVersionId The version ID of the source document.
   * @returns {UnsignedBTCR2Update} The constructed UnsignedBTCR2Update object.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if `sourceVersionId` is not an integer of 1 or more.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if `sourceDocument` is not an object, or if its `id`
   *   is not a string.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if `sourceDocument` or `patches` has no JCS form, for
   *   example if it holds NaN or a lone surrogate. `data.cause` holds the CanonicalizationError.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if `patches` is malformed or fails to apply by the
   *   rules of RFC 6902 and RFC 6901. `data.cause` holds the MethodError of type
   *   `JSON_PATCH_APPLY_ERROR`.
   * @throws {UpdateError} If the target document fails DID Core validation.
   */
  static construct(
    sourceDocument: Btcr2DidDocument,
    patches: PatchOperation[],
    sourceVersionId: number,
  ): UnsignedBTCR2Update {
    // The version of a DID document is an integer of 1 or more. Without this check, the
    // string '1' gives the targetVersionId '11', and undefined gives NaN.
    if(!Number.isInteger(sourceVersionId) || sourceVersionId < 1) {
      throw new UpdateError(
        'Invalid sourceVersionId: expected an integer of 1 or more.',
        INVALID_DID_UPDATE, { sourceVersionId }
      );
    }

    // Spec "Construct BTCR2 Unsigned Update" compares the id of the target document with the
    // id of the source document, and DID Core v1.1 requires a string id. JSONPatch.apply copies
    // the document, so an object id never equals its copy, and the id check below then gives
    // the wrong reason.
    if(!isJsonMap(sourceDocument)) {
      throw new UpdateError(
        'Invalid sourceDocument: expected a DID document object.',
        INVALID_DID_UPDATE, { sourceDocument }
      );
    }
    if(typeof sourceDocument.id !== 'string') {
      const text = messageText(sourceDocument.id);
      throw new UpdateError(
        'Invalid sourceDocument: expected a string id' + (text === undefined ? '.' : `; got ${text}.`),
        INVALID_DID_UPDATE, { sourceId: sourceDocument.id }
      );
    }

    const unsignedUpdate: UnsignedBTCR2Update = {
      // The array the specification pins, as a fresh copy: the update is a plain JSON
      // object that callers may edit, and the shared constant is frozen.
      '@context'      : [ ...BTCR2_UPDATE_CONTEXT ],
      patch           : patches,
      targetHash      : '',
      targetVersionId : sourceVersionId + 1,
      sourceHash      : sourceHashOf(sourceDocument),
    };

    // Spec "Construct BTCR2 Unsigned Update": "An INVALID_DID_UPDATE error MUST be raised if
    // jsonPatch is malformed or fails to apply." JSONPatch.apply uses the rules of RFC 6902
    // and RFC 6901: the first operation that fails, a failed test included, fails the whole
    // patch. The refusal comes before the update is signed and announced, because a
    // conformant resolver refuses the same patch.
    let targetDocument: Record<string, any>;
    try {
      targetDocument = JSONPatch.apply(sourceDocument, patches);
      // The update holds the operations as given, and a resolver hashes the update with JCS.
      // JSONPatch.apply runs on a JSON copy of the operations, which writes NaN as null, so
      // the target document can have a hash while the patch has no JCS form. The check runs
      // after JSONPatch.apply, so that a patch that is not an array keeps the error of
      // JSONPatch.apply.
      canonicalize(patches);
    } catch(error) {
      throw new UpdateError(
        `Invalid patch: ${errorCause(error).message}`,
        INVALID_DID_UPDATE, { cause: errorCause(error) }
      );
    }

    // A patch can replace the whole document, for example with null. The id check below
    // reads a member, so the target must be a JSON object first.
    if(!isJsonMap(targetDocument)) {
      throw new UpdateError(
        `Error validating targetDocument: ${NOT_A_JSON_OBJECT}`,
        INVALID_DID_UPDATE, { targetDocument }
      );
    }

    // Spec (operations/update.md): "An INVALID_DID_UPDATE error MUST be raised if
    // targetDidDocument.id is not equal to sourceDidDocument.id." `DidDocument.isValid`
    // checks W3C conformance but not this equality, so it's enforced explicitly here.
    if(targetDocument.id !== sourceDocument.id) {
      const text = messageText(targetDocument.id);
      throw new UpdateError(
        'Patches must not change the DID document id'
        + (text === undefined ? '.' : ` (source "${sourceDocument.id}" to target "${text}").`),
        INVALID_DID_UPDATE, { sourceId: sourceDocument.id, targetId: targetDocument.id }
      );
    }

    // The write path makes the target document, so it checks the rules of a producer.
    try {
      DidDocument.isValid(targetDocument, 'producer');
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
   * Returns the verification method that signs an update of `sourceDocument`. Implements the
   * method lookup and the method checks of subsection
   * {@link https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-signed-update | Construct BTCR2 Signed Update}:
   *
   * 1. An entry of `capabilityInvocation` must identify `verificationMethodId`, in the
   *    reference form or the embedded form. Both sides resolve to absolute DID URLs first, so
   *    the caller and the document can spell the id in different forms.
   * 2. A reference entry must name a member of `verificationMethod`.
   * 3. The method must have the type `Multikey`, the DID as its controller, and a secp256k1
   *    public key in the BIP340 Multikey encoding.
   *
   * Before the lookup, this function checks the shape of `sourceDocument`. The proof names the
   * method by a DID URL, so this function also refuses an id that does not resolve to a DID URL.
   *
   * The read path applies the same lookup and the same checks to `update.proof`, so an update
   * that passes these checks is one that a resolver also accepts. {@link DidBtcr2.update} calls
   * this function before Construct, and {@link sign} calls it again.
   *
   * @param {Btcr2DidDocument} sourceDocument The DID document to update. Its `id` is the DID.
   * @param {string} verificationMethodId The id of the method, absolute or relative.
   * @returns {DidVerificationMethod} The verification method that signs.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if one of these conditions is true:
   *   - `sourceDocument` is not an object.
   *   - `sourceDocument.id` is not a did:btcr2 identifier.
   *   - `capabilityInvocation` or `verificationMethod` is present and is not an array.
   *   - The lookup or a method check above fails.
   *   - The id is neither a DID URL nor a relative DID URL that starts with `#`.
   */
  static signingMethod(sourceDocument: Btcr2DidDocument, verificationMethodId: string): DidVerificationMethod {
    // The shape of the source document. The caller of this public function can give any value,
    // but the lookup below reads an object with a did:btcr2 id and arrays.
    if(typeof sourceDocument !== 'object' || sourceDocument === null || Array.isArray(sourceDocument)) {
      throw new UpdateError(
        'Invalid sourceDocument: expected a DID document object.',
        INVALID_DID_UPDATE, { sourceDocument }
      );
    }
    const did: unknown = sourceDocument.id;
    if(typeof did !== 'string' || !did.startsWith('did:btcr2:')) {
      const text = messageText(did);
      throw new UpdateError(
        'Expected a did:btcr2 identifier for the root capability'
        + (text === undefined ? '.' : `; got "${text}".`),
        INVALID_DID_UPDATE, { did }
      );
    }
    for(const field of [ 'capabilityInvocation', 'verificationMethod' ] as const) {
      const value: unknown = sourceDocument[field];
      if(value !== undefined && !Array.isArray(value)) {
        throw new UpdateError(
          `Invalid sourceDocument: ${field} must be an array.`,
          INVALID_DID_UPDATE, { field, actual: value }
        );
      }
    }

    // The proof names the method by its absolute DID URL. Every error below names the method
    // by the same id, as NeedSigningKey and the proof do.
    const methodId = absoluteMethodId(verificationMethodId, did);

    const entry = Appendix.capabilityInvocationEntry(sourceDocument, methodId);
    if(entry === undefined) {
      throw new UpdateError(
        'Invalid verificationMethodId: not authorized for capabilityInvocation',
        INVALID_DID_UPDATE, { verificationMethodId: methodId, capabilityInvocation: sourceDocument.capabilityInvocation }
      );
    }

    // The method is the embedded object of the entry, or the member of verificationMethod[]
    // that a reference entry names.
    const verificationMethod = Appendix.verificationMethodOfEntry(sourceDocument, entry);
    if(verificationMethod === undefined) {
      throw new UpdateError(
        'Invalid verificationMethodId: not found in source document',
        INVALID_DID_UPDATE, { verificationMethodId: methodId }
      );
    }

    // The message and the data have the form of the read path, with the field that fails.
    const problem = signingMethodProblem(verificationMethod, sourceDocument.id);
    if(problem !== undefined) {
      const reason = problem.cause !== undefined ? `: ${problem.cause.message}` : '';
      throw new UpdateError(
        `Invalid update: verificationMethod.${problem.message}${reason}`,
        INVALID_DID_UPDATE, {
          verificationMethodId : methodId,
          field                : problem.field,
          actual               : verificationMethod[problem.field],
          ...(problem.cause !== undefined && { cause: problem.cause })
        }
      );
    }
    return verificationMethod as DidVerificationMethod;
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-signed-update | Construct BTCR2 Signed Update}.
   *
   * The DID is `sourceDocument.id`: the source of the root capability and the invocation
   * target. The method that signs must pass {@link signingMethod}. The proof names the method
   * by its absolute DID URL. `unsignedUpdate` must be an update of `sourceDocument`: its
   * `sourceHash` and `targetHash` must be the hashes that a resolver computes from
   * `sourceDocument` and `patch`.
   *
   * Updater.sign gets no version of `sourceDocument`. The caller must make sure that
   * `targetVersionId` is the version of `sourceDocument` plus 1. A resolver refuses another value.
   *
   * @param {Btcr2DidDocument} sourceDocument The DID document that the update changes.
   * @param {UnsignedBTCR2Update} unsignedUpdate The unsigned update to sign.
   * @param {string} verificationMethodId The id of the method that signs, absolute or relative.
   * @param {Signer} signer Signer that produces the BIP-340 Schnorr signature.
   * @returns {SignedBTCR2Update} The signed update with a Data Integrity proof.
   * @throws {UpdateError} `INVALID_DID_UPDATE` if one of these conditions is true:
   *   - `sourceDocument` or the method fails a condition of {@link signingMethod}.
   *   - `unsignedUpdate` is not an object, or it has a `proof` member.
   *   - `targetVersionId` is not an integer of 2 or more.
   *   - `@context` is not the array that the specification pins for a BTCR2 Update.
   *   - `sourceDocument` has no JCS form, or `sourceHash` is not its hash.
   *   - `patch` does not give a valid DID document from `sourceDocument`. `data.cause` holds
   *     the error of {@link construct}.
   *   - `targetHash` is not the hash of the document that `patch` gives.
   *   - The public key of the signer is not the key of the method.
   *   - The signer or the cryptosuite fails. `data.cause` holds the inner error.
   *   - The proof does not verify with the key of the method.
   */
  static sign(
    sourceDocument: Btcr2DidDocument,
    unsignedUpdate: UnsignedBTCR2Update,
    verificationMethodId: string,
    signer: Signer,
  ): SignedBTCR2Update {
    // signingMethod refuses a sourceDocument whose id is not a did:btcr2 identifier.
    const verificationMethod = Updater.signingMethod(sourceDocument, verificationMethodId);

    // A resolver refuses an announced update whose hashes do not match the documents, and then
    // the DID no longer resolves. So Updater.sign refuses an update that does not belong to
    // sourceDocument, before it signs.
    checkUnsignedUpdate(sourceDocument, unsignedUpdate);

    const did = sourceDocument.id;
    const methodId = absoluteMethodId(verificationMethodId, did);

    // The multikey has the absolute method id and the DID as its controller, so its fullId()
    // is the id that the proof names, with or without a fragment.
    let multikey: SchnorrMultikey;
    try {
      multikey = SchnorrMultikey.fromSigner(methodId, did, signer);
    } catch(error) {
      throw new UpdateError(
        `Invalid signer: ${errorCause(error).message}`,
        INVALID_DID_UPDATE, { verificationMethodId: methodId, cause: errorCause(error) }
      );
    }

    // Fail fast if the signer's public key is not the key published in the named
    // verification method. Signing with the wrong key yields a Data Integrity
    // proof that cannot verify against the method, so the resulting on-chain
    // announcement is wasted: a resolver replaying the update rejects it. Catching
    // it here guards every update path (state machine, builder, api, cli) at a
    // single chokepoint. signingMethod above proves that the method has the key, in the
    // base58btc text of the key, so the two texts compare equal for the same key.
    const signerKey = multikey.publicKey.multibase.encoded;
    if(signerKey !== verificationMethod.publicKeyMultibase) {
      throw new UpdateError(
        `Signing key does not match verification method "${methodId}": the signer's public `
        + 'key differs from the method\'s published publicKeyMultibase.',
        INVALID_DID_UPDATE,
        {
          verificationMethodId : methodId,
          expected             : verificationMethod.publicKeyMultibase,
          actual               : signerKey,
        }
      );
    }

    const config: Btcr2DataIntegrityConfig = {
      // The proof must carry the same array as the update. The cryptosuite copies the
      // document @context into the proof when the document has one, so the two arrays
      // are equal by construction; this value is the fallback for a document without one.
      '@context'         : [ ...BTCR2_UPDATE_CONTEXT ],
      cryptosuite        : 'bip340-jcs-2025',
      type               : 'DataIntegrityProof',
      // The proof names the signing method by absolute DID URL, even when the document
      // spells that method's own id relatively: a proof travels apart from the document
      // that defines the method, so a bare `#initialKey` in it resolves against nothing.
      // For a document that already spells its ids absolutely this is the id unchanged,
      // so proofs over such documents are byte-identical to before.
      verificationMethod : methodId,
      proofPurpose       : 'capabilityInvocation',
      capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
      capabilityAction   : 'Write',
      invocationTarget   : did,
    };

    // The signer and the cryptosuite run here. Their errors carry other types (a key manager
    // that holds no secret key, for example), so Updater.sign wraps them as an invalid update.
    let signedUpdate: SignedBTCR2Update;
    try {
      const diproof = multikey.toCryptosuite().toDataIntegrityProof();
      // addProof writes the proof into the object that it gets. Updater.sign gives it a copy, so
      // the update of the caller keeps no proof. The caller can then sign the same update again,
      // for example after a signer fails.
      signedUpdate = diproof.addProof({ ...unsignedUpdate }, config) as SignedBTCR2Update;
    } catch(error) {
      throw new UpdateError(
        `Invalid update: cannot make the proof with "${methodId}": ${errorCause(error).message}`,
        INVALID_DID_UPDATE, { verificationMethodId: methodId, cause: errorCause(error) }
      );
    }

    // Spec "Construct BTCR2 Signed Update": verify update.proof before the announcement,
    // with the public key that the verification method publishes, not the signer's key. A
    // signer that returns a wrong signature for the right key passes the key comparison
    // above. An announced update with an invalid proof permanently invalidates the DID, so
    // the failure surfaces here, before the state machine asks for funding.
    let verified: boolean;
    try {
      const verifier = SchnorrMultikey.fromVerificationMethod({ ...verificationMethod, id: methodId });
      verified = verifier.toCryptosuite().toDataIntegrityProof()
        .verifyProof(canonicalize(signedUpdate), 'capabilityInvocation').verified;
    } catch(error) {
      throw new UpdateError(
        `Invalid update: the proof does not verify with the public key of "${methodId}": `
        + errorCause(error).message,
        INVALID_DID_UPDATE, { verificationMethodId: methodId, cause: errorCause(error) }
      );
    }
    if(!verified) {
      throw new UpdateError(
        `Invalid update: the proof does not verify with the public key of "${methodId}".`,
        INVALID_DID_UPDATE, { verificationMethodId: methodId }
      );
    }
    return signedUpdate;
  }

  /**
   * Implements subsection {@link https://dcdpr.github.io/did-btcr2/operations/update.html#announce-did-update | Announce DID Update}.
   * Announces a signed update to the Bitcoin blockchain via the specified beacon.
   *
   * @param {BeaconService} beaconService The beacon service to broadcast through.
   * @param {string} did The DID being updated. Required because a beacon service
   *   `id` may be a relative DID URL and so cannot supply the subject.
   * @param {SignedBTCR2Update} update The signed update to announce.
   * @param {Signer} signer Signer that produces the ECDSA signature for the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {CASBroadcastOptions} [options] Optional broadcast configuration (fee estimator,
   *   change address, and, for CAS beacons, a `casPublish` callback invoked before the
   *   transaction broadcast; other beacon types ignore `casPublish`).
   * @returns {Promise<BroadcastResult>} The broadcast artifacts: the signed update, the signal
   *   txid, and any per-beacon-type sidecar data (CAS announcement / SMT proof).
   */
  static async announce(
    beaconService: BeaconService,
    did: string,
    update: SignedBTCR2Update,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: CASBroadcastOptions
  ): Promise<BroadcastResult> {
    const beacon = BeaconFactory.establish(beaconService, did);
    return beacon.broadcastSignal(update, signer, bitcoin, options);
  }

  // Private instance wrappers
  // Delegate to the public statics with bound instance fields for cleaner
  // advance/provide code.

  #construct(): UnsignedBTCR2Update {
    return Updater.construct(this.#sourceDocument, this.#patches, this.#sourceVersionId);
  }

  /**
   * Advance the state machine. Returns either:
   * - `{ status: 'action-required', needs }` caller must provide data via {@link provide}
   * - `{ status: 'complete', result }` update is signed and broadcast
   */
  advance(): UpdaterState {
    while(true) {
      switch(this.#state.phase) {

        // Phase: Construct
        // Build the unsigned update from source doc + patches. Pure, synchronous.
        case 'Construct': {
          const unsignedUpdate = this.#construct();
          this.#state = { phase: 'Sign', unsignedUpdate };
          continue;
        }

        // Phase: Sign
        // Emit NeedSigningKey: the caller supplies the secret key (or a KMS signature).
        case 'Sign': {
          return {
            status : 'action-required',
            needs  : [{
              kind                 : 'NeedSigningKey',
              verificationMethodId : this.#verificationMethodId,
              unsignedUpdate       : this.#state.unsignedUpdate,
            }],
          };
        }

        // Phase: Fund
        // Emit NeedFunding with the beacon address. The caller checks UTXOs,
        // funds the address if needed, and provides to continue.
        case 'Fund': {
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
        case 'Broadcast': {
          return {
            status : 'action-required',
            needs  : [{
              kind          : 'NeedBroadcast',
              beaconService : this.#beaconService,
              signedUpdate  : this.#state.signedUpdate,
              did           : this.#sourceDocument.id,
            }],
          };
        }

        // Phase: Complete
        case 'Complete': {
          return {
            status : 'complete',
            result : { signedUpdate: this.#state.signedUpdate },
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
  provide(need: NeedSigningKey, data: Signer): void;
  provide(need: NeedFunding, proof?: FundingProof): void;
  provide(need: NeedBroadcast): void;
  provide(need: UpdaterDataNeed, data?: Signer | FundingProof): void {
    switch(need.kind) {
      case 'NeedSigningKey': {
        if(this.#state.phase !== 'Sign') {
          throw new UpdateError(
            `Cannot provide NeedSigningKey: updater phase is ${this.#state.phase}, expected Sign.`,
            INVALID_DID_UPDATE, { phase: this.#state.phase }
          );
        }
        if(!data) {
          throw new UpdateError(
            'NeedSigningKey requires a Signer.',
            INVALID_DID_UPDATE
          );
        }
        const unsignedUpdate = this.#state.unsignedUpdate;
        const signedUpdate = Updater.sign(
          this.#sourceDocument, unsignedUpdate, this.#verificationMethodId, data as Signer,
        );
        this.#state = { phase: 'Fund', unsignedUpdate, signedUpdate };
        break;
      }

      case 'NeedFunding': {
        if(this.#state.phase !== 'Fund') {
          throw new UpdateError(
            `Cannot provide NeedFunding: updater phase is ${this.#state.phase}, expected Fund.`,
            INVALID_DID_UPDATE, { phase: this.#state.phase }
          );
        }
        // If the caller supplies a FundingProof, assert it before transitioning.
        // Optional payload preserves the sans-I/O contract: the caller still does
        // the actual UTXO lookup; this is a contract-level handshake that catches
        // a class of caller bugs (forgot to fund, race with mempool, etc.) at the
        // state-machine boundary rather than at broadcast time.
        if(data !== undefined) {
          const proof = data as FundingProof;
          if(typeof proof.utxoCount !== 'number' || !Number.isFinite(proof.utxoCount) || proof.utxoCount < 1) {
            const text = messageText(proof.utxoCount);
            throw new UpdateError(
              'NeedFunding proof must have utxoCount >= 1' + (text === undefined ? '.' : `; got ${text}.`),
              INVALID_DID_UPDATE, { utxoCount: proof.utxoCount }
            );
          }
        }
        this.#state = {
          phase          : 'Broadcast',
          unsignedUpdate : this.#state.unsignedUpdate,
          signedUpdate   : this.#state.signedUpdate,
        };
        break;
      }

      case 'NeedBroadcast': {
        if(this.#state.phase !== 'Broadcast') {
          throw new UpdateError(
            `Cannot provide NeedBroadcast: updater phase is ${this.#state.phase}, expected Broadcast.`,
            INVALID_DID_UPDATE, { phase: this.#state.phase }
          );
        }
        // Caller has broadcast externally. Transition to Complete.
        this.#state = { phase: 'Complete', signedUpdate: this.#state.signedUpdate };
        break;
      }
    }
  }
}
