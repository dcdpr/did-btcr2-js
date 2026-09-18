/**
 * Live scenario verifier and recorder (pipeline step 7).
 *
 * Resolves every generated vector of a network through the api facade against
 * the live chain and the live CAS, the way a user of `@did-btcr2/api` does:
 * the beacon signals come from the Esplora indexer of the network, the
 * CAS-delivered objects from an IPFS gateway, the sidecar data from the vector
 * `resolve/input.json`. The result is compared with the expected
 * `resolve/output.json` (the main resolve and every `resolve/NN/` sub-vector).
 *
 * `--record` writes the raw DID Resolution result of the api into
 * `resolve/output.json` for every vector that PASSES, so the committed output
 * is what the api returns (`didResolutionMetadata`, `didDocument`,
 * `didDocumentMetadata` with `versionId`, `confirmations`, `updated`,
 * `deactivated`). A `versionTime` form (`before:N`, `at:N`, `after:N`) in a
 * sub-vector recipe resolves against the block `mediantime` of the anchor of
 * entry N; `--record` writes the timestamp into the sub-vector input.
 *
 * `--record` also writes `signals.json` next to `other.json` for every set
 * that has a Beacon Signal on the chain: one entry per signal with the update
 * it commits to, the beacon, the address, the txid, the block height, hash,
 * time, and `mediantime`, and the signal bytes. A consumer checks its own
 * signal discovery against it, or fulfills the signals of a sans-I/O resolver
 * from it.
 *
 * Prerequisites: generate -> artifacts -> route -> publish (--publish) -> fund ->
 * anchor, with the anchors at `minConf` confirmations and the CAS objects pinned.
 * `--min-conf N` is the `minConf` of every resolve that sets none. A resolve
 * case with its own `minConf` keeps it.
 *
 * Env:
 *   CAS_GATEWAY   IPFS gateways of the CAS reads, comma-separated, in order
 *                 (default: the Kubo gateway of the Polar stack on regtest,
 *                 ADR 117; on the other networks the nodes that hold the pins,
 *                 then the public gateways as fallbacks). The verify asks the
 *                 gateways in order and takes the first block found. Each
 *                 gateway gets 20 seconds per object.
 *
 * Usage:
 *   pnpm scenario:verify:live --network regtest
 *   pnpm scenario:verify:live --network regtest --record
 *   pnpm scenario:verify:live --network mutinynet --min-conf 1
 */

import { join } from 'node:path';

import { createApi, type DidBtcr2Api } from '@did-btcr2/api';
import { canonicalHash, canonicalize } from '@did-btcr2/common';
import { BeaconSignalDiscovery, DEFAULT_MIN_CONF, type BeaconService, type BeaconSignal } from '@did-btcr2/method';

