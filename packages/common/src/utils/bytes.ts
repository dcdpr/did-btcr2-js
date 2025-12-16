const HEX_RE = /^[0-9a-fA-F]*$/;

/**
 * Converts a byte array to a hexadecimal string.
 * @param {Uint8Array} bytes - The byte array to convert.
 * @returns {string} The hexadecimal string representation of the byte array.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Converts a hexadecimal string to a byte array.
 * @param {string} hex - The hexadecimal string to convert.
 * @returns {Uint8Array} The byte array representation of the hexadecimal string.
 * @throws {Error} If the input string is not valid hexadecimal.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex: length must be even');
  if (!HEX_RE.test(hex)) throw new Error('Invalid hex: non-hex characters found');

  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    out[i] = byte;
  }
  return out;
}