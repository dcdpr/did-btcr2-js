import type { Bytes, DocumentBytes, KeyBytes, SchnorrKeyPairObject } from '@did-btcr2/common';
import {
  BitcoinNetworkNames,
  canonicalHashBytes,
  IdentifierError,
  IdentifierTypes,
  INVALID_DID,
  METHOD_NOT_SUPPORTED
} from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
import { equalBytes } from '@noble/curves/utils.js';
import { bech32m, hex } from '@scure/base';
import type { DidCreateOptions } from '../did-btcr2.js';
// did-document.js imports this module. Both modules use the other only inside a
// method body, never at module evaluation, so the cycle is safe in ESM and CJS.
import { GenesisDocument, ID_PLACEHOLDER_VALUE } from '../utils/did-document.js';

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
 * The name of one check that {@link Identifier.validate} runs. The names are in run order.
 * @typedef {string} IdentifierCheckName
 */
export type IdentifierCheckName =
  | 'prefix'
  | 'lowercase'
  | 'bech32m'
  | 'version'
  | 'network'
  | 'genesisBytes'
  | 'roundTrip'
  | 'genesisBytesMatch'
  | 'genesisDocument';

/**
 * The result of one check that {@link Identifier.validate} ran.
 * @interface IdentifierCheck
 * @property {IdentifierCheckName} name The name of the check.
 * @property {boolean} ok True if the check passed.
 * @property {string} [detail] What the check found.
 */
export interface IdentifierCheck {
    name: IdentifierCheckName;
    ok: boolean;
    detail?: string;
}

/**
 * Options for {@link Identifier.validate}.
 * @interface IdentifierValidateOptions
 * @property {Bytes} [genesisBytes] The genesis bytes that the identifier must encode: the 33-byte
 *   compressed public key of a KEY identifier, or the 32-byte genesis document hash of an EXTERNAL
 *   identifier. If present, the report includes the `genesisBytesMatch` check.
 * @property {object} [genesisDocument] The genesis document of an EXTERNAL identifier.
 *   If present, the report includes the `genesisDocument` check.
 */
export interface IdentifierValidateOptions {
    genesisBytes?: Bytes;
    genesisDocument?: object;
}

/**
 * The report that {@link Identifier.validate} returns.
 * @interface IdentifierReport
 * @property {string} did The identifier that was verified.
 * @property {boolean} valid True if every check passed.
 * @property {IdentifierTypes} [idType] The identifier type, known after the `bech32m` check.
 * @property {string} [network] The network name, known after the `network` check.
 * @property {Array<IdentifierCheck>} checks The checks that ran, in run order. The run stops at the first failed check.
 */
export interface IdentifierReport {
    did: string;
    valid: boolean;
    idType?: IdentifierTypes;
    network?: string;
    checks: Array<IdentifierCheck>;
}

