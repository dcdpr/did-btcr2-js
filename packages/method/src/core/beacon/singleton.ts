import { AddressUtxo, BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { INVALID_SIDECAR_DATA, KeyBytes, MISSING_UPDATE_DATA } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { Signer } from '@did-btcr2/kms';
import { opcodes, Psbt, script } from 'bitcoinjs-lib';
import { base58btc } from 'multiformats/bases/base58';
import { canonicalization } from '../../did-btcr2.js';
import { SidecarData } from '../types.js';
import { Beacon } from './beacon.js';
import { SingletonBeaconError } from './error.js';
import { BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#singleton-beacon | Singleton Beacon}.
 * @class SingletonBeacon
 * @type {SingletonBeacon}
 * @extends {AggregateBeacon}
 */
export class SingletonBeacon extends Beacon {

  /**
   * Creates an instance of SingletonBeacon.
   * @param {BeaconService} service The BeaconService object representing the funded beacon to announce the update to.
   *
   */
  constructor(service: BeaconService) {
    super({ ...service, type: 'SingletonBeacon' });
  }

  /**
   * Processes an array of Beacon Signals associated with a Singleton Beacon Service.
   * @returns {Promise<SignedBTCR2Update | undefined>} The DID Update payload announced by the Beacon Signal.
   * @throws {SingletonBeaconError} if the signalTx is invalid or the signalSidecarData is invalid.
   */
  async processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData
  ): Promise<Array<[SignedBTCR2Update, BlockMetadata]>> {
    // Initialize an empty array to hold the BTCR2 signed updates
    const updates = new Array<[SignedBTCR2Update, BlockMetadata]>();

    // Loop through each signal in signals
    for(const signal of signals) {
      // Grab the beacon signal bytes hash from the signal
      const updateHash = signal.signalBytes;

      // Use the updateHash as the sidecar data lookup key to retrieve the btcr2 update
      const signedUpdate = sidecar.updateMap.get(updateHash);

      // If no btcr2 update is found in sidecar data maps, throw missingUpdateData error.
      if(!signedUpdate) {
        throw new SingletonBeaconError(
          `BTCR2 Signed Update not found for update hash ${updateHash}.`,
          MISSING_UPDATE_DATA, signal
        );
      }

      // Canonicalize, hash and encode to base58 the signed update object found in sidecar or CAS
      const encodedUpdate = canonicalization.process(signedUpdate, { encoding: 'base58' });

      // Encode the signal bytes hex string to base58
      const signalBytes = base58btc.encode(Buffer.from(updateHash, 'hex'));

      // Check for mismatch between found sidecar/cas update hash and onchain beacon signal hash
      if (encodedUpdate !== signalBytes) {
        // If mismatch, throw invalidSidecarData error.
        throw new SingletonBeaconError(
          `Hash mismatch: sidecar update ${encodedUpdate} !== signal bytes ${signalBytes}.`,
          INVALID_SIDECAR_DATA, { encodedUpdate, signalBytes }
        );
      }

      // Push signedUpdate to updates array
      updates.push([signedUpdate, signal.blockMetadata]);
    }

    // Return the array of signed updates
    return updates;
  }
  /**
   * Broadcasts a SingletonBeacon signal to the Bitcoin network.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinNetworkConnection} bitcoin The Bitcoin network connection.
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   * @throws {SingletonBeaconError} if the bitcoin address is invalid or unfunded.
   */
  async broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinNetworkConnection
  ): Promise<SignedBTCR2Update> {
    // Convert the serviceEndpoint to a bitcoin address by removing the 'bitcoin:' prefix
    const bitcoinAddress = this.service.serviceEndpoint.replace('bitcoin:', '');

    // Query the Bitcoin network for UTXOs associated with the bitcoinAddress
    const utxos = await bitcoin.network.rest.address.getUtxos(bitcoinAddress);

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
    const prevTx = await bitcoin.network.rest.transaction.getHex(utxo.txid);

    // Canonicalize and hash the signed update for OP_RETURN output
    const updateHash = canonicalization.canonicalhash(signedUpdate);

    // Construct a spend transaction
    const spendTx = new Psbt({ network: bitcoin.network.data })
      // Spend tx contains the utxo as its input
      .addInput({
        hash           : utxo.txid,
        index          : utxo.vout,
        nonWitnessUtxo : Buffer.from(prevTx, 'hex')
      })
      // Add a change output minus a fee of 500 sats
      // TODO: calculate fee based on transaction vsize and current fee rates
      .addOutput({ address: bitcoinAddress, value: BigInt(utxo.value) - BigInt(500) })
      // Add an OP_RETURN output containing the update hash
      .addOutput({ script: script.compile([opcodes.OP_RETURN, updateHash]), value: 0n });

    // Construct a Schnorr key pair from the secret key
    const keyPair = SchnorrKeyPair.fromSecret(secretKey);
    if (!keyPair) {
      throw new SingletonBeaconError('Key pair not found.', 'KEY_PAIR_NOT_FOUND', { secretKey });
    }

    // Construct a signer object from the key pair and bitcoin network
    const signer = new Signer({ keyPair, network: bitcoin.network.name });

    // Sign 0th input, finalize extract to hex in prep for broadcast
    const signedTx = spendTx.signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();

    // Broadcast spendTx to the Bitcoin network.
    const txid = await bitcoin.network.rest.transaction.send(signedTx);
    console.info(`Broadcasted Singleton Beacon signal with txid ${txid}`);

    // Return the signed update
    return signedUpdate;
  }
}