import type {
  BitcoinConnection,
  BlockV3,
  RawTransactionRest,
  RawTransactionV2} from '@did-btcr2/bitcoin';
import {
  ESPLORA_CHAIN_PAGE_SIZE,
  GENESIS_TX_ID,
  TXIN_WITNESS_COINBASE
} from '@did-btcr2/bitcoin';
import { INTERNAL_ERROR, ResolveError } from '@did-btcr2/common';
import type { BeaconService, BeaconSignal } from './interfaces.js';
import { BeaconUtils } from './utils.js';

/**
 * The serialized form of a Beacon Signal output: `OP_RETURN` (`0x6a`), the 32-byte push
 * opcode (`0x20`), then the 32-byte hash. This is the exact inverse of `opReturnScript`,
 * which encodes signals as `0x6a 0x20 <32 bytes>` and is pinned byte for byte by
 * `op-return-script.spec.ts`.
 */
const BEACON_SIGNAL_SCRIPT = /^6a20([0-9a-f]{64})$/i;

/**
 * Returns true if the error is the REST client error for an HTTP 404 response
 * (`MethodError` `FAILED_HTTP_REQUEST` with `data.status` 404).
 * @param {unknown} error The error that a REST call threw.
 * @returns {boolean} True for an HTTP 404 response.
 */
function isNotFound(error: unknown): boolean {
  const failure = error as { type?: unknown; data?: { status?: unknown } } | undefined;
  return failure?.type === 'FAILED_HTTP_REQUEST' && failure.data?.status === 404;
}

/**
 * Returns the error for a walk that stops before the end of the history of a beacon
 * address (rules 3 and 4 of `addressSignals`).
 * @param {string} address The beacon address.
 * @returns {ResolveError} The `INTERNAL_ERROR` error.
 */
function walkStopped(address: string): ResolveError {
  return new ResolveError(
    `Discovery did not get to the end of the history of beacon address ${address}. `
    + 'The history changed during discovery (resolve again later), or the Bitcoin REST backend '
    + 'does not page the history in a stable order with the last_seen_txid cursor.',
    INTERNAL_ERROR, { address }
  );
}

/** The data that one indexer run shares across its beacon addresses. */
interface IndexerRun {
  /** The Bitcoin network connection for the REST calls. */
  bitcoin: BitcoinConnection;
  /** The block count, read one time before the first listing. */
  blockCount: number;
  /** The median time past of each block that holds a signal, keyed by block hash. */
  mediantimes: Map<string, number>;
}

/**
 * Parses a serialized scriptPubKey and returns the beacon signal hash if and only if the
 * output is exactly `OP_RETURN OP_PUSHBYTES_32 <32-byte hash>`.
 *
 * Beacon signals encode a single 32-byte update or announcement hash in an OP_RETURN data
 * push. Any other shape (a bare `OP_RETURN`, a push of the wrong size, a second push, or a
 * non-canonical push opcode such as `OP_PUSHDATA1`) is not a valid signal and returns
 * `null`, so a malformed or adversarial on-chain output cannot be mistaken for a real
 * signal downstream.
 *
 * The input is the script itself, not a rendered `asm` string, because `asm` is a
 * human-readable rendering whose dialect differs per backend: Bitcoin Core prints
 * `OP_RETURN <hash>` while Esplora prints `OP_RETURN OP_PUSHBYTES_32 <hash>`. Both return
 * the identical serialized script (Esplora as `scriptpubkey`, Core as `scriptPubKey.hex`),
 * so decoding the script is backend-agnostic and matches the bytes actually committed to
 * the chain.
 *
 * @param {string | undefined} scriptPubKey Hex-encoded scriptPubKey of the output to parse.
 * @returns {string | null} The lowercased 32-byte hex hash, or `null` if not a valid signal.
 */
