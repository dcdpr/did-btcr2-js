import { StringUtils } from '@did-btcr2/common';
import type { RestConfig } from '../../types.js';
import type { HttpRequest } from '../http.js';

const HEX64_RE = /^[0-9a-f]{64}$/i;

/**
 * Sans-I/O Esplora REST API protocol.
 *
 * Every method returns an {@link HttpRequest} descriptor — a plain object
 * describing *what* to request — without performing any I/O.  The caller
 * is responsible for executing the request with an HTTP client of their
 * choice and deserializing the response.
 *
 * This mirrors the pattern used by the Rust `esploda` crate where
 * `Esplora` methods return `http::Request<()>` objects.
 *
 * @example
 * ```ts
 * const protocol = new EsploraProtocol({ host: 'https://mempool.space/api' });
 *
 * // Build a request descriptor (no I/O)
 * const req = protocol.getTx('abc123...');
 *
 * // Execute with any HTTP client
 * const res = await fetch(req.url, req);
 * const tx: RawTransactionRest = await res.json();
 * ```
 */
export class EsploraProtocol {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: RestConfig) {
    this.baseUrl = StringUtils.replaceEnd(config.host, '/');
    this.defaultHeaders = {
      'Content-Type' : 'application/json',
      ...config.headers,
    };
  }

  // ── validation ─────────────────────────────────────────────────────

  private static assertHex64(value: string, label: string): void {
    if (!HEX64_RE.test(value)) {
      throw new Error(`Invalid ${label}: expected 64-char hex string`);
    }
  }

  private static assertAddress(value: string): void {
    if (!value || /[/\\.?#]/.test(value)) {
      throw new Error('Invalid address: contains illegal characters');
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private get(path: string): HttpRequest {
    return {
      url     : `${this.baseUrl}${path}`,
      method  : 'GET',
      headers : { ...this.defaultHeaders },
    };
  }

  private post(path: string, body: string, headers?: Record<string, string>): HttpRequest {
    return {
      url     : `${this.baseUrl}${path}`,
      method  : 'POST',
      headers : headers ?? { ...this.defaultHeaders },
      body,
    };
  }

  // ── Transaction ──────────────────────────────────────────────────────

  /** GET /tx/:txid */
  getTx(txid: string): HttpRequest {
    EsploraProtocol.assertHex64(txid, 'txid');
    return this.get(`/tx/${txid}`);
  }

  /** GET /tx/:txid/hex */
  getTxHex(txid: string): HttpRequest {
    EsploraProtocol.assertHex64(txid, 'txid');
    return this.get(`/tx/${txid}/hex`);
  }

  /** GET /tx/:txid/raw */
  getTxRaw(txid: string): HttpRequest {
    EsploraProtocol.assertHex64(txid, 'txid');
    return this.get(`/tx/${txid}/raw`);
  }

  /** POST /tx */
  postTx(hex: string): HttpRequest {
    return this.post('/tx', hex, { 'Content-Type': 'text/plain' });
  }

  // ── Block ────────────────────────────────────────────────────────────

  /** GET /blocks/tip/height */
  getBlockTipHeight(): HttpRequest {
    return this.get('/blocks/tip/height');
  }

  /** GET /block/:blockhash */
  getBlock(blockhash: string): HttpRequest {
    EsploraProtocol.assertHex64(blockhash, 'blockhash');
    return this.get(`/block/${blockhash}`);
  }

  /** GET /block-height/:height */
  getBlockHeight(height: number): HttpRequest {
    return this.get(`/block-height/${height}`);
  }

  // ── Address ──────────────────────────────────────────────────────────

  /** GET /address/:address/txs */
  getAddressTxs(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.get(`/address/${address}/txs`);
  }

  /** GET /address/:address/txs/mempool */
  getAddressTxsMempool(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.get(`/address/${address}/txs/mempool`);
  }

  /** GET /address/:address/txs/chain[/:last_seen_txid] */
  getAddressTxsChain(address: string, lastSeenTxId?: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    if (lastSeenTxId) EsploraProtocol.assertHex64(lastSeenTxId, 'lastSeenTxId');
    const path = lastSeenTxId
      ? `/address/${address}/txs/chain/${lastSeenTxId}`
      : `/address/${address}/txs/chain`;
    return this.get(path);
  }

  /** GET /address/:address */
  getAddressInfo(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.get(`/address/${address}`);
  }

  /** GET /address/:address/utxo */
  getAddressUtxos(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.get(`/address/${address}/utxo`);
  }
}
