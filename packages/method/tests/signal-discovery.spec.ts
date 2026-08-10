import { expect } from 'chai';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { p2wpkh } from '@scure/btc-signer';
import {
  BeaconSignalDiscovery,
  extractOpReturnSignal,
  extractOpReturnSignalFromHex
} from '../src/core/beacon/signal-discovery.js';
import type { BeaconService } from '../src/core/beacon/interfaces.js';

/**
 * Beacon signal extraction from scriptPubKey data.
 *
 * A beacon signal output is exactly `6a20<32 bytes>` on the wire (`OP_RETURN`
 * followed by a single minimal 32-byte data push; see `op-return-script.spec.ts`
 * for the encode side). Two asm dialects render that same script: Esplora /
 * rust-bitcoin emits `OP_RETURN OP_PUSHBYTES_32 <64-hex>`, while Bitcoin Core's
 * `ScriptToAsmStr` emits `OP_RETURN <64-hex>` with no push-opcode token.
 * {@link extractOpReturnSignal} accepts both dialects;
 * {@link extractOpReturnSignalFromHex} validates the raw script hex and is the
 * dialect-independent check both discovery paths use.
 */
describe('extractOpReturnSignal', () => {
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';

  it('extracts the 32-byte hash from a well-formed beacon signal output (Esplora dialect)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH}`)).to.equal(HASH);
  });

  it('extracts the 32-byte hash from the Bitcoin Core two-token dialect', () => {
    // Core's ScriptToAsmStr renders a 32-byte push as bare hex with no
    // OP_PUSHBYTES_32 token: `OP_RETURN <64-hex>`.
    expect(extractOpReturnSignal(`OP_RETURN ${HASH}`)).to.equal(HASH);
  });

  it('lowercases an uppercase hex payload so it matches hex-keyed sidecar maps', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH.toUpperCase()}`)).to.equal(HASH);
    expect(extractOpReturnSignal(`OP_RETURN ${HASH.toUpperCase()}`)).to.equal(HASH);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(extractOpReturnSignal(`  OP_RETURN   OP_PUSHBYTES_32   ${HASH}  `)).to.equal(HASH);
    expect(extractOpReturnSignal(`  OP_RETURN   ${HASH}  `)).to.equal(HASH);
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
    expect(extractOpReturnSignal(`OP_RETURN ${HASH.slice(0, 62)}`)).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too long)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH}ab`)).to.equal(null);
    expect(extractOpReturnSignal(`OP_RETURN ${HASH}ab`)).to.equal(null);
  });

  it('returns null for a non-hex payload of the right length', () => {
    const nonHex = 'z'.repeat(64);
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${nonHex}`)).to.equal(null);
    expect(extractOpReturnSignal(`OP_RETURN ${nonHex}`)).to.equal(null);
  });

  it('returns null for a multi-push OP_RETURN (more than one data element)', () => {
    expect(extractOpReturnSignal(`OP_RETURN OP_PUSHBYTES_32 ${HASH} OP_PUSHBYTES_4 deadbeef`)).to.equal(null);
    expect(extractOpReturnSignal(`OP_RETURN ${HASH.slice(0, 32)} ${HASH.slice(32)}`)).to.equal(null);
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

describe('extractOpReturnSignalFromHex', () => {
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';

  it('extracts the 32-byte hash from the exact NULL_DATA byte sequence', () => {
    expect(extractOpReturnSignalFromHex(`6a20${HASH}`)).to.equal(HASH);
  });

  it('lowercases uppercase script hex so it matches hex-keyed sidecar maps', () => {
    expect(extractOpReturnSignalFromHex(`6A20${HASH.toUpperCase()}`)).to.equal(HASH);
  });

  it('returns null for undefined or empty input', () => {
    expect(extractOpReturnSignalFromHex(undefined)).to.equal(null);
    expect(extractOpReturnSignalFromHex('')).to.equal(null);
    expect(extractOpReturnSignalFromHex('   ')).to.equal(null);
  });

  it('returns null for a bare OP_RETURN with no push', () => {
    expect(extractOpReturnSignalFromHex('6a')).to.equal(null);
  });

  it('returns null for a wrong-size push', () => {
    expect(extractOpReturnSignalFromHex('6a1f' + 'ab'.repeat(31))).to.equal(null);
    expect(extractOpReturnSignalFromHex('6a21' + 'ab'.repeat(33))).to.equal(null);
  });

  it('returns null for a non-minimal push of 32 bytes (PUSHDATA1)', () => {
    // `6a 4c 20 <32 bytes>` pushes 32 bytes but is not the canonical NULL_DATA
    // shape the encode side produces; only `6a20` is accepted.
    expect(extractOpReturnSignalFromHex(`6a4c20${HASH}`)).to.equal(null);
  });

  it('returns null when trailing bytes follow the push', () => {
    expect(extractOpReturnSignalFromHex(`6a20${HASH}ab`)).to.equal(null);
  });

  it('returns null for a non-hex payload', () => {
    expect(extractOpReturnSignalFromHex(`6a20${'z'.repeat(64)}`)).to.equal(null);
  });

  it('returns null for a non-OP_RETURN script', () => {
    expect(extractOpReturnSignalFromHex('0014751e76e8199196d454941c45d1b3a323f1433bd6')).to.equal(null);
  });
});

describe('BeaconSignalDiscovery.indexer', () => {
  const SIGNAL_HEX = 'ab'.repeat(32);
  const SIGNAL_SCRIPT_HEX = `6a20${SIGNAL_HEX}`;
  const SIGNAL_ASM = `OP_RETURN OP_PUSHBYTES_32 ${SIGNAL_HEX}`;
  const PAYMENT_PKH = '751e76e8199196d454941c45d1b3a323f1433bd6';
  const PAYMENT_SCRIPT_HEX = `0014${PAYMENT_PKH}`;

  const secret = new Uint8Array(32);
  secret[31] = 7;
  const address = p2wpkh(secp256k1.getPublicKey(secret, true), getNetwork('regtest')).address!;

  const otherSecret = new Uint8Array(32);
  otherSecret[31] = 8;
  const otherAddress = p2wpkh(secp256k1.getPublicKey(otherSecret, true), getNetwork('regtest')).address!;

  const service: BeaconService = {
    id              : 'did:btcr2:x#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${address}`
  };

  /** Esplora-shaped confirmed signal tx: spends FROM the beacon address, last vout is the OP_RETURN. */
  function esploraSignalTx(): Record<string, unknown> {
    return {
      txid   : 'ab'.repeat(32),
      vin    : [{
        txid    : 'ef'.repeat(32),
        vout    : 0,
        prevout : {
          scriptpubkey         : PAYMENT_SCRIPT_HEX,
          scriptpubkey_asm     : `OP_0 OP_PUSHBYTES_20 ${PAYMENT_PKH}`,
          scriptpubkey_type    : 'v0_p2wpkh',
          scriptpubkey_address : address,
          value                : 10000,
        },
      }],
      vout   : [
        {
          scriptpubkey         : PAYMENT_SCRIPT_HEX,
          scriptpubkey_asm     : `OP_0 OP_PUSHBYTES_20 ${PAYMENT_PKH}`,
          scriptpubkey_type    : 'v0_p2wpkh',
          scriptpubkey_address : address,
          value                : 5000,
        },
        {
          scriptpubkey      : SIGNAL_SCRIPT_HEX,
          scriptpubkey_asm  : SIGNAL_ASM,
          scriptpubkey_type : 'op_return',
          value             : 0,
        },
      ],
      status : { confirmed: true, block_height: 100, block_time: 1700000000 },
    };
  }

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
    const txs = [{ vin: [], vout: [{ scriptpubkey: SIGNAL_SCRIPT_HEX }], status: { confirmed: false } }];
    const signals = await BeaconSignalDiscovery.indexer([service], mockBitcoin(txs));
    expect(signals.get(service)).to.have.lengthOf(0);
  });

  it('accepts confirmed transactions and computes confirmations from the tip', async () => {
    const signals = await BeaconSignalDiscovery.indexer([service], mockBitcoin([esploraSignalTx()]));
    const found = signals.get(service)!;
    expect(found).to.have.lengthOf(1);
    expect(found[0].signalBytes).to.equal(SIGNAL_HEX);
    expect(found[0].blockMetadata.confirmations).to.equal(6);
    expect(found[0].blockMetadata.height).to.equal(100);
  });

  it('rejects a third-party payment TO the beacon address as a phantom signal', async () => {
    // The tx touches the beacon address only in its outputs; no input spends
    // from it, so the OP_RETURN final output must not surface as a signal.
    const phantom = esploraSignalTx() as {
      vin: Array<{ prevout: { scriptpubkey_address: string } }>;
    };
    phantom.vin[0].prevout.scriptpubkey_address = otherAddress;
    const signals = await BeaconSignalDiscovery.indexer([service], mockBitcoin([phantom]));
    expect(signals.get(service)).to.have.lengthOf(0);
  });

  it('rejects a confirmed signal-shaped tx with no prevout address on any input', async () => {
    const tx = esploraSignalTx() as { vin: Array<{ prevout?: unknown }> };
    delete tx.vin[0].prevout;
    const signals = await BeaconSignalDiscovery.indexer([service], mockBitcoin([tx]));
    expect(signals.get(service)).to.have.lengthOf(0);
  });
});

