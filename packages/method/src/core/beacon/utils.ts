import type { BTCNetwork } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import type { KeyBytes, Maybe} from '@did-btcr2/std';
import { DidMethodError, MethodError } from '@did-btcr2/std';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32, bech32m, createBase58check } from '@scure/base';
import { p2pkh, p2tr, p2wpkh } from '@scure/btc-signer';
import { Appendix } from '../../utils/appendix.js';
import type { DidDocument } from '../../utils/did-document.js';
import { Identifier } from '../identifier.js';
import type { BeaconService } from './interfaces.js';
import { BeaconError } from './error.js';

/** The scheme of a BIP321 Bitcoin URI. It matches in any case. */
const BITCOIN_URI_SCHEME = /^bitcoin:/i;

/** A BIP321 query key that a client must handle. The parse handles no such key. */
const REQUIRED_QUERY_KEY = /^req-/i;

/** The base58check codec of a P2PKH or P2SH address. */
const BASE58CHECK = createBase58check(sha256);

/** The version bytes of a base58 address: P2PKH and P2SH of mainnet, then of the test networks. */
const BASE58_ADDRESS_VERSIONS = [0x00, 0x05, 0x6f, 0xc4];

/**
 * Get the Bitcoin address of a text: a base58 P2PKH or P2SH address, a bech32 segwit version 0
 * address, or a bech32m segwit address of version 1 to 16 (BIP321, BIP173, BIP350). The function
 * does not check the network. It returns a bech32 or bech32m address in lower case (BIP173:
 * "Encoders MUST always output an all lowercase Bech32 string."). A mixed-case bech32 string is
 * not an address.
 * @param {string} text The text to read.
 * @returns {string | undefined} The address, or `undefined` if the text is not a Bitcoin address.
 */
function bitcoinAddress(text: string): string | undefined {
  let payload: Uint8Array | undefined;
  try {
    payload = BASE58CHECK.decode(text);
  } catch {
    payload = undefined;
  }
  if(payload !== undefined) {
    return payload.length === 21 && BASE58_ADDRESS_VERSIONS.includes(payload[0]) ? text : undefined;
  }
  // BIP350: version 0 uses bech32, and version 1 to 16 use bech32m.
  const asBech32 = bech32.decodeUnsafe(text, 90);
  const decoded = asBech32 ?? bech32m.decodeUnsafe(text, 90);
  if(decoded === undefined) return undefined;
  const [version, ...data] = decoded.words;
  if(version === undefined || version > 16 || (asBech32 !== undefined) !== (version === 0)) return undefined;
  const program = bech32.fromWordsUnsafe(data);
  if(program === undefined) return undefined;
  const validLength = version === 0
    ? program.length === 20 || program.length === 32
    : program.length >= 2 && program.length <= 40;
  return validLength ? text.toLowerCase() : undefined;
}

/**
 * Static class of utility functions for the Beacon Service
 * @class BeaconUtils
 * @type {BeaconUtils}
 */
export class BeaconUtils {
  /**
   * Get the Beacon Address of a BIP321 Bitcoin URI: the address part, between the scheme and
   * the first `?`.
   * - The scheme `bitcoin:` matches in any case.
   * - The address part must be a base58 P2PKH or P2SH address, a bech32 segwit version 0
   *   address, or a bech32m segwit address of version 1 to 16. The parse does not check the
   *   network. It returns a bech32 or bech32m address in lower case. A base58 address keeps its
   *   case.
   * - A query key that starts with `req-`, in any case, makes the URI invalid (BIP321: "it MUST
   *   consider the entire URI invalid"). The parse ignores each other query key.
   * @param {string} uri The BIP321 Bitcoin URI, for example the `serviceEndpoint` of a beacon.
   * @returns {string} The Bitcoin address of the URI.
   * @throws {MethodError} `BEACON_SERVICE_ERROR` if the URI gives no Bitcoin address.
   */
  static parseBitcoinAddress(uri: string): string {
    if(typeof uri !== 'string' || !BITCOIN_URI_SCHEME.test(uri)) {
      throw new MethodError('Invalid Bitcoin URI: the scheme is not bitcoin:', 'BEACON_SERVICE_ERROR', { uri });
    }
    const rest = uri.slice('bitcoin:'.length);
    const queryStart = rest.indexOf('?');
    const address = bitcoinAddress(queryStart === -1 ? rest : rest.slice(0, queryStart));
    if(address === undefined) {
      throw new MethodError(
        'Invalid Bitcoin URI: the address part is not a Bitcoin address', 'BEACON_SERVICE_ERROR', { uri }
      );
    }
    // A query parameter is a key, then an optional `=` and a value, so the parameter starts with
    // its key.
    const query = queryStart === -1 ? '' : rest.slice(queryStart + 1);
    if(query.split('&').some(param => REQUIRED_QUERY_KEY.test(param))) {
      throw new MethodError(
        'Invalid Bitcoin URI: a query key starts with req-', 'BEACON_SERVICE_ERROR', { uri }
      );
    }
    return address;
  }

  /**
   * Validates that the given object is a Beacon Service that gives a Beacon Address: its type
   * is in Beacons Table 1, and {@link BeaconUtils.parseBitcoinAddress} reads its
   * `serviceEndpoint`. The function does not use `this`, so a caller can pass it unbound.
   * @param {BeaconService} obj The object to validate
   * @returns {boolean} A boolean indicating whether the object is a Beacon Service
   */
  static isBeaconService(obj: Maybe<BeaconService>): boolean {
    // Return false if the given obj is not a valid DidService.
    if(!Appendix.isDidService(obj)) return false;

    // Return false if the type is not a valid beacon service type.
    if(!['SingletonBeacon', 'CASBeacon', 'SMTBeacon'].includes(obj.type)) return false;

    // Return false if the serviceEndpoint gives no Bitcoin address: a BIP321 URI with an
    // address part (Appendix.isDidService checked that it is a string).
    try {
      BeaconUtils.parseBitcoinAddress(obj.serviceEndpoint as string);
    } catch {
      return false;
    }

    // Else return true
    return true;
  }

