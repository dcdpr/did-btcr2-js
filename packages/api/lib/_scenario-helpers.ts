/**
 * Shared helpers for the test-vector pipeline scripts in this directory.
 *
 * Underscore-prefixed so that no runner treats this file as a top-level script.
 *
 * The pipeline reads one recipe directory per network (`lib/scenarios/<network>/`)
 * and writes one vector tree per network (`lib/data/<network>/{k1,x1}/<hash>/`).
 * The vector tree is the corpus that other implementations consume; it holds no
 * pipeline state. The state of a generated scenario (the DID, the anchors, the
 * beacon addresses) lives in `lib/scenarios/<network>/state/<scenario-id>.json`.
 * Every script takes `--network <name>` (default `mutinynet`). This module holds
 * the recipe types, the paths, the JSON I/O, and the lookups that more than one
 * script needs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PatchOperation } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import type { LocalSigner } from '@did-btcr2/keypair';
import type { Btcr2DataIntegrityConfig, DidVerificationMethod, SignedBTCR2Update, UnsignedBTCR2Update } from '@did-btcr2/method';
import { BTCR2_UPDATE_CONTEXT } from '@did-btcr2/method';

// ─── Networks ────────────────────────────────────────────────────────────────

/** The networks the pipeline generates vectors for. */
export type VectorNetwork = 'regtest' | 'mutinynet' | 'signet' | 'testnet4';
export const VECTOR_NETWORKS: ReadonlyArray<VectorNetwork> = ['regtest', 'mutinynet', 'signet', 'testnet4'];
export const DEFAULT_NETWORK: VectorNetwork = 'mutinynet';

/**
 * Read `--network <name>` (or `--network=<name>`) from `argv`. The default is
 * mutinynet. Returns the network and the remaining arguments.
 * @throws {Error} if the name is not a vector network.
 */
export function parseNetworkArg(argv: string[] = process.argv.slice(2)): { network: VectorNetwork; rest: string[] } {
  const rest: string[] = [];
  let network: string = DEFAULT_NETWORK;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--network') {
      network = argv[++i] ?? '';
    } else if (arg.startsWith('--network=')) {
      network = arg.slice('--network='.length);
    } else {
      rest.push(arg);
    }
  }
  if (!VECTOR_NETWORKS.includes(network as VectorNetwork)) {
    throw new Error(`Unknown network "${network}". Valid values: ${VECTOR_NETWORKS.join(', ')}.`);
  }
  return { network: network as VectorNetwork, rest };
}

/** Read `--<name> <value>` (or `--<name>=<value>`) from `args`. Returns the value and the remaining arguments. */
export function takeOption(args: string[], name: string): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === `--${name}`) {
      value = args[++i];
    } else if (arg.startsWith(`--${name}=`)) {
      value = arg.slice(name.length + 3);
    } else {
      rest.push(arg);
    }
  }
  return { value, rest };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export const LIB_DIR = dirname(fileURLToPath(import.meta.url));
/** The test-suite submodule. */
export const DATA_DIR = join(LIB_DIR, 'data');

/** The recipe directory of a network. */
export function scenariosDir(network: VectorNetwork): string {
  return join(LIB_DIR, 'scenarios', network);
}
export function cohortsFile(network: VectorNetwork): string {
  return join(scenariosDir(network), 'cohorts.json');
}
/** The built cohort artifacts (`<cohortId>.json`). */
export function cohortsOutDir(network: VectorNetwork): string {
  return join(scenariosDir(network), 'cohorts');
}
export function publishManifestFile(network: VectorNetwork): string {
  return join(scenariosDir(network), 'publish-manifest.json');
}
export function cidManifestFile(network: VectorNetwork): string {
  return join(scenariosDir(network), 'cid-manifest.json');
}
export function fundingSummaryFile(network: VectorNetwork): string {
  return join(scenariosDir(network), 'FUNDING.md');
}
/** The hand-written head of the network README in the test suite. */
export function readmeHeadFile(network: VectorNetwork): string {
  return join(scenariosDir(network), 'README.head.md');
}
/** The pipeline state of a network: one file per generated scenario. */
export function stateDir(network: VectorNetwork): string {
  return join(scenariosDir(network), 'state');
}
export function stateFile(network: VectorNetwork, scenarioId: string): string {
  return join(stateDir(network), `${scenarioId}.json`);
}
/** The vector tree of a network. */
export function networkDataDir(network: VectorNetwork): string {
  return join(DATA_DIR, network);
}

