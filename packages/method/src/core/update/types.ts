import { BlockV3 } from '@did-btcr2/bitcoin';
import { DidDocument } from '../../utils/did-document.js';
import { BTCR2SignedUpdate, CASAnnouncement, SMTProof } from './interfaces.js';
import { BeaconService } from '../beacon/interfaces.js';

/**
 * {@link https://dcdpr.github.io/did-btcr2/terminology.html#sidecar | Sidecar }
 * a mechanism by which data necessary for resolving a DID is provided alongside
 * the did:btcr2 identifier being resolved, rather than being retrieved through
 * open and standardized means (e.g., by retrieving from IPFS).
 * {@link https://dcdpr.github.io/did-btcr2/terminology.html#sidecar-data | Sidecar Data }
 * data transmitted via Sidecar.
 */
export type SidecarData = {
  '@context': 'https://btcr2.dev/context/v1',
  genesisDocument?: DidDocument; // REQUIRED when resolving did:btcr2 identifiers with x HRP.
  updates?: Array<BTCR2SignedUpdate> // REQUIRED if the DID being resolved has ever had a published BTCR2 Update.
  casUpdates?: Array<CASAnnouncement>; // REQUIRED if the DID being resolved has used a CAS Beacon to publish a BTCR2 Update.
  smtProofs?: Array<SMTProof>; // REQUIRED if the DID being resolved has used a SMT Beacon to publish a BTCR2 Update.
};

export type FindNextSignals = {
  block: BlockV3;
  beacons: BeaconService[]
};