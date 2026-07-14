import type { NetworkName } from '@did-btcr2/bitcoin';

/**
 * Ancillary, human-facing metadata for a Bitcoin network: the URLs a testnet
 * operator uses on every run (a faucet to fund a beacon address, an explorer to
 * watch a transaction or address). Presets carry links and hints only, never
 * connection behavior: the endpoint config a network resolves to lives in
 * {@link DEFAULT_BITCOIN_NETWORK_CONFIG}, and presets sit beside it so
 * presentation data never leaks into the transport (ADR 082).
 *
 * @public
 */
export interface NetworkPreset {
  /** Faucet page URL for funding testnet beacon addresses. Absent for regtest/mainnet. */
  faucetUrl?       : string;
  /** Block-explorer base URL. The helpers append `/tx/<txid>` and `/address/<addr>`. Absent for regtest. */
  explorerBaseUrl? : string;
  /** Human hint for confirmation cadence, e.g. `'~30 seconds'` (mutinynet). */
  blockTimeHint?   : string;
}

/**
 * Per-network human-facing presets keyed by {@link NetworkName}. The single
 * source of truth for faucet/explorer/block-time metadata, shared by the CLI's
 * text-mode hints and the `lib/` e2e scripts (ADR 082).
 *
 * The explorer base is deliberately its own datum, not derived from the REST
 * host: `mutinynet.com` differs from the `mutinynet.com/api` REST endpoint, and
 * `mempool.space/signet` from `mempool.space/signet/api`, so stripping `/api`
 * is not a reliable shortcut. Regtest has no public faucet or explorer; mainnet
 * has an explorer but intentionally no faucet.
 *
 * @public
 */
export const NETWORK_PRESETS: Record<NetworkName, NetworkPreset> = {
  bitcoin : {
    explorerBaseUrl : 'https://mempool.space',
    blockTimeHint   : '~10 minutes',
  },
  testnet3 : {
    faucetUrl       : 'https://coinfaucet.eu/en/btc-testnet/',
    explorerBaseUrl : 'https://mempool.space/testnet',
    blockTimeHint   : '~10 minutes',
  },
  testnet4 : {
    faucetUrl       : 'https://mempool.space/testnet4/faucet',
    explorerBaseUrl : 'https://mempool.space/testnet4',
    blockTimeHint   : '~10 minutes',
  },
  signet : {
    faucetUrl       : 'https://signetfaucet.com/',
    explorerBaseUrl : 'https://mempool.space/signet',
    blockTimeHint   : '~10 minutes',
  },
  mutinynet : {
    faucetUrl       : 'https://faucet.mutinynet.com/',
    explorerBaseUrl : 'https://mutinynet.com',
    blockTimeHint   : '~30 seconds',
  },
  regtest : {},
};

/**
 * The block-explorer transaction URL for a network, or `undefined` when the
 * network has no explorer (regtest). Appends `/tx/<txid>` to the explorer base.
 * @public
 */
export function explorerTxUrl(network: NetworkName, txid: string): string | undefined {
  const base = NETWORK_PRESETS[network]?.explorerBaseUrl;
  return base ? `${base}/tx/${txid}` : undefined;
}

/**
 * The block-explorer address URL for a network, or `undefined` when the network
 * has no explorer (regtest). Appends `/address/<address>` to the explorer base.
 * @public
 */
export function explorerAddressUrl(network: NetworkName, address: string): string | undefined {
  const base = NETWORK_PRESETS[network]?.explorerBaseUrl;
  return base ? `${base}/address/${address}` : undefined;
}

/**
 * The faucet URL for a network, or `undefined` when the network has no public
 * faucet (regtest, mainnet).
 * @public
 */
export function faucetUrl(network: NetworkName): string | undefined {
  return NETWORK_PRESETS[network]?.faucetUrl;
}
