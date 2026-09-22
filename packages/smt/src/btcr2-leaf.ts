import { blockHash, hashToBigInt, validateHash } from './hash.js';
import { CACHED_ZERO } from './zero-hash.js';

const encoder = new TextEncoder();

/**
 * The SMT leaf index of a DID: `hash(did)` over the UTF-8 bytes of the DID string, read
 * as a big-endian 256-bit integer. The most significant bit selects the child of the
 * root. The least significant bit selects the leaf.
 */
export function didToIndex(did: string): bigint {
  return hashToBigInt(blockHash(encoder.encode(did)));
}

/**
 * The value of the leaf at the index of a DID: the four arms of the SMT Proof
 * Verification algorithm. The DID controller selects the arm for each index and each
 * signal:
 *
 * - `nonce` and `updateId`: `hash(hash(nonce) + updateId)`. An update in nonce mode.
 * - `nonce` only: `hash(hash(nonce))`. No update in nonce mode.
 * - `updateId` only: `updateId`. An update in no-nonce mode.
 * - neither: `cachedZero[0]`, the value of an empty leaf. No update, the index is empty.
 *
 * A `nonce` has any length: `hash(nonce)` is 32 bytes. An `updateId` is the 32-byte JSON
 * Document Hash of the signed update.
 * @throws {RangeError} if `updateId` is present and not 32 bytes.
 */
export function leafValue(nonce?: Uint8Array, updateId?: Uint8Array): Uint8Array {
  if (updateId !== undefined) validateHash(updateId);
  if (nonce !== undefined && updateId !== undefined) return blockHash(blockHash(nonce), updateId);
  if (nonce !== undefined) return blockHash(blockHash(nonce));
  if (updateId !== undefined) return updateId;
  return CACHED_ZERO[0]!;
}
