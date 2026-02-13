import {
  BitcoinNetworkConnection,
  BlockV3,
  GENESIS_TX_ID,
  RawTransactionV2,
  TXIN_WITNESS_COINBASE
} from '@did-btcr2/bitcoin';
import { ResolveError } from '@did-btcr2/common';
import { BeaconService, BeaconSignal } from './interfaces.js';
import { BeaconUtils } from './utils.js';

/**
 * Static utility class for discovering Beacon Signals on the Bitcoin blockchain.
 * Extracted from {@link Resolve} for single-responsibility and independent testability.
 *
 * @class BeaconSignalDiscovery
 */
export class BeaconSignalDiscovery {

  /**
   * Retrieves the beacon signals for the given array of BeaconService objects
   * using an esplora/electrs REST API connection via a bitcoin I/O driver.
   * @param {Array<BeaconService>} beaconServices Array of BeaconService objects to retrieve signals for
   * @param {BitcoinNetworkConnection} bitcoin Bitcoin network connection to use for REST calls
   * @returns {Promise<Map<BeaconService, Array<BeaconSignal>>>} Map of beacon service to its discovered signals
   */
  static async indexer(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinNetworkConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    // Fetch the current block count once before the loop
    const currentBlockCount = await bitcoin.network.rest.block.count();

    // Iterate over each beacon
    for (const beaconService of beaconServices) {
      beaconServiceSignals.set(beaconService, []);
      // Get the transactions for the beacon address via REST
      const beaconSignals = await bitcoin.network.rest.address.getTxs(
        beaconService.serviceEndpoint as string
      );

      // If no signals are found, continue
      if (!beaconSignals || !beaconSignals.length) {
        continue;
      }

      // Iterate over each signal
      for (const beaconSignal of beaconSignals) {
        // Get the last vout in the transaction
        const signalVout = beaconSignal.vout.slice(-1)[0];

        /**
         * Look for OP_RETURN in last vout scriptpubkey_asm
         * Vout (rest) format:
         * {
         *  scriptpubkey: '6a20570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
         *  scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_32 570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a',
         *  scriptpubkey_type: 'op_return',
         *  value: 0
         * }
         */
        if(!signalVout || !signalVout.scriptpubkey_asm.includes('OP_RETURN')) {
          continue;
        }

        // Construct output map for easier access
        const outputMap = new Map<string, string | number>(Object.entries(signalVout));

        // Grab the signal vout scriptpubkey
        const signalVoutScriptPubkey = outputMap.get('scriptpubkey_asm') as string;

        // If the signal vout scriptpubkey does not exist, continue to next signal
        if(!signalVoutScriptPubkey){
          continue;
        }

        // Extract hex string hash of the signal bytes from the scriptpubkey
        const updateHash = signalVoutScriptPubkey.split(' ').slice(-1)[0];
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
   * @param {BitcoinNetworkConnection} bitcoin Bitcoin network connection to use for RPC calls.
   * @returns {Promise<Map<BeaconService, Array<BeaconSignal>>>} Map of beacon service to its discovered signals.
   */
  static async fullnode(
    beaconServices: Array<BeaconService>,
    bitcoin: BitcoinNetworkConnection
  ): Promise<Map<BeaconService, Array<BeaconSignal>>> {
    const beaconServiceSignals = new Map<BeaconService, Array<BeaconSignal>>();

    for(const beaconService of beaconServices) {
      beaconServiceSignals.set(beaconService, []);
    }

    // Get the RPC connection from the bitcoin network
    const rpc = bitcoin.network.rpc;

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
    let block = await bitcoin.network.rpc!.getBlock({ height }) as BlockV3;

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

          // Look for 'OP_RETURN' in the scriptPubKey asm
          const txVoutScriptPubkeyAsm = prevout.vout[vin.vout].scriptPubKey.asm;
          if(!txVoutScriptPubkeyAsm.includes('OP_RETURN')) {
            continue;
          }

          // Log the found txid and beacon
          console.info(`Tx ${tx.txid} contains beacon service address ${scriptPubKey.address} and OP_RETURN!`, tx);

          // Extract hex string hash of the signal bytes from the scriptpubkey
          const updateHash = txVoutScriptPubkeyAsm.split(' ').slice(-1)[0];
          if(!updateHash) {
            continue;
          }

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
