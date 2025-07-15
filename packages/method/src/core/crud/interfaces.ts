import { BitcoinNetworkNames, UnixTimestamp } from '@did-btc1/common';
import { DidResolutionOptions as IDidResolutionOptions } from '@web5/dids';
import BitcoinRpc from '../../bitcoin/rpc/index.js';
import { Btc1DidDocument } from '../did-document/index.js';
import { SidecarData } from '../beacon/types.js';

/**
 * Options for resolving a DID Document
 * @param {number} [versionId] The versionId for resolving the DID Document.
 * @param {UnixTimestamp} [versionTime] The versionTime for resolving the DID Document.
 * @param {BitcoinRpc} [rpc] BitcoinRpc client connection.
 * @param {SidecarData} [sidecarData] The sidecar data for resolving the DID Document.
 */
export interface DidResolutionOptions extends IDidResolutionOptions {
  versionId?: number
  versionTime?: UnixTimestamp;
  rpc?: BitcoinRpc;
  sidecarData?: SidecarData<'SingletonBeacon' | 'CIDAggregateBeacon' | 'SMTAggregateBeacon'>;
  network?: BitcoinNetworkNames;
}

export interface Btc1RootCapability {
    '@context': string;
    id: string;
    controller: string;
    invocationTarget: string;
}

export interface ReadBlockchainParams {
  contemporaryDidDocument: Btc1DidDocument;
  contemporaryBlockHeight: number | 1;
  currentVersionId: number | 1;
  targetVersionId?: number;
  targetBlockHeight: number;
  updateHashHistory: string[];
  sidecarData?: SidecarData<'SingletonBeacon' | 'CIDAggregateBeacon' | 'SMTAggregateBeacon'>;
  options?: DidResolutionOptions;
}