import type { NetworkName } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/std';
import { DidDocumentError, INVALID_DID_DOCUMENT } from '@did-btcr2/std';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keys';
import type {
  BeaconService,
  Btcr2DidDocument,
  DidVerificationMethod,
  SingletonScriptKind,
  VerificationRelationships
} from '@did-btcr2/method';
import {
  BeaconUtils,
  BTCR2_DID_DOCUMENT_CONTEXT,
  deriveSingletonAddress,
  detectSingletonScriptKind,
  GenesisDocument,
  ID_PLACEHOLDER_VALUE
} from '@did-btcr2/method';
import type { DidService } from '@web5/dids';
import { messageText } from './helpers.js';

/**
 * A verification relationship of a DID document.
 * @public
 */
export type VerificationRelationship =
  | 'authentication'
  | 'assertionMethod'
  | 'capabilityInvocation'
  | 'capabilityDelegation';

/**
 * The four verification relationships, in the order the built document lists them.
 * @public
 */
export const VERIFICATION_RELATIONSHIPS: readonly VerificationRelationship[] = Object.freeze([
  'authentication',
  'assertionMethod',
  'capabilityInvocation',
  'capabilityDelegation',
]);

/**
 * The service `type` of a beacon, per the specification's beacon types table.
 * @public
 */
export type BeaconType = 'SingletonBeacon' | 'CASBeacon' | 'SMTBeacon';

/**
 * The three beacon types.
 * @public
 */
export const BEACON_TYPES: readonly BeaconType[] = Object.freeze(['SingletonBeacon', 'CASBeacon', 'SMTBeacon']);

/**
 * The script kind of a beacon address that the api derives from a public key.
 * @public
 */
export type BeaconAddressType = SingletonScriptKind;

/**
 * The beacon address types.
 * @public
 */
export const BEACON_ADDRESS_TYPES: readonly BeaconAddressType[] = Object.freeze(['p2pkh', 'p2wpkh', 'p2tr']);

/**
 * The address type of a beacon derived from a key when the spec names none.
 * The same kind as the `#initialP2WPKH` beacon of a KEY identifier.
 * @public
 */
export const DEFAULT_BEACON_ADDRESS_TYPE: BeaconAddressType = 'p2wpkh';

/**
 * One verification method of a genesis document.
 * @public
 */
export interface GenesisVerificationMethodSpec {
  /** The 33-byte compressed secp256k1 public key. */
  publicKey: KeyBytes;
  /**
   * The verification relationships that reference the method. Default: all
   * four. An empty array adds the method with no relationship.
   */
  relationships?: VerificationRelationship[];
  /** The fragment of the method id, without `#`. Default: `key-<index>`. */
  fragment?: string;
}

/**
 * One beacon service of a genesis document. Give `publicKey` to derive the
 * beacon address from a key, or `address` to use a Bitcoin address as given.
 * @public
 */
export interface GenesisBeaconSpec {
  /** The beacon type. */
  type: BeaconType;
  /** The key that the beacon address is derived from. Exclusive with `address`. */
  publicKey?: KeyBytes;
  /**
   * The script kind of the derived address. Default:
   * {@link DEFAULT_BEACON_ADDRESS_TYPE}. Only with `publicKey`.
   */
  addressType?: BeaconAddressType;
  /**
   * A Bitcoin address of the network, or a BIP321 `bitcoin:` URI of it. The
   * document gets `bitcoin:<address>`, with a bech32 address in lower case.
   * Exclusive with `publicKey`. A CAS or SMT beacon usually names the address
   * of an aggregation cohort here.
   */
  address?: string;
  /** The fragment of the service id, without `#`. Default: `service-<index>`. */
  fragment?: string;
}

/**
 * The input of {@link buildGenesisDocument}: the keys, the beacons, and the
 * services of a genesis document.
 * @public
 */
