/**
 * Structural validation for untrusted Bitcoin endpoint responses.
 *
 * Amounts, UTXO sets, and confirmation status returned by an Esplora or
 * Bitcoin Core endpoint flow directly into resolution and funding decisions.
 * Each `check*` function returns `null` when the value has the expected
 * shape, otherwise a short human-readable reason. Callers turn a non-null
 * reason into the client-appropriate typed error (`BitcoinRestError` for
 * REST, `BitcoinRpcError` for RPC).
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Esplora/RPC transaction status object: `{ confirmed, block_height?, ... }`. */
export function checkTransactionStatus(value: unknown): string | null {
  if (!isPlainObject(value)) return 'status is not an object';
  if (typeof value.confirmed !== 'boolean') return 'status.confirmed is not a boolean';
  // A confirmed tx must report the block it was mined in; confirmation counts
  // are derived from this height downstream.
  if (value.confirmed === true && !isNonNegativeInteger(value.block_height)) {
    return 'status.block_height is not a non-negative integer for a confirmed transaction';
  }
  return null;
}

/** Esplora `/tx` transaction object. */
export function checkRawTransactionRest(value: unknown): string | null {
  if (!isPlainObject(value)) return 'transaction is not an object';
  if (!isNonEmptyString(value.txid)) return 'txid is not a non-empty string';
  if (!Array.isArray(value.vin)) return 'vin is not an array';
  if (!Array.isArray(value.vout)) return 'vout is not an array';
  const statusReason = checkTransactionStatus(value.status);
  if (statusReason) return statusReason;
  for (const [i, vout] of (value.vout as unknown[]).entries()) {
    if (!isPlainObject(vout)) return `vout[${i}] is not an object`;
    if (typeof vout.scriptpubkey !== 'string') return `vout[${i}].scriptpubkey is not a string`;
    if (!isNonNegativeNumber(vout.value)) return `vout[${i}].value is not a non-negative number`;
  }
  return null;
}

/** Esplora `/address/:address/utxo` entry. `value` must be integer sats: it is fed to `BigInt()`. */
export function checkAddressUtxo(value: unknown): string | null {
  if (!isPlainObject(value)) return 'utxo is not an object';
  if (typeof value.txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value.txid)) {
    return 'utxo.txid is not a 64-character hex string';
  }
  if (!isNonNegativeInteger(value.vout)) return 'utxo.vout is not a non-negative integer';
  if (!isNonNegativeInteger(value.value)) return 'utxo.value is not a non-negative integer (sats)';
  return checkTransactionStatus(value.status);
}

/** Esplora `/block/:hash` object. */
export function checkEsploraBlock(value: unknown): string | null {
  if (!isPlainObject(value)) return 'block is not an object';
  if (!isNonEmptyString(value.id)) return 'block.id is not a non-empty string';
  if (!isNonNegativeInteger(value.height)) return 'block.height is not a non-negative integer';
  if (!isNonNegativeInteger(value.tx_count)) return 'block.tx_count is not a non-negative integer';
  return null;
}

/** Esplora `/address/:address` info object. */
export function checkAddressInfo(value: unknown): string | null {
  if (!isPlainObject(value)) return 'address info is not an object';
  if (!isPlainObject(value.chain_stats)) return 'chain_stats is not an object';
  if (!isPlainObject(value.mempool_stats)) return 'mempool_stats is not an object';
  return null;
}

/** Verbose (`getrawtransaction` v1/v2) transaction from Bitcoin Core. */
function checkRawTransactionRpc(value: unknown): string | null {
  // Verbosity 0 returns a bare hex string.
  if (typeof value === 'string') return value.length > 0 ? null : 'result is an empty string';
  if (!isPlainObject(value)) return 'transaction is not an object';
  if (!isNonEmptyString(value.txid)) return 'txid is not a non-empty string';
  if (!Array.isArray(value.vin)) return 'vin is not an array';
  if (!Array.isArray(value.vout)) return 'vout is not an array';
  for (const [i, vout] of (value.vout as unknown[]).entries()) {
    if (!isPlainObject(vout)) return `vout[${i}] is not an object`;
    if (!isNonNegativeNumber(vout.value)) return `vout[${i}].value is not a non-negative number`;
    if (!isPlainObject(vout.scriptPubKey)) return `vout[${i}].scriptPubKey is not an object`;
  }
  return null;
}

