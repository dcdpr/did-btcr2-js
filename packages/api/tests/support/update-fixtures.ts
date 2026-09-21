import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Btcr2DidDocument, NeedBeaconSignals } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Address, OutScript, p2wpkh, Transaction } from '@scure/btc-signer';

/** The network of every update fixture. */
export const network = getNetwork('regtest');

/** The txid that the mock connection returns for every broadcast. */
export const TXID = 'e'.repeat(64);

/**
 * Minimal BitcoinConnection that funds `beaconAddress` with one confirmed UTXO
 * and records broadcasts into `order` / UTXO lookups into `counters`. `utxosAt`
 * replaces the UTXO list of an address. It receives the confirmed UTXO and the
 * address. A test can return the UTXO altered, with others, not at all, or at
 * one address only.
 */
export function mockBitcoin(
  beaconAddress: string,
  order: string[],
  counters: { utxoCalls: number; sent: string[] },
  utxosAt: (funded: AddressUtxo, address: string) => AddressUtxo[] = funded => [funded],
): BitcoinConnection {
  const beaconScript = OutScript.encode(Address(network).decode(beaconAddress));
  const prevTx = new Transaction({ allowUnknownOutputs: true });
  prevTx.addOutput({ amount: 100_000n, script: beaconScript });
  prevTx.addInput({ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: new Uint8Array([0x00]) });
  const prevTxBytes = prevTx.toBytes();
  const utxo: AddressUtxo = { txid: prevTx.id, vout: 0, value: 100_000, status: { confirmed: true, block_height: 100 } as never };
  return {
    data : network,
    rest : {
      address     : { getUtxos: async (address: string) => { counters.utxoCalls += 1; return utxosAt(utxo, address); } },
      transaction : {
        getHex : async () => bytesToHex(prevTxBytes),
        send   : async (hex: string) => { counters.sent.push(hex); order.push('tx-broadcast'); return TXID; },
      },
    },
  } as unknown as BitcoinConnection;
}

/**
 * Resolve a deterministic DID to its genesis document (sans-I/O, empty signals)
 * and swap its services for a single beacon of `beaconType` at the address the
 * beacon signer's key can spend. The beacon signer is the DID signer, or a
 * separate key with `separateBeaconKey`. Returns everything an update() call needs.
 */
export function updateFixture(
  beaconType: 'SingletonBeacon' | 'CASBeacon' | 'SMTBeacon',
  options: { separateBeaconKey?: boolean } = {},
): {
  did: string;
  sourceDocument: Btcr2DidDocument;
  verificationMethodId: string;
  beaconId: string;
  signer: LocalSigner;
  beaconSigner: LocalSigner;
  beaconAddress: string;
} {
  const kp = SchnorrKeyPair.generate();
  const signer = new LocalSigner(kp.secretKey.bytes);
  const did = DidBtcr2.create(kp.publicKey.compressed, { idType: 'KEY', network: 'regtest' });

  const resolver = DidBtcr2.resolve(did);
  const state = resolver.resolve();
  if(state.status !== 'action-required') throw new Error('expected action-required');
  resolver.provide(state.needs[0] as NeedBeaconSignals, new Map());
  const final = resolver.resolve();
  if(final.status !== 'resolved') throw new Error('expected resolved');

  // A separate beacon key gives an address that the DID key cannot spend.
  const beaconSigner = options.separateBeaconKey
    ? new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes)
    : signer;
  const beaconAddress = p2wpkh(beaconSigner.publicKey, network).address!;
  const beaconId = `${did}#beacon-test`;
  const sourceDocument = JSON.parse(JSON.stringify(final.result.didDocument)) as Btcr2DidDocument;
  sourceDocument.service = [{
    id              : beaconId,
    type            : beaconType,
    serviceEndpoint : `bitcoin:${beaconAddress}`,
  }];

  return {
    did,
    sourceDocument,
    verificationMethodId : `${did}#initialKey`,
    beaconId,
    signer,
    beaconSigner,
    beaconAddress,
  };
}

/** Common update() args for a fixture, wired to fresh recorders. */
export function updateArgs(
  fixture: ReturnType<typeof updateFixture>,
  order: string[],
  counters: { utxoCalls: number; sent: string[] },
  utxosAt?: (funded: AddressUtxo, address: string) => AddressUtxo[],
) {
  return {
    sourceDocument       : fixture.sourceDocument,
    patches              : [],
    sourceVersionId      : 1,
    verificationMethodId : fixture.verificationMethodId,
    beaconId             : fixture.beaconId,
    signer               : fixture.signer,
    bitcoin              : mockBitcoin(fixture.beaconAddress, order, counters, utxosAt),
  };
}

/** Fresh recorders for the broadcast order and the connection counters. */
export function recorders(): { order: string[]; counters: { utxoCalls: number; sent: string[] } } {
  return { order: [], counters: { utxoCalls: 0, sent: [] } };
}
