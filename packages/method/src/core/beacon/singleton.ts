import { AddressUtxo, BitcoinNetworkConnection } from '@did-btcr2/bitcoin';
import { HexString, INVALID_SIDECAR_DATA, MethodError, MISSING_UPDATE_DATA, SingletonBeaconError } from '@did-btcr2/common';
import { BTCR2SignedUpdate } from '@did-btcr2/cryptosuite';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { Kms, Signer } from '@did-btcr2/kms';
import { opcodes, Psbt, script } from 'bitcoinjs-lib';
import { base58btc } from 'multiformats/bases/base58';
import { canonicalization } from '../../did-btcr2.js';
import { Identifier } from '../identifier.js';
import { SidecarData } from '../types.js';
import { AggregateBeacon, BeaconService, BeaconSignal, BlockMetadata } from './interfaces.js';

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/terminology.html#singleton-beacon | Singleton Beacon}.
 *
 * @class SingletonBeacon
 * @type {SingletonBeacon}
 * @extends {AggregateBeacon}
 */
export class SingletonBeacon extends AggregateBeacon {

  /**
   * Creates an instance of SingletonBeacon.
   * @param {BeaconService} service The Beacon service.
   * @param {?BeaconSidecarData} sidecar The SingletonBeacon sidecar data.
   */
  constructor(
    service: BeaconService,
    signals: Array<BeaconSignal>,
    sidecar: SidecarData,
    bitcoin?: BitcoinNetworkConnection
  ) {
    super({ ...service, type: 'SingletonBeacon' }, signals, sidecar, bitcoin);
  }

  /**
   * Static, convenience method for establishing a CASBeacon object.
   * @param {string} service The Beacon service.
   * @param {SidecarData} sidecar The sidecar data.
   * @returns {SingletonBeacon} The Singleton Beacon.
   */
  static establish(service: BeaconService, signals: Array<BeaconSignal>, sidecar: SidecarData): SingletonBeacon {
    return new SingletonBeacon(service, signals, sidecar);
  }

  /**
   * Generates a Beacon Signal for a Singleton Beacon Service.
   * @param {HexString} updateHash The update hash to be included in the Beacon Signal.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  generateSignal(updateHash: HexString): BeaconSignal {
    throw new MethodError('Method not implemented.', `METHOD_NOT_IMPLEMENTED`, {updateHash});
  }

  /**
   * Processes an array of Beacon Signals associated with a Singleton Beacon Service.
   * @returns {Promise<BTCR2SignedUpdate | undefined>} The DID Update payload announced by the Beacon Signal.
   * @throws {SingletonBeaconError} if the signalTx is invalid or the signalSidecarData is invalid.
   */
  async processSignals(): Promise<Array<[BTCR2SignedUpdate, BlockMetadata]>> {
    // Initialize an empty array to hold the BTCR2 signed updates
    const updates = new Array<[BTCR2SignedUpdate, BlockMetadata]>();

    // Loop through each signal in this.signals
    for(const signal of this.signals || []) {
      // Grab the beacon signal bytes hash from the signal
      const updateHash = signal.signalBytes;

      // Use the updateHash as the sidecar data lookup key to retrieve the btcr2 update
      const signedUpdate = this.sidecar.updateMap.get(updateHash);

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
   * Broadcasts a SingletonBeacon signal.
   * TODO: Design and implement a way to construct, sign and send via RPC
   *
   * @returns {SignedRawTx} Successful output of a bitcoin transaction.
   * @throws {SingletonBeaconError} if the bitcoin address is invalid or unfunded.
   */
  async broadcastSignal(updateHash: HexString): Promise<HexString> {
    // 1. Initialize an addressURI variable to beacon.serviceEndpoint.
    // 2. Set bitcoinAddress to the decoding of addressURI following BIP21.
    const bitcoinAddress = this.service.serviceEndpoint.replace('bitcoin:', '');

    // 3. Ensure bitcoinAddress is funded, if not, fund this address.
    // let inputs: Array<CreateRawTxInputs> = [];

    const utxos = await this.bitcoin.network.rest.address.getUtxos(bitcoinAddress);
    if(!utxos.length) {
      throw new SingletonBeaconError('No UTXOs found, please fund address!', 'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress });
    }

    const utxo: AddressUtxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height)[0];
    if(!utxo) {
      throw new SingletonBeaconError(
        'Beacon bitcoin address unfunded or utxos unconfirmed.',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // 4. Set hashBytes to the result of passing signedUpdate to the JSON Canonicalization and Hash algorithm.
    const udpateHashBytes = Buffer.from(updateHash, 'hex');
    if (udpateHashBytes.length !== 32) {
      throw new SingletonBeaconError('Hash must be 32 bytes');
    }

    // 5. Initialize spendTx to a Bitcoin transaction that spends a transaction controlled by the bitcoinAddress and
    //    contains at least one transaction output. This output MUST have the following format
    //    [OP_RETURN, OP_PUSH32, hashBytes]
    const {txid, vout} = utxo;
    const prevTx = await this.bitcoin.network.rest.transaction.getHex(txid);
    const input = {
      hash           : txid,
      index          : vout,
      nonWitnessUtxo : Buffer.from(prevTx, 'hex')
    };
    // TODO: Figure out a good way to estimate fees
    const spendTx  = new Psbt({ network: this.bitcoin.network.data })
      .addInput(input)
      .addOutput({ address: bitcoinAddress, value: BigInt(utxo.value) - BigInt(500) })
      .addOutput({ script: script.compile([opcodes.OP_RETURN, udpateHashBytes]), value: 0n });

    // 6. Retrieve the cryptographic material, e.g private key or signing capability, associated with the bitcoinAddress
    //    or service. How this is done is left to the implementer.
    const components = Identifier.decode(this.service.id);
    const keyUri = new CompressedSecp256k1PublicKey(components.genesisBytes).hex;
    const keyPair = Kms.getKey(keyUri as string);
    if (!keyPair) {
      throw new Error('Key pair not found.');
    }

    const signer = new Signer({ keyPair, network: this.bitcoin.network.name });

    // 7. Sign the spendTx.
    const signedTx = spendTx.signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();
    if(!spendTx) {
      throw new SingletonBeaconError('Failed to sign raw transaction.', 'RAW_TX_SIGN_FAILED', { spendTx });
    }

    // 8. Broadcast spendTx to the Bitcoin network.
    const spentTx = await this.bitcoin.network.rest.transaction.send(signedTx);
    if(!spentTx) {
      throw new SingletonBeaconError('Failed to send raw transaction.', 'SEND_FAILED', { spentTx });
    }

    // Return the signed update and the spend tx id.
    return spentTx;
  }
}