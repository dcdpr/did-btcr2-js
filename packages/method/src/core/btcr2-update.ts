import type { PatchOperation } from '@did-btcr2/common';
import type { DataIntegrityProofObject, DataIntegrityProofOptions } from '@did-btcr2/cryptosuite';

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
   * JSON-LD context URIs for interpreting this payload, including contexts
   * for ZCAP (capabilities), Data Integrity proofs, and JSON-LD patch ops.
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
  /** The root capability being invoked, e.g. `urn:zcap:root:<urlencoded-did>`. */
  capability?: string;

  /** The action performed under the capability, set to `"Write"` for DID document updates. */
  capabilityAction?: string;
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
  /** JSON-LD context URIs for the proof (ZCAP, Data Integrity, JSON-LD patch). */
  '@context': string[];

  /** The root capability being invoked, e.g. `urn:zcap:root:<urlencoded-did>`. */
  capability?: string;

  /** The action performed under the capability, set to `"Write"` for DID document updates. */
  capabilityAction?: string;
};
