import type { AddressUtxo, BitcoinConnection, BTCNetwork, TransactionStatus } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../btcr2-update.js';
import type { Signer } from '@did-btcr2/keypair';
import { concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { Address, OutScript, p2pkh, p2tr, p2wpkh, Script, SigHash, Transaction } from '@scure/btc-signer';
import type { SMTProof } from '../interfaces.js';
import type { BeaconProcessResult } from '../resolver.js';
import type { CASAnnouncement, SidecarData } from '../types.js';
import { BeaconError } from './error.js';
import { DEFAULT_FEE_ESTIMATOR } from './fee-estimator.js';
import type { FeeEstimator } from './fee-estimator.js';
import type { BeaconService, BeaconSignal } from './interfaces.js';

/**
 * Singleton beacon script kinds. Per the did:btcr2 spec, deterministic DID documents
 * include three beacon services: P2PKH, P2WPKH, and P2TR (taproot key-path), all
 * derived from the genesis secp256k1 public key. The singleton broadcast path must
 * support signing for all three.
 */
export type SingletonScriptKind = 'p2pkh' | 'p2wpkh' | 'p2tr';

/**
 * Conservative vsize estimate for a 1-input P2TR key-path to 1 P2TR change + 1 OP_RETURN(32) tx.
 * Stripped 137 + witness ≈ 68 (marker + flag + stack-count + sig-len + 64 BIP-340 sig).
 * Weight = 137*4 + 68 = 616, vsize ≈ 154, rounded to 160 for headroom.
 */
export const P2TR_BEACON_TX_VSIZE = 160;

/**
 * Conservative vsize estimate for a 1-input P2WPKH to 1 P2WPKH change + 1 OP_RETURN(32) tx.
 * Stripped 125 + witness ≈ 110 (worst-case DER ECDSA sig 72 + sighash byte + 33 pubkey + framing).
 * vsize = ceil((125*4 + 110) / 4) ≈ 153, rounded to 155.
 */
export const P2WPKH_BEACON_TX_VSIZE = 155;

/**
 * Conservative vsize estimate for a 1-input P2PKH to 1 P2PKH change + 1 OP_RETURN(32) tx.
 * Legacy (non-segwit): scriptSig carries the full sig+pubkey (~108 bytes), no witness
 * discount. Stripped ≈ 4 nVer + 1 vin-count + (32+4+1+108+4) input + 1 vout-count +
 * 34 P2PKH-change + 43 OP_RETURN + 4 nLockTime ≈ 236 bytes. vsize = 236, rounded to 240.
 */
export const P2PKH_BEACON_TX_VSIZE = 240;

/** Per-kind vsize lookup for singleton beacon fee estimation. */
export const SINGLETON_BEACON_TX_VSIZE: Readonly<Record<SingletonScriptKind, number>> = {
  p2pkh  : P2PKH_BEACON_TX_VSIZE,
  p2wpkh : P2WPKH_BEACON_TX_VSIZE,
  p2tr   : P2TR_BEACON_TX_VSIZE,
};

/**
 * Serialized size (vbytes) of a single change output, by script kind:
 * 8 (value) + 1 (scriptPubKey length) + scriptPubKey bytes. P2PKH 25, P2WPKH 22,
 * P2TR 34. These are non-witness bytes, so each contributes its full byte count to
 * the transaction vsize. The {@link SINGLETON_BEACON_TX_VSIZE} constants bake in a
 * same-kind change output; {@link beaconTxVsize} uses these deltas to re-size the
 * fee when a caller routes change to an address of a different kind (ADR 044).
 */
export const CHANGE_OUTPUT_VBYTES: Readonly<Record<SingletonScriptKind, number>> = {
  p2pkh  : 34,
  p2wpkh : 31,
  p2tr   : 43,
};

/**
 * Dust threshold (sats) below which a change output is not worth creating, by script
 * kind (the standard Bitcoin Core dust relay thresholds at the default 3 sat/vB dust
 * rate). When the change after fees falls below this, the builders omit the change
 * output and let the remainder fall into the fee rather than emit an unspendable,
 * relay-rejected dust output (ADR 044).
 */
export const DUST_LIMIT_SATS: Readonly<Record<SingletonScriptKind, number>> = {
  p2pkh  : 546,
  p2wpkh : 294,
  p2tr   : 330,
};

/**
 * Conservative size (vbytes) of one more input of each script kind. The
 * {@link SINGLETON_BEACON_TX_VSIZE} constants include one input; each added input
 * adds this value.
 *
 * - P2PKH 149: 32 txid + 4 vout + 1 scriptSig length + 108 scriptSig (a worst-case
 *   72-byte DER signature with its sighash byte, a 33-byte pubkey, two push bytes)
 *   + 4 sequence. No witness discount.
 * - P2WPKH 69: 41 non-witness bytes (164 WU) + 109 witness bytes (stack count,
 *   the same signature and pubkey, length bytes) = 273 WU, rounded up.
 * - P2TR 58: 41 non-witness bytes (164 WU) + 66 witness bytes (stack count, length
 *   byte, 64-byte BIP-340 signature with SIGHASH_DEFAULT) = 230 WU, rounded up.
 *
 * {@link selectBeaconFunding} also uses these values for the fee of the input
 * that spends a UTXO: a UTXO at or below that fee adds nothing to a signal.
 */
export const BEACON_INPUT_VBYTES: Readonly<Record<SingletonScriptKind, number>> = {
  p2pkh  : 149,
  p2wpkh : 69,
  p2tr   : 58,
};

/**
 * Maximum number of inputs in a single-party beacon transaction. The builder
 * reads the previous transaction of each input (one REST request for each
 * input), so the limit bounds the requests and the transaction size (a P2PKH
 * transaction with 20 inputs is at most 3080 vB). If more UTXOs are eligible,
 * {@link selectBeaconFunding} spends the 20 with the largest value.
 */
export const MAX_BEACON_TX_INPUTS = 20;

/**
 * vsize (vbytes) for a beacon transaction that spends `inputs` inputs of
 * `beaconKind` and returns change to an output of `changeKind`, plus the
 * OP_RETURN(32) signal.
 *
 * When `changeKind === beaconKind` (the default, change to the beacon address) and
 * `inputs` is 1, this returns the per-kind {@link SINGLETON_BEACON_TX_VSIZE}
 * constant unchanged, so the default path and the constants' lock-in tests are
 * byte-identical. A differing `changeKind` swaps the assumed same-kind change output
 * for the actual one, keeping the result a valid upper bound. Each input after the
 * first adds {@link BEACON_INPUT_VBYTES} of `beaconKind`. The aggregation key-path
 * spend is the `beaconKind: 'p2tr'` case (its input is always the cohort's P2TR key
 * path; only the change output varies), the analytical sizing ADR 045 calls for,
 * computed without a secret.
 */
export function beaconTxVsize(
  beaconKind: SingletonScriptKind,
  changeKind: SingletonScriptKind,
  inputs: number = 1,
): number {
  const base = SINGLETON_BEACON_TX_VSIZE[beaconKind] - CHANGE_OUTPUT_VBYTES[beaconKind];
  return base + CHANGE_OUTPUT_VBYTES[changeKind] + (inputs - 1) * BEACON_INPUT_VBYTES[beaconKind];
}

/**
 * Detect the singleton script kind of a Bitcoin address (P2PKH / P2WPKH / P2TR).
 * The deterministic-DID document emits all three kinds; the broadcast path needs
 * to know which is in use to construct the input and dispatch the signing primitive.
 */
export function detectSingletonScriptKind(
  bitcoinAddress: string,
  network: BTCNetwork,
): SingletonScriptKind {
  const decoded = Address(network).decode(bitcoinAddress);
  if(decoded.type === 'pkh') return 'p2pkh';
  if(decoded.type === 'wpkh') return 'p2wpkh';
  if(decoded.type === 'tr') return 'p2tr';
  throw new BeaconError(
    `Unsupported singleton beacon address type "${decoded.type}". `
    + 'Expected P2PKH, P2WPKH, or P2TR (taproot key-path).',
    'UNSUPPORTED_BEACON_ADDRESS_TYPE',
    { address: bitcoinAddress, kind: decoded.type }
  );
}

/**
 * Derive the address that `pubkey` produces under the given script kind. Used to
 * fail-fast when a caller wires a signer to a beacon address that the signer's
 * pubkey cannot actually spend.
 */
export function deriveSingletonAddress(
  kind: SingletonScriptKind,
  pubkey: KeyBytes,
  network: BTCNetwork,
): string {
  if(kind === 'p2pkh')  return p2pkh(pubkey, network).address!;
  if(kind === 'p2wpkh') return p2wpkh(pubkey, network).address!;
  // P2TR key-path: x-only internal key (drop the SEC prefix byte).
  return p2tr(pubkey.slice(1, 33), undefined, network).address!;
}

/**
 * Resolve the change-output recipient for a beacon transaction. Returns the beacon
 * address when no change address is supplied (preserving the prior behavior of
 * returning change to the spent address), otherwise validates the caller-supplied
 * address against the network and returns it. Validating here fails fast rather than
 * burning a real UTXO on a transaction that breaks at broadcast (ADR 044).
 */
export function resolveChangeAddress(
  beaconAddress: string,
  network: BTCNetwork,
  changeAddress?: string,
): string {
  if(!changeAddress || changeAddress === beaconAddress) return beaconAddress;
  try {
    Address(network).decode(changeAddress);
  } catch {
    throw new BeaconError(
      `Invalid change address "${changeAddress}" for network "${network}".`,
      'INVALID_CHANGE_ADDRESS',
      { changeAddress, network }
    );
  }
  return changeAddress;
}

/**
 * Detect the change output's script kind for fee sizing. A change address that is not
 * one of the three singleton kinds (for example P2SH or P2WSH) is sized as P2TR, the
 * largest standard change output, so the estimated fee stays a valid upper bound.
 */
function changeOutputKind(changeAddress: string, network: BTCNetwork): SingletonScriptKind {
  try {
    return detectSingletonScriptKind(changeAddress, network);
  } catch {
    return 'p2tr';
  }
}

/**
 * Options accepted by {@link SinglePartyBeacon.buildSignAndBroadcast} and related helpers.
 */
export interface BroadcastOptions {
  /** Fee estimator for computing the transaction fee. Defaults to {@link DEFAULT_FEE_ESTIMATOR}. */
  feeEstimator?: FeeEstimator;
  /**
   * Address to send change to. Defaults to the beacon address (reuses the spent
   * address, the prior behavior). Supply a fresh address the controller owns to
   * stop linking the beacon's announcements into one on-chain chain (ADR 044).
   */
  changeAddress?: string;
}

/**
 * Result of a single-party beacon broadcast. Beyond the signed update itself,
 * it carries every artifact the broadcast produced that a resolver will later
 * need: without them, some signals are unresolvable (the SMT proof) or the
 * controller cannot distribute the sidecar data the spec requires them to
 * retain (the CAS announcement).
 */
export interface BroadcastResult {
  /** The signed update that was broadcast. */
  signedUpdate: SignedBTCR2Update;
  /** Transaction id of the on-chain beacon signal. */
  txid: string;
  /**
   * The CAS Announcement whose hash rode in the OP_RETURN output. CAS beacons
   * only. Capture it for sidecar distribution (or publish it to a CAS): a
   * resolver cannot process the signal without it.
   */
  announcement?: CASAnnouncement;
  /**
   * SMT inclusion proof for the broadcast update, including the nonce the leaf
   * was blinded with. SMT beacons only. Capture it for sidecar distribution:
   * the nonce is generated at broadcast time and appears nowhere else, so a
   * signal whose proof is dropped is permanently unresolvable.
   */
  proof?: SMTProof;
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
  /** The beacon address this tx spends from. */
  beaconAddress: string;
  /** Address the change output was sent to (the beacon address unless a change address was supplied). */
  changeAddress: string;
  /** The UTXOs this tx consumes, in input order. */
  utxos: Array<AddressUtxo>;
  /**
   * The estimated fee (sats) deducted from the change output. If the tx has no
   * change output, the remainder also goes to the fee.
   */
  feeSats: bigint;
  /**
   * Singleton beacon script kind, when applicable. Drives the signing dispatch
   * in {@link SinglePartyBeacon.signSinglePartyTx}. Aggregation plans set this to `'p2tr'`.
   */
  scriptKind: SingletonScriptKind;
}

/**
 * Build an OP_RETURN script carrying a 32-byte beacon signal.
 * Exported as a utility so callers building txs outside SinglePartyBeacon (e.g., the aggregation
 * `onProvideTxData` callback) can produce identical output.
 *
 * Uses the opcode *string* `'RETURN'` rather than the numeric `OP.RETURN`
 * constant because scure's `Script.encode` interprets a number as a byte to
 * push, not as the opcode. The string form emits the bare opcode (0x6a)
 * followed by an `OP_PUSHBYTES_32` push, producing the standard NULL_DATA
 * shape Bitcoin Core's `IsStandard` accepts. The numeric form silently
 * produces `OP_PUSHBYTES_1 0x6a OP_PUSHBYTES_32 <32 bytes>`, which is
 * non-standard and rejected at broadcast with `RPC error -26: scriptpubkey`.
 */
export function opReturnScript(signalBytes: Uint8Array): Uint8Array {
  return Script.encode(['RETURN', signalBytes]);
}

/** A UTXO whose status carries the block fields: the confirmed arm of {@link TransactionStatus}. */
type ConfirmedUtxo = AddressUtxo & { status: Extract<TransactionStatus, { confirmed: true }> };

/**
 * True if the UTXO is confirmed. Narrows the status to the confirmed arm, so the
 * block height reads as a number. An absent flag counts as unconfirmed.
 */
function isConfirmedUtxo(utxo: AddressUtxo): utxo is ConfirmedUtxo {
  return utxo.status.confirmed === true;
}

/**
 * Deterministic ordering for spendable UTXO selection: deepest first (ascending
 * block height, so the most-confirmed UTXO sorts first), tie-broken by `txid` then
 * `vout`. The tie-break makes the winner independent of the order the REST API
 * returns UTXOs in, so retries and independent resolvers converge on the same input.
 */
function byDepthThenId(a: ConfirmedUtxo, b: ConfirmedUtxo): number {
  if(a.status.block_height !== b.status.block_height) {
    return a.status.block_height - b.status.block_height;
  }
  const txidOrder = a.txid.localeCompare(b.txid);
  return txidOrder !== 0 ? txidOrder : a.vout - b.vout;
}

/** Largest value first; {@link byDepthThenId} breaks a tie. */
function byValueThenDepth(a: ConfirmedUtxo, b: ConfirmedUtxo): number {
  return b.value !== a.value ? b.value - a.value : byDepthThenId(a, b);
}

/** Count text for an error reason: `1 UTXO`, `2 UTXOs`. */
function utxoCount(count: number, adjective?: string): string {
  const noun = count === 1 ? 'UTXO' : 'UTXOs';
  return adjective ? `${count} ${adjective} ${noun}` : `${count} ${noun}`;
}

/** Options of {@link selectBeaconFunding}. */
export interface BeaconFundingOptions {
  /** The beacon address that holds the UTXOs. Its kind sets the input size. */
  beaconAddress: string;
  /** Network of the beacon address and the change address. */
  network: BTCNetwork;
  /** Fee estimator. Defaults to {@link DEFAULT_FEE_ESTIMATOR}. */
  feeEstimator?: FeeEstimator;
  /** Change address. Defaults to the beacon address (ADR 044). */
  changeAddress?: string;
  /**
   * Maximum number of inputs. Defaults to {@link MAX_BEACON_TX_INPUTS}. The
   * aggregation path sets 1: each input needs one MuSig2 nonce and one partial
   * signature from each cohort participant.
   */
  maxInputs?: number;
}

/**
 * The funding of one beacon signal transaction: the UTXOs it spends, the size,
 * the fee, and the change. {@link selectBeaconFunding} returns it.
 */
export interface BeaconFunding {
  /** The UTXOs to spend, in transaction input order (deepest first, then txid and vout). */
  utxos: Array<AddressUtxo>;
  /** Script kind of the beacon address (the kind of each input). */
  kind: SingletonScriptKind;
  /** Address of the change output (the beacon address unless the caller gave one). */
  changeAddress: string;
  /** Script kind used to size the change output. */
  changeKind: SingletonScriptKind;
  /** vsize (vbytes) of the transaction, from {@link beaconTxVsize}. */
  vsize: number;
  /** Total value (sats) of {@link utxos}. */
  valueSats: bigint;
  /** Estimated fee (sats) for {@link vsize}. */
  feeSats: bigint;
  /**
   * Value (sats) of the change output. 0 if the transaction has no change
   * output: the remainder then goes to the fee.
   */
  changeSats: bigint;
}

/**
 * Select the UTXOs that fund a beacon signal transaction, and size its fee and
 * change. Deterministic for a given UTXO set and fee rate. The builders, the api
 * funding guard, and the api beacon derivation call this one function.
 *
 * The rule:
 *
 * 1. A UTXO is eligible if it is confirmed (ADR 063) and its value is more than
 *    the fee of its own input ({@link BEACON_INPUT_VBYTES} of the beacon kind).
 *    An eligible UTXO always adds value to the transaction.
 * 2. The transaction spends all eligible UTXOs, up to `maxInputs`. It thus
 *    consolidates small UTXOs before a rise in the fee rate makes them useless.
 *    If more UTXOs are eligible, it spends those with the largest value.
 * 3. The inputs are in ADR 063 order: deepest first, then txid, then vout.
 * 4. The total value must be more than the fee of {@link beaconTxVsize} for the
 *    number of inputs.
 * 5. The change output exists only if the change is at least the dust limit of
 *    its kind and more than the fee of the input that spends it later. At the
 *    same fee rate, a later signal can then spend it under rule 1.
 *
 * @param utxos UTXOs reported at the beacon address.
 * @param options The beacon address, network, fee estimator, change address, and input limit.
 * @returns The selected UTXOs, the vsize, the fee, and the change.
 * @throws {BeaconError} Each error has `data.reason`, the reason text without the address.
 *   - `UNFUNDED_BEACON_ADDRESS` if the address has no UTXO.
 *   - `NO_SPENDABLE_BEACON_UTXO` if no UTXO is eligible (all unconfirmed, or all
 *     at or below the fee of their own input).
 *   - `INSUFFICIENT_FUNDS` if the selected UTXOs do not cover the fee.
 */
export async function selectBeaconFunding(
  utxos: Array<AddressUtxo>,
  options: BeaconFundingOptions,
): Promise<BeaconFunding> {
  const { beaconAddress: address, network } = options;
  const feeEstimator = options.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;
  const maxInputs = options.maxInputs ?? MAX_BEACON_TX_INPUTS;
  const kind = detectSingletonScriptKind(address, network);
  const changeAddress = resolveChangeAddress(address, network, options.changeAddress);
  const changeKind = changeOutputKind(changeAddress, network);

  if(!utxos.length) {
    const reason = 'no UTXOs';
    throw new BeaconError(
      `Beacon address ${address} cannot fund a signal: ${reason}.`,
      'UNFUNDED_BEACON_ADDRESS', { address, reason }
    );
  }

  const inputFeeSats = await feeEstimator.estimateFee(BEACON_INPUT_VBYTES[kind]);
  const confirmed = utxos.filter(isConfirmedUtxo);
  const eligible = confirmed.filter(utxo => BigInt(utxo.value) > inputFeeSats);
  if(!eligible.length) {
    const unconfirmed = utxos.length - confirmed.length;
    const reason = confirmed.length === 0
      ? `${utxoCount(utxos.length)}, none confirmed`
      : `${utxoCount(confirmed.length, 'confirmed')}, each at or below the fee of its own input `
        + `(${inputFeeSats} sats)${unconfirmed ? `, and ${unconfirmed} unconfirmed` : ''}`;
    throw new BeaconError(
      `Beacon address ${address} cannot fund a signal: ${reason}.`,
      'NO_SPENDABLE_BEACON_UTXO',
      { address, reason, total: utxos.length, confirmed: confirmed.length, inputFeeSats: Number(inputFeeSats) }
    );
  }

  const selected = eligible.length > maxInputs
    ? [ ...eligible ].sort(byValueThenDepth).slice(0, maxInputs)
    : [ ...eligible ];
  selected.sort(byDepthThenId);

  const vsize = beaconTxVsize(kind, changeKind, selected.length);
  const feeSats = await feeEstimator.estimateFee(vsize);
  const valueSats = selected.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  if(valueSats <= feeSats) {
    const reason = `${utxoCount(selected.length, 'spendable')}, total value ${valueSats} sats, `
      + `fee ${feeSats} sats (${vsize} vB)`;
    throw new BeaconError(
      `Beacon address ${address} cannot fund a signal: ${reason}.`,
      'INSUFFICIENT_FUNDS',
      {
        address, reason,
        total     : utxos.length,
        confirmed : confirmed.length,
        eligible  : eligible.length,
        selected  : selected.length,
        valueSats : Number(valueSats),
        feeSats   : Number(feeSats),
        vsize,
      }
    );
  }

  const change = valueSats - feeSats;
  const changeInputFeeSats = await feeEstimator.estimateFee(BEACON_INPUT_VBYTES[changeKind]);
  const dustLimitSats = BigInt(DUST_LIMIT_SATS[changeKind]);
  const changeFloorSats = changeInputFeeSats + 1n > dustLimitSats ? changeInputFeeSats + 1n : dustLimitSats;
  const changeSats = change >= changeFloorSats ? change : 0n;

  return { utxos: selected, kind, changeAddress, changeKind, vsize, valueSats, feeSats, changeSats };
}

/**
 * Read the UTXOs at the beacon address, select the funding with
 * {@link selectBeaconFunding}, and read the raw previous transaction of each
 * selected UTXO (PSBT inputs need it). `prevTxs[i]` is the previous transaction
 * of `funding.utxos[i]`. The reads are sequential, so a rate-limited REST
 * endpoint gets one request at a time. Throws the {@link BeaconError} of
 * {@link selectBeaconFunding}.
 */
async function fetchBeaconFunding(
  bitcoin: BitcoinConnection,
  options: BeaconFundingOptions,
): Promise<{ funding: BeaconFunding; prevTxs: Array<Uint8Array> }> {
  const utxos = await bitcoin.rest.address.getUtxos(options.beaconAddress);
  const funding = await selectBeaconFunding(utxos, options);
  const byTxid = new Map<string, Uint8Array>();
  for(const { txid } of funding.utxos) {
    if(!byTxid.has(txid)) byTxid.set(txid, hexToBytes(await bitcoin.rest.transaction.getHex(txid)));
  }
  return { funding, prevTxs: funding.utxos.map(utxo => byTxid.get(utxo.txid)!) };
}

/**
 * Build an aggregation beacon transaction (P2TR key-path spend) ready for MuSig2 signing.
 * Returns the unsigned Transaction + prev-output metadata that an aggregation service's
 * signing session consumes (via {@link SigningTxData}).
 *
 * This is the reusable counterpart to {@link SinglePartyBeacon.buildSignAndBroadcast}'s internal
 * construction step: the aggregation path must produce an unsigned tx because the
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
  /**
   * Address to send change to. Defaults to the beacon (cohort) address. Supply the
   * funder's address (an operator-funded cohort's funding wallet) to stop reusing the
   * cohort address for change (ADR 044). Change ownership is the funder's call, which
   * the cohort-condition model leaves to the caller (ADR 039).
   */
  changeAddress?: string;
}): Promise<BeaconTxPlan> {
  // The fee cannot be probe-measured (no secret key until the downstream MuSig2
  // round), so selectBeaconFunding sizes it analytically. The input is the cohort's
  // P2TR key path; only the change output's kind varies (ADR 045). One input only:
  // each input needs one MuSig2 nonce and one partial signature from each participant.
  const { funding, prevTxs } = await fetchBeaconFunding(opts.bitcoin, {
    beaconAddress : opts.beaconAddress,
    network       : opts.network,
    feeEstimator  : opts.feeEstimator,
    changeAddress : opts.changeAddress,
    maxInputs     : 1,
  });
  const utxo = funding.utxos[0]!;
  const amount = BigInt(utxo.value);

  // The funded beacon output is a Taproot script-tree output: key path is the
  // MuSig2 aggregate, script path is the k-of-n fallback + CSV recovery leaves
  // (see cohort.ts and ADR 042). Derive the witnessUtxo scriptPubKey from the
  // funded address itself; recomputing a key-path-only p2tr(internalPubkey) here
  // would not match the script-tree UTXO on chain and would invalidate both the
  // key-path sighash and the fallback script-path sighash.
  const witnessScript = OutScript.encode(Address(opts.network).decode(opts.beaconAddress));

  // allowUnknownOutputs: scure does not classify OP_RETURN as a "known" output
  // type because it is unspendable by design. The opt-in flag tells scure we
  // know the output is intentional (the beacon signal embedded in OP_RETURN).
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid           : utxo.txid,
    index          : utxo.vout,
    nonWitnessUtxo : prevTxs[0]!,
    witnessUtxo    : { amount, script: witnessScript },
    tapInternalKey : opts.internalPubkey,
  });
  addSignalOutputs(tx, funding, opts.signalBytes, opts.network);

  return {
    tx,
    prevOutScripts : [witnessScript],
    prevOutValues  : [amount],
    beaconAddress  : opts.beaconAddress,
    changeAddress  : funding.changeAddress,
    utxos          : funding.utxos,
    feeSats        : funding.feeSats,
    scriptKind     : 'p2tr',
  };
}

