/**
 * Converts a hexadecimal string to a Buffer and vice versa.
 * @param {string} hex - The hexadecimal string to convert.
 * @returns {Buffer<ArrayBuffer>} The Buffer representation of the hexadecimal string.
 */
export function fromHex(hex: string): Buffer<ArrayBuffer> {
  return Buffer.from(hex, 'hex');
};

/**
 * Converts a Uint8Array to a hexadecimal string.
 * @param {Uint8Array} ui8 - The Uint8Array to convert.
 * @returns {string} The hexadecimal string representation of the Uint8Array.
 */
export function toHex(ui8: Uint8Array): string {
  return Buffer.from(ui8).toString('hex');
};