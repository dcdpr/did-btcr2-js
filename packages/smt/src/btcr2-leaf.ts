import { blockHash, hashToBigInt } from './hash.js';

const encoder = new TextEncoder();

/**
 * Compute the SMT leaf index for a DID string.
 * Per spec: `index = bigint(SHA-256(did))`.
 */
export function didToIndex(did: string): bigint {
  return hashToBigInt(blockHash(encoder.encode(did)));
}

/**
 * Compute the inclusion leaf hash.
 * Per spec: `SHA-256(SHA-256(nonce) || SHA-256(signedUpdate))`.
 */
export function inclusionLeafHash(nonce: Uint8Array, signedUpdate: Uint8Array): Uint8Array {
  return blockHash(blockHash(nonce), blockHash(signedUpdate));
}

/**
 * Compute the non-inclusion leaf hash.
 * Per spec: `SHA-256(SHA-256(nonce))`.
 */
export function nonInclusionLeafHash(nonce: Uint8Array): Uint8Array {
  return blockHash(blockHash(nonce));
}
