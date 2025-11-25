export type RpcErrorType =
  | 'HTTP_ERROR'
  | 'RPC_ERROR'
  | 'INVALID_PARAMS_GET_BLOCK'
  | 'SIGNING_INCOMPLETE'
  | 'UNKNOWN_ERROR';

/**
 * Custom Error class for handling Bitcoin RPC errors.
 */
export class BitcoinRpcError extends Error {
  public readonly type: RpcErrorType;
  public readonly code: number;
  public readonly data?: unknown;
  constructor(type: RpcErrorType, code: number, message: string, data?: unknown) {
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