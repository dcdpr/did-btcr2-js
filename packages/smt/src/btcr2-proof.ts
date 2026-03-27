import { bigIntToHex, hashToHex, hexToBigInt, hexToHash } from './hash.js';
import { SMTProof } from './smt-proof.js';

/**
 * did:btcr2 serialized SMT proof format.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof | SMT Proof (data structure)}.
 *
 * Structurally identical to the `SMTProof` interface in
 * `@did-btcr2/method/src/core/interfaces.ts`.
 */
export interface SerializedSMTProof {
  /** Hex-encoded SHA-256 root hash (64 chars). */
  id: string;
  /** Hex-encoded 256-bit nonce (64 chars). Optional. */
  nonce?: string;
  /** Hex-encoded hash of the signed BTCR2 update (64 chars). Optional. */
  updateId?: string;
  /** Hex-encoded converge bitmap (unpadded — minimal hex digits). */
  collapsed: string;
  /** Hex-encoded sibling hashes (64 chars each). */
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
    id        : hashToHex(rootHash),
    collapsed : bigIntToHex(proof.converge, false),
    hashes    : proof.hashes.map(h => hashToHex(h)),
  };
  if (options?.nonce)    result.nonce    = hashToHex(options.nonce);
  if (options?.updateId) result.updateId = hashToHex(options.updateId);
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
  const converge = hexToBigInt(serialized.collapsed, false);
  const hashes   = serialized.hashes.map(h => hexToHash(h));
  const result: DeserializedProof = {
    proof    : new SMTProof(converge, hashes),
    rootHash : hexToHash(serialized.id),
  };
  if (serialized.nonce)    result.nonce    = hexToHash(serialized.nonce);
  if (serialized.updateId) result.updateId = hexToHash(serialized.updateId);
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
