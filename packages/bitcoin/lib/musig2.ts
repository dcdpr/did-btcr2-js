// musig2.ts
// TypeScript implementation of MuSig2 steps using @scure/btc-signer, bitcoinjs-lib, and tiny-secp256k1

import { randomBytes, createHash } from 'crypto';
import * as musig2 from '@scure/btc-signer/musig2.js';
import { schnorr } from '@noble/curves/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { hex } from '@scure/base';

async function runMusig2Example() {
  // Step 1: Key Generation
  const aliceSecret = randomBytes(32);
  const bobSecret = randomBytes(32);
  const carolSecret = randomBytes(32);

  const alicePub = musig2.IndividualPubkey(aliceSecret);
  const bobPub = musig2.IndividualPubkey(bobSecret);
  const carolPub = musig2.IndividualPubkey(carolSecret);

  console.log('Individual public keys:');
  console.log(hex.encode(alicePub), hex.encode(bobPub), hex.encode(carolPub));

  // Step 2: Key Aggregation
  const pubkeys = [alicePub, bobPub, carolPub];
  const sortedPubkeys = musig2.sortKeys(pubkeys);
  const keyAggContext = musig2.keyAggregate(sortedPubkeys);
  const aggPubkey = musig2.keyAggExport(keyAggContext);

  console.log('Aggregate public key:', Buffer.from(aggPubkey).toString('hex'));

  // Step 3: Nonce Generation (Round 1)
  const msg = createHash('sha256').update('MuSig2 example message').digest(); // 32-byte message digest

  const aliceNonces = musig2.nonceGen(alicePub, aliceSecret, aggPubkey, msg);
  const bobNonces = musig2.nonceGen(bobPub, bobSecret, aggPubkey, msg);
  const carolNonces = musig2.nonceGen(carolPub, carolSecret, aggPubkey, msg);

  // Step 4: Nonce Aggregation
  const aggNonces = musig2.nonceAggregate([
    aliceNonces.public,
    bobNonces.public,
    carolNonces.public,
  ]);

  // Step 5: Create Session
  const session = new musig2.Session(aggNonces, sortedPubkeys, msg);

  // Step 6: Partial Signature Generation (Round 2)
  const alicePartial = session.sign(aliceNonces.secret, aliceSecret);
  const bobPartial = session.sign(bobNonces.secret, bobSecret);
  const carolPartial = session.sign(carolNonces.secret, carolSecret);

  console.log('Partial signatures:',
    hex.encode(alicePartial),
    hex.encode(bobPartial),
    hex.encode(carolPartial)
  );

  // Step 7: Partial Signature Aggregation
  const finalSig = session.partialSigAgg([
    alicePartial,
    bobPartial,
    carolPartial,
  ]);

  console.log('Final aggregated signature (R||s):', Buffer.from(finalSig).toString('hex'));

  // Step 8: Verification
  const isValid = schnorr.verify(finalSig, msg, aggPubkey);
  console.log('Signature valid?', isValid);

  // (Optional) Build a Taproot address using the aggregate public key
  const { address: taprootAddress } = bitcoin.payments.p2tr({
    internalPubkey: Buffer.from(aggPubkey),
    network: bitcoin.networks.testnet,
  });
  console.log('Taproot address (M-of-N MuSig2):', taprootAddress);
}

// Execute example
runMusig2Example().catch((e) => console.error('Error in MuSig2 example:', e));
