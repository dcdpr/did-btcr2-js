import type { HttpExecutor } from './client/http.js';
import { BitcoinRestClient } from './client/rest/index.js';
import { BitcoinCoreRpcClient } from './client/rpc/index.js';
import type { BTCNetwork } from './network.js';
import { getNetwork } from './network.js';
import type { NetworkName, RestConfig, RpcConfig } from './types.js';

/**
 * Options for creating a BitcoinConnection.
 */
export type BitcoinConnectionOptions = {
  network: NetworkName;
  rest: RestConfig;
  rpc?: RpcConfig;
  /** Optional HTTP executor for sans-I/O usage. Defaults to global `fetch`. */
  executor?: HttpExecutor;
};

/**
 * Represents a connection to a single Bitcoin network.
 * Holds the REST and optional RPC clients for that network.
 *
 * The underlying clients use a sans-I/O protocol layer that separates
 * request construction from HTTP execution.  By default, requests are
 * executed via the global `fetch` function.  Supply a custom
 * {@link HttpExecutor} to use any HTTP client.
 *
 * Endpoints are explicit: this transport layer holds no service URLs. Callers
 * supply the REST host (and optional RPC) themselves, or use the SDK facade
 * ({@link https://github.com/dcdpr/did-btcr2-js/tree/main/packages/api | @did-btcr2/api}),
 * which carries per-network convenience defaults.
 *
 * @example
 * ```ts
 * // Explicit endpoint (uses the global fetch executor by default)
 * const btc = new BitcoinConnection({ network: 'regtest', rest: { host: 'http://localhost:3000' } });
 *
 * // With a custom HTTP executor
 * const btc = new BitcoinConnection({
 *   network: 'testnet4',
 *   rest: { host: 'https://my-mempool/api' },
 *   executor: myCustomExecutor,
 * });
 *
 * // Direct usage
 * const tx = await btc.rest.transaction.get(txid);
 * const block = await btc.rpc?.getBlock({ height: 100 });
 *
 * // Sans-I/O: build requests without performing I/O
 * const req = btc.rest.protocol.getTx(txid);
 * const res = await myHttpClient.execute(req);
 * ```
 */
export class BitcoinConnection {
  /** The network this connection targets. */
  readonly name: NetworkName;

  /** REST client (Esplora API). */
  readonly rest: BitcoinRestClient;

  /** RPC client (Bitcoin Core). May be undefined if not configured. */
  readonly rpc?: BitcoinCoreRpcClient;

  /** Bitcoin network params (for address derivation, PSBT signing, etc.). */
  readonly data: BTCNetwork;

  constructor(options: BitcoinConnectionOptions) {
    this.name = options.network;
    this.rest = new BitcoinRestClient(options.rest, options.executor);
    this.rpc  = options.rpc ? new BitcoinCoreRpcClient(options.rpc, options.executor) : undefined;
    this.data = getNetwork(options.network);
  }

  /**
   * Converts Bitcoin (BTC) to satoshis.
   * Uses string-based arithmetic to avoid floating-point precision errors.
   * @throws {RangeError} If the value is not finite, is out of range, has
   * more than 8 decimal places of precision, or converts to a satoshi total
   * outside the safe-integer range (about 90,071,992.54740991 BTC).
   */
  static btcToSats(btc: number): number {
    if (!Number.isFinite(btc)) {
      throw new RangeError(`BTC value ${btc} is not finite`);
    }
    // Number.toFixed switches to exponential notation at |x| >= 1e21, which
    // would silently corrupt the string parsing below.
    if (Math.abs(btc) >= 1e21) {
      throw new RangeError(`BTC value ${btc} is out of range`);
    }
    // Handle the sign separately: for -1 < btc < 0 the whole part stringifies
    // to "-0" and Number("-0") === -0, which would drop the sign of the
    // fractional part.
    const negative = btc < 0;
    const abs = Math.abs(btc);
    const str = abs.toFixed(8);
    const [whole, frac] = str.split('.');
    // Verify no precision beyond 8 decimals was lost. The tolerance scales
    // with magnitude: a double cannot represent 8 exact decimal places at
    // large values, so a fixed Number.EPSILON threshold would reject
    // legitimate values whose representation error alone exceeds it
    const tolerance = 4 * Number.EPSILON * Math.max(1, abs);
    if (Math.abs(abs - Number(str)) > tolerance) {
      throw new RangeError(`BTC value ${btc} exceeds 8 decimal places of precision`);
    }
    const sats = negative ? -(Number(whole) * 1e8 + Number(frac)) : Number(whole) * 1e8 + Number(frac);
    // Beyond the safe-integer range the double cannot name every satoshi, so
    // the conversion would silently round to a neighboring value.
    if (!Number.isSafeInteger(sats)) {
      throw new RangeError(`BTC value ${btc} exceeds the safe-integer satoshi range`);
    }
    return sats;
  }

  /**
   * Converts satoshis to Bitcoin (BTC).
   * Uses string-based arithmetic to avoid floating-point precision errors.
   * @param sats Must be a non-negative integer.
   */
  static satsToBtc(sats: number): number {
    const negative = sats < 0;
    const abs = Math.abs(sats);
    const whole = Math.floor(abs / 1e8);
    const frac = abs % 1e8;
    const result = Number(`${whole}.${frac.toString().padStart(8, '0')}`);
    return negative ? -result : result;
  }
}