/**
 * Add the outputs of a beacon signal transaction: the change output first (only
 * if {@link BeaconFunding.changeSats} is not 0; else the remainder goes to the
 * fee), then the OP_RETURN signal, which the spec requires to be the last output.
 */
function addSignalOutputs(
  tx: Transaction,
  funding: BeaconFunding,
  signalBytes: Uint8Array,
  network: BTCNetwork,
): void {
  if(funding.changeSats > 0n) {
    tx.addOutputAddress(funding.changeAddress, funding.changeSats, network);
  }
  tx.addOutput({ script: opReturnScript(signalBytes), amount: 0n });
}

/**
 * Sign one input of a singleton beacon transaction. Dispatches to the correct
 * sighash + signature-application path based on `kind`. The caller finalizes the
 * tx after it signs each input.
 *
 * - **P2PKH**: legacy ECDSA sighash; scure assembles the scriptSig from `partialSig`.
 * - **P2WPKH**: BIP-143 segwit-v0 sighash (P2PKH-shaped scriptCode); scure assembles
 *   the witness from `partialSig`.
 * - **P2TR**: BIP-341 taproot key-path sighash (SIGHASH_DEFAULT); 64-byte BIP-340
 *   Schnorr signature applied via `tapKeySig`. The sighash commits to the scripts
 *   and amounts of all inputs, so the function takes the arrays for all inputs.
 */