/** The prefix of every did:btcr2 identifier. */
const DID_PREFIX = 'did:btcr2:';

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
    return `${DID_PREFIX}${bech32m.encodeFromBytes(hrp, dataBytes)}`;
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

    // 6. The method-specific id MUST be lowercase. A Bech32m decoder accepts an all-uppercase
    //    string, so this check runs before the Bech32m step.
    if (encoded !== encoded.toLowerCase()) {
      throw new IdentifierError(`Invalid method-specific id (must be lowercase): ${identifier}`, INVALID_DID, { identifier });
    }

    // 7. Bech32m-decode the id into its hrp and dataBytes.
    const { prefix: hrp, bytes: dataBytes } = bech32m.decodeToBytes(encoded);

    // 8. The hrp MUST be "k" (KEY) or "x" (EXTERNAL).
    if (!['x', 'k'].includes(hrp)) {
      throw new IdentifierError(`Invalid hrp: ${hrp}`, INVALID_DID, { identifier });
    }

    // 9. There MUST be at least one byte to read btcr2_version and network_value from.
    if (!dataBytes || dataBytes.length < 1) {
      throw new IdentifierError(`Failed to decode id: ${encoded}`, INVALID_DID, { identifier });
    }

    // 10. Map hrp to idType.
    const idType = hrp === 'k' ? 'KEY' : 'EXTERNAL';

    // 11. btcr2_version is the high nibble of the first byte and MUST be 0, which is version_number 1.
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

    // 12. network_value is the low nibble of the first byte. 0-5 map to named networks. 6-11 are
    //     reserved. 12-15 are custom networks; this implementation supports no custom network, so the
    //     decoder rejects them, as the specification recommends (ADR 107).
    const networkValue = dataBytes[0] & 0x0F;
    const network = BitcoinNetworkNames[networkValue] as string | undefined;
    if (typeof network !== 'string') {
      const reason = networkValue >= 12 ? 'custom network not supported' : 'reserved';
      throw new IdentifierError(`Invalid network (${reason}): ${networkValue}`, INVALID_DID, { identifier });
    }

    // 13. genesisBytes is everything after the first byte.
    const genesisBytes = dataBytes.slice(1);

    // 14. genesisBytes MUST match the identifier type: a valid compressed secp256k1 public key for KEY,
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

    // 15. Return idType, hrp, version, network, and genesisBytes.
    return { idType, hrp, version, network, genesisBytes } as DidComponents;
  }

  /**
   * Validates that a did:btcr2 identifier conforms to
   * {@link https://dcdpr.github.io/did-btcr2/#didbtcr2-identifier-decoding | 3.3 did:btcr2 Identifier Decoding}
   * and returns a report of the checks. The method does not throw on an invalid identifier.
   *
   * The checks run in this order: `prefix`, `lowercase`, `bech32m`, `version`, `network`,
   * `genesisBytes`, `roundTrip`, `genesisBytesMatch`, and `genesisDocument`. The run stops at the
   * first failed check. The `network` check accepts a named network only: a reserved value (6 to
   * 11) and a custom value (12 to 15) fail, because this implementation supports no custom network.
   * The `genesisBytesMatch` check runs only if `options.genesisBytes` is present: the supplied bytes
   * must equal the genesis bytes of the identifier, for a KEY or an EXTERNAL identifier. The
   * `genesisDocument` check runs only if `options.genesisDocument` is present. For an EXTERNAL
   * identifier it confirms that the document is a valid Genesis Document and that its canonical
   * SHA-256 hash equals the genesis bytes. For a KEY identifier it fails.
   *
   * @param {string} identifier The did:btcr2 identifier to validate.
   * @param {IdentifierValidateOptions} [options] The validation options.
   * @returns {IdentifierReport} The report. See {@link IdentifierReport} for details.
   */
  static validate(identifier: string, options: IdentifierValidateOptions = {}): IdentifierReport {
    const checks: Array<IdentifierCheck> = [];
    const pass = (name: IdentifierCheckName, detail?: string): void => {
      checks.push(detail === undefined ? { name, ok: true } : { name, ok: true, detail });
    };
    const fail = (name: IdentifierCheckName, detail: string, partial: Partial<IdentifierReport> = {}): IdentifierReport => {
      checks.push({ name, ok: false, detail });
      return { did: identifier, valid: false, ...partial, checks };
    };

    // prefix: the string is "did:btcr2:" followed by a non-empty method-specific id.
    if (typeof identifier !== 'string') {
      return fail('prefix', 'The identifier is not a string.');
    }
    const parts = identifier.split(':');
    if (parts.length !== 3 || parts[0] !== 'did' || parts[1] !== 'btcr2') {
      return fail('prefix', `The identifier must be "${DID_PREFIX}" followed by the method-specific id.`);
    }
    const encoded = parts[2];
    if (encoded.length === 0) {
      return fail('prefix', 'The method-specific id is empty.');
    }
    pass('prefix');

    // lowercase: the method-specific id is lowercase.
    if (encoded !== encoded.toLowerCase()) {
      return fail('lowercase', 'The method-specific id must be lowercase.');
    }
    pass('lowercase');

    // bech32m: the id decodes, the hrp is "k" or "x", and the data bytes are not empty.
    let hrp: string;
    let dataBytes: Uint8Array;
    try {
      ({ prefix: hrp, bytes: dataBytes } = bech32m.decodeToBytes(encoded));
    } catch (error: unknown) {
      return fail('bech32m', `Bech32m decoding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (hrp !== 'k' && hrp !== 'x') {
      return fail('bech32m', `The hrp must be "k" or "x", got "${hrp}".`);
    }
    const idType = hrp === 'k' ? IdentifierTypes.KEY : IdentifierTypes.EXTERNAL;
    if (dataBytes.length < 1) {
      return fail('bech32m', 'The data bytes are empty.', { idType });
    }
    pass('bech32m', `hrp "${hrp}", ${dataBytes.length} data bytes`);

    // version: btcr2_version (the high nibble of the first byte) is 0.
    const btcr2Version = dataBytes[0] >>> 4;
    if (btcr2Version !== 0) {
      return fail('version', `btcr2_version must be 0, got ${btcr2Version}.`, { idType });
    }
    pass('version', 'btcr2_version 0 (version_number 1)');

    // network: network_value (the low nibble of the first byte) names a network.
    const networkValue = dataBytes[0] & 0x0F;
    const network = BitcoinNetworkNames[networkValue] as string | undefined;
    if (typeof network !== 'string') {
      const detail = networkValue >= 12
        ? `network_value ${networkValue} is a custom network, not supported by this implementation.`
        : `network_value ${networkValue} is reserved.`;
      return fail('network', detail, { idType });
    }
    pass('network', `network_value ${networkValue} (${network})`);

    // genesisBytes: a 33-byte SEC compressed secp256k1 public key (KEY) or a 32-byte hash (EXTERNAL).
    const genesisBytes = dataBytes.slice(1);
    if (idType === IdentifierTypes.KEY) {
      try {
        new CompressedSecp256k1PublicKey(genesisBytes);
      } catch {
        return fail(
          'genesisBytes',
          `Expected a 33-byte SEC compressed secp256k1 public key, got ${genesisBytes.length} bytes that are not a valid key.`,
          { idType, network }
        );
      }
      pass('genesisBytes', '33-byte SEC compressed secp256k1 public key');
    } else {
      if (genesisBytes.length !== 32) {
        return fail('genesisBytes', `Expected a 32-byte SHA-256 hash, got ${genesisBytes.length} bytes.`, { idType, network });
      }
      pass('genesisBytes', '32-byte SHA-256 hash');
    }

    // roundTrip: encoding the decoded components reproduces the identifier.
    let reEncoded: string;
    try {
      reEncoded = Identifier.encode(genesisBytes, { idType, version: 1, network: network as DidCreateOptions['network'] });
    } catch (error: unknown) {
      return fail('roundTrip', `Re-encoding failed: ${error instanceof Error ? error.message : String(error)}`, { idType, network });
    }
    if (reEncoded !== identifier) {
      return fail('roundTrip', `Re-encoding produced "${reEncoded}".`, { idType, network });
    }
    pass('roundTrip');

    // genesisBytesMatch: only if the caller supplied genesis bytes.
    if (options.genesisBytes !== undefined) {
      const supplied = options.genesisBytes;
      if (!(supplied instanceof Uint8Array)) {
        return fail('genesisBytesMatch', 'The supplied genesis bytes are not a Uint8Array.', { idType, network });
      }
      if (supplied.length !== genesisBytes.length) {
        return fail(
          'genesisBytesMatch',
          `Expected ${genesisBytes.length} genesis bytes for a ${idType} identifier, got ${supplied.length}.`,
          { idType, network }
        );
      }
      if (!equalBytes(supplied, genesisBytes)) {
        return fail(
          'genesisBytesMatch',
          `The supplied genesis bytes ${hex.encode(supplied)} do not equal the genesis bytes of the identifier ${hex.encode(genesisBytes)}.`,
          { idType, network }
        );
      }
      pass('genesisBytesMatch', 'The supplied genesis bytes equal the genesis bytes of the identifier.');
    }

    // genesisDocument: only if the caller supplied a document.
    if (options.genesisDocument !== undefined) {
      const document = options.genesisDocument;
      if (idType === IdentifierTypes.KEY) {
        return fail('genesisDocument', 'A KEY identifier has no genesis document.', { idType, network });
      }
      const id = (document as { id?: unknown }).id;
      if (id !== ID_PLACEHOLDER_VALUE) {
        return fail('genesisDocument', `The genesis document id must be "${ID_PLACEHOLDER_VALUE}", got ${JSON.stringify(id)}.`, { idType, network });
      }
      try {
        GenesisDocument.fromJSON(document);
      } catch (error: unknown) {
        return fail('genesisDocument', `Invalid genesis document: ${error instanceof Error ? error.message : String(error)}`, { idType, network });
      }
      const documentHash = canonicalHashBytes(document);
      if (!equalBytes(documentHash, genesisBytes)) {
        return fail(
          'genesisDocument',
          `The genesis document hash ${hex.encode(documentHash)} does not equal the genesis bytes ${hex.encode(genesisBytes)}.`,
          { idType, network }
        );
      }
      pass('genesisDocument', 'The genesis document hashes to the genesis bytes.');
    }

    return { did: identifier, valid: true, idType, network, checks };
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
