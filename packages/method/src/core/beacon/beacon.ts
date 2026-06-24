import type { AddressUtxo, BitcoinConnection, BTCNetwork } from '@did-btcr2/bitcoin';
import type { KeyBytes } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { Signer } from '@did-btcr2/keypair';
import { concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { Address, OutScript, p2pkh, p2tr, p2wpkh, Script, SigHash, Transaction } from '@scure/btc-signer';
import type { BeaconProcessResult } from '../resolver.js';
import type { SidecarData } from '../types.js';
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
 * vsize (vbytes) for a beacon transaction that spends one input of `beaconKind`
 * and returns change to an output of `changeKind`, plus the OP_RETURN(32) signal.
 *
 * When `changeKind === beaconKind` (the default, change to the beacon address) this
 * returns the per-kind {@link SINGLETON_BEACON_TX_VSIZE} constant unchanged, so the
 * default path and the constants' lock-in tests are byte-identical. A differing
 * `changeKind` swaps the assumed same-kind change output for the actual one, keeping
 * the result a valid upper bound. The aggregation key-path spend is the
 * `beaconKind: 'p2tr'` case (its input is always the cohort's P2TR key path; only the
 * change output varies), the analytical sizing ADR 045 calls for, computed without a
 * secret.
 */
export function beaconTxVsize(
  beaconKind: SingletonScriptKind,
  changeKind: SingletonScriptKind,
): number {
  const base = SINGLETON_BEACON_TX_VSIZE[beaconKind] - CHANGE_OUTPUT_VBYTES[beaconKind];
  return base + CHANGE_OUTPUT_VBYTES[changeKind];
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
  /** The UTXO this tx consumes. */
  utxo: AddressUtxo;
  /** The fee (sats) already deducted from the change output. */
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
      'UNFUNDED_BEACON_ADDRESS', { address: bitcoinAddress }
    );
  }
  const utxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height).shift();
  if(!utxo) {
    throw new BeaconError(
      'Beacon bitcoin address unfunded or utxos unconfirmed.',
      'UNFUNDED_BEACON_ADDRESS', { address: bitcoinAddress }
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
  const feeEstimator = opts.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;
  const { utxo, prevTxBytes } = await fetchSpendableUtxo(opts.beaconAddress, opts.bitcoin);
  const changeAddress = resolveChangeAddress(opts.beaconAddress, opts.network, opts.changeAddress);

  // The funded beacon output is a Taproot script-tree output: key path is the
  // MuSig2 aggregate, script path is the k-of-n fallback + CSV recovery leaves
  // (see cohort.ts and ADR 042). Derive the witnessUtxo scriptPubKey from the
  // funded address itself; recomputing a key-path-only p2tr(internalPubkey) here
  // would not match the script-tree UTXO on chain and would invalidate both the
  // key-path sighash and the fallback script-path sighash.
  const witnessScript = OutScript.encode(Address(opts.network).decode(opts.beaconAddress));

  // The fee cannot be probe-measured (no secret key until the downstream MuSig2
  // round), so size it analytically. The input is the cohort's P2TR key path; only
  // the change output's kind varies, so the vsize follows the change address (ADR 045).
  const changeKind = changeOutputKind(changeAddress, opts.network);
  const feeSats = await feeEstimator.estimateFee(beaconTxVsize('p2tr', changeKind));
  if(BigInt(utxo.value) <= feeSats) {
    throw new BeaconError(
      `UTXO value (${utxo.value}) insufficient to cover fee (${feeSats}).`,
      'INSUFFICIENT_FUNDS',
      { address: opts.beaconAddress, valueSats: utxo.value, feeSats }
    );
  }

  // allowUnknownOutputs: scure does not classify OP_RETURN as a "known" output
  // type because it is unspendable by design. The opt-in flag tells scure we
  // know the output is intentional (the beacon signal embedded in OP_RETURN).
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid           : utxo.txid,
    index          : utxo.vout,
    nonWitnessUtxo : prevTxBytes,
    witnessUtxo    : { amount: BigInt(utxo.value), script: witnessScript },
    tapInternalKey : opts.internalPubkey,
  });
  // Change first (omitted when it would be dust, sweeping the remainder into the
  // fee), then the OP_RETURN signal, which the spec requires to be the last output.
  const changeValue = BigInt(utxo.value) - feeSats;
  if(changeValue >= BigInt(DUST_LIMIT_SATS[changeKind])) {
    tx.addOutputAddress(changeAddress, changeValue, opts.network);
  }
  tx.addOutput({ script: opReturnScript(opts.signalBytes), amount: 0n });

  return {
    tx,
    prevOutScripts : [witnessScript],
    prevOutValues  : [BigInt(utxo.value)],
    beaconAddress  : opts.beaconAddress,
    changeAddress,
    utxo,
    feeSats,
    scriptKind     : 'p2tr',
  };
}

