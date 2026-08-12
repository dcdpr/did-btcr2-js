import { BitcoinRestError } from '../../errors.js';
import type { EsploraBlock } from '../../types.js';
import type { HttpRequest } from '../http.js';
import { checkEsploraBlock } from '../validate.js';
import type { EsploraProtocol } from './protocol.js';

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
   * Esplora answers with a `text/plain` number; the value is coerced and
   * validated so a hostile endpoint cannot feed a non-number into the
   * confirmation arithmetic of downstream callers.
   * @returns {Promise<number>} The current block height.
   * @throws {BitcoinRestError} If the response is not a non-negative integer.
   */
  public async count(): Promise<number> {
    const raw = await this.exec(this.protocol.getBlockTipHeight());
    const height = typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim().length > 0
        ? Number(raw.trim())
        : NaN;
    if (!Number.isInteger(height) || height < 0) {
      throw new BitcoinRestError(`Invalid tip height response: ${JSON.stringify(raw)}`);
    }
    return height;
  }

  /**
   * Returns the Esplora block data for a given blockhash or height.
   *
   * Contract: this method either resolves with validated block data or
   * throws; it never resolves to `undefined`. A lookup for a nonexistent
   * block fails at the HTTP layer (Esplora answers 404, which the client
   * turns into an error before this method sees a body), and an invalid or
   * unresolvable height/hash is rejected by {@link getHash}.
   *
   * @param {object} params The block hash or height.
   * @param {string} [params.blockhash] The blockhash of the block to query.
   * @param {number} [params.height] The block height of the block to query.
   * @returns {Promise<EsploraBlock>} The block data.
   * @throws {BitcoinRestError} If neither blockhash nor height is provided,
   * the height does not resolve to a valid hash, or the block response is
   * malformed.
   */
  public async get({ blockhash, height }: { blockhash?: string; height?: number }): Promise<EsploraBlock> {
    if (!blockhash && height === undefined) {
      throw new BitcoinRestError('blockhash or height required', { blockhash, height });
    }

    blockhash ??= await this.getHash(height!);

    const block = await this.exec(this.protocol.getBlock(blockhash));
    const reason = checkEsploraBlock(block);
    if (reason) {
      throw new BitcoinRestError(`Invalid block response for ${blockhash}: ${reason}`, { blockhash });
    }
    return block as EsploraBlock;
  }

  /**
   * Get the block hash for a given block height.
   * See {@link https://github.com/blockstream/esplora/blob/master/API.md#get-block-heightheight | Esplora GET /block-height/:height } for details.
   * @param {number} height The block height (required).
   * @returns {Promise<string>} The hash of the block at the given height.
   * @throws {BitcoinRestError} If the response is not a 64-character hex string.
   */
  public async getHash(height: number): Promise<string> {
    const hash = await this.exec(this.protocol.getBlockHeight(height));
    if (typeof hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hash)) {
      throw new BitcoinRestError(`Invalid block hash response for height ${height}`, { height });
    }
    return hash;
  }
}
