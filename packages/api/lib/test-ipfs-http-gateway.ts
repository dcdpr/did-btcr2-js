/**
 * One-off test: fetch raw bytes from an IPFS HTTP gateway using the
 * HttpGatewayCasExecutor. Times the round-trip to measure gateway latency.
 *
 * Usage: bun lib/test-ipfs-http-gateway.ts [gateway-url]
 */
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';
import { decode as decodeHash } from '@did-btcr2/common';
import { HttpGatewayCasExecutor } from '../src/cas.js';

const gateway = process.argv[2] ?? 'https://ipfs.io';

// Hash from a real did:btcr2 resolution failure — the signed update the
// resolver needed but couldn't fetch without CAS.
const hexHash = 'be822c3da87dfa89ccac1dd552c6f93281e74f3cda257734393b5041d0c0388a';

// Convert hex hash to base64url (executor expects base64url)
const hashBytes = decodeHash(hexHash, 'hex');
const base64url = Buffer.from(hashBytes).toString('base64url');

// Show the CID that will be requested
const cid = CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
console.log(`Gateway:    ${gateway}`);
console.log(`Hex hash:   ${hexHash}`);
console.log(`Base64url:  ${base64url}`);
console.log(`CID:        ${cid.toString()}`);
console.log(`URL:        ${gateway}/ipfs/${cid.toString()}?format=raw`);
console.log();

// Fetch via the executor
const executor = new HttpGatewayCasExecutor(gateway);

console.log('Fetching...');
const start = performance.now();
const result = await executor.retrieve(base64url);
const elapsed = performance.now() - start;

if (result) {
  console.log(`Success:    ${result.byteLength} bytes in ${elapsed.toFixed(0)}ms`);
  // Try to parse as JSON (CAS stores JCS-canonicalized JSON)
  try {
    const text = new TextDecoder().decode(result);
    const parsed = JSON.parse(text);
    console.log(`Parsed JSON:`);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(`Raw bytes (not JSON):`, result.slice(0, 64), '...');
  }
} else {
  console.log(`Not found (null) after ${elapsed.toFixed(0)}ms => ${(elapsed / 1000).toFixed(3)}s`);
}