/** File names in a recipe directory that are not recipes. */
const NON_RECIPE_FILES = new Set(['cohorts.json', 'publish-manifest.json', 'cid-manifest.json']);

// ─── Recipe types ────────────────────────────────────────────────────────────

export type KeySpec = { source: 'generate' } | { source: 'fixed'; secretHex: string };

export type ScenarioBeacon =
  | { kind: 'P2PKH' | 'P2WPKH' | 'P2TR'; id: string }
  | { kind: 'CAS' | 'SMT'; id: string; role: 'dedicated' | 'shared' };

export type Delivery = 'sidecar' | 'cas' | 'smt';

/**
 * How an update is made invalid. The resolver must raise `INVALID_DID_UPDATE`
 * for every kind except `version-skip`, which raises `LATE_PUBLISHING`
 * (a version is missing). The kinds that change the proof options sign the
 * update with those options; the kinds that change the signed bytes edit the
 * update after the signature.
 */
export type TamperKind =
  /** One member of the update `@context` differs from the pinned array. */
  | 'context-member'
  /** Two members of the update `@context` are swapped. */
  | 'context-order'
  /** The proof `@context` differs from the update `@context`. */
  | 'proof-context'
  /** `capabilityAction` is `Read`. */
  | 'capability-action'
  /** `capability` carries the DID without percent-encoding. */
  | 'capability-encoding'
  /** `invocationTarget` is the DID of the same genesis bytes on mainnet, not the DID. */
  | 'invocation-target'
  /** `proofPurpose` is `assertionMethod`. */
  | 'proof-purpose'
  /** The proof names a verification method that the document does not contain. */
  | 'unknown-method'
  /** One character of `proofValue` differs. */
  | 'proof-value'
  /** `sourceHash` is the hash of the target document. */
  | 'source-hash'
  /** `targetHash` is the hash of the source document. */
  | 'target-hash'
  /** `targetVersionId` skips one version: `LATE_PUBLISHING`. */
  | 'version-skip'
  /** The patch is invalid on purpose: the update is constructed without the strict checks. */
  | 'invalid-patch'
  /** `proof.created` is after the block header time. */
  | 'created-after-block'
  /** `proof.expires` is before the block `mediantime`. */
  | 'expires-before-mediantime'
  /** `proof.expires` is before `proof.created`. */
  | 'expires-before-created';

export type ScenarioUpdate = {
  patches: PatchOperation[];
  verificationMethodId: string;
  beaconId: string;
  delivery: Delivery;
  label?: string;
  /** The name of the key that signs, when it is not the key that the verification method publishes. */
  signWith?: string;
  /** Construct this update from the source of the previous update: two updates for one version. */
  fork?: boolean;
  /** Make the update invalid. */
  tamper?: TamperKind;
  /** Keep the signed update out of the sidecar and out of the CAS. */
  withhold?: boolean;
  /**
   * Announce this update at a beacon that an earlier update removed from the
   * document. The anchor address comes from the genesis document. A resolver
   * ignores the signal, so the update does not advance the expected document.
   */
  removedBeacon?: boolean;
  /**
   * The anchor round of this entry. The default is the position of the entry.
   * The anchors of one scenario must use different rounds.
   */
  round?: number;
  /**
   * The anchor of this update is in an earlier round than the anchor of the
   * update before it. The signal is below `current_block_height`, so a resolver
   * ignores it, and the update does not advance the expected document.
   */
  belowCurrentHeight?: boolean;
};

