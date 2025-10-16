import { DidUpdatePayload, UnixTimestamp } from '@did-btcr2/common';
import { DidServiceEndpoint, DidService as IDidService } from '@web5/dids';
import { RawTransactionV2, RawTransactionRest } from '@did-btcr2/bitcoin';
import { SignalsMetadata } from '../types/crud.js';

/**
 * Beacon interface
 * @interface IBeacon
 * @type {IBeacon}
 */
export interface IBeacon {
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
export interface BeaconSignal {
  beaconId: string;
  beaconType: string;
  beaconAddress: string;
  tx: RawTransactionRest | RawTransactionV2;
  blockheight: number;
  blocktime: UnixTimestamp;
}