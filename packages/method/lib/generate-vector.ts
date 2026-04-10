import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';

import { BitcoinConnection, getNetwork } from '@did-btcr2/bitcoin';
import type { PatchOperation } from '@did-btcr2/common';
import { canonicalize } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2';
import { hex } from '@scure/base';
import { payments } from 'bitcoinjs-lib';

import { BeaconSignalDiscovery } from '../src/core/beacon/signal-discovery.js';
import { Identifier } from '../src/core/identifier.js';
import { Resolver } from '../src/core/resolver.js';
import { Update } from '../src/core/update.js';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { GenesisDocument } from '../src/utils/did-document.js';

/**
 * Test Vector Generator CLI
 *
 * Incrementally generates did:btcr2 test vectors through a stepped workflow:
 *   create → update (--offline) → fund → announce → resolve
 *
 * Each step reads output from the previous step and produces its own
 * input/output JSON files under lib/data/{network}/{type}/{hash}/.
 *
 * Usage:
 *   pnpm generate:vector create [--type key|external] [--network regtest] [--genesis <hex>]
 *   pnpm generate:vector update --hash <hash> [--interactive] [--offline]
 *   pnpm generate:vector fund --hash <hash> [--amount <btc>]
 *   pnpm generate:vector announce --hash <hash>
 *   pnpm generate:vector resolve --hash <hash> [--offline]
 *   pnpm generate:vector list [--network <net>] [--type key|external]
 */
const ACTIONS = ['create', 'update', 'fund', 'announce', 'resolve', 'list'] as const;
type Action = typeof ACTIONS[number];

const args = process.argv.slice(2);

// The first positional argument is the action (not a --flag)
const action = (ACTIONS as readonly string[]).includes(args[0]) ? args[0] as Action : null;

/**
 * Reads a named CLI flag value (e.g. --hash abc123).
 *
 * @param {string} name The flag name without the leading --.
 * @param {string} fallback Default value if the flag is not present.
 * @returns {string} The flag value or fallback.
 */
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

/** Checks whether a boolean flag is present in the CLI args. */
const hasFlag = (name: string) => args.includes(`--${name}`);

let hashArg = flag('hash', '');
const interactive = hasFlag('interactive');
const offline = hasFlag('offline');

// These flags are only relevant during the create step.
// All other steps derive the type and network from the stored DID.
const createType = flag('type', 'key').toLowerCase() === 'external' ? 'EXTERNAL' : 'KEY';
const createNetwork = flag('network', 'regtest');
const createGenesis = flag('genesis', '');

/** Prints usage information and exits. */
function printHelp(): never {
  console.log(`
  did:btcr2 Test Vector Generator

  Usage:
    pnpm generate:vector <action> [options]

  Actions:
    create          Create a new DID and initial test vector files
    update          Construct, sign, and announce an update to a live Bitcoin node
    fund            Fund a beacon address via RPC sendtoaddress + mine a block
    announce        Announce a previously created update (retry a failed announcement)
    resolve         Resolve a DID against a live Bitcoin node
    list            Show existing test vectors

  Options:
    --type <key|external>   Identifier type (create and list only, default: key)
    --network <name>        Bitcoin network name (create and list only, default: regtest)
    --genesis <hex>         Genesis bytes hex: pubkey for key, sha256 hash for external (create only)
    --hash <hash>           8-character short hash of target vector (update, fund, announce, resolve)
    --interactive           Enable interactive patch builder (update only)
    --amount <btc>          BTC amount to send (fund only, default: 0.001)
    --offline               Skip on-chain announcement (update) or live resolution (resolve)

  Examples:
    pnpm generate:vector create
    pnpm generate:vector create --type external --network mutinynet
    pnpm generate:vector update --hash q5ps09nu
    pnpm generate:vector update --hash q5ps09nu --interactive
    pnpm generate:vector update --hash q5ps09nu --offline
    pnpm generate:vector fund --hash q5ps09nu
    pnpm generate:vector fund --hash q5ps09nu --amount 0.01
    pnpm generate:vector announce --hash q5ps09nu
    pnpm generate:vector resolve --hash q5ps09nu
    pnpm generate:vector resolve --hash q5ps09nu --offline
    pnpm generate:vector list
    pnpm generate:vector list --network regtest --type key
`);
  process.exit(0);
}

/** Root directory for all generated test vector data. */
const DATA_DIR = join(import.meta.dirname, 'data');

/**
 * Extracts an 8-character short hash from a did:btcr2 identifier.
 * The short hash is a truncated slice of the Bech32m-encoded id-value,
 * used as the directory name for a vector's data files.
 *
 * @param {string} did A did:btcr2 identifier string.
 * @returns {string} The 8-character short hash.
 */
function shortHash(did: string): string {
  return did.split(':')[2].slice(2, 10);
}

/**
 * Serializes data as formatted JSON and writes it to disk.
 * Creates parent directories if they do not exist.
 *
 * @param {string} dir Directory path to write into.
 * @param {string} filename Name of the JSON file.
 * @param {unknown} data The data to serialize.
 */
function writeJSON(dir: string, filename: string, data: unknown): void {
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 4) + '\n');
  console.log(`  wrote ${filepath}`);
}

/**
 * Reads and parses a JSON file from disk.
 *
 * @param {string} filepath Absolute path to the JSON file.
 * @returns {any} The parsed JSON content.
 * @throws {SyntaxError} If the file content is not valid JSON.
 */
function readJSON(filepath: string): any {
  return JSON.parse(readFileSync(filepath, 'utf-8'));
}

/**
 * Extracts the secret and public key hex strings from a SchnorrKeyPair.
 *
 * @param {SchnorrKeyPair} kp The keypair to extract hex values from.
 * @returns {{ secretHex: string; publicHex: string }} The hex-encoded key material.
 */
