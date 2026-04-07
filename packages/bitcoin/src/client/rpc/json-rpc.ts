import { BitcoinRpcError } from '../../errors.js';
import type { RpcConfig } from '../../types.js';
import type { HttpExecutor} from '../http.js';
import { defaultHttpExecutor } from '../http.js';
import { safeText } from '../utils.js';
import { JsonRpcProtocol } from './protocol.js';

export class JsonRpcTransport {
  /**
   * The sans-I/O protocol layer.  Use this to build {@link HttpRequest}
   * descriptors without performing any I/O.
   */
  readonly protocol: JsonRpcProtocol;

  private readonly execute: HttpExecutor;

  constructor(cfg: RpcConfig, executor?: HttpExecutor) {
    this.protocol = new JsonRpcProtocol(cfg);
    this.execute = executor ?? defaultHttpExecutor;
  }

  /** @internal Expose URL for tests that inspect transport state. */
  get url(): string {
    return this.protocol.url;
  }

  /**
   * Execute a single JSON-RPC call.
   */
  async call(method: string, params: unknown[] = []): Promise<unknown> {
    const request = this.protocol.buildRequest(method, params);
    const res = await this.execute(request);

    if (!res.ok) {
      const text = await safeText(res);
      throw new BitcoinRpcError(
        'HTTP_ERROR',
        res.status,
        text || `${res.status} ${res.statusText}`,
        { method }
      );
    }

    const payload = await res.json() as { result?: unknown; error?: { code: number; message: string } };
    return this.protocol.parseResponse(payload, method);
  }

  /**
   * Execute a JSON-RPC batch in a single HTTP request.
   * Returns results in the same order as the input calls.
   */
  async batch(calls: Array<{ method: string; params: unknown[] }>): Promise<unknown[]> {
    if (calls.length === 0) return [];
    if (calls.length === 1) {
      const result = await this.call(calls[0].method, calls[0].params);
      return [result];
    }

    const request = this.protocol.buildBatchRequest(calls);
    const res = await this.execute(request);

    if (!res.ok) {
      const text = await safeText(res);
      throw new BitcoinRpcError(
        'HTTP_ERROR',
        res.status,
        text || `${res.status} ${res.statusText}`,
        { methods: calls.map(c => c.method) }
      );
    }

    const payloads = await res.json() as Array<{ id: number; result?: unknown; error?: { code: number; message: string } }>;
    return this.protocol.parseBatchResponse(payloads, calls);
  }
}
