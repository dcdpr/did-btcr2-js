
export interface ClientConfig {
    headers?: Record<string, string>;
    host?: string;
    logger?: any;
    password?: string;
    timeout?: number;
    username?: string;
    version?: string;
    wallet?: string;
    allowDefaultWallet?: boolean;
}

export class RpcClientConfig implements ClientConfig {
  network?: string;
  headers?: Record<string, string>;
  host?: string;
  logger?: any;
  password?: string;
  timeout?: number;
  username?: string;
  version?: string;
  wallet?: string;
  allowDefaultWallet?: boolean;

  constructor(options: ClientConfig = {
    headers            : {},
    host               : 'localhost',
    logger             : console,
    password           : '',
    timeout            : 30000,
    username           : '',
    version            : '0.21.1',
    wallet             : '',
    allowDefaultWallet : false,
  }) {
    this.headers = options.headers;
    this.host = options.host;
    this.logger = options.logger;
    this.password = options.password;
    this.timeout = options.timeout;
    this.username = options.username;
    this.version = options.version;
    this.wallet = options.wallet;
    this.allowDefaultWallet = options.allowDefaultWallet;
  }

  public static initialize(options?: ClientConfig): RpcClientConfig {
    return new RpcClientConfig(options);
  }
}