function keypairHex(kp: SchnorrKeyPair): { secretHex: string; publicHex: string } {
  const j = kp.exportJSON();
  return { secretHex: j.secretKey.hex!, publicHex: j.publicKey.hex };
}

/**
 * Reads and parses a JSON file, throwing if the file does not exist.
 * Used to enforce step ordering — a missing file means the previous step
 * has not been run yet.
 *
 * @param {string} filepath Absolute path to the required JSON file.
 * @returns {any} The parsed JSON content.
 * @throws {Error} If the file does not exist.
 */
function requireFile(filepath: string): any {
  if (!existsSync(filepath)) {
    throw new Error(`Required file not found: ${filepath}\n  Run the previous step first.`);
  }
  return readJSON(filepath);
}

/**
 * Metadata derived from an existing vector's create/output.json.
 * Provides the DID, its decoded components, and the on-disk directory path
 * so that subsequent steps can locate and extend the vector's data.
 *
 * @interface VectorContext
 */
interface VectorContext {
  /** Absolute path to the vector's root directory. */
  dir: string;
  /** The did:btcr2 identifier string. */
  did: string;
  /** Identifier type: "KEY" or "EXTERNAL". */
  idType: string;
  /** Bitcoin network name (e.g. "regtest", "bitcoin"). */
  network: string;
  /** Human-readable type prefix: "k1" or "x1". */
  typePrefix: string;
}

/**
 * Searches lib/data/ for a vector directory matching the given short hash.
 * Walks the directory tree: data/{network}/{type}/{hash}/ and checks for
 * the presence of create/output.json to confirm a valid vector.
 *
 * @param {string} hash The 8-character short hash to search for.
 * @returns {string} Absolute path to the matching vector directory.
 * @throws {Error} If no vector is found or the data directory does not exist.
 */
function findVectorDir(hash: string): string {
  if (!existsSync(DATA_DIR)) {
    throw new Error(`Data directory not found: ${DATA_DIR}`);
  }
  for (const net of readdirSync(DATA_DIR)) {
    const netDir = join(DATA_DIR, net);
    if (!statSync(netDir).isDirectory()) continue;
    for (const type of readdirSync(netDir)) {
      const candidate = join(netDir, type, hash);
      if (existsSync(join(candidate, 'create', 'output.json'))) {
        return candidate;
      }
    }
  }
  throw new Error(`No vector found for hash "${hash}". Run the create step first.`);
}

/**
 * Loads the vector context for a given short hash by reading the create
 * output and decoding the DID to extract the type and network.
 *
 * @param {string} hash The 8-character short hash identifying the vector.
 * @returns {VectorContext} The resolved vector context.
 */
function loadVectorContext(hash: string): VectorContext {
  const dir = findVectorDir(hash);
  const createOutput = requireFile(join(dir, 'create', 'output.json'));
  const did = createOutput.did;

  // Decode the DID to extract the identifier type and network
  const components = Identifier.decode(did);
  const typePrefix = components.idType === 'KEY' ? 'k1' : 'x1';

  return {
    dir,
    did,
    idType    : components.idType,
    network   : components.network as string,
    typePrefix,
  };
}



/**
 * Validates the BITCOIN_NETWORK_CONFIG environment variable and returns
 * a BitcoinConnection configured for the given network.
 * Required by the announce and resolve-live steps which interact with
 * a live Bitcoin node.
 *
 * @param {string} net The Bitcoin network name to connect to.
 * @returns {BitcoinConnection} A configured connection instance.
 */
function requireBitcoinConnection(net: string): BitcoinConnection {
  try {
    return BitcoinConnection.forNetwork(net as any, {rpc: { username: 'polaruser', password: 'polarpass' },});
  } catch (err: any) {
    console.error(`Error: Failed to connect to Bitcoin network "${net}".`);
    console.error(`  ${err.message}`);
    console.error(`\nEnsure BITCOIN_NETWORK_CONFIG contains a configuration for "${net}".`);
    process.exit(1);
  }
}



/** Supported Bitcoin address types for beacon service endpoints. */
type AddressType = 'p2pkh' | 'p2wpkh' | 'p2tr';

/**
 * Derives a Bitcoin address from a compressed public key.
 * Used when building beacon service objects for test vectors.
 *
 * @param {Uint8Array} publicKey The compressed secp256k1 public key bytes.
 * @param {string} net The Bitcoin network name (determines address prefix).
 * @param {AddressType} addrType The address type to derive.
 * @returns {string} The derived Bitcoin address.
 * @throws {Error} If the address derivation fails.
 */
function deriveAddress(publicKey: Uint8Array, net: string, addrType: AddressType): string {
  const btcNetwork = getNetwork(net);
  let address: string | undefined;

  switch (addrType) {
    case 'p2pkh':
      address = payments.p2pkh({ pubkey: Buffer.from(publicKey), network: btcNetwork }).address;
      break;
    case 'p2wpkh':
      address = payments.p2wpkh({ pubkey: Buffer.from(publicKey), network: btcNetwork }).address;
      break;
    case 'p2tr':
      // Taproot requires the 32-byte x-only internal pubkey (strip the 0x02/0x03 prefix byte)
      address = payments.p2tr({ network: btcNetwork, internalPubkey: Buffer.from(publicKey).slice(1, 33) }).address;
      break;
  }

  if (!address) throw new Error(`Failed to derive ${addrType} address`);
  return address;
}



/**
 * Shared state passed through interactive prompts during the update step.
 * Tracks the DID context and accumulates any keypairs generated during
 * the interactive session for later storage in other.json.
 *
 * @interface InteractiveContext
 */
interface InteractiveContext {
  did: string;
  idType: string;
  network: string;
  sourceDocument: any;
  generatedKeys: Array<{ label: string; secretHex: string; publicHex: string }>;
}

