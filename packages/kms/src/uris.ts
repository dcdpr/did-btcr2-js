import { base58btc } from 'multiformats/bases/base58';
import type { Algo, KeyIdentifier } from './types.js';

export function fingerprint(pub: Uint8Array): string {
  return 'z' + base58btc.encode(pub);
}

export function makeKeyUri(scope: string, algo: Algo, pub: Uint8Array, derivation?: string): KeyIdentifier {
  const fp = fingerprint(pub);
  return derivation
    ? `urn:kms:${scope}:${algo}:${fp}@${derivation}`
    : `urn:kms:${scope}:${algo}:${fp}`;
}