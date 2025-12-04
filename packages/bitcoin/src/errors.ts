/**
 * Custom Error class for handling Bitcoin RPC errors.
 */
export class BitcoinRpcError extends Error {
  public readonly type: string;
  public readonly code: number;
  public readonly data?: any;
  constructor(type: string, code: number, message: string, data?: any) {
    super(message);
    this.type = type;
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