/** Checks if a JSON Pointer targets a service array element (e.g. /service/0). */
function isServicePath(path: string): boolean {
  return /^\/service\/\d+$/.test(path);
}

/** Checks if a JSON Pointer targets a verificationMethod array element. */
function isVmPath(path: string): boolean {
  return /^\/verificationMethod\/\d+$/.test(path);
}

/**
 * Prompts the user for a public key or auto-generates a new keypair.
 * The resulting key material is stored in the interactive context
 * for later persistence to other.json.
 *
 * @param {readline.Interface} rl The readline interface for user input.
 * @param {InteractiveContext} ctx The current interactive session context.
 * @param {string} label A descriptive label for storing the keypair.
 * @returns {Promise<SchnorrKeyPair>} The user-provided or auto-generated keypair.
 */
async function promptForKeypair(
  rl: readline.Interface,
  ctx: InteractiveContext,
  label: string
): Promise<SchnorrKeyPair> {
  const pubkeyInput = await rl.question('  pubkey hex (leave empty to auto-generate): ');

  // If the user provides a public key, create a keypair from it (no secret key)
  if (pubkeyInput.trim()) {
    const pubkeyBytes = hex.decode(pubkeyInput.trim());
    const kp = new SchnorrKeyPair({ publicKey: pubkeyBytes });
    ctx.generatedKeys.push({ label, secretHex: '', publicHex: pubkeyInput.trim() });
    console.log(`  User-provided pubkey (stored as "${label}" — fill in secretKey if needed)`);
    return kp;
  }

  // Otherwise generate a fresh keypair and store both halves
  const kp = SchnorrKeyPair.generate();
  const { secretHex, publicHex } = keypairHex(kp);
  ctx.generatedKeys.push({ label, secretHex, publicHex });
  console.log(`  Auto-generated keypair (stored as "${label}")`);
  return kp;
}

/**
 * Builds a SingletonBeacon service object by prompting for address type
 * and public key. Derives the Bitcoin address and assembles the service
 * entry conformant to the did:btcr2 beacon service format.
 *
 * @param {readline.Interface} rl The readline interface for user input.
 * @param {InteractiveContext} ctx The current interactive session context.
 * @param {string} path The JSON Pointer path being patched (e.g. /service/0).
 * @returns {Promise<unknown>} The assembled service object.
 */
