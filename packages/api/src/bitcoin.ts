import type {
  BitcoinCoreRpcClient,
  BitcoinRestClient,
  NetworkName,
  RestConfig,
  RpcConfig} from '@did-btcr2/bitcoin';
import {
  BitcoinConnection,
  type RawTransactionRest
} from '@did-btcr2/bitcoin';
import { assertString } from './helpers.js';
import type { BitcoinApiConfig } from './types.js';

/**
 * Default per-network service endpoints the SDK applies when the caller supplies
 * no overrides. These name concrete third-party services (Esplora-compatible
 * REST APIs) and a local-node assumption for regtest, so they live in the SDK
 * facade rather than in the sans-I/O `@did-btcr2/bitcoin` transport, which holds
 * no service URLs. This mirrors how the CAS default gateway lives in the API
 * layer (`DEFAULT_CAS_GATEWAY`), and follows the convention that the transport
 * requires explicit endpoints while the SDK provides convenience defaults.
 *
 * **Regtest RPC:** credentials are intentionally omitted - callers must provide
 * `username` and `password` via overrides or explicit config, so hardcoded
 * credentials never reach a non-local environment.
 *
 * @public
 */
export const DEFAULT_BITCOIN_NETWORK_CONFIG = {
  bitcoin : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/api' }
  },
  testnet3 : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/testnet/api' }
  },
  testnet4 : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/testnet4/api' }
  },
  signet  : {
    rpc  : undefined,
    rest : { host: 'https://mempool.space/signet/api' }
  },
  mutinynet : {
    rpc  : undefined,
    rest : { host: 'https://mutinynet.com/api' }
  },
  regtest : {
    rpc  : {
      host : 'http://localhost:18443',
    },
    rest : { host: 'http://localhost:3000' }
  },
} as const;

/**
 * Resolves a {@link BitcoinApiConfig} to explicit transport options: the
 * per-network defaults from {@link DEFAULT_BITCOIN_NETWORK_CONFIG} with the
 * caller's REST/RPC overrides merged on top. Throws a friendly error naming the
 * supported networks when the requested one is unknown.
 */
function resolveConnectionOptions(
  cfg: BitcoinApiConfig,
  executor: BitcoinApiConfig['executor'],
): { network: NetworkName; rest: RestConfig; rpc?: RpcConfig; executor?: BitcoinApiConfig['executor'] } {
  const defaults = DEFAULT_BITCOIN_NETWORK_CONFIG[cfg.network as keyof typeof DEFAULT_BITCOIN_NETWORK_CONFIG];
  if (!defaults) {
    throw new Error(
      `Unknown Bitcoin network '${cfg.network}'. `
      + `Available: ${Object.keys(DEFAULT_BITCOIN_NETWORK_CONFIG).join(', ')}.`
    );
  }
  const rest: RestConfig = { ...defaults.rest, ...cfg.rest };
  const hasRpc = defaults.rpc !== undefined || cfg.rpc !== undefined;
  const rpc = hasRpc ? { ...defaults.rpc, ...cfg.rpc } as RpcConfig : undefined;
  return { network: cfg.network, rest, rpc, executor };
}

/**
 * Bitcoin network operations sub-facade.
 * Always backed by a {@link BitcoinConnection} so it can be passed to
 * resolve/update without extra configuration.
 *
 * Lazily initialized by {@link DidBtcr2Api} to avoid connection overhead
 * when Bitcoin features are not used.
 * @public
 */
export class BitcoinApi {
  /** The underlying BitcoinConnection used for all operations. */
  readonly connection: BitcoinConnection;

  /** REST client for the active network. */
  get rest(): BitcoinRestClient {
    return this.connection.rest;
  }

  /**
   * RPC client for the active network, or `undefined` if not configured.
   * Use {@link requireRpc} when RPC is expected to be available.
   */
  get rpc(): BitcoinCoreRpcClient | undefined {
    return this.connection.rpc;
  }

  /** Whether an RPC client is available for this network. */
  get hasRpc(): boolean {
    return this.connection.rpc !== undefined;
  }

  /**
   * RPC client for the active network.
   * @throws {Error} If RPC was not configured for this network.
   */
  requireRpc(): BitcoinCoreRpcClient {
    const client = this.connection.rpc;
    if (!client) {
      throw new Error(
        'RPC client not configured. Pass an rpc config when creating the BitcoinApi, e.g.: '
        + '{ network: \'regtest\', rpc: { host: \'http://localhost:18443\', username: \'u\', password: \'p\' } }'
      );
    }
    return client;
  }

  /**
   * Create a BitcoinApi for a specific network with optional endpoint overrides.
   * Applies the SDK's per-network {@link DEFAULT_BITCOIN_NETWORK_CONFIG} under any
   * caller overrides, then constructs the underlying transport with explicit
   * endpoints. No environment variables are consulted.
   * @param cfg The network and optional REST/RPC overrides.
   */
  constructor(cfg: BitcoinApiConfig) {
    let executor = cfg.executor;
    // Wrap the default fetch with a timeout if configured and no custom
    // executor was provided.
    if (!executor && cfg.timeoutMs !== undefined) {
      const ms = cfg.timeoutMs;
      executor = (req) => fetch(req.url, {
        method  : req.method,
        headers : req.headers,
        body    : req.body,
        signal  : AbortSignal.timeout(ms),
      });
    }
    this.connection = new BitcoinConnection(resolveConnectionOptions(cfg, executor));
  }

  /**
   * Fetch a transaction by txid via REST.
   * @param txid The transaction ID (64-character hex string).
   * @returns The fetched transaction.
   */
  async getTransaction(txid: string): Promise<RawTransactionRest> {
    assertString(txid, 'txid');
    return await this.rest.transaction.get(txid);
  }

  /**
   * Broadcast a raw tx (hex) via REST.
   * @param rawTxHex The raw transaction hex string.
   */
  async send(rawTxHex: string) {
    assertString(rawTxHex, 'rawTxHex');
    return await this.rest.transaction.send(rawTxHex);
  }

  /**
   * Get UTXOs for an address via REST.
   * @param address The Bitcoin address.
   */
  async getUtxos(address: string) {
    assertString(address, 'address');
    return await this.rest.address.getUtxos(address);
  }

  /**
   * Get a block by hash or height via REST.
   * @param params Block identifier: at least one of `hash` or `height` is required.
   */
  async getBlock(params: { hash?: string; height?: number }) {
    if (!params.hash && params.height === undefined) {
      throw new Error('getBlock requires at least one of hash or height.');
    }
    return await this.rest.block.get({ blockhash: params.hash, height: params.height });
  }

  /** Convert BTC to satoshis (integer-safe string-split arithmetic). */
  static btcToSats(btc: number): number {
    return BitcoinConnection.btcToSats(btc);
  }

  /** Convert satoshis to BTC (integer-safe string-split arithmetic). */
  static satsToBtc(sats: number): number {
    return BitcoinConnection.satsToBtc(sats);
  }
}