describe('BeaconSignalDiscovery.fullnode', () => {
  const SIGNAL_HEX = 'cd'.repeat(32);
  const SIGNAL_SCRIPT_HEX = `6a20${SIGNAL_HEX}`;
  const PAYMENT_PKH = '751e76e8199196d454941c45d1b3a323f1433bd6';
  const PAYMENT_SCRIPT_HEX = `0014${PAYMENT_PKH}`;

  const secret = new Uint8Array(32);
  secret[31] = 9;
  const address = p2wpkh(secp256k1.getPublicKey(secret, true), getNetwork('regtest')).address!;

  const service: BeaconService = {
    id              : 'did:btcr2:x#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${address}`
  };

  /**
   * Fixtures copied from the shape of a real Bitcoin Core `getrawtransaction`
   * verbosity-2 response (and `getblock` verbosity 3 tx entries). Core's
   * `ScriptToAsmStr` renders a 32-byte OP_RETURN push as TWO tokens,
   * `OP_RETURN <64-hex>`, with no `OP_PUSHBYTES_32` token, and renders a p2wpkh
   * script as `0 <40-hex>`; every scriptPubKey carries the raw `hex` field
   */
  const CORE_FUNDING_TX = {
    hex      : '0200000001' + 'aa'.repeat(32),
    txid     : 'ef'.repeat(32),
    hash     : 'ef'.repeat(32),
    version  : 2,
    size     : 222,
    vsize    : 141,
    weight   : 561,
    locktime : 0,
    vin      : [{
      txid        : 'aa'.repeat(32),
      vout        : 0,
      scriptSig   : { asm: '', hex: '' },
      txinwitness : ['30'.repeat(71), '02' + 'bb'.repeat(32)],
      sequence    : 4294967293,
    }],
    vout     : [{
      value        : 0.0001,
      n            : 0,
      scriptPubKey : {
        asm     : `0 ${PAYMENT_PKH}`,
        desc    : `addr(${address})#mock`,
        hex     : PAYMENT_SCRIPT_HEX,
        address : address,
        type    : 'witness_v0_keyhash',
      },
    }],
  };

  function coreSpendTx(lastVout: unknown): Record<string, unknown> {
    return {
      txid : 'ab'.repeat(32),
      hash : 'ab'.repeat(32),
      vin  : [{
        txid        : CORE_FUNDING_TX.txid,
        vout        : 0,
        scriptSig   : { asm: '', hex: '' },
        txinwitness : ['30'.repeat(71), '02' + 'bb'.repeat(32)],
        sequence    : 4294967293,
        prevout     : {
          generated    : false,
          height       : 1,
          value        : 0.0001,
          scriptPubKey : CORE_FUNDING_TX.vout[0].scriptPubKey,
        },
      }],
      vout : [
        {
          value        : 0.00005,
          n            : 0,
          scriptPubKey : {
            asm     : `0 ${PAYMENT_PKH}`,
            desc    : `addr(${address})#mock`,
            hex     : PAYMENT_SCRIPT_HEX,
            address : address,
            type    : 'witness_v0_keyhash',
          },
        },
        lastVout,
      ],
    };
  }

  /** The OP_RETURN signal output exactly as Bitcoin Core reports it. */
  const CORE_SIGNAL_VOUT = {
    value        : 0,
    n            : 1,
    scriptPubKey : {
      asm  : `OP_RETURN ${SIGNAL_HEX}`,
      desc : `raw(${SIGNAL_SCRIPT_HEX})#mock`,
      hex  : SIGNAL_SCRIPT_HEX,
      type : 'nulldata',
    },
  };

  /**
   * Minimal RPC stub: two blocks. Block 1 contains `spendTx`, a transaction
   * whose input spends a prevout paying the beacon address. The prevout lookup
   * returns the funding tx (its output script is the beacon PAYMENT script,
   * never an OP_RETURN).
   */
  function mockFullnode(spendTx: unknown): BitcoinConnection {
    const blocks: Record<number, unknown> = {
      0 : { hash: '00'.repeat(32), height: 0, time: 1700000000, confirmations: 2, tx: [] },
      1 : { hash: '11'.repeat(32), height: 1, time: 1700000600, confirmations: 1, tx: [spendTx] },
    };
    return {
      rpc : {
        getBlockCount     : async () => 1,
        getBlock          : async ({ height }: { height: number }) => blocks[height],
        getRawTransaction : async () => CORE_FUNDING_TX,
      }
    } as unknown as BitcoinConnection;
  }

  it('discovers the signal on the spending transaction via the Core-dialect fixture', async () => {
    const signals = await BeaconSignalDiscovery.fullnode([service], mockFullnode(coreSpendTx(CORE_SIGNAL_VOUT)));
    const found = signals.get(service)!;
    expect(found).to.have.lengthOf(1);
    expect(found[0].signalBytes).to.equal(SIGNAL_HEX);
    expect(found[0].blockMetadata.height).to.equal(1);
  });

  it('finds no signal when the spending transaction carries no OP_RETURN', async () => {
    const spendTx = {
      txid : 'ab'.repeat(32),
      vin  : [{ txid: CORE_FUNDING_TX.txid, vout: 0 }],
      vout : [{
        value        : 0.00005,
        n            : 0,
        scriptPubKey : {
          asm     : `0 ${PAYMENT_PKH}`,
          hex     : PAYMENT_SCRIPT_HEX,
          address : address,
          type    : 'witness_v0_keyhash',
        },
      }],
    };
    const signals = await BeaconSignalDiscovery.fullnode([service], mockFullnode(spendTx));
    expect(signals.get(service)).to.have.lengthOf(0);
  });
});

