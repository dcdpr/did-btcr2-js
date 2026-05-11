import { decode } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2pkh, Transaction } from '@scure/btc-signer';
import { BitcoinConnection } from '../src/connection.js';

const bitcoin = BitcoinConnection.forNetwork('mutinynet');
const holderKeys = SchnorrKeyPair.fromSecret('42e72793956e39f459768e53c19c04cf316fed05ab38e62f2aa54580c0049621');
const holderP2PKHAddress = p2pkh(holderKeys.publicKey.compressed, bitcoin.data).address;


const utxos = await bitcoin.rest.address.getUtxos(holderP2PKHAddress);
const utxo = utxos[0];
console.log('utxo:', utxo);
const prevTx = await bitcoin.rest.transaction.getHex(utxo.txid);
console.log('prevTx:', prevTx);

const receiverKeys = SchnorrKeyPair.generate();
const receiverP2PKHAddress = p2pkh(receiverKeys.publicKey.compressed, bitcoin.data).address;
console.log('receiverP2PKHAddress:', receiverP2PKHAddress);

const tx = new Transaction();
tx.addInput({
  txid           : utxo.txid,
  index          : utxo.vout,
  nonWitnessUtxo : decode(prevTx, 'hex')
});
tx.addOutputAddress(receiverP2PKHAddress, BigInt(utxo.value), bitcoin.data);
tx.signIdx(holderKeys.secretKey.bytes, 0);
tx.finalize();
console.log('tx:', tx);
// const spentTx = await bitcoin.rest.transaction.send(tx.hex);
// console.log('spentTx:', spentTx);
