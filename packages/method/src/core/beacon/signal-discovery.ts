import type {
  BitcoinConnection,
  BlockV3,
  RawTransactionRest,
  RawTransactionV2} from '@did-btcr2/bitcoin';
import {
  GENESIS_TX_ID,
  TXIN_WITNESS_COINBASE
} from '@did-btcr2/bitcoin';
import { ResolveError } from '@did-btcr2/common';
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
   * @param {Array<BeaconService>} beaconServices Array of BeaconService objects to retrieve signals for
   * @param {BitcoinConnection} bitcoin Bitcoin network connection to use for REST calls
   * @returns {Promise<Map<BeaconService, Array<BeaconSignal>>>} Map of beacon service to its discovered signals
   */
  static async indexer(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    // Fetch the current block count once before the loop
    const currentBlockCount = await bitcoin.rest.block.count();

    // Iterate over each beacon
    for (const beaconService of beaconServices) {
      beaconServiceSignals.set(beaconService, []);
      const beaconAddress = BeaconUtils.parseBitcoinAddress(beaconService.serviceEndpoint as string);
      // Get the transactions for the beacon address via REST
      const beaconSignals = await bitcoin.rest.address.getTxs(beaconAddress);

      // If no signals are found, continue
      if (!beaconSignals || !beaconSignals.length) {
        continue;
      }

      // Iterate over each signal
      for (const beaconSignal of beaconSignals) {
        // Get the last vout in the transaction
        const lastSignalVout = beaconSignal.vout.slice(-1)[0];

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
          continue;
        }

        // A beacon signal output must be exactly `OP_RETURN OP_PUSHBYTES_32 <32-byte hash>`.
        // Reject any other shape (bare OP_RETURN, wrong push size, non-hex payload) so a
        // malformed on-chain output cannot masquerade as a phantom signal downstream.
        const updateHash = extractOpReturnSignalHash(lastSignalVout.scriptpubkey);
        if(!updateHash) {
          continue;
        }

        // The address listing returns inbound payments too, so require the transaction to
        // spend from the beacon before treating its OP_RETURN as a signal.
        if(!await BeaconSignalDiscovery.spendsFromAddress(beaconSignal, beaconAddress, bitcoin)) {
          continue;
        }

        // Use the pre-fetched block count instead of calling per-signal
        const confirmations = currentBlockCount - beaconSignal.status.block_height + 1;

        // Push the beacon signal object to the signals array for the beacon service
        beaconServiceSignals.get(beaconService)?.push({
          tx            : beaconSignal,
          signalBytes   : updateHash,
          blockMetadata : {
            confirmations,
            height : beaconSignal.status.block_height,
            time   : beaconSignal.status.block_time,
          }
        });
      }
    }

    return beaconServiceSignals;
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
