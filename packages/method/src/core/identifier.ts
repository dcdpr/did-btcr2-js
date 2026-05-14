import type { Bytes, DocumentBytes, KeyBytes, SchnorrKeyPairObject } from '@did-btcr2/common';
import { BitcoinNetworkNames, IdentifierError, IdentifierTypes, INVALID_DID, METHOD_NOT_SUPPORTED } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
import { bech32m } from '@scure/base';
import type { DidCreateOptions } from '../did-btcr2.js';

/**
 * Components of a did:btcr2 identifier.
 * @interface DidComponents
 * @extends {IdentifierComponents}
 * @property {string} hrp The human-readable part of the Bech32m encoding.
 */
export interface DidComponents extends IdentifierComponents {
    hrp: string;
};

/**
 * Components of a did:btcr2 identifier.
 * @interface IdentifierComponents
 * @property {string} idType Identifier type (key or external).
 * @property {number} version Identifier version.
 * @property {string} network Bitcoin network name or number.
 * @property {Bytes} genesisBytes Public key or an intermediate document bytes.
 */
export interface IdentifierComponents {
    idType: string;
    version: number;
    network: string;
    genesisBytes: Bytes;
}
/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#syntax | 3 Syntax}.
 * A did:btcr2 DID consists of a did:btcr2 prefix, followed by an id-bech32 value, which is a Bech32m encoding of:
 *    - the specification version;
 *    - the Bitcoin network identifier; and
 *    - either:
 *      - a key-value representing a secp256k1 public key; or
 *      - a hash-value representing the hash of an initiating external DID document.
 * @class Identifier
 * @type {Identifier}
 */