export function extractOpReturnSignalHash(scriptPubKey: string | undefined): string | null {
  if(!scriptPubKey) {
    return null;
  }

  const signal = BEACON_SIGNAL_SCRIPT.exec(scriptPubKey.trim());
  if(!signal) {
    return null;
  }

  return signal[1].toLowerCase();
}

/**
 * Static utility class for discovering Beacon Signals on the Bitcoin blockchain.
 * Extracted from `Resolver` for single-responsibility and independent testability.
 *
 * @class BeaconSignalDiscovery
 */
export class BeaconSignalDiscovery {

  /**
   * Determines whether a candidate transaction spends an output controlled by the given
   * beacon address.
   *
   * A Beacon Signal is a transaction that *spends from* a Beacon Address, but an address
   * transaction listing returns every transaction touching the address in either
   * direction. Without this check, anyone able to pay dust to a beacon address could
   * attach an arbitrary 32-byte OP_RETURN and have it read as a signal, so the input side
   * has to be inspected before a transaction is treated as one.
   *
   * Esplora embeds the spent output in `vin[].prevout`; when a backend omits it the
   * funding transaction is fetched instead, so a missing field cannot silently drop a
   * real signal.
   *
   * @param {RawTransactionRest} tx The candidate transaction.
   * @param {string} address The beacon address the transaction must spend from.
   * @param {BitcoinConnection} bitcoin Bitcoin network connection to use for REST calls.
   * @returns {Promise<boolean>} True if at least one input spends an output of the beacon address.
   */
  private static async spendsFromAddress(
    tx: RawTransactionRest,
    address: string,
    bitcoin: BitcoinConnection
  ): Promise<boolean> {
    for(const vin of tx.vin ?? []) {
      // A coinbase input spends no prior output, so it can never spend from a beacon.
      if(vin.is_coinbase) {
        continue;
      }

      let prevout = vin.prevout;

      // Fall back to the funding transaction when the backend does not embed the prevout.
      if(!prevout && vin.txid) {
        const fundingTx = await bitcoin.rest.transaction.get(vin.txid);
        prevout = fundingTx?.vout?.[vin.vout];
      }

      if(prevout?.scriptpubkey_address === address) {
        return true;
      }
    }

    return false;
  }

  /**
   * Retrieves the beacon signals for the given array of BeaconService objects
   * using an esplora/electrs REST API connection via a bitcoin I/O driver.
   *
   * The method reads the full confirmed history of each beacon address (see
   * {@link addressSignals}). The specification says that the resolver must process
   * each Beacon Signal, so the first page of the history is not sufficient: any person
   * can pay the beacon address 25 times and push an older signal off that page.
   *
   * The `confirmations` count uses the block count fetched before the listing.
   * A block that arrives between the two calls yields a count of `0` for its
   * transactions. The resolver then excludes them, because its minimum is at
   * least `1`. An under-count is the safe direction, so keep that order.
   * @param {Array<BeaconService>} beaconServices Array of BeaconService objects to retrieve signals for
   * @param {BitcoinConnection} bitcoin Bitcoin network connection to use for REST calls
   * @returns {Promise<Map<BeaconService, Array<BeaconSignal>>>} Map of beacon service to its discovered signals
   * @throws {ResolveError} `INTERNAL_ERROR` if discovery cannot read the full history of a beacon address,
   *   for example because the history changed during discovery, or if the backend does not serve the
   *   chain listing.
   */
  static async indexer(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    // Fetch the current block count once before the listings. The median time past
    // cache serves the whole run: one block record fetch per distinct block.
    const run: IndexerRun = {
      bitcoin,
      blockCount  : await bitcoin.rest.block.count(),
      mediantimes : new Map<string, number>(),
    };

    // Iterate over each beacon
    for (const beaconService of beaconServices) {
      const beaconAddress = BeaconUtils.parseBitcoinAddress(beaconService.serviceEndpoint as string);
      beaconServiceSignals.set(beaconService, await BeaconSignalDiscovery.addressSignals(beaconAddress, run));
    }

    return beaconServiceSignals;
  }

