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
 * Strip any userinfo (credentials) from a URL string so it is safe to log or
 * embed in an error message (audit L11). Handles both parseable URLs (via the
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
 * to such an endpoint exposes them on the network (audit M7).
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