/**
 * An entry of `updates` that is not an update: it announces the signed update
 * of an earlier entry again, at `beaconId`, in a later block (a duplicate
 * signal). The entry has no `update/NN/` directory and no sidecar entry.
 */
export type DuplicateEntry = {
  /** The entry (1-based) whose signed update the signal announces again. */
  duplicateOf: number;
  beaconId: string;
  label?: string;
};

export type ScenarioEntry = ScenarioUpdate | DuplicateEntry;

export function isDuplicate(entry: ScenarioEntry): entry is DuplicateEntry {
  return 'duplicateOf' in entry;
}

/** The update entries of a recipe, in order: the entries that have an `update/NN/` directory. */
export function realUpdates(recipe: Scenario): ScenarioUpdate[] {
  return recipe.updates.filter((e): e is ScenarioUpdate => !isDuplicate(e));
}

export type VerificationRelationship = 'authentication' | 'assertionMethod' | 'capabilityInvocation' | 'capabilityDelegation';

/** Options for the genesis document of an EXTERNAL identifier. */
export type GenesisOptions = {
  /**
   * Extra verification methods, each from a named extra key, with the relationships that list it.
   * With `referenceOnly`, the relationships list a reference to the method, and `verificationMethod`
   * does not contain the method.
   */
  verificationMethods?: Array<{ id: string; key: string; relationships: VerificationRelationship[]; referenceOnly?: boolean }>;
  /** `capabilityInvocation` lists the initial key as an embedded method object and `verificationMethod` omits it. */
  embedInvocationKey?: boolean;
  /** Spell the ids of the genesis document as relative DID URLs (`#initialKey`). */
  relativeIds?: boolean;
  /** The sidecar genesis document differs from the hashed one: the resolver must raise `INVALID_DID`. */
  tamper?: 'hash-mismatch';
};

/** How the identifier in the resolve input is made invalid. */
export type IdentifierTamper = 'checksum' | 'padding' | 'network-nibble';

/**
 * How the SMT proof in the sidecar of a cohort member is made invalid.
 *
 * - `hash`: one byte of the first entry of `hashes` differs. `INVALID_SIGNAL_DATA`.
 * - `id`: `id` is not the signal root. A resolver finds a sidecar proof by its
 *   `id`, so the sidecar has no proof for the signal: `MISSING_UPDATE_DATA`.
 * - `withhold`: the sidecar holds no proof. `MISSING_UPDATE_DATA`.
 */
export type SmtProofTamper = 'hash' | 'id' | 'withhold';

/**
 * The SMT tree entry of a cohort member. The default entry has a nonce, and an
 * `updateId` if the member has an update. With `nonce: false` and no update,
 * the tree has no entry for the DID, and the proof is the proof of an empty index.
 */
export type SmtMemberOptions = {
  /** `false`: the entry has no nonce. */
  nonce?: boolean;
  /** Make the proof in the sidecar invalid. */
  proof?: SmtProofTamper;
};

/**
 * A resolve sub-vector (`resolve/<id>/`) with resolution options. A `versionTime`
 * of the form `before:N`, `at:N`, or `after:N` names the `mediantime` of the block
 * that anchors entry N of `updates` (a duplicate entry counts), minus one second,
 * exactly, or plus one second. A `minConf` of the form `depth:N` names the
 * confirmation count of the anchor of entry N. The verifiers resolve a form
 * against the chain they read; the record step writes the value into the
 * committed input.
 */
export type ResolveCase = {
  id: string;
  options: { versionId?: string; versionTime?: string; minConf?: number | string };
  expect: { versionId: string } | { error: string };
};

