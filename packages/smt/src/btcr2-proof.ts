import { base64urlnopad } from '@scure/base';
import { didToIndex, leafValue } from './btcr2-leaf.js';
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
  /**
   * base64url (no padding) nonce of this index in this signal. Optional. The
   * verifier accepts a nonce of any length: `hash(nonce)` is 32 bytes.
   */
  nonce?: string;
  /**
   * base64url (no padding) JSON Document Hash of the signed BTCR2 update (43 chars).
   * Optional. The presence of `nonce` and `updateId` selects the leaf value
   * (see `leafValue`).
   */
  updateId?: string;
  /**
   * base64url (no padding) 256-bit "collapsed" bitmap (43 chars). Bit `i`, counted
   * from the left as the verification algorithm counts it, set = the sibling at
   * tree level `i` is empty (use the precomputed `cachedZero[255 - i]`); bit `i`
   * clear = the next sibling hash from {@link SerializedSMTProof.hashes} applies.
   * Bit 0 is the root level, bit 255 the leaf level.
   */
  collapsed: string;
  /** base64url (no padding) sibling SHA-256 hashes (43 chars each), leaf-to-root. */
  hashes: string[];
}

/** Optional nonce / updateId metadata attached to a serialized proof. */
export interface SerializeProofOptions {
  /** The nonce of the index, any length. */
  nonce?    : Uint8Array;
  /** The 32-byte JSON Document Hash of the signed update. */
  updateId? : Uint8Array;
}

/**
 * Serialize a zero-hash proof to the did:btcr2 wire format.
 *
 * @param rootHash The SMT root (becomes `id`).
 * @param proof    The {@link ZeroHashProof} (collapsed bitmap + sibling hashes).
 * @param options  Optional `nonce` (any length) and `updateId` (32 bytes).
 * @throws {RangeError} if `updateId` is present and not 32 bytes.
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
  if (options?.nonce !== undefined)    result.nonce    = base64urlnopad.encode(options.nonce);
  if (options?.updateId !== undefined) result.updateId = hashToBase64Url(options.updateId);
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

/**
 * Parse a did:btcr2 serialized proof into raw bytes / the collapsed bigint.
 * @throws if `id`, `updateId`, `collapsed`, or an entry of `hashes` does not
 *   decode to 32 bytes, or if a field is not base64url.
 */
export function deserializeProof(serialized: SerializedSMTProof): DeserializedProof {
  const result: DeserializedProof = {
    rootHash  : base64UrlToHash(serialized.id),
    collapsed : hashToBigInt(base64UrlToHash(serialized.collapsed)),
    hashes    : serialized.hashes.map(h => base64UrlToHash(h)),
  };
  if (serialized.nonce !== undefined)    result.nonce    = base64urlnopad.decode(serialized.nonce);
  if (serialized.updateId !== undefined) result.updateId = base64UrlToHash(serialized.updateId);
  return result;
}

/**
 * Verify a did:btcr2 serialized proof against a caller-supplied leaf value, per
 * the spec's SMT Proof Verification walk. The result is `false` for a proof
 * that does not decode. Never throws on the proof.
 *
 * @param serialized    The serialized proof to verify.
 * @param index         Leaf index (`didToIndex(did)`).
 * @param candidateHash The leaf value (see `leafValue`).
 * @returns `true` if the proof is valid.
 */
export function verifySerializedProof(
  serialized: SerializedSMTProof,
  index: bigint,
  candidateHash: Uint8Array
): boolean {
  let proof: DeserializedProof;
  try {
    proof = deserializeProof(serialized);
  } catch {
    return false;
  }
  return verifyZeroHash(proof.collapsed, proof.hashes, index, candidateHash, proof.rootHash);
}

/**
 * SMT Proof Verification of the specification: verify a serialized proof for a DID.
 * The leaf value comes from the `nonce` and `updateId` fields of the proof
 * ({@link leafValue}). The result is `false` for a proof that does not decode, for an
 * `updateId`, `collapsed`, or `hashes` entry that is not 32 bytes, for a `hashes`
 * count that does not agree with `collapsed`, and for a root that is not `id`.
 * Never throws: every error of the decoder, also a type error from a field that
 * is not a string or an array, is `false`.
 */
export function verifyProof(serialized: SerializedSMTProof, did: string): boolean {
  let proof: DeserializedProof;
  try {
    proof = deserializeProof(serialized);
  } catch {
    return false;
  }
  const candidate = leafValue(proof.nonce, proof.updateId);
  return verifyZeroHash(proof.collapsed, proof.hashes, didToIndex(did), candidate, proof.rootHash);
}
