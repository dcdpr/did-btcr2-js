import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hexToBytes } from '@noble/hashes/utils';
import { opcodes, Psbt, script } from 'bitcoinjs-lib';
import type { BeaconProcessResult } from '../resolver.js';
import type { SidecarData } from '../types.js';
import { BeaconError } from './error.js';
import { StaticFeeEstimator } from './fee-estimator.js';
import type { FeeEstimator } from './fee-estimator.js';
import type { BeaconService, BeaconSignal } from './interfaces.js';

/** Default fee estimator used when none is supplied. ~5 sat/vB static rate. */
const DEFAULT_FEE_ESTIMATOR: FeeEstimator = new StaticFeeEstimator(5);

/**
 * Options accepted by {@link Beacon.buildSignAndBroadcast}.
 */
export interface BroadcastOptions {
  /** Fee estimator for computing the transaction fee. Defaults to {@link DEFAULT_FEE_ESTIMATOR}. */
  feeEstimator?: FeeEstimator;
}

/**
 * Abstract base class for all BTCR2 Beacon types.
 * A Beacon is a service listed in a BTCR2 DID document that informs resolvers
 * how to find authentic updates to the DID.
 *
 * Beacons are lightweight typed wrappers around a {@link BeaconService} configuration.
 * Dependencies (signals, sidecar data, bitcoin connection) are passed as method
 * parameters rather than held as instance state.
 *
 * Use {@link BeaconFactory.establish} to create typed instances from service config.
 *
 * @abstract
 * @class Beacon
 * @type {Beacon}
 */
export abstract class Beacon {
  /**
   * The Beacon service configuration parsed from the DID Document.
   */
  readonly service: BeaconService;

  constructor(service: BeaconService) {
    this.service = service;
  }

  /**
   * Processes an array of Beacon Signals to extract BTCR2 Signed Updates.
   * Used during the resolve path.
   *
   * Returns successfully resolved updates and any data needs that must be
   * satisfied before remaining signals can be processed.
   *
   * @param {Array<BeaconSignal>} signals The beacon signals discovered on-chain.
   * @param {SidecarData} sidecar The processed sidecar data containing update/CAS/SMT maps.
   * @returns {BeaconProcessResult} The updates and any data needs.
   */
  abstract processSignals(
    signals: Array<BeaconSignal>,
    sidecar: SidecarData,
  ): BeaconProcessResult;

  /**
   * Broadcasts a signed update as a Beacon Signal to the Bitcoin network.
   * Used during the update path.
   * @param {SignedBTCR2Update} signedUpdate The signed BTCR2 update to broadcast.
   * @param {KeyBytes} secretKey The secret key for signing the Bitcoin transaction.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {BroadcastOptions} [options] Optional broadcast configuration (e.g. fee estimator).
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   */
  abstract broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<SignedBTCR2Update>;

  /**
   * Shared PSBT construction + signing + broadcast helper used by all beacon types.
   *
   * Steps:
   * 1. Parse the beacon's `serviceEndpoint` (stripping `bitcoin:` prefix) into a Bitcoin address.
   * 2. Query the address for unconfirmed/confirmed UTXOs.
   * 3. Select the most recent confirmed UTXO.
   * 4. Fetch the previous transaction hex for `nonWitnessUtxo`.
   * 5. Build a PSBT: input (UTXO) → change output + OP_RETURN(signalBytes).
   * 6. Compute the fee via the supplied (or default) {@link FeeEstimator} against the tx vsize.
   * 7. Sign input 0 with an ECDSA signer derived from `secretKey`.
   * 8. Finalize, extract, and broadcast via the REST transaction endpoint.
   *
   * Fee handling: the PSBT is constructed with a placeholder change amount, signed to measure
   * vsize, then the change is adjusted to pay the actual fee and the input re-signed. This
   * two-pass approach avoids hardcoded fee constants and produces a tx that matches the
   * estimator's rate.
   *
   * @param signalBytes 32-byte payload to embed in OP_RETURN.
   * @param secretKey Secret key used to sign the spending input.
   * @param bitcoin Bitcoin network connection.
   * @param options Broadcast options (fee estimator, etc.).
   * @returns The txid of the broadcast transaction.
   * @throws {BeaconError} if the address is unfunded or no UTXO is available.
   */
  protected async buildSignAndBroadcast(
    signalBytes: Uint8Array,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<string> {
    const feeEstimator = options?.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;

    // Strip the 'bitcoin:' prefix from the service endpoint.
    const bitcoinAddress = this.service.serviceEndpoint.replace('bitcoin:', '');

    // Fetch UTXOs at the beacon address.
    const utxos = await bitcoin.rest.address.getUtxos(bitcoinAddress);
    if(!utxos.length) {
      throw new BeaconError(
        'No UTXOs found, please fund address!',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // Take the most recently confirmed UTXO.
    const utxo: AddressUtxo | undefined = utxos.sort(
      (a, b) => b.status.block_height - a.status.block_height
    ).shift();
    if(!utxo) {
      throw new BeaconError(
        'Beacon bitcoin address unfunded or utxos unconfirmed.',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
      );
    }

    // Get the previous tx hex for non-witness UTXO reference.
    const prevTx = await bitcoin.rest.transaction.getHex(utxo.txid);

    // Build the ECDSA signer from the secret key.
    const keyPair = SchnorrKeyPair.fromSecret(secretKey);
    const signer = {
      publicKey : keyPair.publicKey.compressed,
      sign      : (hash: Uint8Array) => keyPair.secretKey.sign(hash, { scheme: 'ecdsa' }),
    };

    // First pass: build with a placeholder fee (0 sats) so we can measure vsize.
    const build = (fee: bigint) =>
      new Psbt({ network: bitcoin.data })
        .addInput({
          hash           : utxo.txid,
          index          : utxo.vout,
          nonWitnessUtxo : hexToBytes(prevTx),
        })
        .addOutput({ address: bitcoinAddress, value: BigInt(utxo.value) - fee })
        .addOutput({ script: script.compile([opcodes.OP_RETURN, signalBytes]), value: 0n });

    const probeTx = build(0n)
      .signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction();
    const vsize = probeTx.virtualSize();

    // Second pass: use the estimator to compute the real fee.
    const fee = await feeEstimator.estimateFee(vsize);
    if(BigInt(utxo.value) <= fee) {
      throw new BeaconError(
        `UTXO value (${utxo.value}) insufficient to cover fee (${fee}).`,
        'INSUFFICIENT_FUNDS', { bitcoinAddress, utxoValue: utxo.value, fee: fee.toString() }
      );
    }

    const signedTxHex = build(fee)
      .signInput(0, signer)
      .finalizeAllInputs()
      .extractTransaction()
      .toHex();

    return bitcoin.rest.transaction.send(signedTxHex);
  }
}