export type Scenario = {
  id: string;
  description: string;
  network: VectorNetwork;
  idType: 'KEY' | 'EXTERNAL';
  keys: KeySpec;
  /** Named keys for beacon rotation, added verification methods, and unauthorized signers. */
  extraKeys?: Record<string, KeySpec>;
  beacons: ScenarioBeacon[];
  genesis?: GenesisOptions;
  identifier?: { tamper: IdentifierTamper };
  delivery?: { genesis?: 'cas' | 'sidecar'; announcement?: 'cas' | 'sidecar' };
  updates: ScenarioEntry[];
  resolves?: ResolveCase[];
  /**
   * The expected result of the main resolve of a negative set: the error code,
   * and the id of the rule that the set breaks (a key of {@link FAILURE_RULES}).
   */
  expect?: { error: string; rule: string };
  /** The SMT tree entry and the proof of a member of an SMT cohort. */
  smt?: SmtMemberOptions;
  /** The reason the pipeline skips this recipe (for example a pending specification change). */
  skip?: string;
};

export type CohortDef = {
  id: string;
  beaconType: 'CASBeacon' | 'SMTBeacon';
  addressType: 'P2WPKH';
  serviceId: string;
  network: VectorNetwork;
  keys: KeySpec;
  members: string[];
};

// ─── Pipeline state (lib/scenarios/<network>/state/) ────────────────────────

export type AddrType = 'p2pkh' | 'p2wpkh' | 'p2tr';

/**
 * One on-chain anchor of a solo scenario: an OP_RETURN at this address with the
 * hash of a signed update. The anchor step broadcasts the k-th anchor of every
 * scenario in round k, one round per block.
 */
export type AnchorEntry = {
  /** The entry (1-based) of `updates` that the anchor announces. A `versionTime` form names its block. */
  update: number;
  /** The update directory (1-based, `update/NN/`) whose signed update is the signal. */
  signalOf: number;
  /** Set on the anchor of a duplicate entry: the entry whose signal it repeats. */
  duplicateOf?: number;
  /** The anchor round, if the recipe sets it. The default is the position of the anchor, from 1. */
  round?: number;
  beaconId: string;
  address: string;
  kind: AddrType;
  /** `genesis` or the name of an extra key. */
  key: string;
  /** The transaction of the anchor. The anchor step sets it after the broadcast. */
  txid?: string;
};

/**
 * The state of one generated scenario, written by the generator and read by the
 * funding, anchor, and verify steps. It is not part of the vector corpus, and it
 * holds no secret: the anchor step reads the keys from `other.json`.
 */
export type ScenarioState = {
  scenarioId: string;
  network: VectorNetwork;
  did: string;
  needsFunding: boolean;
  cohort: string | null;
  anchors: AnchorEntry[];
  allBeacons: Array<{ id: string; type: string; address: string }>;
};

export type OtherFile = {
  scenarioId: string;
  /** A negative set: the id of the rule that the set breaks (ADR 136). */
  expectedFailure?: string;
  genesisKeys: { secret: string; public: string };
  extraKeys?: Record<string, { secret: string; public: string }>;
  genesisDocument?: object;
};

// ─── JSON I/O ────────────────────────────────────────────────────────────────

export function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** Write pretty JSON (4 spaces, trailing newline), the format of every vector file. */
export function writeJSON(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 4) + '\n');
}