export interface GenesisDocumentSpec {
  /**
   * The network of the beacon addresses. Required here; the api facade fills
   * its default network when the caller names none.
   */
  network: NetworkName;
  /** The verification methods. At least one. */
  verificationMethods: GenesisVerificationMethodSpec[];
  /**
   * The beacon services. Default: one Singleton beacon with the
   * {@link DEFAULT_BEACON_ADDRESS_TYPE} address of the first verification method.
   */
  beacons?: GenesisBeaconSpec[];
  /**
   * Other services. The builder gives a fragment `id` (`#name`) the placeholder
   * prefix `did:btcr2:_`. It keeps another `id` as given. The rules of a
   * producer then check the syntax of that `id`. The builder refuses a beacon
   * type here: use `beacons`.
   */
  services?: DidService[];
}

/**
 * Builds a Genesis Document. The document has the id `did:btcr2:_`, one
 * Multikey verification method per key, and the verification relationships.
 * It also has one beacon service per beacon and the other services. Each id
 * that the builder makes and each controller contain the placeholder. The
 * result hashes to the genesis bytes of an EXTERNAL identifier.
 *
 * The builder refuses a spec that cannot produce an updatable DID: the
 * specification requires at least one verification method with the
 * `capabilityInvocation` relationship and at least one beacon service.
 * @param spec The keys, beacons, and services.
 * @returns The genesis document.
 * @throws {DidDocumentError} If the spec is not valid.
 */
export function buildGenesisDocument(spec: GenesisDocumentSpec): Btcr2DidDocument {
  if (spec === null || typeof spec !== 'object') {
    throw invalid('The genesis document spec must be an object.', { spec });
  }
  const network = getNetwork(spec.network);
  const verificationMethod = buildVerificationMethods(spec.verificationMethods);
  const relationships = buildRelationships(spec.verificationMethods, verificationMethod);
  const beaconSpecs = spec.beacons ?? [{
    type      : 'SingletonBeacon',
    publicKey : spec.verificationMethods[0].publicKey,
  }];
  const beacons = buildBeaconServices(beaconSpecs, network);
  const services = buildServices(spec.services ?? [], beacons.length);
  const service = [...beacons, ...services];
  assertUniqueIds([...verificationMethod.map(vm => vm.id), ...service.map(svc => svc.id)]);
  return GenesisDocument.create(verificationMethod, relationships, service);
}

/**
 * Checks that a genesis document has the shape that the specification
 * requires. The api runs this check before it hashes the document. The
 * document must be a JSON object with the id `did:btcr2:_` and the two
 * required contexts. Its members must follow the DID Core rules of a producer.
 * A verification method id or a service id does not need the placeholder.
 * @param genesisDocument The document to check.
 * @throws {DidDocumentError} If the document is not a valid genesis document.
 */
export function assertGenesisDocument(genesisDocument: unknown): asserts genesisDocument is Btcr2DidDocument {
  if (genesisDocument === null || typeof genesisDocument !== 'object' || Array.isArray(genesisDocument)) {
    throw invalid('The genesis document must be a JSON object.', { genesisDocument });
  }
  const document = genesisDocument as Record<string, unknown>;
  if (document.id !== ID_PLACEHOLDER_VALUE) {
    throw invalid(
      `The genesis document id must be "${ID_PLACEHOLDER_VALUE}", got ${JSON.stringify(document.id)}.`,
      { id: document.id },
    );
  }
  const context = document['@context'];
  if (!Array.isArray(context) || !BTCR2_DID_DOCUMENT_CONTEXT.every(required => context.includes(required))) {
    throw invalid(
      `The genesis document "@context" must include ${BTCR2_DID_DOCUMENT_CONTEXT.map(c => `"${c}"`).join(' and ')}.`,
      { context },
    );
  }
  // The create path makes the document, so it runs the genesis checks of a
  // producer: the DID Core member rules with the URL syntax. A verification
  // method needs a DID as its controller, and the controller can be another DID.
  GenesisDocument.fromJSON(document).validateGenesis('producer');
}

