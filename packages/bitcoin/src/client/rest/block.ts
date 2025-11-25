import { BitcoinRestError } from '../../errors.js';
import { EsploraBlock } from '../../types.js';
import { HttpRequest } from '../http.js';
import { EsploraProtocol } from './protocol.js';

/**
 * Block-related Esplora REST API operations.
 *
 * Note: The Esplora API always returns the same block format regardless
 * of any "verbosity" setting (unlike Bitcoin Core RPC).  Use the RPC
 * client if you need verbosity-controlled block responses.
 */
export class BitcoinBlock {
  private readonly protocol: EsploraProtocol;
  private readonly exec: (req: HttpRequest) => Promise<any>;

  constructor(protocol: EsploraProtocol, exec: (req: HttpRequest) => Promise<any>) {
    this.protocol = protocol;
    this.exec = exec;
  }

  /**
   * Returns the blockheight of the most-work fully-validated chain.
   * @returns {Promise<number>} The current block height.
   */
  public async count(): Promise<number> {
    return await this.exec(this.protocol.getBlockTipHeight());
  }

  /**
   * Returns the Esplora block data for a given blockhash or height.
   * @param {object} params The block hash or height.
   * @param {string} [params.blockhash] The blockhash of the block to query.
   * @param {number} [params.height] The block height of the block to query.
   * @returns {Promise<EsploraBlock | undefined>} The block data.
   * @throws {BitcoinRestError} If neither blockhash nor height is provided.
   */
  public async get({ blockhash, height }: { blockhash?: string; height?: number }): Promise<EsploraBlock | undefined> {
    if (!blockhash && height === undefined) {
      throw new BitcoinRestError('blockhash or height required', { blockhash, height });
    }

    blockhash ??= await this.getHash(height!);
    if (!blockhash || typeof blockhash !== 'string') {
      return undefined;
    }

    return await this.exec(this.protocol.getBlock(blockhash)) as EsploraBlock;
  }

  /**
   * Get the block hash for a given block height.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-block-heightheight | Esplora GET /block-height/:height } for details.
   * @param {number} height The block height (required).
   * @returns {Promise<string>} The hash of the block at the given height.
   */
  public async getHash(height: number): Promise<string> {
    return await this.exec(this.protocol.getBlockHeight(height));
  }
}
