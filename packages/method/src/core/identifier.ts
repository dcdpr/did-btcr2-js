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
    // Deconstruct the options, defaulting version to 1 and network to "bitcoin" (matching DidBtcr2.create).
    const { idType, version = 1, network = 'bitcoin' } = options;

    // idType MUST be "KEY" or "EXTERNAL".
    if (!(idType in IdentifierTypes)) {
      throw new IdentifierError('Expected "idType" to be "KEY" or "EXTERNAL"', INVALID_DID, { idType });
    }

    // The only valid version_number is 1 (which encodes a btcr2_version of 0). Any other value would
    // overflow or corrupt the version nibble, so reject everything except exactly 1. This also rejects
    // NaN and non-number inputs, which are never strictly equal to 1.
    if (version !== 1) {
      throw new IdentifierError('Expected "version" to be 1', INVALID_DID, { version });
    }

    // network MUST be a known network name. This encoder does not mint custom/numeric networks: the
    // public surface (DidCreateOptions.network) is a string, and a numeric nibble >= 5 would overflow
    // the 4-bit network field and corrupt the version nibble. Custom networks remain decode-only.
    if (typeof network !== 'string') {
      throw new IdentifierError('Expected "network" to be a known network name', INVALID_DID, { network });
    }
    const networkValue = BitcoinNetworkNames[network as keyof typeof BitcoinNetworkNames] as number | undefined;
    if (networkValue === undefined) {
      throw new IdentifierError('Invalid "network" name', INVALID_DID, { network });
    }

    // genesisBytes MUST match the identifier type: a valid compressed secp256k1 public key for KEY,
    // or a 32-byte hash for EXTERNAL. An EXTERNAL DID minted with any other length is unresolvable.
    if (idType === 'KEY') {
      try {
        new CompressedSecp256k1PublicKey(genesisBytes);
      } catch {
        throw new IdentifierError(
          'Expected "genesisBytes" to be a valid compressed secp256k1 public key',
          INVALID_DID, { genesisBytes }
        );
      }
    } else if (genesisBytes.length !== 32) {
      throw new IdentifierError(
        'Expected "genesisBytes" to be a 32-byte hash for EXTERNAL identifiers',
        INVALID_DID, { genesisBytes }
      );
    }

    // Map idType to its human-readable part: KEY -> "k", EXTERNAL -> "x".
    const hrp = idType === 'KEY' ? 'k' : 'x';

    // Pack btcr2_version (high nibble, = version - 1 = 0) and network_value (low nibble) into the first
    // byte, then append genesisBytes. Bech32m-encode the result.
    const firstByte = ((version - 1) << 4) | networkValue;
    const dataBytes = new Uint8Array([firstByte, ...genesisBytes]);
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
    // 1. Split the identifier into scheme, method, and encoded id at the colon character.
    const components = identifier.split(':');

    // 2. There MUST be exactly three colon-separated components.
    if (components.length !== 3){
      throw new IdentifierError(`Invalid did: ${identifier}`, INVALID_DID, { identifier });
    }

    const [scheme, method, encoded] = components;

    // 3. The scheme MUST be "did".
    if (scheme !== 'did') {
      throw new IdentifierError(`Invalid did: ${identifier}`, INVALID_DID, { identifier });
    }

    // 4. The method MUST be "btcr2".
    if (method !== 'btcr2') {
      throw new IdentifierError(`Invalid did method: ${method}`, METHOD_NOT_SUPPORTED, { identifier });
    }

    // 5. The method-specific id MUST be present.
    if (!encoded) {
      throw new IdentifierError(`Invalid method-specific id: ${identifier}`, INVALID_DID, { identifier });
    }

    // 6. Bech32m-decode the id into its hrp and dataBytes.
    const { prefix: hrp, bytes: dataBytes } = bech32m.decodeToBytes(encoded);

    // 7. The hrp MUST be "k" (KEY) or "x" (EXTERNAL).
    if (!['x', 'k'].includes(hrp)) {
      throw new IdentifierError(`Invalid hrp: ${hrp}`, INVALID_DID, { identifier });
    }

    // 8. There MUST be at least one byte to read btcr2_version and network_value from.
    if (!dataBytes || dataBytes.length < 1) {
      throw new IdentifierError(`Failed to decode id: ${encoded}`, INVALID_DID, { identifier });
    }

    // 9. Map hrp to idType.
    const idType = hrp === 'k' ? 'KEY' : 'EXTERNAL';

    // 10. btcr2_version is the high nibble of the first byte and MUST be 0, which is version_number 1.
    //     The version-extension scheme (a leading nibble of 0xF chaining into further bytes) is reserved
    //     and not valid under v1, so any non-zero high nibble (0x1 through 0xF) is a malformed or forged
    //     identifier and is rejected here. Reading a single flat nibble (rather than looping on 0xF) is
    //     what makes this guard actually fire: the previous loop body never ran for a leading nibble of
    //     0x1 through 0xE, silently accepting forged versions.
    const btcr2Version = dataBytes[0] >>> 4;
    if (btcr2Version !== 0) {
      throw new IdentifierError(`Invalid btcr2_version (expected 0): ${btcr2Version}`, INVALID_DID, { identifier });
    }
    const version = 1;

    // 11. network_value is the low nibble of the first byte. 0-5 map to named networks; 12-14 are custom
    //     networks (returned as the numeric values 1-3); 6-11 and 15 are reserved/out-of-range and rejected.
    const networkValue = dataBytes[0] & 0x0F;
    const networkName = BitcoinNetworkNames[networkValue] as string | undefined;
    let network: string | number;
    if (typeof networkName === 'string') {
      network = networkName;
    } else if (networkValue >= 12 && networkValue <= 14) {
      network = networkValue - 11;
    } else {
      throw new IdentifierError(`Invalid network: ${networkValue}`, INVALID_DID, { identifier });
    }

    // 12. genesisBytes is everything after the first byte.
    const genesisBytes = dataBytes.slice(1);

    // 13. genesisBytes MUST match the identifier type: a valid compressed secp256k1 public key for KEY,
    //     or a 32-byte hash for EXTERNAL.
    if (idType === 'KEY') {
      try {
        new CompressedSecp256k1PublicKey(genesisBytes);
      } catch {
        throw new IdentifierError(`Invalid genesisBytes: ${genesisBytes}`, INVALID_DID, { identifier });
      }
    } else if (genesisBytes.length !== 32) {
      throw new IdentifierError(`Invalid genesisBytes: ${genesisBytes}`, INVALID_DID, { identifier });
    }

    // 14. Return idType, hrp, version, network, and genesisBytes.
    return { idType, hrp, version, network, genesisBytes } as DidComponents;
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