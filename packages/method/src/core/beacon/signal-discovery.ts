import type {
  BitcoinConnection,
  BlockV3,
  RawTransactionV2} from '@did-btcr2/bitcoin';
import {
  GENESIS_TX_ID,
  TXIN_WITNESS_COINBASE
} from '@did-btcr2/bitcoin';
import { ResolveError } from '@did-btcr2/common';
import type { BeaconService, BeaconSignal } from './interfaces.js';
import { BeaconUtils } from './utils.js';

/**
 * Validates a scriptPubKey hex string and returns the beacon signal hash if and
 * only if the output is exactly the NULL_DATA byte sequence `6a20<32 bytes>`
 * (`OP_RETURN` followed by a single minimal 32-byte data push).
 *
 * Hex validation is dialect-independent: both Esplora (`scriptpubkey`) and
 * Bitcoin Core (`scriptPubKey.hex`) report the raw script bytes, so this is the
 * authoritative check for both discovery paths and cannot drift between them
 * the way asm tokenization can.
 *
 * @param {string | undefined} hex The scriptPubKey hex string to validate.
 * @returns {string | null} The lowercased 32-byte hex hash, or `null` if not a valid signal.
 */
export function extractOpReturnSignalFromHex(hex: string | undefined): string | null {
  if(!hex) {
    return null;
  }

  const script = hex.trim().toLowerCase();
  if(!/^6a20[0-9a-f]{64}$/.test(script)) {
    return null;
  }

  return script.slice(4);
}

/**
 * Parses a scriptPubKey asm string and returns the beacon signal hash if and
 * only if the output is a single `OP_RETURN` 32-byte data push.
 *
 * Two asm dialects render the same on-the-wire `6a20<32 bytes>` script:
 * Esplora/rust-bitcoin emits three tokens `OP_RETURN OP_PUSHBYTES_32 <64-hex>`,
 * while Bitcoin Core's `ScriptToAsmStr` emits two tokens `OP_RETURN <64-hex>`.
 * Both are accepted. Discovery paths should prefer
 * {@link extractOpReturnSignalFromHex}, which is dialect-independent.
 *
 * Any other shape (a bare `OP_RETURN`, a push of the wrong size, or a non-hex
 * payload) is not a valid signal and returns `null`, so a malformed or
 * adversarial on-chain output cannot be mistaken for a real signal downstream.
 *
 * @param {string | undefined} asm The scriptPubKey asm string to parse.
 * @returns {string | null} The lowercased 32-byte hex hash, or `null` if not a valid signal.
 */
export function extractOpReturnSignal(asm: string | undefined): string | null {
  if(!asm) {
    return null;
  }

  const tokens = asm.trim().split(/\s+/);
  if(tokens[0] !== 'OP_RETURN') {
    return null;
  }

  const payload =
    tokens.length === 3 && tokens[1] === 'OP_PUSHBYTES_32' ? tokens[2] :
      tokens.length === 2 ? tokens[1] :
        undefined;
  if(!payload || !/^[0-9a-fA-F]{64}$/.test(payload)) {
    return null;
  }

  return payload.toLowerCase();
}

/**
 * Static utility class for discovering Beacon Signals on the Bitcoin blockchain.
 * Extracted from `Resolver` for single-responsibility and independent testability.
 *
 * @class BeaconSignalDiscovery
 */
export class BeaconSignalDiscovery {

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
        // Skip unconfirmed (mempool) transactions: a beacon signal must be included
        // in a block. Treating mempool txs as signals yields NaN confirmations and
        // lets unconfirmed data drive resolution.
        if(!beaconSignal.status.confirmed) {
          continue;
        }

        // The tx must spend FROM the beacon address, matching the full-node
        // path's semantics: `/address/:address/txs` returns any tx touching the
        // address, so a third party paying TO the beacon address with an
        // OP_RETURN final output would otherwise surface as a phantom signal
        const spendsFromBeacon = beaconSignal.vin.some(
          (vin) => vin.prevout?.scriptpubkey_address === beaconAddress
        );
        if(!spendsFromBeacon) {
          continue;
        }

        // Get the last vout in the transaction
        const signalVout = beaconSignal.vout.slice(-1)[0];

        /**
         * A beacon signal output is exactly `6a20<32 bytes>` on the wire:
         * {
         *  scriptpubkey: '6a20570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
         *  scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_32 570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
         *  scriptpubkey_type: 'op_return',
         *  value: 0
         * }
         */
        if(!signalVout) {
          continue;
        }

        // Validate the raw script hex (dialect-independent) rather than the asm
        // so a malformed on-chain output cannot masquerade as a phantom signal.
        const updateHash = extractOpReturnSignalFromHex(signalVout.scriptpubkey);
        if(!updateHash) {
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

    // Hoist the beacon services map before the loop
    const beaconServicesMap = BeaconUtils.getBeaconServicesMap(beaconServices);

    // Set genesis height
    let height = 0;

    // Opt into rpc connection to get the block data at the blockhash
    let block = await bitcoin.rpc!.getBlock({ height }) as BlockV3;

    console.info(`Searching for beacon signals, please wait ...`);
    while (block.height <= targetHeight) {
      // Iterate over each transaction in the block
      for (const tx of block.tx) {
        // If the txid is a coinbase, continue ...
        if (tx.txid === GENESIS_TX_ID) {
          continue;
        }

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
          if (!beaconService) {
            continue;
          }

          // The signal is carried by the SPENDING transaction's last output (an
          // OP_RETURN), never by the spent prevout: the prevout is the beacon
          // address's payment script, so reading it here always yielded null and
          // full-node discovery silently reported zero signals.
          // Validate the raw script hex: Bitcoin Core renders the push as
          // two-token asm `OP_RETURN <64-hex>` with no OP_PUSHBYTES_32 token,
          // so asm parsing under-counts signals against a real full node
          const signalVout = tx.vout.slice(-1)[0];
          const updateHash = extractOpReturnSignalFromHex(signalVout?.scriptPubKey?.hex);
          if(!updateHash) {
            continue;
          }

          // Log the found txid and beacon
          console.info(`Tx ${tx.txid} contains beacon service address ${scriptPubKey.address} and OP_RETURN!`, tx);

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
