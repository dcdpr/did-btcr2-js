import { decode } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2pkh, Transaction } from '@scure/btc-signer';
import { BitcoinConnection } from '../src/connection.js';
import type { AddressUtxo } from '../src/types.js';

const bitcoin = BitcoinConnection.forNetwork('regtest');
const secretKey = decode('b8e9cdde0453f6608df2dde9f4b0000416537361d08b8981ea0187455113c259', 'hex');
const keys = SchnorrKeyPair.fromSecret(secretKey);
const sender = 'mh9sw9VFe82gNUBbuLXAkBhS42Z1c6JH8E';
const receiver = 'mv6FGwgr91ZzW4vT5GWEoXDPMk29j1LRpP';

const utxos = await bitcoin.rest.address.getUtxos(sender);
console.log('utxos:', utxos);
const utxo: AddressUtxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height)[0];
console.log('utxo:', utxo);

const prevTxHex = await bitcoin.rest.transaction.getHex(utxo.txid);
const senderScript = p2pkh(keys.publicKey.compressed, bitcoin.data).script;

const tx = new Transaction();
tx.addInput({
  txid           : utxo.txid,
  index          : utxo.vout,
  nonWitnessUtxo : decode(prevTxHex, 'hex'),
  witnessUtxo    : { amount: BigInt(utxo.value), script: senderScript },
});
tx.addOutputAddress(receiver, 1750n, bitcoin.data);
tx.signIdx(secretKey, 0);
tx.finalize();

console.log('signedSpendTx:', tx.hex);
const spentTx = await bitcoin.rest.transaction.send(tx.hex);
console.log('spentTx:', spentTx);
