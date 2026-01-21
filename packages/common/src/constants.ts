import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { Bytes, HashHex } from './types.js';

export const OP_RETURN = 0x6a;
export const OP_PUSH32 = 0x20;
export const VALID_HRP = ['k', 'x'];
export const MULTIBASE_URI_PREFIX = 'urn:mb:';
export const INITIAL_BLOCK_REWARD = 50;
export const HALVING_INTERVAL = 150;
export const COINBASE_MATURITY_DELAY = 100;
export const DEFAULT_POLAR_CONFIG = {
  username           : 'polaruser',
  password           : 'polarpass',
  host               : 'http://127.0.0.1:18443',
  allowDefaultWallet : true,
  version            : '28.1.0'
};
export const DEFAULT_REST_CONFIG = { host: 'http://localhost:3000' };
export const DEFAULT_RPC_CONFIG = DEFAULT_POLAR_CONFIG;
export const DEFAULT_BLOCK_CONFIRMATIONS = 7;

/**
 * Load a default RPC config, allowing environment overrides to avoid hard-coding credentials/hosts in bundles.
 * @returns {typeof DEFAULT_POLAR_CONFIG} The RPC config.
 */
export function getDefaultRpcConfig(): typeof DEFAULT_POLAR_CONFIG {
  return {
    ...DEFAULT_POLAR_CONFIG,
    host     : process.env.BTCR2_RPC_HOST ?? DEFAULT_POLAR_CONFIG.host,
    username : process.env.BTCR2_RPC_USER ?? DEFAULT_POLAR_CONFIG.username,
    password : process.env.BTCR2_RPC_PASS ?? DEFAULT_POLAR_CONFIG.password,
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
// curve's field size
export const B256 = 2n ** 256n;
// curve's field prime
export const P = B256 - 0x1000003d1n;
// curve (group) order
export const N = B256 - 0x14551231950b75fc4402da1732fc9bebfn;
// base point x
export const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
// base point y
export const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
// curve parameters
export const a = 0n;
export const b = 7n;
export const p = P;
export const n = N;
export const CURVE = {
  p,
  n,
  a,
  b,
  Gx,
  Gy
};

export const W3C_DID_V1 = 'https://www.w3.org/ns/did/v1';
export const W3C_DID_V1_1 =  'https://www.w3.org/TR/did-1.1';
export const W3C_DATA_INTEGRITY_V1 = 'https://w3id.org/security/data-integrity/v1';
export const W3C_DATA_INTEGRITY_V2 = 'https://w3id.org/security/data-integrity/v2';
export const W3C_SECURITY_V2 = 'https://w3id.org/security/v2';
export const BTCR2_METHOD_CONTEXT = 'https://btcr2.dev/context/v1';
export const W3C_ZCAP_V1 = 'https://w3id.org/zcap/v1';
export const W3C_JSONLD_PATCH_V1 = 'https://w3id.org/json-ld-patch/v1';
export const W3C_MULTIKEY_V1 = 'https://w3id.org/security/multikey/v1';
export const W3C_DID_RESOLUTION_V1 = 'https://w3id.org/did-resolution/v1';
export const CONTEXT_URL_MAP = {
  w3c : {
    did           : {
      v1   : W3C_DID_V1,
      v1_1 : W3C_DID_V1_1,
    },
    didresolution : {
      v1 : W3C_DID_RESOLUTION_V1,
    },
    security : {
      v2 : W3C_SECURITY_V2,
    },
    dataintegrity : {
      v1 : W3C_DATA_INTEGRITY_V1,
      v2 : W3C_DATA_INTEGRITY_V2,
    },
    zcap          : {
      v1 : W3C_ZCAP_V1,
    },
    jsonldpatch   : {
      v1 : W3C_JSONLD_PATCH_V1,
    },
    multikey      : {
      v1 : W3C_MULTIKEY_V1,
    },
  },
  btcr2 : {
    method : {
      v1 : BTCR2_METHOD_CONTEXT
    },
  },

};

export const BTCR2_DID_DOCUMENT_CONTEXT = [
  CONTEXT_URL_MAP.w3c.did.v1_1,
  CONTEXT_URL_MAP.btcr2.method.v1,
];

export const BTCR2_MULTIKEY_CONTEXT = [
  CONTEXT_URL_MAP.w3c.did.v1,
  CONTEXT_URL_MAP.w3c.multikey.v1
];

export const BTCR2_DID_UPDATE_PAYLOAD_CONTEXT = [
  CONTEXT_URL_MAP.btcr2.method.v1,
  CONTEXT_URL_MAP.w3c.security.v2,
  CONTEXT_URL_MAP.w3c.zcap.v1,
  CONTEXT_URL_MAP.w3c.jsonldpatch.v1,
];
