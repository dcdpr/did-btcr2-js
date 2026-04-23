// /**
//  * One-off test: fetch raw bytes from an IPFS Helia node using the
//  * IpfsCasExecutor. Times the round-trip to measure latency.
//  *
//  * Usage: bun lib/test-ipfs-helia.ts
//  */
// import { decode as decodeHash } from '@did-btcr2/common';
// import { createHelia } from 'helia';
// import { CID } from 'multiformats/cid';
// import * as raw from 'multiformats/codecs/raw';
// import { create as createDigest } from 'multiformats/hashes/digest';
// import { sha256 } from 'multiformats/hashes/sha2';
// // Hash from a real did:btcr2 resolution failure — the signed update the
// // resolver needed but couldn't fetch without CAS.
// const hexHash = 'be822c3da87dfa89ccac1dd552c6f93281e74f3cda257734393b5041d0c0388a';

// // Convert hex hash to base64url (executor expects base64url)
// const hashBytes = decodeHash(hexHash, 'hex');
// const base64url = Buffer.from(hashBytes).toString('base64url');

// // Show the CID that will be requested
// const cid = CID.create(1, raw.code, createDigest(sha256.code, hashBytes));
// console.log(`Hex hash:   ${hexHash}`);
// console.log(`Base64url:  ${base64url}`);
// console.log(`CID:        ${cid.toString()}`);
// console.log();

/**
 * One-off test: fetch raw bytes from an IPFS Helia node using the
 * IpfsCasExecutor. Times the round-trip to measure latency.
 *
 * Usage: bun lib/test-ipfs-helia.ts
 */
import { canonicalize, encode as encodeHash, hash } from '@did-btcr2/common';
import { createHelia } from 'helia';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from 'multiformats/hashes/sha2';
// Hash from a real did:btcr2 resolution failure — the signed update the
// resolver needed but couldn't fetch without CAS.
const update = {'@context': ['https://btcr2.dev/context/v1','https://w3id.org/json-ld-patch/v1','https://w3id.org/zcap/v1','https://w3id.org/security/data-integrity/v2'],'patch': [{'op': 'add','path': '/service/3','value': {'id': '#didcomm','type': 'DIDCommMessaging','serviceEndpoint': 'http://example.com/didcomm/'}}],'sourceHash': 'osaUrsl3XhLlm-J4hKrqmxP6G0y9sfqseaF4HPPUe_8','targetHash': 'eS9wA7p1qiQHGEuyz4swjnZNnFz9VkBSPff6i6XeP_M','targetVersionId': 2,'proof': {'type': 'DataIntegrityProof','cryptosuite': 'bip340-jcs-2025','verificationMethod': 'did:btcr2:k1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk#initialKey','proofPurpose': 'capabilityInvocation','capability': 'urn:zcap:root:did%3Abtcr2%3Ak1q5p7drc8y5hhmvs2nncyuq73ts98arnqv5ce446vwydafuu2mp9rp6szethjk','capabilityAction': 'Write','proofValue': 'z5DhhjMk8gXULWNKRwqJqGbqZF94ov7zjKS6YkaCGxoDa2f3WT3zprMUc1p62w2cRRdkNAhR4rfGJpxZZFfHsdrJB'}};
const canonicalUpdateHash = hash(canonicalize(update));
const canonicalUpdateHashHex = encodeHash(canonicalUpdateHash, 'hex');
const canonicalUpdateHashBase64url = encodeHash(canonicalUpdateHash);

// Show the CID that will be requested
const cid = CID.create(1, raw.code, createDigest(sha256.code, canonicalUpdateHash));
console.log(`Hex hash:   ${canonicalUpdateHashHex}`);
console.log(`Base64url:  ${canonicalUpdateHashBase64url}`);
console.log(`CID:        ${cid.toString()}`);
console.log();

console.log('Creating helia...');
const helia = await createHelia();
const result = await helia.blockstore.put(cid, Buffer.from(canonicalize(update)));
console.log('result', result);
await helia.stop();