/**
 * Sign the single input of a singleton beacon transaction. Dispatches to the
 * correct sighash + signature-application path based on `kind`, finalizes the
 * tx, and returns the signed raw hex.
 *
 * - **P2PKH**: legacy ECDSA sighash; scure assembles the scriptSig from `partialSig`.
 * - **P2WPKH**: BIP-143 segwit-v0 sighash (P2PKH-shaped scriptCode); scure assembles
 *   the witness from `partialSig`.
 * - **P2TR**: BIP-341 taproot key-path sighash (SIGHASH_DEFAULT); 64-byte BIP-340
 *   Schnorr signature applied via `tapKeySig`.
 */
async function signSingletonInput(
  tx: Transaction,
  inputIdx: number,
  kind: SingletonScriptKind,
  signer: Signer,
  prevOutScript: Uint8Array,
  amount: bigint,
): Promise<string> {
  const pubkey = signer.publicKey;

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
    tx.finalize();
    return tx.hex;
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
    const sighash = tx.preimageWitnessV0(inputIdx, sighashScript, sighashType, amount);
    const sig = signer.sign(sighash, 'ecdsa');
    const sigWithType = concatBytes(sig, new Uint8Array([sighashType]));
    tx.updateInput(inputIdx, { partialSig: [[pubkey, sigWithType]] }, true);
    tx.finalize();
    return tx.hex;
  }

  // P2TR key-path. BIP-341 requires signing with the taproot-tweaked secret
  // `d' = taprootTweakPrivKey(d, merkleRoot)`; the verifier checks against the
  // tweaked output internal key `Q = P + tG`. The tweak lives inside the Signer
  // (it needs the secret key), so we use scheme 'bip341' rather than the raw
  // 'bip340' scheme. No script tree on singleton beacons, no merkleRoot.
  const sighash = tx.preimageWitnessV1(inputIdx, [prevOutScript], SigHash.DEFAULT, [amount]);
  const sig = signer.sign(sighash, 'bip341');
  tx.updateInput(inputIdx, { tapKeySig: sig });
  tx.finalize();
  return tx.hex;
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
   * @param {Signer} signer Signer that produces the signature for the spending input.
   *   ECDSA for P2PKH / P2WPKH singletons, Schnorr (BIP-340) for P2TR key-path.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection.
   * @param {BroadcastOptions} [options] Optional broadcast configuration (e.g. fee estimator).
   * @returns {Promise<SignedBTCR2Update>} The signed update that was broadcast.
   */
  abstract broadcastSignal(
    signedUpdate: SignedBTCR2Update,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<SignedBTCR2Update>;

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
   * @throws {BeaconError} if the address is unfunded, no UTXO is available, or fee exceeds value.
   */
  protected async buildSignAndBroadcast(
    signalBytes: Uint8Array,
    signer: Signer,
    bitcoin: BitcoinConnection,
    options?: BroadcastOptions
  ): Promise<string> {
    const feeEstimator = options?.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;
    const beaconAddress = this.service.serviceEndpoint.replace('bitcoin:', '');
    const { utxo, prevTxBytes } = await fetchSpendableUtxo(beaconAddress, bitcoin);
    const plan = await this.buildSinglePartyTx({
      signalBytes, beaconAddress, utxo, prevTxBytes, signer, bitcoin, feeEstimator,
      changeAddress : options?.changeAddress,
    });
    const signedHex = await this.signSinglePartyTx(plan, signer);
    return this.broadcastRawTx(bitcoin, signedHex);
  }

  /**
   * Build an unsigned singleton beacon tx ready for {@link signSinglePartyTx}.
   *
   * Detects the beacon address script kind (P2PKH / P2WPKH / P2TR) and configures
   * the input accordingly. Validates that the signer's pubkey produces the beacon
   * address under that script kind: without this check, a misconfigured caller
   * would burn a real UTXO on a tx that fails at broadcast. Fees are computed from
   * the per-kind {@link SINGLETON_BEACON_TX_VSIZE} constant (via {@link beaconTxVsize}),
   * avoiding any probe-sign round-trip; a change address of a different kind re-sizes
   * the fee by the change output's size delta so it stays a valid upper bound.
   */
  protected async buildSinglePartyTx(opts: {
    signalBytes: Uint8Array;
    beaconAddress: string;
    utxo: AddressUtxo;
    prevTxBytes: Uint8Array;
    signer: Signer;
    bitcoin: BitcoinConnection;
    feeEstimator: FeeEstimator;
    changeAddress?: string;
  }): Promise<BeaconTxPlan> {
    const network = opts.bitcoin.data;
    const pubkey = opts.signer.publicKey;
    const kind = detectSingletonScriptKind(opts.beaconAddress, network);
    const changeAddress = resolveChangeAddress(opts.beaconAddress, network, opts.changeAddress);

    const derivedAddress = deriveSingletonAddress(kind, pubkey, network);
    if(derivedAddress !== opts.beaconAddress) {
      throw new BeaconError(
        `Signer pubkey produces ${kind.toUpperCase()} address "${derivedAddress}", but beacon address is "${opts.beaconAddress}".`,
        'SIGNER_KEY_MISMATCH',
        { kind, address: opts.beaconAddress, derivedAddress }
      );
    }

    const changeKind = changeOutputKind(changeAddress, network);
    const feeSats = await opts.feeEstimator.estimateFee(beaconTxVsize(kind, changeKind));
    const amount = BigInt(opts.utxo.value);
    if(amount <= feeSats) {
      throw new BeaconError(
        `UTXO value (${opts.utxo.value}) insufficient to cover fee (${feeSats}).`,
        'INSUFFICIENT_FUNDS',
        { address: opts.beaconAddress, valueSats: opts.utxo.value, feeSats }
      );
    }

    // allowUnknownOutputs: scure does not classify OP_RETURN as a "known" output
    // type because it is unspendable by design. The opt-in flag tells scure we
    // know the output is intentional (the beacon signal embedded in OP_RETURN).
    const tx = new Transaction({ allowUnknownOutputs: true });

    // Per-kind input setup: P2PKH consumes via nonWitnessUtxo only (legacy);
    // P2WPKH and P2TR also carry a witnessUtxo (and P2TR carries tapInternalKey).
    let prevOutScript: Uint8Array;
    if(kind === 'p2pkh') {
      prevOutScript = p2pkh(pubkey, network).script;
      tx.addInput({
        txid           : opts.utxo.txid,
        index          : opts.utxo.vout,
        nonWitnessUtxo : opts.prevTxBytes,
      });
    } else if(kind === 'p2wpkh') {
      prevOutScript = p2wpkh(pubkey, network).script;
      tx.addInput({
        txid           : opts.utxo.txid,
        index          : opts.utxo.vout,
        nonWitnessUtxo : opts.prevTxBytes,
        witnessUtxo    : { amount, script: prevOutScript },
      });
    } else {
      // p2tr key-path
      const internalKey = pubkey.slice(1, 33);
      prevOutScript = p2tr(internalKey, undefined, network).script;
      tx.addInput({
        txid           : opts.utxo.txid,
        index          : opts.utxo.vout,
        nonWitnessUtxo : opts.prevTxBytes,
        witnessUtxo    : { amount, script: prevOutScript },
        tapInternalKey : internalKey,
      });
    }

    // Change first (omitted when it would be dust, sweeping the remainder into the
    // fee), then the OP_RETURN signal, which the spec requires to be the last output.
    const changeValue = amount - feeSats;
    if(changeValue >= BigInt(DUST_LIMIT_SATS[changeKind])) {
      tx.addOutputAddress(changeAddress, changeValue, network);
    }
    tx.addOutput({ script: opReturnScript(opts.signalBytes), amount: 0n });

    return {
      tx,
      prevOutScripts : [prevOutScript],
      prevOutValues  : [amount],
      beaconAddress  : opts.beaconAddress,
      changeAddress,
      utxo           : opts.utxo,
      feeSats,
      scriptKind     : kind,
    };
  }

  /**
   * Sign + finalize the unsigned single-party tx and return its raw hex.
   * Dispatches to the correct signing primitive based on `plan.scriptKind`.
   */
  protected async signSinglePartyTx(plan: BeaconTxPlan, signer: Signer): Promise<string> {
    return signSingletonInput(
      plan.tx, 0, plan.scriptKind, signer,
      plan.prevOutScripts[0]!, plan.prevOutValues[0]!,
    );
  }

  /**
   * Broadcast raw transaction hex via the Bitcoin REST endpoint. Returns the txid.
   */
  protected async broadcastRawTx(bitcoin: BitcoinConnection, rawHex: string): Promise<string> {
    return bitcoin.rest.transaction.send(rawHex);
  }
}
