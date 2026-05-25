/**
 * Build, sign, and broadcast wallet transactions across the supported test
 * networks. Funding sends use the funding key's P2WPKH UTXOs (cheapest source);
 * recovery sweeps consume UTXOs at any of the three beacon address types.
 *
 * Fee strategy: two-pass. Probe-sign at a minimum fee, measure vsize, recompute
 * at the target sat/vB, rebuild with the corrected change amount. Same pattern
 * used by the Beacon base class and the sweep-mutinynet recovery script.
 */
import { BitcoinConnection, getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';
import { p2tr, p2wpkh, Transaction } from '@scure/btc-signer';

import { opReturnScript } from '../../src/core/beacon/beacon.js';
import type { Key, Network } from './store.js';
import { keypairFromKey } from './keys.js';

export type AddrType = 'p2pkh' | 'p2wpkh' | 'p2tr';

const FEE_RATE_SAT_PER_VB = 1;
const MIN_ABS_FEE_SATS = 200n;
const DUST_THRESHOLD = 546n;

type Utxo = {
  txid: string;
  vout: number;
  value: number;
  status?: { confirmed: boolean; block_height?: number };
};

export function connectionFor(network: Network): BitcoinConnection {
  if (network === 'regtest') {
    return BitcoinConnection.forNetwork('regtest', {
      rpc : { username: 'polaruser', password: 'polarpass' },
    });
  }
  return BitcoinConnection.forNetwork(network);
}

async function fetchUtxos(address: string, btc: BitcoinConnection): Promise<Utxo[]> {
  const raw = await btc.rest.address.getUtxos(address).catch(() => []);
  return raw as unknown as Utxo[];
}

async function fetchTxHex(txid: string, btc: BitcoinConnection): Promise<string> {
  return btc.rest.transaction.getHex(txid);
}

async function broadcast(rawHex: string, btc: BitcoinConnection): Promise<string> {
  return btc.rest.transaction.send(rawHex);
}

/** Pick the smallest subset of UTXOs whose sum covers `target`. */
function pickInputs(utxos: Utxo[], target: bigint): Utxo[] {
  const sorted = [...utxos].sort((a, b) => a.value - b.value);
  // Try smallest-single first
  const single = sorted.find((u) => BigInt(u.value) >= target);
  if (single) return [single];
  // Else accumulate from largest down
  const desc = [...sorted].reverse();
  const picked: Utxo[] = [];
  let sum = 0n;
  for (const u of desc) {
    picked.push(u);
    sum += BigInt(u.value);
    if (sum >= target) return picked;
  }
  throw new Error(`Insufficient funds: have ${sum} sats, need at least ${target}`);
}

type BuildArgs = {
  inputs: Array<{ utxo: Utxo; kind: AddrType; prevTxHex?: string }>;
  changeKind: AddrType;
  changeAddress: string;
  destAddress: string;
  destAmount: bigint;
  feeSats: bigint;
  sourcePublicKey: Uint8Array;
  network: Network;
};

function buildTx(args: BuildArgs): Transaction {
  const net = getNetwork(args.network);
  const xOnly = args.sourcePublicKey.slice(1);
  const tx = new Transaction({ allowUnknownOutputs: false });

  for (const inp of args.inputs) {
    const amount = BigInt(inp.utxo.value);
    const base = { txid: inp.utxo.txid, index: inp.utxo.vout };
    switch (inp.kind) {
      case 'p2pkh':
        tx.addInput({ ...base, nonWitnessUtxo: hex.decode(inp.prevTxHex!) });
        break;
      case 'p2wpkh':
        tx.addInput({
          ...base,
          witnessUtxo : { amount, script: p2wpkh(args.sourcePublicKey, net).script },
        });
        break;
      case 'p2tr':
        tx.addInput({
          ...base,
          witnessUtxo    : { amount, script: p2tr(xOnly, undefined, net).script },
          tapInternalKey : xOnly,
        });
        break;
    }
  }

  const totalIn = args.inputs.reduce((s, i) => s + BigInt(i.utxo.value), 0n);
  const change = totalIn - args.destAmount - args.feeSats;

  tx.addOutputAddress(args.destAddress, args.destAmount, net);
  if (change >= DUST_THRESHOLD) {
    tx.addOutputAddress(args.changeAddress, change, net);
  }
  return tx;
}

async function broadcastSend(args: {
  fromKey: Key;
  fromKind: AddrType;
  destAddress: string;
  destAmount: bigint;
  changeAddress: string;
  network: Network;
  feeRateSatPerVb?: number;
}): Promise<{ txid: string; vsize: number; feeSats: bigint; rawHex: string }> {
  const btc = connectionFor(args.network);
  const feeRate = args.feeRateSatPerVb ?? FEE_RATE_SAT_PER_VB;

  const fromAddress = args.fromKey.addresses[args.network][args.fromKind];
  const utxos = await fetchUtxos(fromAddress, btc);
  if (utxos.length === 0) {
    throw new Error(`Source address ${fromAddress} has no UTXOs on ${args.network}`);
  }

  const picked = pickInputs(utxos, args.destAmount + MIN_ABS_FEE_SATS);
  const prevTxCache = new Map<string, string>();
  if (args.fromKind === 'p2pkh') {
    for (const u of picked) {
      if (!prevTxCache.has(u.txid)) prevTxCache.set(u.txid, await fetchTxHex(u.txid, btc));
    }
  }

  const kp = keypairFromKey(args.fromKey);
  const secret = kp.secretKey.bytes;
  const pubkey = kp.publicKey.compressed;

  const inputs = picked.map((u) => ({
    utxo      : u,
    kind      : args.fromKind,
    prevTxHex : prevTxCache.get(u.txid),
  }));

  const totalIn = inputs.reduce((s, i) => s + BigInt(i.utxo.value), 0n);

  // Probe sign at min fee to measure vsize
  const probe = buildTx({
    inputs,
    changeKind      : args.fromKind,
    changeAddress   : fromAddress,
    destAddress     : args.destAddress,
    destAmount      : args.destAmount,
    feeSats         : MIN_ABS_FEE_SATS,
    sourcePublicKey : pubkey,
    network         : args.network,
  });
  probe.sign(secret);
  probe.finalize();
  const vsize = probe.vsize;

  const computedFee = BigInt(Math.ceil(vsize * feeRate));
  const feeSats = computedFee < MIN_ABS_FEE_SATS ? MIN_ABS_FEE_SATS : computedFee;

  if (totalIn - args.destAmount - feeSats < 0n) {
    throw new Error(`Inputs ${totalIn} insufficient for dest ${args.destAmount} + fee ${feeSats}`);
  }

  const final = buildTx({
    inputs,
    changeKind      : args.fromKind,
    changeAddress   : fromAddress,
    destAddress     : args.destAddress,
    destAmount      : args.destAmount,
    feeSats,
    sourcePublicKey : pubkey,
    network         : args.network,
  });
  final.sign(secret);
  final.finalize();

  const rawHex = final.hex;
  const txid = await broadcast(rawHex, btc);
  return { txid, vsize, feeSats, rawHex };
}

export async function fundBeacon(args: {
  funding: Key;
  beacon: Key;
  network: Network;
  destKind: AddrType;
  amountSats: bigint;
  feeRateSatPerVb?: number;
}): Promise<{ txid: string; vsize: number; feeSats: bigint }> {
  const destAddress = args.beacon.addresses[args.network][args.destKind];
  const result = await broadcastSend({
    fromKey         : args.funding,
    fromKind        : 'p2wpkh',  // funding source is always P2WPKH (cheapest)
    destAddress,
    destAmount      : args.amountSats,
    changeAddress   : args.funding.addresses[args.network].p2wpkh,
    network         : args.network,
    feeRateSatPerVb : args.feeRateSatPerVb,
  });
  const { rawHex: _, ...summary } = result;
  return summary;
}

export async function sweepBeacon(args: {
  funding: Key;
  beacon: Key;
  network: Network;
  fromKind: AddrType;
  feeRateSatPerVb?: number;
}): Promise<{ txid: string; vsize: number; feeSats: bigint; sweptSats: bigint }> {
  const btc = connectionFor(args.network);
  const feeRate = args.feeRateSatPerVb ?? FEE_RATE_SAT_PER_VB;
  const fromAddress = args.beacon.addresses[args.network][args.fromKind];
  const destAddress = args.funding.addresses[args.network].p2wpkh;

  const utxos = await fetchUtxos(fromAddress, btc);
  if (utxos.length === 0) {
    throw new Error(`Beacon ${args.beacon.label} (${args.fromKind}) has no UTXOs on ${args.network}`);
  }

  const totalIn = utxos.reduce((s, u) => s + BigInt(u.value), 0n);

  const prevTxCache = new Map<string, string>();
  if (args.fromKind === 'p2pkh') {
    for (const u of utxos) {
      if (!prevTxCache.has(u.txid)) prevTxCache.set(u.txid, await fetchTxHex(u.txid, btc));
    }
  }

  const kp = keypairFromKey(args.beacon);
  const secret = kp.secretKey.bytes;
  const pubkey = kp.publicKey.compressed;

  const inputs = utxos.map((u) => ({
    utxo : u, kind : args.fromKind, prevTxHex : prevTxCache.get(u.txid),
  }));

  // For sweep, the dest amount is totalIn - fee. Probe with min fee to size.
  const probe = buildTx({
    inputs,
    changeKind      : args.fromKind,
    changeAddress   : fromAddress,
    destAddress,
    destAmount      : totalIn - MIN_ABS_FEE_SATS,
    feeSats         : MIN_ABS_FEE_SATS,
    sourcePublicKey : pubkey,
    network         : args.network,
  });
  probe.sign(secret);
  probe.finalize();
  const vsize = probe.vsize;

  const computedFee = BigInt(Math.ceil(vsize * feeRate));
  const feeSats = computedFee < MIN_ABS_FEE_SATS ? MIN_ABS_FEE_SATS : computedFee;
  const sweptSats = totalIn - feeSats;
  if (sweptSats < DUST_THRESHOLD) {
    throw new Error(`Sweep dest amount ${sweptSats} below dust ${DUST_THRESHOLD}`);
  }

  const final = buildTx({
    inputs,
    changeKind      : args.fromKind,
    changeAddress   : fromAddress,
    destAddress,
    destAmount      : sweptSats,
    feeSats,
    sourcePublicKey : pubkey,
    network         : args.network,
  });
  final.sign(secret);
  final.finalize();

  const txid = await broadcast(final.hex, btc);
  return { txid, vsize, feeSats, sweptSats };
}

export async function getBalance(address: string, btc: BitcoinConnection): Promise<number> {
  const utxos = await fetchUtxos(address, btc);
  return utxos.reduce((s, u) => s + u.value, 0);
}

/**
 * Fund many addresses in a single batch transaction from the funding key's
 * P2WPKH UTXOs. One output per target (so each address ends up with its own
 * spendable UTXO), change back to the funding address. Two-pass fee.
 */
export async function fundManyAddresses(args: {
  funding: Key;
  targets: Array<{ address: string; amountSats: bigint }>;
  network: Network;
  feeRateSatPerVb?: number;
}): Promise<{ txid: string; vsize: number; feeSats: bigint }> {
  const btc = connectionFor(args.network);
  const net = getNetwork(args.network);
  const feeRate = args.feeRateSatPerVb ?? FEE_RATE_SAT_PER_VB;
  const fromAddress = args.funding.addresses[args.network].p2wpkh;

  const utxos = await fetchUtxos(fromAddress, btc);
  if (utxos.length === 0) throw new Error(`Funding ${fromAddress} has no UTXOs on ${args.network}`);

  const totalOut = args.targets.reduce((s, t) => s + t.amountSats, 0n);
  const picked = pickInputs(utxos, totalOut + MIN_ABS_FEE_SATS);
  const totalIn = picked.reduce((s, u) => s + BigInt(u.value), 0n);

  const kp = keypairFromKey(args.funding);
  const secret = kp.secretKey.bytes;
  const script = p2wpkh(kp.publicKey.compressed, net).script;

  const build = (feeSats: bigint): Transaction => {
    const tx = new Transaction({ allowUnknownOutputs: false });
    for (const u of picked) {
      tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { amount: BigInt(u.value), script } });
    }
    for (const t of args.targets) tx.addOutputAddress(t.address, t.amountSats, net);
    const change = totalIn - totalOut - feeSats;
    if (change >= DUST_THRESHOLD) tx.addOutputAddress(fromAddress, change, net);
    return tx;
  };

  const probe = build(MIN_ABS_FEE_SATS);
  probe.sign(secret); probe.finalize();
  const computed = BigInt(Math.ceil(probe.vsize * feeRate));
  const feeSats = computed < MIN_ABS_FEE_SATS ? MIN_ABS_FEE_SATS : computed;
  if (totalIn - totalOut - feeSats < 0n) {
    throw new Error(`Insufficient funds: in ${totalIn} < out ${totalOut} + fee ${feeSats}`);
  }

  const final = build(feeSats);
  final.sign(secret); final.finalize();
  const txid = await broadcast(final.hex, btc);
  return { txid, vsize: final.vsize, feeSats };
}

