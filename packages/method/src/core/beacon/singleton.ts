import { AddressUtxo, BitcoinNetworkConnection, RawTransactionRest, RawTransactionV2, TxOut, Vout } from '@did-btcr2/bitcoin';
import { DidUpdatePayload, INVALID_SIDECAR_DATA, LATE_PUBLISHING_ERROR, SingletonBeaconError } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';
import { Kms, Signer } from '@did-btcr2/kms';
import { opcodes, Psbt, script } from 'bitcoinjs-lib';
import { base58btc } from 'multiformats/bases/base58';
import { Beacon } from '../../interfaces/beacon.js';
import { BeaconService, BeaconSignal } from '../../interfaces/ibeacon.js';
import { BeaconSidecarData, Metadata, SignalsMetadata, SingletonSidecar } from '../../types/crud.js';
import { Appendix } from '../../utils/appendix.js';
import { Identifier } from '../../utils/identifier.js';

const bitcoin = new BitcoinNetworkConnection();

/**
 * Implements {@link https://dcdpr.github.io/did-btcr2/#singleton-beacon | 5.1 Singleton Beacon}.
 *
 * A Singleton Beacon enables a single entity to independently post a DID Update Payload in a Beacon Signal. Its is a
 * Beacon that can be used to publish a single DID Update Payload targeting a single DID document. The serviceEndpoint
 * for this Beacon Type is a Bitcoin address represented as a URI following the BIP21 scheme. It is recommended that
 * this Bitcoin address be under the sole control of the DID controller. How the Bitcoin address and the cryptographic
 * material that controls it are generated is left to the implementation.
 *
 * @class SingletonBeacon
 * @type {SingletonBeacon}
 * @extends {Beacon}
 */
export class SingletonBeacon extends Beacon {

  /**
   * Creates an instance of SingletonBeacon.
   * @param {BeaconService} service The Beacon service.
   * @param {?BeaconSidecarData} [sidecar] Optional sidecar data.
   */
  constructor(service: BeaconService, sidecar?: BeaconSidecarData<SingletonSidecar>) {
    super({ ...service, type: 'SingletonBeacon' }, sidecar);
  }

  /**
   * Get the Beacon service.
   * @readonly
   * @type {BeaconService} The Beacon service.
   */
  get service(): BeaconService {
    return {
      type            : this.type,
      id              : this.id,
      serviceEndpoint : this.serviceEndpoint
    };
  }

  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#establish-singleton-beacon | 5.1.1 Establish Singleton Beacon}.
   *
   * Static, convenience method for establishing a Beacon object.
   *
   * A Singleton Beacon is a Beacon that can be used to publish a single DID Update Payload targeting a single DID
   * document. The serviceEndpoint for this Beacon Type is a Bitcoin address represented as a URI following the BIP21
   * scheme. It is RECOMMENDED that this Bitcoin address be under the sole control of the DID controller. How the
   * Bitcoin address and the cryptographic material that controls it are generated is left to the implementation.
   * The Establish Singleton Beacon algorithm takes in a Bitcoin address and a serviceId and returns a Singleton Beacon service.
   * It returns a SignletonBeacon object with the given id, type, and serviceEndpoint.
   *
   * @param {string} service The Beacon service.
   * @param {BeaconSidecarData<SingletonSidecar>} sidecar The sidecar data.
   * @returns {SingletonBeacon} The Singleton Beacon.
   */
  public static establish(service: BeaconService, sidecar: BeaconSidecarData<SingletonSidecar>): SingletonBeacon {
    return new SingletonBeacon(service, sidecar);
  }

  /**
   * TODO: Figure out if this is necessary or not.
   * @param {string} didUpdatePayload The DID Update Payload to generate the signal for.
   * @returns {BeaconSignal} The generated signal.
   * @throws {MethodError} if the signal is invalid.
   */
  public generateSignal(didUpdatePayload: string): BeaconSignal {
    throw new Error('Method not implemented.' + didUpdatePayload);
  }