/** Write pretty JSON with 2 spaces, the format of the recipe files. */
export function writeRecipeJSON(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// ─── Recipes, cohorts, vector directories ────────────────────────────────────

/** The recipe files of a network, sorted by name. */
export function recipeFiles(network: VectorNetwork): string[] {
  const dir = scenariosDir(network);
  if (!existsSync(dir)) throw new Error(`No recipe directory for ${network}: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !NON_RECIPE_FILES.has(f))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Every active recipe of a network, keyed by scenario id. A recipe with a
 * `skip` reason is left out and the reason is printed once.
 */
export function loadRecipes(network: VectorNetwork): Map<string, Scenario> {
  const recipes = new Map<string, Scenario>();
  for (const path of recipeFiles(network)) {
    const recipe = readJSON<Scenario>(path);
    if (typeof recipe?.id !== 'string') continue;
    if (recipe.network !== network) {
      throw new Error(`Recipe ${path} names network "${recipe.network}", expected "${network}".`);
    }
    if (recipe.skip) {
      console.log(`  skip   ${recipe.id}: ${recipe.skip}`);
      continue;
    }
    if (recipe.expect) {
      const rule = FAILURE_RULES[recipe.expect.rule];
      if (!rule) throw new Error(`Recipe ${path}: expect.rule "${recipe.expect.rule}" is not a rule id of FAILURE_RULES.`);
      if (rule.error !== recipe.expect.error) {
        throw new Error(`Recipe ${path}: rule ${recipe.expect.rule} raises ${rule.error}, but expect.error is ${recipe.expect.error}.`);
      }
    }
    recipes.set(recipe.id, recipe);
  }
  return recipes;
}

export function loadCohorts(network: VectorNetwork): CohortDef[] {
  const path = cohortsFile(network);
  if (!existsSync(path)) return [];
  return readJSON<{ cohorts?: CohortDef[] }>(path).cohorts ?? [];
}

export function findCohort(scenarioId: string, cohorts: CohortDef[]): CohortDef | undefined {
  return cohorts.find((c) => c.members.includes(scenarioId));
}

/** Every generated vector directory of a network, keyed by the scenario id of its `other.json`. */
export function indexScenarioDirs(network: VectorNetwork): Map<string, string> {
  const idx = new Map<string, string>();
  for (const type of ['k1', 'x1']) {
    const typeDir = join(networkDataDir(network), type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir).sort()) {
      const other = join(typeDir, h, 'other.json');
      if (!existsSync(other)) continue;
      const id = readJSON<{ scenarioId?: string }>(other).scenarioId;
      if (id) idx.set(id, join(typeDir, h));
    }
  }
  return idx;
}

/** The pipeline state of a generated scenario, or `undefined` when no generator pass wrote it. */
export function readState(network: VectorNetwork, scenarioId: string): ScenarioState | undefined {
  const path = stateFile(network, scenarioId);
  return existsSync(path) ? readJSON<ScenarioState>(path) : undefined;
}

/** Write the pipeline state of a scenario to its state file. */
export function writeState(state: ScenarioState): void {
  writeJSON(stateFile(state.network, state.scenarioId), state);
}

/** The directory of update N of a vector: `update/` for a single update, `update/NN/` otherwise. */
export function updateDir(vectorDir: string, count: number, stepNum: number): string {
  return count === 1 ? join(vectorDir, 'update') : join(vectorDir, 'update', String(stepNum).padStart(2, '0'));
}

/** The signed updates of a vector, in recipe order. */
export function readSignedUpdates(vectorDir: string, count: number): SignedBTCR2Update[] {
  const out: SignedBTCR2Update[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(readJSON<{ signedUpdate: SignedBTCR2Update }>(join(updateDir(vectorDir, count, i), 'output.json')).signedUpdate);
  }
  return out;
}

/** The directory of a resolve sub-vector. */
export function resolveCaseDir(vectorDir: string, caseId: string): string {
  return join(vectorDir, 'resolve', caseId);
}

// ─── versionTime forms ───────────────────────────────────────────────────────

const VERSION_TIME_FORM = /^(before|at|after):(\d+)$/;

/** True if `value` is a `before:N`, `at:N`, or `after:N` form. */
export function isVersionTimeForm(value: string | undefined): boolean {
  return typeof value === 'string' && VERSION_TIME_FORM.test(value);
}

/**
 * Resolve a `versionTime` form against the `mediantime` (Unix seconds) of the
 * block that anchors update N. A value that is not a form is returned as is.
 */
export function resolveVersionTime(value: string, mediantimeOf: (update: number) => number): string {
  const m = VERSION_TIME_FORM.exec(value);
  if (!m) return value;
  const base = mediantimeOf(Number(m[2]));
  const seconds = m[1] === 'before' ? base - 1 : m[1] === 'after' ? base + 1 : base;
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ─── minConf forms ───────────────────────────────────────────────────────────

const MIN_CONF_FORM = /^depth:(\d+)$/;

/** True if `value` is a `depth:N` form. */
export function isMinConfForm(value: unknown): value is string {
  return typeof value === 'string' && MIN_CONF_FORM.test(value);
}

/**
 * Resolve a `minConf` form against the confirmation count of the anchor of
 * entry N. A number is returned as is.
 * @throws {Error} if the value is neither a number nor a form.
 */
export function resolveMinConf(value: number | string, confirmationsOf: (update: number) => number): number {
  if (typeof value === 'number') return value;
  const m = MIN_CONF_FORM.exec(value);
  if (!m) throw new Error(`minConf "${value}" is neither a number nor a depth:N form`);
  return confirmationsOf(Number(m[1]));
}

// ─── Anchor rounds ───────────────────────────────────────────────────────────

/** The round of anchor `index` (from 0) of a scenario: the round the recipe sets, or the position of the anchor. */
export function anchorRound(anchor: AnchorEntry, index: number): number {
  return anchor.round ?? index + 1;
}

// ─── Proof options ───────────────────────────────────────────────────────────

/** The current time plus `offsetSeconds`, as an XML Datetime in UTC with whole seconds. */
export function nowIso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The proof times of an `expires-before-created` update: `created` is now, and
 * `expires` is one second earlier. The anchor step signs the update again with
 * new times right before the broadcast. Then `expires` is after the
 * `mediantime` of the block, and the update breaks only the rule that
 * `expires` is not before `created`.
 */
export function expiresBeforeCreatedTimes(): { created: string; expires: string } {
  return { created: nowIso(0), expires: nowIso(-1) };
}

/** Sign an update with explicit proof options (the tampers that change the options). */
export function signWithConfig(
  did: string,
  unsigned: UnsignedBTCR2Update,
  vm: Pick<DidVerificationMethod, 'id' | 'controller'>,
  signer: LocalSigner,
  overrides: Partial<Btcr2DataIntegrityConfig>,
): SignedBTCR2Update {
  const hashIdx = vm.id.indexOf('#');
  const fragment = vm.id.slice(hashIdx);
  const absoluteId = hashIdx === 0 ? `${did}${fragment}` : vm.id;
  const multikey = SchnorrMultikey.fromSigner(fragment, vm.controller, signer);
  const config: Btcr2DataIntegrityConfig = {
    '@context'         : [ ...BTCR2_UPDATE_CONTEXT ],
    cryptosuite        : 'bip340-jcs-2025',
    type               : 'DataIntegrityProof',
    verificationMethod : absoluteId,
    proofPurpose       : 'capabilityInvocation',
    capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
    capabilityAction   : 'Write',
    invocationTarget   : did,
    ...overrides,
  };
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config) as SignedBTCR2Update;
}

// ─── Failure rules ───────────────────────────────────────────────────────────

/** The published specification. A {@link FailureRule} section is relative to it. */
export const SPEC_URL = 'https://dcdpr.github.io/did-btcr2/';

/** A rule of the specification that a negative set is built to break. */
export type FailureRule = {
  /** The DID Resolution error code that the rule raises. */
  error: string;
  /** The rule, in the words of the specification. */
  rule: string;
  /** The section of the specification that holds the rule, relative to {@link SPEC_URL}. */
  section: string;
  /** The `errorMessage` of this implementation for the rule. The cause check matches it. */
  message: RegExp;
  /**
   * The resolver checks the rule in the proof time window, against the times
   * of the block of the signal. The offline verifier has synthetic block
   * times, so it cannot check the cause of the rule.
   */
  blockTimes?: true;
};

const RESOLVE = 'operations/resolve.html';
const DECODING = 'algorithms.html#did-btcr2-identifier-decoding';

/**
 * The rules that the negative sets break, keyed by rule id. The id of a set
 * goes into its `other.json` as `expectedFailure`. An id names a rule, not a
 * set: two sets that break the same rule share the id.
 *
 * The ids are stable (ADR 136). Never rename an id and never use an id for
 * another rule. A new rule gets a new id. A removed rule retires its id, and
 * no other rule takes it.
 */
export const FAILURE_RULES: Readonly<Record<string, FailureRule>> = {
  'did-checksum-invalid' : {
    error   : 'INVALID_DID',
    rule    : 'The Bech32m checksum of the method-specific-id is not valid.',
    section : DECODING,
    message : /Bech32m decoding failed: Invalid checksum/,
  },
  'did-padding-nonzero' : {
    error   : 'INVALID_DID',
    rule    : 'The incomplete final 5-bit group of the method-specific-id is not all zeros.',
    section : DECODING,
    message : /Bech32m decoding failed: Non-zero padding/,
  },
  'did-network-reserved' : {
    error   : 'INVALID_DID',
    rule    : 'The network_value is a reserved value (6 to 11).',
    section : DECODING,
    message : /^Invalid network \(reserved\)/,
  },
  'genesis-hash-mismatch' : {
    error   : 'INVALID_DID',
    rule    : 'The hash of the genesis document does not match genesis_bytes.',
    section : `${RESOLVE}#process-sidecar-data`,
    message : /^Initial document mismatch/,
  },
  'update-missing' : {
    error   : 'MISSING_UPDATE_DATA',
    rule    : 'The signed update is not available from the sidecar or from the CAS.',
    section : `${RESOLVE}#find-beacon-signals`,
    message : /^Signed update (not found in CAS|required but not in sidecar)/,
  },
  'update-context-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The @context of the update is not the array that the BTCR2 Unsigned Update specifies.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: @context is not the array/,
  },
  'proof-context-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The @context of update.proof is not equal to the @context of the update.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: proof @context does not equal/,
  },
  'proof-capability-action-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'update.proof.capabilityAction is not "Write".',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: proof\.capabilityAction must equal/,
  },
  'proof-capability-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'update.proof.capability is not the capability URN of the Data Integrity Config for the DID.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: proof\.capability must equal/,
  },
  'proof-invocation-target-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'update.proof.invocationTarget is not the DID.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: proof\.invocationTarget must equal/,
  },
  'proof-purpose-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'update.proof.proofPurpose is not "capabilityInvocation".',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: proof\.proofPurpose must equal/,
  },
  'proof-method-unauthorized' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'No entry of capabilityInvocation identifies update.proof.verificationMethod.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: verificationMethod is not authorized for capabilityInvocation/,
  },
  'proof-method-not-found' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The capabilityInvocation entry that identifies update.proof.verificationMethod is a reference, and current_document.verificationMethod has no method with that id.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: verificationMethod is not found in the verificationMethod of the current document/,
  },
  'proof-not-verified' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The BIP340 Cryptosuite does not verify the update.',
    section : `${RESOLVE}#check-update-proof`,
    message : /^Invalid update: proof (not verified|verification failed)/,
  },
  'source-hash-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The hash of the current document does not match update.sourceHash.',
    section : `${RESOLVE}#apply-update`,
    message : /^Hash mismatch: update\.sourceHash/,
  },
  'target-hash-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The hash of the patched document does not match update.targetHash.',
    section : `${RESOLVE}#apply-update`,
    message : /^Invalid update: update\.targetHash/,
  },
  'version-skip' : {
    error   : 'LATE_PUBLISHING',
    rule    : 'update.targetVersionId is more than the current version plus 1.',
    section : `${RESOLVE}#check-update-version`,
    message : /^Version Id Mismatch/,
  },
  'patch-apply-failure' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'update.patch fails to apply to the current document.',
    section : `${RESOLVE}#apply-update`,
    message : /^Invalid update: JSON Patch application failed/,
  },
  'document-id-mismatch' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The id of the patched document is not the DID.',
    section : `${RESOLVE}#apply-update`,
    message : /^Invalid update: the patch changes the document id/,
  },
  'document-not-conformant' : {
    error   : 'INVALID_DID_UPDATE',
    rule    : 'The patched document does not conform to DID Core v1.1.',
    section : `${RESOLVE}#apply-update`,
    message : /^Invalid update: the patched document does not conform/,
  },
  'proof-created-after-block' : {
    error      : 'INVALID_DID_UPDATE',
    rule       : 'update.proof.created is after the timestamp in the block header.',
    section    : `${RESOLVE}#check-update-proof`,
    message    : /^Invalid update: proof\.created is after the header time/,
    blockTimes : true,
  },
  'proof-expires-before-mediantime' : {
    error      : 'INVALID_DID_UPDATE',
    rule       : 'update.proof.expires is before the block mediantime.',
    section    : `${RESOLVE}#check-update-proof`,
    message    : /^Invalid update: proof\.expires is before the mediantime/,
    blockTimes : true,
  },
  'proof-expires-before-created' : {
    error      : 'INVALID_DID_UPDATE',
    rule       : 'update.proof.expires is before update.proof.created.',
    section    : `${RESOLVE}#check-update-proof`,
    message    : /^Invalid update: proof\.expires is before proof\.created/,
    blockTimes : true,
  },
  'duplicate-hash-mismatch' : {
    error   : 'LATE_PUBLISHING',
    rule    : 'The hash of a duplicate update does not match the hash of the applied update of its version.',
    section : `${RESOLVE}#confirm-duplicate-update`,
    message : /^Invalid duplicate: unsigned update hash does not match/,
  },
  'smt-proof-not-verified' : {
    error   : 'INVALID_SIGNAL_DATA',
    rule    : 'The SMT Proof Verification algorithm returns false.',
    section : `${RESOLVE}#process-smt-beacon`,
    message : /^SMT proof verification failed/,
  },
  'smt-proof-missing' : {
    error   : 'MISSING_UPDATE_DATA',
    rule    : 'smt_lookup_table has no entry for the signal root.',
    section : `${RESOLVE}#process-smt-beacon`,
    message : /^SMT proof required but not in sidecar/,
  },
};

