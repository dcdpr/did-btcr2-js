/**
 * Live scenario verifier (Batch C, step 6).
 *
 * The end-to-end counterpart of `verify-scenarios.ts`: drives the real
 * {@link Resolver} but fulfils its needs from LIVE services instead of synthetic
 * data:
 *   - NeedBeaconSignals    : BeaconSignalDiscovery.indexer() reads the actual
 *                            OP_RETURN signals anchored at each beacon address
 *                            (mutinynet, via Esplora).
 *   - NeedGenesisDocument  } fetched from the CAS (IPFS) by deriving the CIDv1
 *   - NeedCASAnnouncement   } (raw, sha2-256) from the content hash the resolver
 *   - NeedSignedUpdate      } asks for - the same CIDs `scenario:publish` pinned.
 * Sidecar-delivered data (SMT proofs, and 10/12 genesis/update) rides in the
 * vector's resolutionOptions, so those needs never fire.
 *
 * Prerequisite pipeline: generate -> artifacts -> route -> publish (--publish) ->
 * fund -> anchor, with anchors confirmed and CAS objects pinned + reachable.
 *
 * Env:
 *   CAS_GATEWAY   IPFS gateway base (default http://127.0.0.1:8080 - local Kubo)
 *
 * Usage: bun lib/verify-live.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalize } from '@did-btcr2/common';
import { hex } from '@scure/base';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';

import { BeaconSignalDiscovery } from '../src/core/beacon/signal-discovery.js';
import { DidBtcr2 } from '../src/did-btcr2.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const NETWORK = 'mutinynet';
const GATEWAY = (process.env.CAS_GATEWAY ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** Fetch a JSON object from the CAS by the hex content hash the resolver asked for. */
async function casFetch(hashHex: string): Promise<object | null> {
  const cid = CID.create(1, raw.code, createDigest(sha256.code, hex.decode(hashHex)));
  try {
    const res = await fetch(`${GATEWAY}/ipfs/${cid.toString()}?format=raw`, {
      headers : { Accept: 'application/vnd.ipld.raw' },
    });
    if (!res.ok) return null;
    return JSON.parse(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))) as object;
  } catch {
    return null;
  }
}

async function verifyScenario(dir: string, btc: BitcoinConnection): Promise<{ ok: boolean; detail: string }> {
  const did = readJSON<{ did: string }>(join(dir, 'create', 'output.json')).did;
  const input = readJSON<{ resolutionOptions: object }>(join(dir, 'resolve', 'input.json'));
  const expected = readJSON<{ didDocument: object }>(join(dir, 'resolve', 'output.json')).didDocument;

  const resolver = DidBtcr2.resolve(did, input.resolutionOptions);
  let state = resolver.resolve();
  let guard = 0;
  while (state.status === 'action-required') {
    if (++guard > 40) return { ok: false, detail: 'did not converge (loop guard)' };
    for (const need of state.needs) {
      switch (need.kind) {
        case 'NeedBeaconSignals':
          resolver.provide(need, await BeaconSignalDiscovery.indexer([...need.beaconServices], btc));
          break;
        case 'NeedGenesisDocument': {
          const obj = await casFetch(need.genesisHash);
          if (!obj) return { ok: false, detail: `genesis not on CAS (${need.genesisHash.slice(0, 12)})` };
          resolver.provide(need, obj);
          break;
        }
        case 'NeedCASAnnouncement': {
          const obj = await casFetch(need.announcementHash);
          if (!obj) return { ok: false, detail: `announcement not on CAS (${need.announcementHash.slice(0, 12)})` };
          resolver.provide(need, obj as Record<string, string>);
          break;
        }
        case 'NeedSignedUpdate': {
          const obj = await casFetch(need.updateHash);
          if (!obj) return { ok: false, detail: `signed update not on CAS (${need.updateHash.slice(0, 12)})` };
          resolver.provide(need, obj as never);
          break;
        }
        case 'NeedSMTProof':
          return { ok: false, detail: 'unexpected NeedSMTProof (proofs ride in sidecar)' };
      }
    }
    state = resolver.resolve();
  }

  const got = canonicalize(state.result.didDocument);
  const want = canonicalize(expected);
  if (got !== want) return { ok: false, detail: `resolved != expected (versionId=${state.result.metadata.versionId})` };
  return { ok: true, detail: `versionId=${state.result.metadata.versionId} deactivated=${state.result.metadata.deactivated ?? false}` };
}

async function run(): Promise<void> {
  const btc = BitcoinConnection.forNetwork(NETWORK);
  console.log(`=== scenario:verify:live (${NETWORK}, CAS ${GATEWAY}) ===`);

  let pass = 0, fail = 0;
  for (const type of ['k1', 'x1']) {
    const typeDir = join(DATA_DIR, NETWORK, type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir)) {
      const dir = join(typeDir, h);
      if (!existsSync(join(dir, 'create', 'output.json'))) continue;
      const id = readJSON<{ id: string }>(join(dir, 'scenario.json')).id;
      try {
        const r = await verifyScenario(dir, btc);
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${id.padEnd(42)} ${r.detail}`);
        r.ok ? pass++ : fail++;
      } catch (e) {
        console.log(`  FAIL ${id.padEnd(42)} ${(e as Error).message}`);
        fail++;
      }
    }
  }
  console.log(`\n=== live verify PASS=${pass} FAIL=${fail} ===`);
  process.exit(fail ? 1 : 0);
}

await run();
