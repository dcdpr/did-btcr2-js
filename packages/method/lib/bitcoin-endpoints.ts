import { BitcoinConnection, type NetworkName, type RpcConfig } from '@did-btcr2/bitcoin';

/**
 * Per-network default REST endpoints for the method package's dev and e2e
 * scripts. The shipped `@did-btcr2/bitcoin` transport carries no service URLs:
 * those convenience defaults live in the `@did-btcr2/api` SDK. They are
 * duplicated here for tooling because method cannot import from api without
 * inverting the package dependency graph. This file is dev-only, never shipped.
 */
const DEFAULT_REST_HOST: Record<string, string> = {
  bitcoin   : 'https://mempool.space/api',
  testnet3  : 'https://mempool.space/testnet/api',
  testnet4  : 'https://mempool.space/testnet4/api',
  signet    : 'https://mempool.space/signet/api',
  mutinynet : 'https://mutinynet.com/api',
  regtest   : 'http://localhost:3000',
};

/** Default Bitcoin Core RPC host for a local regtest node (e.g. Polar). */
const REGTEST_RPC_HOST = 'http://localhost:18443';

/**
 * Builds a {@link BitcoinConnection} for a dev/e2e script using the default REST
 * host for the network. Pass `rpc` to attach a Bitcoin Core RPC client; its host
 * defaults to the local regtest node when omitted.
 */
export function connectBitcoin(
  network: string,
  options: { restHost?: string; rpc?: Partial<RpcConfig> } = {},
): BitcoinConnection {
  const host = options.restHost ?? DEFAULT_REST_HOST[network];
  if (!host) {
    throw new Error(`No default REST endpoint for network "${network}". Pass options.restHost explicitly.`);
  }
  const rpc = options.rpc
    ? { host: REGTEST_RPC_HOST, ...options.rpc } as RpcConfig
    : undefined;
  return new BitcoinConnection({ network: network as NetworkName, rest: { host }, ...(rpc && { rpc }) });
}
