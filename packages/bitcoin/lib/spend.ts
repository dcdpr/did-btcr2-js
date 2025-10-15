import { Psbt } from 'bitcoinjs-lib';
import { KeyManager } from '../../method/src/index.js';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bitcoin } from '../src/bitcoin.js';
import { AddressUtxo } from '../src/types.js';

const [id = '#initialP2PKH', controller = 'did:btcr2:k1qyp3al8fedye95ueca9ezrmcm49vhur3zhze49wlgyfzdl5qk4dgltccfavpw'] = process.argv.slice(2);

if(!controller) {
  throw new Error('Controller is required as the second argument.');
}
const secretKey = Buffer.fromHex('4359bb2996ca9edb3566765cd8c5d56ee402399ec541f489273eb320f29f4ae8');
const keys = new SchnorrKeyPair({ secretKey });
const keyUri = KeyManager.computeKeyUri(id, controller);
await KeyManager.initialize(keys, keyUri);
const multikey = await KeyManager.getKeyPair();
if (!multikey) {
  throw new Error('Multikey not found.');
}

const sender = 'mv6FGwgr91ZzW4vT5GWEoXDPMk29j1LRpP';
const receiver = 'n1twwQ99uF11FVsqSjqYfkBwxXonYXgSm2';
const utxos = await bitcoin.network.rest.address.getUtxos(sender);
console.log('utxos:', utxos);
const utxo: AddressUtxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height)[0];
console.log('utxo:', utxo);
const signer = {
  publicKey   : multikey.publicKey.compressed,
  network     : bitcoin.network.data,
  signSchnorr : (hash: Uint8Array) => multikey.sign(hash),
  sign        : (hash: Uint8Array) => multikey.sign(hash, { scheme: 'ecdsa' }),
};
const {txid, vout} = utxo;
const prevTx = await bitcoin.network.rest.transaction.getHex(txid);
console.log('prevTx:', prevTx);
const input = {
  hash           : txid,
  index          : vout,
  nonWitnessUtxo : Buffer.from(prevTx, 'hex')
};
console.log('input:', input);
const signedSpendTx  = new Psbt({ network: bitcoin.network.data })
  .addInput(input)
  .addOutput({ address: receiver, value: BigInt(1750) - BigInt(20) })
  .signAllInputs(signer)
  .finalizeAllInputs()
  .extractTransaction()
  .toHex();
console.log('signedSpendTx:', signedSpendTx);

const spentTx = await bitcoin.network.rest.transaction.send(signedSpendTx);
console.log('spentTx:', spentTx);