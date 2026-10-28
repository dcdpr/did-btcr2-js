import type { HDKey } from '@scure/bip32';

/* Crypto Types */
export type Bytes = Uint8Array;
export type Hex = Bytes | string;
export type HexString = string;

export type DocumentBytes = Bytes;
export type SignatureBytes = Bytes;
export type ProofBytes = Bytes;
export type HashBytes = Bytes;
export type MessageBytes = Bytes;
export type Entropy = Bytes | bigint;

export type KeyBytes = Bytes;
export type Point = {
  x: Array<number>;
  y: Array<number>;
  parity: number;
}
export type PublicKeyObject = {
  point: Point;
  hex: HexString;
  multibase: MultibaseObject;
};
export type SecretKeyObject = {
  bytes: Array<number>;
  seed?: string;
  hex?: HexString;
};
export type SchnorrKeyPair = {
  secretKey: KeyBytes;
  publicKey: KeyBytes;
};
export type SchnorrKeyPairObject = {
  secretKey: SecretKeyObject;
  publicKey: PublicKeyObject;
};
export type MultibaseObject = {
  encoded: string;
  prefix: Bytes;
  key: Array<number>;
};
export type HdWallet = {
    mnemonic: string;
    hdkey: HDKey
};
export enum IdentifierTypes {
    KEY = 'KEY',
    EXTERNAL = 'EXTERNAL'
}
export enum IdentifierHrp {
    k = 'k',
    x = 'x'
}
export enum BitcoinNetworkNames {
    bitcoin = 0,
    signet = 1,
    regtest = 2,
    testnet3 = 3,
    testnet4 = 4,
    mutinynet = 5
}
export type DecentralizedIdentifier = string;
export type Did = DecentralizedIdentifier;
export type CanonicalizedProofConfig = string;
export type CryptosuiteName = 'bip340-jcs-2025' | 'bip340-rdfc-2025';

/**
 * A problem details object of {@link https://www.rfc-editor.org/rfc/rfc9457 | RFC 9457}. VC Data
 * Integrity uses it for the `errors` and `warnings` of a verification result, with a `type` URL of
 * the form `https://w3id.org/security#<CODE>`.
 */
export type ProblemDetails = {
  /** The URL of the problem type. */
  type: string;
  /** A short text for the problem type. */
  title?: string;
  /** The HTTP status code. */
  status?: number;
  /** The text of this occurrence of the problem. */
  detail?: string;
  /** A URL for this occurrence of the problem. */
  instance?: string;
  /** An extension member. */
  [member: string]: unknown;
};
type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
type JsonObject = { [key: string]: JsonValue };
export type JSONObject = JsonObject;
export type Prototyped = JSONObject;
export type Unprototyped = JSONObject;

/* General Types */
export type Maybe<T> = T | undefined;
export type UnixTimestamp = number;
