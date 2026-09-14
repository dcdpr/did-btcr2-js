/**
 * Shared helpers for the test-vector pipeline scripts in this directory.
 *
 * Underscore-prefixed so that no runner treats this file as a top-level script.
 *
 * The pipeline reads one recipe directory per network (`lib/scenarios/<network>/`)
 * and writes one vector tree per network (`lib/data/<network>/{k1,x1}/<hash>/`).
 * Every script takes `--network <name>` (default `mutinynet`). This module holds
 * the recipe types, the paths, the JSON I/O, and the lookups that more than one
 * script needs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PatchOperation } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/method';

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
 * for every kind except `version-skip`, which raises `LATE_PUBLISHING_ERROR`
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
  /** `targetVersionId` skips one version: `LATE_PUBLISHING_ERROR`. */
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
};

export type VerificationRelationship = 'authentication' | 'assertionMethod' | 'capabilityInvocation' | 'capabilityDelegation';

/** Options for the genesis document of an EXTERNAL identifier. */
export type GenesisOptions = {
  /** Extra verification methods, each from a named extra key, with the relationships that list it. */
  verificationMethods?: Array<{ id: string; key: string; relationships: VerificationRelationship[] }>;
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
 * A resolve sub-vector (`resolve/<id>/`) with resolution options. A `versionTime`
 * of the form `before:N`, `at:N`, or `after:N` names the `mediantime` of the block
 * that anchors update N, minus one second, exactly, or plus one second. The
 * verifiers resolve the form against the chain they read; the record step writes
 * the timestamp into the committed input.
 */
export type ResolveCase = {
  id: string;
  options: { versionId?: string; versionTime?: string; minConf?: number };
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
  updates: ScenarioUpdate[];
  resolves?: ResolveCase[];
  /** The expected result of the main resolve when it is an error. */
  expect?: { error: string };
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

// ─── State written next to a vector ─────────────────────────────────────────

export type AddrType = 'p2pkh' | 'p2wpkh' | 'p2tr';

/** One on-chain anchor of a solo scenario: update N goes into an OP_RETURN at this address. */
export type AnchorEntry = {
  update: number;
  beaconId: string;
  address: string;
  kind: AddrType;
  /** `genesis` or the name of an extra key. */
  key: string;
};

export type FundingFile = {
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

/** Every generated vector directory of a network, keyed by scenario id. */
export function indexScenarioDirs(network: VectorNetwork): Map<string, string> {
  const idx = new Map<string, string>();
  for (const type of ['k1', 'x1']) {
    const typeDir = join(networkDataDir(network), type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir).sort()) {
      const scn = join(typeDir, h, 'scenario.json');
      if (existsSync(scn)) idx.set(readJSON<{ id: string }>(scn).id, join(typeDir, h));
    }
  }
  return idx;
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
