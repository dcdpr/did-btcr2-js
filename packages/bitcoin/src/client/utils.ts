/**
 * Encode a string to base64
 * @param {string} s The string to encode
 * @returns {string} The base64 encoded string
 */
export function toBase64(s: string): string {
  // Node >= 18 and browser-safe
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  // @ts-ignore
  if (typeof btoa !== 'undefined') return btoa(s);
  throw new Error('No base64 encoder available');
}

/**
 * Safely get text from a Response object
 * @param {Response} res The Response object
 * @returns {Promise<string>} The text content or empty string on failure
 */
export async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

/**
 * Default maximum accepted response body size (32 MiB). Unbounded
 * `response.json()` on a hostile endpoint is a memory-DoS; both
 * client transports cap bodies at this size unless configured otherwise via
 * `maxResponseBytes` on the REST/RPC config.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * Read a response body as text, rejecting bodies larger than `maxBytes`.
 * Streams the body when possible so an over-limit body is rejected before it
 * is fully buffered; falls back to a post-hoc length check for Response-like
 * objects without a readable stream.
 *
 * @throws {Error} If the body exceeds `maxBytes`.
 */
export async function readTextWithLimit(res: Response, maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES): Promise<string> {
  const contentLength = res.headers.get('Content-Length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Response body exceeds ${maxBytes}-byte limit (declared Content-Length: ${declared})`);
    }
  }

  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength ?? 0;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* best effort */ }
          throw new Error(`Response body exceeds ${maxBytes}-byte limit`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`Response body exceeds ${maxBytes}-byte limit`);
  }
  return text;
}

/**
 * Read a response body as JSON, rejecting bodies larger than `maxBytes`
 *
 * @throws {Error} If the body exceeds `maxBytes` or is not valid JSON.
 */
export async function readJsonWithLimit(res: Response, maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES): Promise<unknown> {
  return JSON.parse(await readTextWithLimit(res, maxBytes));
}

/**
 * Strip any userinfo (credentials) from a URL string so it is safe to log or
 * embed in an error message. Handles both parseable URLs (via the
 * URL API) and unparseable ones (defensive regex over the authority segment).
 */
export function redactUrlCredentials(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    return u.toString();
  } catch {
    return url.replace(/(\/\/)[^/@]*@/, '$1[REDACTED]@');
  }
}

/** Hosts considered local: cleartext HTTP to these does not leak credentials off-box. */
const LOOPBACK_HOSTNAMES = new Set([ 'localhost', '127.0.0.1', '::1', '[::1]' ]);

/**
 * True if `url` is cleartext HTTP to a non-loopback host: sending credentials
 * to such an endpoint exposes them on the network.
 */
export function isInsecureRemoteHttp(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'http:' && !LOOPBACK_HOSTNAMES.has(u.hostname);
}

/**
 * Warn once (at client construction) when credentials will be sent over
 * cleartext HTTP to a non-loopback host: anyone on the path can read them.
 * Shared by the RPC and REST transports.
 */
export function warnIfCleartextCredentials(service: 'RPC' | 'REST', url: string, sendsCredentials: boolean): void {
  if (!sendsCredentials || !isInsecureRemoteHttp(url)) return;
  console.warn(
    `WARNING: Bitcoin ${service} credentials will be sent over cleartext HTTP to ${new URL(url).host}. `
    + 'Use HTTPS, an SSH tunnel, or a loopback bind instead.',
  );
}
