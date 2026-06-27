/**
 * Scenario-driven test vector generator.
 *
 * Reads a scenario recipe (JSON) and produces a self-contained test vector
 * tree under `lib/data/{network}/{type}/{hash}/`. Mirrors the structure of
 * `generate-vector.ts` but trades the stepped CLI for a single declarative
 * input file.
 *
 * Each scenario captures: identifier type, network, beacon mix, optional
 * updates, and key material policy (generate fresh or use a fixed secret).
 * Output vectors are reproducible by re-running with the same scenario plus
 * the `other.json` (which records the generated keys).
 *
 * Batch A (this file): no-broadcast scenarios - k1/x1 base resolution with
 * default beacons and no updates. Batches B + C add update + aggregation
 * support; this orchestrator is the shared driver they extend.
 *
 * Usage:
 *   pnpm generate:scenario lib/scenarios/01-k1-base.json
 *   pnpm generate:scenario lib/scenarios/03-x1-base.json
 *   pnpm generate:scenario lib/scenarios/05-x1-no-beacon.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNetwork } from '@did-btcr2/bitcoin';
import { JSONPatch, type PatchOperation } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';
import { p2pkh, p2tr, p2wpkh } from '@scure/btc-signer';

import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import { Updater } from '../src/core/updater.js';
import { DidBtcr2 } from '../src/did-btcr2.js';
import {
  GenesisDocument,
  ID_PLACEHOLDER_VALUE,
  type DidVerificationMethod,
  type Btcr2DidDocument
} from '../src/utils/did-document.js';
import type { BeaconService } from '../src/core/beacon/interfaces.js';

type ScenarioBeacon =
  | { kind: 'P2PKH' | 'P2WPKH' | 'P2TR'; id: string }
  | { kind: 'CAS' | 'SMT'; id: string; role: 'dedicated' | 'shared' };

type ScenarioUpdate = {
  patches: PatchOperation[];
  verificationMethodId: string;
  beaconId: string;
  delivery: 'sidecar' | 'cas' | 'smt';
  label?: string;
};

type Scenario = {
  id: string;
  description: string;
  network: 'regtest' | 'mutinynet';
  idType: 'KEY' | 'EXTERNAL';
  keys: { source: 'generate' } | { source: 'fixed'; secretHex: string };
  beacons: ScenarioBeacon[];
  updates: ScenarioUpdate[];
};

/**
 * A cohort is a set of scenario DIDs whose updates share ONE on-chain beacon
 * signal (a CAS Announcement Map hash or an SMT root), anchored once. The shared
 * beacon address derives from the cohort's own fixed key (the aggregator), not
 * any member's genesis key, and is injected as a service into every member's
 * genesis document. See cohorts.json.
 */
type CohortDef = {
  id: string;
  beaconType: 'CASBeacon' | 'SMTBeacon';
  addressType: 'P2WPKH';
  serviceId: string;
  network: 'regtest' | 'mutinynet';
  keys: { source: 'generate' } | { source: 'fixed'; secretHex: string };
  members: string[];
};

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const COHORTS_FILE = join(HERE, 'cohorts.json');

function loadCohorts(): CohortDef[] {
  try {
    const raw = JSON.parse(readFileSync(COHORTS_FILE, 'utf-8')) as { cohorts?: CohortDef[] };
    return raw.cohorts ?? [];
  } catch {
    return [];
  }
}

function findCohortForScenario(scenarioId: string, cohorts: CohortDef[]): CohortDef | undefined {
  return cohorts.find((c) => c.members.includes(scenarioId));
}

/**
 * Build the shared beacon service for a cohort. The address derives from the
 * cohort's fixed aggregator key (P2WPKH); the service type (CASBeacon/SMTBeacon)
 * tells the resolver how to interpret the OP_RETURN anchored at that address.
 */
function buildCohortService(cohort: CohortDef): BeaconService {
  if (cohort.keys.source !== 'fixed') {
    throw new Error(
      `Cohort "${cohort.id}" has no fixed key. Run \`bun lib/scenario-keys.ts\` before generating.`,
    );
  }
  const kp = SchnorrKeyPair.fromSecret(hex.decode(cohort.keys.secretHex));
  const net = getNetwork(cohort.network);
  const address = p2wpkh(kp.publicKey.compressed, net).address!;
  return {
    id              : `${ID_PLACEHOLDER_VALUE}${cohort.serviceId}`,
    type            : cohort.beaconType,
    serviceEndpoint : `bitcoin:${address}`,
  };
}

