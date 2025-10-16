import { AddressInfo, AddressUtxo, RawTransactionRest, RestApiCallParams } from '../../types.js';

/**
 * Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API for address-related operations.
 * @class BitcoinAddress
 * @type {BitcoinAddress}
 */
export class BitcoinAddress {
  private api: (params: RestApiCallParams) => Promise<any>;

  constructor(api: (params: RestApiCallParams) => Promise<any>) {
    this.api = api;
  }

  /**
   * Get transaction history for the specified address/scripthash, sorted with newest first.
   * Returns up to 50 mempool transactions plus the first 25 confirmed transactions.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-addressaddresstxs | Esplora GET /address/:address/txs } for details.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getTxs(addressOrScripthash: string): Promise<Array<RawTransactionRest>> {
    return await this.api({ path: `/address/${addressOrScripthash}/txs` });
  }

  /**
   * Calls getAddressTxs and checks if any funds come back.
   * Toggle if those funds are confirmed.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<boolean>} True if the address has any funds, false otherwise.
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
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getTxsMempool(addressOrScripthash: string): Promise<Array<RawTransactionRest>> {
    return await this.api({ path: `/address/${addressOrScripthash}/txs/mempool` });
  }

  /**
   * Get information about an address/scripthash.
   * Available fields: address/scripthash, chain_stats and mempool_stats.
   * {chain,mempool}_stats each contain an object with tx_count, funded_txo_count, funded_txo_sum, spent_txo_count and spent_txo_sum.
   * Elements-based chains don't have the {funded,spent}_txo_sum fields.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<AddressInfo>} A promise resolving to an {@link AddressInfo} object.
   */
  public async getInfo(addressOrScripthash: string): Promise<AddressInfo> {
    return await this.api({ path: `/address/${addressOrScripthash}` });
  }

  /**
   * Get confirmed transaction history for the specified address/scripthash, sorted with newest first.
   * Returns 25 transactions per page. More can be requested by specifying the last txid seen by the previous query.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @param lastSeenTxId The last transaction id seen by the previous query (optional).
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getConfirmedTxs(addressOrScripthash: string, lastSeenTxId?: string): Promise<Array<RawTransactionRest>> {
    return await this.api({
      path : lastSeenTxId
        ? `/address/${addressOrScripthash}/txs/chain/${lastSeenTxId}`
        : `/address/${addressOrScripthash}/txs/chain`
    });
  }

  /**
   * Get the list of unspent transaction outputs associated with the address/scripthash.
   * See {@link https://github.com/Blockstream/esplora/blob/master/API.md#get-addressaddressutxo | Esplora GET /address/:address/utxo } for details.
   * @param {string} addressOrScripthash The address or scripthash to check.
   * @returns {Promise<Array<RawTransactionRest>>} A promise resolving to an array of {@link RawTransactionRest} objects.
   */
  public async getUtxos(addressOrScripthash: string): Promise<Array<AddressUtxo>> {
    return await this.api({ path: `/address/${addressOrScripthash}/utxo` });
  }
}