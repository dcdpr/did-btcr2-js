import { UnixTimestamp } from '@did-btcr2/common';
import { DidResolutionOptions as IDidResolutionOptions } from '@web5/dids';
import { DidDocument } from '../utils/did-document.js';
import { SidecarData } from '../utils/types.js';

/**
 * Options for resolving a DID Document
 * @param {?number} versionId The versionId for resolving the DID Document
 * @param {?UnixTimestamp} versionTime The versionTime for resolving the DID Document
 * @param {?SidecarData} sidecarData The sidecar data for resolving the DID Document
 */
export interface DidResolutionOptions extends IDidResolutionOptions {
  versionId?: number
  versionTime?: UnixTimestamp;
  sidecarData?: SidecarData;
  network?: string;
}
export interface RootCapability {
    '@context': string;
    id: string;
    controller: string;
    invocationTarget: string;
}
export interface ReadBlockchainParams {
  contemporaryDidDocument: DidDocument;
  contemporaryBlockHeight: number | 1;
  currentVersionId: number | 1;
  targetVersionId?: number;
  targetBlockHeight: number;
  updateHashHistory: string[];
  sidecarData?: SidecarData;
  options?: DidResolutionOptions;
}