  /**
   * Returns the beacon signals in the confirmed history of one beacon address. The
   * method walks the history one time, newest first. The listing is Esplora
   * `GET /address/:address/txs/chain[/:last_seen_txid]`, which holds no mempool
   * transaction. The rules of the walk:
   *
   * 1. After a full page, the cursor of the next page is the second-to-last
   *    transaction of the raw page. Thus the next page starts again with the last
   *    transaction of the page, the overlap transaction. The cursor is not the last
   *    signal: a page of payments to the beacon holds no signal, and the walk must go
   *    past it.
   * 2. A page shorter than {@link ESPLORA_CHAIN_PAGE_SIZE} is the last page. The
   *    request sets that page size. The last page of a history of exactly 25
   *    transactions holds only the overlap transaction.
   * 3. After a full page, the next page must start with the overlap transaction, in
   *    the same block. Else discovery raises an error. Electrs gives an empty page
   *    for a cursor that it does not know, so an empty page is never the end after a
   *    full page. A block reorganization or a backend instance that is some blocks
   *    behind gives such a page. The same block hash at one height means the same
   *    chain at that height and below, thus the same rest of the history. Each page
   *    holds this proof, so the rule also applies if the pages come from different
   *    backend instances.
   * 4. A full page must hold a transaction that the walk did not read. Else discovery
   *    raises an error, because the walk does not advance.
   *
   * A signal that discovery does not read gives an old DID document with no error, so
   * the method never returns a part of the history. The method does not walk the
   * history again after an error. The caller resolves again later.
   *
   * The rules need a stable listing order: the newest block first, and a fixed order
   * in each block. Blockstream electrs and mempool-electrs v3.2.0 and later use such
   * an order. For a backend with a different order, rule 3 stops the walk, and
   * discovery raises an error.
   *
   * @param {string} address The beacon address.
   * @param {IndexerRun} run The data of the indexer run.
   * @returns {Promise<Array<BeaconSignal>>} The beacon signals of the address, newest first.
   * @throws {ResolveError} `INTERNAL_ERROR` if the walk stops before the end of the history (rules 3 and 4).
   */
  private static async addressSignals(address: string, run: IndexerRun): Promise<Array<BeaconSignal>> {
    const signals: Array<BeaconSignal> = [];
    // The ids of the transactions that this walk read. The next page repeats the
    // overlap transaction.
    const read = new Set<string>();
    let cursor: string | undefined;
    let overlap: RawTransactionRest | undefined;

    for(;;) {
      const page = await BeaconSignalDiscovery.historyPage(address, cursor, run) ?? [];

      // Rule 3.
      if(overlap && !BeaconSignalDiscovery.continuesAfter(page, overlap)) {
        throw walkStopped(address);
      }

      // Rule 4.
      const full = page.length >= ESPLORA_CHAIN_PAGE_SIZE;
      if(full && page.every(tx => read.has(tx.txid))) {
        throw walkStopped(address);
      }

      for(const tx of page) {
        if(read.has(tx.txid)) {
          continue;
        }
        read.add(tx.txid);
        const signal = await BeaconSignalDiscovery.indexerSignal(tx, address, run);
        if(signal) {
          signals.push(signal);
        }
      }

      // Rule 2.
      if(!full) {
        return signals;
      }

      // Rule 1: take the cursor from the raw page, not from the signals.
      overlap = page[page.length - 1];
      cursor = page[page.length - 2].txid;
    }
  }

