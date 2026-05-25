import { base64UrlToHash, bigIntToHash, hashToBase64Url, hashToBigInt } from './hash.js';
import { verifyZeroHash, type ZeroHashProof } from './zero-hash.js';

/**
 * did:btcr2 serialized SMT proof format.
 * See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof | SMT Proof (data structure)}
 * and {@link https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification | SMT Proof Verification}.
 *
 * Structurally identical to the `SMTProof` interface in
 * `@did-btcr2/method/src/core/interfaces.ts`.
 */
export interface SerializedSMTProof {
  /** base64url (no padding) SHA-256 root hash (43 chars). */
  id: string;
  /** base64url (no padding) 256-bit nonce (43 chars), hashed at the leaf. Optional. */
  nonce?: string;
  /** base64url (no padding) hash of the signed BTCR2 update (43 chars). Optional. */
  updateId?: string;
  /**
   * base64url (no padding) 256-bit "collapsed" bitmap (43 chars). Per the
   * verification algorithm, bit `i` set = the sibling at tree level `i` is empty
   * (use the precomputed `cachedZero[255 - i]`); bit `i` clear = the next sibling
   * hash from {@link SerializedSMTProof.hashes} applies. Level `i = 255` is the
   * leaf level, `i = 0` is the root level.
   */
  collapsed: string;
  /** base64url (no padding) sibling SHA-256 hashes (43 chars each), leaf-to-root. */
  hashes: string[];
}

/** Optional nonce / updateId metadata attached to a serialized proof. */
export interface SerializeProofOptions {
  nonce?    : Uint8Array;
  updateId? : Uint8Array;
}

/**
 * Serialize a zero-hash inclusion proof to the did:btcr2 wire format.
 *
 * @param rootHash The SMT root (becomes `id`).
 * @param proof    The {@link ZeroHashProof} (collapsed bitmap + sibling hashes).
 * @param options  Optional `nonce` and `updateId` (32-byte hashes).
 */
export function serializeProof(
  rootHash: Uint8Array,
  proof: ZeroHashProof,
  options?: SerializeProofOptions
): SerializedSMTProof {
  const result: SerializedSMTProof = {
    id        : hashToBase64Url(rootHash),
    collapsed : hashToBase64Url(bigIntToHash(proof.collapsed)),
    hashes    : proof.hashes.map(h => hashToBase64Url(h)),
  };
  if (options?.nonce)    result.nonce    = hashToBase64Url(options.nonce);
  if (options?.updateId) result.updateId = hashToBase64Url(options.updateId);
  return result;
}

/** Result of {@link deserializeProof}. */
export interface DeserializedProof {
  rootHash  : Uint8Array;
  collapsed : bigint;
  hashes    : Uint8Array[];
  nonce?    : Uint8Array;
  updateId? : Uint8Array;
}

/** Parse a did:btcr2 serialized proof into raw bytes / the collapsed bigint. */
export function deserializeProof(serialized: SerializedSMTProof): DeserializedProof {
  const result: DeserializedProof = {
    rootHash  : base64UrlToHash(serialized.id),
    collapsed : hashToBigInt(base64UrlToHash(serialized.collapsed)),
    hashes    : serialized.hashes.map(h => base64UrlToHash(h)),
  };
  if (serialized.nonce)    result.nonce    = base64UrlToHash(serialized.nonce);
  if (serialized.updateId) result.updateId = base64UrlToHash(serialized.updateId);
  return result;
}

/**
 * Verify a did:btcr2 serialized proof in one step, per the spec's SMT Proof
 * Verification algorithm.
 *
 * @param serialized    The serialized proof to verify.
 * @param index         Leaf index (`didToIndex(did)`).
 * @param candidateHash Expected leaf hash `hash(hash(nonce) || updateId)`
 *   (`inclusionLeafHash`) or `hash(hash(nonce))` (`nonInclusionLeafHash`).
 * @returns `true` if the proof is valid.
 */
export function verifySerializedProof(
  serialized: SerializedSMTProof,
  index: bigint,
  candidateHash: Uint8Array
): boolean {
  const { rootHash, collapsed, hashes } = deserializeProof(serialized);
  return verifyZeroHash(collapsed, hashes, index, candidateHash, rootHash);
}
