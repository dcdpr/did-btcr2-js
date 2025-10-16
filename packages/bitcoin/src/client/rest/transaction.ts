import { Bytes } from '@did-btcr2/common';
import { RawTransactionRest, RestApiCallParams } from '../../types.js';

export class BitcoinTransaction {
  private api: (params: RestApiCallParams) => Promise<any>;

  constructor(api: (params: RestApiCallParams) => Promise<any>) {
    this.api = api;
  }

  /**
   * Returns the transaction in JSON format.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid | Esplora GET /tx/:txid } for details.
   * @param {string} txid The transaction id (required).
   * @returns {GetRawTransaction} A promise resolving to data about a transaction in the form specified by verbosity.
   */
  public async get(txid: string): Promise<RawTransactionRest> {
    return await this.api({ path: `/tx/${txid}` });
  }

  /**
   * Returns the transaction in JSON format.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid | Esplora GET /tx/:txid } for details.
   * @param {string} txid The transaction id (required).
   * @returns {GetRawTransaction} A promise resolving to data about a transaction in the form specified by verbosity.
   */
  public async isConfirmed(txid: string): Promise<boolean> {
    const tx = await this.get(txid);
    return tx.status.confirmed;
  }

  /**
   * Returns the raw transaction in hex or as binary data.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex | Esplora GET /tx/:txid/hex } and
   * {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw | Esplora GET /tx/:txid/raw } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<RawTransactionRest | string>} A promise resolving to the raw transaction in the specified format.
   */
  public async getHex(txid: string): Promise<string> {
    return await this.api({ path: `/tx/${txid}/hex` });
  }

  /**
   * Returns the raw transaction in hex or as binary data.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex | Esplora GET /tx/:txid/hex } and
   * {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw | Esplora GET /tx/:txid/raw } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<RawTransactionRest | string>} A promise resolving to the raw transaction in the specified format.
   */
  public async getRaw(txid: string): Promise<Bytes> {
    return await this.api({ path: `/tx/${txid}/raw` });
  }

  /**
   * Broadcast a raw transaction to the network. The transaction should be provided as hex in the request body. The txid
   * will be returned on success.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#post-tx | Esplora POST /tx } for details.
   * @param {string} tx The raw transaction in hex format (required).
   * @returns {Promise<string>} The transaction id of the broadcasted transaction.
   */
  public async send(tx: string): Promise<string> {
    return await this.api({ path: '/tx', method: 'POST', body: tx, headers: { 'Content-Type': 'text/plain' } });
  }
}