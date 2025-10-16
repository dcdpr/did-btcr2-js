import { BitcoinRestError } from '../../errors.js';
import { RestApiCallParams, BlockResponse, BlockV3, GetBlockParams } from '../../types.js';

/**
 * Implements a strongly-typed BitcoinRest to connect to remote bitcoin node via REST API for block-related operations.
 * @class BitcoinBlock
 * @type {BitcoinBlock}
 */
export class BitcoinBlock {
  private api: (params: RestApiCallParams) => Promise<any>;

  constructor(api: (params: RestApiCallParams) => Promise<any>) {
    this.api = api;
  }

  /**
   * Returns the blockheight of the most-work fully-validated chain. The genesis block has height 0.
   * @returns {Blockheight} The number of the blockheight with the most-work of the fully-validated chain.
   */
  public async count(): Promise<number> {
    return await this.api({ path: '/blocks/tip/height' });
  }

  /**
   * Returns the block data associated with a `blockhash` of a valid block.
   * @param {GetBlockParams} params See {@link GetBlockParams} for details.
   * @param {?string} params.blockhash The blockhash of the block to query.
   * @param {?number} params.height The block height of the block to query.
   * @returns {BlockResponse} A promise resolving to a {@link BlockResponse} formatted depending on `verbosity` level.
   * @throws {BitcoinRpcError} If neither `blockhash` nor `height` is provided.
   */
  public async get({ blockhash, height }: GetBlockParams): Promise<BlockResponse | undefined> {
    // Check if blockhash or height is provided, if neither throw an error
    if(!blockhash && height === undefined) {
      throw new BitcoinRestError('INVALID_PARAMS_GET_BLOCK: blockhash or height required', { blockhash, height });
    }

    // If height is provided, get the blockhash
    blockhash ??= await this.getHash(height!);
    if(!blockhash || typeof blockhash !== 'string') {
      return undefined;
    }

    // Get the block data
    return await this.api({ path: `/block/${blockhash}` }) as BlockV3;
  }

  /**
   * Get the block hash for a given block height.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-block-heightheight | Esplora GET /block-height/:height } for details.
   * @param {number} height The block height (required).
   * @returns {Promise<string>} The hash of the block currently at height..
   */
  public async getHash(height: number): Promise<string> {
    return await this.api({ path: `/block-height/${height}` });
  }
}