/** Builds the Multikey verification methods with placeholder ids. */
function buildVerificationMethods(specs: GenesisVerificationMethodSpec[]): DidVerificationMethod[] {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw invalid('The genesis document spec needs at least one verification method.', { verificationMethods: specs });
  }
  return specs.map((vm, index) => {
    const publicKey = parsePublicKey(vm.publicKey, `verificationMethods[${index}].publicKey`);
    if (vm.relationships !== undefined && !Array.isArray(vm.relationships)) {
      throw invalid(`verificationMethods[${index}].relationships must be an array.`, { relationships: vm.relationships });
    }
    for (const relationship of vm.relationships ?? []) {
      if (!VERIFICATION_RELATIONSHIPS.includes(relationship)) {
        const text = messageText(relationship);
        throw invalid(
          `verificationMethods[${index}].relationships contains `
          + (text === undefined ? 'a value that is not a string. ' : `"${text}". `)
          + `Expected one of ${VERIFICATION_RELATIONSHIPS.join(', ')}.`,
          { relationship },
        );
      }
    }
    return {
      id                 : `${ID_PLACEHOLDER_VALUE}#${fragmentOf(vm.fragment, `key-${index}`, `verificationMethods[${index}]`)}`,
      type               : 'Multikey',
      controller         : ID_PLACEHOLDER_VALUE,
      publicKeyMultibase : publicKey.multibase.encoded,
    } as DidVerificationMethod;
  });
}

/**
 * Builds the verification relationships: for each relationship, the ids of the
 * methods that name it. A relationship that no method names is absent. At
 * least one method must name `capabilityInvocation`.
 */
function buildRelationships(
  specs   : GenesisVerificationMethodSpec[],
  methods : DidVerificationMethod[],
): VerificationRelationships {
  const relationships: VerificationRelationships = {};
  for (const relationship of VERIFICATION_RELATIONSHIPS) {
    const ids = methods
      .filter((_, index) => (specs[index].relationships ?? VERIFICATION_RELATIONSHIPS).includes(relationship))
      .map(vm => vm.id);
    if (ids.length > 0) relationships[relationship] = ids;
  }
  if (!relationships.capabilityInvocation) {
    throw invalid(
      'At least one verification method needs the "capabilityInvocation" relationship. '
      + 'Without it, no key can sign an update of the DID document.',
      { verificationMethods: specs },
    );
  }
  return relationships;
}

/** Builds one beacon service per beacon spec. */
function buildBeaconServices(specs: GenesisBeaconSpec[], network: ReturnType<typeof getNetwork>): BeaconService[] {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw invalid(
      'The genesis document spec needs at least one beacon. '
      + 'Without a beacon, no update of the DID document can be announced.',
      { beacons: specs },
    );
  }
  return specs.map((beacon, index) => {
    const label = `beacons[${index}]`;
    if (!BEACON_TYPES.includes(beacon.type)) {
      const text = messageText(beacon.type);
      throw invalid(
        `${label}.type is ${text === undefined ? 'not a string' : `"${text}"`}. Expected one of ${BEACON_TYPES.join(', ')}.`,
        { type: beacon.type },
      );
    }
    const hasKey = beacon.publicKey !== undefined;
    const hasAddress = beacon.address !== undefined;
    if (hasKey === hasAddress) {
      throw invalid(`${label} needs exactly one of publicKey or address.`, { beacon: { ...beacon, publicKey: undefined } });
    }
    if (!hasKey && beacon.addressType !== undefined) {
      throw invalid(`${label}.addressType applies only with publicKey.`, { addressType: beacon.addressType });
    }
    const address = hasKey
      ? deriveAddress(beacon.publicKey as KeyBytes, beacon.addressType, network, label)
      : parseAddress(beacon.address as string, network, label);
    return {
      id              : `${ID_PLACEHOLDER_VALUE}#${fragmentOf(beacon.fragment, `service-${index}`, label)}`,
      type            : beacon.type,
      serviceEndpoint : `bitcoin:${address}`,
    };
  });
}

/** Derives the beacon address of a key. */
function deriveAddress(
  publicKey   : KeyBytes,
  addressType : BeaconAddressType | undefined,
  network     : ReturnType<typeof getNetwork>,
  label       : string,
): string {
  const kind = addressType ?? DEFAULT_BEACON_ADDRESS_TYPE;
  if (!BEACON_ADDRESS_TYPES.includes(kind)) {
    const text = messageText(kind);
    throw invalid(
      `${label}.addressType is ${text === undefined ? 'not a string' : `"${text}"`}. `
      + `Expected one of ${BEACON_ADDRESS_TYPES.join(', ')}.`,
      { addressType: kind },
    );
  }
  const key = parsePublicKey(publicKey, `${label}.publicKey`);
  return deriveSingletonAddress(kind, key.compressed, network);
}

