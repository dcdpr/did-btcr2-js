// Upstream re-exports
export { DidDocument, DidDocumentBuilder, Identifier } from '@did-btcr2/method';
export { IdentifierTypes } from '@did-btcr2/common';
export type {
  BlockV3,
  HttpExecutor,
  NetworkName,
  RawTransactionV2,
  RestConfig,
  RpcConfig
} from '@did-btcr2/bitcoin';
export type {
  Bytes,
  CryptosuiteName,
  DocumentBytes,
  HashBytes,
  Hex,
  JSONObject,
  KeyBytes,
  PatchOperation,
  ProofBytes,
  SchnorrKeyPairObject,
  SignatureBytes
} from '@did-btcr2/common';
export type { MultikeyObject } from '@did-btcr2/cryptosuite';
export type { DidResolutionResult, DidService, DidVerificationMethod } from '@web5/dids';

// Local modules
export * from './types.js';
export * from './helpers.js';
export * from './bitcoin.js';
export * from './cas.js';
export * from './kms.js';
export * from './crypto.js';
export * from './did.js';
export * from './method.js';
export * from './api.js';