  /**
   * Returns one page of the confirmed history of a beacon address.
   * @param {string} address The beacon address.
   * @param {string | undefined} cursor The second-to-last transaction of the previous page, or `undefined` for the first page.
   * @param {IndexerRun} run The data of the indexer run.
   * @returns {Promise<Array<RawTransactionRest>>} The page, newest first.
   * @throws {ResolveError} `INTERNAL_ERROR` if the backend does not serve the listing (HTTP 404).
   */
  private static async historyPage(
    address: string,
    cursor: string | undefined,
    run: IndexerRun
  ): Promise<Array<RawTransactionRest>> {
    try {
      return await run.bitcoin.rest.address.getConfirmedTxs(address, cursor);
    } catch(error) {
      // A mempool backend in electrum mode serves `/address/:address/txs` but not the
      // chain listing. Name the requirement instead of a bare HTTP error.
      if(isNotFound(error)) {
        throw new ResolveError(
          'The Bitcoin REST backend does not serve GET /address/:address/txs/chain, so discovery cannot read '
          + 'the full history of the beacon address. Use an Esplora API that serves it (a mempool instance '
          + 'needs MEMPOOL_BACKEND=esplora), or use the fullnode signal discovery.',
          INTERNAL_ERROR, { address, cause: (error as { data?: unknown }).data }
        );
      }
      throw error;
    }
  }

  /**
   * Returns true if a page starts with the overlap transaction of the previous full
   * page, in the same block (rule 3 of {@link addressSignals}).
   * @param {Array<RawTransactionRest>} page The page after the full page.
   * @param {RawTransactionRest} overlap The last transaction of the full page.
   * @returns {boolean} False if the page does not continue the history of the full page.
   */
  private static continuesAfter(page: Array<RawTransactionRest>, overlap: RawTransactionRest): boolean {
    const first = page[0];
    return first?.txid === overlap.txid
      && overlap.status.confirmed === true
      && first.status.block_hash === overlap.status.block_hash;
  }

  /**
   * Returns the beacon signal of one transaction of a beacon address history, or
   * `undefined` if the transaction is not a beacon signal of that address.
   *
   * The method skips a transaction whose `status.confirmed` is not `true`. The chain
   * listing holds only confirmed transactions, so this check is a guard against a
   * backend that lists one with no block. A mempool transaction has no block height
   * and no block time, so it cannot carry block metadata, and the specification says
   * that a resolver must not process it. An absent flag counts as unconfirmed, as it
   * does for UTXO selection. The check runs before the OP_RETURN parse, so such a
   * transaction costs no prevout fetch. The {@link fullnode} path needs no such check:
   * it walks mined blocks only.
   * @param {RawTransactionRest} tx The transaction from the address history.
   * @param {string} address The beacon address.
   * @param {IndexerRun} run The data of the indexer run.
   * @returns {Promise<BeaconSignal | undefined>} The beacon signal, or `undefined`.
   */
  private static async indexerSignal(
    tx: RawTransactionRest,
    address: string,
    run: IndexerRun
  ): Promise<BeaconSignal | undefined> {
    const status = tx.status;
    if(status.confirmed !== true) {
      return undefined;
    }

    // Get the last vout in the transaction
    const lastSignalVout = tx.vout.slice(-1)[0];

    /**
     * Decode the signal from the serialized script, not from `scriptpubkey_asm`: the
     * asm rendering is backend-specific, the script is not.
     * Vout (rest) format:
     * {
     *  scriptpubkey: '6a20570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
     *  scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_32 570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
     *  scriptpubkey_type: 'op_return',
     *  value: 0
     * }
     */
    if(!lastSignalVout) {
      return undefined;
    }

    // A beacon signal output must be exactly `OP_RETURN OP_PUSHBYTES_32 <32-byte hash>`.
    // Reject any other shape (bare OP_RETURN, wrong push size, non-hex payload) so a
    // malformed or adversarial on-chain output cannot masquerade as a phantom signal downstream.
    const updateHash = extractOpReturnSignalHash(lastSignalVout.scriptpubkey);
    if(!updateHash) {
      return undefined;
    }

    // The address listing returns inbound payments too, so require the transaction to
    // spend from the beacon before treating its OP_RETURN as a signal.
    if(!await BeaconSignalDiscovery.spendsFromAddress(tx, address, run.bitcoin)) {
      return undefined;
    }

    // Use the pre-fetched block count instead of calling per-signal
    const confirmations = run.blockCount - status.block_height + 1;

    // The address listing carries the header time of the block, not its median
    // time past. The resolver compares `versionTime` with the median time past,
    // so read it from the block record.
    const mediantime = await BeaconSignalDiscovery.mediantime(status.block_hash, run.bitcoin, run.mediantimes);

    return {
      tx,
      signalBytes   : updateHash,
      blockMetadata : {
        confirmations,
        height : status.block_height,
        time   : status.block_time,
        mediantime,
      }
    };
  }

