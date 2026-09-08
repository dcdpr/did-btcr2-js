import type { NetworkName } from '@did-btcr2/bitcoin';
import type { DocumentBytes } from '@did-btcr2/common';
import { IdentifierTypes } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { SchnorrKeyPairObject } from '@did-btcr2/common';
import type { DidComponents, DidCreateOptions, IdentifierReport, IdentifierValidateOptions } from '@did-btcr2/method';
import { Identifier } from '@did-btcr2/method';
import { Did } from '@web5/dids';
import { assertBytes, assertString } from './helpers.js';

/**
 * DID identifier operations sub-facade (encode, decode, validate, generate, parse).
 * @public
 */
export class DidApi {
  /**
   * Encode a DID from genesis bytes and options.
   * @param genesisBytes The genesis document bytes.
   * @param options The creation options.
   * @returns The encoded DID string.
   */
  encode(genesisBytes: DocumentBytes, options: DidCreateOptions): string {
    assertBytes(genesisBytes, 'genesisBytes');
    return Identifier.encode(genesisBytes, options);
  }

  /**
   * Decode a DID into its components.
   * @param did The DID string to decode.
   * @returns The decoded identifier components, with the Bech32m `hrp`.
   * @throws {IdentifierError} If the DID is not a valid did:btcr2 identifier.
   */
  decode(did: string): DidComponents {
    assertString(did, 'did');
    return Identifier.decode(did);
  }

  /**
   * Validate that a DID conforms to the did:btcr2 identifier decoding algorithm.
   *
   * The report lists the checks in run order and stops at the first failed check.
   * The method does not throw on an invalid DID; `valid` is `false` instead.
   * Pass `options.genesisBytes` to add the `genesisBytesMatch` check: the DID must
   * encode these bytes (the public key of a KEY DID, the genesis document hash of
   * an EXTERNAL DID). Pass `options.genesisDocument` for an EXTERNAL DID to add the
   * `genesisDocument` check: the document must be a valid Genesis Document and its
   * canonical hash must equal the genesis bytes of the DID.
   * @param did The DID string to validate.
   * @param options The validation options.
   * @returns The validation report.
   */
  validate(did: string, options?: IdentifierValidateOptions): IdentifierReport {
    if (typeof did !== 'string') {
      throw new Error('did must be a string.');
    }
    return Identifier.validate(did, options);
  }

  /**
   * Generate a new DID along with its keypair.
   *
   * When no `network` is given, defaults to `'regtest'` (upstream default).
   * Pass an explicit network to generate DIDs for other networks.
   *
   * @param network Optional network to generate the DID for.
   * @returns The generated keypair and DID string.
   */
  generate(network?: NetworkName): { keyPair: SchnorrKeyPairObject; did: string } {
    if (!network) return Identifier.generate();
    const kp = SchnorrKeyPair.generate();
    const did = Identifier.encode(kp.publicKey.compressed, {
      idType : IdentifierTypes.KEY,
      network,
    });
    return { keyPair: kp.exportJSON(), did };
  }

  /**
   * Check if a DID string is valid.
   * @param did The DID string to validate.
   * @returns `true` if valid, `false` otherwise.
   */
  isValid(did: string): boolean {
    if (typeof did !== 'string' || did.length === 0) return false;
    return Identifier.isValid(did);
  }

  /**
   * Parse a DID string into a Did instance.
   * @param did The DID string to parse.
   * @returns The parsed Did instance, or `null` if parsing failed.
   */
  parse(did: string): Did | null {
    if (typeof did !== 'string' || did.length === 0) return null;
    return Did.parse(did);
  }
}
