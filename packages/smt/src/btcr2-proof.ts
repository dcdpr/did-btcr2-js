import { base64UrlToBigInt, base64UrlToHash, bigIntToBase64Url, hashToBase64Url } from './hash.js';
import { SMTProof } from './smt-proof.js';

/**
 * did:btcr2 serialized SMT proof format.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof | SMT Proof (data structure)}.
 *
 * Per spec, all SHA-256 hashes in did:btcr2 data structures MUST be encoded
 * using `base64url` (RFC 4648) without padding. The `collapsed` bitmap follows
 * the same encoding.
 *
 * Structurally identical to the `SMTProof` interface in
 * `@did-btcr2/method/src/core/interfaces.ts`.
 */
export interface SerializedSMTProof {
  /** SHA-256 root hash, base64urlnopad-encoded. */
  id: string;
  /** 256-bit nonce, base64urlnopad-encoded. Optional. */
  nonce?: string;
  /** Hash of the signed BTCR2 update, base64urlnopad-encoded. Optional. */
  updateId?: string;
  /** Converge bitmap, base64urlnopad-encoded (leading zero bytes stripped). */
  collapsed: string;
  /** Sibling hashes, each base64urlnopad-encoded. */
  hashes: string[];
}

/** Options for {@link serializeProof}. */
export interface SerializeProofOptions {
  nonce?    : Uint8Array;
  updateId? : Uint8Array;
}

/**
 * Convert an internal {@link SMTProof} plus root hash to the did:btcr2
 * serialized format.
 */
export function serializeProof(
  proof: SMTProof,
  rootHash: Uint8Array,
  options?: SerializeProofOptions
): SerializedSMTProof {
  const result: SerializedSMTProof = {
    id        : hashToBase64Url(rootHash),
    collapsed : bigIntToBase64Url(proof.converge, false),
    hashes    : proof.hashes.map(h => hashToBase64Url(h)),
  };
  if (options?.nonce)    result.nonce    = hashToBase64Url(options.nonce);
  if (options?.updateId) result.updateId = hashToBase64Url(options.updateId);
  return result;
}

/** Result of {@link deserializeProof}. */
export interface DeserializedProof {
  proof    : SMTProof;
  rootHash : Uint8Array;
  nonce?   : Uint8Array;
  updateId?: Uint8Array;
}

/**
 * Convert a did:btcr2 serialized proof back to an internal {@link SMTProof}
 * plus metadata.
 */
export function deserializeProof(serialized: SerializedSMTProof): DeserializedProof {
  const converge = base64UrlToBigInt(serialized.collapsed, false);
  const hashes   = serialized.hashes.map(h => base64UrlToHash(h));
  const result: DeserializedProof = {
    proof    : new SMTProof(converge, hashes),
    rootHash : base64UrlToHash(serialized.id),
  };
  if (serialized.nonce)    result.nonce    = base64UrlToHash(serialized.nonce);
  if (serialized.updateId) result.updateId = base64UrlToHash(serialized.updateId);
  return result;
}

/**
 * Verify a did:btcr2 serialized proof in one step.
 *
 * @param serialized    - The serialized proof to verify.
 * @param index         - Leaf index (`didToIndex(did)`).
 * @param candidateHash - Expected leaf hash (`inclusionLeafHash` or `nonInclusionLeafHash`).
 * @returns `true` if the proof is valid.
 */
export function verifySerializedProof(
  serialized: SerializedSMTProof,
  index: bigint,
  candidateHash: Uint8Array
): boolean {
  const { proof, rootHash } = deserializeProof(serialized);
  return proof.isValid(index, candidateHash, rootHash);
}