/**
 * Anchor a 32-byte signal as an OP_RETURN at the P2WPKH address controlled by
 * `secretHex`. Spends the address's largest UTXO; change returns to the same
 * address (so multiple anchors at one address can be chained); OP_RETURN is the
 * last output (the resolver reads the last vout). Two-pass fee.
 */
export async function anchorSignal(args: {
  secretHex: string;
  signalHex: string;
  network: Network;
  feeRateSatPerVb?: number;
}): Promise<{ txid: string; address: string; vsize: number; feeSats: bigint }> {
  const btc = connectionFor(args.network);
  const net = getNetwork(args.network);
  const feeRate = args.feeRateSatPerVb ?? FEE_RATE_SAT_PER_VB;

  const signal = hex.decode(args.signalHex);
  if (signal.length !== 32) throw new Error(`Signal must be 32 bytes, got ${signal.length}`);

  const kp = SchnorrKeyPair.fromSecret(hex.decode(args.secretHex));
  const secret = kp.secretKey.bytes;
  const pubkey = kp.publicKey.compressed;
  const address = p2wpkh(pubkey, net).address!;
  const script = p2wpkh(pubkey, net).script;

  const utxos = await fetchUtxos(address, btc);
  if (utxos.length === 0) throw new Error(`Beacon ${address} has no UTXO on ${args.network} — fund it first`);
  const utxo = [...utxos].sort((a, b) => b.value - a.value)[0]!;

  const build = (feeSats: bigint): Transaction => {
    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({ txid: utxo.txid, index: utxo.vout, witnessUtxo: { amount: BigInt(utxo.value), script } });
    const change = BigInt(utxo.value) - feeSats;
    if (change >= DUST_THRESHOLD) tx.addOutputAddress(address, change, net);
    tx.addOutput({ script: opReturnScript(signal), amount: 0n });
    return tx;
  };

  const probe = build(MIN_ABS_FEE_SATS);
  probe.sign(secret); probe.finalize();
  const computed = BigInt(Math.ceil(probe.vsize * feeRate));
  const feeSats = computed < MIN_ABS_FEE_SATS ? MIN_ABS_FEE_SATS : computed;
  if (BigInt(utxo.value) - feeSats < 0n) throw new Error(`UTXO ${utxo.value} < fee ${feeSats}`);

  const final = build(feeSats);
  final.sign(secret); final.finalize();
  const txid = await broadcast(final.hex, btc);
  return { txid, address, vsize: final.vsize, feeSats };
}
