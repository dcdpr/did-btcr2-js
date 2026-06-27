import { decode } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2pkh, Transaction } from '@scure/btc-signer';
import { BitcoinConnection } from '../src/connection.js';

const bitcoin = new BitcoinConnection({ network: 'regtest', rest: { host: 'http://localhost:3000' } });
const holderKeys = SchnorrKeyPair.fromSecret('ce0739fae382a630f374f1cafcd2ed226d9b8870747bf49b391d10f352cc52d2');
const holderP2PKHAddress = p2pkh(holderKeys.publicKey.compressed, bitcoin.data).address;

const utxos = await bitcoin.rest.address.getUtxos(holderP2PKHAddress);
const utxo = utxos[0];
const prevTx = await bitcoin.rest.transaction.getHex(utxo.txid);

const receiverKeys = SchnorrKeyPair.fromSecret('61068f27837c1404e4501ea484fe4138a3ecbb577f3596a8903ca7dc6782c1b4');
const receiverP2PKHAddress = p2pkh(receiverKeys.publicKey.compressed, bitcoin.data).address;

const tx = new Transaction();
tx.addInput({
  txid           : utxo.txid,
  index          : utxo.vout,
  nonWitnessUtxo : decode(prevTx, 'hex'),
});
tx.addOutputAddress(receiverP2PKHAddress, BigInt(utxo.value) - BigInt(200), bitcoin.data);
tx.signIdx(holderKeys.secretKey.bytes, 0);
tx.finalize();

const spentTx = await bitcoin.rest.transaction.send(tx.hex);
console.log(
  `Holder P2PKH Address ${holderP2PKHAddress} sent ${utxo.value - 200} satoshis to` +
  `Receiver P2PKH Address ${receiverP2PKHAddress} in transaction ${spentTx}`
);
