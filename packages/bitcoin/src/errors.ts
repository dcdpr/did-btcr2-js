/**
 * Custom Error class for handling Bitcoin RPC errors.
 */
export class BitcoinRpcError extends Error {
  public readonly code: number | string;
  public readonly data?: any;
  constructor(code: number | string, message: string, data?: any) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'BitcoinRpcError';
  }
}

export class BitcoinRestError extends Error {
  public readonly data?: any;
  constructor(message: string, data?: any) {
    super(message);
    this.data = data;
    this.name = 'BitcoinRestError';
  }
}