import { BitcoinRpcError } from '../../errors.js';
import type { RpcConfig } from '../../types.js';
import type { HttpRequest } from '../http.js';
import { toBase64 } from '../utils.js';

/**
 * An {@link HttpRequest} for a single JSON-RPC call, carrying the `id` that was
 * assigned when the request was built.  Pass it back to
 * {@link JsonRpcProtocol.parseResponse} so the response is bound to the request
 * that asked for it.
 */
export interface JsonRpcHttpRequest extends HttpRequest {
  /** The JSON-RPC id sent in the body of this request. */
  readonly id: number;
}

/**
 * An {@link HttpRequest} for a JSON-RPC batch, carrying the `id`s that were
 * assigned when the request was built, in call order.  Pass them back to
 * {@link JsonRpcProtocol.parseBatchResponse}: ids must never be recomputed from
 * the protocol's counter, which any other call on the same instance advances
 * while this request is in flight.
 */
export interface JsonRpcBatchHttpRequest extends HttpRequest {
  /** The JSON-RPC ids sent in the body of this request, in call order. */
  readonly ids: readonly number[];
}

/**
 * Sans-I/O JSON-RPC protocol for Bitcoin Core.
 *
 * Builds {@link HttpRequest} descriptors for JSON-RPC method calls and
 * provides response parsing, without performing any I/O.
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
 * const blockCount = protocol.parseResponse(json, 'getblockcount', req.id);
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

    // Target a named wallet's RPCs when configured: Bitcoin Core exposes
    // per-wallet RPC methods under the `/wallet/<name>` URL path.
    if (cfg.wallet) {
      url = `${url}/wallet/${encodeURIComponent(cfg.wallet)}`;
    }

    this.url = url;
    this.hasAuth = authHeader !== undefined;
    // Configured headers come first, so a custom or bearer header reaches an
    // authenticated or proxied endpoint; the fixed Content-Type and the derived
    // Basic Authorization header take precedence over any same-named entry.
    this._headers = {
      ...cfg.headers,
      'Content-Type' : 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
  }

  /**
   * Build an {@link HttpRequest} for a JSON-RPC method call.
   * The assigned id is returned on the descriptor for {@link parseResponse}.
   */
  buildRequest(method: string, params: unknown[]): JsonRpcHttpRequest {
    const id = ++this._id;
    const body = { jsonrpc: '2.0', id, method, params };
    return {
      id,
      url     : this.url,
      method  : 'POST',
      headers : { ...this._headers },
      body    : JSON.stringify(body),
    };
  }

  /**
   * Build an {@link HttpRequest} for a JSON-RPC batch call.
   * Sends all calls in a single HTTP request per the JSON-RPC 2.0 spec.
   * The assigned ids are returned on the descriptor for
   * {@link parseBatchResponse}.
   */
  buildBatchRequest(calls: Array<{ method: string; params: unknown[] }>): JsonRpcBatchHttpRequest {
    const ids = calls.map(() => ++this._id);
    const body = calls.map((c, i) => ({
      jsonrpc : '2.0',
      id      : ids[i],
      method  : c.method,
      params  : c.params,
    }));
    return {
      ids,
      url     : this.url,
      method  : 'POST',
      headers : { ...this._headers },
      body    : JSON.stringify(body),
    };
  }

  /**
   * Parse a JSON-RPC response payload, throwing {@link BitcoinRpcError}
   * if the response contains an error.
   *
   * Pass `expectedId` (from {@link buildRequest}) to bind the response to the
   * request that asked for it.  A payload carrying no `id`, or a null one
   * (which Bitcoin Core sends when it could not parse the request), is
   * accepted: an endpoint able to fabricate ids can fabricate `result` just as
   * easily, so the check guards against responses crossed in transit rather
   * than against a dishonest node.
   */
  parseResponse(
    payload: { id?: unknown; result?: unknown; error?: { code: number; message: string } },
    method: string,
    expectedId?: number,
  ): unknown {
    if (payload.error) {
      throw new BitcoinRpcError(
        'RPC_ERROR',
        payload.error.code,
        payload.error.message,
        { method }
      );
    }
    if (expectedId !== undefined && typeof payload.id === 'number' && payload.id !== expectedId) {
      throw new BitcoinRpcError(
        'RPC_ERROR',
        -1,
        `Response id ${payload.id} does not match request id ${expectedId} for ${method}`,
        { method }
      );
    }
    return payload.result;
  }

  /**
   * Parse a JSON-RPC batch response payload.
   * Returns results in the same order as the original calls.
   *
   * `ids` must be the ids {@link buildBatchRequest} assigned to this batch.
   * They cannot be derived from the protocol's counter at parse time: it is
   * shared and mutable, so any call built while this batch is in flight shifts
   * it and each response is then matched to the wrong call.
   */
  parseBatchResponse(
    payloads: Array<{ id: number; result?: unknown; error?: { code: number; message: string } }>,
    calls: Array<{ method: string; params: unknown[] }>,
    ids: readonly number[],
  ): unknown[] {
    if (ids.length !== calls.length) {
      throw new BitcoinRpcError(
        'RPC_ERROR',
        -1,
        `Batch id count (${ids.length}) does not match call count (${calls.length})`,
        { methods: calls.map(c => c.method) }
      );
    }

    // Batch responses may arrive out of order, so each call is matched to the
    // response carrying the id assigned to that call at build time.
    const byId = new Map(payloads.map(p => [p.id, p]));

    return calls.map((call, i) => {
      const payload = byId.get(ids[i]);
      if (!payload) {
        throw new BitcoinRpcError(
          'RPC_ERROR',
          -1,
          `Missing response for batch call ${call.method} (id ${ids[i]})`,
          { method: call.method }
        );
      }
      return this.parseResponse(payload, call.method, ids[i]);
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