  /**
   * TODO: Finish implementation per spec
   *
   * Implements {@link https://dcdpr.github.io/did-btcr2/#process-singleton-beacon-signal | 5.1.3 Process Singleton Beacon Signal}.
   * See {@link Beacon.processSignal | Abstract Beacon Interface Method processSignal} for more details.
   *
   * The Process Singleton Beacon Signal algorithm is called by the Process Beacon Signals algorithm as part of the Read
   * operation. It takes a Bitcoin transaction representing a Beacon Signal and optional signalSidecarData containing
   * any sidecar data provided to the resolver for the Beacon Signal identified by the Bitcoin transaction identifier.
   * It returns the DID Update payload announced by the Beacon Signal or throws an error.
   *
   * @param {RawTransactionV2} signal Bitcoin transaction representing a Beacon Signal.
   * @param {SignalsMetadata} signalsMetadata: SignalsMetadata Optional sidecar data for the Beacon Signal.
   * @returns {Promise<DidUpdatePayload | undefined>} The DID Update payload announced by the Beacon Signal.
   * @throws {DidError} if the signalTx is invalid or the signalSidecarData is invalid.
   */
  public async processSignal(signal: RawTransactionV2 | RawTransactionRest, signalsMetadata: SignalsMetadata): Promise<DidUpdatePayload | undefined> {
    // 1. Initialize a txOut variable to the 0th transaction output of the tx.
    const output = signal.vout.filter((vout) => ((vout as Vout)['scriptpubkey_asm'] as string || (vout as TxOut)['scriptPubKey'].asm as string).includes('OP_RETURN'))?.[0];
    if(!output) {
      throw new SingletonBeaconError('No OP_RETURN output found in transaction outputs.', 'NO_OP_RETURN', { signal });
    }
    const outputMap = new Map(Object.entries(output));

    // 2. Set didUpdatePayload to null.
    let didUpdatePayload: DidUpdatePayload | undefined = undefined;

    // 3. Check txout is of the format [OP_RETURN, OP_PUSH32, <32bytes>], if not, then return didUpdatePayload.
    //    The Bitcoin transaction is not a Beacon Signal.
    const UPDATE_PAYLOAD_HASH = (outputMap.get('scriptpubkey_asm') ?? outputMap.get('scriptPubKey').asm).split(' ').last() as string;
    if(!UPDATE_PAYLOAD_HASH) {
      return undefined;
    }
    // 4. Set hashBytes to the 32 bytes in the txout.
    const hashBytes = JSON.canonicalization.encode(Buffer.fromHex(UPDATE_PAYLOAD_HASH), 'base58');

    // Convert signalsMetadata to a Map for easier access
    const signalsMetadataMap = new Map<string, Metadata>(Object.entries(signalsMetadata));

    // 5. If signalsMetadata:
    if (signalsMetadata) {
      // 5.1 Set didUpdatePayload to signalsMetadata.updatePayload
      didUpdatePayload = signalsMetadataMap.get(signal.txid)?.didUpdate;

      if(!didUpdatePayload) {
        throw new SingletonBeaconError('Update Payload not found in signal metadata.', 'PROCESS_SIGNAL_ERROR');
      }

      // 5.2 Set updateHashBytes to the result of passing didUpdatePayload to the JSON Canonicalization and Hash algorithm.
      const updateHashBytes = await JSON.canonicalization.process(didUpdatePayload, 'base58');

      // 5.3 If updateHashBytes does not equal hashBytes, MUST throw an invalidSidecarData error.
      if (updateHashBytes !== hashBytes) {
        throw new SingletonBeaconError(
          `Hash mismatch: updateHashBytes ${updateHashBytes} !== hashBytes ${hashBytes}.`,
          INVALID_SIDECAR_DATA,
          { UPDATE_PAYLOAD_HASH, didUpdatePayload }
        );
      }
      // 7. Return didUpdatePayload.
      return didUpdatePayload;
    }

    // 6. Else:
    //  6.1 Set didUpdatePayload to the result of passing hashBytes into the Fetch Content from Addressable Storage algorithm.
    const didUpdatePayloadString = await Appendix.fetchFromCas(base58btc.decode(hashBytes));
    if(!didUpdatePayloadString || !JSON.parse(didUpdatePayloadString)) {
      throw new SingletonBeaconError('Update payload not found in addressable storage.', INVALID_SIDECAR_DATA);
    }
    didUpdatePayload = JSON.parse(didUpdatePayloadString) as DidUpdatePayload;

    //  6.2 If didUpdatePayload is null, MUST raise a latePublishingError. MAY identify Beacon Signal to resolver and request additional Sidecar data be provided.
    if (!didUpdatePayload) {
      throw new SingletonBeaconError('Update payload hash does not match transaction hash.', LATE_PUBLISHING_ERROR);
    }

    // 7. Return didUpdatePayload.
    return didUpdatePayload;
  }