  /**
   * Return the median time past of a block, from the per-run cache or from the
   * Esplora block record (`GET /block/:hash`). The specification compares
   * `versionTime` with the block `mediantime`, and the address listing does not
   * carry it. One block record serves every signal in that block.
   * @param {string} blockhash The hash of the block that contains a signal.
   * @param {BitcoinConnection} bitcoin Bitcoin network connection to use for REST calls.
   * @param {Map<string, number>} cache The median time past values fetched so far, keyed by block hash.
   * @returns {Promise<number>} The median time past of the block, in Unix seconds.
   * @throws {ResolveError} `INTERNAL_ERROR` if the backend returns no block record or no `mediantime` for the hash.
   */
  private static async mediantime(
    blockhash: string,
    bitcoin: BitcoinConnection,
    cache: Map<string, number>
  ): Promise<number> {
    const cached = cache.get(blockhash);
    if(cached !== undefined) {
      return cached;
    }
    const block = await bitcoin.rest.block.get({ blockhash });
    const mediantime = block?.mediantime;
    if(typeof mediantime !== 'number' || !Number.isFinite(mediantime)) {
      throw new ResolveError(
        `Block ${blockhash} has no mediantime in the block record of the Bitcoin REST backend.`,
        INTERNAL_ERROR, { blockhash, block }
      );
    }
    cache.set(blockhash, mediantime);
    return mediantime;
  }

  /**
   * Traverse the full blockchain from genesis to chain top looking for beacon signals.
   * @param {Array<BeaconService>} beaconServices Array of BeaconService objects to search for signals.
   * @param {BitcoinConnection} bitcoin Bitcoin network connection to use for RPC calls.
   * @returns {Promise<Map<BeaconService, Array<BeaconSignal>>>} Map of beacon service to its discovered signals.
   */
  static async fullnode(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    for(const beaconService of beaconServices) {
      beaconServiceSignals.set(beaconService, []);
    }

    // Get the RPC connection from the bitcoin network
    const rpc = bitcoin.rpc;

    // Ensure that the RPC connection is available
    if(!rpc) {
      throw new ResolveError('RPC connection is not available', 'RPC_CONNECTION_ERROR', bitcoin);
    }

    // Get the current block height once before the loop
    const targetHeight = await rpc.getBlockCount();

    /**
     * Hoist the beacon address lookup before the loop, mapping each address to the caller's
     * own service object. The results below are keyed by object identity, so the map has to
     * hold those exact instances rather than copies of them. Addresses are parsed the same
     * way as on the indexer path, so a BIP21 endpoint carrying query parameters resolves to
     * the bare address a spent output reports.
     */
    const beaconServicesMap = new Map<string, BeaconService>(
      beaconServices.map(service => [BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string), service])
    );

    // Set genesis height
    let height = 0;

    // Opt into rpc connection to get the block data at the blockhash
    let block = await bitcoin.rpc!.getBlock({ height }) as BlockV3;