function signSingletonInput(
  tx: Transaction,
  inputIdx: number,
  kind: SingletonScriptKind,
  signer: Signer,
  prevOutScripts: Array<Uint8Array>,
  amounts: Array<bigint>,
): void {
  const pubkey = signer.publicKey;
  const prevOutScript = prevOutScripts[inputIdx]!;

  if(kind === 'p2pkh') {
    // Legacy sighash: scriptCode is the prev-output P2PKH script itself.
    // scure-btc-signer marks `preimageLegacy` as TypeScript-private but does not
    // expose a public alternative; its own `signIdx` consumes the secret key
    // directly. We need only the sighash bytes so an external Signer can produce
    // the signature, so we reach through the type system here. If scure ever
    // renames this method, the P2PKH path tests fail loudly.
    // TODO: track https://github.com/paulmillr/scure-btc-signer/issues/142 -
    // drop the cast once a public preimage (e.g. `preimageP2PKH`) lands upstream.
    const sighashType = SigHash.ALL;
    const sighash = (tx as unknown as {
      preimageLegacy: (idx: number, prevScript: Uint8Array, hashType: number) => Uint8Array;
    }).preimageLegacy(inputIdx, prevOutScript, sighashType);
    const sig = signer.sign(sighash, 'ecdsa');
    const sigWithType = concatBytes(sig, new Uint8Array([sighashType]));
    tx.updateInput(inputIdx, { partialSig: [[pubkey, sigWithType]] }, true);
    return;
  }

  if(kind === 'p2wpkh') {
    // BIP-143: scriptCode for a P2WPKH input is the equivalent legacy P2PKH script
    // (`OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG`). The P2PKH-shaped
    // script appearing here in P2WPKH signing is intentional, not a bug.
    //
    // Derive the hash from `prevOutScript` (the bytes actually committed on-chain),
    // not by re-hashing `signer.publicKey`. BIP-143 commits to the prev output, so
    // the sighash must follow those bytes exactly. Rebuilding from the signer's
    // pubkey assumes (rather than verifies) the two are in sync.
    const decoded = OutScript.decode(prevOutScript);
    if(decoded.type !== 'wpkh') {
      throw new BeaconError(
        `Expected P2WPKH prev-output script, got "${decoded.type}".`,
        'PREVOUT_SCRIPT_MISMATCH',
        { kind, observedScriptType: decoded.type }
      );
    }
    const sighashScript = OutScript.encode({ type: 'pkh', hash: decoded.hash });
    const sighashType = SigHash.ALL;
    const sighash = tx.preimageWitnessV0(inputIdx, sighashScript, sighashType, amounts[inputIdx]!);
    const sig = signer.sign(sighash, 'ecdsa');
    const sigWithType = concatBytes(sig, new Uint8Array([sighashType]));
    tx.updateInput(inputIdx, { partialSig: [[pubkey, sigWithType]] }, true);
    return;
  }

  // P2TR key-path. BIP-341 requires signing with the taproot-tweaked secret
  // `d' = taprootTweakPrivKey(d, merkleRoot)`; the verifier checks against the
  // tweaked output internal key `Q = P + tG`. The tweak lives inside the Signer
  // (it needs the secret key), so we use scheme 'bip341' rather than the raw
  // 'bip340' scheme. No script tree on singleton beacons, no merkleRoot.
  // `true` lets scure add the signature after it signed an earlier input.
  const sighash = tx.preimageWitnessV1(inputIdx, prevOutScripts, SigHash.DEFAULT, amounts);
  const sig = signer.sign(sighash, 'bip341');
  tx.updateInput(inputIdx, { tapKeySig: sig }, true);
}

