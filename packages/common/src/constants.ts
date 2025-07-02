import { sha256 } from '@noble/hashes/sha2';
import { Bytes, HashHex } from './types.js';

export const ID_PLACEHOLDER_VALUE = 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
export const OP_RETURN = 0x6a;
export const OP_PUSH32 = 0x20;
export const VALID_HRP = ['k', 'x'];
export const MULTIBASE_URI_PREFIX = 'urn:mb:';

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
      v1   : 'https://www.w3.org/ns/did/v1',
      v1_1 : 'https://www.w3.org/TR/did-1.1',
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
    diddocument : {
      v1 : 'https://dcdpr.github.io/did-btcr2-js/ns/did-document/v1',
    },
    method : {
      v1 : 'https://btcr2.dev/context/v1'
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
  CONTEXT_URL_MAP.w3c.security.v2,
  CONTEXT_URL_MAP.w3c.zcap.v1,
  CONTEXT_URL_MAP.w3c.jsonldpatch.v1,
];