import * as secp256k1 from '@noble/secp256k1';
import { HDKey } from '@scure/bip32';
import { bech32, base64url } from '@scure/base';
import { generateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { Jwk, LocalKeyManager } from '@web5/crypto';
import { DidDocument } from '@web5/dids';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';

import * as ecc from 'tiny-secp256k1';
initEccLib(ecc);

function bigintToBuffer(value: bigint): Buffer {
  const hex = value.toString(16).padStart(64, '0'); // Ensure 64 hex characters (32 bytes)
  return Buffer.from(hex, 'hex');
}
const keyManager = new LocalKeyManager();
// Generate random key material.
const network = networks.testnet;
const mnemonic = generateMnemonic(wordlist, 128);
const seed = await mnemonicToSeed(mnemonic);
const hdkey = HDKey.fromMasterSeed(seed).derive(`m/44'/0'/0'/0'/0'`);
// Ensure publicKey is valid
if (!(hdkey.publicKey && hdkey.privateKey)) {
  throw new Error('Failed to derive public key');
}
const publicKeyBuffer = hdkey.publicKey;
const bech32EncodedPublicKey = bech32.encode('tb', bech32.toWords(publicKeyBuffer));
const { x, y } = secp256k1.ProjectivePoint.fromHex(hdkey.publicKey) ?? {};
const key = {
  kty : 'EC',
  crv : 'secp256k1',
  x   : base64url.encode(bigintToBuffer(x)),
  y   : base64url.encode(bigintToBuffer(y)),
  d   : base64url.encode(Buffer.from(hdkey.privateKey))
} as Jwk;
const keyUri = await keyManager.importKey({ key });
const did = `did:btcr2:testnet:k1${bech32EncodedPublicKey}`;

const didDocument: DidDocument = {
  '@context'           : [
    'https://www.w3.org/ns/did/v1',
    'https://github.com/dcdpr/did-btcr2'
  ],
  id                 : did,
  verificationMethod : [{
    id           : '#initialKey',
    type         : 'JsonWebKey',
    controller   : did,
    publicKeyJwk : key
  }],
  authentication       : ['#initialKey'],
  assertionMethod      : ['#initialKey'],
  capabilityInvocation : ['#initialKey'],
  capabilityDelegation : ['#initialKey'],
  service              : [
    {
      id              : '#initial_p2pkh',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:' + payments.p2pkh({ pubkey: publicKeyBuffer, network }).address
    },
    {
      id              : '#initial_p2wpkh',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:' + payments.p2wpkh({ pubkey: publicKeyBuffer, network }).address
    },
    {
      id              : '#initial_p2tr',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:' + payments.p2tr({ internalPubkey: publicKeyBuffer.slice(1, 33), network }).address
    }
  ]
};
console.log('keyUri:', keyUri);
console.log('mnemonic:', mnemonic);
console.log('didDocument:', didDocument);