/**
 * Fullnode/indexer agreement: the same logical transactions
 * fed through both discovery paths must yield the same discovered /
 * not-discovered result. The phantom-payment and Core-dialect cases cover the
 * two historical divergence bugs between the paths.
 */
describe('BeaconSignalDiscovery fullnode/indexer agreement', () => {
  const SIGNAL_HEX = 'be'.repeat(32);
  const SIGNAL_SCRIPT_HEX = `6a20${SIGNAL_HEX}`;
  const PAYMENT_PKH = '751e76e8199196d454941c45d1b3a323f1433bd6';
  const PAYMENT_SCRIPT_HEX = `0014${PAYMENT_PKH}`;

  const secret = new Uint8Array(32);
  secret[31] = 11;
  const address = p2wpkh(secp256k1.getPublicKey(secret, true), getNetwork('regtest')).address!;

  const otherSecret = new Uint8Array(32);
  otherSecret[31] = 12;
  const otherAddress = p2wpkh(secp256k1.getPublicKey(otherSecret, true), getNetwork('regtest')).address!;

  const service: BeaconService = {
    id              : 'did:btcr2:x#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${address}`
  };

  /** The logical signal tx as Esplora `/address/:address/txs` reports it. */
  function esploraTx(spenderAddress: string): Record<string, unknown> {
    return {
      txid   : 'ab'.repeat(32),
      vin    : [{
        txid    : 'ef'.repeat(32),
        vout    : 0,
        prevout : {
          scriptpubkey         : PAYMENT_SCRIPT_HEX,
          scriptpubkey_asm     : `OP_0 OP_PUSHBYTES_20 ${PAYMENT_PKH}`,
          scriptpubkey_type    : 'v0_p2wpkh',
          scriptpubkey_address : spenderAddress,
          value                : 10000,
        },
      }],
      vout   : [
        {
          scriptpubkey         : PAYMENT_SCRIPT_HEX,
          scriptpubkey_asm     : `OP_0 OP_PUSHBYTES_20 ${PAYMENT_PKH}`,
          scriptpubkey_type    : 'v0_p2wpkh',
          scriptpubkey_address : address,
          value                : 5000,
        },
        {
          scriptpubkey      : SIGNAL_SCRIPT_HEX,
          scriptpubkey_asm  : `OP_RETURN OP_PUSHBYTES_32 ${SIGNAL_HEX}`,
          scriptpubkey_type : 'op_return',
          value             : 0,
        },
      ],
      status : { confirmed: true, block_height: 100, block_time: 1700000000 },
    };
  }

  function mockIndexer(txs: Array<unknown>): BitcoinConnection {
    return {
      rest : {
        block   : { count: async () => 105 },
        address : { getTxs: async () => txs }
      }
    } as unknown as BitcoinConnection;
  }

  /** The same logical tx as Bitcoin Core reports it (getblock v3 + getrawtransaction v2). */
  function mockFullnode(spenderAddress: string): BitcoinConnection {
    const fundingTx = {
      txid : 'ef'.repeat(32),
      vout : [{
        value        : 0.0001,
        n            : 0,
        scriptPubKey : {
          asm     : `0 ${PAYMENT_PKH}`,
          hex     : PAYMENT_SCRIPT_HEX,
          address : spenderAddress,
          type    : 'witness_v0_keyhash',
        },
      }],
    };
    const spendTx = {
      txid : 'ab'.repeat(32),
      vin  : [{
        txid     : fundingTx.txid,
        vout     : 0,
        sequence : 4294967293,
        prevout  : {
          generated    : false,
          height       : 1,
          value        : 0.0001,
          scriptPubKey : fundingTx.vout[0].scriptPubKey,
        },
      }],
      vout : [
        {
          value        : 0.00005,
          n            : 0,
          scriptPubKey : {
            asm     : `0 ${PAYMENT_PKH}`,
            hex     : PAYMENT_SCRIPT_HEX,
            address : address,
            type    : 'witness_v0_keyhash',
          },
        },
        {
          value        : 0,
          n            : 1,
          scriptPubKey : {
            asm  : `OP_RETURN ${SIGNAL_HEX}`,
            hex  : SIGNAL_SCRIPT_HEX,
            type : 'nulldata',
          },
        },
      ],
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

  it('both paths discover the same logical signal tx', async () => {
    const indexerSignals = await BeaconSignalDiscovery.indexer(
      [service], mockIndexer([esploraTx(address)])
    );
    const fullnodeSignals = await BeaconSignalDiscovery.fullnode(
      [service], mockFullnode(address)
    );
    const fromIndexer = indexerSignals.get(service)!;
    const fromFullnode = fullnodeSignals.get(service)!;
    expect(fromIndexer).to.have.lengthOf(1);
    expect(fromFullnode).to.have.lengthOf(1);
    expect(fromIndexer[0].signalBytes).to.equal(SIGNAL_HEX);
    expect(fromFullnode[0].signalBytes).to.equal(SIGNAL_HEX);
  });

  it('both paths reject the same phantom third-party payment tx', async () => {
    // The tx pays TO the beacon address and carries a well-formed OP_RETURN
    // final output, but no input spends FROM the beacon address.
    const indexerSignals = await BeaconSignalDiscovery.indexer(
      [service], mockIndexer([esploraTx(otherAddress)])
    );
    const fullnodeSignals = await BeaconSignalDiscovery.fullnode(
      [service], mockFullnode(otherAddress)
    );
    expect(indexerSignals.get(service)).to.have.lengthOf(0);
    expect(fullnodeSignals.get(service)).to.have.lengthOf(0);
  });
});