function writeJSON(dir: string, filename: string, data: unknown): void {
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 4) + '\n');
  console.log(`  wrote ${filepath}`);
}

function shortHash(did: string): string {
  return did.split(':')[2].slice(2, 10);
}

function resolveSecretKey(scenario: Scenario): SchnorrKeyPair {
  if (scenario.keys.source === 'fixed') {
    const bytes = hex.decode(scenario.keys.secretHex);
    return SchnorrKeyPair.fromSecret(bytes);
  }
  return SchnorrKeyPair.generate();
}

/**
 * Build the service[] array for a scenario's beacon mix. Addresses are derived
 * from the genesis public key; CAS/SMT use the same Bitcoin address as singleton
 * (the beacon TX is on-chain in all three; CAS/SMT just add an off-chain content
 * layer for updates).
 */
function buildServices(
  beacons: ScenarioBeacon[],
  publicKey: Uint8Array,
  network: string,
): BeaconService[] {
  const net = getNetwork(network);
  const xOnly = publicKey.slice(1);

  const addressFor = (kind: ScenarioBeacon['kind']): string => {
    switch (kind) {
      case 'P2PKH':
      case 'CAS':
      case 'SMT':
        // CAS/SMT beacons sit on a Bitcoin address too; we default to P2PKH for
        // these scenarios. Real-world deployments could mix kinds; for vector
        // generation we keep it simple unless the scenario specifies otherwise.
        return p2pkh(publicKey, net).address!;
      case 'P2WPKH':
        return p2wpkh(publicKey, net).address!;
      case 'P2TR':
        return p2tr(xOnly, undefined, net).address!;
    }
  };

  const typeFor = (kind: ScenarioBeacon['kind']): string => {
    if (kind === 'CAS') return 'CASBeacon';
    if (kind === 'SMT') return 'SMTBeacon';
    return 'SingletonBeacon';
  };

  return beacons.map((b) => ({
    id              : `${ID_PLACEHOLDER_VALUE}${b.id}`,
    type            : typeFor(b.kind),
    serviceEndpoint : `bitcoin:${addressFor(b.kind)}`,
  }));
}

function buildVerificationMethod(publicKey: Uint8Array): DidVerificationMethod[] {
  const multibase = new SchnorrKeyPair({ publicKey }).publicKey.multibase.encoded;
  return [{
    id                 : `${ID_PLACEHOLDER_VALUE}#initialKey`,
    type               : 'Multikey',
    controller         : ID_PLACEHOLDER_VALUE,
    publicKeyMultibase : multibase,
  }];
}

function buildGenesisDocument(
  publicKey: Uint8Array,
  beacons: ScenarioBeacon[],
  network: string,
  extraServices: BeaconService[] = [],
): GenesisDocument {
  const verificationMethod = buildVerificationMethod(publicKey);
  const service = [...buildServices(beacons, publicKey, network), ...extraServices];
  const relationships = {
    authentication       : [`${ID_PLACEHOLDER_VALUE}#initialKey`],
    assertionMethod      : [`${ID_PLACEHOLDER_VALUE}#initialKey`],
    capabilityInvocation : [`${ID_PLACEHOLDER_VALUE}#initialKey`],
    capabilityDelegation : [`${ID_PLACEHOLDER_VALUE}#initialKey`],
  };
  return GenesisDocument.create(verificationMethod, relationships, service);
}

/**
 * Resolve a possibly-relative DID URL fragment to an absolute ID. Scenario
 * JSONs use short forms like "#initialKey"; the on-disk documents and proofs
 * need the full "did:btcr2:<id>#initialKey".
 */
function absolutize(did: string, idOrFragment: string): string {
  return idOrFragment.startsWith('#') ? `${did}${idOrFragment}` : idOrFragment;
}

