import { p2tr_ms } from '@scure/btc-signer';
import { sortKeys } from '@scure/btc-signer/musig2';

/**
 * Test-local copy of the k-of-n fallback leaf construction: a BIP-342
 * CHECKSIGADD multisig over the cohort's BIP-327-sorted x-only keys. Deliberately
 * duplicated from the production builder (src/core/recovery-policy.ts) so a
 * production drift moves the two apart and the tests that cross-check them fail
 * loudly instead of silently tracking it.
 */
export function fallbackLeafScript(cohortKeys: Uint8Array[], fallbackThreshold: number): Uint8Array {
  const xOnlyKeys = sortKeys(cohortKeys.map(k => new Uint8Array(k))).map(k => k.slice(1));
  return p2tr_ms(fallbackThreshold, xOnlyKeys).script;
}
