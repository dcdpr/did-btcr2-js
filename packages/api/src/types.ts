import type { HttpExecutor, NetworkName, RestConfig, RpcConfig } from '@did-btcr2/bitcoin';
import type { KeyManager } from '@did-btcr2/key-manager';
import type { Btcr2DidDocument } from '@did-btcr2/method';
import type { DidResolutionResult } from '@web5/dids';
import type { CasConfig } from './cas.js';

/**
 * Pluggable logger interface. All methods are optional-call; the default
 * implementation is a silent no-op.
 */
export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

/**
 * The two supported DID identifier types.
 *
 * Note: the upstream `DidCreateOptions.idType` is typed as `string` rather
 * than a union. This local alias provides compile-time safety at the API
 * facade level. Upstream runtime validation in `Identifier.encode()` still
 * catches invalid values.
 */
export type IdType = 'KEY' | 'EXTERNAL';

/**
 * A branded string representing a DID identifier (e.g. `did:btcr2:k1q...`).
 * Use branded types to prevent accidentally passing a txid where a DID is
 * expected, or vice versa, at compile time.
 *
 * @example
 * ```ts
 * const did = api.generateDid().did as DidString;
 * api.resolveDid(did); // OK
 * api.btc.getTransaction(did); // Type error - DidString is not TxId
 * ```
 */
export type DidString = string & { readonly __brand: 'DidString' };

/**
 * A branded string representing a Bitcoin transaction ID (64-char hex).
 */
export type TxId = string & { readonly __brand: 'TxId' };

/**
 * Result of a DID resolution attempt. Wraps the standard
 * {@link DidResolutionResult} with a discriminated `ok` flag for ergonomic
 * pattern matching without exception handling.
 *
 * @example
 * ```ts
 * const result = await api.tryResolveDid(did);
 * if (result.ok) {
 *   console.log(result.document);
 * } else {
 *   console.log(result.error, result.errorMessage);
 * }
 * ```
 */
export type ResolutionResult =
  | { ok: true;  document: Btcr2DidDocument; metadata: DidResolutionResult['didDocumentMetadata']; raw: DidResolutionResult }
  | { ok: false; error: string; errorMessage?: string; raw: DidResolutionResult };

/**
 * How beacon signals are discovered when resolving a DID.
 *
 * - `indexer` reads the transaction listing for each beacon address from an
 *   Esplora-compatible REST backend. This is the default: it is the only option that
 *   scales past a local chain.
 * - `fullnode` scans every block from genesis over Bitcoin Core RPC, requiring no
 *   third-party index. It needs an `rpc` config, a node with `-txindex=1` (prevouts are
 *   resolved with `getrawtransaction`), and Bitcoin Core >= 25 (`getblock` verbosity 3).
 *   The scan is linear in chain length, so it is only practical on regtest.
 *
 * Both paths discover the same signals from the same chain; they differ only in where
 * the data is read from.
 */
export type SignalDiscoveryMode = 'indexer' | 'fullnode';

/**
 * Bitcoin API configuration options.
 * The `network` field is required and determines default REST/RPC endpoints.
 * Optional `rest` and `rpc` fields override individual endpoints on top of
 * the network defaults.
 *
 * @example
 * ```ts
 * // Use regtest defaults (localhost Polar + Esplora)
 * { network: 'regtest' }
 *
 * // Use testnet4 with a custom REST endpoint
 * { network: 'testnet4', rest: { host: 'https://my-mempool.example/api' } }
 *
 * // Use regtest with custom RPC credentials, default REST
 * { network: 'regtest', rpc: { host: 'http://mynode:18443', username: 'u', password: 'p' } }
 *
 * // Read beacon signals straight from a local node instead of an indexer
 * { network: 'regtest', rpc: { ... }, signalDiscovery: 'fullnode' }
 * ```
 */
export type BitcoinApiConfig = {
  /** Bitcoin network name (e.g., 'regtest', 'testnet4', 'bitcoin'). */
  network: NetworkName;
  /** Override REST client settings on top of network defaults. */
  rest?: Partial<RestConfig>;
  /** Override RPC client settings on top of network defaults. */
  rpc?: RpcConfig;
  /**
   * Where beacon signals are read from. Defaults to `indexer`.
   * `fullnode` requires an RPC-capable connection and is rejected at construction
   * without one.
   */
  signalDiscovery?: SignalDiscoveryMode;
  /**
   * Optional HTTP executor for sans-I/O usage. Defaults to global `fetch`.
   * Inject a custom executor to intercept requests in tests or route through
   * a proxy without monkey-patching globals.
   */
  executor?: HttpExecutor;
  /**
   * Optional request timeout in milliseconds for REST calls.
   * When set, wraps the HTTP executor with an `AbortSignal.timeout()`.
   * Has no effect when a custom `executor` is provided (the custom
   * executor is responsible for its own timeouts).
   */
  timeoutMs?: number;
};

/**
 * Top-level API configuration options.
 */
export type ApiConfig = {
  btc?: BitcoinApiConfig;
  cas?: CasConfig;
  kms?: KeyManager;
  /** Optional logger. Defaults to a silent no-op logger. */
  logger?: Logger;
};
