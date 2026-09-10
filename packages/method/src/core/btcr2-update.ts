import type { PatchOperation } from '@did-btcr2/common';
import type { DataIntegrityProofObject, DataIntegrityProofOptions } from '@did-btcr2/cryptosuite';

/**
 * The `@context` array of a BTCR2 Update. The specification pins the members and their
 * order. The array is part of the bytes that the JSON Document Hashing algorithm hashes
 * and that the proof signs, so an update with a different array is a different update,
 * and a conformant resolver rejects it. The proof of a signed update carries the same
 * array. See
 * {@link https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-unsigned-update | BTCR2 Unsigned Update (data structure)}.
 */
export const BTCR2_UPDATE_CONTEXT = Object.freeze([
  'https://w3id.org/json-ld-patch/v1',
  'https://w3id.org/zcap/v1',
  'https://w3id.org/security/data-integrity/v2',
  'https://btcr2.dev/context/v1',
] as const);

/**
 * True if `value` is an array with the same context URLs as `expected`, in the same
 * order, and with no other member. This is the equality rule of the specification for
 * two `@context` arrays. `expected` defaults to {@link BTCR2_UPDATE_CONTEXT}.
 *
 * @param {unknown} value The `@context` value to check.
 * @param {readonly string[]} expected The array that `value` must equal.
 * @returns {boolean} True if the two arrays are equal.
 */
export function isBtcr2UpdateContext(
  value: unknown,
  expected: readonly string[] = BTCR2_UPDATE_CONTEXT
): value is string[] {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((url, i) => url === expected[i]);
}

/**
 * The JSON Patch operation of the Deactivate operation: it adds the `deactivated` property
 * with the value `true`. Deactivate is the Update operation with this predetermined patch, and
 * resolution stops at the deactivation for good. See
 * {@link https://dcdpr.github.io/did-btcr2/operations/deactivate.html | Deactivate}.
 */
export const DEACTIVATION_PATCH: Readonly<PatchOperation> = Object.freeze({
  op    : 'add',
  path  : '/deactivated',
  value : true,
});

/**
 * A {@link https://dcdpr.github.io/did-btcr2/terminology.html#btcr2-update | BTCR2 Update} without a data integrity proof.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-unsigned-update | BTCR2 Unsigned Update (data structure)}.
 *
 * This is the did:btcr2-specific document the generic `@did-btcr2/cryptosuite`
 * suite secures; the suite itself is method-agnostic and knows nothing about it.
 * Declared as a type alias (not an interface) so it satisfies the suite's
 * generic `UnsecuredDocument` (a plain JSON record) constraint.
 */
export type UnsignedBTCR2Update = {
  /**
   * The JSON-LD context array of the update: exactly the members of
   * {@link BTCR2_UPDATE_CONTEXT}, in that order.
   */
  '@context': string[];

  /**
   * A JSON Patch (or JSON-LD Patch) object defining the mutations to apply to
   * the DID Document. Applying this patch to the current DID Document yields
   * the new DID Document (which must remain valid per DID Core spec).
   */
  patch: Array<PatchOperation>;

  /**
   * The multihash of the current (source) DID Document, encoded as a multibase
   * base58-btc string. This is a SHA-256 hash of the canonicalized source DID
   * Document, used to ensure the patch is applied to the correct document state.
   */
  sourceHash: string;

  /**
   * The multihash of the updated (target) DID Document, encoded as multibase
   * base58-btc. This is the SHA-256 hash of the canonicalized DID Document
   * after applying the patch, used to verify the update result.
   */
  targetHash: string;

  /**
   * The version number of the DID Document after this update.
   * It is equal to the previous document version + 1.
   */
  targetVersionId: number;
};

/**
 * A Data Integrity proof on a BTCR2 update: the generic proof object plus the
 * ZCAP capability-invocation fields a did:btcr2 update proof carries.
 */
export type Btcr2DataIntegrityProof = DataIntegrityProofObject & {
  /** The root capability being invoked: `urn:zcap:root:${encodeURIComponent(did)}`. */
  capability: string;

  /** The action performed under the capability: `"Write"` for a DID document update. */
  capabilityAction: string;
};

/**
 * A {@link https://dcdpr.github.io/did-btcr2/terminology.html#btcr2-signed-update | BTCR2 Update} with a data integrity proof.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-signed-update | BTCR2 Signed Update (data structure)}.
 */
export type SignedBTCR2Update = UnsignedBTCR2Update & {
  /** The Data Integrity proof that converts an unsigned update into a signed update. */
  proof: Btcr2DataIntegrityProof;
};

/** Either form of a BTCR2 Update. */
export type BTCR2Update = UnsignedBTCR2Update | SignedBTCR2Update;

/**
 * Data Integrity proof options for a BTCR2 update: the standard
 * {@link DataIntegrityProofOptions} plus the ZCAP capability-invocation fields a
 * did:btcr2 update proof carries. See
 * {@link https://dcdpr.github.io/did-btcr2/data-structures.html#data-integrity-config | Data Integrity Config}.
 */
export type Btcr2DataIntegrityConfig = DataIntegrityProofOptions & {
  /** The same array as the update `@context`: {@link BTCR2_UPDATE_CONTEXT}. */
  '@context': string[];

  /** The root capability being invoked: `urn:zcap:root:${encodeURIComponent(did)}`. */
  capability: string;

  /** The action performed under the capability: `"Write"` for a DID document update. */
  capabilityAction: string;
};
