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
