import { StringUtils } from '@did-btcr2/common';
import type { RestConfig } from '../../types.js';
import type { HttpRequest } from '../http.js';

const HEX64_RE = /^[0-9a-f]{64}$/i;

/** Copy the headers without a `Content-Type` entry. The header name is case-insensitive. */
function withoutContentType(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type'));
}

/**
 * Sans-I/O Esplora REST API protocol.
 *
 * Every method returns an {@link HttpRequest} descriptor (a plain object
 * describing *what* to request) without performing any I/O.  The caller
 * is responsible for executing the request with an HTTP client of their
 * choice and deserializing the response.
 *
 * This mirrors the pattern used by the Rust `esploda` crate where
 * `Esplora` methods return `http::Request<()>` objects.
 *
 * Headers: a GET request has no body, so it carries no `Content-Type`. A browser
 * then sends a GET with no CORS preflight. `POST /tx` carries `text/plain`, which
 * also needs no preflight. Each request carries the {@link RestConfig.headers}.
 *
 * Freshness: a request for a response that can change over time (the chain tip, a
 * transaction status, the data of an address) has {@link HttpRequest.fresh} set.
 * A request for a fixed response (a transaction or a block by its hash) does not.
 *
 * @example
 * ```ts
 * const protocol = new EsploraProtocol({ host: 'https://mempool.space/api' });
 *
 * // Build a request descriptor (no I/O)
 * const req = protocol.getTx('abc123...');
 *
 * // Execute with an executor that honors `fresh`
 * const res = await defaultHttpExecutor(req);
 * const tx: RawTransactionRest = await res.json();
 * ```
 */
export class EsploraProtocol {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: RestConfig) {
    this.baseUrl = StringUtils.replaceEnd(config.host, '/');
    // The protocol sets Content-Type from the request body.
    this.headers = withoutContentType(config.headers);
  }

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

  /** A GET for a fixed response: a cache can keep it. */
  private get(path: string): HttpRequest {
    return {
      url     : `${this.baseUrl}${path}`,
      method  : 'GET',
      headers : { ...this.headers },
    };
  }

  /** A GET for a response that can change: the executor must get it from the origin server. */
  private getFresh(path: string): HttpRequest {
    return { ...this.get(path), fresh: true };
  }

  private post(path: string, body: string, contentType: string): HttpRequest {
    return {
      url     : `${this.baseUrl}${path}`,
      method  : 'POST',
      headers : { ...this.headers, 'Content-Type': contentType },
      body,
    };
  }

  /** GET /tx/:txid (fresh: the `status` changes when the transaction confirms) */
  getTx(txid: string): HttpRequest {
    EsploraProtocol.assertHex64(txid, 'txid');
    return this.getFresh(`/tx/${txid}`);
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
    return this.post('/tx', hex, 'text/plain');
  }

  /** GET /blocks/tip/height (fresh: the tip moves with each block) */
  getBlockTipHeight(): HttpRequest {
    return this.getFresh('/blocks/tip/height');
  }

  /** GET /block/:blockhash */
  getBlock(blockhash: string): HttpRequest {
    EsploraProtocol.assertHex64(blockhash, 'blockhash');
    return this.get(`/block/${blockhash}`);
  }

  /** GET /block-height/:height (fresh: a reorg changes the hash, and a future height has none) */
  getBlockHeight(height: number): HttpRequest {
    return this.getFresh(`/block-height/${height}`);
  }

  /** GET /address/:address/txs (fresh) */
  getAddressTxs(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.getFresh(`/address/${address}/txs`);
  }

  /** GET /address/:address/txs/mempool (fresh) */
  getAddressTxsMempool(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.getFresh(`/address/${address}/txs/mempool`);
  }

  /** GET /address/:address/txs/chain[/:last_seen_txid] (fresh: a new confirmation or a reorg changes a page) */
  getAddressTxsChain(address: string, lastSeenTxId?: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    if (lastSeenTxId) EsploraProtocol.assertHex64(lastSeenTxId, 'lastSeenTxId');
    const path = lastSeenTxId
      ? `/address/${address}/txs/chain/${lastSeenTxId}`
      : `/address/${address}/txs/chain`;
    return this.getFresh(path);
  }

  /** GET /address/:address (fresh) */
  getAddressInfo(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.getFresh(`/address/${address}`);
  }

  /** GET /address/:address/utxo (fresh) */
  getAddressUtxos(address: string): HttpRequest {
    EsploraProtocol.assertAddress(address);
    return this.getFresh(`/address/${address}/utxo`);
  }
}
