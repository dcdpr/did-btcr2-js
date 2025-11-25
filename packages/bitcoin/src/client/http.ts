/**
 * HTTP request descriptor. Represents a request that can be executed
 * by any HTTP client — the library never performs I/O itself at the
 * protocol layer.
 */
export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

/**
 * A function that executes an {@link HttpRequest} and returns a standard
 * {@link Response}.  Users can supply their own implementation to use
 * any HTTP client (e.g. `undici`, `axios`, a caching proxy, etc.).
 */
export type HttpExecutor = (request: HttpRequest) => Promise<Response>;

/**
 * Default executor backed by the global `fetch` function.
 */
export const defaultHttpExecutor: HttpExecutor = (req: HttpRequest): Promise<Response> =>
  fetch(req.url, {
    method  : req.method,
    headers : req.headers,
    body    : req.body,
  });
