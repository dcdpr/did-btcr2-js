/**
 * Scenario-driven test vector generator.
 *
 * Reads the recipes of one network (`lib/scenarios/<network>/*.json`) and writes
 * one vector set per recipe under `lib/data/<network>/{k1,x1}/<hash>/`:
 *
 *   create/input.json, create/output.json
 *   update/input.json, update/output.json      (update/NN/ for more than one update)
 *   resolve/input.json, resolve/output.json    (resolve/NN/ for a sub-vector with options)
 *   other.json                                  (the keys and the genesis document)
 *
 * The state of a scenario (the DID, the anchors, the beacon addresses) goes to
 * `lib/scenarios/<network>/state/<scenario-id>.json`, outside the corpus.
 *
 * A recipe names the identifier type, the beacon mix, the genesis options, the
 * updates (with a signer, a fork, a tamper, a withhold, or a removedBeacon
 * directive, or a duplicate entry that announces an earlier update again), the
 * resolve sub-vectors, and the expected error of a negative vector. The generator runs
 * offline: the funding and the anchoring are later steps of the pipeline, and
 * the live resolve of `scenario:verify:live --record` writes the final
 * `resolve/output.json`.
 *
 * Signing uses the shipped random-aux path, so every run produces different
 * signed bytes. Run generate, artifacts, route, publish, fund, and anchor as one
 * pass per network.
 *
 * Usage:
 *   pnpm generate:scenario --network regtest --clean        # every recipe of the network
 *   pnpm generate:scenario --network regtest 01-k1-base     # one or more recipe ids
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, JSONPatch, type PatchOperation } from '@did-btcr2/common';
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import type {
  BeaconService, Btcr2DataIntegrityConfig, Btcr2DidDocument, DidVerificationMethod,
  SignedBTCR2Update, UnsignedBTCR2Update,
} from '@did-btcr2/method';
import {
  BTCR2_UPDATE_CONTEXT, DidBtcr2, GenesisDocument, ID_PLACEHOLDER_VALUE, Identifier, Resolver, Updater,
} from '@did-btcr2/method';
import { bech32m, hex } from '@scure/base';
import { Address, p2pkh, p2tr, p2wpkh } from '@scure/btc-signer';

import {
  errorEnvelope, findCohort, isDuplicate, loadCohorts, loadRecipes, networkDataDir, okEnvelope, parseNetworkArg,
  realUpdates, resolveCaseDir, stateDir, updateDir, writeJSON, writeState,
  type AddrType, type AnchorEntry, type CohortDef, type IdentifierTamper, type KeySpec,
  type OtherFile, type Scenario, type ScenarioBeacon, type ScenarioState, type ScenarioUpdate, type TamperKind,
  type VectorNetwork,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const clean = rest.includes('--clean');
const onlyIds = rest.filter((a) => !a.startsWith('--'));

// ─── Keys and addresses ──────────────────────────────────────────────────────

function keyPairOf(spec: KeySpec | undefined, label: string): SchnorrKeyPair {
  if (spec?.source === 'fixed') return SchnorrKeyPair.fromSecret(hex.decode(spec.secretHex));
  console.log(`  WARN: key "${label}" is not fixed; run scenario:keys before funding`);
  return SchnorrKeyPair.generate();
}

/** The keys of a scenario by name: `genesis` and every extra key. */
function loadKeys(scenario: Scenario): Map<string, SchnorrKeyPair> {
  const keys = new Map<string, SchnorrKeyPair>();
  keys.set('genesis', keyPairOf(scenario.keys, 'genesis'));
  for (const [name, spec] of Object.entries(scenario.extraKeys ?? {})) {
    keys.set(name, keyPairOf(spec, name));
  }
  return keys;
}

function addressOf(publicKey: Uint8Array, kind: AddrType, net: VectorNetwork): string {
  const n = getNetwork(net);
  switch (kind) {
    case 'p2pkh':  return p2pkh(publicKey, n).address!;
    case 'p2wpkh': return p2wpkh(publicKey, n).address!;
    case 'p2tr':   return p2tr(publicKey.slice(1), undefined, n).address!;
  }
}

