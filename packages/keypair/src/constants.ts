import { Bytes, HashHex } from '@did-btc1/common';
import { sha256 } from '@noble/hashes/sha2';

// Fixed public key header bytes per the Data Integrity BIP340 Cryptosuite spec: [0xe7, 0x01] / [231, 1]
export const BIP340_PUBLIC_KEY_MULTIBASE_PREFIX: Bytes = new Uint8Array([0xe7, 0x01]);

// Hash of the BIP-340 Multikey prefix
export const BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH: HashHex = Buffer.from(sha256(BIP340_PUBLIC_KEY_MULTIBASE_PREFIX)).toString('hex');

// Fixed secret key header bytes per the Data Integrity BIP340 Cryptosuite spec: [0x81, 0x26] / [129, 38]
export const BIP340_SECRET_KEY_MULTIBASE_PREFIX: Bytes = new Uint8Array([0x81, 0x26]);

// Hash of the BIP-340 Multikey prefix
export const BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH: HashHex = Buffer.from(sha256(BIP340_SECRET_KEY_MULTIBASE_PREFIX)).toString('hex');

// secp256k1 curve parameters
export const SECP256K1_CURVE = {
  // curve field prime
  P  : 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn,
  // curve group order
  N  : 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
  // curve coefficient 'a' in the equation y^2 = x^3 + ax + b
  a  : 0n,
  // curve coefficient 'b' in the equation y^2 = x^3 + ax + b
  b  : 7n,
  // generator point x-coordinate
  Gx : 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  // generator point y-coordinate
  Gy : 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
  // generator point
  G  : 0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
};