    console.info(`Searching for beacon signals, please wait ...`);
    while (block.height <= targetHeight) {
      // Iterate over each transaction in the block
      for (const tx of block.tx) {
        // If the txid is a genesis transaction, continue ...
        if (tx.txid === GENESIS_TX_ID) {
          continue;
        }

        /**
         * A Beacon Signal announces its update hash in the last output of the *spending*
         * transaction, so the hash is resolved once per transaction, before the input side
         * is inspected. The output being spent carries a plain locking script and never a
         * signal. A beacon signal output must be exactly
         * `OP_RETURN OP_PUSHBYTES_32 <32-byte hash>`; rejecting any other shape here also
         * keeps the free filter ahead of the prevout lookups below.
         *
         * The signal is decoded from `scriptPubKey.hex`, the same serialized script the
         * indexer path reads as `scriptpubkey`. Core's `asm` renders a data push as bare
         * hex (`OP_RETURN <hash>`) where Esplora names the push opcode
         * (`OP_RETURN OP_PUSHBYTES_32 <hash>`), so an asm-shaped check written against one
         * backend silently discards every signal from the other.
         * Vout (rpc) format:
         * {
         *  value: 0,
         *  n: 1,
         *  scriptPubKey: {
         *    asm: "OP_RETURN 7af2be9fcb371dfcc5465a74373d499c11b1f7bba47e0507fce892ea12ec1cd6",
         *    desc: "raw(6a207af2be9fcb371dfcc5465a74373d499c11b1f7bba47e0507fce892ea12ec1cd6)#g064zwfr",
         *    hex: "6a207af2be9fcb371dfcc5465a74373d499c11b1f7bba47e0507fce892ea12ec1cd6",
         *    type: "nulldata",
         *  },
         * }
         */
        const lastSignalVout = tx.vout.slice(-1)[0];
        if (!lastSignalVout) {
          continue;
        }

        const updateHash = extractOpReturnSignalHash(lastSignalVout.scriptPubKey?.hex);
        if (!updateHash) {
          continue;
        }

        // One transaction is one signal per beacon, however many of that beacon's UTXOs
        // it spends, so track the services already credited with this transaction.
        const signaled = new Set<BeaconService>();

        // Iterate over each input in the transaction
        for (const vin of tx.vin) {

          // If the vin is a coinbase transaction, continue ...
          if (vin.coinbase) {
            continue;
          }

          // If the vin txinwitness contains a coinbase did, continue ...
          if (vin.txinwitness && vin.txinwitness.length === 1 && vin.txinwitness[0] === TXIN_WITNESS_COINBASE) {
            continue;
          }

          // If the txid from the vin is undefined, continue ...
          if (!vin.txid) {
            continue;
          }

          // If the vout from the vin is undefined, continue ...
          if (vin.vout === undefined) {
            continue;
          }

          // Get the previous output transaction data
          const prevout = await rpc.getRawTransaction(vin.txid, 2) as RawTransactionV2;

          // If the previous output vout at the vin.vout index is undefined, continue ...
          if (!prevout.vout[vin.vout]) {
            continue;
          }

          // Get the address from the scriptPubKey from the prevvout
          const scriptPubKey = prevout.vout[vin.vout].scriptPubKey;

          // If the scriptPubKey.address is undefined, continue ...
          if (!scriptPubKey.address) {
            continue;
          }

          // Use the hoisted beaconServicesMap instead of rebuilding per-vin
          const beaconService = beaconServicesMap.get(scriptPubKey.address);
          if (!beaconService || signaled.has(beaconService)) {
            continue;
          }
          signaled.add(beaconService);

          // Log the found txid and beacon
          console.info(`Tx ${tx.txid} contains beacon address ${scriptPubKey.address}`);

          // Push the beacon signal object to the beacon signals array for that beacon service
          beaconServiceSignals.get(beaconService)?.push({
            tx,
            signalBytes   : updateHash,
            blockMetadata : {
              height        : block.height,
              time          : block.time,
              mediantime    : block.mediantime,
              confirmations : block.confirmations
            }
          });
        };
      }

      // Increment the height
      height += 1;

      // Use pre-fetched targetHeight instead of calling rpc.getBlockCount() every iteration
      if(height > targetHeight) {
        console.info(`Chain tip reached ${height}, breaking ...`);
        break;
      }

      // Reset the block var to the next block data
      block = await rpc.getBlock({ height }) as BlockV3;
    }

    return beaconServiceSignals;
  }
}
