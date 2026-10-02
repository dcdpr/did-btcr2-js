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
 * `resolve/output.json` for every set whose vectors all PASS, so the committed output
 * is what the api returns (`didResolutionMetadata`, `didDocument`,
 * `didDocumentMetadata` with `versionId`, `confirmations`, `updated`,
 * `deactivated`). A `versionTime` form (`before:N`, `at:N`, `after:N`) in a
 * sub-vector recipe resolves against the block `mediantime` of the anchor of
 * entry N, and a `minConf` form (`depth:N`) against the confirmation count of
 * that anchor; `--record` writes the value into the sub-vector input.
 *
 * `--record` also writes `signals.json` next to `other.json` for every set
 * that has a Beacon Signal on the chain: one entry per signal with the update
 * it commits to (none for a cohort member with no update), the beacon, the
 * address, the txid, the block height, hash, time, and `mediantime`, the signal
 * bytes, and `recordedTip`: the chain tip during the resolves of the set. A
 * consumer checks its own signal discovery against the file, or fulfills the
 * signals of a sans-I/O resolver from it.
 *
 * The script reads the tip before and after the resolves of each set. If a
 * block arrives between the two reads, it runs the set again, up to 3 times,
 * and then fails the set. It writes the files of a set only after a run with
 * one tip, so every recorded `confirmations` is exact at `recordedTip`.
 *
 * A set with a proof time tamper (`created-after-block`,
 * `expires-before-mediantime`, `expires-before-created`) must break exactly
 * the rule of its tamper against the block of its signal. If it breaks another
 * rule, or no rule, the set fails: give it a new key, then generate, fund, and
 * anchor it again.
 *
 * The main resolve of a negative set must fail for the rule of the set: the
 * error code must match, and the `errorMessage` of the result must match the
 * pattern of the rule id in `expect.rule` (`FAILURE_RULES`, ADR 136). If the
 * resolve fails for another rule, the case fails, and `--record` does not
 * write the set.
 *
 * On regtest, `--record` stops with an error if the tip moves during the run.
 * The `minConf` form holds only at the recorded tip, and the Polar export must
 * carry that tip: turn off auto-mine before the record, and export after it.
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
  causeDiff, cohortsOutDir, findCohort, indexScenarioDirs, isMinConfForm, isVersionTimeForm, loadCohorts, loadRecipes,
  parseNetworkArg, readExpected, readJSON, readSignedUpdates, readState, realUpdates, resolveCaseDir, resolveMinConf,
  resolveVersionTime, takeOption, writeJSON,
  type CohortDef, type Expected, type Scenario, type ScenarioState, type TamperKind,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const record = rest.includes('--record');
const minConfOpt = takeOption(rest, 'min-conf').value;
const minConf = minConfOpt === undefined ? DEFAULT_MIN_CONF : Number(minConfOpt);
if (!Number.isInteger(minConf) || minConf < 1) throw new Error(`--min-conf must be a positive integer, got "${minConfOpt}"`);
const gateways = casGatewaysFor(network);

/** The result of a resolve. A failed resolve has the error code and the `errorMessage` of the api. */
type Outcome = { kind: 'ok'; didDocument: object; versionId: string; deactivated: boolean } | { kind: 'error'; error: string; message?: string };
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
  /**
   * The update directory (`update/NN/`) whose signed update the signal commits
   * to. A cohort member with no update has none: the signal commits to no update
   * of the DID.
   */
  update?: number;
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
  /** The chain tip height during the resolves of the set. */
  recordedTip?: number;
};

/** A recorded signal with the recipe entry that anchored it (the N of a form) and its confirmation count at the read. */
type AnchorSignal = { entry: number; confirmations: number; record: SignalRecord };

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
    const cohortPath = join(cohortsOutDir(network), `${cohort.id}.json`);
    const { anchorAddress, signalHex } = readJSON<{ anchorAddress: string; signalHex: string }>(cohortPath);
    lookups.push({
      entry    : 1,
      ...(realUpdates(recipe).length > 0 ? { update: 1 } : {}),
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
    return { entry, confirmations: hit.blockMetadata.confirmations, record };
  });
}

/** The tampers of the proof time window (resolve.md:249-253). Each one breaks one rule of the window. */
const TIME_TAMPERS: ReadonlyArray<TamperKind> = ['created-after-block', 'expires-before-mediantime', 'expires-before-created'];

/**
 * The time rules that a proof breaks against a block, with the comparisons of
 * the resolver: `created` after the header time, `expires` before the
 * `mediantime`, and `expires` before `created`.
 */
