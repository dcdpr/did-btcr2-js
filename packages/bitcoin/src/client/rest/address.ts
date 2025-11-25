import { AddressInfo, AddressUtxo, RawTransactionRest } from '../../types.js';
import { HttpRequest } from '../http.js';
import { EsploraProtocol } from './protocol.js';

/**
 * Address-related Esplora REST API operations.
 */
export class BitcoinAddress {
  private readonly protocol: EsploraProtocol;
  private readonly exec: (req: HttpRequest) => Promise<any>;

  constructor(protocol: EsploraProtocol, exec: (req: HttpRequest) => Promise<any>) {
    this.protocol = protocol;
    this.exec = exec;
  }

  /**
   * Get transaction history for the specified address/scripthash, sorted with newest first.
   * Returns up to 50 mempool transactions plus the first 25 confirmed transactions.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-addressaddresstxs | Esplora GET /address/:address/txs } for details.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} Transaction history.
   */
  public async getTxs(addressOrScripthash: string): Promise<Array<RawTransactionRest>> {
    return await this.exec(this.protocol.getAddressTxs(addressOrScripthash));
  }

  /**
   * Checks if an address has any confirmed funded transactions.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<boolean>} True if the address has confirmed funds.
   */
  public async isFundedAddress(addressOrScripthash: string): Promise<boolean> {
    const txs = await this.getConfirmedTxs(addressOrScripthash);
    const confirmed = txs.filter((tx: RawTransactionRest) => tx.status.confirmed);
    return !!(confirmed && confirmed.length);
  }

  /**
   * Get unconfirmed transaction history for the specified address/scripthash.
   * Returns up to 50 transactions (no paging).
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} Unconfirmed transactions.
   */
  public async getTxsMempool(addressOrScripthash: string): Promise<Array<RawTransactionRest>> {
    return await this.exec(this.protocol.getAddressTxsMempool(addressOrScripthash));
  }

  /**
   * Get information about an address/scripthash.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<AddressInfo>} Address information.
   */
  public async getInfo(addressOrScripthash: string): Promise<AddressInfo> {
    return await this.exec(this.protocol.getAddressInfo(addressOrScripthash));
  }

  /**
   * Get confirmed transaction history for the specified address/scripthash, sorted with newest first.
   * Returns 25 transactions per page.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @param {string} [lastSeenTxId] The last transaction id seen by the previous query for pagination.
   * @returns {Promise<Array<RawTransactionRest>>} Confirmed transactions.
   */
  public async getConfirmedTxs(addressOrScripthash: string, lastSeenTxId?: string): Promise<Array<RawTransactionRest>> {
    return await this.exec(this.protocol.getAddressTxsChain(addressOrScripthash, lastSeenTxId));
  }

  /**
   * Get the list of unspent transaction outputs associated with the address/scripthash.
   * See {@link https://github.com/Blockstream/esplora/blob/master/API.md#get-addressaddressutxo | Esplora GET /address/:address/utxo } for details.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<AddressUtxo>>} Unspent transaction outputs.
   */
  public async getUtxos(addressOrScripthash: string): Promise<Array<AddressUtxo>> {
    return await this.exec(this.protocol.getAddressUtxos(addressOrScripthash));
  }
}
