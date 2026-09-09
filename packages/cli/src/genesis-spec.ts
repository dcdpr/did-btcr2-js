import type {
  BeaconAddressType,
  BeaconType,
  GenesisBeaconSpec,
  GenesisDocumentSpec,
  GenesisVerificationMethodSpec,
  VerificationRelationship
} from '@did-btcr2/api';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { DidService } from '@web5/dids';
import { CLIError } from './error.js';
import type { NetworkOption } from './types.js';

/**
 * One verification method of a genesis spec file. `key` is a keystore
 * reference (URN, name, or fingerprint prefix); `publicKey` is a 33-byte
 * compressed public key as hex. Exactly one of the two.
 */
export interface GenesisSpecVerificationMethod {
  key?           : string;
  publicKey?     : string;
  relationships? : string[];
  fragment?      : string;
}

/**
 * One beacon of a genesis spec file. `key` or `publicKey` derives the beacon
 * address from a key; `address` uses a Bitcoin address as given. At most one
 * of the three; the api requires one.
 */
export interface GenesisSpecBeacon {
  type          : string;
  key?          : string;
  publicKey?    : string;
  addressType?  : string;
  address?      : string;
  fragment?     : string;
}

/** One other service of a genesis spec file. */
export interface GenesisSpecService {
  id?             : string;
  type            : string;
  serviceEndpoint : unknown;
}

/**
 * The genesis spec file that `btcr2 genesis build --spec <path>` reads, and
 * that the wizard collects. The network comes from `-n` or the configuration,
 * not from the file.
 */
export interface GenesisSpecFile {
  verificationMethods : GenesisSpecVerificationMethod[];
  beacons?            : GenesisSpecBeacon[];
  services?           : GenesisSpecService[];
}

/** Resolves a keystore key reference to the 33-byte public key. */
export type ResolvePublicKey = (ref: string) => Uint8Array;

/**
 * Checks the shape of a parsed genesis spec file. The values (relationship
 * names, beacon types, addresses) are checked by the api when it builds the
 * document; this function checks only what the api cannot see: that each
 * verification method names exactly one key source, and that each beacon
 * names at most one.
 * @param value The parsed JSON value.
 * @param source The file path, for the error data.
 * @returns The spec.
 * @throws {CLIError} If the shape is not valid.
 */
export function parseGenesisSpec(value: unknown, source: string): GenesisSpecFile {
  const fail = (message: string): never => {
    throw new CLIError(`Invalid genesis spec: ${message}`, 'INVALID_ARGUMENT_ERROR', { spec: source });
  };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('the file must contain a JSON object.');
  }
  const spec = value as Record<string, unknown>;
  if (!Array.isArray(spec.verificationMethods) || spec.verificationMethods.length === 0) {
    return fail('"verificationMethods" must be a non-empty array.');
  }
  spec.verificationMethods.forEach((vm, index) => {
    if (vm === null || typeof vm !== 'object') return fail(`verificationMethods[${index}] must be an object.`);
    const hasKey = typeof vm.key === 'string' && vm.key.length > 0;
    const hasPublicKey = typeof vm.publicKey === 'string' && vm.publicKey.length > 0;
    if (hasKey === hasPublicKey) {
      return fail(`verificationMethods[${index}] needs exactly one of "key" (a keystore reference) or "publicKey" (hex).`);
    }
  });
  if (spec.beacons !== undefined) {
    if (!Array.isArray(spec.beacons)) return fail('"beacons" must be an array.');
    spec.beacons.forEach((beacon, index) => {
      if (beacon === null || typeof beacon !== 'object') return fail(`beacons[${index}] must be an object.`);
      const sources = ['key', 'publicKey', 'address'].filter(name => beacon[name] !== undefined);
      if (sources.length > 1) {
        return fail(`beacons[${index}] names ${sources.join(' and ')}. Give only one of "key", "publicKey", or "address".`);
      }
    });
  }
  if (spec.services !== undefined && !Array.isArray(spec.services)) {
    return fail('"services" must be an array.');
  }
  return spec as unknown as GenesisSpecFile;
}

/**
 * Converts a genesis spec file to the api spec: resolves each keystore
 * reference to its public key, parses each hex public key, and passes the
 * other values through for the api to check.
 * @param spec The spec file.
 * @param network The network of the beacon addresses.
 * @param resolvePublicKey Resolves a keystore reference to the public key.
 * @returns The api spec.
 * @throws {CLIError} If a hex public key is not hex.
 */
export function toApiSpec(spec: GenesisSpecFile, network: NetworkOption, resolvePublicKey: ResolvePublicKey): GenesisDocumentSpec {
  const keyBytes = (entry: { key?: string; publicKey?: string }, label: string): Uint8Array =>
    entry.key !== undefined ? resolvePublicKey(entry.key) : parseHexPublicKey(entry.publicKey as string, label);
  const verificationMethods: GenesisVerificationMethodSpec[] = spec.verificationMethods.map((vm, index) => ({
    publicKey     : keyBytes(vm, `verificationMethods[${index}].publicKey`),
    relationships : vm.relationships as VerificationRelationship[] | undefined,
    fragment      : vm.fragment,
  }));
  const beacons: GenesisBeaconSpec[] | undefined = spec.beacons?.map((beacon, index) => ({
    type        : beacon.type as BeaconType,
    publicKey   : beacon.key !== undefined || beacon.publicKey !== undefined
      ? keyBytes(beacon, `beacons[${index}].publicKey`)
      : undefined,
    addressType : beacon.addressType as BeaconAddressType | undefined,
    address     : beacon.address,
    fragment    : beacon.fragment,
  }));
  return {
    network,
    verificationMethods,
    beacons,
    services : spec.services as DidService[] | undefined,
  };
}

/** Parses a hex public key. The length and the curve check belong to the api. */
export function parseHexPublicKey(hex: string, label: string): Uint8Array {
  try {
    return hexToBytes(hex.trim());
  } catch {
    throw new CLIError(`Invalid ${label}: not valid hex.`, 'INVALID_ARGUMENT_ERROR', { publicKey: hex });
  }
}