/** The script kind of an address. */
function kindOfAddress(address: string, net: VectorNetwork): AddrType {
  const decoded = Address(getNetwork(net)).decode(address);
  switch (decoded.type) {
    case 'pkh':  return 'p2pkh';
    case 'wpkh': return 'p2wpkh';
    case 'tr':   return 'p2tr';
    default: throw new Error(`Unsupported beacon address type "${decoded.type}" for ${address}`);
  }
}

/** Every address of a key, so the anchor step finds the key of any beacon address. */
function registerKey(registry: Map<string, string>, name: string, kp: SchnorrKeyPair, net: VectorNetwork): void {
  for (const kind of ['p2pkh', 'p2wpkh', 'p2tr'] as const) {
    registry.set(addressOf(kp.publicKey.compressed, kind, net), name);
  }
}

// ─── Genesis document ────────────────────────────────────────────────────────

function buildCohortService(cohort: CohortDef): BeaconService {
  if (cohort.keys.source !== 'fixed') {
    throw new Error(`Cohort "${cohort.id}" has no fixed key. Run scenario:keys before generating.`);
  }
  const kp = SchnorrKeyPair.fromSecret(hex.decode(cohort.keys.secretHex));
  return {
    id              : `${ID_PLACEHOLDER_VALUE}${cohort.serviceId}`,
    type            : cohort.beaconType,
    serviceEndpoint : `bitcoin:${addressOf(kp.publicKey.compressed, 'p2wpkh', cohort.network)}`,
  };
}

/**
 * The service[] array of a beacon mix. The addresses derive from the genesis
 * key. A CAS or SMT beacon sits on a Bitcoin address too; these scenarios put
 * it on P2PKH.
 */
function buildServices(beacons: ScenarioBeacon[], publicKey: Uint8Array, net: VectorNetwork, idPrefix: string): BeaconService[] {
  const kindFor = (kind: ScenarioBeacon['kind']): AddrType =>
    kind === 'P2WPKH' ? 'p2wpkh' : kind === 'P2TR' ? 'p2tr' : 'p2pkh';
  const typeFor = (kind: ScenarioBeacon['kind']): string =>
    kind === 'CAS' ? 'CASBeacon' : kind === 'SMT' ? 'SMTBeacon' : 'SingletonBeacon';
  return beacons.map((b) => ({
    id              : `${idPrefix}${b.id}`,
    type            : typeFor(b.kind),
    serviceEndpoint : `bitcoin:${addressOf(publicKey, kindFor(b.kind), net)}`,
  }));
}

function multikeyMethod(id: string, controller: string, publicKey: Uint8Array): DidVerificationMethod {
  return {
    id,
    type               : 'Multikey',
    controller,
    publicKeyMultibase : new SchnorrKeyPair({ publicKey }).publicKey.multibase.encoded,
  } as DidVerificationMethod;
}

/**
 * The genesis document of an EXTERNAL identifier as a plain object. With
 * `relativeIds`, every id that names a fragment of the document is spelled
 * as a relative DID URL; the controller stays the placeholder, which the
 * resolver replaces with the DID.
 */
function buildGenesisDocument(scenario: Scenario, keys: Map<string, SchnorrKeyPair>, extraServices: BeaconService[]): object {
  const opts = scenario.genesis ?? {};
  const idPrefix = ID_PLACEHOLDER_VALUE;
  const controller = ID_PLACEHOLDER_VALUE;
  const initial = multikeyMethod(`${idPrefix}#initialKey`, controller, keys.get('genesis')!.publicKey.compressed);

  // With an embedded invocation key, the document lists the method nowhere else: a
  // reference in another relationship would name a method outside verificationMethod.
  const verificationMethod: DidVerificationMethod[] = opts.embedInvocationKey ? [] : [initial];
  const relationships: Record<string, Array<string | DidVerificationMethod>> = opts.embedInvocationKey
    ? { capabilityInvocation: [initial] }
    : {
      authentication       : [initial.id],
      assertionMethod      : [initial.id],
      capabilityInvocation : [initial.id],
      capabilityDelegation : [initial.id],
    };
  for (const extra of opts.verificationMethods ?? []) {
    const kp = keys.get(extra.key);
    if (!kp) throw new Error(`Genesis method ${extra.id} names an unknown key "${extra.key}"`);
    const vm = multikeyMethod(`${idPrefix}${extra.id}`, controller, kp.publicKey.compressed);
    verificationMethod.push(vm);
    for (const rel of extra.relationships) relationships[rel]!.push(vm.id);
  }

  const service = [...buildServices(scenario.beacons, keys.get('genesis')!.publicKey.compressed, scenario.network, idPrefix), ...extraServices];
  const document = GenesisDocument.create(verificationMethod, relationships as never, service);
  const json = JSON.stringify(document);
  return JSON.parse(opts.relativeIds ? json.replaceAll(`"${ID_PLACEHOLDER_VALUE}#`, '"#') : json) as object;
}