/**
 * Checks that a supplied address belongs to the network and has a spendable script kind. The
 * input is a Bitcoin address or a BIP321 `bitcoin:` URI. The result is the address, with a bech32
 * address in lower case.
 */
function parseAddress(address: string, network: ReturnType<typeof getNetwork>, label: string): string {
  if (typeof address !== 'string' || address.length === 0) {
    throw invalid(`${label}.address must be a non-empty string.`, { address });
  }
  let bare: string;
  try {
    bare = BeaconUtils.parseBitcoinAddress(/^bitcoin:/i.test(address) ? address : `bitcoin:${address}`);
  } catch (error) {
    throw invalid(
      `${label}.address "${address}" is not a Bitcoin address or a BIP321 URI of one: `
      + `${(error as Error).message}`,
      { address },
    );
  }
  try {
    detectSingletonScriptKind(bare, network);
  } catch (error) {
    throw invalid(
      `${label}.address "${bare}" is not a P2PKH, P2WPKH, or P2TR address of the network: `
      + `${(error as Error).message}`,
      { address: bare },
    );
  }
  return bare;
}

/** Checks the other services and gives a fragment id its placeholder prefix. */
function buildServices(services: DidService[], firstIndex: number): BeaconService[] {
  if (!Array.isArray(services)) {
    throw invalid('The genesis document spec "services" must be an array.', { services });
  }
  return services.map((service, offset) => {
    const label = `services[${offset}]`;
    if (service === null || typeof service !== 'object') {
      throw invalid(`${label} must be an object.`, { service });
    }
    if (typeof service.type !== 'string' || service.type.length === 0) {
      throw invalid(`${label}.type must be a non-empty string.`, { service });
    }
    if ((BEACON_TYPES as readonly string[]).includes(service.type)) {
      throw invalid(`${label}.type is a beacon type. Declare a beacon under "beacons".`, { service });
    }
    if (service.serviceEndpoint === undefined || service.serviceEndpoint === null) {
      throw invalid(`${label}.serviceEndpoint is required.`, { service });
    }
    const id = serviceId(service.id, `service-${firstIndex + offset}`, label);
    return { ...service, id } as BeaconService;
  });
}

/**
 * Resolves a service id: a fragment gets the placeholder prefix, another id stays as given.
 * The producer checks of {@link GenesisDocument.create} then check the syntax of the id.
 */
function serviceId(id: unknown, defaultFragment: string, label: string): string {
  if (id === undefined) return `${ID_PLACEHOLDER_VALUE}#${defaultFragment}`;
  if (typeof id !== 'string' || id.length === 0) {
    throw invalid(`${label}.id must be a non-empty string.`, { id });
  }
  return id.startsWith('#') ? `${ID_PLACEHOLDER_VALUE}${id}` : id;
}

/** Validates an optional fragment, else returns the default. */
function fragmentOf(fragment: string | undefined, defaultFragment: string, label: string): string {
  if (fragment === undefined) return defaultFragment;
  if (typeof fragment !== 'string' || fragment.length === 0 || fragment.includes('#')) {
    throw invalid(`${label}.fragment must be a non-empty string without "#".`, { fragment });
  }
  return fragment;
}

/** Parses a 33-byte compressed public key. */
function parsePublicKey(publicKey: unknown, label: string): CompressedSecp256k1PublicKey {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 33) {
    throw invalid(
      `${label} must be a 33-byte compressed secp256k1 public key.`,
      { length: publicKey instanceof Uint8Array ? publicKey.length : undefined },
    );
  }
  try {
    return new CompressedSecp256k1PublicKey(publicKey);
  } catch (error) {
    throw invalid(`${label} is not a valid compressed secp256k1 public key: ${(error as Error).message}`, {});
  }
}

/** Refuses two verification methods or services with one id. */
function assertUniqueIds(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw invalid(`The id "${id}" appears twice in the genesis document.`, { id });
    }
    seen.add(id);
  }
}

/** A typed error for an invalid spec or genesis document. */
function invalid(message: string, data: object): DidDocumentError {
  return new DidDocumentError(message, INVALID_DID_DOCUMENT, data);
}