  /**
   * Implements {@link https://dcdpr.github.io/did-btcr2/#broadcast-singleton-beacon-signal | 5.1.2 Broadcast Singleton Beacon Signal}.
   *
   * The Broadcast Singleton Beacon Signal algorithm is called by the Announce DID Update algorithm as part of the
   * Update operation, if the Beacon being used is of the type SingletonBeacon. It takes as input a Beacon service and a
   * secured didUpdatePayload. The algorithm constructs a Bitcoin transaction that spends from the Beacon address
   * identified in the service and contains a transaction output of the format [OP_RETURN, OP_PUSH32, <hashBytes>],
   * where hashBytes is the SHA256 hash of the canonical didUpdatePayload. The Bitcoin transaction is then signed and
   * broadcast to the Bitcoin network, thereby publicly announcing a DID update in a Beacon Signal. It returns a
   * signalMetadata object mapping the Bitcoin transaction identifier of the Beacon Signal to the necessary data needed
   * to verify the signal announces a specific DID Update Payload.
   *
   * TODO: Design and implement a way to construct, sign and send via RPC
   *
   * @param {DidUpdatePayload} didUpdatePayload The verificationMethod object to be used for signing.
   * @returns {SignedRawTx} Successful output of a bitcoin transaction.
   * @throws {SingletonBeaconError} if the bitcoin address is invalid or unfunded.
   */
  public async broadcastSignal(didUpdatePayload: DidUpdatePayload): Promise<SignalsMetadata> {
    // 1. Initialize an addressURI variable to beacon.serviceEndpoint.
    // 2. Set bitcoinAddress to the decoding of addressURI following BIP21.
    const bitcoinAddress = this.service.serviceEndpoint.replace('bitcoin:', '');

    // 3. Ensure bitcoinAddress is funded, if not, fund this address.
    // let inputs: Array<CreateRawTxInputs> = [];

    const utxos = await bitcoin.network.rest.address.getUtxos(bitcoinAddress);
    if(!utxos.length) {
      // TODO: Discuss what to do here because sending to a beacon address does not allow you to spend from it immediately.
      throw new SingletonBeaconError('No UTXOs found, please fund address!', 'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress });
    }

    const utxo: AddressUtxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height)[0];
    if(!utxo) {
      throw new SingletonBeaconError(
        'Beacon bitcoin address unfunded or utxos unconfirmed.',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress });
    }

    // 4. Set hashBytes to the result of passing didUpdatePayload to the JSON Canonicalization and Hash algorithm.
    const hashBytes = Buffer.fromHex(await JSON.canonicalization.process(didUpdatePayload));
    if (hashBytes.length !== 32) throw new SingletonBeaconError('Hash must be 32 bytes');

    // 5. Initialize spendTx to a Bitcoin transaction that spends a transaction controlled by the bitcoinAddress and
    //    contains at least one transaction output. This output MUST have the following format
    //    [OP_RETURN, OP_PUSH32, hashBytes]
    const {txid, vout} = utxo;
    const prevTx = await bitcoin.network.rest.transaction.getHex(txid);
    const input = {
      hash           : txid,
      index          : vout,
      nonWitnessUtxo : Buffer.fromHex(prevTx)
    };
    // TODO: Figure out a good way to estimate fees
    const spendTx  = new Psbt({ network: bitcoin.network.data })
      .addInput(input)
      .addOutput({ address: bitcoinAddress, value: BigInt(utxo.value) - BigInt(500) })
      .addOutput({ script: script.compile([opcodes.OP_RETURN, hashBytes]), value: 0n });

    // 6. Retrieve the cryptographic material, e.g private key or signing capability, associated with the bitcoinAddress
    //    or service. How this is done is left to the implementer.
    const components = Identifier.decode(this.service.id);
    const keyUri = new CompressedSecp256k1PublicKey(components.genesisBytes).hex;
    const keyPair = await Kms.getKey(keyUri as string);
    if (!keyPair) {
      throw new Error('Key pair not found.');
    }

    const signer = new Signer({ keyPair, network: bitcoin.network.name });

    // 7. Sign the spendTx.
    const signedTx = spendTx.signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();
    if(!spendTx) {
      throw new SingletonBeaconError('Failed to sign raw transaction.', 'RAW_TX_SIGN_FAILED', { spendTx });
    }

    // 8. Broadcast spendTx to the Bitcoin network.
    const spentTx = await bitcoin.network.rest.transaction.send(signedTx);
    if(!spentTx) {
      throw new SingletonBeaconError('Failed to send raw transaction.', 'SEND_FAILED', { spentTx });
    }

    // 9. Set signalId to the Bitcoin transaction identifier of spendTx.
    // 10. Initialize signalMetadata to an empty object.
    // 11. Set signalMetadata.updatePayload to didUpdatePayload.
    // 12. Return the object {<signalId>: { updatePayload: DidUpdatePayload; proofs?: any; }}.
    return { [spentTx]: { didUpdate: didUpdatePayload } };
  }
}