// ─── Identifier tampers ──────────────────────────────────────────────────────

function tamperIdentifier(did: string, kind: IdentifierTamper, genesisBytes: Uint8Array, hrp: 'k' | 'x'): string {
  const encoded = did.split(':')[2]!;
  switch (kind) {
    case 'checksum': {
      const last = encoded.at(-1);
      return `did:btcr2:${encoded.slice(0, -1)}${last === 'q' ? 'p' : 'q'}`;
    }
    case 'padding': {
      const { prefix, words } = bech32m.decode(encoded as `${string}1${string}`, 200);
      const next = [...words];
      next[next.length - 1] = next[next.length - 1]! | 1;
      return `did:btcr2:${bech32m.encode(prefix, next, 200)}`;
    }
    case 'network-nibble': {
      // 6 to 11 are reserved network values. A custom value (12 to 15) would not do:
      // an implementation may support a custom network, and then the vector passes.
      return `did:btcr2:${bech32m.encodeFromBytes(hrp, new Uint8Array([0x06, ...genesisBytes]))}`;
    }
  }
}

// ─── Patch templates ─────────────────────────────────────────────────────────

/**
 * Replace the template forms in a patch value:
 *   `$did`                  the DID
 *   `$address(name,kind)`   the address of extra key `name` (kind p2pkh, p2wpkh, or p2tr)
 *   `$multibase(name)`      the publicKeyMultibase of extra key `name`
 */
function substitute(value: unknown, ctx: { did: string; keys: Map<string, SchnorrKeyPair>; registry: Map<string, string>; net: VectorNetwork }): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll('$did', ctx.did)
      .replace(/\$address\(([^,)]+),([^)]+)\)/g, (_m, name: string, kind: string) => {
        const kp = ctx.keys.get(name.trim());
        if (!kp) throw new Error(`$address names an unknown key "${name}"`);
        const address = addressOf(kp.publicKey.compressed, kind.trim() as AddrType, ctx.net);
        ctx.registry.set(address, name.trim());
        return address;
      })
      .replace(/\$multibase\(([^)]+)\)/g, (_m, name: string) => {
        const kp = ctx.keys.get(name.trim());
        if (!kp) throw new Error(`$multibase names an unknown key "${name}"`);
        return kp.publicKey.multibase.encoded;
      });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, ctx)]));
  }
  return value;
}

// ─── Update construction and tampers ─────────────────────────────────────────

/** `Updater.construct` without the strict checks, for a patch that is invalid on purpose. */
function constructLenient(sourceDocument: Btcr2DidDocument, patches: PatchOperation[], sourceVersionId: number): UnsignedBTCR2Update {
  let target: object = sourceDocument;
  try {
    target = JSONPatch.apply(sourceDocument, patches) as object;
  } catch {
    target = sourceDocument;
  }
  return {
    '@context'      : [ ...BTCR2_UPDATE_CONTEXT ],
    patch           : patches,
    sourceHash      : canonicalHash(sourceDocument),
    targetHash      : canonicalHash(target),
    targetVersionId : sourceVersionId + 1,
  };
}