async function buildServiceValue(
  rl: readline.Interface,
  ctx: InteractiveContext,
  path: string
): Promise<unknown> {
  const addrTypeRaw = await rl.question('  address type (p2pkh | p2wpkh | p2tr) [p2pkh]: ');
  const addrType = (['p2pkh', 'p2wpkh', 'p2tr'].includes(addrTypeRaw) ? addrTypeRaw : 'p2pkh') as AddressType;

  // Default fragment follows naming conventions per identifier type
  const serviceIdx = path.split('/').pop()!;
  const defaultFragment = ctx.idType === 'KEY'
    ? `initial${addrType.toUpperCase()}`
    : `service-${serviceIdx}`;

  const idInput = await rl.question(`  id fragment (e.g. "additionalP2PKH" or "#additionalP2PKH") [${defaultFragment}]: `);
  const fragment = idInput.trim()
    ? idInput.trim().replace(/^#/, '')
    : defaultFragment;

  const label = `service${path.replace(/\//g, '-')}`;
  const kp = await promptForKeypair(rl, ctx, label);
  const address = deriveAddress(kp.publicKey.compressed, ctx.network, addrType);

  return {
    id              : `${ctx.did}#${fragment}`,
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${address}`,
  };
}

/**
 * Collects the full id URIs of all existing verification methods
 * in a DID document.
 *
 * @param {any} sourceDocument The DID document to inspect.
 * @returns {string[]} Array of verification method id strings.
 */
function getExistingVmIds(sourceDocument: any): string[] {
  return (sourceDocument.verificationMethod ?? []).map((vm: any) => vm.id as string);
}

/**
 * Generates the next available verification method fragment id
 * by incrementing from key-1 until an unused id is found.
 *
 * @param {any} sourceDocument The DID document to check against.
 * @returns {string} The next available fragment (e.g. "key-1", "key-2").
 */
function autoVmFragment(sourceDocument: any): string {
  const existing = getExistingVmIds(sourceDocument);
  for (let i = 1; ; i++) {
    const candidate = `key-${i}`;
    const full = `${sourceDocument.id}#${candidate}`;
    if (!existing.includes(full)) return candidate;
  }
}

/**
 * Builds a Multikey verification method object by prompting for an id
 * fragment and public key. Checks for id collisions against existing
 * verification methods in the source document.
 *
 * @param {readline.Interface} rl The readline interface for user input.
 * @param {InteractiveContext} ctx The current interactive session context.
 * @param {string} path The JSON Pointer path being patched.
 * @returns {Promise<unknown>} The assembled verification method object.
 */
async function buildVmValue(
  rl: readline.Interface,
  ctx: InteractiveContext,
  path: string
): Promise<unknown> {
  const existing = getExistingVmIds(ctx.sourceDocument);
  const defaultFragment = autoVmFragment(ctx.sourceDocument);

  const idInput = await rl.question(`  id fragment (e.g. "someNewId" or "#someNewId") [${defaultFragment}]: `);

  // Strip leading # if present, fall back to auto-generated fragment
  const fragment = idInput.trim()
    ? idInput.trim().replace(/^#/, '')
    : defaultFragment;
  const fullId = `${ctx.did}#${fragment}`;

  // Prevent duplicate verification method ids
  if (existing.includes(fullId)) {
    console.log(`  Warning: "${fullId}" already exists in the source document. Choose a different id.`);
    return buildVmValue(rl, ctx, path);
  }

  const label = `verificationMethod-${fragment}`;
  const kp = await promptForKeypair(rl, ctx, label);

  return {
    id                 : fullId,
    type               : 'Multikey',
    controller         : ctx.did,
    publicKeyMultibase : kp.multibase.publicKeyMultibase,
  };
}



/**
 * Walks the user through building an array of JSON Patch (RFC 6902) operations.
 * Detects when the target path is a service or verificationMethod and
 * auto-generates the patch value using {@link buildServiceValue} or
 * {@link buildVmValue} respectively.
 *
 * @param {readline.Interface} rl The readline interface for user input.
 * @param {InteractiveContext} ctx The current interactive session context.
 * @returns {Promise<PatchOperation[]>} The array of patch operations built interactively.
 */
async function buildPatchesInteractively(
  rl: readline.Interface,
  ctx: InteractiveContext
): Promise<PatchOperation[]> {
  const patches: PatchOperation[] = [];
  let adding = true;

  while (adding) {
    console.log('\n--- Add a JSON Patch operation ---');

    const op = await rl.question('  op (add | replace | remove | move | copy | test): ');
    const path = await rl.question('  path (JSON Pointer, e.g. /service/0): ');

    let patch: PatchOperation;

    if (op === 'remove') {
      // Remove operations have no value
      patch = { op, path } as PatchOperation;
    } else if (op === 'move' || op === 'copy') {
      // Move and copy require a source path
      const from = await rl.question('  from (JSON Pointer): ');
      patch = { op, path, from } as PatchOperation;
    } else if ((op === 'add' || op === 'replace') && isServicePath(path)) {
      // Auto-generate beacon service value when targeting a service path
      console.log('  Detected service patch — auto-generating value.');
      const value = await buildServiceValue(rl, ctx, path);
      patch = { op, path, value } as PatchOperation;
    } else if ((op === 'add' || op === 'replace') && isVmPath(path)) {
      // Auto-generate verification method value when targeting a VM path
      console.log('  Detected verificationMethod patch — auto-generating value.');
      const value = await buildVmValue(rl, ctx, path);
      patch = { op, path, value } as PatchOperation;
    } else {
      // For all other paths, prompt for a raw JSON value
      const raw = await rl.question('  value (JSON): ');
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        console.log('  Invalid JSON — using raw string as value.');
        value = raw;
      }
      patch = { op, path, value } as PatchOperation;
    }

    patches.push(patch);
    console.log(`  Added: ${JSON.stringify(patch)}`);

    const more = await rl.question('  Add another patch? (y/N): ');
    adding = more.toLowerCase() === 'y';
  }

  return patches;
}

/**
 * Builds a default non-interactive patch that rotates the SingletonBeacon
 * service endpoint to a new P2PKH address. Used when --interactive is not
 * specified to provide a minimal valid update for testing.
 *
 * @param {any} sourceDocument The source DID document containing the beacon service.
 * @param {string} net The Bitcoin network name for address derivation.
 * @returns {{ patches: PatchOperation[]; newBeaconKeypair: SchnorrKeyPair }} The patch operations and the new beacon keypair.
 * @throws {Error} If no SingletonBeacon service is found in the source document.
 */
function defaultBeaconRotationPatch(
  sourceDocument: any,
  net: string
): { patches: PatchOperation[]; newBeaconKeypair: SchnorrKeyPair } {
  const newBeaconKeypair = SchnorrKeyPair.generate();
  const newAddress = deriveAddress(newBeaconKeypair.publicKey.compressed, net, 'p2pkh');

  // Locate the first SingletonBeacon service in the document
  const serviceIdx = sourceDocument.service.findIndex(
    (s: any) => s.type === 'SingletonBeacon'
  );
  if (serviceIdx === -1) {
    throw new Error('No SingletonBeacon service found in source document');
  }

  const patches: PatchOperation[] = [
    {
      op    : 'replace',
      path  : `/service/${serviceIdx}/serviceEndpoint`,
      value : `bitcoin:${newAddress}`,
    } as PatchOperation
  ];

  return { patches, newBeaconKeypair };
}

/**
 * Creates a new did:btcr2 identifier and writes the initial test vector files.
 *
 * For k1 (KEY) identifiers, the genesis bytes are a compressed secp256k1
 * public key. For x1 (EXTERNAL) identifiers, the genesis bytes are the
 * SHA-256 hash of a genesis document.
 *
 * Writes: create/input.json, create/output.json, other.json
 */
async function stepCreate() {
  const idType = createType;
  const network = createNetwork;
  const typePrefix = idType === 'KEY' ? 'k1' : 'x1';

  console.log(`\n[create] type=${typePrefix} network=${network}\n`);

  let genesisBytes: Uint8Array;
  let genesisDocument: GenesisDocument | undefined;
  const other: Record<string, unknown> = {};

  if (idType === 'KEY') {
    // k1: genesis bytes are a compressed secp256k1 public key.
    // Accept via --genesis flag or prompt; auto-generate if empty.
    let genesisHexInput = createGenesis;

    if (!genesisHexInput) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      try {
        genesisHexInput = await rl.question('  pubkey hex (leave empty to auto-generate): ');
      } finally {
        rl.close();
      }
    }

    if (genesisHexInput.trim()) {
      // User provided a public key hex — validate it as a secp256k1 key
      const pubkeyBytes = hex.decode(genesisHexInput.trim());
      const kp = new SchnorrKeyPair({ publicKey: pubkeyBytes });
      genesisBytes = kp.publicKey.compressed;
      other.genesisKeys = { secret: '', public: genesisHexInput.trim() };
      console.log(`Using provided pubkey`);
      console.log(`  public:  ${genesisHexInput.trim()}`);
    } else {
      // Auto-generate a fresh keypair and use the compressed public key
      const kp = SchnorrKeyPair.generate();
      genesisBytes = kp.publicKey.compressed;
      const { secretHex, publicHex } = keypairHex(kp);
      other.genesisKeys = { secret: secretHex, public: publicHex };
      console.log(`Genesis keypair generated`);
      console.log(`  public:  ${publicHex}`);
    }
  } else {
    // x1: genesis bytes are the SHA-256 hash of a canonical genesis document.
    // Accept via --genesis flag or prompt; auto-generate if empty.
    let genesisHexInput = createGenesis;

    if (!genesisHexInput) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      try {
        console.log('  Provide a genesis document as JSON, or leave empty to auto-generate.');
        console.log('  Auto-generate will create a new keypair and default genesis document.\n');
        genesisHexInput = await rl.question('  genesis document JSON (leave empty to auto-generate): ');
      } finally {
        rl.close();
      }
    }

    if (genesisHexInput.trim()) {
      // Input could be a JSON genesis document or a raw hex hash string.
      // Try parsing as JSON first; fall back to treating it as hex bytes.
      try {
        const parsed = JSON.parse(genesisHexInput.trim());
        genesisDocument = GenesisDocument.fromJSON(parsed);
        genesisBytes = sha256(canonicalize(genesisDocument));
        other.genesisDocument = genesisDocument;
        console.log(`Using provided genesis document`);
        console.log(`  hash:  ${hex.encode(genesisBytes)}`);
      } catch {
        genesisBytes = hex.decode(genesisHexInput.trim());
        console.log(`Using provided genesis bytes`);
        console.log(`  hex:  ${genesisHexInput.trim()}`);
      }
    } else {
      // Auto-generate: create a keypair, build a default genesis document,
      // then canonicalize and hash it to produce the genesis bytes
      const kp = SchnorrKeyPair.generate();
      const { secretHex, publicHex } = keypairHex(kp);
      genesisDocument = GenesisDocument.fromPublicKey(kp.publicKey.compressed, network);
      genesisBytes = GenesisDocument.toGenesisBytes(genesisDocument);
      other.genesisKeys = { secret: secretHex, public: publicHex };
      other.genesisDocument = genesisDocument;
      console.log(`Genesis keypair and document generated`);
      console.log(`  public:  ${publicHex}`);
      console.log(`  hash:    ${hex.encode(genesisBytes)}`);
    }
  }

  // Encode the genesis bytes into a did:btcr2 identifier
  const did = DidBtcr2.create(genesisBytes, { idType, network });
  const hash = shortHash(did);
  const dir = join(DATA_DIR, network, typePrefix, hash);

  console.log(`DID created: ${did}`);
  console.log(`Short hash:  ${hash}`);

  // Write the create step's test vector files
  const genesisHex = hex.encode(genesisBytes);

  writeJSON(join(dir, 'create'), 'input.json', {
    idType       : idType === 'KEY' ? 'KEY' : 'EXTERNAL',
    version      : 1,
    network,
    genesisBytes : genesisHex,
  });

  writeJSON(join(dir, 'create'), 'output.json', { did });

  // other.json stores key material and genesis documents for reuse in later steps
  writeJSON(dir, 'other.json', other);

  console.log(`\n[create] done — hash: ${hash}`);
  console.log(`  Next: pnpm generate:vector update --hash ${hash} --offline`);
}