/**
 * Check the cause of a failed resolve against the rule of a negative set.
 * @returns `undefined` if `message` matches the rule, else the difference.
 */
export function causeDiff(ruleId: string, message: string | undefined): string | undefined {
  const rule = FAILURE_RULES[ruleId];
  if (!rule) return `unknown rule ${ruleId}`;
  if (message !== undefined && rule.message.test(message)) return undefined;
  const firstLine = (message ?? '(no errorMessage)').split('\n')[0]!;
  return `cause "${firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine}" is not the rule ${ruleId}`;
}

// ─── Expected results ────────────────────────────────────────────────────────

/** The DID Resolution result the api returns for a successful resolve, as far as it is known offline. */
export function okEnvelope(didDocument: object, versionId: number, deactivated: boolean): object {
  return {
    didResolutionMetadata : { contentType: 'application/did' },
    didDocument,
    didDocumentMetadata   : { versionId: String(versionId), deactivated },
  };
}

/** The DID Resolution result the api returns for a failed resolve. */
export function errorEnvelope(error: string): object {
  return {
    didResolutionMetadata : { error },
    didDocument           : null,
    didDocumentMetadata   : {},
  };
}

/** The result a verifier compares: the document and the version, or the error code. */
export type Expected =
  | { kind: 'ok'; didDocument: object; versionId: string; deactivated: boolean }
  | { kind: 'error'; error: string };

/** Read the expectation of a `resolve/output.json` (main or sub-vector). */
export function readExpected(outputPath: string): Expected {
  const out = readJSON<{
    didResolutionMetadata?: { error?: string };
    didDocument?: object | null;
    didDocumentMetadata?: { versionId?: string; deactivated?: boolean };
  }>(outputPath);
  if (out.didResolutionMetadata?.error || !out.didDocument) {
    return { kind: 'error', error: out.didResolutionMetadata?.error ?? 'unknown' };
  }
  return {
    kind        : 'ok',
    didDocument : out.didDocument,
    versionId   : out.didDocumentMetadata?.versionId ?? '1',
    deactivated : out.didDocumentMetadata?.deactivated ?? false,
  };
}