function brokenTimeRules(proof: { created?: string; expires?: string }, block: { time: number; mediantime: number }): TamperKind[] {
  const created = proof.created === undefined ? undefined : Date.parse(proof.created);
  const expires = proof.expires === undefined ? undefined : Date.parse(proof.expires);
  const broken: TamperKind[] = [];
  if (created !== undefined && created > block.time * 1000) broken.push('created-after-block');
  if (expires !== undefined && expires < block.mediantime * 1000) broken.push('expires-before-mediantime');
  if (created !== undefined && expires !== undefined && expires < created) broken.push('expires-before-created');
  return broken;
}

/**
 * Check that each update with a proof time tamper breaks exactly the rule of
 * its tamper, against the block of its signal. If a resolver stops at another
 * rule first, the set does not test its own rule.
 * @throws {Error} if an update breaks another rule, or no rule.
 */
function checkTimeTampers(dir: string, recipe: Scenario, anchorSignals: AnchorSignal[]): void {
  const entries = realUpdates(recipe);
  const signed = readSignedUpdates(dir, entries.length);
  entries.forEach((u, i) => {
    if (!u.tamper || !TIME_TAMPERS.includes(u.tamper)) return;
    const signal = anchorSignals.find((s) => s.record.update === i + 1 && !s.record.duplicate);
    if (!signal) throw new Error(`no confirmed signal of update ${i + 1} on the chain`);
    const block = { time: signal.record.blockTime, mediantime: signal.record.mediantime };
    const broken = brokenTimeRules(signed[i]!.proof, block);
    if (broken.length !== 1 || broken[0] !== u.tamper) {
      throw new Error(
        `update ${i + 1} breaks [${broken.join(', ')}] at block ${signal.record.blockHeight}, not only ${u.tamper}. `
        + 'Give the set a new key (recipe keys {"source":"generate"}, then scenario:keys), then generate, fund, and anchor it again',
      );
    }
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
  return { outcome: { kind: 'error', error: r.error, message: r.errorMessage }, raw: r.raw };
}

/** How many times a set runs again when a block arrives during its resolves. */
const TIP_RERUNS = 3;

/** A resolve case of a set: the main resolve or a sub-vector. `rule` is set on the main resolve of a negative set. */
type ResolveCaseRun = { label: string; inputPath: string; outputPath: string; options: Record<string, unknown>; rule?: string };
/** The result of one resolve case. `diff` is set when the result does not match the expected output. */
type CaseResult = ResolveCaseRun & { outcome: Outcome; raw: unknown; diff?: string };
/** One run of a set: the tip before and after the resolves, the chain signals, and the result of each case. */
type SetRun = { tipBefore: number; tipAfter: number; anchorSignals: AnchorSignal[]; results: CaseResult[] };

/**
 * Resolve every case of a set one time. The tip is read before and after the
 * resolves, so the caller can see if a block arrived during the run.
 * @throws {Error} if a signal is not on the chain, or a proof time tamper breaks another rule.
 */
async function runSet(api: DidBtcr2Api, tip: () => Promise<number>, dir: string, recipe: Scenario, cohort: CohortDef | undefined, state: ScenarioState): Promise<SetRun> {
  const tipBefore = await tip();
  const mainPath = join(dir, 'resolve', 'input.json');
  const input = readJSON<ResolveInput>(mainPath);
  const cases: ResolveCaseRun[] = [
    {
      label      : recipe.id,
      inputPath  : mainPath,
      outputPath : join(dir, 'resolve', 'output.json'),
      options    : input.resolutionOptions,
      ...(recipe.expect ? { rule: recipe.expect.rule } : {}),
    },
  ];
  // The chain signals: for the versionTime and minConf forms, the time tampers, and signals.json on --record.
  const forms = (recipe.resolves ?? []).some((c) => isVersionTimeForm(c.options.versionTime) || isMinConfForm(c.options.minConf));
  const timeTamper = realUpdates(recipe).some((u) => u.tamper !== undefined && TIME_TAMPERS.includes(u.tamper));
  const anchorSignals = forms || record || timeTamper ? await readAnchorSignals(api, dir, recipe, cohort, state) : [];
  if (timeTamper) checkTimeTampers(dir, recipe, anchorSignals);
  const anchorOf = (n: number): AnchorSignal => {
    const hit = anchorSignals.find((s) => s.entry === n);
    if (!hit) throw new Error(`no confirmed anchor of entry ${n} on the chain`);
    return hit;
  };
  for (const c of recipe.resolves ?? []) {
    const caseDir = resolveCaseDir(dir, c.id);
    const options: Record<string, unknown> = { ...input.resolutionOptions, ...c.options };
    if (typeof c.options.versionTime === 'string') {
      options.versionTime = resolveVersionTime(c.options.versionTime, (n) => anchorOf(n).record.mediantime);
    }
    if (c.options.minConf !== undefined) {
      options.minConf = resolveMinConf(c.options.minConf, (n) => anchorOf(n).confirmations);
    }
    cases.push({ label: `${recipe.id} resolve/${c.id}`, inputPath: join(caseDir, 'input.json'), outputPath: join(caseDir, 'output.json'), options });
  }
  const results: CaseResult[] = [];
  for (const c of cases) {
    const { outcome, raw } = await resolveLive(api, input.did, c.options);
    // The error code first, then the cause of the error against the rule of the set.
    const diff = compare(outcome, readExpected(c.outputPath))
      ?? (c.rule !== undefined && outcome.kind === 'error' ? causeDiff(c.rule, outcome.message) : undefined);
    results.push({ ...c, outcome, raw, diff });
  }
  return { tipBefore, tipAfter: await tip(), anchorSignals, results };
}

async function run(): Promise<void> {
  const api = createApi({ btc: bitcoinConfigFor(network), cas: { executor: new GatewayChainCasExecutor(gateways), timeoutMs: CAS_GATEWAY_TIMEOUT_MS * gateways.length } });
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const cohorts = loadCohorts(network);
  const tip = (): Promise<number> => api.btc.connection.rest.block.count();
  const startTip = await tip();
  console.log(`=== scenario:verify:live (${network}, minConf ${minConf}, CAS ${gateways.join(', ')}, tip ${startTip})${record ? ' RECORD' : ''} ===`);

  let pass = 0, fail = 0;
  for (const id of [...recipes.keys()].sort()) {
    const dir = idx.get(id);
    if (!dir) continue;
    const recipe = recipes.get(id)!;
    const cohort = findCohort(id, cohorts);
    try {
      const state = readState(network, id);
      if (!state) throw new Error(`no pipeline state for ${id}; run generate:scenario`);
      let setRun = await runSet(api, tip, dir, recipe, cohort, state);
      for (let rerun = 1; setRun.tipBefore !== setRun.tipAfter; rerun++) {
        if (rerun > TIP_RERUNS) throw new Error(`a block arrived during each of ${TIP_RERUNS + 1} runs of the set`);
        console.log(`  ...  ${id.padEnd(52)} the tip moved from ${setRun.tipBefore} to ${setRun.tipAfter}; run the set again`);
        setRun = await runSet(api, tip, dir, recipe, cohort, state);
      }
      for (const r of setRun.results) {
        const detail = r.diff ?? (r.outcome.kind === 'ok'
          ? `v${r.outcome.versionId}${r.outcome.deactivated ? ' deactivated' : ''}`
          : `error ${r.outcome.error}${r.rule ? ` (${r.rule})` : ''}`);
        console.log(`  ${r.diff ? 'FAIL' : 'PASS'} ${r.label.padEnd(52)} ${detail}`);
        if (r.diff) fail++; else pass++;
      }
      const failed = setRun.results.filter((r) => r.diff).length;
      if (record && failed > 0) console.log(`  SKIP ${id.padEnd(52)} not recorded: ${failed} case(s) failed`);
      // Write the set only after a run with one tip and no failed case.
      if (record && failed === 0) {
        for (const r of setRun.results) {
          writeJSON(r.outputPath, r.raw);
          const current = readJSON<ResolveInput>(r.inputPath);
          current.resolutionOptions = r.options;
          writeJSON(r.inputPath, current);
        }
        if (setRun.anchorSignals.length > 0) {
          writeJSON(join(dir, 'signals.json'), setRun.anchorSignals.map((s) => ({ ...s.record, recordedTip: setRun.tipBefore })));
        }
      }
    } catch (e) {
      console.log(`  FAIL ${id.padEnd(52)} ${(e as Error).message}`);
      fail++;
    }
  }
  // A regtest record must hold one tip: the minConf form and the Polar export depend on it.
  const endTip = await tip();
  api.dispose();
  if (record && network === 'regtest' && endTip !== startTip) {
    console.log(`\n  FAIL the tip moved from ${startTip} to ${endTip} during the record. Turn off auto-mine in Polar, then run the record again.`);
    fail++;
  }
  console.log(`\n=== live verify PASS=${pass} FAIL=${fail}${record ? ` (outputs recorded, tip ${endTip})` : ''} ===`);
  if (record && fail === 0) console.log(`  Next: pnpm scenario:readme --network ${network}`);
  process.exit(fail ? 1 : 0);
}

await run();
