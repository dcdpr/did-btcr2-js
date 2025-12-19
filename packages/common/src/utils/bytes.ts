/**
 * Utilities for working with byte-oriented data.
 * @name BytesUtils
 * @class BytesUtils
 */
export type BytesLike = ArrayLike<number> | ArrayBuffer | ArrayBufferView;

export class BytesUtils {
  /**
   * Normalize various byte-like inputs into a fresh Uint8Array copy.
   * @param {BytesLike} input - The input to convert.
   * @returns {Uint8Array} A new Uint8Array containing the input bytes.
   */
  static toUint8Array(input: BytesLike): Uint8Array {
    if (input instanceof Uint8Array) {
      return new Uint8Array(input);
    }

    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    }

    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input.slice(0));
    }

    if (typeof input === 'object' && input !== null && typeof (input as ArrayLike<number>).length === 'number') {
      return new Uint8Array(Array.from(input as ArrayLike<number>));
    }

    throw new TypeError('Unsupported byte input');
  }

  /**
   * Convert a byte-like input to a plain number array.
   * @param {BytesLike} input - The input to convert.
   * @returns {number[]} The resulting number array.
   */
  static toNumberArray(input: BytesLike): number[] {
    return Array.from(this.toUint8Array(input));
  }
}

export const toUint8Array = BytesUtils.toUint8Array.bind(BytesUtils);
export const toNumberArray = BytesUtils.toNumberArray.bind(BytesUtils);