export class Identifier {
  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#didbtcr2-identifier-encoding | 3.2 did:btcr2 Identifier Encoding}.
   *
   * A did:btcr2 DID consists of a did:btcr2 prefix, followed by an id-bech32 value, which is a Bech32m encoding of:
   *  - the specification version;
   *  - the Bitcoin network identifier; and
   *  - either:
   *    - a key-value representing a secp256k1 public key; or
   *    - a hash-value representing the hash of an initiating external DID document.
   *
   * @param {KeyBytes | DocumentBytes} genesisBytes The genesis bytes (public key or document bytes).
   * @param {DidCreateOptions} options The DID creation options.
   * @returns {string} The new did:btcr2 identifier.
   */
  static encode(genesisBytes: KeyBytes | DocumentBytes, options: DidCreateOptions): string {
    // Deconstruct the options
    const { idType, version = 1, network } = options;

    // If idType is not a valid value per above, raise invalidDid error.
    if (!(idType in IdentifierTypes)) {
      throw new IdentifierError('Expected "idType" to be "KEY" or "EXTERNAL"', INVALID_DID, {idType});
    }

    // If version does not equal 1, raise invalidDid error.
    if (version !== 1) {
      throw new IdentifierError('Expected "version" to be 1', INVALID_DID, {version});
    }

    // If network is not a valid value (bitcoin|signet|regtest|testnet3|testnet4|number), raise invalidDid error.
    if (!network || !(network in BitcoinNetworkNames)) {
      throw new IdentifierError('Invalid "network" name', INVALID_DID, {network});
    }

    // If idType is "key" and genesisBytes is not a valid compressed secp256k1 public key, raise invalidDid error.
    if (idType === 'KEY') {
      try {
        new CompressedSecp256k1PublicKey(genesisBytes);
      } catch {
        throw new IdentifierError(
          'Expected "genesisBytes" to be a valid compressed secp256k1 public key',
          INVALID_DID, { genesisBytes }
        );
      }
    }

    // If idType is "external" and genesisBytes is not a 32-byte hash, raise invalidDid error.
    if(idType === 'EXTERNAL' && genesisBytes.length !== 32) {
      throw new IdentifierError(
        'Expected "genesisBytes" to be a 32-byte hash',
        INVALID_DID, { genesisBytes }
      );
    }

    // Map idType to hrp
    //  KEY = "k"
    //  EXTERNAL = "x"
    const hrp = idType === 'KEY' ? 'k' : 'x';

    // Subtract 1 from version to get did:btcr2 version
    const btcr2Version = version - 1;

    // Map network to networkValue
    const networkValue = BitcoinNetworkNames[network as keyof typeof BitcoinNetworkNames];

    // Construct the first byte by combining the version and networkValue
    const firstByte = (btcr2Version << 4) | networkValue;

    // Combine first byte (version and network) with gensisBytes
    const dataBytes = new Uint8Array([firstByte, ...genesisBytes]);

    // Encode using bech32m and return
    return `did:btcr2:${bech32m.encodeFromBytes(hrp, dataBytes)}`;
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#didbtcr2-identifier-decoding | 3.3 did:btcr2 Identifier Decoding}.
   * @param {string} identifier The BTCR2 DID to be parsed
   * @returns {DidComponents} The parsed identifier components. See {@link DidComponents} for details.
   * @throws {DidError} if an error occurs while parsing the identifier
   * @throws {DidErrorCode.InvalidDid} if identifier is invalid
   * @throws {DidErrorCode.MethodNotSupported} if the method is not supported
   */
  static decode(identifier: string): DidComponents {
    // Split identifier into an array of components at the colon : character.
    const components = identifier.split(':');

    // If the length of the components array is not 3, raise invalidDid error.
    if (components.length !== 3){
      throw new IdentifierError(
        `Invalid did: components array has ${components.length} elements, expected 3`,
        INVALID_DID, { identifier });
    }

    // Deconstruct the components of the identifier: scheme, method, encoded
    const [scheme, method, encoded] = components;

    // If components[0] is not "did", raise invalidDid error.
    if (scheme !== 'did') {
      throw new IdentifierError(`Invalid did: scheme ${scheme} is not supported`, INVALID_DID, { identifier });
    }
    // If components[1] is not "btcr2", raise methodNotSupported error.
    if (method !== 'btcr2') {
      throw new IdentifierError(`Invalid did: method ${method} is not supported`, METHOD_NOT_SUPPORTED, { identifier });
    }

    // Set encodedString to components[2].
    if (!encoded) {
      throw new IdentifierError(`Invalid method-specific id: ${identifier}`, INVALID_DID, { identifier });
    }
    // Pass encodedString to the Bech32m Decoding algorithm, retrieving hrp and dataBytes.
    const {prefix: hrp, bytes: dataBytes} = bech32m.decodeToBytes(encoded);

    // If the Bech32m decoding algorithm fails, raise invalidDid error.
    if (!['x', 'k'].includes(hrp)) {
      throw new IdentifierError(`Invalid did: hrp ${hrp} is not supported`, INVALID_DID, { identifier });
    }

    if (!dataBytes) {
      throw new IdentifierError(
        `Invalid did: failed to bech32m decode ${encoded}`,
        INVALID_DID, { identifier });
    }

    // Map hrp to idType from the following:
    //    "k" = "KEY"
    //    "x" = "EXTERNAL"
    const idType = hrp === 'k' ? 'KEY' : 'EXTERNAL';

    // Per Table 2 Unencoded Data Bytes: byte 0 is btcr2_version in the upper 4 bits,
    // network_value in the lower 4 bits. (Spec footnotes [^1]/[^2] use Little Endian
    // bit indexing where the spec's "low nibble" = upper 4 bits.)
    if (dataBytes.length < 1) {
      throw new IdentifierError(`Invalid did: empty data bytes: ${identifier}`, INVALID_DID, { identifier });
    }
    const btcr2Version = dataBytes[0] >>> 4;
    const networkValue = dataBytes[0] & 0x0F;

    // btcr2_version MUST be 0, yielding version_number = 1.
    if (btcr2Version !== 0) {
      throw new IdentifierError(
        `Invalid did: btcr2_version ${btcr2Version} must be 0`,
        INVALID_DID, { identifier }
      );
    }
    const version = btcr2Version + 1;

    // network_value MUST match Table 1: 0-5 named, 6-11 reserved, 12-14 custom, 15 invalid.
    let network: string | number;
    if (networkValue <= 5) {
      network = BitcoinNetworkNames[networkValue];     // bitcoin..mutinynet
    } else if (networkValue >= 12 && networkValue <= 14) {
      network = networkValue - 11;                     // custom networks 1, 2, 3
    } else {
      throw new IdentifierError(
        `Invalid did: network_value ${networkValue} is reserved or out of range`,
        INVALID_DID, { identifier }
      );
    }

    // genesis_bytes is the remainder.
    const genesisBytes = dataBytes.slice(1);

    // 19. If idType is "key" and genesisBytes is not a valid compressed secp256k1 public key, raise invalidDid error.
    if (idType === 'KEY') {
      try {
        new CompressedSecp256k1PublicKey(genesisBytes);
      } catch {
        throw new IdentifierError(`Invalid genesisBytes: ${genesisBytes}`, INVALID_DID, { identifier });
      }
    }

    // 20. Return idType, version, network, and genesisBytes.
    return {idType, hrp, version, network, genesisBytes} as DidComponents;
  }

  /**
   * Generates a new did:btcr2 identifier based on a newly generated key pair.
   * @returns {string} The new did:btcr2 identifier.
   */
  static generate(): { keyPair: SchnorrKeyPairObject; did: string } {
    const keyPair  = SchnorrKeyPair.generate();
    const did = this.encode(keyPair.publicKey.compressed,
      {
        idType       : 'KEY',
        version      : 1,
        network      : 'regtest'
      }
    );
    return { keyPair: keyPair.exportJSON(), did };
  }

  /**
   * Extracts the compressed secp256k1 public key from a KEY-type did:btcr2 identifier.
   * @param {string} did The did:btcr2 identifier to extract the public key from.
   * @returns {CompressedSecp256k1PublicKey} The compressed public key.
   * @throws {IdentifierError} If the DID is EXTERNAL type (genesis bytes are a hash, not a pubkey).
   */
  static getPublicKey(did: string): CompressedSecp256k1PublicKey {
    const { idType, genesisBytes } = Identifier.decode(did);
    if(idType !== 'KEY') {
      throw new IdentifierError(
        `Cannot extract public key from EXTERNAL DID: ${did}. EXTERNAL DIDs encode a document hash, not a public key.`,
        INVALID_DID, { did, idType }
      );
    }
    return new CompressedSecp256k1PublicKey(genesisBytes);
  }

  /**
   * Validates a did:btcr2 identifier.
   * @param {string} identifier The did:btcr2 identifier to validate.
   * @returns {boolean} True if the identifier is valid, false otherwise.
   */
  static isValid(identifier: string): boolean {
    try {
      this.decode(identifier);
      return true;
    } catch {
      return false;
    }
  }
}