/**
 * Constructs, signs, and announces a BTCR2 update against an existing vector's DID.
 *
 * 1. Rebuilds the source DID document from the identifier components.
 * 2. Builds JSON Patch operations (interactively or via default beacon rotation).
 * 3. Signs the update using the genesis secret key and a Data Integrity proof.
 * 4. Writes the update step's test vector files.
 * 5. Announces the signed update to a live Bitcoin node via the beacon service.
 *
 * With --offline, steps 1-4 run but the on-chain announcement is skipped.
 *
 * Writes: update/input.json, update/output.json (and may update other.json)
 *
 * @param {string} hash The short hash of the vector to update. Defaults to --hash CLI arg.
 */
async function stepUpdate(hash: string = hashArg) {
  if (!hash) throw new Error('--hash is required for the update action');

  const { dir, did, idType, network, typePrefix } = loadVectorContext(hash);
  console.log(`\n[update] type=${typePrefix} network=${network} hash=${hash}\n`);

  const other = requireFile(join(dir, 'other.json'));
  const genesisSecretHex = other.genesisKeys.secret;

  // 1. Rebuild the source DID document from the identifier.
  //    k1 uses deterministic resolution; x1 requires the stored genesis document.
  const didComponents = Identifier.decode(did);
  let sourceDocument: any;

  if (idType === 'KEY') {
    sourceDocument = Resolver.deterministic(didComponents);
  } else {
    if (!other.genesisDocument) {
      throw new Error('other.json is missing genesisDocument (required for x1)');
    }
    sourceDocument = await Resolver.external(didComponents, other.genesisDocument);
  }

  console.log(`Source document rebuilt`);

  // 2. Build the JSON Patch operations to apply to the source document.
  //    Interactive mode prompts the user; default mode rotates the beacon key.
  let patches: PatchOperation[];
  let newBeaconKeypair: SchnorrKeyPair | undefined;
  const interactiveKeys: InteractiveContext['generatedKeys'] = [];

  if (interactive) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const ctx: InteractiveContext = { did, idType, network, sourceDocument, generatedKeys: interactiveKeys };
    try {
      patches = await buildPatchesInteractively(rl, ctx);
    } finally {
      rl.close();
    }
  } else {
    const result = defaultBeaconRotationPatch(sourceDocument, network);
    patches = result.patches;
    newBeaconKeypair = result.newBeaconKeypair;
    console.log(`Default patch: beacon key rotation`);
  }

  // 3. Sign the update with a Data Integrity proof using the genesis secret key.
  //    The verification method and beacon ids follow naming conventions per type.
  const vmId = idType === 'KEY' ? `${did}#initialKey` : `${did}#key-0`;
  const beaconId = idType === 'KEY' ? `${did}#initialP2PKH` : `${did}#service-0`;

  const verificationMethod = DidBtcr2.getSigningMethod(sourceDocument, vmId);
  const unsignedUpdate = Update.construct(sourceDocument, patches, 1);
  const signedUpdate = Update.sign(
    did,
    unsignedUpdate,
    verificationMethod,
    hex.decode(genesisSecretHex)
  );

  console.log(`Update signed (targetVersionId: ${signedUpdate.targetVersionId})`);

  // 4. Write the update step's test vector files
  writeJSON(join(dir, 'update'), 'input.json', {
    sourceDocument,
    patches,
    sourceVersionId      : 1,
    verificationMethodId : vmId,
    beaconId,
    signingMaterial      : genesisSecretHex,
  });

  writeJSON(join(dir, 'update'), 'output.json', { signedUpdate });

  // 5. Persist any newly generated keys to other.json for reuse in later steps
  let otherUpdated = false;

  if (newBeaconKeypair) {
    const { secretHex, publicHex } = keypairHex(newBeaconKeypair);
    other.newBeaconKeys = { secret: secretHex, public: publicHex };
    otherUpdated = true;
  }

  if (interactiveKeys.length > 0) {
    other.generatedKeys = other.generatedKeys ?? {};
    for (const key of interactiveKeys) {
      other.generatedKeys[key.label] = { secret: key.secretHex, public: key.publicHex };
    }
    otherUpdated = true;
  }

  if (otherUpdated) {
    writeJSON(dir, 'other.json', other);
  }

  // 6. Announce the signed update on-chain via the beacon service.
  //    Skipped with --offline.
  if (offline) {
    console.log(`\n[update] done (offline — announcement skipped)`);
    console.log(`  Next: pnpm generate:vector fund --hash ${hash}`);
    return;
  }

  await announceUpdate(dir, did, idType, network);

  console.log(`\n[update] done`);
  console.log(`  Next: pnpm generate:vector resolve --hash ${hash}`);
}

