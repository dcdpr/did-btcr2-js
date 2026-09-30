import { getNetwork } from '@did-btcr2/bitcoin';
import type { AddressUtxo } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { expect } from 'chai';
import type { BeaconFundingOptions, SingletonScriptKind } from '../src/core/beacon/beacon.js';
import {
  BEACON_INPUT_VBYTES,
  beaconTxVsize,
  deriveSingletonAddress,
  DUST_LIMIT_SATS,
  MAX_BEACON_TX_INPUTS,
  selectBeaconFunding,
  SINGLETON_BEACON_TX_VSIZE,
} from '../src/core/beacon/beacon.js';
import { StaticFeeEstimator } from '../src/core/beacon/fee-estimator.js';

const network = getNetwork('regtest');
const KINDS: Array<SingletonScriptKind> = [ 'p2pkh', 'p2wpkh', 'p2tr' ];
const pubkey = SchnorrKeyPair.generate().publicKey.compressed;
const addressOf = (kind: SingletonScriptKind): string => deriveSingletonAddress(kind, pubkey, network);
const P2WPKH = addressOf('p2wpkh');

/** Options for a beacon address of `kind` at a static fee rate (sat/vB). */
function at(rate: number, kind: SingletonScriptKind = 'p2wpkh', extra?: Partial<BeaconFundingOptions>): BeaconFundingOptions {
  return { beaconAddress: addressOf(kind), network, feeEstimator: new StaticFeeEstimator(rate), ...extra };
}

/**
 * Build an AddressUtxo with only the fields that selection reads (txid, vout,
 * value, status.confirmed, status.block_height).
 */
function utxo(opts: {
  txid?: string;
  vout?: number;
  value?: number;
  confirmed?: boolean;
  height?: number;
}): AddressUtxo {
  return {
    txid   : opts.txid ?? 'a'.repeat(64),
    vout   : opts.vout ?? 0,
    value  : opts.value ?? 100_000,
    status : {
      confirmed    : opts.confirmed ?? true,
      block_height : opts.height ?? 100,
    },
  } as unknown as AddressUtxo;
}

/** A 64-character txid from a number, so that txid order follows the number. */
const txid = (n: number): string => n.toString(16).padStart(64, '0');

/** The `txid:vout` of each UTXO, in order. */
const ids = (utxos: Array<AddressUtxo>): Array<string> => utxos.map(u => `${u.txid}:${u.vout}`);

/** Every permutation of an array (small inputs only). */
function permutations<T>(items: Array<T>): Array<Array<T>> {
  if(items.length <= 1) return [ items ];
  const out: Array<Array<T>> = [];
  for(let i = 0; i < items.length; i++) {
    const rest = [ ...items.slice(0, i), ...items.slice(i + 1) ];
    for(const p of permutations(rest)) out.push([ items[i]!, ...p ]);
  }
  return out;
}

type SelectionError = Error & { type: string; data: Record<string, unknown> & { reason: string } };

/** Run the selection, expect it to throw, and return the error. */
async function selectionError(utxos: Array<AddressUtxo>, options: BeaconFundingOptions): Promise<SelectionError> {
  try {
    await selectBeaconFunding(utxos, options);
  } catch(err) {
    return err as SelectionError;
  }
  return expect.fail('expected selectBeaconFunding to throw');
}

describe('beaconTxVsize input count', () => {
  it('returns the per-kind constant for 1 input', () => {
    for(const kind of KINDS) {
      expect(beaconTxVsize(kind, kind)).to.equal(SINGLETON_BEACON_TX_VSIZE[kind]);
      expect(beaconTxVsize(kind, kind, 1)).to.equal(SINGLETON_BEACON_TX_VSIZE[kind]);
    }
  });

  it('adds the input vbytes of the beacon kind for each more input', () => {
    for(const kind of KINDS) {
      expect(beaconTxVsize(kind, kind, 3)).to.equal(SINGLETON_BEACON_TX_VSIZE[kind] + 2 * BEACON_INPUT_VBYTES[kind]);
    }
    expect(beaconTxVsize('p2wpkh', 'p2wpkh', 2)).to.equal(224);
  });
});

