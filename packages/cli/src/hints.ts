import { explorerAddressUrl, explorerTxUrl, faucetUrl } from '@did-btcr2/api';
import { BeaconUtils } from '@did-btcr2/method';
import type { GlobalOptions, NetworkOption } from './types.js';

/**
 * Text-mode stderr hints derived from the per-network presets (ADR 082). All of
 * these are suppressed under `--quiet` and `--output json` so machine output is
 * never touched, and they never throw: a presentation hint must never break the
 * command that produced the real result.
 */

/**
 * Prints a funding hint after a KEY `create` on a network with a public faucet:
 * the derived initial P2WPKH beacon address next to the faucet and explorer
 * links the operator would otherwise hand-copy. A no-op on a network without a
 * faucet (regtest/mainnet), which also keeps mainnet from showing a fund-me
 * affordance. The beacon address is derived from the DID string alone via
 * {@link BeaconUtils.createBeaconService}, so it matches the resolver's
 * `#initialP2WPKH` service rather than a divergent re-derivation.
 */
export function printCreateFundingHint(g: GlobalOptions, network: NetworkOption, did: string): void {
  if (g.quiet || g.output === 'json') return;
  let beaconAddress: string;
  try {
    const { serviceEndpoint } = BeaconUtils.createBeaconService(did, 'p2wpkh', 'SingletonBeacon');
    beaconAddress = serviceEndpoint.replace(/^bitcoin:/, '');
  } catch {
    return;
  }
  printBeaconFundingHint(g, network, beaconAddress);
}

/**
 * Prints a funding hint for a beacon address on a network with a public
 * faucet: the address next to the faucet and explorer links. A no-op on a
 * network without a faucet (regtest/mainnet). `create -t x --document` and
 * `genesis build` use it for the first beacon of the genesis document.
 */
export function printBeaconFundingHint(g: GlobalOptions, network: NetworkOption, beaconAddress: string): void {
  if (g.quiet || g.output === 'json') return;
  const faucet = faucetUrl(network);
  if (!faucet) return;
  const explorer = explorerAddressUrl(network, beaconAddress);
  const lines = [
    'Fund the initial beacon to anchor updates:',
    `  Beacon:   ${beaconAddress}`,
    `  Faucet:   ${faucet}`,
  ];
  if (explorer) lines.push(`  Explorer: ${explorer}`);
  process.stderr.write(`${lines.join('\n')}\n`);
}

/**
 * Prints a watch link after an `update`/`deactivate` broadcast: the
 * block-explorer URL for the signal txid. A no-op on a network without an
 * explorer (regtest).
 */
export function printWatchHint(g: GlobalOptions, network: NetworkOption, txid: string): void {
  if (g.quiet || g.output === 'json') return;
  const url = explorerTxUrl(network, txid);
  if (url) process.stderr.write(`Watch: ${url}\n`);
}