/**
 * Funds one or more beacon addresses for a vector's DID document via
 * RPC sendtoaddress, then mines a block to confirm the funding tx(s).
 *
 * Rebuilds the source DID document and extracts all beacon service
 * endpoints (bitcoin: URIs). For each, sends the specified BTC amount
 * from the node wallet and logs the funding txid.
 *
 * @param {string} [hash=hashArg] 8-character short hash of the target vector.
 */
async function stepFund(hash: string = hashArg) {
  if (!hash) throw new Error('--hash is required for the fund action');

  const { dir, did, idType, network } = loadVectorContext(hash);
  const amount = parseFloat(flag('amount', '0.001'));
  console.log(`\n[fund] network=${network} hash=${hash} amount=${amount} BTC\n`);

  // Rebuild the source document to locate beacon services
  const didComponents = Identifier.decode(did);
  let sourceDocument: any;

  if (idType === 'KEY') {
    sourceDocument = Resolver.deterministic(didComponents);
  } else {
    const other = requireFile(join(dir, 'other.json'));
    if (!other.genesisDocument) {
      throw new Error('other.json is missing genesisDocument (required for x1)');
    }
    sourceDocument = await Resolver.external(didComponents, other.genesisDocument);
  }

  // Find all beacon services with bitcoin: endpoints
  const beaconServices = (sourceDocument.service ?? [])
    .filter((s: any) => s.serviceEndpoint?.startsWith('bitcoin:'));

  if (beaconServices.length === 0) {
    throw new Error('No beacon services with bitcoin: endpoints found in the DID document');
  }

  const bitcoin = requireBitcoinConnection(network);

  if(!bitcoin.rpc) throw new Error('Bitcoin RPC client not initialized');

  for (const svc of beaconServices) {
    const address = svc.serviceEndpoint.replace('bitcoin:', '');
    console.log(`  Funding ${svc.id}`);
    console.log(`    address: ${address}`);
    const tx = await bitcoin.rpc.sendToAddress(address, amount);
    console.log(`    txid:    ${tx.txid}`);
  }

  // Mine a block so the funding tx(s) are confirmed (required by broadcastSignal's UTXO check)
  const minerAddress = await bitcoin.rpc.getNewAddress('bech32');
  const blocks = await bitcoin.rpc.generateToAddress(6, minerAddress);
  console.log(`\n  Mined block ${blocks[0]} to confirm funding tx(s)`);

  console.log(`\n[fund] done`);
  console.log(`  Next: pnpm generate:vector announce --hash ${hash}`);
}



/**
 * Reads a previously persisted signed update from disk and announces it
 * on-chain via the beacon service referenced in the update's input metadata.
 *
 * Shared by {@link stepUpdate} (live mode) and {@link stepAnnounce}.
 *
 * @param {string} dir   Absolute path to the vector's root directory.
 * @param {string} did   The did:btcr2 identifier string.
 * @param {string} idType Identifier type: "KEY" or "EXTERNAL".
 * @param {string} network Bitcoin network name.
 */