/**
 * Abstract base class providing the single-party broadcast machinery shared by
 * all BTCR2 beacon types: one party holds one key and broadcasts one 32-byte
 * signal (P2PKH / P2WPKH / P2TR key-path). The aggregation (cohort of N >= 1)
 * broadcast mode is the orthogonal axis, handled by the AggregationService and
 * {@link buildAggregationBeaconTx}, not by this class hierarchy. See ADR 037.
 *
 * Beacons are lightweight typed wrappers around a {@link BeaconService} configuration.
 * Dependencies (signals, sidecar data, bitcoin connection) are passed as method
 * parameters rather than held as instance state.
 *
 * Use {@link BeaconFactory.establish} to create typed instances from service config.
 *
 * @abstract
 * @class SinglePartyBeacon
 * @type {SinglePartyBeacon}
 */
export abstract class SinglePartyBeacon {
  /**
   * The Beacon service configuration parsed from the DID Document.
   */
  readonly service: BeaconService;

  /**
   * The absolute did:btcr2 identifier this beacon instance serves.
   *
   * Injected by the caller rather than recovered from {@link service}. A beacon
   * service `id` is permitted to be a relative DID URL (`#beacon-1`), which
   * carries no DID to strip a fragment from, so deriving the subject from it is
   * only correct for the absolute spelling.
   */
  readonly did: string;

