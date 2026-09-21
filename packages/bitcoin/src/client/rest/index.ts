import { MethodError } from '@did-btcr2/common';
import { BitcoinAddress } from './address.js';
import { BitcoinBlock } from './block.js';
import { BitcoinTransaction } from './transaction.js';
import { EsploraProtocol } from './protocol.js';
import type { RestConfig } from '../../types.js';
import type { HttpExecutor, HttpRequest} from '../http.js';
import { defaultHttpExecutor } from '../http.js';
import { safeText } from '../utils.js';

/** The number of body characters that an error carries. */
const BODY_EXCERPT_LENGTH = 200;

/** The body of an error response: the JSON value if the body parses, else an excerpt. */
function errorBody(text: string): unknown {
  try { return JSON.parse(text); } catch { return text.slice(0, BODY_EXCERPT_LENGTH); }
}

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
   * Execute an {@link HttpRequest} built by the protocol layer, check the status,
   * then parse the body. The body is read as text first, so an HTML error page
   * never reaches the JSON parser.
   * @throws {MethodError} `FAILED_HTTP_REQUEST` for a non-OK status, with the
   *   status, the URL, and the body (JSON if it parses, else an excerpt).
   * @throws {MethodError} `INVALID_HTTP_RESPONSE` for an OK status with a body
   *   that is not JSON.
   */
  private async executeRequest(request: HttpRequest): Promise<any> {
    const response = await this.executor(request);
    const text = await safeText(response);

    if (!response.ok) {
      throw new MethodError(
        `Request to ${request.url} failed: ${response.status} - ${response.statusText}`,
        'FAILED_HTTP_REQUEST',
        { status: response.status, url: request.url, data: errorBody(text) }
      );
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/plain')) return text;

    try {
      return JSON.parse(text);
    } catch {
      throw new MethodError(
        `Request to ${request.url} returned a body that is not JSON (status ${response.status})`,
        'INVALID_HTTP_RESPONSE',
        { status: response.status, url: request.url, data: text.slice(0, BODY_EXCERPT_LENGTH) }
      );
    }
  }
}
