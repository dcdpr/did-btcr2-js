import { BitcoinRpcError } from '../../errors.js';
import type { RpcConfig } from '../../types.js';
import type { HttpRequest } from '../http.js';
import { redactUrlCredentials, toBase64, warnIfCleartextCredentials } from '../utils.js';

/**
 * An {@link HttpRequest} for a JSON-RPC batch call, carrying the request IDs
 * assigned to each call at build time.  {@link JsonRpcProtocol.parseBatchResponse}
 * requires these exact IDs so results are matched to calls by the identity
 * assigned when the batch was built, never by reconstructing IDs from mutable
 * protocol state at parse time.
 */
export interface BatchHttpRequest extends HttpRequest {
  /** The JSON-RPC ID assigned to each call, in call order. */
  readonly ids: number[];
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
        // The raw URL may carry userinfo credentials; log only the redacted
        // URL and sanitized error fields, never the raw error object: its
        // `input` property holds the original credential-bearing URL.
        const { name, code, message } = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
        console.error(`Invalid URL in Bitcoin RPC config: ${redactUrlCredentials(url)}`, {
          name    : typeof name === 'string' ? name : 'Error',
          code    : typeof code === 'string' ? code : 'UNKNOWN',
          message : typeof message === 'string' ? message : String(error),
        });
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

    // Warn when credentials (basic auth or a caller-supplied Authorization
    // header) will be sent over cleartext HTTP to a non-loopback host: anyone
    // on the path can read them.
    const sendsCredentials = authHeader !== undefined
      || Object.keys(cfg.headers ?? {}).some(h => h.toLowerCase() === 'authorization');
    warnIfCleartextCredentials('RPC', url, sendsCredentials);
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
   *
   * The assigned request IDs are captured on the returned descriptor so the
   * caller can pass them back to {@link parseBatchResponse}: interleaved
   * `buildRequest`/`buildBatchRequest` calls between build and parse must not
   * shift the ID mapping.
   */
  buildBatchRequest(calls: Array<{ method: string; params: unknown[] }>): BatchHttpRequest {
    const ids = calls.map(() => ++this._id);
    const body = calls.map((c, i) => ({
      jsonrpc : '2.0',
      id      : ids[i],
      method  : c.method,
      params  : c.params,
    }));
    return {
      url     : this.url,
      method  : 'POST',
      headers : { ...this._headers },
      body    : JSON.stringify(body),
      ids,
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
   *
   * @param payloads The response payloads from the server (may be out of order).
   * @param calls The original batch calls.
   * @param ids The IDs captured on the {@link BatchHttpRequest} at build time.
   */
  parseBatchResponse(
    payloads: unknown,
    calls: Array<{ method: string; params: unknown[] }>,
    ids: readonly number[],
  ): unknown[] {
    if (ids.length !== calls.length) {
      throw new BitcoinRpcError(
        'RPC_ERROR',
        -1,
        `Batch id count (${ids.length}) does not match call count (${calls.length})`,
      );
    }
    if (!Array.isArray(payloads)) {
      throw new BitcoinRpcError(
        'INVALID_RESPONSE',
        -1,
        'Batch response is not an array',
        { methods: calls.map(c => c.method) }
      );
    }
    const byId = new Map<number, { id: number; result?: unknown; error?: { code: number; message: string } }>();
    for (const entry of payloads) {
      if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'number') {
        throw new BitcoinRpcError(
          'INVALID_RESPONSE',
          -1,
          'Batch response entry is not an object with a numeric id',
          { methods: calls.map(c => c.method) }
        );
      }
      byId.set(entry.id, entry);
    }

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
      return this.parseResponse(payload, call.method);
    });
  }

  /**
   * Return a copy of the headers with the Authorization value redacted
   * (matched case-insensitively). Use this for logging or debugging.
   */
  redactedHeaders(): Record<string, string> {
    const copy = { ...this._headers };
    for (const key of Object.keys(copy)) {
      if (key.toLowerCase() === 'authorization') {
        copy[key] = copy[key].startsWith('Basic') ? 'Basic [REDACTED]' : '[REDACTED]';
      }
    }
    return copy;
  }
}