/** `getblock` result: hex string at verbosity 0, decoded object otherwise. */
function checkBlockRpc(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? null : 'result is an empty string';
  if (!isPlainObject(value)) return 'block is not an object';
  if (!isNonEmptyString(value.hash)) return 'block.hash is not a non-empty string';
  if (!isNonNegativeInteger(value.height)) return 'block.height is not a non-negative integer';
  return null;
}

/** `listunspent` entry. `amount` is a BTC float and feeds funding decisions. */
function checkUnspentTxInfo(value: unknown): string | null {
  if (!isPlainObject(value)) return 'utxo is not an object';
  if (!isNonEmptyString(value.txid)) return 'utxo.txid is not a non-empty string';
  if (!isNonNegativeInteger(value.vout)) return 'utxo.vout is not a non-negative integer';
  if (!isNonNegativeNumber(value.amount)) return 'utxo.amount is not a non-negative number';
  return null;
}

function checkStringArray(value: unknown): string | null {
  if (!Array.isArray(value)) return 'result is not an array';
  for (const [i, entry] of value.entries()) {
    if (typeof entry !== 'string') return `result[${i}] is not a string`;
  }
  return null;
}

/**
 * Structural check on a Bitcoin Core RPC result for the given method.
 * Methods without an entry pass through unchecked (`null`).
 */
export function checkRpcResult(method: string, result: unknown): string | null {
  switch (method) {
    case 'getblockcount':
      return isNonNegativeInteger(result) ? null : 'result is not a non-negative integer';
    case 'getbalance':
      return typeof result === 'number' && Number.isFinite(result) ? null : 'result is not a finite number';
    case 'getbestblockhash':
    case 'getblockhash':
    case 'getnewaddress':
    case 'createrawtransaction':
    case 'sendrawtransaction':
    case 'sendtoaddress':
    case 'signmessage':
      return isNonEmptyString(result) ? null : 'result is not a non-empty string';
    case 'verifymessage':
      return typeof result === 'boolean' ? null : 'result is not a boolean';
    case 'getblockchaininfo':
      if (!isPlainObject(result)) return 'result is not an object';
      if (!isNonNegativeInteger(result.blocks)) return 'result.blocks is not a non-negative integer';
      if (typeof result.chain !== 'string') return 'result.chain is not a string';
      return null;
    case 'getblock':
      return checkBlockRpc(result);
    case 'getrawtransaction':
      return checkRawTransactionRpc(result);
    case 'gettransaction':
      if (!isPlainObject(result)) return 'result is not an object';
      if (!isNonEmptyString(result.txid)) return 'result.txid is not a non-empty string';
      if (typeof result.amount !== 'number' || !Number.isFinite(result.amount)) {
        return 'result.amount is not a finite number';
      }
      return null;
    case 'signrawtransactionwithwallet':
      if (!isPlainObject(result)) return 'result is not an object';
      if (typeof result.hex !== 'string') return 'result.hex is not a string';
      if (typeof result.complete !== 'boolean') return 'result.complete is not a boolean';
      return null;
    case 'listunspent':
      if (!Array.isArray(result)) return 'result is not an array';
      for (const [i, entry] of result.entries()) {
        const reason = checkUnspentTxInfo(entry);
        if (reason) return `result[${i}]: ${reason}`;
      }
      return null;
    case 'listtransactions':
      return Array.isArray(result) ? null : 'result is not an array';
    case 'deriveaddresses':
    case 'generatetoaddress':
      return checkStringArray(result);
    default:
      return null;
  }
}
