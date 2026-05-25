# @did-btcr2/smt

Sparse Merkle Tree for [did:btcr2](https://dcdpr.github.io/did-btcr2/).

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package implements the [zero-hash Sparse Merkle Tree (SMT)](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification) defined by the did:btcr2 specification. It powers the `@did-btcr2/method` aggregate SMT beacon: the mechanism that lets many DID updates share a single on-chain transaction while each DID controller can still prove, with a compact inclusion or non-inclusion proof, exactly which update (if any) was aggregated for them in a given epoch.

The tree operates over a 256-bit key space (a DID maps to a leaf at index `SHA-256(did)`). It is a full-depth (256-level) tree: empty subtrees contribute a precomputed "zero" subtree hash and every level is hashed. Proofs carry a `collapsed` bitmap marking which sibling levels are empty, so only the non-empty siblings travel in the proof, keeping proof size proportional to the number of populated leaves rather than the depth of the tree.

It depends only on audited primitives: [`@noble/hashes`](https://github.com/paulmillr/noble-hashes), [`@noble/curves`](https://github.com/paulmillr/noble-curves), and [`@scure/base`](https://github.com/paulmillr/scure-base). It is browser-compatible: no Node.js built-ins, no native bindings.

## Install

```bash
npm install @did-btcr2/smt
```

Or with pnpm:

```bash
pnpm add @did-btcr2/smt
```

Requires Node.js >= 22. Ships ESM and CommonJS builds plus type declarations.

## Quick start

`BTCR2MerkleTree` is the high-level entry point. It handles index computation, leaf-hash construction, and proof serialization for did:btcr2.

```typescript
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import { randomBytes } from '@noble/hashes/utils';

const tree = new BTCR2MerkleTree();

tree.addEntries([
  {
    did          : 'did:btcr2:k1qexample1',
    nonce        : randomBytes(32),
    signedUpdate : new Uint8Array(/* canonical bytes of a signed BTCR2 update */),
  },
  {
    did   : 'did:btcr2:k1qexample2',
    nonce : randomBytes(32),
    // no signedUpdate: this DID has no update this epoch (non-inclusion)
  },
]);

tree.finalize();

tree.rootHash;                            // Uint8Array(32) — anchor this in the beacon OP_RETURN
const proof = tree.proof('did:btcr2:k1qexample1');
// SerializedSMTProof: { id, collapsed, hashes, nonce?, updateId? } — all base64url, no padding
```

`addEntries()` may be called multiple times before `finalize()`. Adding two DIDs that collide on the same index throws. Call `reset()` to drop the computed root/proofs while keeping the entries.

## Verifying a proof

A relying party verifies a serialized proof against the on-chain root using only the DID, the proof, and the canonical update bytes:

```typescript
import {
  verifySerializedProof,
  didToIndex,
  inclusionLeafHash,
  nonInclusionLeafHash,
} from '@did-btcr2/smt';

const index = didToIndex(did);

// Inclusion: the controller has the signed update bytes the proof commits to.
const candidate = inclusionLeafHash(nonce, signedUpdateBytes);
// Non-inclusion: no update this epoch.
// const candidate = nonInclusionLeafHash(nonce);

const ok = verifySerializedProof(proof, index, candidate); // boolean
```

`verifySerializedProof` is a thin wrapper over the spec's verification algorithm: it deserializes the proof and calls `verifyZeroHash` internally.

## Wire format

Serialized proofs follow the did:btcr2 [SMT Proof data structure](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof). Every SHA-256 field is "base64url" [RFC 4648] encoded **without padding** (43 characters each), and `collapsed` is the 256-bit empty-sibling bitmap encoded the same way:

```json
{
  "id":        "q1H_iaYG0Oq6gbrycYL-r7FjUsJLnIpHDn49TLeONNA",
  "nonce":     "99jndCBWHpZfmObXlIvRGHaPMgoQKXIETdD4H-XqryE",
  "updateId":  "njYNViJq2OmhSw1fLfARPCj12RY3VXKGWdS3-7OQ2BE",
  "collapsed": "v_________________________________________8",
  "hashes":    [ "8JWXL7chPKJXwg-i9O1EFTHan_oOO_RmglDpu_ugax0" ]
}
```

- `id` is the SMT root (what the beacon transaction commits to).
- `nonce` and `updateId` are optional metadata. `updateId` is `SHA-256(signedUpdate)`; it is absent on a non-inclusion proof.
- In `collapsed`, bit `i` set means the sibling at tree level `i` is empty (the verifier substitutes the precomputed `cachedZero[255 - i]`); bit `i` clear means the next entry in `hashes` is the sibling at that level. Level `i = 255` is the leaf level, `i = 0` is the root level.

## Low-level: zero-hash API

If you need direct control over indexes and leaf hashes (outside the did:btcr2 leaf convention), use the zero-hash functions that `BTCR2MerkleTree` is built on:

```typescript
import {
  zeroHashRoot,
  generateZeroHashProof,
  verifyZeroHash,
  serializeProof,
  didToIndex,
  inclusionLeafHash,
} from '@did-btcr2/smt';

const leaves = [
  { index: didToIndex('did:btcr2:k1qexample1'), leaf: inclusionLeafHash(nonce1, update1) },
  { index: didToIndex('did:btcr2:k1qexample2'), leaf: inclusionLeafHash(nonce2, update2) },
];

const root  = zeroHashRoot(leaves);                       // Uint8Array(32)
const proof = generateZeroHashProof(leaves, leaves[0].index); // { collapsed: bigint, hashes: Uint8Array[] }

const ok = verifyZeroHash(proof.collapsed, proof.hashes, leaves[0].index, leaves[0].leaf, root);

// Serialize to the did:btcr2 wire format:
const wire = serializeProof(root, proof, { nonce: nonce1, updateId });
```

## API

### did:btcr2

| Export | Description |
|---|---|
| `BTCR2MerkleTree` | High-level aggregate-beacon tree. Lifecycle: `addEntries()` to `finalize()` to `proof(did)`. |
| `TreeEntry` | Entry shape: `{ did, nonce, signedUpdate? }`. Omit `signedUpdate` for a non-inclusion entry. |
| `SerializedSMTProof` | Wire proof: `{ id, collapsed, hashes, nonce?, updateId? }`, all base64url no-pad. |
| `didToIndex(did)` | Leaf index: `bigint(SHA-256(did))`, big-endian. |
| `inclusionLeafHash(nonce, signedUpdate)` | `SHA-256(SHA-256(nonce) \|\| SHA-256(signedUpdate))`. |
| `nonInclusionLeafHash(nonce)` | `SHA-256(SHA-256(nonce))`. |
| `serializeProof(rootHash, proof, opts?)` | Convert a `ZeroHashProof` (plus optional `nonce`/`updateId`) to `SerializedSMTProof`. |
| `deserializeProof(serialized)` | Parse a wire proof back to `{ rootHash, collapsed, hashes, nonce?, updateId? }`. |
| `verifySerializedProof(serialized, index, candidateHash)` | Verify a wire proof in one step. |

### Zero-hash core

| Export | Description |
|---|---|
| `zeroHashRoot(leaves)` | Compute the root over `ZeroHashEntry[]`. |
| `generateZeroHashProof(leaves, index)` | Inclusion proof `{ collapsed, hashes }` for one index. |
| `verifyZeroHash(collapsed, hashes, index, candidate, root)` | The spec's verification algorithm (MSB-first walk). |
| `CACHED_ZERO` | Precomputed empty-subtree hashes by height, indices `[0, 256]`. |
| `ZeroHashEntry` | `{ index: bigint, leaf: Uint8Array }`. |
| `ZeroHashProof` | `{ collapsed: bigint, hashes: Uint8Array[] }`. |

### Hash utilities

| Export | Description |
|---|---|
| `blockHash(...blocks)` | `SHA-256` of concatenated `Uint8Array` blocks (`@noble/hashes`). |
| `hashToBase64Url(hash)` / `base64UrlToHash(s)` | 32 bytes to/from base64url no-pad (the wire encoding). |
| `hashToHex(hash)` / `hexToHash(s)` | 32 bytes to/from 64-char lowercase hex. |
| `hashToBigInt(hash)` / `bigIntToHash(value)` | 32 bytes to/from a big-endian 256-bit bigint. |
| `hashesEqual(a, b)` | Constant-time comparison via `@noble/curves` `equalBytes`. |

Base64 (standard, padded) and hex-bigint helpers (`hashToBase64`, `base64ToHash`, `bigIntToHex`, `hexToBigInt`, ...) are also exported for interop.

### Constants

| Export | Value |
|---|---|
| `HASH_BYTE_LENGTH` | `32` |
| `HASH_BIT_LENGTH` | `256` |
| `HASH_HEX_LENGTH` | `64` |
| `NULL_HASH` | 32 zero bytes |

## How it works

A naive Merkle tree over 256-bit keys would have 2^256 leaves. A Sparse Merkle Tree makes this tractable because the vast majority of those leaves are empty and therefore identical at every level. This implementation follows the did:btcr2 **zero-hash** model:

**Precomputed empty subtrees.** `cachedZero` is seeded with 32 zero bytes; `cachedZero[h] = SHA-256(z \|\| z)` applied `h + 1` times. An empty subtree at any height contributes its `cachedZero[height]` value, so empty regions cost nothing to store and one lookup to hash.

**Full-depth hashing.** Unlike a path-compressing SMT, every one of the 256 levels is hashed: a non-leaf node is `SHA-256(left \|\| right)`, where an empty child is its `cachedZero` value. This makes the root a function purely of the populated leaves and their indexes, and it is what the spec's verifier reconstructs.

**Privacy-preserving leaves.** Each leaf folds in a per-update 32-byte nonce. An inclusion leaf is `SHA-256(SHA-256(nonce) \|\| SHA-256(update))`; a non-inclusion leaf is `SHA-256(SHA-256(nonce))`. Without the nonce, an observer cannot tell whether a given DID has an update in a given epoch, nor link a leaf to its update.

**Compact proofs.** A proof is the `collapsed` bitmap plus only the non-empty sibling hashes. The verifier walks the path most-significant-bit first (`n` from 0 to 255, level `i = 255 - n`), taking `cachedZero[n]` wherever `collapsed` bit `i` is set and the next supplied sibling otherwise, combining by the index bit at level `i`, and finally checks that every supplied sibling was consumed and the reconstructed value equals the root.

> Note on cross-implementation compatibility: the zero-hash model produces a **different root** than a collapsing / path-compressing SMT for the same leaves. Roots and proofs from this package are only interoperable with implementations that follow the did:btcr2 [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification) algorithm.

## Spec conformance

This package targets the did:btcr2 [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification) algorithm and [SMT Proof data structure](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof) as the source of truth. `verifyZeroHash` is a line-for-line implementation of the specified verifier.

The specification pins the verification algorithm and the wire format, but does not currently pin two build-side details: the `cachedZero` seed byte width (written `z = 0`) and the tree-construction algorithm. This package seeds `z` with 32 zero bytes (matching `NULL_HASH`) and uses a construction that is round-trip validated against the authoritative verifier. If the spec later pins a different seed or encoding, only `CACHED_ZERO`'s seed changes. See the monorepo ADRs [035 (proof wire format)](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/035-smt-proof-base64url-wire-format.md) and [036 (zero-hash model)](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/036-zero-hash-smt-model.md).

## Legacy exports

`OptimizedSMT` and the `SMTProof` class are still exported from the package barrel but are **superseded**: they implement the earlier collapsing model (converge bitmap with depth-byte padding), which produces a different, non-spec-conformant root. They are not used by did:btcr2 resolution and are retained only for transition. New code should use `BTCR2MerkleTree` and the zero-hash functions above; the legacy classes are slated for removal.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)

## Links

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/)
- [SMT Proof Verification algorithm](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification)
- [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js)
- [npm: @did-btcr2/smt](https://www.npmjs.com/package/@did-btcr2/smt)
- [Implementation docs](https://btcr2.dev/impls/ts)
