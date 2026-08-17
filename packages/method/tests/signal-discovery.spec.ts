import type { BitcoinConnection, BlockV3, RawTransactionRest, RawTransactionV2, Vin, Vout } from '@did-btcr2/bitcoin';
import { TXIN_WITNESS_COINBASE } from '@did-btcr2/bitcoin';
import { expect } from 'chai';
import type { BeaconService } from '../src/core/beacon/interfaces.js';
import { BeaconSignalDiscovery, extractOpReturnSignalHash } from '../src/core/beacon/signal-discovery.js';

/**
 * Beacon signal extraction from a serialized scriptPubKey.
 *
 * A beacon signal output is exactly `0x6a 0x20 <32 bytes>`: `OP_RETURN`, the
 * 32-byte push opcode, and the hash (see `op-return-script.spec.ts` for the
 * encode side, which pins those bytes). {@link extractOpReturnSignalHash} is the
 * strict decoder: it returns the 32-byte hash only for that exact script and
 * `null` for everything else, so a malformed or adversarial on-chain output
 * cannot be mistaken for a real signal during resolution.
 *
 * It decodes the script rather than a rendered `asm` string on purpose. `asm` is
 * a human-readable rendering and its dialect is backend-specific: Bitcoin Core
 * prints a data push as bare hex (`OP_RETURN <hash>`) while Esplora names the
 * push opcode (`OP_RETURN OP_PUSHBYTES_32 <hash>`). A token-shaped check written
 * against either dialect silently discards every signal produced by the other,
 * which is fail-open on the read path: a resolver sees no updates at all and
 * returns a stale document with no error. The serialized script is identical
 * across backends, so decoding it removes the dialect from the trust path.
 */
describe('extractOpReturnSignalHash', () => {
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';
  /** The canonical NULL_DATA beacon signal script: OP_RETURN + OP_PUSHBYTES_32 + hash. */
  const script = (hash: string) => `6a20${hash}`;

  it('extracts the 32-byte hash from a well-formed beacon signal output', () => {
    expect(extractOpReturnSignalHash(script(HASH))).to.equal(HASH);
  });

  it('decodes the same hash whatever asm dialect the backend renders', () => {
    // Bitcoin Core prints `OP_RETURN <hash>`, Esplora prints
    // `OP_RETURN OP_PUSHBYTES_32 <hash>`, and both serialize to this one script.
    expect(extractOpReturnSignalHash('6a207af2be9fcb371dfcc5465a74373d499c11b1f7bba47e0507fce892ea12ec1cd6'))
      .to.equal('7af2be9fcb371dfcc5465a74373d499c11b1f7bba47e0507fce892ea12ec1cd6');
  });

  it('lowercases an uppercase hex script so it matches hex-keyed sidecar maps', () => {
    expect(extractOpReturnSignalHash(script(HASH).toUpperCase())).to.equal(HASH);
  });

  it('tolerates surrounding whitespace', () => {
    expect(extractOpReturnSignalHash(`  ${script(HASH)}  `)).to.equal(HASH);
  });

  it('returns null for undefined or empty input', () => {
    expect(extractOpReturnSignalHash(undefined)).to.equal(null);
    expect(extractOpReturnSignalHash('')).to.equal(null);
    expect(extractOpReturnSignalHash('   ')).to.equal(null);
  });

  it('returns null for a bare OP_RETURN with no data push', () => {
    expect(extractOpReturnSignalHash('6a')).to.equal(null);
  });

  it('returns null for a wrong-size push opcode (not OP_PUSHBYTES_32)', () => {
    expect(extractOpReturnSignalHash('6a04deadbeef')).to.equal(null);
  });

  it('returns null for a non-canonical push of the right length (OP_PUSHDATA1)', () => {
    // `6a 4c 20 <32 bytes>` pushes the same data, but no beacon writes it and
    // Bitcoin Core rejects it as non-standard, so it is not a signal.
    expect(extractOpReturnSignalHash(`6a4c20${HASH}`)).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too short)', () => {
    expect(extractOpReturnSignalHash(`6a20${HASH.slice(0, 62)}`)).to.equal(null);
  });

  it('returns null when the payload is not exactly 32 bytes of hex (too long)', () => {
    expect(extractOpReturnSignalHash(`6a20${HASH}ab`)).to.equal(null);
  });

  it('returns null for a non-hex script', () => {
    expect(extractOpReturnSignalHash(`6a20${'z'.repeat(64)}`)).to.equal(null);
  });

  it('returns null for a multi-push OP_RETURN (more than one data element)', () => {
    // `6a 20 <32 bytes> 04 deadbeef`: a second push after the signal.
    expect(extractOpReturnSignalHash(`6a20${HASH}04deadbeef`)).to.equal(null);
  });

  it('returns null for a non-OP_RETURN script', () => {
    // A p2wpkh scriptPubKey: `0x00 0x14 <20 bytes>`, must never yield a signal.
    expect(extractOpReturnSignalHash('0014751e76e8199196d454941c45d1b3a323f1433bd6')).to.equal(null);
  });

  it('returns null when OP_RETURN is present but not the leading opcode', () => {
    // `OP_DUP OP_RETURN <push>`: a script that merely contains 0x6a is not a signal.
    expect(extractOpReturnSignalHash(`766a20${HASH}`)).to.equal(null);
  });

  it('returns null for an asm rendering passed in place of the script', () => {
    // The parameter changed from asm to the serialized script; the old input must
    // not decode by accident.
    expect(extractOpReturnSignalHash(`OP_RETURN OP_PUSHBYTES_32 ${HASH}`)).to.equal(null);
    expect(extractOpReturnSignalHash(`OP_RETURN ${HASH}`)).to.equal(null);
  });
});