async function announceUpdate(
  dir: string,
  did: string,
  idType: string,
  network: string,
): Promise<void> {
  const { signedUpdate } = requireFile(join(dir, 'update', 'output.json'));
  const { beaconId, signingMaterial } = requireFile(join(dir, 'update', 'input.json'));

  // Rebuild the source document to locate the beacon service
  const didComponents = Identifier.decode(did);
  let sourceDocument: any;

  if (idType === 'KEY') {
    sourceDocument = Resolver.deterministic(didComponents);
  } else {
    const other = requireFile(join(dir, 'other.json'));
    if (!other.genesisDocument) {
      throw new Error('other.json is missing genesisDocument (required for x1)');
    }
    sourceDocument = await Resolver.external(didComponents, other.genesisDocument);
  }

  const beaconService = sourceDocument.service
    .find((s: any) => s.id === beaconId);

  if (!beaconService) {
    throw new Error(`No beacon service found matching beaconId "${beaconId}"`);
  }

  const bitcoin = requireBitcoinConnection(network);

  console.log(`\nAnnouncing update via beacon ...`);
  console.log(`  beacon:   ${beaconService.id}`);
  console.log(`  type:     ${beaconService.type}`);
  console.log(`  endpoint: ${beaconService.serviceEndpoint}`);

  const secretKey = hex.decode(signingMaterial);
  await Update.announce(beaconService, signedUpdate, secretKey, bitcoin);

  console.log(`Update announced to Bitcoin (${network})`);
}

/**
 * Announces a previously created (but unannounced) update on-chain.
 *
 * Reads the signed update and beacon metadata from the update step's
 * persisted files, then broadcasts via the beacon service.
 * Useful for retrying a failed announcement without re-running the
 * full update (construct + sign) pipeline.
 *
 * @param {string} [hash=hashArg] 8-character short hash of the target vector.
 */
async function stepAnnounce(hash: string = hashArg) {
  if (!hash) throw new Error('--hash is required for the announce action');

  const { dir, did, idType, network, typePrefix } = loadVectorContext(hash);
  console.log(`\n[announce] type=${typePrefix} network=${network} hash=${hash}\n`);

  await announceUpdate(dir, did, idType, network);

  console.log(`\n[announce] done`);
  console.log(`  Next: pnpm generate:vector resolve --hash ${hash}`);
}

/**
 * Resolves a DID and writes the resolution test vector files.
 *
 * By default, resolves against a live Bitcoin node by injecting a
 * BitcoinConnection driver into the resolution options.
 * With --offline, only builds the sidecar data (no Bitcoin connection required).
 *
 * If an update has been performed (update/output.json exists), the signed
 * update is included in the sidecar. Otherwise, resolution runs without
 * sidecar updates — resolving the DID in its initial state.
 *
 * For x1 (EXTERNAL) DIDs, the genesis document is always included in
 * the sidecar since it cannot be derived deterministically from the identifier.
 *
 * Writes: resolve/input.json, resolve/output.json (live mode only)
 *
 * @param {string} hash The short hash of the vector. Defaults to --hash CLI arg.
 */
async function stepResolve(hash: string = hashArg) {
  if (!hash) throw new Error('--hash is required for the resolve action');

  const { dir, did, idType, network } = loadVectorContext(hash);

  console.log(`\n[resolve] hash=${hash} mode=${offline ? 'offline' : 'live'}\n`);

  // Build the sidecar object. Include signed updates if the update step
  // has been run; otherwise resolve the DID in its initial state.
  const sidecar: Record<string, unknown> = {};
  const updateOutputPath = join(dir, 'update', 'output.json');

  if (existsSync(updateOutputPath)) {
    const updateOutput = readJSON(updateOutputPath);
    sidecar.updates = [updateOutput.signedUpdate];
    console.log(`Including signed update from update/output.json`);
  } else {
    console.log(`No update found — resolving initial DID state`);
  }

  // For x1 (EXTERNAL) DIDs, the genesis document must be included
  // since it cannot be derived deterministically from the identifier.
  if (idType === 'EXTERNAL') {
    const other = requireFile(join(dir, 'other.json'));
    if(other.genesisDocument) {
      sidecar.genesisDocument = other.genesisDocument;
    }
  }

  // Write the resolve input regardless of mode
  // writeJSON(join(dir, 'resolve'), 'input.json', {
  //   did,
  //   resolutionOptions : { sidecar },
  // });

  if (offline) {
    // Offline mode: only build the sidecar data, no live resolution
    console.log(`\n[resolve] done (offline — sidecar written)`);
    return;
  }

  // Live mode: create the Resolver state machine and drive it
  const bitcoin = requireBitcoinConnection(network);
  const resolver = DidBtcr2.resolve(did, { sidecar });

  console.log(`Resolving ${did} ...`);

  let state = resolver.resolve();
  while(state.status === 'action-required') {
    for(const need of state.needs) {
      switch(need.kind) {
        case 'NeedGenesisDocument':
          throw new Error(`Genesis document required but not in sidecar for ${did}`);

        case 'NeedBeaconSignals': {
          console.log(`  Fetching beacon signals for ${need.beaconServices.length} service(s) ...`);
          const signals = await BeaconSignalDiscovery.indexer(
            [...need.beaconServices], bitcoin
          );
          resolver.provide(need, signals);
          break;
        }

        case 'NeedCASAnnouncement':
          throw new Error(`CAS announcement not in sidecar: ${need.announcementHash}`);

        case 'NeedSignedUpdate':
          throw new Error(`Signed update not in sidecar: ${need.updateHash}`);
      }
    }
    state = resolver.resolve();
  }

  writeJSON(join(dir, 'resolve'), 'output.json', state.result);

  console.log(`\n[resolve] done`);
}

/**
 * Metadata for a single test vector discovered in lib/data/.
 *
 * @interface VectorEntry
 */
interface VectorEntry {
  /** Bitcoin network name (directory name under data/). */
  network: string;
  /** Identifier type prefix: "k1" or "x1". */
  type: string;
  /** 8-character short hash (directory name). */
  hash: string;
  /** The full did:btcr2 identifier. */
  did: string;
  /** Names of completed steps (e.g. ["create", "update"]). */
  steps: string[];
}