describe('selectBeaconFunding', () => {
  describe('2 UTXOs of 500 sats at a P2WPKH address', () => {
    const utxos = [
      utxo({ txid: txid(1), value: 500, height: 100 }),
      utxo({ txid: txid(2), value: 500, height: 101 }),
    ];

    it('fails at 5 sat/vB with the reason in the message and the data', async () => {
      const err = await selectionError(utxos, at(5));
      expect(err.type).to.equal('INSUFFICIENT_FUNDS');
      expect(err.data.reason).to.equal('2 spendable UTXOs, total value 1000 sats, fee 1120 sats (224 vB)');
      expect(err.message).to.equal(`Beacon address ${P2WPKH} cannot fund a signal: ${err.data.reason}.`);
      expect(err.data).to.include({
        address   : P2WPKH,
        total     : 2,
        confirmed : 2,
        eligible  : 2,
        selected  : 2,
        valueSats : 1000,
        feeSats   : 1120,
        vsize     : 224,
      });
    });

    it('fails with the same reason with no fee estimator (the default is 5 sat/vB)', async () => {
      const err = await selectionError(utxos, { beaconAddress: P2WPKH, network });
      expect(err.data.reason).to.equal('2 spendable UTXOs, total value 1000 sats, fee 1120 sats (224 vB)');
    });

    it('spends both at 1 sat/vB', async () => {
      const funding = await selectBeaconFunding(utxos, at(1));
      expect(ids(funding.utxos)).to.deep.equal(ids(utxos));
      expect(funding).to.include({ kind: 'p2wpkh', changeAddress: P2WPKH, changeKind: 'p2wpkh', vsize: 224 });
      expect(funding.valueSats).to.equal(1000n);
      expect(funding.feeSats).to.equal(224n);
      expect(funding.changeSats).to.equal(776n);
    });
  });

  describe('eligibility', () => {
    it('does not select a UTXO at or below the fee of its own input', async () => {
      // P2WPKH input fee at 5 sat/vB: 69 x 5 = 345 sats.
      const atFee = utxo({ txid: txid(1), value: 345 });
      const aboveFee = utxo({ txid: txid(2), value: 346 });
      const large = utxo({ txid: txid(3), value: 100_000 });
      const funding = await selectBeaconFunding([ atFee, aboveFee, large ], at(5));
      expect(ids(funding.utxos)).to.deep.equal(ids([ aboveFee, large ]));
    });

    it('uses the input fee of the beacon kind', async () => {
      // Input fee at 5 sat/vB: P2PKH 745, P2WPKH 345, P2TR 290.
      for(const kind of KINDS) {
        const inputFee = BEACON_INPUT_VBYTES[kind] * 5;
        const utxos = [ utxo({ txid: txid(1), value: inputFee }), utxo({ txid: txid(2), value: 100_000 }) ];
        const funding = await selectBeaconFunding(utxos, at(5, kind));
        expect(ids(funding.utxos)).to.deep.equal(ids([ utxos[1]! ]));
      }
    });

    it('ignores unconfirmed UTXOs, also if they are deeper or larger', async () => {
      const unconfirmed = utxo({ txid: txid(1), height: 1, value: 1_000_000, confirmed: false });
      const confirmed = utxo({ txid: txid(2), height: 500, value: 10_000 });
      const funding = await selectBeaconFunding([ unconfirmed, confirmed ], at(5));
      expect(ids(funding.utxos)).to.deep.equal(ids([ confirmed ]));
    });

    it('treats a missing confirmed flag as unconfirmed', async () => {
      const noFlag = { txid: txid(1), vout: 0, value: 100_000, status: { block_height: 100 } } as unknown as AddressUtxo;
      const err = await selectionError([ noFlag ], at(5));
      expect(err.type).to.equal('NO_SPENDABLE_BEACON_UTXO');
    });
  });

  describe('order and input limit', () => {
    it('puts the inputs deepest first, then by txid, then by vout, for every input order', async () => {
      const a = utxo({ txid: txid(1), vout: 1, height: 100 });
      const b = utxo({ txid: txid(1), vout: 0, height: 100 });
      const c = utxo({ txid: txid(2), vout: 0, height: 100 });
      const d = utxo({ txid: txid(3), vout: 5, height: 50, value: 300 }); // at or below the input fee
      const e = utxo({ txid: txid(4), vout: 0, height: 30 });
      const expected = ids([ e, b, a, c ]);
      for(const order of permutations([ a, b, c, d, e ])) {
        expect(ids((await selectBeaconFunding(order, at(5))).utxos)).to.deep.equal(expected);
      }
    });

    it(`spends at most ${MAX_BEACON_TX_INPUTS} UTXOs, those with the largest value`, async () => {
      // 25 UTXOs; a deeper UTXO has a smaller value. The 20 largest are the 20 shallowest.
      const utxos = Array.from({ length: 25 }, (_, i) => utxo({ txid: txid(i), value: 1_000 + i * 100, height: 100 + i }));
      const funding = await selectBeaconFunding(utxos, at(1));
      expect(ids(funding.utxos)).to.deep.equal(ids(utxos.slice(5)));
      expect(funding.vsize).to.equal(beaconTxVsize('p2wpkh', 'p2wpkh', MAX_BEACON_TX_INPUTS));
    });

    it('breaks a value tie at the limit by depth, then by txid', async () => {
      const shallow = utxo({ txid: txid(1), value: 5_000, height: 300 });
      const deep = utxo({ txid: txid(2), value: 5_000, height: 100 });
      const deepHigherTxid = utxo({ txid: txid(3), value: 5_000, height: 100 });
      const funding = await selectBeaconFunding([ shallow, deepHigherTxid, deep ], at(1, 'p2wpkh', { maxInputs: 2 }));
      expect(ids(funding.utxos)).to.deep.equal(ids([ deep, deepHigherTxid ]));
    });

    it('with maxInputs 1 (the aggregation path), spends the largest UTXO, not the deepest', async () => {
      const deepSmall = utxo({ txid: txid(1), value: 2_000, height: 100 });
      const shallowLarge = utxo({ txid: txid(2), value: 9_000, height: 900 });
      const funding = await selectBeaconFunding([ deepSmall, shallowLarge ], at(5, 'p2tr', { maxInputs: 1 }));
      expect(ids(funding.utxos)).to.deep.equal(ids([ shallowLarge ]));
      expect(funding.vsize).to.equal(SINGLETON_BEACON_TX_VSIZE.p2tr);
    });

    it('does not change the order of the caller array', async () => {
      const first = utxo({ txid: txid(9), height: 900 });
      const second = utxo({ txid: txid(1), height: 100 });
      const input = [ first, second ];
      await selectBeaconFunding(input, at(5));
      expect(input).to.deep.equal([ first, second ]);
    });
  });

  describe('change output', () => {
    /** The smallest change the rule keeps: the dust limit, or 1 sat more than the input fee. */
    const floor = (kind: SingletonScriptKind, rate: number): number =>
      Math.max(DUST_LIMIT_SATS[kind], Math.ceil(BEACON_INPUT_VBYTES[kind] * rate) + 1);

    it('keeps a change output only if a later signal at the same fee rate can spend it', async () => {
      for(const kind of KINDS) {
        for(const rate of [ 1, 2, 5, 10, 50 ]) {
          const fee = Math.ceil(SINGLETON_BEACON_TX_VSIZE[kind] * rate);
          const min = floor(kind, rate);

          const below = await selectBeaconFunding([ utxo({ value: fee + min - 1 }) ], at(rate, kind));
          expect(below.changeSats, `${kind} at ${rate} sat/vB, below the floor`).to.equal(0n);

          const kept = await selectBeaconFunding([ utxo({ value: fee + min }) ], at(rate, kind));
          expect(kept.changeSats, `${kind} at ${rate} sat/vB, at the floor`).to.equal(BigInt(min));

          // The next signal spends the change output together with a new UTXO.
          const change = utxo({ txid: txid(1), value: Number(kept.changeSats), height: 200 });
          const topUp = utxo({ txid: txid(2), value: 1_000_000, height: 201 });
          const next = await selectBeaconFunding([ change, topUp ], at(rate, kind));
          expect(ids(next.utxos), `${kind} at ${rate} sat/vB, next signal`).to.deep.equal(ids([ change, topUp ]));
        }
      }
    });

    it('at 5 sat/vB, sends a P2WPKH change of 345 sats (above the 294-sat dust limit) to the fee', async () => {
      const funding = await selectBeaconFunding([ utxo({ value: 775 + 345 }) ], at(5));
      expect(funding.feeSats).to.equal(775n);
      expect(funding.changeSats).to.equal(0n);
    });

    it('keeps the 450-sat change of two updates from 2000 sats, and a later signal spends it', async () => {
      const first = await selectBeaconFunding([ utxo({ txid: txid(1), value: 2_000 }) ], at(5));
      expect(first.changeSats).to.equal(1_225n);
      const second = await selectBeaconFunding([ utxo({ txid: txid(2), value: 1_225, height: 101 }) ], at(5));
      expect(second.changeSats).to.equal(450n);
      const change = utxo({ txid: txid(3), value: 450, height: 102 });
      const topUp = utxo({ txid: txid(4), value: 1_000, height: 103 });
      const third = await selectBeaconFunding([ change, topUp ], at(5));
      expect(ids(third.utxos)).to.deep.equal(ids([ change, topUp ]));
    });

    it('sizes the transaction with the kind of a change address of a different kind', async () => {
      const changeAddress = addressOf('p2wpkh');
      const utxos = [ utxo({ txid: txid(1) }), utxo({ txid: txid(2) }) ];
      const funding = await selectBeaconFunding(utxos, at(5, 'p2tr', { changeAddress }));
      expect(funding).to.include({ kind: 'p2tr', changeAddress, changeKind: 'p2wpkh' });
      expect(funding.vsize).to.equal(beaconTxVsize('p2tr', 'p2wpkh', 2));
      expect(funding.changeSats).to.equal(200_000n - funding.feeSats);
    });
  });

  describe('errors', () => {
    it('throws UNFUNDED_BEACON_ADDRESS if the address has no UTXO', async () => {
      const err = await selectionError([], at(5));
      expect(err.type).to.equal('UNFUNDED_BEACON_ADDRESS');
      expect(err.data).to.include({ address: P2WPKH, reason: 'no UTXOs' });
    });

    it('throws NO_SPENDABLE_BEACON_UTXO if no UTXO is confirmed', async () => {
      const utxos = [
        utxo({ txid: txid(1), confirmed: false }),
        utxo({ txid: txid(2), confirmed: false }),
      ];
      const err = await selectionError(utxos, at(5));
      expect(err.type).to.equal('NO_SPENDABLE_BEACON_UTXO');
      expect(err.data).to.include({ reason: '2 UTXOs, none confirmed', total: 2, confirmed: 0 });
    });

    it('throws NO_SPENDABLE_BEACON_UTXO if each confirmed UTXO is at or below the fee of its own input', async () => {
      const utxos = [
        utxo({ txid: txid(1), value: 345 }),
        utxo({ txid: txid(2), value: 100 }),
        utxo({ txid: txid(3), confirmed: false }),
      ];
      const err = await selectionError(utxos, at(5));
      expect(err.type).to.equal('NO_SPENDABLE_BEACON_UTXO');
      expect(err.data).to.include({
        reason       : '2 confirmed UTXOs, each at or below the fee of its own input (345 sats), and 1 unconfirmed',
        total        : 3,
        confirmed    : 2,
        inputFeeSats : 345,
      });
      expect(err.message).to.equal(`Beacon address ${P2WPKH} cannot fund a signal: ${err.data.reason}.`);
    });

    it('uses the singular noun for 1 UTXO', async () => {
      const err = await selectionError([ utxo({ value: 500 }) ], at(5));
      expect(err.data.reason).to.equal('1 spendable UTXO, total value 500 sats, fee 775 sats (155 vB)');
    });
  });
});