/**
 * Beacon signal discovery over an address transaction listing.
 *
 * A Beacon Signal is a transaction that *spends from* a Beacon Address, but
 * `address.getTxs` returns every transaction touching the address in either
 * direction. {@link BeaconSignalDiscovery.indexer} therefore has to inspect the
 * input side before treating a transaction's OP_RETURN as a signal. Before that
 * check, anyone able to pay dust to a beacon address could attach an arbitrary
 * 32-byte OP_RETURN and have it discovered as a signal: the resolver then emits a
 * data need for an update hash that nobody can ever supply, which blocks
 * resolution of the DID for as long as that output stays on chain.
 */
describe('BeaconSignalDiscovery.indexer', () => {
  // Two unrelated regtest p2wpkh addresses: the beacon, and an outsider paying it.
  const BEACON = 'bcrt1ql3e9pgs3mmwuwrh95fecme0s0qtn2880hlwwpw';
  const OUTSIDER = 'bcrt1q2vfxp232rx0z9rzn0hay9jptagk8c86ddphpjv';
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';
  const OTHER_HASH = 'a'.repeat(64);
  const TIP = 110;
  const HEIGHT = 100;

  const beaconService = {
    id              : '#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${BEACON}`,
  } as BeaconService;

  /** Helper: an Esplora output paying an address. */
  function payment(address: string, value: number = 10_000): Vout {
    return {
      scriptpubkey         : `0014${'11'.repeat(20)}`,
      scriptpubkey_asm     : `OP_0 OP_PUSHBYTES_20 ${'11'.repeat(20)}`,
      scriptpubkey_type    : 'v0_p2wpkh',
      scriptpubkey_address : address,
      value,
    };
  }

  /** Helper: an Esplora OP_RETURN output carrying a beacon signal hash. */
  function signalOutput(hash: string): Vout {
    return {
      scriptpubkey      : `6a20${hash}`,
      scriptpubkey_asm  : `OP_RETURN OP_PUSHBYTES_32 ${hash}`,
      scriptpubkey_type : 'op_return',
      value             : 0,
    };
  }

  /** Helper: an Esplora input, with the spent output embedded as Esplora returns it. */
  function input(txid: string, vout: number, prevout: Vout | null): Vin {
    return {
      txid,
      vout,
      prevout,
      scriptsig     : '',
      scriptsig_asm : '',
      witness       : [],
      is_coinbase   : false,
      sequence      : 0xffffffff,
    };
  }

  /** Helper: a confirmed Esplora transaction. */
  function transaction(txid: string, vin: Array<Vin>, vout: Array<Vout>): RawTransactionRest {
    return {
      txid,
      version  : 2,
      locktime : 0,
      vin,
      vout,
      size     : 200,
      weight   : 800,
      fee      : 300,
      status   : { confirmed: true, block_height: HEIGHT, block_hash: 'b'.repeat(64), block_time: 1700000000 },
    };
  }

  /**
   * Minimal BitcoinConnection over a fixed address transaction listing. Every
   * `transaction.get` txid is recorded in `fetched` so a test can assert whether the
   * prevout fallback was taken, and is answered from `funding`.
   */
  function mockBitcoin(
    txs: Array<RawTransactionRest>,
    funding: Record<string, RawTransactionRest> = {},
    fetched: Array<string> = [],
  ): BitcoinConnection {
    return {
      rest : {
        block       : { count: async () => TIP },
        address     : { getTxs: async () => txs },
        transaction : {
          get : async (txid: string) => {
            fetched.push(txid);
            const tx = funding[txid];
            if(!tx) {
              throw new Error(`unexpected transaction fetch: ${txid}`);
            }
            return tx;
          },
        },
      },
    } as unknown as BitcoinConnection;
  }

  /** Helper: run discovery for the single beacon service under test. */
  async function discover(bitcoin: BitcoinConnection) {
    const signals = await BeaconSignalDiscovery.indexer([beaconService], bitcoin);
    return signals.get(beaconService) ?? [];
  }

  it('discovers a signal from a transaction that spends the beacon UTXO', async () => {
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, payment(BEACON, 100_000))],
      [payment(BEACON, 90_000), signalOutput(HASH)],
    );

    const signals = await discover(mockBitcoin([tx]));

    expect(signals).to.have.lengthOf(1);
    expect(signals[0].signalBytes).to.equal(HASH);
    expect(signals[0].blockMetadata).to.deep.equal({
      confirmations : TIP - HEIGHT + 1,
      height        : HEIGHT,
      time          : 1700000000,
    });
  });

  it('ignores an inbound payment to the beacon that carries a well-formed OP_RETURN', async () => {
    // The dust-payment denial of service: the outsider spends their own UTXO, pays dust
    // to the beacon, and attaches a random 32-byte hash. Nothing here is a beacon spend.
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, payment(OUTSIDER, 100_000))],
      [payment(BEACON, 546), signalOutput(OTHER_HASH)],
    );

    expect(await discover(mockBitcoin([tx]))).to.have.lengthOf(0);
  });

  it('keeps the real signal and drops the inbound payment from the same listing', async () => {
    const real = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, payment(BEACON, 100_000))],
      [payment(BEACON, 90_000), signalOutput(HASH)],
    );
    const inbound = transaction(
      'e'.repeat(64),
      [input('f'.repeat(64), 0, payment(OUTSIDER, 100_000))],
      [payment(BEACON, 546), signalOutput(OTHER_HASH)],
    );

    const signals = await discover(mockBitcoin([inbound, real]));

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('discovers a signal that spends the beacon UTXO without paying anything back to it', async () => {
    // A beacon spend need not return change to the beacon; the input side decides.
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, payment(BEACON, 100_000))],
      [payment(OUTSIDER, 90_000), signalOutput(HASH)],
    );

    expect(await discover(mockBitcoin([tx]))).to.have.lengthOf(1);
  });

  it('discovers a signal when a later input is the one spending from the beacon', async () => {
    const tx = transaction(
      'c'.repeat(64),
      [
        input('d'.repeat(64), 0, payment(OUTSIDER, 50_000)),
        input('e'.repeat(64), 1, payment(BEACON, 100_000)),
      ],
      [payment(BEACON, 140_000), signalOutput(HASH)],
    );

    expect(await discover(mockBitcoin([tx]))).to.have.lengthOf(1);
  });

  it('falls back to the funding transaction when the backend omits the prevout', async () => {
    const fundingTx = transaction('d'.repeat(64), [], [payment(OUTSIDER, 1_000), payment(BEACON, 100_000)]);
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 1, null)],
      [payment(BEACON, 90_000), signalOutput(HASH)],
    );
    const fetched: Array<string> = [];

    const signals = await discover(mockBitcoin([tx], { ['d'.repeat(64)]: fundingTx }, fetched));

    expect(signals).to.have.lengthOf(1);
    expect(fetched).to.deep.equal(['d'.repeat(64)]);
  });

  it('ignores an inbound payment whose fetched funding output belongs to someone else', async () => {
    const fundingTx = transaction('d'.repeat(64), [], [payment(OUTSIDER, 100_000)]);
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, null)],
      [payment(BEACON, 546), signalOutput(OTHER_HASH)],
    );
    const fetched: Array<string> = [];

    expect(await discover(mockBitcoin([tx], { ['d'.repeat(64)]: fundingTx }, fetched))).to.have.lengthOf(0);
    expect(fetched).to.deep.equal(['d'.repeat(64)]);
  });

  it('does not fetch funding transactions when the prevouts are embedded', async () => {
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, payment(BEACON, 100_000))],
      [payment(BEACON, 90_000), signalOutput(HASH)],
    );
    const fetched: Array<string> = [];

    await discover(mockBitcoin([tx], {}, fetched));

    expect(fetched).to.deep.equal([]);
  });

  it('ignores a coinbase transaction paying the beacon, without resolving its input', async () => {
    // A coinbase input spends no prior output, so it can never be a beacon spend and
    // must not be looked up as one either.
    const coinbaseInput: Vin = {
      ...input('0'.repeat(64), 0xffffffff, null),
      is_coinbase : true,
    };
    const tx = transaction('c'.repeat(64), [coinbaseInput], [payment(BEACON, 5_000_000), signalOutput(OTHER_HASH)]);
    const fetched: Array<string> = [];

    expect(await discover(mockBitcoin([tx], {}, fetched))).to.have.lengthOf(0);
    expect(fetched).to.deep.equal([]);
  });

  it('still ignores a beacon spend whose last output is not a well-formed signal', async () => {
    // The OP_RETURN shape check remains the first filter; the spend check does not widen it.
    const tx = transaction(
      'c'.repeat(64),
      [input('d'.repeat(64), 0, payment(BEACON, 100_000))],
      [signalOutput(HASH), payment(OUTSIDER, 90_000)],
    );

    expect(await discover(mockBitcoin([tx]))).to.have.lengthOf(0);
  });
});

