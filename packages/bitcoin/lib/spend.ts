import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { Psbt } from 'bitcoinjs-lib';
import { BitcoinConnection } from '../src/connection.js';
import { AddressUtxo } from '../src/types.js';
import { decode } from '@did-btcr2/common';

const bitcoin = BitcoinConnection.forNetwork('regtest');
const secretKey = decode('b8e9cdde0453f6608df2dde9f4b0000416537361d08b8981ea0187455113c259', 'hex');
const keys = SchnorrKeyPair.fromSecret(secretKey);
const sender = 'mh9sw9VFe82gNUBbuLXAkBhS42Z1c6JH8E';
const receiver = 'mv6FGwgr91ZzW4vT5GWEoXDPMk29j1LRpP';
const utxos = await bitcoin.rest.address.getUtxos(sender);
console.log('utxos:', utxos);
const utxo: AddressUtxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height)[0];
console.log('utxo:', utxo);
const signer = {
  publicKey   : keys.publicKey.compressed,
  network     : bitcoin.data,
  signSchnorr : (hash: Uint8Array) => keys.secretKey.sign(hash),
  sign        : (hash: Uint8Array) => keys.secretKey.sign(hash, { scheme: 'ecdsa' }),
};
const {txid, vout} = utxo;
const prevTx = await bitcoin.rest.transaction.getHex(txid);
console.log('prevTx:', prevTx);
const input = {
  hash           : txid,
  index          : vout,
  nonWitnessUtxo : decode(prevTx, 'hex')
};
console.log('input:', input);
const signedSpendTx  = new Psbt({ network: bitcoin.data })
  .addInput(input)
  .addOutput({ address: receiver, value: BigInt(1750) })
  .signAllInputs(signer)
  .finalizeAllInputs()
  .extractTransaction()
  .toHex();
console.log('signedSpendTx:', signedSpendTx);

const spentTx = await bitcoin.rest.transaction.send(signedSpendTx);
console.log('spentTx:', spentTx);
