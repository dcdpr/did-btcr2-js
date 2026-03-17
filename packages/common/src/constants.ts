import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Bytes, HashHex } from './types.js';

export const OP_RETURN = 0x6a;
export const OP_PUSH32 = 0x20;
export const INITIAL_BLOCK_REWARD = 50;
export const HALVING_INTERVAL = 150;
export const COINBASE_MATURITY_DELAY = 100;
export const DEFAULT_REST_CONFIG = { host: 'http://localhost:3000' };
export const DEFAULT_BLOCK_CONFIRMATIONS = 7;

const POLAR_DEFAULTS = {
  username           : 'polaruser',
  password           : 'polarpass',
  host               : 'http://127.0.0.1:18443',
  allowDefaultWallet : true,
  version            : '28.1.0'
};

export type RpcConfig = typeof POLAR_DEFAULTS;

/**
 * Load a default RPC config, allowing environment overrides to avoid hard-coding credentials/hosts in bundles.
 * @returns {RpcConfig} The RPC config.
 */
export function getDefaultRpcConfig(): RpcConfig {
  return {
    ...POLAR_DEFAULTS,
    host     : process.env.BTCR2_RPC_HOST ?? POLAR_DEFAULTS.host,
    username : process.env.BTCR2_RPC_USER ?? POLAR_DEFAULTS.username,
    password : process.env.BTCR2_RPC_PASS ?? POLAR_DEFAULTS.password,
  };
}

// Fixed public key header bytes per the Data Integrity BIP340 Cryptosuite spec: [0xe7, 0x01] / [231, 1]
export const BIP340_PUBLIC_KEY_MULTIBASE_PREFIX: Bytes = new Uint8Array([0xe7, 0x01]);
// Hash of the BIP-340 Multikey prefix
export const BIP340_PUBLIC_KEY_MULTIBASE_PREFIX_HASH: HashHex = bytesToHex(sha256(BIP340_PUBLIC_KEY_MULTIBASE_PREFIX));
// Fixed secret key header bytes per the Data Integrity BIP340 Cryptosuite spec: [0x81, 0x26] / [129, 38]
export const BIP340_SECRET_KEY_MULTIBASE_PREFIX: Bytes = new Uint8Array([0x81, 0x26]);
// Hash of the BIP-340 Multikey prefix
export const BIP340_SECRET_KEY_MULTIBASE_PREFIX_HASH: HashHex = bytesToHex(sha256(BIP340_SECRET_KEY_MULTIBASE_PREFIX));

// secp256k1 curve parameters — only CURVE is exported
const B256 = 2n ** 256n;
export const CURVE = {
  p  : B256 - 0x1000003d1n,
  n  : B256 - 0x14551231950b75fc4402da1732fc9bebfn,
  a  : 0n,
  b  : 7n,
  Gx : 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  Gy : 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

export const CONTEXT_URL_MAP = {
  w3c : {
    did           : {
      v1   : 'https://www.w3.org/ns/did/v1',
      v1_1 : 'https://www.w3.org/ns/did/v1.1',
    },
    didresolution : {
      v1 : 'https://w3id.org/did-resolution/v1',
    },
    security : {
      v2 : 'https://w3id.org/security/v2',
    },
    dataintegrity : {
      v1 : 'https://w3id.org/security/data-integrity/v1',
      v2 : 'https://w3id.org/security/data-integrity/v2',
    },
    zcap          : {
      v1 : 'https://w3id.org/zcap/v1',
    },
    jsonldpatch   : {
      v1 : 'https://w3id.org/json-ld-patch/v1',
    },
    multikey      : {
      v1 : 'https://w3id.org/security/multikey/v1',
    },
  },
  btcr2 : {
    method : {
      v1 : 'https://btcr2.dev/context/v1'
    },
  },
};

export const BTCR2_DID_DOCUMENT_CONTEXT = [
  'https://www.w3.org/ns/did/v1.1',
  'https://btcr2.dev/context/v1',
];