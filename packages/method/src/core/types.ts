import { HexString } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SMTProof } from './interfaces.js';

/**
 * {@link https://dcdpr.github.io/did-btcr2/data-structures.html#cas-announcement | CAS Announcement }
 * a data structure that maps DIDs to BTCR2 Signed Update hashes. All BTCR2 Signed
 * Updates (data structure) MUST be hashed with the JSON Document Hashing algorithm.
 * The concrete representation of this data structure will be published to a CAS.
 * @example
 * ```json
 * {
 *   "did:btcr2:k1q5pa5tq86fzrl0ez32nh8e0ks4tzzkxnnmn8tdvxk04ahzt70u09dag02h0cp": "a4ayc_80_OGda4BO_1o_V0etpOqiLx1JwB5S3beHW0s",
 *   "did:btcr2:x1qhjw6jnhwcyu5wau4x0cpwvz74c3g82c3uaehqpaf7lzfgmnwsd7spmmf54": "1HNeOiZeFu7gP1lxi5tdAwGcB9i2xR-Q2jpmbuwTqzU",
 *   "did:btcr2:k1qgp5h79scv4sfqkzak5g6y89dsy3cq0pd2nussu2cm3zjfhn4ekwrucc4q7t7": "TgdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0n84"
 * }
 * ```
 */
export type CASAnnouncement = {
  [key: string]: string
}

/**
 * See {@link https://dcdpr.github.io/did-btcr2/terminology.html#sidecar | Sidecar }
 * for more details about the sidecar mechanism. See {@link https://dcdpr.github.io/did-btcr2/data-structures.html#sidecar-data | Sidecar Data}
 * for more details about the data structure.
 */
export type Sidecar = {
  /**
   * The context string "https://btcr2.dev/context/v1"
   */
  '@context'?: string,

  /**
   * Optional Genesis Did Document. Required when resolving did:btcr2 identifiers
   * with `x` HRP.D
   */
  genesisDocument?: object;

  /**
   * Optional array of BTCR2 Signed Updates. Required if the DID being resolved
   * has ever had a published BTCR2 Update.
   */
  updates?: Array<SignedBTCR2Update>

  /**
   * Optional array of CAS Announcements. Required if the DID being reslved has
   * used a CAS Beacon to publish a BTCR2 Update.
   */
  casUpdates?: Array<CASAnnouncement>;

  /**
   * Optional array of SMT Proofs. Required if the DID being resolved has used
   * an SMT Beacon to publish a BTCR2 Update.
   */
  smtProofs?: Array<SMTProof>;
};

/**
 * The Sidecar data structure post-processing used for resolution.
 */
export type SidecarData = {
  /**
   * Map of BTCR2 Signed Updates by their hash bytes.
   * @type {Map<HexString, SignedBTCR2Update>}
   */
  updateMap: Map<HexString, SignedBTCR2Update>;
  /**
   * Map of CAS Announcements by their hash bytes.
   * @type {Map<HexString, CASAnnouncement>}
   */
  casMap: Map<HexString, CASAnnouncement>;
  /**
   * Map of SMT Proofs by their ID.
   * @type {Map<string, SMTProof>}
   */
  smtMap: Map<string, SMTProof>;
}
