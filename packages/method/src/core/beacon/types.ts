import { DidUpdatePayload } from '@did-btc1/common';
import { BlockV3 } from '../../bitcoin/rpc/types.js';
import { Btc1DidDocument } from '../../utils/did-document.js';
import { BeaconService, CIDAggregateSidecar, SingletonSidecar, SMTAggregateSidecar } from './interfaces.js';

export type FindNextSignals = {
  block: BlockV3;
  beacons: BeaconService[]
};

export type Metadata = {
  updatePayload: DidUpdatePayload;
  proofs?: any;
};

export type SignalSidecarData = Metadata;

export type SignalsMetadata = { [signalId: string]: Metadata; };

export type SidecarData<T> =
  T extends 'SingletonBeacon' ? SingletonSidecar :
  T extends 'CIDAggregateBeacon' ? CIDAggregateSidecar :
  T extends 'SMTAggregateBeacon' ? SMTAggregateSidecar :
  never;

/**
 * A container for out-of-band data the resolver may need. This includes the
 * initial DID document if it isn't stored in IPFS, plus references for each
 * on-chain Beacon signal.
 *
 * DID BTC1
 * {@link https://dcdpr.github.io/did-btc1/#sidecar-initial-document-validation | 4.2.1.2.1 Sidecar Initial Document Validation},
 * {@link https://dcdpr.github.io/did-btc1/#resolve-target-document | 4.2.2 Resolve Target Document},
 * {@link https://dcdpr.github.io/did-btc1/#traverse-blockchain-history | 4.2.2.2 Traverse Blockchain History},
 * {@link https://dcdpr.github.io/did-btc1/#find-next-signals | 4.2.2.3 Find Next Signals}.
 */
export interface ISidecarData {
  /**
   * The initial DID Document for an externally created did:btc1,
   * if not fetched from IPFS or another CAS.
   */
  initialDocument?: Record<string, any>; // or a typed DIDDocument from W3C DID Core

  /**
   * A map from Bitcoin transaction IDs to the sidecar info about that signal.
   * Each signal might provide a single DID Update Payload, or (for aggregator beacons)
   * a bundle or proofs.
   */
  signalsMetadata?: {
    [txid: string]: SignalSidecarData;
  };
}

export type GetSigningMethodParams = {
  didDocument: Btc1DidDocument;
  methodId?: string;
};