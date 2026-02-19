import { RawTransactionRest, RawTransactionV2 } from '@did-btcr2/bitcoin';
import { UnixTimestamp } from '@did-btcr2/common';
import { DidServiceEndpoint, DidService } from '@web5/dids';

/**
 * Represents a Beacon Service, which extends a W3C DID Service by setting serviceEndpoint
 * as a single DidServiceEndpoint.
 * @interface BeaconService
 * @extends DidService
 */
export interface BeaconService extends DidService {
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