function nowIso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Proof options that a tamper changes. `undefined` when the tamper does not touch the proof options. */
function proofOverrides(kind: TamperKind | undefined, did: string): Partial<Btcr2DataIntegrityConfig> | undefined {
  switch (kind) {
    case 'capability-action':        return { capabilityAction: 'Read' };
    case 'capability-encoding':      return { capability: `urn:zcap:root:${did}` };
    case 'proof-purpose':            return { proofPurpose: 'assertionMethod' };
    case 'created-after-block':      return { created: '2099-01-01T00:00:00Z' };
    case 'expires-before-mediantime': return { expires: '2020-01-01T00:00:00Z' };
    case 'expires-before-created':   return { created: nowIso(0), expires: nowIso(-1) };
    default:                         return undefined;
  }
}

/** Sign an update with explicit proof options (the tampers that change the options). */
function signWithConfig(
  did: string,
  unsigned: UnsignedBTCR2Update,
  vm: DidVerificationMethod,
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
    ...overrides,
  };
  return multikey.toCryptosuite().toDataIntegrityProof().addProof(unsigned, config) as SignedBTCR2Update;
}

/** The tampers that edit the update before the signature. */
function tamperUnsigned(u: UnsignedBTCR2Update, kind: TamperKind | undefined): void {
  switch (kind) {
    case 'source-hash':  u.sourceHash = u.targetHash; break;
    case 'target-hash':  u.targetHash = u.sourceHash; break;
    case 'version-skip': u.targetVersionId += 1; break;
    default: break;
  }
}

/** The tampers that edit the signed bytes after the signature. */
function tamperSigned(s: SignedBTCR2Update, kind: TamperKind | undefined): void {
  switch (kind) {
    case 'context-member':
      s['@context'] = [...s['@context'].slice(0, -1), 'https://btcr2.dev/context/v0'];
      break;
    case 'context-order':
      s['@context'] = [s['@context'][1]!, s['@context'][0]!, ...s['@context'].slice(2)];
      break;
    case 'proof-context':
      s.proof['@context'] = [...s['@context']].reverse();
      break;
    case 'proof-value': {
      const value = s.proof.proofValue as string;
      const last = value.at(-1);
      s.proof.proofValue = `${value.slice(0, -1)}${last === '1' ? '2' : '1'}`;
      break;
    }
    default: break;
  }
}

// ─── The scenario run ────────────────────────────────────────────────────────

function shortHash(did: string): string {
  return did.split(':')[2]!.slice(2, 10);
}

function absolutize(did: string, idOrFragment: string): string {
  return idOrFragment.startsWith('#') ? `${did}${idOrFragment}` : idOrFragment;
}

function fragmentOf(id: string): string {
  return id.slice(id.indexOf('#'));
}