import { bitcoinConfigFor, CAS_GATEWAY_TIMEOUT_MS, casGatewaysFor, GatewayChainCasExecutor } from './_e2e-helpers.js';
import {
  cohortsOutDir, findCohort, indexScenarioDirs, isVersionTimeForm, loadCohorts, loadRecipes, parseNetworkArg,
  readExpected, readJSON, readSignedUpdates, readState, realUpdates, resolveCaseDir, resolveVersionTime, takeOption,
  writeJSON,
  type CohortDef, type Expected, type Scenario, type ScenarioState,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const record = rest.includes('--record');
const minConfOpt = takeOption(rest, 'min-conf').value;
const minConf = minConfOpt === undefined ? DEFAULT_MIN_CONF : Number(minConfOpt);
if (!Number.isInteger(minConf) || minConf < 1) throw new Error(`--min-conf must be a positive integer, got "${minConfOpt}"`);
const gateways = casGatewaysFor(network);

type Outcome = { kind: 'ok'; didDocument: object; versionId: string; deactivated: boolean } | { kind: 'error'; error: string };
type ResolveInput = { did: string; resolutionOptions: Record<string, unknown> };

function compare(got: Outcome, want: Expected): string | undefined {
  if (want.kind === 'error') {
    if (got.kind === 'error' && got.error === want.error) return undefined;
    return got.kind === 'error' ? `error ${got.error}, expected ${want.error}` : `resolved v${got.versionId}, expected error ${want.error}`;
  }
  if (got.kind === 'error') return `error ${got.error}, expected v${want.versionId}`;
  if (got.versionId !== want.versionId) return `versionId ${got.versionId}, expected ${want.versionId}`;
  if (got.deactivated !== want.deactivated) return `deactivated ${got.deactivated}, expected ${want.deactivated}`;
  if (canonicalize(got.didDocument) !== canonicalize(want.didDocument)) return `document differs (v${got.versionId})`;
  return undefined;
}

/** One recorded Beacon Signal of a vector set: an entry of `signals.json`. */
type SignalRecord = {
  /** The update directory (`update/NN/`) whose signed update the signal commits to. */
  update: number;
  /** The signal repeats an earlier signal of the same update, in a later block. */
  duplicate?: true;
  beaconId: string;
  address: string;
  txid: string;
  blockHeight: number;
  blockHash: string;
  blockTime: number;
  mediantime: number;
  signalBytes: string;
  /** Set for a cohort member: the signal is the shared signal of the cohort. */
  cohort?: { id: string; members: string[] };
};

/** A recorded signal with the recipe entry that anchored it (the N of a `versionTime` form). */
type AnchorSignal = { entry: number; record: SignalRecord };

/**
 * The Beacon Signals of a vector set, read from the chain: the signal of every
 * anchor of a solo scenario (the OP_RETURN with the hash of the signed update at
 * the beacon address), or the shared signal at the cohort address of a cohort
 * member. A duplicate entry repeats the bytes of an earlier anchor: the k-th
 * anchor with the same address and bytes takes the k-th such signal by height.
 * @throws {Error} when a signal is not confirmed on the chain.
 */
async function readAnchorSignals(api: DidBtcr2Api, dir: string, recipe: Scenario, cohort: CohortDef | undefined, state: ScenarioState): Promise<AnchorSignal[]> {
  type Lookup = Omit<SignalRecord, 'txid' | 'blockHeight' | 'blockHash' | 'blockTime' | 'mediantime' | 'signalBytes'> & { entry: number; signalHex: string };
  const lookups: Lookup[] = [];
  if (cohort) {
    if (realUpdates(recipe).length === 0) return [];
    const cohortPath = join(cohortsOutDir(network), `${cohort.id}.json`);
    const { anchorAddress, signalHex } = readJSON<{ anchorAddress: string; signalHex: string }>(cohortPath);
    lookups.push({
      entry    : 1,
      update   : 1,
      beaconId : `${state.did}${cohort.serviceId}`,
      address  : anchorAddress,
      signalHex,
      cohort   : { id: cohort.id, members: cohort.members },
    });
  } else {
    const signed = readSignedUpdates(dir, realUpdates(recipe).length);
    for (const a of state.anchors) {
      lookups.push({
        entry     : a.update,
        update    : a.signalOf,
        ...(a.duplicateOf !== undefined ? { duplicate: true as const } : {}),
        beaconId  : a.beaconId,
        address   : a.address,
        signalHex : canonicalHash(signed[a.signalOf - 1] as Record<string, unknown>, { encoding: 'hex' }),
      });
    }
  }
  if (lookups.length === 0) return [];

  // One indexer pass for every distinct address of the set.
  const addresses = [...new Set(lookups.map((l) => l.address))];
  const services = addresses.map((address, i): BeaconService => ({ id: `#signal-${i}`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` }));
  const found = await BeaconSignalDiscovery.indexer(services, api.btc.connection);
  const byAddress = new Map<string, BeaconSignal[]>();
  for (const [service, signals] of found) byAddress.set(String(service.serviceEndpoint).slice('bitcoin:'.length), signals);

  return lookups.map((l, i) => {
    const matches = (byAddress.get(l.address) ?? [])
      .filter((s) => s.signalBytes === l.signalHex)
      .sort((a, b) => a.blockMetadata.height - b.blockMetadata.height);
    const k = lookups.slice(0, i).filter((x) => x.address === l.address && x.signalHex === l.signalHex).length;
    const hit = matches[k];
    if (!hit) throw new Error(`no confirmed signal of entry ${l.entry} at ${l.address} on the chain`);
    const tx = hit.tx as { txid?: string; status?: { block_hash?: string }; blockhash?: string };
    const { entry, signalHex: _signalHex, cohort: member, ...head } = l;
    void _signalHex;
    const record: SignalRecord = {
      ...head,
      txid        : tx.txid ?? '',
      blockHeight : hit.blockMetadata.height,
      blockHash   : tx.status?.block_hash ?? tx.blockhash ?? '',
      blockTime   : hit.blockMetadata.time,
      mediantime  : hit.blockMetadata.mediantime,
      signalBytes : hit.signalBytes,
      ...(member ? { cohort: member } : {}),
    };
    return { entry, record };
  });
}

async function resolveLive(api: DidBtcr2Api, did: string, options: Record<string, unknown>): Promise<{ outcome: Outcome; raw: unknown }> {
  const r = await api.tryResolveDid(did, { minConf, ...options });
  if (r.ok) {
    return {
      outcome : { kind: 'ok', didDocument: r.document, versionId: r.metadata?.versionId ?? '1', deactivated: r.metadata?.deactivated ?? false },
      raw     : r.raw,
    };
  }
  return { outcome: { kind: 'error', error: r.error }, raw: r.raw };
}

async function run(): Promise<void> {
  const api = createApi({ btc: bitcoinConfigFor(network), cas: { executor: new GatewayChainCasExecutor(gateways), timeoutMs: CAS_GATEWAY_TIMEOUT_MS * gateways.length } });
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const cohorts = loadCohorts(network);
  console.log(`=== scenario:verify:live (${network}, minConf ${minConf}, CAS ${gateways.join(', ')})${record ? ' RECORD' : ''} ===`);

  let pass = 0, fail = 0;
  for (const id of [...recipes.keys()].sort()) {
    const dir = idx.get(id);
    if (!dir) continue;
    const recipe = recipes.get(id)!;
    const cohort = findCohort(id, cohorts);
    try {
      const state = readState(network, id);
      if (!state) throw new Error(`no pipeline state for ${id}; run generate:scenario`);
      const mainPath = join(dir, 'resolve', 'input.json');
      const input = readJSON<ResolveInput>(mainPath);
      const cases: Array<{ label: string; inputPath: string; outputPath: string; options: Record<string, unknown>; inputOptions?: Record<string, unknown> }> = [
        { label: id, inputPath: mainPath, outputPath: join(dir, 'resolve', 'output.json'), options: input.resolutionOptions },
      ];
      // The chain signals: for the versionTime forms, and for signals.json on --record.
      const forms = (recipe.resolves ?? []).some((c) => isVersionTimeForm(c.options.versionTime));
      const anchorSignals = forms || record ? await readAnchorSignals(api, dir, recipe, cohort, state) : [];
      const mediantimeOf = (n: number): number => {
        const hit = anchorSignals.find((s) => s.entry === n);
        if (!hit) throw new Error(`no confirmed anchor of entry ${n} on the chain`);
        return hit.record.mediantime;
      };
      for (const c of recipe.resolves ?? []) {
        const caseDir = resolveCaseDir(dir, c.id);
        const options: Record<string, unknown> = { ...input.resolutionOptions, ...c.options };
        if (typeof c.options.versionTime === 'string') {
          options.versionTime = resolveVersionTime(c.options.versionTime, mediantimeOf);
        }
        cases.push({ label: `${id} resolve/${c.id}`, inputPath: join(caseDir, 'input.json'), outputPath: join(caseDir, 'output.json'), options });
      }
      if (record && anchorSignals.length > 0) writeJSON(join(dir, 'signals.json'), anchorSignals.map((s) => s.record));
      for (const c of cases) {
        const expected = readExpected(c.outputPath);
        const { outcome, raw } = await resolveLive(api, input.did, c.options);
        const diff = compare(outcome, expected);
        const detail = diff ?? (outcome.kind === 'ok' ? `v${outcome.versionId}${outcome.deactivated ? ' deactivated' : ''}` : `error ${outcome.error}`);
        console.log(`  ${diff ? 'FAIL' : 'PASS'} ${c.label.padEnd(52)} ${detail}`);
        if (diff) { fail++; continue; }
        pass++;
        if (record) {
          writeJSON(c.outputPath, raw);
          const current = readJSON<ResolveInput>(c.inputPath);
          current.resolutionOptions = c.options;
          writeJSON(c.inputPath, current);
        }
      }
    } catch (e) {
      console.log(`  FAIL ${id.padEnd(52)} ${(e as Error).message}`);
      fail++;
    }
  }
  api.dispose();
  console.log(`\n=== live verify PASS=${pass} FAIL=${fail}${record ? ' (outputs recorded)' : ''} ===`);
  if (record && fail === 0) console.log(`  Next: pnpm scenario:readme --network ${network}`);
  process.exit(fail ? 1 : 0);
}

await run();
