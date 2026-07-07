/**
 * One-off test: publish raw bytes to an IPFS node over the HTTP RPC API using
 * the IpfsRpcCasExecutor, then read them back. Times both round-trips.
 *
 * Requires a running IPFS node exposing the RPC API on the given endpoint
 * (e.g. `ipfs daemon`, default port 5001).
 *
 * Usage: bun lib/test-ipfs-rpc.ts [rpc-url]
 */
import { canonicalize, canonicalHash } from '@did-btcr2/common';
import { IpfsRpcCasExecutor } from '../src/cas.js';

const rpcUrl = process.argv[2] ?? 'http://127.0.0.1:5001';

// A small JCS-canonicalized JSON payload, hashed the same way the CAS
// beacons hash announcements.
const object = { hello: 'did:btcr2', purpose: 'IpfsRpcCasExecutor round-trip test' };
const payload = new TextEncoder().encode(canonicalize(object));

console.log(`RPC URL:    ${rpcUrl}`);
console.log(`Payload:    ${payload.byteLength} bytes`);
console.log(`Expect:     ${canonicalHash(object)}`);
console.log();

const executor = new IpfsRpcCasExecutor(rpcUrl);

console.log('Publishing (block/put)...');
let start = performance.now();
const hash = await executor.publish(payload);
console.log(`Published:  ${hash} in ${(performance.now() - start).toFixed(0)}ms`);

console.log('Retrieving (block/get)...');
start = performance.now();
const result = await executor.retrieve(hash);
const elapsed = performance.now() - start;

if (!result) {
  console.log(`Not found (null) after ${elapsed.toFixed(0)}ms`);
  process.exit(1);
}

const match = result.length === payload.length
  && result.every((byte, i) => byte === payload[i]);
console.log(`Retrieved:  ${result.byteLength} bytes in ${elapsed.toFixed(0)}ms`);
console.log(match ? 'Round-trip OK: bytes match.' : 'MISMATCH: retrieved bytes differ!');
process.exit(match ? 0 : 1);
