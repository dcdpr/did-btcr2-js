import { MethodError } from '@did-btcr2/common';
import { BitcoinAddress } from './address.js';
import { BitcoinBlock } from './block.js';
import { BitcoinTransaction } from './transaction.js';
import { EsploraProtocol } from './protocol.js';
import type { RestConfig } from '../../types.js';
import type { HttpExecutor, HttpRequest} from '../http.js';
import { defaultHttpExecutor } from '../http.js';

/**
 * Esplora REST API client for Bitcoin.
 *
 * Wraps the sans-I/O {@link EsploraProtocol} with an {@link HttpExecutor}
 * for convenience.  Users who want full control over I/O can access the
 * protocol layer directly via the {@link protocol} property.
 */
export class BitcoinRestClient {
  private _config: RestConfig;

  /**
   * The sans-I/O protocol layer.  Use this to build {@link HttpRequest}
   * descriptors without performing any I/O.
   */
  readonly protocol: EsploraProtocol;

  private readonly executor: HttpExecutor;

  /** Transaction-related API calls. */
  public transaction: BitcoinTransaction;

  /** Block-related API calls. */
  public block: BitcoinBlock;

  /** Address-related API calls. */
  public address: BitcoinAddress;

  constructor(config: RestConfig, executor?: HttpExecutor) {
    this._config = config;
    this.protocol = new EsploraProtocol(config);
    this.executor = executor ?? defaultHttpExecutor;

    const exec = this.executeRequest.bind(this);
    this.transaction = new BitcoinTransaction(this.protocol, exec);
    this.block = new BitcoinBlock(this.protocol, exec);
    this.address = new BitcoinAddress(this.protocol, exec);
  }

  get config(): RestConfig {
    return this._config;
  }

  /**
   * Execute an {@link HttpRequest} built by the protocol layer,
   * parse the response, and throw on HTTP errors.
   */
  private async executeRequest(request: HttpRequest): Promise<any> {
    const response = await this.executor(request);

    const contentType = response.headers.get('Content-Type') ?? '';
    const data = contentType.includes('text/plain')
      ? await response.text()
      : await response.json();

    if (!response.ok) {
      throw new MethodError(
        `Request to ${request.url} failed: ${response.status} - ${response.statusText}`,
        'FAILED_HTTP_REQUEST',
        { data }
      );
    }

    return data;
  }
}
