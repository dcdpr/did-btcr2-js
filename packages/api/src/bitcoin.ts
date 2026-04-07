import type {
  BitcoinCoreRpcClient,
  BitcoinRestClient} from '@did-btcr2/bitcoin';
import {
  BitcoinConnection,
  type RawTransactionRest
} from '@did-btcr2/bitcoin';
import { assertString } from './helpers.js';
import type { BitcoinApiConfig } from './types.js';

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
   * Uses BitcoinConnection.forNetwork() — no env vars consulted.
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
    this.connection = BitcoinConnection.forNetwork(cfg.network, {
      rest : cfg.rest,
      rpc  : cfg.rpc,
      executor,
    });
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
   * @param params Block identifier — at least one of `hash` or `height` is required.
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
