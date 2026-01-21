import { BitcoinNetworkConnection, RawTransactionRest, RawTransactionV2 } from '@did-btcr2/bitcoin';
import { HexString, UnixTimestamp } from '@did-btcr2/common';
import { DidServiceEndpoint, DidService as IDidService } from '@web5/dids';
import { SidecarData } from '../types.js';
import { BTCR2SignedUpdate } from '@did-btcr2/cryptosuite';

/**
 * Represents a Beacon Service, which extends the DID Service with a service endpoint.
 * @interface BeaconService
 * @extends IDidService
 */
export interface BeaconService extends IDidService {
    serviceEndpoint: DidServiceEndpoint;
}

/**
 * Represents a parsed Beacon Service, which extends the Beacon Service with a Bitcoin address.
 * @interface ParsedBeaconService
 * @extends BeaconService
 */
export interface ParsedBeaconService extends BeaconService {
    /**
     * The Bitcoin address associated with this Beacon Service.
     */
    address: string;
}

/**
 * Metadata about a Bitcoin block containing a Beacon Signal.
 * @interface BlockMetadata
 */
export interface BlockMetadata {
   /**
   * The block height at which the Beacon Signal was included.
   */
  height: number;

  /**
   * The timestamp of the block containing the Beacon Signal.
   */
  time: UnixTimestamp;

  /**
   * The number of confirmations for the block containing the Beacon Signal.
   */
  confirmations: number;
}

/**
 * Represents a Beacon Signal, which is a transaction broadcasted by a Beacon to announce a DID update.
 * @interface BeaconSignal
 */
export interface BeaconSignal {
  /**
   * The raw Bitcoin transaction representing the Beacon Signal.
   */
  tx: RawTransactionRest | RawTransactionV2;

  /**
   * The beacon signal bytes hash (i.e. the hash of the BTCR2 update included in the Beacon Signal tx).
   */
  signalBytes: string;

  /**
   * Metadata about the block containing the Beacon Signal.
   */
  blockMetadata: BlockMetadata;
}

/**
 * Abstract class representing an AggregateBeacon.
 * @abstract
 * @class AggregateBeacon
 * @type {AggregateBeacon}
 */
export abstract class AggregateBeacon {
  /**
   * The Beacon service object parsed from the DID Document.
   */
  service: BeaconService;

  /**
   * The array of Beacon Signals associated with this Beacon service.
   */
  signals: Array<BeaconSignal>;

  /**
   * The sidecar data associated with this Beacon service.
   * TODO: Make this more specific to Beacon type.
   */
  sidecar: SidecarData;

  /**
   * The Bitcoin network connection associated with this Beacon service.
   */
  bitcoin: BitcoinNetworkConnection;

  constructor(
    service: BeaconService,
    signals: Array<BeaconSignal>,
    sidecar: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ) {
    this.service = service;
    this.signals = signals;
    this.sidecar = sidecar;
    this.bitcoin = bitcoin!;
  }

  /**
   * Generates an unsigned update in a Beacon Signal (implemented by subclasses).
   */
  abstract generateSignal(updateHash: HexString): BeaconSignal;

  /**
   * Processes a Beacon Signal (implemented by subclasses).
   */
  abstract processSignals(): Promise<Array<[BTCR2SignedUpdate, BlockMetadata]>>;

  /**
   * Broadcasts a signed update in a Beacon Signal (implemented by subclasses).
   */
  abstract broadcastSignal(updateHash: HexString): Promise<HexString>;
}