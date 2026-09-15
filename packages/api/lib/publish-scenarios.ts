/**
 * CAS publisher (pipeline step 4).
 *
 * Reads the publish manifest of `scenario:route` and pushes each unique object
 * to a Content-Addressed Store (IPFS). Every object is stored as a raw block
 * (codec 0x55) under a CIDv1 derived from the SHA-256 of its JCS-canonical
 * bytes, the derivation the resolver's CAS executor uses (see the
 * `@did-btcr2/api` CAS executors and ADR 023). The CID a resolver computes from
 * a `Need*` hash is the CID pinned here.
 *
 * Two modes:
 *   - dry-run (default): canonicalize each object, derive its CID, and check
 *     that the SHA-256 matches the manifest hash. No network. Writes the CID
 *     manifest (`lib/scenarios/<network>/cid-manifest.json`).
 *   - live (`--publish`): also `block/put` + `pin/add` each block to a
 *     Kubo-compatible IPFS RPC endpoint. On regtest the endpoint is the Kubo
 *     node of the Polar stack (ADR 117). The other networks take the endpoint
 *     from `IPFS_RPC_URL`. This repository records no public endpoint.
 *
 * The content bytes are the canonical JSON of the object, byte for byte what
 * the resolver parses after retrieval.
 *
 * Usage:
 *   pnpm scenario:publish --network regtest              # dry-run
 *   pnpm scenario:publish --network regtest --publish    # pins to the Kubo node of the Polar stack
 *   IPFS_RPC_URL=http://host:5001 pnpm scenario:publish --network mutinynet --publish
 */

import { existsSync } from 'node:fs';

import { canonicalize, decode as decodeHash, encode as encodeHash } from '@did-btcr2/common';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

import { REGTEST_IPFS } from './_e2e-helpers.js';
import { cidManifestFile, parseNetworkArg, publishManifestFile, readJSON, writeJSON } from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const live = rest.includes('--publish');

type ManifestItem = {
  hashB64: string;
  hashHex: string;
  kind: string;
  usedBy: Array<{ scenarioId: string; did: string }>;
  object: unknown;
};

/** CIDv1 (raw codec) for a content hash, identical to the resolver's CAS lookup. */
function cidForHashB64(hashB64: string): CID {
  return CID.create(1, raw.code, createDigest(sha256.code, decodeHash(hashB64, 'base64urlnopad')));
}

/** Pin one raw block to a Kubo-compatible IPFS RPC endpoint. Returns the server CID. */
async function publishBlock(rpcUrl: string, bytes: Uint8Array, expectedCid: CID): Promise<string> {
  const form = new FormData();
  form.append('data', new Blob([Uint8Array.from(bytes)]));
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
  const manifestPath = publishManifestFile(network);
  if (!existsSync(manifestPath)) {
    console.error(`No publish manifest at ${manifestPath}. Run scenario:route first.`);
    process.exit(1);
  }
  const rpcUrl = (process.env.IPFS_RPC_URL ?? (network === 'regtest' ? REGTEST_IPFS.rpc : undefined))?.replace(/\/+$/, '');
  if (live && !rpcUrl) {
    console.error('--publish requires a Kubo-compatible endpoint in IPFS_RPC_URL (e.g. http://host:5001).');
    process.exit(1);
  }

  const { items } = readJSON<{ items: ManifestItem[] }>(manifestPath);
  console.log(`=== ${live ? 'publishing' : 'dry-run'} ${items.length} CAS objects (${network})${live ? ` to ${rpcUrl}` : ''} ===`);

  const cidEntries: Array<{ cid: string; kind: string; hashB64: string; hashHex: string; usedBy: ManifestItem['usedBy'] }> = [];
  let ok = 0, bad = 0;

  for (const item of items) {
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

  const cidPath = cidManifestFile(network);
  writeJSON(cidPath, {
    note      : 'CIDv1 (raw codec, sha2-256) for every CAS object a resolver will fetch. Derived from the content hash exactly as the resolver derives it; pin these CIDs to make the CAS-delivered scenarios resolvable.',
    network,
    published : live,
    items     : cidEntries,
  });

  console.log(`\n=== ${live ? 'published' : 'verified'} ${ok}/${items.length} (${bad} failed) ===`);
  console.log(`  wrote ${cidPath}`);
  if (!live) {
    console.log(network === 'regtest'
      ? '  dry-run only: run again with --publish to pin to the Kubo node of the Polar stack.'
      : '  dry-run only: run again with --publish and IPFS_RPC_URL set to pin to IPFS.');
  }
  process.exit(bad ? 1 : 0);
}

await run();
