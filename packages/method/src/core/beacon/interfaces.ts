import { DidUpdatePayload, ProofBytes, UnixTimestamp } from '@did-btc1/common';
import { DidServiceEndpoint, DidService as IDidService } from '@web5/dids';
import { RawTransactionRest } from '../../bitcoin/rest/index.js';
import { Btc1DidDocument } from '../../utils/did-document.js';
import { RawTransactionV2 } from '../../bitcoin/rpc/types.js';
import { SignalsMetadata } from './types.js';

/**
 * Beacon interface
 * @interface Beacon
 * @type {Beacon}
 */
export interface Beacon {
    /**
     * A unique identifier for the Beacon
     * @type {string}
     */
    id: string;

    /**
     * The type of the Beacon
     * @type {string}
     */
    type: string;

    /**
     * The service endpoint of the Beacon
     * @type {string}
     */
    serviceEndpoint: DidServiceEndpoint;

    /**
     * Returns the Beacon Service object
     * @type {BeaconService}
     */
    service: BeaconService;

    /**
     * Generates a Beacon Signal Transaction
     * @param {string} didUpdatePayload The DID update payload
     * @returns {BeaconSignal} The Beacon Signal
     */
    generateSignal(didUpdatePayload: string): BeaconSignal;

    /**
     * Processes a Beacon Signal.
     * @param {RawTransactionV2} signal The raw transaction
     * @param {SidecarData} signalsMetadata The signals metadata from the sidecar data
     * @returns {Promise<DidUpdatePayload | undefined>} The DID update payload
     */
    processSignal(signal: RawTransactionV2, signalsMetadata: SignalsMetadata): Promise<DidUpdatePayload | undefined>;


    /**
     * Broadcasts a signal.
     * @param {DidUpdatePayload} didUpdatePayload The DID update payload.
     * @returns {Promise<SignalMetadata>} The signal metadata.
     */
    broadcastSignal(didUpdatePayload: DidUpdatePayload): Promise<SignalsMetadata>;
}

export interface BeaconService extends IDidService {
    serviceEndpoint: DidServiceEndpoint;
    casType?: string;
}

export interface BeaconServiceAddress extends BeaconService {
    address: string;
}


/**
 * Represents a transaction discovered on the Bitcoin blockchain that
 * spends from a Beacon address, thus announcing DID updates.
 *
 * DID BTC1
 * {@link https://dcdpr.github.io/did-btc1/#find-next-signals | 4.2.2.3 Find Next Signals}
 * and
 * {@link https://dcdpr.github.io/did-btc1/#process-beacon-signals | 4.2.2.4 Process Beacon Signals}.
 */
export interface BeaconSignal {
  /**
   * The DID Document's `service` ID of the Beacon that produced this signal, e.g. "#cidAggregateBeacon".
   * @type {string}
   */
  beaconId: string;

  /**
   * The type of Beacon, e.g. "SingletonBeacon".
   * @type {string}
   */
  beaconType: string;

  /**
   * The Bitcoin address of the Beacon that produced this signal.
   * @type {string}
   */
  beaconAddress: string;

  /**
   * The Bitcoin transaction that is the actual on-chain Beacon Signal.
   * Typically you'd store a minimal subset or a reference/ID for real usage.
   * @type {RawTransactionRest | RawTransactionV2}
   */
  tx: RawTransactionRest | RawTransactionV2;

  /**
   * The block height at which this transaction was confirmed.
   * @type {number}
   */
  blockheight: number;

  /**
   * The block time of the transaction in Unix timestamp format.
   * @type {UnixTimestamp}
   */
  blocktime: UnixTimestamp;
}

export interface Btc1SidecarData {
  did: string;
}
export interface SingletonSidecar extends Btc1SidecarData {
  signalsMetadata: SignalsMetadata;
}
export interface CIDAggregateSidecar extends Btc1SidecarData {
  initialDocument: Btc1DidDocument;
  cidUpdates: Array<string>;
}
export interface SMTAggregateSidecar extends Btc1SidecarData {
  // SMTAggregate
  smtProof: ProofBytes;
}