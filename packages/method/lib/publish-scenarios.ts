/**
 * CAS publisher (Batch C, step 3).
 *
 * Reads the publish manifest produced by `route-delivery` and pushes each unique
 * object to a Content-Addressed Store (IPFS). Every object is stored as a raw
 * block (codec 0x55) under a CIDv1 derived from the SHA-256 of its JCS-canonical
 * bytes, the same derivation the resolver's CAS executor uses (see the
 * `@did-btcr2/api` CAS executors and ADR 023). So the CID a resolver computes
 * from a `Need*` hash is exactly the CID we pin here.
 *
 * Two modes:
 *   - dry-run (default): canonicalize each object, derive its CID, and assert the
 *     SHA-256 matches the manifest's content hash. No network. Writes a CID
 *     manifest (`lib/scenarios/cid-manifest.json`) listing the CID for every
 *     object, the exact set a resolver will fetch. Proves publish-readiness.
 *   - live (`--publish`): additionally `block/put` + `pin/add` each block to a
 *     Kubo-compatible IPFS RPC endpoint (env `IPFS_RPC_URL`, e.g.
 *     `http://127.0.0.1:5001`). Other pinning backends (Pinata, web3.storage)
 *     are not wired: point IPFS_RPC_URL at a Kubo-compatible API, or extend the
 *     `publishBlock` adapter.
 *
 * The content bytes are the canonical JSON of the object, byte-identical to what
 * the resolver JSON-parses after retrieval, so the round-trip is exact.
 *
 * Run order: build-artifacts -> route-delivery -> publish.
 *
 * Usage:
 *   bun lib/publish-scenarios.ts              # dry-run: derive + verify CIDs
 *   bun lib/publish-scenarios.ts --publish    # also pin to IPFS_RPC_URL
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize, decode as decodeHash, encode as encodeHash } from '@did-btcr2/common';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(HERE, 'scenarios');
const MANIFEST_FILE = join(SCENARIOS_DIR, 'publish-manifest.json');
const CID_MANIFEST_FILE = join(SCENARIOS_DIR, 'cid-manifest.json');

type ManifestItem = {
  hashB64: string;
  hashHex: string;
  kind: string;
  usedBy: Array<{ scenarioId: string; did: string }>;
  object: unknown;
};

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** CIDv1 (raw codec) for a content hash, identical to the resolver's CAS lookup. */
function cidForHashB64(hashB64: string): CID {
  const hashBytes = decodeHash(hashB64, 'base64urlnopad');
  return CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
}

/** Pin one raw block to a Kubo-compatible IPFS RPC endpoint. Returns the server CID. */
async function publishBlock(rpcUrl: string, bytes: Uint8Array, expectedCid: CID): Promise<string> {
  const form = new FormData();
  form.append('data', new Blob([bytes]));
  const putRes = await fetch(`${rpcUrl}/api/v0/block/put?cid-codec=raw&mhtype=sha2-256&pin=true`, {
    method : 'POST',
    body   : form,
  });
  if (!putRes.ok) throw new Error(`block/put failed: ${putRes.status} ${await putRes.text()}`);
  const { Key } = await putRes.json() as { Key: string };
  if (Key !== expectedCid.toString()) {
    throw new Error(`CID mismatch: node returned ${Key}, expected ${expectedCid.toString()}`);
  }
  return Key;
}

async function run(): Promise<void> {
  if (!existsSync(MANIFEST_FILE)) {
    console.error(`No publish manifest at ${MANIFEST_FILE}. Run \`bun lib/route-delivery.ts\` first.`);
    process.exit(1);
  }
  const live = process.argv.includes('--publish');
  const rpcUrl = process.env.IPFS_RPC_URL?.replace(/\/+$/, '');
  if (live && !rpcUrl) {
    console.error('--publish requires a Kubo-compatible endpoint in IPFS_RPC_URL (e.g. http://127.0.0.1:5001).');
    process.exit(1);
  }

  const { items } = readJSON<{ items: ManifestItem[] }>(MANIFEST_FILE);
  console.log(`=== ${live ? 'publishing' : 'dry-run'} ${items.length} CAS objects${live ? ` to ${rpcUrl}` : ''} ===`);

  const cidEntries: Array<{ cid: string; kind: string; hashB64: string; hashHex: string; usedBy: ManifestItem['usedBy'] }> = [];
  let ok = 0, bad = 0;

  for (const item of items) {
    // Re-derive the content hash from the object and confirm it matches the
    // manifest (the bytes we pin must hash to what the resolver will ask for).
    const bytes = new TextEncoder().encode(canonicalize(item.object as Record<string, unknown>));
    const digest = await sha256.digest(bytes);
    const derivedB64 = encodeHash(digest.digest, 'base64urlnopad');
    const cid = CID.createV1(raw.code, digest);

    if (derivedB64 !== item.hashB64 || !cid.equals(cidForHashB64(item.hashB64))) {
      console.log(`  BAD  ${item.kind.padEnd(15)} manifest hash ${item.hashB64.slice(0, 12)} != derived ${derivedB64.slice(0, 12)}`);
      bad++;
      continue;
    }

    if (live) {
      try {
        await publishBlock(rpcUrl!, bytes, cid);
      } catch (e) {
        console.log(`  ERR  ${item.kind.padEnd(15)} ${cid.toString()}  ${(e as Error).message}`);
        bad++;
        continue;
      }
    }

    const who = item.usedBy.map((u) => u.scenarioId).join(', ');
    console.log(`  ${live ? 'PIN ' : 'OK  '} ${item.kind.padEnd(15)} ${cid.toString()}  [${who}]`);
    cidEntries.push({ cid: cid.toString(), kind: item.kind, hashB64: item.hashB64, hashHex: item.hashHex, usedBy: item.usedBy });
    ok++;
  }

  writeFileSync(CID_MANIFEST_FILE, JSON.stringify({
    note      : 'CIDv1 (raw codec, sha2-256) for every CAS object a resolver will fetch. Derived from the content hash exactly as the resolver derives it; pin these CIDs to make the CAS-delivered scenarios resolvable.',
    network   : 'mutinynet',
    published : live,
    items     : cidEntries,
  }, null, 4) + '\n');

  console.log(`\n=== ${live ? 'published' : 'verified'} ${ok}/${items.length} (${bad} failed) ===`);
  console.log(`  wrote ${CID_MANIFEST_FILE}`);
  if (!live) console.log('  dry-run only - re-run with --publish and IPFS_RPC_URL set to pin to IPFS.');
  process.exit(bad ? 1 : 0);
}

await run();
