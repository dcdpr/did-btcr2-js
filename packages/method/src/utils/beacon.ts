import { MethodError, DidMethodError, Maybe, KeyBytes } from '@did-btcr2/common';
import { DidService } from '@web5/dids';
import { networks, payments } from 'bitcoinjs-lib';
import { BeaconFactory } from '../core/beacon/factory.js';
import { BeaconService, BeaconServiceAddress } from '../interfaces/ibeacon.js';
import { Appendix } from './appendix.js';
import { DidDocument } from './did-document.js';
export interface GenerateBeaconParams {
  identifier: string;
  publicKey: KeyBytes;
  network: networks.Network;
  type: string;
}
/**
 * Required parameters for generating Beacon Services.
 * @interface GenerateBitcoinAddrsParams
 * @type {GenerateBitcoinAddrsParams}
 */
export interface GenerateBitcoinAddrsParams {
  publicKey: KeyBytes;
  network: networks.Network;
}

/**
 * Required parameters for generating Beacon Services.
 * @interface GenerateBeaconServicesParams
 * @type {GenerateBeaconServicesParams}
 */
export interface GenerateBeaconServicesParams {
  publicKey: KeyBytes;
  network: networks.Network
  beaconType: string;
}

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
  public static parseBitcoinAddress(uri: string): string {
    if (!uri.startsWith('bitcoin:')) {
      throw new DidMethodError('Invalid Bitcoin URI format', { type: 'BEACON_ERROR' });
    }
    return uri.replace('bitcoin:', '').split('?')[0]; // Extracts address from "bitcoin:<address>?params"
  }

  /**
   * Validates that the given object is a Beacon Service
   * @param {BeaconService} obj The object to validate
   * @returns {boolean} A boolean indicating whether the object is a Beacon Service
   */
  public static isBeaconService(obj: Maybe<BeaconService>): boolean {
    // Return false if the given obj is not a valid DidService.
    if(!Appendix.isDidService(obj)) return false;

    // Return false if the type is not a valid beacon service type.
    if(!['SingletonBeacon', 'CIDAggregateBeacon', 'SMTAggregateBeacon'].includes(obj.type)) return false;

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
  public static getBeaconServices(didDocument: DidDocument): BeaconService[] {
    // Filter out any invalid did service objects.
    const didServices: DidService[] = didDocument.service?.filter(Appendix.isDidService) ?? [];
    // Filter for valid beacon service objects.
    return (didServices.filter(this.isBeaconService) ?? []) as BeaconService[];
  }

  /**
   * Generate all 3 Beacon Service Endpoints for a given public key.
   * @param {GenerateBitcoinAddrsParams} params Required parameters for generating Beacon Services.
   * @param {KeyBytes} params.publicKey Public key bytes used to generate the beacon object serviceEndpoint.
   * @param {Network} params.network Bitcoin network interface from bitcoinlib-js.
   * @returns {Array<Array<string>>} 2D Array of bitcoin addresses (p2pkh, p2wpkh, p2tr).
   * @throws {DidMethodError} if the bitcoin address is invalid.
   */
  public static generateBeaconAddresses({ identifier, publicKey, network }: {
    identifier: string;
    publicKey: KeyBytes;
    network: networks.Network;
  }): Array<Array<string>> {
    try {
      const p2pkh = payments.p2pkh({ pubkey: publicKey, network }).address;
      const p2wpkh = payments.p2wpkh({ pubkey: publicKey, network }).address;
      const p2tr = payments.p2tr({ network, internalPubkey: publicKey.slice(1, 33) }).address;
      if (!p2pkh || !p2wpkh || !p2tr) {
        throw new DidMethodError('Failed to generate bitcoin addresses');
      }
      return [
        [`${identifier}#initialP2PKH`, p2pkh],
        [`${identifier}#initialP2WPKH`, p2wpkh],
        [`${identifier}#initialP2TR`, p2tr]
      ];
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Generate a set of Beacon Services for a given public key.
   * @param {GenerateBeaconServicesParams} params Required parameters for generating Beacon Services.
   * @param {KeyBytes} params.publicKey Public key bytes used to generate the beacon object serviceEndpoint.
   * @param {Network} params.network Bitcoin network interface from bitcoinlib-js.
   * @param {string} params.beaconType The type of beacon service to create.
   * @param {string} params.addressType The type of address to create (p2pkh, p2wpkh, p2tr).
   * @returns {BeaconService} A BeaconService object.
   * @throws {DidMethodError} if the bitcoin address is invalid.
   */
  public static generateBeaconService({ id, publicKey: pubkey, network, addressType, type }: {
    id: string;
    publicKey: KeyBytes;
    network: networks.Network;
    addressType: 'p2pkh' | 'p2wpkh' | 'p2tr';
    type: string;
  }): BeaconService {
    try {
      if(!id.includes('#')) {
        id = `${id}#initial${addressType.toUpperCase()}`;
      }
      const serviceEndpoint = `bitcoin:${payments[addressType]({ pubkey, network }).address}`;
      return { id, type, serviceEndpoint, };
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Generate a custom Beacon Service.
   * @param {GenerateBeaconServicesParams} params Required parameters for generating Beacon Services.
   * @returns
   */
  public static generateBeaconServiceCustom({ id, publicKey: pubkey, network, addressType, type }: {
    id: string;
    publicKey: KeyBytes;
    network: networks.Network;
    addressType: 'p2pkh' | 'p2wpkh' | 'p2tr';
    type: string;
  }): BeaconService {
    try {
      if(!id.includes('#')) {
        throw new MethodError(
          'Invalid id format. It should include a fragment identifier (e.g., #initialP2PKH).',
          'BEACON_ERROR',
          { id }
        );
      }
      const serviceEndpoint = `bitcoin:${payments[addressType]({ pubkey, network }).address}`;
      return { id, type, serviceEndpoint, };
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }

  /**
   * Generate beacon services.
   * @param {GenerateBeaconServicesParams} params Required parameters for generating Beacon Services.
   * @param {string} params.network The name of the Bitcoin network to use.
   * @param {Uint8Array} params.publicKey Byte array representation of a public key used to generate a new btcr2 key-id-type.
   * @param {string} params.beaconType Optional beacon type to use (default: SingletonBeacon).
   * @returns {DidService[]} Array of DidService objects.
   */
  public static generateBeaconServices({ identifier, network, type, publicKey }: {
    identifier: string;
    publicKey: KeyBytes;
    network: networks.Network;
    type: string;
  }): Array<BeaconService> {
    // Generate the bitcoin addresses
    const bitcoinAddrs = this.generateBeaconAddresses({ identifier, publicKey, network, });

    // Map the bitcoin addresses to the beacon service
    return bitcoinAddrs.map(([id, address]) => {
      // Convert the address to a BIP-21 URI
      const serviceEndpoint = `bitcoin:${address}`;
      // Create the beacon object
      const beacon = BeaconFactory.establish({ id, type, serviceEndpoint });
      // Return the beacon service
      return beacon.service;
    });
  }

  /**
   * Generate a single beacon service.
   * @param {GenerateBeaconParams} params Required parameters for generating a single Beacon Service.
   * @param {string} params.identifier The identifier for the beacon service.
   * @param {string} params.network The name of the Bitcoin network to use.
   * @param {Uint8Array} params.publicKey Byte array representation of a public key used to generate a new btcr2 key-id-type.
   * @param {string} params.type The type of beacon service to create.
   * @returns {BeaconService} A BeaconService object.
   * @throws {DidMethodError} if the bitcoin address is invalid.
   */
  public static generateBeacon({ identifier, network, type, publicKey }: {
    identifier: string;
    publicKey: KeyBytes;
    network: networks.Network;
    type: string;
  }): BeaconService {
    // Generate the bitcoin addresses
    const bitcoinAddrs = this.generateBeaconAddresses({ identifier, publicKey, network, });

    // Map the bitcoin addresses to the beacon service
    const beacon = bitcoinAddrs.map(([id, address]) => {
      // Convert the address to a BIP-21 URI
      const serviceEndpoint = `bitcoin:${address}`;
      // Create the beacon object
      const beacon = BeaconFactory.establish({ id, type, serviceEndpoint });
      // Return the beacon service
      return beacon.service;
    });

    return beacon[0];
  }

  /**
   * Manufacture a pre-filled Beacon using the BeaconFactory.
   * @param {BeaconServicesParams} params Required parameters for generating a single Beacon Service.
   * @param {string} params.serviceId The type of service being created (#initialP2PKH, #initialP2WPKH, #initialP2TR).
   * @param {string} params.beaconType The type of beacon service being created (SingletonBeacon, SMTAggregatorBeacon).
   * @param {string} params.bitcoinAddress The bitcoin address to use for the service endpoint.
   * @returns {BeaconService} One BeaconService object.
   */
  public static manufactureBeacon(params: BeaconService): BeaconService {
    return BeaconFactory.establish(params).service;
  }

  /**
   * Convert beacon service endpoints from BIP-21 URIs to addresses.
   * @param {Array<BeaconService>} beacons The list of beacon services.
   * @returns {Array<BeaconServiceAddress>} An array of beacon services with address: bitcoinAddress.
   */
  public static toBeaconServiceAddress(beacons: Array<BeaconService>): Array<BeaconServiceAddress> {
    return beacons.map((beacon) => ({ ...beacon, address: beacon.serviceEndpoint.replace('bitcoin:', '')}));
  }

  /**
   * Create a map of address => beaconService with address field.
   * @param {Array<BeaconService>} beacons The list of beacon services.
   * @returns {Map<string, BeaconServiceAddress>} A map of address => beaconService.
   */
  public static getBeaconServiceAddressMap(beacons: Array<BeaconService>): Map<string, BeaconServiceAddress> {
    const beaconAddrs = this.toBeaconServiceAddress(beacons);
    return new Map<string, BeaconServiceAddress>(beaconAddrs.map((beacon) => ([beacon.address, beacon])));
  }

  /**
   * Get the beacon service ids from a list of beacon services.
   * @param {DidDocument} didDocument The DID Document to extract the services from.
   * @returns {string[]} An array of beacon service ids.
   */
  public static getBeaconServiceIds(didDocument: DidDocument): string[] {
    return this.getBeaconServices(didDocument).map((beacon) => beacon.id);
  }
}