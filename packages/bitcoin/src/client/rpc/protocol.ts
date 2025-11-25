import { BitcoinRpcError } from '../../errors.js';
import { RpcConfig } from '../../types.js';
import { HttpRequest } from '../http.js';
import { toBase64 } from '../utils.js';

/**
 * Sans-I/O JSON-RPC protocol for Bitcoin Core.
 *
 * Builds {@link HttpRequest} descriptors for JSON-RPC method calls and
 * provides response parsing — without performing any I/O.
 *
 * **Security note:** Built requests include an `Authorization` header when
 * credentials are configured.  Do not log or persist {@link HttpRequest}
 * objects without redacting the `Authorization` header.
 *
 * @example
 * ```ts
 * const protocol = new JsonRpcProtocol({
 *   host: 'http://localhost:18443',
 *   username: 'user',
 *   password: 'pass',
 * });
 *
 * // Build a request descriptor (no I/O)
 * const req = protocol.buildRequest('getblockcount', []);
 *
 * // Execute with any HTTP client
 * const res = await fetch(req.url, req);
 * const json = await res.json();
 *
 * // Parse the JSON-RPC response (throws on errors)
 * const blockCount = protocol.parseResponse(json, 'getblockcount', []);
 * ```
 */
export class JsonRpcProtocol {
  readonly url: string;

  /** Whether this protocol instance has credentials configured. */
  readonly hasAuth: boolean;

  private readonly _headers: Record<string, string>;
  private _id = 0;

  constructor(cfg: RpcConfig) {
    let url = (cfg.host || 'http://127.0.0.1:8332').replace(/\/+$/, '');
    let authHeader: string | undefined;

    if (cfg.username && cfg.password) {
      authHeader = `Basic ${toBase64(`${cfg.username}:${cfg.password}`)}`;
    } else {
      try {
        const u = new URL(url);
        if (u.username || u.password) {
          authHeader = `Basic ${toBase64(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`)}`;
          u.username = ''; u.password = '';
          url = u.toString().replace(/\/+$/, '');
        }
      } catch (error: unknown) {
        console.error(`Invalid URL in Bitcoin RPC config: ${url}`, error);
      }
    }

    this.url = url;
    this.hasAuth = authHeader !== undefined;
    this._headers = {
      'Content-Type' : 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
  }

  /**
   * Build an {@link HttpRequest} for a JSON-RPC method call.
   */
  buildRequest(method: string, params: unknown[]): HttpRequest {
    const body = { jsonrpc: '2.0', id: ++this._id, method, params };
    return {
      url     : this.url,
      method  : 'POST',
      headers : { ...this._headers },
      body    : JSON.stringify(body),
    };
  }

  /**
   * Build an {@link HttpRequest} for a JSON-RPC batch call.
   * Sends all calls in a single HTTP request per the JSON-RPC 2.0 spec.
   */
  buildBatchRequest(calls: Array<{ method: string; params: unknown[] }>): HttpRequest {
    const body = calls.map(c => ({
      jsonrpc : '2.0',
      id      : ++this._id,
      method  : c.method,
      params  : c.params,
    }));
    return {
      url     : this.url,
      method  : 'POST',
      headers : { ...this._headers },
      body    : JSON.stringify(body),
    };
  }

  /**
   * Parse a JSON-RPC response payload, throwing {@link BitcoinRpcError}
   * if the response contains an error.
   */
  parseResponse(
    payload: { result?: unknown; error?: { code: number; message: string } },
    method: string,
  ): unknown {
    if (payload.error) {
      throw new BitcoinRpcError(
        'RPC_ERROR',
        payload.error.code,
        payload.error.message,
        { method }
      );
    }
    return payload.result;
  }

  /**
   * Parse a JSON-RPC batch response payload.
   * Returns results in the same order as the original calls.
   */
  parseBatchResponse(
    payloads: Array<{ id: number; result?: unknown; error?: { code: number; message: string } }>,
    calls: Array<{ method: string; params: unknown[] }>,
  ): unknown[] {
    const byId = new Map(payloads.map(p => [p.id, p]));
    // Batch responses may arrive out of order; re-sort by sequential id.
    // IDs were assigned as (_id - calls.length + 1) .. _id
    const startId = this._id - calls.length + 1;

    return calls.map((call, i) => {
      const payload = byId.get(startId + i);
      if (!payload) {
        throw new BitcoinRpcError(
          'RPC_ERROR',
          -1,
          `Missing response for batch call ${call.method} (id ${startId + i})`,
          { method: call.method }
        );
      }
      return this.parseResponse(payload, call.method);
    });
  }

  /**
   * Return a copy of the headers with the Authorization value redacted.
   * Use this for logging or debugging.
   */
  redactedHeaders(): Record<string, string> {
    const copy = { ...this._headers };
    if (copy.Authorization) {
      copy.Authorization = 'Basic [REDACTED]';
    }
    return copy;
  }
}