  constructor(service: BeaconService, did: string) {
    this.service = service;
    this.did = did;
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
   * @param {Signer} signer Signer that produces the signature for the spending input.
   *   ECDSA for P2PKH / P2WPKH singletons, Schnorr (BIP-340) for P2TR key-path.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {BroadcastOptions} [options] Optional broadcast configuration (e.g. fee estimator).
   * @returns {Promise<BroadcastResult>} The broadcast artifacts: the signed update, the
   *   signal txid, and the per-beacon-type sidecar data (CAS announcement / SMT proof).
   */
  abstract broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<BroadcastResult>;

  /**
   * Build + sign + broadcast a singleton beacon signal transaction. The beacon
   * address's script kind (P2PKH / P2WPKH / P2TR) is detected automatically
   * and the input is constructed and signed accordingly.
   *
   * Composed from the three extracted phases ({@link buildSinglePartyTx},
   * {@link signSinglePartyTx}, {@link broadcastRawTx}) so each piece can be exercised
   * in isolation. Aggregation beacons use {@link buildAggregationBeaconTx} instead:
   * the multi-party path can't share the signing phase, but the tx-construction
   * plumbing (UTXO fetch + OP_RETURN output + change output) is shared.
   *
   * @param signalBytes 32-byte payload to embed in OP_RETURN.
   * @param signer Signer used to sign the spending input.
   * @param bitcoin Bitcoin network connection.
   * @param options Broadcast options (fee estimator, etc.).
   * @returns The txid of the broadcast transaction.
   * @throws {BeaconError} The errors of {@link selectBeaconFunding} (the address
   *   cannot fund the signal), or `SIGNER_KEY_MISMATCH`.
   */
  protected async buildSignAndBroadcast(
    signalBytes: Uint8Array,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<string> {
    const beaconAddress = this.service.serviceEndpoint.replace('bitcoin:', '');
    const { funding, prevTxs } = await fetchBeaconFunding(bitcoin, {
      beaconAddress,
      network       : bitcoin.data,
      feeEstimator  : options?.feeEstimator,
      changeAddress : options?.changeAddress,
    });
    const plan = this.buildSinglePartyTx({
      signalBytes, beaconAddress, funding, prevTxs, signer, network : bitcoin.data,
    });
    const signedHex = await this.signSinglePartyTx(plan, signer);
    return this.broadcastRawTx(bitcoin, signedHex);
  }

  /**
   * Build an unsigned singleton beacon tx ready for {@link signSinglePartyTx}.
   *
   * Adds one input for each UTXO of `funding`, configured for the beacon address
   * script kind (P2PKH / P2WPKH / P2TR). Validates that the signer's pubkey
   * produces the beacon address under that script kind: without this check, a
   * misconfigured caller would burn real UTXOs on a tx that fails at broadcast.
   * The fee and the change come from `funding` ({@link selectBeaconFunding}),
   * which sizes the tx analytically, with no probe-sign round-trip.
   */
  protected buildSinglePartyTx(opts: {
    signalBytes: Uint8Array;
    beaconAddress: string;
    funding: BeaconFunding;
    /** Raw previous transaction of each UTXO of `funding`, in the same order. */
    prevTxs: Array<Uint8Array>;
    signer: Signer;
    network: BTCNetwork;
  }): BeaconTxPlan {
    const { funding, network } = opts;
    const pubkey = opts.signer.publicKey;
    const kind = funding.kind;

    const derivedAddress = deriveSingletonAddress(kind, pubkey, network);
    if(derivedAddress !== opts.beaconAddress) {
      throw new BeaconError(
        `Signer pubkey produces ${kind.toUpperCase()} address "${derivedAddress}", but beacon address is "${opts.beaconAddress}".`,
        'SIGNER_KEY_MISMATCH',
        { kind, address: opts.beaconAddress, derivedAddress }
      );
    }

    // allowUnknownOutputs: scure does not classify OP_RETURN as a "known" output
    // type because it is unspendable by design. The opt-in flag tells scure we
    // know the output is intentional (the beacon signal embedded in OP_RETURN).
    const tx = new Transaction({ allowUnknownOutputs: true });

    // Per-kind input setup: P2PKH consumes via nonWitnessUtxo only (legacy);
    // P2WPKH and P2TR also carry a witnessUtxo (and P2TR carries tapInternalKey).
    // Each input spends an output of the beacon address, so all have one script.
    const internalKey = pubkey.slice(1, 33);
    const prevOutScript = OutScript.encode(Address(network).decode(opts.beaconAddress));
    funding.utxos.forEach((utxo, i) => {
      const input = { txid: utxo.txid, index: utxo.vout, nonWitnessUtxo: opts.prevTxs[i]! };
      const witnessUtxo = { amount: BigInt(utxo.value), script: prevOutScript };
      if(kind === 'p2pkh') {
        tx.addInput(input);
      } else if(kind === 'p2wpkh') {
        tx.addInput({ ...input, witnessUtxo });
      } else {
        tx.addInput({ ...input, witnessUtxo, tapInternalKey: internalKey });
      }
    });
    addSignalOutputs(tx, funding, opts.signalBytes, network);

    return {
      tx,
      prevOutScripts : funding.utxos.map(() => prevOutScript),
      prevOutValues  : funding.utxos.map(utxo => BigInt(utxo.value)),
      beaconAddress  : opts.beaconAddress,
      changeAddress  : funding.changeAddress,
      utxos          : funding.utxos,
      feeSats        : funding.feeSats,
      scriptKind     : kind,
    };
  }

  /**
   * Sign each input of the unsigned single-party tx, finalize it, and return its
   * raw hex. Dispatches to the correct signing primitive based on `plan.scriptKind`.
   */
  protected async signSinglePartyTx(plan: BeaconTxPlan, signer: Signer): Promise<string> {
    for(let idx = 0; idx < plan.tx.inputsLength; idx++) {
      signSingletonInput(plan.tx, idx, plan.scriptKind, signer, plan.prevOutScripts, plan.prevOutValues);
    }
    plan.tx.finalize();
    return plan.tx.hex;
  }

  /**
   * Broadcast raw transaction hex via the Bitcoin REST endpoint. Returns the txid.
   */
  protected async broadcastRawTx(bitcoin: BitcoinConnection, rawHex: string): Promise<string> {
    return bitcoin.rest.transaction.send(rawHex);
  }
}
