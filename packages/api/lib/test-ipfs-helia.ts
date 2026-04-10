/**
 * One-off test: fetch raw bytes from an IPFS Helia node using the
 * IpfsCasExecutor. Times the round-trip to measure latency.
 *
 * Usage: bun lib/test-ipfs-helia.ts
 */
import { decode as decodeHash } from '@did-btcr2/common';
import { createHelia } from 'helia';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';
// Hash from a real did:btcr2 resolution failure — the signed update the
// resolver needed but couldn't fetch without CAS.
const hexHash = 'be822c3da87dfa89ccac1dd552c6f93281e74f3cda257734393b5041d0c0388a';

// Convert hex hash to base64url (executor expects base64url)
const hashBytes = decodeHash(hexHash, 'hex');
const base64url = Buffer.from(hashBytes).toString('base64url');

// Show the CID that will be requested
const cid = CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
console.log(`Hex hash:   ${hexHash}`);
console.log(`Base64url:  ${base64url}`);
console.log(`CID:        ${cid.toString()}`);
console.log();

const TIMEOUT_MS = 30_000;

const start = performance.now();
console.log('Creating helia...');
const helia = await createHelia();
const heliaElapsed = performance.now() - start;
console.log(`Helia ready in ${heliaElapsed.toFixed(0)}ms`);

console.log(`Fetching (${TIMEOUT_MS / 1000}s timeout)...`);
// blockstore.get() has no built-in timeout — it walks the DHT indefinitely.
// Wrap with AbortSignal so it doesn't hang forever.
let result: Uint8Array | null;
try {
  const fetchStart = performance.now();
  const res = await helia.blockstore.get(cid, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  result = res;
  console.log(`Fetch completed in ${(performance.now() - fetchStart).toFixed(0)}ms`);
} catch (err: any) {
  if (err.name === 'AbortError' || err.name === 'TimeoutError') {
    console.log(`Timed out after ${TIMEOUT_MS}ms — block not found on DHT`);
  } else {
    console.log(`Error: ${err.message}`);
  }
  result = null;
}
const elapsed = performance.now() - start;

if (result) {
  console.log(`Success:    ${result.byteLength} bytes in ${elapsed.toFixed(0)}ms`);
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

// Stop Helia so the process exits (libp2p keeps connections open)
await helia.stop();
