import type { AddressUtxo, BitcoinConnection, BTCNetwork } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { getPublicKey } from '@noble/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';
import { OP, p2tr, p2wpkh, Script, Transaction } from '@scure/btc-signer';
import type { BeaconProcessResult } from '../resolver.js';
import type { SidecarData } from '../types.js';
import { BeaconError } from './error.js';
import { StaticFeeEstimator } from './fee-estimator.js';
import type { FeeEstimator } from './fee-estimator.js';
import type { BeaconService, BeaconSignal } from './interfaces.js';

/** Default fee estimator used when none is supplied. ~5 sat/vB static rate. */
const DEFAULT_FEE_ESTIMATOR: FeeEstimator = new StaticFeeEstimator(5);

/**
 * Conservative vsize estimate for a 1-input P2TR key-path → 1 P2TR change + 1 OP_RETURN(32) tx.
 * Taproot key-path witness is a fixed 64-byte Schnorr signature, so vsize is predictable
 * without having to sign. Used for fee estimation in the aggregation path where MuSig2
 * signatures are produced externally.
 */
const P2TR_BEACON_TX_VSIZE = 140;

/**
 * Options accepted by {@link Beacon.buildSignAndBroadcast} and related helpers.
 */
export interface BroadcastOptions {
  /** Fee estimator for computing the transaction fee. Defaults to {@link DEFAULT_FEE_ESTIMATOR}. */
  feeEstimator?: FeeEstimator;
}

/**
 * Unsigned beacon transaction + the prev-output metadata needed for downstream
 * signing (single-party ECDSA or multi-party MuSig2 Taproot).
 */
export interface BeaconTxPlan {
  /** The unsigned scure @scure/btc-signer Transaction. */
  tx: Transaction;
  /** Scripts of the consumed previous outputs (needed for Taproot sighash). */
  prevOutScripts: Uint8Array[];
  /** Amounts (sats) of the consumed previous outputs. */
  prevOutValues: bigint[];
  /** Address change was sent back to (same as the beacon address). */
  beaconAddress: string;
  /** The UTXO this tx consumes. */
  utxo: AddressUtxo;
  /** The fee (sats) already deducted from the change output. */
  feeSats: bigint;
}

/**
 * Build an OP_RETURN script carrying a 32-byte beacon signal.
 * Exported as a utility so callers building txs outside Beacon (e.g., the aggregation
 * `onProvideTxData` callback) can produce identical output.
 */
export function opReturnScript(signalBytes: Uint8Array): Uint8Array {
  return Script.encode([OP.RETURN, signalBytes]);
}

/**
 * Fetch the most recent confirmed UTXO at `bitcoinAddress` + the raw bytes of its
 * parent transaction (needed by PSBT inputs). Throws if unfunded.
 */
async function fetchSpendableUtxo(
  bitcoinAddress: string,
  bitcoin: BitcoinConnection,
): Promise<{ utxo: AddressUtxo; prevTxBytes: Uint8Array }> {
  const utxos = await bitcoin.rest.address.getUtxos(bitcoinAddress);
  if(!utxos.length) {
    throw new BeaconError(
      'No UTXOs found, please fund address!',
      'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
    );
  }
  const utxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height).shift();
  if(!utxo) {
    throw new BeaconError(
      'Beacon bitcoin address unfunded or utxos unconfirmed.',
      'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress }
    );
  }
  const prevTxHex = await bitcoin.rest.transaction.getHex(utxo.txid);
  return { utxo, prevTxBytes: hexToBytes(prevTxHex) };
}

/**
 * Build an aggregation beacon transaction (P2TR key-path spend) ready for MuSig2 signing.
 * Returns the unsigned Transaction + prev-output metadata that an aggregation service's
 * signing session consumes (via {@link SigningTxData}).
 *
 * This is the reusable counterpart to {@link Beacon.buildSignAndBroadcast}'s internal
 * construction step — the aggregation path must produce an unsigned tx because the
 * signature comes from a MuSig2 round, not a local secret key.
 *
 * @param opts Parameters including the cohort's aggregate internal pubkey.
 * @returns A {@link BeaconTxPlan} with the unsigned tx and sighash inputs.
 */