async function runScenario(scenarioPath: string): Promise<void> {
  const absPath = resolvePath(scenarioPath);
  const scenario = JSON.parse(readFileSync(absPath, 'utf-8')) as Scenario;

  console.log(`\n[scenario] ${scenario.id} (${scenario.network})`);
  console.log(`  ${scenario.description}\n`);

  // A cohort member shares one on-chain beacon with its paired DID(s). The
  // shared beacon (derived from the cohort key, not this DID's genesis key) is
  // injected into the genesis document so the resolver discovers it. Cohort
  // membership requires an EXTERNAL (x1) DID, since the shared beacon must live
  // in a genesis document (k1 docs are derived deterministically from the key).
  const cohort = findCohortForScenario(scenario.id, loadCohorts());
  const cohortService = cohort ? buildCohortService(cohort) : undefined;
  if (cohort && scenario.idType !== 'EXTERNAL') {
    throw new Error(
      `Cohort member "${scenario.id}" must be idType EXTERNAL; `
      + 'its shared beacon lives in the genesis document.',
    );
  }
  if (cohort) {
    console.log(`  cohort:     ${cohort.id} (${cohort.beaconType}) shared beacon ${cohortService!.serviceEndpoint.replace(/^bitcoin:/, '')}`);
  }

  // Batch B (sidecar) is fully implemented. Batch C (cas/smt) is partially:
  // the signed update is identical regardless of delivery, but the off-chain
  // publishing (CAS) and aggregation (SMT) plus the on-chain anchoring are
  // not yet wired. For cas/smt we still construct and sign the update (the
  // sidecar still holds it) so vector consumers can verify the proof. The
  // broadcast/publish gap is tracked in `pending.json` for later Batch C work.
  const pendingActions: Array<{ stepNum: number; delivery: 'cas' | 'smt'; beaconId: string }> = [];

  const kp = resolveSecretKey(scenario);
  const publicKey = kp.publicKey.compressed;
  const secretHex = hex.encode(kp.secretKey.bytes);
  const publicHex = hex.encode(publicKey);

  console.log(`  generated keypair:`);
  console.log(`    public:  ${publicHex}`);

  let genesisBytes: Uint8Array;
  let genesisDocument: GenesisDocument | undefined;
  const other: Record<string, unknown> = {
    scenarioId   : scenario.id,
    genesisKeys  : { secret: secretHex, public: publicHex },
  };

  if (scenario.idType === 'KEY') {
    genesisBytes = publicKey;
  } else {
    genesisDocument = buildGenesisDocument(
      publicKey, scenario.beacons, scenario.network,
      cohortService ? [cohortService] : [],
    );
    genesisBytes = GenesisDocument.toGenesisBytes(genesisDocument);
    other.genesisDocument = genesisDocument;
    console.log(`    genesis doc hash: ${hex.encode(genesisBytes)}`);
  }

  const did = DidBtcr2.create(genesisBytes, {
    idType  : scenario.idType,
    network : scenario.network,
  });
  const hash = shortHash(did);
  const typePrefix = scenario.idType === 'KEY' ? 'k1' : 'x1';
  const outDir = join(DATA_DIR, scenario.network, typePrefix, hash);

  console.log(`  DID:        ${did}`);
  console.log(`  short hash: ${hash}`);
  console.log(`  output dir: ${outDir}\n`);

  writeJSON(outDir, 'scenario.json', scenario);
  writeJSON(outDir, 'other.json', other);

  writeJSON(join(outDir, 'create'), 'input.json', {
    idType       : scenario.idType,
    version      : 1,
    network      : scenario.network,
    genesisBytes : hex.encode(genesisBytes),
  });
  writeJSON(join(outDir, 'create'), 'output.json', { did });

  // Resolve in pure-data mode. For k1, the resolver derives the genesis doc
  // deterministically from the pubkey embedded in the identifier. For x1, the
  // genesis doc is delivered via sidecar.
  const components = Identifier.decode(did);
  const baseDocument = scenario.idType === 'KEY'
    ? Resolver.deterministic(components)
    : Resolver.external(components, genesisDocument!);

  // ─── Batch B: apply each sidecar update, signing with the genesis key ─────
  // The same key authorizes every update in this orchestrator (rotation is a
  // Batch C concern). For each update we: construct the unsigned form, sign it
  // with a Data Integrity proof, advance the in-memory document, and persist
  // input/output files. Multi-update scenarios get numbered subdirs.
  let currentDocument = baseDocument as Btcr2DidDocument;
  const signedUpdates: SignedBTCR2Update[] = [];
  const genesisSigner = new LocalSigner(kp.secretKey.bytes);

  for (let i = 0; i < scenario.updates.length; i++) {
    const u = scenario.updates[i]!;
    const stepNum         = i + 1;
    const sourceVersionId = stepNum; // version 1 is genesis; update i bumps to i+1
    const vmId            = absolutize(did, u.verificationMethodId);
    const beaconId        = absolutize(did, u.beaconId);
    const updateDir       = scenario.updates.length === 1
      ? join(outDir, 'update')
      : join(outDir, 'update', String(stepNum).padStart(2, '0'));

    const verificationMethod = DidBtcr2.getSigningMethod(currentDocument, vmId);
    const unsignedUpdate     = Updater.construct(currentDocument, u.patches, sourceVersionId);
    const signedUpdate       = Updater.sign(did, unsignedUpdate, verificationMethod, genesisSigner);

    console.log(`  [update ${stepNum}/${scenario.updates.length}] vm=${vmId}`);
    console.log(`    sourceHash:      ${unsignedUpdate.sourceHash}`);
    console.log(`    targetHash:      ${unsignedUpdate.targetHash}`);
    console.log(`    targetVersionId: ${unsignedUpdate.targetVersionId}`);

    writeJSON(updateDir, 'input.json', {
      sourceDocument       : currentDocument,
      patches              : u.patches,
      sourceVersionId,
      verificationMethodId : vmId,
      beaconId,
      signingMaterial      : secretHex,
    });
    writeJSON(updateDir, 'output.json', { signedUpdate });

    signedUpdates.push(signedUpdate);
    currentDocument = JSONPatch.apply(currentDocument, u.patches) as Btcr2DidDocument;

    if (u.delivery !== 'sidecar') {
      pendingActions.push({ stepNum, delivery: u.delivery, beaconId });
    }
  }

  if (pendingActions.length > 0) {
    writeJSON(outDir, 'pending.json', {
      note    : 'Batch C work pending: these updates need their off-chain payload (CAS) or aggregation (SMT) plus the on-chain anchor broadcast before the vector is fully resolvable against the chain.',
      actions : pendingActions,
    });
  }

  // ─── Final resolve files ──────────────────────────────────────────────────
  // For x1, the resolutionOptions always carry the genesisDocument; for any
  // update-bearing scenario, the sidecar also carries the signed updates.
  const sidecar: Record<string, unknown> = {};
  if (scenario.idType === 'EXTERNAL') sidecar.genesisDocument = genesisDocument;
  if (signedUpdates.length > 0)        sidecar.updates = signedUpdates;

  const resolveInput = Object.keys(sidecar).length === 0
    ? { did, resolutionOptions: {} }
    : { did, resolutionOptions: { sidecar } };

  writeJSON(join(outDir, 'resolve'), 'input.json', resolveInput);
  writeJSON(join(outDir, 'resolve'), 'output.json', {
    didDocument         : currentDocument,
    didDocumentMetadata : {
      versionId   : 1 + signedUpdates.length,
      created     : null,
      updated     : null,
      deactivated : (currentDocument as unknown as { deactivated?: boolean }).deactivated === true,
    },
  });

  // Funding summary
  // Every scenario with updates needs at least one beacon address funded so the
  // commitment can be broadcast on-chain. Cohort members anchor at the SHARED
  // cohort beacon (one OP_RETURN covers the whole cohort, funded once); solo
  // update scenarios anchor at their own P2WPKH singleton (cheapest to spend
  // from). Written to `funding.json` for easy collation across scenarios.
  const services = buildServices(scenario.beacons, publicKey, scenario.network);
  const allServices = cohortService ? [...services, cohortService] : services;

  let fundingTarget: string | null = null;
  if (scenario.updates.length > 0) {
    if (cohort) {
      fundingTarget = cohortService!.serviceEndpoint.replace(/^bitcoin:/, '');
    } else {
      const p2wpkhBeacon = services.find((s) => s.id.endsWith('#initialP2WPKH'));
      fundingTarget = p2wpkhBeacon
        ? p2wpkhBeacon.serviceEndpoint.replace(/^bitcoin:/, '')
        : null;
    }
  }

  writeJSON(outDir, 'funding.json', {
    scenarioId    : scenario.id,
    network       : scenario.network,
    did,
    needsFunding  : fundingTarget !== null,
    cohort        : cohort ? cohort.id : null,
    primaryBeacon : fundingTarget,
    allBeacons    : allServices.map((s) => ({
      id      : s.id.replace(ID_PLACEHOLDER_VALUE, did),
      type    : s.type,
      address : s.serviceEndpoint.replace(/^bitcoin:/, ''),
    })),
  });

  console.log(`\n[scenario] ${scenario.id} done. hash=${hash}`);
  if (fundingTarget) {
    console.log(`  needs funding: ${fundingTarget}`);
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: pnpm generate:scenario <scenario.json>');
  process.exit(1);
}
await runScenario(arg);
