import { expect } from 'chai';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { p2wpkh } from '@scure/btc-signer';
import { BeaconSignalDiscovery, extractOpReturnSignal } from '../src/core/beacon/signal-discovery.js';
import type { BeaconService } from '../src/core/beacon/interfaces.js';

/**
 * Beacon signal extraction from a scriptPubKey asm string.
 *
 * A beacon signal output is exactly `OP_RETURN OP_PUSHBYTES_32 <32-byte hex>`
 * (the on-the-wire `0x6a 0x20 <32 bytes>` NULL_DATA shape, see
 * `op-return-script.spec.ts` for the encode side). {@link extractOpReturnSignal}
 * is the strict decoder: it returns the 32-byte hash only for that exact shape
 * and `null` for everything else, so a malformed or adversarial on-chain output
 * cannot be mistaken for a real signal during resolution. Before this guard, any
 * output containing the `OP_RETURN` keyword had its last asm token taken verbatim
 * as the signal hash, so a bare `OP_RETURN` or a wrong-size push produced a
 * phantom signal (e.g. the literal string `OP_RETURN`, or a short hex) that flowed
 * downstream as a real update reference.
 */
describe('extractOpReturnSignal', () => {
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';

  it('extracts the 32-byte hash from a well-formed beacon signal output', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH}`)).to.equal(HASH);
  });

  it('lowercases an uppercase hex payload so it matches hex-keyed sidecar maps', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH.toUpperCase()}`)).to.equal(HASH);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(extractOpReturnSignal(`  OP_RETURN   OP_PUSHBYTES_32   ${HASH}  `)).to.equal(HASH);
  });

  it('returns null for undefined or empty input', () => {
    expect(extractOpReturnSignal(undefined)).to.equal(null);
    expect(extractOpReturnSignal('')).to.equal(null);
    expect(extractOpReturnSignal('   ')).to.equal(null);
  });

  it('returns null for a bare OP_RETURN with no data push', () => {
    expect(extractOpReturnSignal('OP_RETURN')).to.equal(null);
  });

  it('returns null for a wrong-size push opcode (not OP_PUSHBYTES_32)', () => {
    expect(extractOpReturnSignal('OP_RETURN OP_PUSHBYTES_4 deadbeef')).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too short)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH.slice(0, 62)}`)).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too long)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH}ab`)).to.equal(null);
  });

  it('returns null for a non-hex payload of the right length', () => {
    const nonHex = 'z'.repeat(64);
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${nonHex}`)).to.equal(null);
  });

  it('returns null for a multi-push OP_RETURN (more than one data element)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH} OP_PUSHBYTES_4 deadbeef`)).to.equal(null);
  });

  it('returns null for a non-OP_RETURN script', () => {
    // A p2wpkh scriptPubKey asm: no OP_RETURN, must never yield a signal.
    expect(extractOpReturnSignal('OP_0 OP_PUSHBYTES_20 751e76e8199196d454941c45d1b3a323f1433bd6')).to.equal(null);
  });

  it('returns null when OP_RETURN is present but not the leading opcode', () => {
    // OP_RETURN must be the first token of a NULL_DATA output; a script that merely
    // contains the keyword elsewhere is not a beacon signal.
    expect(extractOpReturnSignal(`OP_DUP OP_RETURN OP_PUSHBYTES_32 ${HASH}`)).to.equal(null);
  });
});

