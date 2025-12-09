import { DidUpdatePayload, ProofBytes } from '@did-btcr2/common';
import { BeaconService } from '../interfaces/beacon.js';
import { DidDocument } from './did-document.js';
import { BlockV3 } from '@did-btcr2/bitcoin';
import { DidResolutionResult as IDidResolutionResult } from '@web5/dids';

export type FindNextSignals = {
  block: BlockV3;
  beacons: BeaconService[]
};
export type Metadata = {
  didUpdate: DidUpdatePayload;
  proofs?: string;
};
export type SignalSidecarData = Metadata;
export interface Sidecar {
  did: string;
}
export type SignalsMetadata = { [signalId: string]: Metadata; };
export interface SingletonSidecar extends Sidecar {
  signalsMetadata: SignalsMetadata;
}
export interface CIDAggregateSidecar extends Sidecar {
  initialDocument: DidDocument;
  signalsMetadata: SignalsMetadata;
  cidUpdates: Array<string>;
}
export interface SMTAggregateSidecar extends Sidecar {
  initialDocument: DidDocument;
  signalsMetadata: SignalsMetadata;
  smtProof: ProofBytes;
}
export type BeaconSidecarData<T> =
  T extends 'SingletonBeacon' ? SingletonSidecar :
  T extends 'CIDAggregateBeacon' ? CIDAggregateSidecar :
  T extends 'SMTAggregateBeacon' ? SMTAggregateSidecar :
  T;
export type SidecarData = BeaconSidecarData<SingletonSidecar | CIDAggregateSidecar | SMTAggregateSidecar>;
export type GetSigningMethodParams = {
  didDocument: DidDocument;
  methodId?: string;
};
export type DidResolutionResult = IDidResolutionResult;