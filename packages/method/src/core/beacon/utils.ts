import { getNetwork } from '@did-btcr2/bitcoin';
import { DidMethodError, KeyBytes, Maybe, MethodError } from '@did-btcr2/common';
import { networks, payments } from 'bitcoinjs-lib';
import { Appendix } from '../../utils/appendix.js';
import { DidDocument } from '../../utils/did-document.js';
import { Identifier } from '../identifier.js';
import { BeaconService } from './interfaces.js';

/**
 * Static class of utility functions for the Beacon Service
 * @class BeaconUtils
 * @type {BeaconUtils}
 */
export class BeaconUtils {
  /**
   * Converts a BIP21 Bitcoin URI to a Bitcoin address
   * @param {string} uri The BIP21 Bitcoin URI to convert
   * @returns {string} The Bitcoin address extracted from the URI
   * @throws {DidMethodError} if the URI is not a valid Bitcoin URI
   */
  static parseBitcoinAddress(uri: string): string {
    if (!uri.startsWith('bitcoin:')) {
      throw new MethodError('Invalid Bitcoin URI format', 'BEACON_SERVICE_ERROR', { uri });
    }
    return uri.replace('bitcoin:', '').split('?')[0];
  }

  /**
   * Validates that the given object is a Beacon Service
   * @param {BeaconService} obj The object to validate
   * @returns {boolean} A boolean indicating whether the object is a Beacon Service
   */
  static isBeaconService(obj: Maybe<BeaconService>): boolean {
    // Return false if the given obj is not a valid DidService.
    if(!Appendix.isDidService(obj)) return false;

    // Return false if the type is not a valid beacon service type.
    if(!['SingletonBeacon', 'CASBeacon', 'SMTBeacon'].includes(obj.type)) return false;

    // Return false if the serviceEndpoint is not a valid BIP21 bitcoin address.
    if ([obj.serviceEndpoint].flat().some(ep => typeof ep === 'string' && !ep.startsWith('bitcoin:'))) return false;

    // Return false if the casType exists and is not a string.
    if(obj.casType && typeof obj.casType !== 'string') return false;

    // Else return true
    return true;
  }

  /**
   * Extracts the services from a given DID Document
   * @param {DidDocument} didDocument The DID Document to extract the services from
   * @returns {DidService[]} An array of DidService objects
   * @throws {TypeError} if the didDocument is not provided
   */
  static getBeaconServices(didDocument: DidDocument): BeaconService[] {
    // Filter for valid beacon service objects.
    return (didDocument.service.filter(this.isBeaconService) ?? []) as BeaconService[];
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
    } catch (error) {
      console.error(error);
      process.exit(1);
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
      const serviceEndpoint = `bitcoin:${payments[addressType]({ pubkey, network }).address}`;
      // Return the beacon serviceD
      return { id, type: beaconType, serviceEndpoint, };
    } catch (error) {
      console.error(error);
      process.exit(1);
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
    network: networks.Network;
    beaconType: string;
  }): Array<BeaconService> {
    try {
      // Generate the bitcoin addresses for the given public key and network
      const p2pkh = payments.p2pkh({ pubkey: publicKey, network }).address;
      const p2wpkh = payments.p2wpkh({ pubkey: publicKey, network }).address;
      const p2tr = payments.p2tr({ network, internalPubkey: publicKey.slice(1, 33) }).address;
      // Check that all addresses were generated successfully
      if (!p2pkh || !p2wpkh || !p2tr) {
        throw new DidMethodError('Failed to generate bitcoin addresses');
      }
      // Return the beacon services with the generated addresses as service endpoints
      return [
        {
          id              : `${id}#initialP2PKH`,
          type            : beaconType,
          serviceEndpoint : `bitcoin:${p2pkh}`
        },
        {
          id              : `${id}#initialP2WPKH`,
          type            : beaconType,
          serviceEndpoint : `bitcoin:${p2wpkh}`
        },
        {
          id              : `${id}#initialP2TR`,
          type            : beaconType,
          serviceEndpoint : `bitcoin:${p2tr}`
        },
      ];
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Convert beacon service endpoints from BIP-21 URIs to addresses.
   * @param {BeaconService} beacon The beacon service to parse.
   * @returns {BeaconServiceAddress} The beacon service with the address field extracted from the serviceEndpoint.
   */
  static parseBeaconServiceEndpoint(beacon: BeaconService): BeaconService {
    return { ...beacon, serviceEndpoint: beacon.serviceEndpoint.replace('bitcoin:', '')};
  }

  /**
   * Create a map of address => beaconService with address field.
   * @param {Array<BeaconService>} beacons The list of beacon services.
   * @returns {Map<string, BeaconService>} A map of address => beaconService.
   */
  static getBeaconServicesMap(beacons: Array<BeaconService>): Map<string, BeaconService> {
    return new Map<string, BeaconService>(
      beacons
        .map(this.parseBeaconServiceEndpoint)
        .map((beacon) => ([beacon.serviceEndpoint as string, beacon]))
    );
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