describe('BeaconSignalDiscovery.indexer', () => {
  const SIGNAL_HEX = 'ab'.repeat(32);
  const SIGNAL_ASM = `OP_RETURN OP_PUSHBYTES_32 ${SIGNAL_HEX}`;

  const secret = new Uint8Array(32);
  secret[31] = 7;
  const address = p2wpkh(secp256k1.getPublicKey(secret, true), getNetwork('regtest')).address!;

  const service: BeaconService = {
    id              : 'did:btcr2:x#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${address}`
  };

  /** Minimal BitcoinConnection stub: fixed tip height, canned address transactions. */
  function mockBitcoin(txs: Array<unknown>): BitcoinConnection {
    return {
      rest : {
        block   : { count: async () => 105 },
        address : { getTxs: async () => txs }
      }
    } as unknown as BitcoinConnection;
  }

  it('skips mempool (unconfirmed) transactions', async () => {
    const txs = [{ vout: [{ scriptpubkey_asm: SIGNAL_ASM }], status: { confirmed: false } }];
    const signals = await BeaconSignalDiscovery.indexer([service], mockBitcoin(txs));
    expect(signals.get(service)).to.have.lengthOf(0);
  });

  it('accepts confirmed transactions and computes confirmations from the tip', async () => {
    const txs = [{
      vout   : [{ scriptpubkey_asm: SIGNAL_ASM }],
      status : { confirmed: true, block_height: 100, block_time: 1700000000 }
    }];
    const signals = await BeaconSignalDiscovery.indexer([service], mockBitcoin(txs));
    const found = signals.get(service)!;
    expect(found).to.have.lengthOf(1);
    expect(found[0].signalBytes).to.equal(SIGNAL_HEX);
    expect(found[0].blockMetadata.confirmations).to.equal(6);
    expect(found[0].blockMetadata.height).to.equal(100);
  });
});

describe('BeaconSignalDiscovery.fullnode', () => {
  const SIGNAL_HEX = 'cd'.repeat(32);
  const SIGNAL_ASM = `OP_RETURN OP_PUSHBYTES_32 ${SIGNAL_HEX}`;

  const secret = new Uint8Array(32);
  secret[31] = 9;
  const address = p2wpkh(secp256k1.getPublicKey(secret, true), getNetwork('regtest')).address!;
  const PAYMENT_ASM = 'OP_0 OP_PUSHBYTES_20 751e76e8199196d454941c45d1b3a323f1433bd6';

  const service: BeaconService = {
    id              : 'did:btcr2:x#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${address}`
  };

  /**
   * Minimal RPC stub: two blocks. Block 1 contains `spendTx`, a transaction
   * whose input spends a prevout paying the beacon address. The prevout lookup
   * returns the funding tx (its output script is the beacon PAYMENT script,
   * never an OP_RETURN).
   */
  function mockFullnode(spendTx: unknown): BitcoinConnection {
    const fundingTx = {
      txid  : 'ef'.repeat(32),
      vout  : [{ scriptPubKey: { asm: PAYMENT_ASM, address } }]
    };
    const blocks: Record<number, unknown> = {
      0 : { hash: '00'.repeat(32), height: 0, time: 1700000000, confirmations: 2, tx: [] },
      1 : { hash: '11'.repeat(32), height: 1, time: 1700000600, confirmations: 1, tx: [spendTx] },
    };
    return {
      rpc : {
        getBlockCount     : async () => 1,
        getBlock          : async ({ height }: { height: number }) => blocks[height],
        getRawTransaction : async () => fundingTx,
      }
    } as unknown as BitcoinConnection;
  }

  it('discovers the signal on the spending transaction, not the spent prevout (audit H5)', async () => {
    const spendTx = {
      txid  : 'ab'.repeat(32),
      vin   : [{ txid: 'ef'.repeat(32), vout: 0 }],
      vout  : [
        { scriptPubKey: { asm: PAYMENT_ASM, address } },  // self-change
        { scriptPubKey: { asm: SIGNAL_ASM } },            // the beacon signal
      ],
    };
    const signals = await BeaconSignalDiscovery.fullnode([service], mockFullnode(spendTx));
    const found = signals.get(service)!;
    expect(found).to.have.lengthOf(1);
    expect(found[0].signalBytes).to.equal(SIGNAL_HEX);
    expect(found[0].blockMetadata.height).to.equal(1);
  });

  it('finds no signal when the spending transaction carries no OP_RETURN', async () => {
    const spendTx = {
      txid  : 'ab'.repeat(32),
      vin   : [{ txid: 'ef'.repeat(32), vout: 0 }],
      vout  : [{ scriptPubKey: { asm: PAYMENT_ASM, address } }],
    };
    const signals = await BeaconSignalDiscovery.fullnode([service], mockFullnode(spendTx));
    expect(signals.get(service)).to.have.lengthOf(0);
  });
});