/**
 * Beacon signal discovery over a full node.
 *
 * A Beacon Signal announces its update hash in the OP_RETURN output of the
 * transaction that *spends* a Beacon UTXO, so {@link BeaconSignalDiscovery.fullnode}
 * has to read that hash from the spending transaction's own last output: the output
 * being spent carries an ordinary locking script and never a NULL_DATA one. Before
 * this guard the scan parsed the *spent* output's script, which can never yield a
 * signal, and attributed whatever it found to a copied service object that no caller
 * holds a reference to. Both faults were silent and fail-open in the same direction:
 * every DID resolved through this path saw zero signals and returned the stale genesis
 * document with no error, so a rotated or revoked key still read as authorized.
 */
describe('BeaconSignalDiscovery.fullnode', () => {
  // RPC (Bitcoin Core) wire shapes, distinct from the Esplora shapes used by the indexer.
  type RpcVin = RawTransactionV2['vin'][number];
  type RpcVout = RawTransactionV2['vout'][number];

  // Two unrelated regtest beacons, and an outsider transacting alongside them.
  const BEACON = 'bcrt1ql3e9pgs3mmwuwrh95fecme0s0qtn2880hlwwpw';
  const BEACON_2 = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
  const OUTSIDER = 'bcrt1q2vfxp232rx0z9rzn0hay9jptagk8c86ddphpjv';
  const HASH = '570f177c65e64fb5cf61180b664cdddf09ab76153c2b192e22006e5b22a3917a';
  const OTHER_HASH = 'a'.repeat(64);
  const TIP = 2;

  const beaconService = {
    id              : '#beacon-0',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${BEACON}`,
  } as BeaconService;

  const beaconService2 = {
    id              : '#beacon-1',
    type            : 'SingletonBeacon',
    serviceEndpoint : `bitcoin:${BEACON_2}`,
  } as BeaconService;

  // The scan narrates itself on console.info, dumping every discovered transaction in
  // full; silence it for the duration so the suite output stays readable.
  const consoleInfo = console.info;

  beforeEach(() => {
    console.info = () => undefined;
  });

  afterEach(() => {
    console.info = consoleInfo;
  });

  /**
   * Helper: an RPC output paying an address. Bitcoin Core renders a data push as bare
   * hex, with no `OP_PUSHBYTES_n` token: the asm here is what `getblock` verbosity 3
   * actually returns, not the Esplora rendering used by the indexer fixtures above.
   */
  function rpcPayment(address: string, value: number = 10_000): RpcVout {
    return {
      value,
      n            : 0,
      scriptPubKey : {
        asm     : `OP_0 ${'11'.repeat(20)}`,
        hex     : `0014${'11'.repeat(20)}`,
        reqSigs : 1,
        type    : 'witness_v0_keyhash',
        address,
        desc    : `addr(${address})`,
      },
    };
  }

  /** Helper: an RPC OP_RETURN output carrying a beacon signal hash, in Core's dialect. */
  function rpcSignalOutput(hash: string): RpcVout {
    return {
      value        : 0,
      n            : 0,
      scriptPubKey : {
        asm     : `OP_RETURN ${hash}`,
        hex     : `6a20${hash}`,
        reqSigs : 0,
        type    : 'nulldata',
        desc    : `raw(6a20${hash})`,
      },
    };
  }

  /**
   * Helper: an RPC input spending a prior output. Bitcoin Core embeds the spent output
   * in `prevout` at verbosity 3, but the scan resolves the funding transaction over RPC
   * instead, so the fixtures leave the field off and the mock answers the lookup.
   */
  function rpcInput(txid: string, vout: number): RpcVin {
    return { txid, vout, sequence: 0xffffffff } as RpcVin;
  }

  /** Helper: an RPC transaction, with its outputs numbered by position. */
  function rpcTransaction(txid: string, vin: Array<RpcVin>, vout: Array<RpcVout>): RawTransactionV2 {
    return {
      txid,
      hash     : txid,
      hex      : '',
      version  : 2,
      locktime : 0,
      size     : 200,
      vsize    : 200,
      weight   : 800,
      vin,
      vout     : vout.map((output, n) => ({ ...output, n })),
    };
  }

  /** Helper: a block at a height, carrying transactions. */
  function rpcBlock(height: number, tx: Array<RawTransactionV2>): BlockV3 {
    return {
      height,
      tx,
      hash          : String(height).padStart(64, '0'),
      time          : 1700000000 + height,
      confirmations : TIP - height + 1,
    } as BlockV3;
  }

  /**
   * Minimal BitcoinConnection over a fixed chain, indexed by height. Every
   * `getRawTransaction` txid is recorded in `fetched` so a test can assert which prevouts
   * the scan bothered to resolve, and is answered from `funding`.
   */
  function mockBitcoin(
    blocks: Array<BlockV3>,
    funding: Record<string, RawTransactionV2> = {},
    fetched: Array<string> = [],
  ): BitcoinConnection {
    return {
      rpc : {
        getBlockCount     : async () => blocks.length - 1,
        getBlock          : async ({ height }: { height: number }) => blocks[height],
        getRawTransaction : async (txid: string) => {
          fetched.push(txid);
          const tx = funding[txid];
          if(!tx) {
            throw new Error(`unexpected transaction fetch: ${txid}`);
          }
          return tx;
        },
      },
    } as unknown as BitcoinConnection;
  }

  /** Helper: a one-transaction chain, with the beacon UTXO it spends as block 1. */
  function chain(tx: RawTransactionV2, funding: Array<RawTransactionV2>): Array<BlockV3> {
    return [rpcBlock(0, []), rpcBlock(1, funding), rpcBlock(2, [tx])];
  }

  /** Helper: run discovery over a chain and return the signals for the first beacon. */
  async function discover(bitcoin: BitcoinConnection, services: Array<BeaconService> = [beaconService]) {
    const signals = await BeaconSignalDiscovery.fullnode(services, bitcoin);
    return signals.get(services[0]) ?? [];
  }

  it('discovers a signal from a transaction that spends a beacon UTXO', async () => {
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcPayment(BEACON, 90_000), rpcSignalOutput(HASH)],
    );

    const signals = await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }));

    expect(signals).to.have.lengthOf(1);
    expect(signals[0].signalBytes).to.equal(HASH);
    expect(signals[0].tx.txid).to.equal('c'.repeat(64));
    expect(signals[0].blockMetadata).to.deep.equal({
      height        : 2,
      time          : 1700000002,
      confirmations : 1,
    });
  });

  it('discovers a signal whose asm is rendered in a foreign dialect', async () => {
    // A backend that names the push opcode (Esplora's rendering) serializes to the same
    // script, so the same transaction must be discovered either way. The reverse of this
    // case is what broke the path against a real node: Core omits the opcode name.
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const foreignDialect = rpcSignalOutput(HASH);
    foreignDialect.scriptPubKey.asm = `OP_RETURN OP_PUSHBYTES_32 ${HASH}`;
    const tx = rpcTransaction('c'.repeat(64), [rpcInput('d'.repeat(64), 0)], [foreignDialect]);

    const signals = await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }));

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('discovers a signal from an output that carries no asm at all', async () => {
    // The serialized script is the only field the decoder reads.
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const noAsm = rpcSignalOutput(HASH);
    noAsm.scriptPubKey.asm = undefined as unknown as string;
    const tx = rpcTransaction('c'.repeat(64), [rpcInput('d'.repeat(64), 0)], [noAsm]);

    const signals = await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }));

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('reads the signal hash from the spending transaction, not from the output it spends', async () => {
    // The spent output is given a NULL_DATA script *and* an address, which no real
    // output has: it exists purely so the two candidate scripts yield different hashes
    // and the test can prove which one is read.
    const spentOutput = { ...rpcSignalOutput(OTHER_HASH) };
    spentOutput.scriptPubKey.address = BEACON;
    const fundingTx = rpcTransaction('d'.repeat(64), [], [spentOutput]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcPayment(OUTSIDER, 90_000), rpcSignalOutput(HASH)],
    );

    const signals = await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }));

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('discovers signals across every block up to the chain tip', async () => {
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000), rpcPayment(BEACON, 100_000)]);
    const first = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcSignalOutput(HASH)],
    );
    const second = rpcTransaction(
      'e'.repeat(64),
      [rpcInput('d'.repeat(64), 1)],
      [rpcSignalOutput(OTHER_HASH)],
    );
    const blocks = [rpcBlock(0, []), rpcBlock(1, [fundingTx, first]), rpcBlock(2, [second])];

    const signals = await discover(mockBitcoin(blocks, { ['d'.repeat(64)]: fundingTx }));

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH, OTHER_HASH]);
    expect(signals.map(s => s.blockMetadata.height)).to.deep.equal([1, 2]);
  });

  it('emits one signal for a transaction that spends several of the same beacon UTXOs', async () => {
    // Two inputs, one beacon, one OP_RETURN: one signal. Counting per input would apply
    // the same update twice during resolution.
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 50_000), rpcPayment(BEACON, 60_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0), rpcInput('d'.repeat(64), 1)],
      [rpcPayment(BEACON, 100_000), rpcSignalOutput(HASH)],
    );

    const signals = await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }));

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('records the signal against each beacon service a transaction spends from', async () => {
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 50_000), rpcPayment(BEACON_2, 60_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0), rpcInput('d'.repeat(64), 1)],
      [rpcSignalOutput(HASH)],
    );

    const discovered = await BeaconSignalDiscovery.fullnode(
      [beaconService, beaconService2],
      mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }),
    );

    // Results are keyed by the caller's own service objects, not by copies of them.
    expect(discovered.get(beaconService)?.map(s => s.signalBytes)).to.deep.equal([HASH]);
    expect(discovered.get(beaconService2)?.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('resolves a beacon endpoint that carries BIP21 query parameters', async () => {
    const service = {
      id              : '#beacon-0',
      type            : 'SingletonBeacon',
      serviceEndpoint : `bitcoin:${BEACON}?amount=0.001`,
    } as BeaconService;
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcSignalOutput(HASH)],
    );

    const signals = await discover(
      mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }),
      [service],
    );

    expect(signals.map(s => s.signalBytes)).to.deep.equal([HASH]);
  });

  it('ignores a transaction with a well-formed OP_RETURN that spends from no beacon', async () => {
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(OUTSIDER, 100_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcPayment(BEACON, 546), rpcSignalOutput(OTHER_HASH)],
    );

    expect(await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx })))
      .to.have.lengthOf(0);
  });

  it('ignores a beacon spend whose last output is not a well-formed signal', async () => {
    // The OP_RETURN must be the last output; an earlier one is not the beacon's signal.
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcSignalOutput(HASH), rpcPayment(OUTSIDER, 90_000)],
    );

    expect(await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx })))
      .to.have.lengthOf(0);
  });

  it('does not resolve any prevout for a transaction whose last output is not a signal', async () => {
    // The shape check is free and the prevout lookup is a round trip per input, so an
    // ordinary payment must not cost one.
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcPayment(OUTSIDER, 90_000)],
    );
    const fetched: Array<string> = [];

    await discover(mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }, fetched));

    expect(fetched).to.deep.equal([]);
  });

  it('ignores a coinbase transaction paying a beacon, without resolving its input', async () => {
    const coinbaseInput = { coinbase: '02', sequence: 0xffffffff } as RpcVin;
    const tx = rpcTransaction(
      'c'.repeat(64),
      [coinbaseInput],
      [rpcPayment(BEACON, 5_000_000), rpcSignalOutput(OTHER_HASH)],
    );
    const fetched: Array<string> = [];

    expect(await discover(mockBitcoin(chain(tx, []), {}, fetched))).to.have.lengthOf(0);
    expect(fetched).to.deep.equal([]);
  });

  it('ignores an input carrying the coinbase witness marker', async () => {
    const witnessInput = {
      ...rpcInput('d'.repeat(64), 0),
      txinwitness : [TXIN_WITNESS_COINBASE],
    } as RpcVin;
    const tx = rpcTransaction(
      'c'.repeat(64),
      [witnessInput],
      [rpcPayment(BEACON, 5_000_000), rpcSignalOutput(OTHER_HASH)],
    );
    const fetched: Array<string> = [];

    expect(await discover(mockBitcoin(chain(tx, []), {}, fetched))).to.have.lengthOf(0);
    expect(fetched).to.deep.equal([]);
  });

  it('returns an empty signal list for a beacon that was never spent from', async () => {
    const fundingTx = rpcTransaction('d'.repeat(64), [], [rpcPayment(BEACON, 100_000)]);
    const tx = rpcTransaction(
      'c'.repeat(64),
      [rpcInput('d'.repeat(64), 0)],
      [rpcSignalOutput(HASH)],
    );

    const discovered = await BeaconSignalDiscovery.fullnode(
      [beaconService, beaconService2],
      mockBitcoin(chain(tx, [fundingTx]), { ['d'.repeat(64)]: fundingTx }),
    );

    expect(discovered.get(beaconService2)).to.deep.equal([]);
  });

  it('throws for a beacon service endpoint that is not a BIP21 bitcoin URI', async () => {
    const service = { id: '#beacon-0', type: 'SingletonBeacon', serviceEndpoint: BEACON } as BeaconService;

    try {
      await BeaconSignalDiscovery.fullnode([service], mockBitcoin([rpcBlock(0, [])]));
      expect.fail('expected a malformed beacon endpoint to throw');
    } catch (error: any) {
      expect(error.message).to.equal('Invalid Bitcoin URI format');
    }
  });
});