export async function buildAggregationBeaconTx(opts: {
  /** The beacon (cohort) address where UTXOs live and change returns to. */
  beaconAddress: string;
  /** The cohort's MuSig2-aggregated x-only internal pubkey (32 bytes). */
  internalPubkey: Uint8Array;
  /** 32-byte beacon signal embedded in the OP_RETURN output. */
  signalBytes: Uint8Array;
  /** Bitcoin REST connection for UTXO / prev-tx lookup. */
  bitcoin: BitcoinConnection;
  /** Network params used to derive the P2TR witnessUtxo script. */
  network: BTCNetwork;
  /** Optional fee estimator (defaults to 5 sat/vB). */
  feeEstimator?: FeeEstimator;
}): Promise<BeaconTxPlan> {
  const feeEstimator = opts.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;
  const { utxo, prevTxBytes } = await fetchSpendableUtxo(opts.beaconAddress, opts.bitcoin);

  const tapOut = p2tr(opts.internalPubkey, undefined, opts.network);
  const witnessScript = tapOut.script;

  // Fee cannot be probe-measured (no secret key for MuSig2 round). Use fixed P2TR vsize.
  const feeSats = await feeEstimator.estimateFee(P2TR_BEACON_TX_VSIZE);
  if(BigInt(utxo.value) <= feeSats) {
    throw new BeaconError(
      `UTXO value (${utxo.value}) insufficient to cover fee (${feeSats}).`,
      'INSUFFICIENT_FUNDS',
      { bitcoinAddress: opts.beaconAddress, utxoValue: utxo.value, fee: feeSats.toString() }
    );
  }

  const tx = new Transaction();
  tx.addInput({
    txid           : utxo.txid,
    index          : utxo.vout,
    nonWitnessUtxo : prevTxBytes,
    witnessUtxo    : { amount: BigInt(utxo.value), script: witnessScript },
    tapInternalKey : opts.internalPubkey,
  });
  tx.addOutputAddress(opts.beaconAddress, BigInt(utxo.value) - feeSats, opts.network);
  tx.addOutput({ script: opReturnScript(opts.signalBytes), amount: 0n });

  return {
    tx,
    prevOutScripts : [witnessScript],
    prevOutValues  : [BigInt(utxo.value)],
    beaconAddress  : opts.beaconAddress,
    utxo,
    feeSats,
  };
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
   * Build + sign + broadcast a single-party beacon signal transaction (P2WPKH spend).
   *
   * Composed from the three extracted phases ({@link buildSinglePartyTx},
   * {@link signSinglePartyTx}, {@link broadcastRawTx}) so each piece can be exercised
   * in isolation. Aggregation beacons use {@link buildAggregationBeaconTx} instead —
   * the multi-party path can't share the signing phase, but the tx-construction
   * plumbing (UTXO fetch + OP_RETURN output + change output) is shared.
   *
   * @param signalBytes 32-byte payload to embed in OP_RETURN.
   * @param secretKey Secret key used to sign the spending input.
   * @param bitcoin Bitcoin network connection.
   * @param options Broadcast options (fee estimator, etc.).
   * @returns The txid of the broadcast transaction.
   * @throws {BeaconError} if the address is unfunded, no UTXO is available, or fee exceeds value.
   */
  protected async buildSignAndBroadcast(
    signalBytes: Uint8Array,
    secretKey: KeyBytes,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<string> {
    const feeEstimator = options?.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;
    const beaconAddress = this.service.serviceEndpoint.replace('bitcoin:', '');
    const { utxo, prevTxBytes } = await fetchSpendableUtxo(beaconAddress, bitcoin);
    const plan = await this.buildSinglePartyTx({
      signalBytes, beaconAddress, utxo, prevTxBytes, secretKey, bitcoin, feeEstimator,
    });
    const signedHex = this.signSinglePartyTx(plan.tx, secretKey);
    return this.broadcastRawTx(bitcoin, signedHex);
  }

  /**
   * Build an unsigned P2WPKH single-party beacon tx + probe-sign to determine vsize,
   * then rebuild with the real fee. Returns the tx and prev-output metadata.
   *
   * The secret key is required here (not just in `signSinglePartyTx`) because the
   * two-pass fee estimation requires an actual signature to measure vsize accurately.
   */
  protected async buildSinglePartyTx(opts: {
    signalBytes: Uint8Array;
    beaconAddress: string;
    utxo: AddressUtxo;
    prevTxBytes: Uint8Array;
    secretKey: KeyBytes;
    bitcoin: BitcoinConnection;
    feeEstimator: FeeEstimator;
  }): Promise<BeaconTxPlan> {
    const pubkey = this.#derivePubkey(opts.secretKey);
    const witnessOut = p2wpkh(pubkey, opts.bitcoin.data);
    const witnessScript = witnessOut.script;

    const build = (feeSats: bigint): Transaction => {
      const tx = new Transaction();
      tx.addInput({
        txid           : opts.utxo.txid,
        index          : opts.utxo.vout,
        nonWitnessUtxo : opts.prevTxBytes,
        witnessUtxo    : { amount: BigInt(opts.utxo.value), script: witnessScript },
      });
      tx.addOutputAddress(
        opts.beaconAddress,
        BigInt(opts.utxo.value) - feeSats,
        opts.bitcoin.data,
      );
      tx.addOutput({ script: opReturnScript(opts.signalBytes), amount: 0n });
      return tx;
    };

    // First pass: sign with zero fee to measure vsize.
    const probe = build(0n);
    probe.signIdx(opts.secretKey, 0);
    probe.finalize();
    const vsize = probe.vsize;

    const feeSats = await opts.feeEstimator.estimateFee(vsize);
    if(BigInt(opts.utxo.value) <= feeSats) {
      throw new BeaconError(
        `UTXO value (${opts.utxo.value}) insufficient to cover fee (${feeSats}).`,
        'INSUFFICIENT_FUNDS',
        { bitcoinAddress: opts.beaconAddress, utxoValue: opts.utxo.value, fee: feeSats.toString() }
      );
    }

    // Second pass: real fee.
    const tx = build(feeSats);
    return {
      tx,
      prevOutScripts : [witnessScript],
      prevOutValues  : [BigInt(opts.utxo.value)],
      beaconAddress  : opts.beaconAddress,
      utxo           : opts.utxo,
      feeSats,
    };
  }

  /**
   * Sign + finalize the unsigned single-party tx and return its raw hex.
   */
  protected signSinglePartyTx(tx: Transaction, secretKey: KeyBytes): string {
    tx.signIdx(secretKey, 0);
    tx.finalize();
    return tx.hex;
  }

  /**
   * Broadcast raw transaction hex via the Bitcoin REST endpoint. Returns the txid.
   */
  protected async broadcastRawTx(bitcoin: BitcoinConnection, rawHex: string): Promise<string> {
    return bitcoin.rest.transaction.send(rawHex);
  }

  /** Derive the compressed secp256k1 public key from a raw secret key. */
  #derivePubkey(secretKey: KeyBytes): Uint8Array {
    return getPublicKey(secretKey, true);
  }
}
