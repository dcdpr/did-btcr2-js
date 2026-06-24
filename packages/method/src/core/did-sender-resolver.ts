import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { Identifier } from './identifier.js';

/**
 * Resolve a did:btcr2 sender's communication public key from its DID, for the
 * aggregation HTTP transport's `resolveSenderPk` option: a KEY identifier decodes to
 * its genesis public key. The aggregation transport is DID-method-agnostic and does
 * not name `Identifier`; method supplies this resolver when it wires the transport so
 * a sender that is not a pre-registered peer can still be authenticated from its DID.
 *
 * @param did The sender's DID.
 * @returns The sender's compressed public key, or `undefined` when the DID is not a
 *   decodable did:btcr2 KEY identifier (resolution then falls back to registered peers).
 */
export function resolveBtcr2SenderPk(did: string): CompressedSecp256k1PublicKey | undefined {
  try {
    const components = Identifier.decode(did);
    if(components.idType === 'KEY') {
      return new CompressedSecp256k1PublicKey(components.genesisBytes);
    }
  } catch {
    // Not a decodable did:btcr2 KEY identifier.
  }
  return undefined;
}
