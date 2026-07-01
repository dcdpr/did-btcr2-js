import type { AddressUtxo } from '@did-btcr2/bitcoin';
import { expect } from 'chai';
import { selectSpendableUtxo, SPENDABLE_DUST_LIMIT_SATS } from '../src/core/beacon/beacon.js';

/**
 * Build an AddressUtxo carrying only the fields selection reads (txid, vout, value,
 * status.confirmed, status.block_height). block_hash / block_time are unused here.
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

/** Return every permutation of an array (small inputs only). */
function permutations<T>(items: Array<T>): Array<Array<T>> {
  if(items.length <= 1) return [ items ];
  const out: Array<Array<T>> = [];
  for(let i = 0; i < items.length; i++) {
    const rest = [ ...items.slice(0, i), ...items.slice(i + 1) ];
    for(const p of permutations(rest)) out.push([ items[i]!, ...p ]);
  }
  return out;
}

describe('selectSpendableUtxo', () => {
  describe('confirmation filter', () => {
    it('ignores unconfirmed UTXOs even when they are deeper or larger', () => {
      const unconfirmedDeep = utxo({ txid: 'b'.repeat(64), height: 1, value: 1_000_000, confirmed: false });
      const confirmed = utxo({ txid: 'c'.repeat(64), height: 500, value: 10_000, confirmed: true });
      expect(selectSpendableUtxo([ unconfirmedDeep, confirmed ])).to.equal(confirmed);
    });

    it('treats a missing confirmed flag as unconfirmed (strict === true)', () => {
      // Esplora omits block fields on unconfirmed UTXOs; a missing flag is not spendable.
      const noFlag = { txid: 'd'.repeat(64), vout: 0, value: 100_000, status: { block_height: 100 } } as unknown as AddressUtxo;
      expect(() => selectSpendableUtxo([ noFlag ])).to.throw(/unconfirmed/);
    });
  });

  describe('dust filter', () => {
    it('excludes a UTXO exactly at the dust limit and includes one just above it', () => {
      const atLimit = utxo({ txid: 'a'.repeat(64), value: SPENDABLE_DUST_LIMIT_SATS });
      const aboveLimit = utxo({ txid: 'b'.repeat(64), value: SPENDABLE_DUST_LIMIT_SATS + 1 });
      expect(selectSpendableUtxo([ atLimit, aboveLimit ])).to.equal(aboveLimit);
    });

    it('prefers a deeper non-dust UTXO over a dust UTXO that is deeper still', () => {
      const dustDeepest = utxo({ txid: 'a'.repeat(64), height: 1, value: SPENDABLE_DUST_LIMIT_SATS });
      const spendable = utxo({ txid: 'b'.repeat(64), height: 50, value: 100_000 });
      expect(selectSpendableUtxo([ dustDeepest, spendable ])).to.equal(spendable);
    });
  });

  describe('deepest-first ordering', () => {
    it('picks the lowest block height (most confirmations)', () => {
      const shallow = utxo({ txid: 'a'.repeat(64), height: 900 });
      const deep = utxo({ txid: 'b'.repeat(64), height: 100 });
      const mid = utxo({ txid: 'c'.repeat(64), height: 500 });
      expect(selectSpendableUtxo([ shallow, deep, mid ])).to.equal(deep);
    });

    it('breaks a block-height tie by ascending txid', () => {
      const higherTxid = utxo({ txid: 'f'.repeat(64), height: 100, vout: 0 });
      const lowerTxid = utxo({ txid: '0'.repeat(64), height: 100, vout: 0 });
      expect(selectSpendableUtxo([ higherTxid, lowerTxid ])).to.equal(lowerTxid);
    });

    it('breaks a height + txid tie by ascending vout', () => {
      const sameTxid = 'a'.repeat(64);
      const vout2 = utxo({ txid: sameTxid, height: 100, vout: 2 });
      const vout0 = utxo({ txid: sameTxid, height: 100, vout: 0 });
      expect(selectSpendableUtxo([ vout2, vout0 ])).to.equal(vout0);
    });

    it('is deterministic across every input ordering', () => {
      const a = utxo({ txid: 'a'.repeat(64), height: 100, vout: 1, value: 100_000 });
      const b = utxo({ txid: 'a'.repeat(64), height: 100, vout: 0, value: 200_000 });
      const c = utxo({ txid: 'b'.repeat(64), height: 100, vout: 0, value: 300_000 });
      const d = utxo({ txid: 'c'.repeat(64), height: 50, vout: 5, value: 500 }); // dust, excluded
      const e = utxo({ txid: 'd'.repeat(64), height: 300, vout: 0, value: 999_999 });
      // Winner is b: deepest tier (height 100) shared with a/c; txid 'aaaa' < 'bbbb', vout 0 < 1.
      for(const order of permutations([ a, b, c, d, e ])) {
        expect(selectSpendableUtxo(order)).to.equal(b);
      }
    });

    it('does not mutate the caller-supplied array order', () => {
      const first = utxo({ txid: 'z'.repeat(64), height: 900 });
      const second = utxo({ txid: 'a'.repeat(64), height: 100 });
      const input = [ first, second ];
      selectSpendableUtxo(input);
      expect(input[0]).to.equal(first);
      expect(input[1]).to.equal(second);
    });
  });

  describe('error cases', () => {
    it('throws UNFUNDED_BEACON_ADDRESS on an empty UTXO set', () => {
      try {
        selectSpendableUtxo([], 'bc1qbeacon');
        expect.fail('expected selectSpendableUtxo to throw');
      } catch(err) {
        expect((err as { type: string }).type).to.equal('UNFUNDED_BEACON_ADDRESS');
        expect((err as { data: { address: string } }).data.address).to.equal('bc1qbeacon');
      }
    });

    it('throws NO_SPENDABLE_BEACON_UTXO naming unconfirmed when every UTXO is unconfirmed', () => {
      const utxos = [
        utxo({ txid: 'a'.repeat(64), confirmed: false, value: 100_000 }),
        utxo({ txid: 'b'.repeat(64), confirmed: false, value: 200_000 }),
      ];
      try {
        selectSpendableUtxo(utxos, 'bc1qbeacon');
        expect.fail('expected selectSpendableUtxo to throw');
      } catch(err) {
        expect((err as { type: string }).type).to.equal('NO_SPENDABLE_BEACON_UTXO');
        expect((err as Error).message).to.match(/unconfirmed/);
        expect((err as { data: { confirmed: number } }).data.confirmed).to.equal(0);
      }
    });

    it('throws NO_SPENDABLE_BEACON_UTXO naming dust when every confirmed UTXO is dust', () => {
      const utxos = [
        utxo({ txid: 'a'.repeat(64), confirmed: true, value: SPENDABLE_DUST_LIMIT_SATS }),
        utxo({ txid: 'b'.repeat(64), confirmed: true, value: 100 }),
      ];
      try {
        selectSpendableUtxo(utxos, 'bc1qbeacon');
        expect.fail('expected selectSpendableUtxo to throw');
      } catch(err) {
        expect((err as { type: string }).type).to.equal('NO_SPENDABLE_BEACON_UTXO');
        expect((err as Error).message).to.match(/dust limit/);
        expect((err as { data: { confirmed: number } }).data.confirmed).to.equal(2);
      }
    });
  });
});