  /**
   * Get the beacon services of a DID document.
   * @param {DidDocument} didDocument The DID document to read.
   * @returns {BeaconService[]} The beacon services. If `service` is absent or is not an array,
   * the result is an empty array.
   * @throws {TypeError} if the didDocument is not provided
   */
  static getBeaconServices(didDocument: DidDocument): BeaconService[] {
    // The service member is optional: a document without it has no beacons.
    const service: unknown = didDocument.service;
    return (Array.isArray(service) ? service.filter(this.isBeaconService) : []) as BeaconService[];
  }

  /**
   * Create the 3 default Beacon Service Endpoints for a given `k` (public-key-based) identifier.
   * @param {string} did The DID for which to create the beacon services.
   * @returns {Array<Array<string>>} 2D Array of bitcoin addresses (p2pkh, p2wpkh, p2tr).
   * @throws {DidMethodError} if the bitcoin address is invalid.
   */
  static createBeaconServices(did: string, beaconType: string): Array<BeaconService> {
    try {
      // Get the Network class
      const addrTypes = ['p2pkh', 'p2wpkh', 'p2tr'] as Array<'p2pkh' | 'p2wpkh' | 'p2tr'>;

      // Map over the address types and create the beacon services
      return addrTypes.map(
        (addrType) => this.createBeaconService(did, addrType, beaconType)
      );
    } catch (error: any) {
      throw new BeaconError(
        'Failed to create beacon services: ' + error.message,
        'BEACON_SERVICE_ERROR', { did, beaconType }
      );
    }
  }

  /**
   * Generate a set of Beacon Services for a given public key.
   * @param {string} did The did for the beacon service.
   * @param {string} addressType The type of bitcoin address to generate (p2pkh, p2wpkh, p2tr).
   * @param {string} beaconType The type of beacon service to create.
   * @returns {BeaconService} A BeaconService object.
   * @throws {DidMethodError} if the bitcoin address is invalid.
   */
  static createBeaconService(did: string, addressType: 'p2pkh' | 'p2wpkh' | 'p2tr', beaconType: string): BeaconService {
    try {
      // Decode the DID to get the network and genesis bytes
      const components = Identifier.decode(did);
      // Get the Network class
      const network = getNetwork(components.network);
      // Get the genesis bytes
      const pubkey = components.genesisBytes;
      // Build the id
      const id = `${did}#initial${addressType.toUpperCase()}`;
      // Generate the bitcoin address
      const address = addressType === 'p2tr'
        ? p2tr(pubkey.slice(1, 33), undefined, network).address
        : addressType === 'p2wpkh'
          ? p2wpkh(pubkey, network).address
          : p2pkh(pubkey, network).address;
      const serviceEndpoint = `bitcoin:${address}`;
      // Return the beacon serviceD
      return { id, type: beaconType, serviceEndpoint, };
    } catch (error: any) {
      throw new BeaconError(
        'Failed to create beacon service: ' + error.message,
        'BEACON_SERVICE_ERROR', { did, beaconType }
      );
    }
  }

  /**
   * Generate three default Beacon Service Endpoints for a given `k` (public-key-based) identifier.
   * @param {string} did The DID for which to create the beacon services.
   * @returns {Array<Array<string>>} 2D Array of bitcoin addresses (p2pkh, p2wpkh, p2tr).
   * @throws {DidMethodError} if the bitcoin address is invalid.
   */
  static generateBeaconServices({ id, publicKey, network, beaconType }: {
    id: string;
    publicKey: KeyBytes;
    network: BTCNetwork;
    beaconType: string;
  }): Array<BeaconService> {
    try {
      // Generate the bitcoin addresses for the given public key and network
      const p2pkhAddr = p2pkh(publicKey, network).address;
      const p2wpkhAddr = p2wpkh(publicKey, network).address;
      const p2trAddr = p2tr(publicKey.slice(1, 33), undefined, network).address;
      // Check that all addresses were generated successfully
      if (!p2pkhAddr || !p2wpkhAddr || !p2trAddr) {
        throw new DidMethodError('Failed to generate bitcoin addresses');
      }
      // Return the beacon services with the generated addresses as service endpoints
      return [
        {
          id              : `${id}#initialP2PKH`,
          type            : beaconType,
          serviceEndpoint : `bitcoin:${p2pkhAddr}`
        },
        {
          id              : `${id}#initialP2WPKH`,
          type            : beaconType,
          serviceEndpoint : `bitcoin:${p2wpkhAddr}`
        },
        {
          id              : `${id}#initialP2TR`,
          type            : beaconType,
          serviceEndpoint : `bitcoin:${p2trAddr}`
        },
      ];
    } catch (error: any) {
      throw new BeaconError(
        'Failed to create beacon services: ' + error.message,
        'BEACON_SERVICE_ERROR', { id, publicKey, network, beaconType }
      );
    }
  }

  /**
   * Get the beacon service ids from a list of beacon services.
   * @param {DidDocument} didDocument The DID Document to extract the services from.
   * @returns {string[]} An array of beacon service ids.
   */
  static getBeaconServiceIds(didDocument: DidDocument): string[] {
    return this.getBeaconServices(didDocument).map((beacon) => beacon.id);
  }
}