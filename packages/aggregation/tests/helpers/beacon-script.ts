import { getNetwork } from '@did-btcr2/bitcoin';
import { Address, OutScript } from '@scure/btc-signer';
import type { AggregationCohort } from '../../src/index.js';

/**
 * The scriptPubKey of the cohort's funded beacon UTXO, decoded from the beacon
 * address computed at keygen (internal MuSig2 key + recovery script tree). Test
 * txs that stand in for the operator-built beacon spend must use this script as
 * both prevout and self-change script: participants reject any other shape
 */
export function beaconOutputScript(cohort: AggregationCohort): Uint8Array {
  return OutScript.encode(Address(getNetwork(cohort.network)).decode(cohort.beaconAddress));
}
