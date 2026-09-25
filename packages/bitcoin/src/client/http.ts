/**
 * HTTP request descriptor. Represents a request that can be executed
 * by any HTTP client - the library never performs I/O itself at the
 * protocol layer.
 */
export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  /**
   * `true` if the response can change over time, for example the chain tip or the
   * transactions of an address. The executor must then get the response from the
   * origin server, past the browser cache and each CDN or proxy cache.
   *
   * The executor must not add a request header for this. In a browser, a header
   * that is not CORS-safelisted causes a preflight request, and some Esplora
   * servers refuse the preflight. {@link createFetchExecutor} uses the fetch
   * option `cache: 'no-store'` and a unique query parameter.
   *
   * If the field is absent, the response is fixed (a transaction or a block by its
   * hash), and a cache can keep it.
   */
  fresh?: boolean;
}

/**
 * A function that executes an {@link HttpRequest} and returns a standard
 * {@link Response}.  Users can supply their own implementation to use
 * any HTTP client (e.g. `undici`, `axios`, a caching proxy, etc.).
 * An implementation must honor {@link HttpRequest.fresh}.
 */
export type HttpExecutor = (request: HttpRequest) => Promise<Response>;

/**
 * The init argument of `fetch`. The Node 22 types (undici-types 6) do not declare
 * `cache`, but the Node 22 runtime and each browser support it.
 */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]> & { cache?: 'no-store' };

/** Options for {@link createFetchExecutor}. */
export interface FetchExecutorOptions {
  /** Abort each request after this number of milliseconds. If absent, a request has no time limit. */
  timeoutMs?: number;
}

/**
 * Add a random query parameter to a URL, so that no cache has a response for the URL.
 * The function joins strings and does not parse the URL, so a relative URL stays valid.
 */
function withUniqueQuery(url: string): string {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${url}${url.includes('?') ? '&' : '?'}_=${nonce}`;
}

/**
 * Create an {@link HttpExecutor} backed by the global `fetch` function.
 *
 * For a {@link HttpRequest.fresh | fresh} request, the executor sets the fetch option
 * `cache: 'no-store'`, so the browser does not use its HTTP cache. It also adds a
 * random `_` query parameter, so no CDN cache has a response for the URL. Neither
 * step adds a request header, so a GET request needs no CORS preflight.
 * @param {FetchExecutorOptions} [options] The request timeout.
 * @returns {HttpExecutor} The executor.
 */
export function createFetchExecutor(options: FetchExecutorOptions = {}): HttpExecutor {
  const { timeoutMs } = options;
  return (req: HttpRequest): Promise<Response> => {
    const init: FetchInit = {
      method  : req.method,
      headers : req.headers,
      body    : req.body,
    };
    if (req.fresh) init.cache = 'no-store';
    if (timeoutMs !== undefined) init.signal = AbortSignal.timeout(timeoutMs);
    return fetch(req.fresh ? withUniqueQuery(req.url) : req.url, init);
  };
}

/**
 * Default executor: {@link createFetchExecutor} with no timeout.
 */
export const defaultHttpExecutor: HttpExecutor = createFetchExecutor();
