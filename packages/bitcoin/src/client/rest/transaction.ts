import type { Bytes } from '@did-btcr2/common';
import { BitcoinRestError } from '../../errors.js';
import type { RawTransactionRest } from '../../types.js';
import type { HttpRequest } from '../http.js';
import { checkRawTransactionRest } from '../validate.js';
import type { EsploraProtocol } from './protocol.js';

export class BitcoinTransaction {
  private readonly protocol: EsploraProtocol;
  private readonly exec: (req: HttpRequest) => Promise<any>;

  constructor(protocol: EsploraProtocol, exec: (req: HttpRequest) => Promise<any>) {
    this.protocol = protocol;
    this.exec = exec;
  }

  /**
   * Returns the transaction in JSON format.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxid | Esplora GET /tx/:txid } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<RawTransactionRest>} A promise resolving to data about a transaction.
   * @throws {BitcoinRestError} If the response does not have the expected shape.
   */
  public async get(txid: string): Promise<RawTransactionRest> {
    const tx = await this.exec(this.protocol.getTx(txid));
    const reason = checkRawTransactionRest(tx);
    if (reason) {
      throw new BitcoinRestError(`Invalid transaction response for ${txid}: ${reason}`, { txid });
    }
    return tx as RawTransactionRest;
  }

  /**
   * Checks if a transaction is confirmed.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<boolean>} True if the transaction is confirmed.
   */
  public async isConfirmed(txid: string): Promise<boolean> {
    const tx = await this.get(txid);
    return tx.status.confirmed;
  }

  /**
   * Returns the raw transaction as a hex string.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidhex | Esplora GET /tx/:txid/hex } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<string>} A promise resolving to the raw transaction hex.
   * @throws {BitcoinRestError} If the response is not a hex string.
   */
  public async getHex(txid: string): Promise<string> {
    const hex = await this.exec(this.protocol.getTxHex(txid));
    if (typeof hex !== 'string' || hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new BitcoinRestError(`Invalid transaction hex response for ${txid}`, { txid });
    }
    return hex;
  }

  /**
   * Returns the raw transaction as binary data.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-txtxidraw | Esplora GET /tx/:txid/raw } for details.
   * @param {string} txid The transaction id (required).
   * @returns {Promise<Bytes>} A promise resolving to the raw transaction bytes.
   */
  public async getRaw(txid: string): Promise<Bytes> {
    return await this.exec(this.protocol.getTxRaw(txid));
  }

  /**
   * Broadcast a raw transaction to the network.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#post-tx | Esplora POST /tx } for details.
   * @param {string} tx The raw transaction in hex format (required).
   * @returns {Promise<string>} The transaction id of the broadcasted transaction.
   * @throws {BitcoinRestError} If the response is not a non-empty string.
   */
  public async send(tx: string): Promise<string> {
    const txid = await this.exec(this.protocol.postTx(tx));
    if (typeof txid !== 'string' || txid.length === 0) {
      throw new BitcoinRestError('Invalid broadcast response: expected a txid string');
    }
    return txid;
  }
}
