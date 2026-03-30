import { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalize, decode, encode, hash, KeyBytes } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hexToBytes } from '@noble/hashes/utils';
import { opcodes, Psbt, script } from 'bitcoinjs-lib';
import type { BeaconProcessResult, DataNeed } from '../resolver.js';
import { SidecarData } from '../types.js';
import { Beacon } from './beacon.js';
import { SingletonBeaconError } from './error.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#singleton-beacon | Singleton Beacon}.
 * @class SingletonBeacon
 * @type {SingletonBeacon}
 * @extends {Beacon}
 */
export class SingletonBeacon extends Beacon {

  /**
   * Creates an instance of SingletonBeacon.
   * @param {BeaconService} service The BeaconService object representing the funded beacon to announce the update to.
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'SingletonBeacon' });
  }

  /**
   * Processes an array of Beacon Signals associated with a Singleton Beacon Service.
   * @param {Array<BeaconSignal>} signals The beacon signals discovered on-chain.
   * @param {SidecarData} sidecar The processed sidecar data.
   * @returns {BeaconProcessResult} Successfully resolved updates and any data needs.
   */
  processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): BeaconProcessResult {
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();
    const needs = new Array<DataNeed>();

    for(const signal of signals) {
      // Decode signal bytes from hex and re-encode to base64url for sidecar lookup
      const updateHash = encode(decode(signal.signalBytes, 'hex'));

      // Look up the signed update in sidecar updateMap
      const signedUpdate = sidecar.updateMap.get(updateHash);

      if(!signedUpdate) {
        // Data not available — emit a need instead of throwing
        needs.push({
          kind             : 'NeedSignedUpdate',
          updateHash,
          beaconServiceId  : this.service.id
        });
        continue;
      }

      updates.push([signedUpdate, signal.blockMetadata]);
    }

    return { updates, needs };
  }
  /**
   * Broadcasts a SingletonBeacon signal to the Bitcoin network.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   * @throws {SingletonBeaconError} if the bitcoin address is invalid or unfunded.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection
  ): Promise<SignedBTCR2Update> {
    // Convert the serviceEndpoint to a bitcoin address by removing the 'bitcoin:' prefix
    const bitcoinAddress = this.service.serviceEndpoint.replace('bitcoin:', '');

    // Query the Bitcoin network for UTXOs associated with the bitcoinAddress
    const utxos = await bitcoin.rest.address.getUtxos(bitcoinAddress);

    // If no utxos are found, throw an error indicating the address is unfunded.
    if(!utxos.length) {
      throw new SingletonBeaconError(
        'No UTXOs found, please fund address!',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // Sort utxos by block height and take the most recent one
    const utxo: AddressUtxo | undefined = utxos.sort(
      (a, b) => b.status.block_height - a.status.block_height
    ).shift();

    // If no utxos are found, throw an error.
    if(!utxo) {
      throw new SingletonBeaconError(
        'Beacon bitcoin address unfunded or utxos unconfirmed.',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // Get the previous tx to the utxo being spent
    const prevTx = await bitcoin.rest.transaction.getHex(utxo.txid);

    // Canonicalize and hash the signed update for OP_RETURN output
    const updateHash = hash(canonicalize(signedUpdate));

    // Construct a spend transaction
    const spendTx = new Psbt({ network: bitcoin.data })
      // Spend tx contains the utxo as its input
      .addInput({
        hash           : utxo.txid,
        index          : utxo.vout,
        nonWitnessUtxo : hexToBytes(prevTx)
      })
      // Add a change output minus a fee of 500 sats
      // TODO: calculate fee based on transaction vsize and current fee rates
      .addOutput({ address: bitcoinAddress, value: BigInt(utxo.value) - BigInt(500) })
      // Add an OP_RETURN output containing the update hash
      .addOutput({ script: script.compile([opcodes.OP_RETURN, updateHash]), value: 0n });

    // Construct a key pair and PSBT signer from the secret key
    const keyPair = SchnorrKeyPair.fromSecret(secretKey);
    const signer = {
      publicKey : keyPair.publicKey.compressed,
      sign      : (hash: Uint8Array) => keyPair.secretKey.sign(hash, { scheme: 'ecdsa' }),
    };

    // Sign 0th input, finalize extract to hex in prep for broadcast
    const signedTx = spendTx.signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();

    // Broadcast spendTx to the Bitcoin network.
    const txid = await bitcoin.rest.transaction.send(signedTx);

    // Log the txid of the broadcasted transaction
    console.info(`Singleton Beacon Signal Broadcasted with txid: ${txid}`);

    // Return the signed update
    return signedUpdate;
  }
}