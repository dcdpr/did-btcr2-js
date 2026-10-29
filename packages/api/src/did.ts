import type { NetworkName } from '@did-btcr2/bitcoin';
import type { DocumentBytes } from '@did-btcr2/std';
import { IdentifierTypes } from '@did-btcr2/std';
import { SchnorrKeyPair } from '@did-btcr2/keys';
import type { SchnorrKeyPairObject } from '@did-btcr2/std';
import type { DidComponents, DidCreateOptions, IdentifierReport, IdentifierValidateOptions } from '@did-btcr2/method';
import { Identifier } from '@did-btcr2/method';
import { Did } from '@web5/dids';

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
   * @throws {IdentifierError} `INVALID_DID` for each input fault, for example genesis bytes
   *   that are not a `Uint8Array` of the length of the identifier type.
   */
  encode(genesisBytes: DocumentBytes, options: DidCreateOptions): string {
    return Identifier.encode(genesisBytes, options);
  }

  /**
   * Decode a DID into its components.
   * @param did The DID string to decode.
   * @returns The decoded identifier components, with the Bech32m `hrp`.
   * @throws {IdentifierError} `INVALID_DID` if the DID is not a valid did:btcr2 identifier,
   *   also if it is `''` or not a string.
   * @throws {IdentifierError} `METHOD_NOT_SUPPORTED` if the DID is a DID of another method.
   */
  decode(did: string): DidComponents {
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