function runScenario(scenario: Scenario, cohorts: CohortDef[]): void {
  console.log(`\n[scenario] ${scenario.id} (${scenario.network})`);
  console.log(`  ${scenario.description}`);

  const cohort = findCohort(scenario.id, cohorts);
  if (cohort && scenario.idType !== 'EXTERNAL') {
    throw new Error(`Cohort member "${scenario.id}" must be idType EXTERNAL; its shared beacon lives in the genesis document.`);
  }
  const cohortService = cohort ? buildCohortService(cohort) : undefined;
  if (cohort) console.log(`  cohort: ${cohort.id} (${cohort.beaconType}) at ${cohortService!.serviceEndpoint.slice('bitcoin:'.length)}`);

  const keys = loadKeys(scenario);
  const registry = new Map<string, string>();
  for (const [name, kp] of keys) registerKey(registry, name, kp, scenario.network);
  const genesisKp = keys.get('genesis')!;
  const publicKey = genesisKp.publicKey.compressed;

  const other: OtherFile = {
    scenarioId  : scenario.id,
    genesisKeys : { secret: hex.encode(genesisKp.secretKey.bytes), public: hex.encode(publicKey) },
  };
  const extraKeys = [...keys].filter(([name]) => name !== 'genesis');
  if (extraKeys.length > 0) {
    other.extraKeys = Object.fromEntries(extraKeys.map(([name, kp]) => [
      name, { secret: hex.encode(kp.secretKey.bytes), public: hex.encode(kp.publicKey.compressed) },
    ]));
  }

  // The genesis bytes: the public key (KEY) or the hash of the genesis document (EXTERNAL).
  let genesisBytes: Uint8Array;
  let genesisDocument: object | undefined;
  let sidecarGenesis: object | undefined;
  if (scenario.idType === 'KEY') {
    genesisBytes = publicKey;
  } else {
    genesisDocument = buildGenesisDocument(scenario, keys, cohortService ? [cohortService] : []);
    genesisBytes = GenesisDocument.toGenesisBytes(genesisDocument);
    sidecarGenesis = genesisDocument;
    if (scenario.genesis?.tamper === 'hash-mismatch') {
      // The sidecar carries a document that does not hash to the genesis bytes.
      const copy = JSON.parse(JSON.stringify(genesisDocument)) as { service: object[] };
      copy.service = [...copy.service, {
        id              : `${ID_PLACEHOLDER_VALUE}#didcomm`,
        type            : 'DIDCommMessaging',
        serviceEndpoint : 'http://example.com/didcomm',
      }];
      sidecarGenesis = copy;
    }
    other.genesisDocument = sidecarGenesis;
  }

  const did = DidBtcr2.create(genesisBytes, { idType: scenario.idType, network: scenario.network });
  const hrp = scenario.idType === 'KEY' ? 'k' : 'x';
  const resolveDid = scenario.identifier ? tamperIdentifier(did, scenario.identifier.tamper, genesisBytes, hrp) : did;
  const hash = shortHash(resolveDid);
  const outDir = join(networkDataDir(scenario.network), `${hrp}1`, hash);
  console.log(`  DID:        ${did}`);
  if (resolveDid !== did) console.log(`  resolve as: ${resolveDid} (${scenario.identifier!.tamper})`);
  console.log(`  output dir: ${outDir}`);

  writeJSON(join(outDir, 'other.json'), other);
  writeJSON(join(outDir, 'create', 'input.json'), {
    idType       : scenario.idType,
    version      : 1,
    network      : scenario.network,
    genesisBytes : hex.encode(genesisBytes),
  });
  writeJSON(join(outDir, 'create', 'output.json'), { did });

  // The initial document, in pure-data mode.
  const components = Identifier.decode(did);
  const baseDocument = (scenario.idType === 'KEY'
    ? Resolver.deterministic(components)
    : Resolver.external(components, genesisDocument!)) as unknown as Btcr2DidDocument;

  // Every update signs against the document of its source version. A tampered or
  // forked update does not advance the document, and neither does an update that
  // a resolver ignores (removedBeacon). A duplicate entry signs nothing: it anchors
  // the signed update of an earlier entry again.
  const documents: Btcr2DidDocument[] = [baseDocument];  // documents[v - 1] is version v
  let currentDocument = baseDocument;
  let currentVersion = 1;
  let previousSource: { document: Btcr2DidDocument; version: number } | undefined;
  const signedUpdates: SignedBTCR2Update[] = [];
  const anchors: AnchorEntry[] = [];
  const count = scenario.updates.length;
  const realCount = realUpdates(scenario).length;
  const ordinalOfEntry = new Map<number, number>();  // entry number -> update directory number

  /** The anchor of an entry: the beacon `beaconId` of `document`, signed by the key of its address. */
  const anchorAt = (document: Btcr2DidDocument, beaconId: string, stepNum: number, signalOf: number): AnchorEntry => {
    const service = (document.service ?? []).find((s) => absolutize(did, s.id) === beaconId);
    if (!service) throw new Error(`${scenario.id} entry ${stepNum}: beacon ${beaconId} is not in the document`);
    const address = String(service.serviceEndpoint).slice('bitcoin:'.length);
    const key = registry.get(address);
    if (!key) throw new Error(`${scenario.id} entry ${stepNum}: no key for beacon address ${address}`);
    return { update: stepNum, signalOf, beaconId, address, kind: kindOfAddress(address, scenario.network), key };
  };

  for (let i = 0; i < count; i++) {
    const entry = scenario.updates[i]!;
    const stepNum = i + 1;

    if (isDuplicate(entry)) {
      const signalOf = ordinalOfEntry.get(entry.duplicateOf);
      if (!signalOf) throw new Error(`${scenario.id} entry ${stepNum}: duplicateOf must name an earlier update entry, got ${entry.duplicateOf}`);
      if (cohort) throw new Error(`${scenario.id} entry ${stepNum}: a duplicate entry needs a solo scenario`);
      const beaconId = absolutize(did, entry.beaconId);
      anchors.push({ ...anchorAt(currentDocument, beaconId, stepNum, signalOf), duplicateOf: entry.duplicateOf });
      console.log(`  [entry ${stepNum}/${count}] announces update ${entry.duplicateOf} again at beacon=${fragmentOf(beaconId)}`);
      continue;
    }

    const u: ScenarioUpdate = entry;
    const ordinal = ordinalOfEntry.size + 1;
    ordinalOfEntry.set(stepNum, ordinal);
    const source = u.fork && previousSource ? previousSource : { document: currentDocument, version: currentVersion };
    const patches = substitute(u.patches, { did, keys, registry, net: scenario.network }) as PatchOperation[];
    // An unknown method names a fragment that the document does not contain.
    const vmId = u.tamper === 'unknown-method' ? `${did}#unknown` : absolutize(did, u.verificationMethodId);
    const beaconId = absolutize(did, u.beaconId);

    // The signing method and the signer.
    const vm: DidVerificationMethod = u.tamper === 'unknown-method'
      ? multikeyMethod(vmId, did, publicKey)
      : DidBtcr2.getSigningMethod(source.document, vmId);
    const signerKp = u.signWith
      ? keys.get(u.signWith)
      : [...keys.values()].find((kp) => kp.publicKey.multibase.encoded === vm.publicKeyMultibase);
    if (!signerKp) throw new Error(`${scenario.id} update ${stepNum}: no key for ${u.signWith ?? vmId}`);
    const signer = new LocalSigner(signerKp.secretKey.bytes);

    // Construct, tamper, sign, tamper.
    const unsigned = u.tamper === 'invalid-patch'
      ? constructLenient(source.document, patches, source.version)
      : Updater.construct(source.document, patches, source.version);
    tamperUnsigned(unsigned, u.tamper);
    const overrides = proofOverrides(u.tamper, did);
    const signed = overrides
      ? signWithConfig(did, unsigned, vm, signer, overrides)
      : Updater.sign(did, unsigned, vm, signer);
    tamperSigned(signed, u.tamper);

    const flags = [u.fork && 'fork', u.tamper, u.withhold && 'withhold', u.removedBeacon && 'removedBeacon', u.signWith && `signWith=${u.signWith}`].filter(Boolean).join(' ');
    console.log(`  [update ${stepNum}/${count}] v${source.version} -> v${unsigned.targetVersionId} vm=${fragmentOf(vmId)} beacon=${fragmentOf(beaconId)} ${u.delivery}${flags ? ` (${flags})` : ''}`);

    const dir = updateDir(outDir, realCount, ordinal);
    writeJSON(join(dir, 'input.json'), {
      sourceDocument       : source.document,
      patches,
      sourceVersionId      : source.version,
      verificationMethodId : vmId,
      beaconId,
      signingMaterial      : hex.encode(signerKp.secretKey.bytes),
    });
    writeJSON(join(dir, 'output.json'), { signedUpdate: signed });

    // The anchor of a solo scenario: the beacon of the source document at beaconId.
    // With removedBeacon, the beacon of the genesis document: an earlier update
    // removed it, so the source document must not carry it.
    if (!cohort) {
      const inSource = (source.document.service ?? []).some((s) => absolutize(did, s.id) === beaconId);
      if (u.removedBeacon && inSource) {
        throw new Error(`${scenario.id} update ${stepNum}: removedBeacon is set, but the source document still carries ${beaconId}`);
      }
      anchors.push(anchorAt(u.removedBeacon ? baseDocument : source.document, beaconId, stepNum, ordinal));
    }

    if (!u.withhold) signedUpdates.push(signed);

    // A valid update advances the document. A resolver applies no update after a
    // deactivation, so an update that follows one is signed and anchored but does
    // not advance the expected document. A resolver ignores the signal of a
    // removed beacon address, so that update does not advance it either.
    previousSource = source;
    const deactivatedNow = (currentDocument as { deactivated?: boolean }).deactivated === true;
    if (!u.tamper && !u.fork && !deactivatedNow && !u.removedBeacon) {
      currentDocument = JSONPatch.apply(source.document, patches, { strict: true }) as Btcr2DidDocument;
      currentVersion = unsigned.targetVersionId;
      documents[currentVersion - 1] = currentDocument;
    }
  }

  // The resolve input and the expected result.
  const sidecar: Record<string, unknown> = {};
  if (sidecarGenesis) sidecar.genesisDocument = sidecarGenesis;
  if (signedUpdates.length > 0) sidecar.updates = signedUpdates;
  const sidecarOptions = Object.keys(sidecar).length === 0 ? {} : { sidecar };

  const deactivated = (currentDocument as { deactivated?: boolean }).deactivated === true;
  writeJSON(join(outDir, 'resolve', 'input.json'), { did: resolveDid, resolutionOptions: sidecarOptions });
  writeJSON(join(outDir, 'resolve', 'output.json'), scenario.expect
    ? errorEnvelope(scenario.expect.error)
    : okEnvelope(currentDocument, currentVersion, deactivated));

  for (const c of scenario.resolves ?? []) {
    const dir = resolveCaseDir(outDir, c.id);
    writeJSON(join(dir, 'input.json'), { did: resolveDid, resolutionOptions: { ...sidecarOptions, ...c.options } });
    if ('error' in c.expect) {
      writeJSON(join(dir, 'output.json'), errorEnvelope(c.expect.error));
    } else {
      const v = Number(c.expect.versionId);
      const doc = documents[v - 1];
      if (!doc) throw new Error(`${scenario.id} resolve case ${c.id}: version ${v} does not exist`);
      writeJSON(join(dir, 'output.json'), okEnvelope(doc, v, (doc as { deactivated?: boolean }).deactivated === true));
    }
    console.log(`  [resolve ${c.id}] ${JSON.stringify(c.options)} -> ${JSON.stringify(c.expect)}`);
  }

  // The pipeline state: every address that carries an anchor, and every beacon of the DID.
  const services = [...buildServices(scenario.beacons, publicKey, scenario.network, ID_PLACEHOLDER_VALUE), ...(cohortService ? [cohortService] : [])];
  const state: ScenarioState = {
    scenarioId   : scenario.id,
    network      : scenario.network,
    did,
    needsFunding : anchors.length > 0 || (cohort !== undefined && count > 0),
    cohort       : cohort ? cohort.id : null,
    anchors,
    allBeacons   : services.map((s) => ({
      id      : s.id.replace(ID_PLACEHOLDER_VALUE, did),
      type    : s.type,
      address : String(s.serviceEndpoint).slice('bitcoin:'.length),
    })),
  };
  writeState(state);

  const expectText = scenario.expect ? `error ${scenario.expect.error}` : `versionId ${currentVersion}${deactivated ? ' deactivated' : ''}`;
  console.log(`[scenario] ${scenario.id} done: hash=${hash} expect ${expectText}${anchors.length ? `, ${anchors.length} anchor(s)` : ''}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const recipes = loadRecipes(network);
const cohorts = loadCohorts(network);
const selected = onlyIds.length > 0
  ? onlyIds.map((id) => {
    const r = recipes.get(id);
    if (!r) throw new Error(`No recipe "${id}" in lib/scenarios/${network}/`);
    return r;
  })
  : [...recipes.values()];

if (clean) {
  for (const dir of [join(networkDataDir(network), 'k1'), join(networkDataDir(network), 'x1'), stateDir(network)]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`[clean] removed ${dir}`);
    }
  }
}

let failed = 0;
for (const scenario of selected) {
  try {
    runScenario(scenario, cohorts);
  } catch (e) {
    failed++;
    console.log(`[scenario] ${scenario.id} FAILED: ${(e as Error).message}`);
  }
}
console.log(`\n=== generated ${selected.length - failed}/${selected.length} scenarios on ${network} ===`);
if (failed === 0) console.log(`  Next: pnpm scenario:artifacts --network ${network}`);
process.exit(failed ? 1 : 0);