/**
 * Scans lib/data/ for all existing test vectors and returns their metadata.
 * Walks the directory tree: data/{network}/{type}/{hash}/ and checks for
 * step completion by the presence of output files.
 *
 * @returns {VectorEntry[]} Array of discovered vector entries, sorted by network and type.
 */
function listVectors(): VectorEntry[] {
  const entries: VectorEntry[] = [];
  if (!existsSync(DATA_DIR)) return entries;

  for (const net of readdirSync(DATA_DIR).sort()) {
    const netDir = join(DATA_DIR, net);
    if (!statSync(netDir).isDirectory()) continue;
    for (const type of readdirSync(netDir).sort()) {
      const typeDir = join(netDir, type);
      if (!statSync(typeDir).isDirectory()) continue;
      for (const hash of readdirSync(typeDir).sort()) {
        const hashDir = join(typeDir, hash);
        const outputFile = join(hashDir, 'create', 'output.json');
        if (!existsSync(outputFile)) continue;

        const did = readJSON(outputFile).did;

        // Determine which steps have been completed by checking for output files
        const steps: string[] = ['create'];
        if (existsSync(join(hashDir, 'update', 'output.json'))) steps.push('update');
        if (existsSync(join(hashDir, 'resolve', 'input.json'))) steps.push('resolve (offline)');
        if (existsSync(join(hashDir, 'resolve', 'output.json'))) steps.push('resolve (live)');

        entries.push({ network: net, type, hash, did, steps });
      }
    }
  }
  return entries;
}

/**
 * Displays a numbered list and prompts the user to select an item.
 *
 * @param {readline.Interface} rl The readline interface for user input.
 * @param {string} label The label to display above the list.
 * @param {string[]} items The items to display for selection.
 * @returns {Promise<string>} The user's raw input string.
 */
function pickFromList(rl: readline.Interface, label: string, items: string[]): Promise<string> {
  console.log(`\n  ${label}:`);
  items.forEach((item, i) => console.log(`    ${i + 1}) ${item}`));
  return rl.question(`  Select [1-${items.length}]: `);
}

/**
 * Selects an item from a list, prompting the user if more than one option exists.
 * Returns the selected item or null if the selection is invalid.
 *
 * @param {readline.Interface} rl The readline interface for user input.
 * @param {string} label The label to display above the list.
 * @param {string[]} items The items to choose from.
 * @returns {Promise<string | null>} The selected item, or null on invalid input.
 */
async function selectFromList(rl: readline.Interface, label: string, items: string[]): Promise<string | null> {
  if (items.length === 1) {
    console.log(`\n  ${label}: ${items[0]} (only one available)`);
    return items[0];
  }
  const choice = await pickFromList(rl, label, items);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= items.length) {
    console.error('  Invalid selection.');
    return null;
  }
  return items[idx];
}

/**
 * Lists available test vectors filtered by network and type.
 * Uses --network and --type flags if provided; prompts for any that
 * are missing. Displays each matching vector's hash, DID, and
 * completed steps.
 *
 * Usage:
 *   --step list                                    (prompts for network and type)
 *   --step list --network regtest                  (prompts for type)
 *   --step list --type key                         (prompts for network)
 *   --step list --network regtest --type key       (no prompts)
 */
async function stepList() {
  const allVectors = listVectors();

  if (allVectors.length === 0) {
    console.log('\nNo vectors found. Create one first:');
    console.log('  pnpm generate:vector create --type key --network regtest\n');
    return;
  }

  // Resolve network — use --network flag if provided, otherwise prompt
  const networkFlag = flag('network', '');
  const typeFlag = flag('type', '');
  const typePrefixFlag = typeFlag === 'external' ? 'x1' : typeFlag === 'key' ? 'k1' : '';

  let selectedNetwork = networkFlag;
  let selectedType = typePrefixFlag;

  // Prompt for missing filters
  const needsPrompt = !selectedNetwork || !selectedType;
  const rl = needsPrompt
    ? readline.createInterface({ input: stdin, output: stdout })
    : null;

  try {
    if (!selectedNetwork) {
      const networks = [...new Set(allVectors.map(v => v.network))].sort();
      const picked = await selectFromList(rl!, 'Network', networks);
      if (!picked) return;
      selectedNetwork = picked;
    }

    // Filter by network first to determine available types
    const byNetwork = allVectors.filter(v => v.network === selectedNetwork);
    if (byNetwork.length === 0) {
      console.log(`\nNo vectors found for network "${selectedNetwork}".`);
      return;
    }

    if (!selectedType) {
      const types = [...new Set(byNetwork.map(v => v.type))].sort();
      const picked = await selectFromList(rl!, 'Type', types);
      if (!picked) return;
      selectedType = picked;
    }

    // Filter by both network and type
    const filtered = byNetwork.filter(v => v.type === selectedType);
    if (filtered.length === 0) {
      console.log(`\nNo vectors found for ${selectedNetwork}/${selectedType}.`);
      return;
    }

    // Display the matching vectors
    console.log(`\n  Vectors: ${selectedNetwork}/${selectedType}\n`);
    for (const v of filtered) {
      const completedSteps = v.steps.join(', ');
      console.log(`    ${v.hash}  ${v.did}`);
      console.log(`      steps: ${completedSteps}`);
    }
    console.log('');
  } finally {
    if (rl) rl.close();
  }
}



async function main() {
  // If no recognized action was provided, print help
  if (!action) return printHelp();

  switch (action) {
    case 'create':   return stepCreate();
    case 'update':   return stepUpdate();
    case 'fund':     return stepFund();
    case 'announce': return stepAnnounce();
    case 'resolve':  return stepResolve();
    case 'list':     return stepList();
  }
}

main().catch((err) => {
  console.error('Error generating test vector:', err);
  process.exit(1);
});
