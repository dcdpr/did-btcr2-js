# @did-btcr2/smt

Sparse Merkle Tree for [did:btcr2](https://dcdpr.github.io/did-btcr2/).

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package implements the [zero-hash Sparse Merkle Tree (SMT)](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification) defined by the did:btcr2 specification. It powers the `@did-btcr2/method` aggregate SMT beacon: the mechanism that lets many DID updates share a single on-chain transaction while each DID controller can still prove, with a compact proof, exactly which update (if any) was aggregated for them in a given signal.

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
    did      : 'did:btcr2:k1qexample1',
    nonce    : randomBytes(32),
    updateId : new Uint8Array(/* the 32-byte JSON Document Hash of the signed BTCR2 update */),
  },
  {
    did   : 'did:btcr2:k1qexample2',
    nonce : randomBytes(32),
    // no updateId: this DID announces no update in this signal (nonce mode)
  },
  {
    did      : 'did:btcr2:k1qexample3',
    updateId : new Uint8Array(/* the 32-byte JSON Document Hash of the signed BTCR2 update */),
    // no nonce: an update in no-nonce mode, the leaf value is the updateId itself
  },
]);

tree.finalize();

tree.rootHash;                            // Uint8Array(32): anchor this in the beacon OP_RETURN
const proof = tree.proof('did:btcr2:k1qexample1');
// SerializedSMTProof: { id, collapsed, hashes, nonce?, updateId? }: all base64url, no padding
```

`addEntries()` may be called multiple times before `finalize()`. Adding two DIDs that collide on the same index throws. An entry with neither `nonce` nor `updateId` records the DID and adds no leaf: the index stays empty. `proof(did)` serves a member of the tree or not: a DID with no leaf gets the proof of an empty index. Call `reset()` to drop the computed root/proofs while keeping the entries.

## Verifying a proof

A relying party verifies a serialized proof against the on-chain root using only the DID and the proof:

```typescript
import { verifyProof } from '@did-btcr2/smt';

const ok = verifyProof(proof, did); // boolean, never throws
```

`verifyProof` is the SMT Proof Verification algorithm of the specification. The `nonce` and `updateId` fields of the proof select the leaf value (see `leafValue`). The result is `false` for a proof that does not decode, for an `updateId`, `collapsed`, or `hashes` entry that is not 32 bytes, for a `hashes` count that does not agree with `collapsed`, and for a walk that does not end at `id`. The root of the proof is `id`: compare it to the on-chain signal bytes before you trust the proof.

`verifySerializedProof(proof, index, candidate)` runs the same walk against a caller-supplied leaf value.

## Wire format

Serialized proofs follow the did:btcr2 [SMT Proof data structure](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof). Every SHA-256 field is "base64url" [RFC 4648] encoded **without padding** (43 characters each), and `collapsed` is the 256-bit empty-sibling bitmap encoded the same way:

```json
{
  "id":        "ZSN-lAyRpXG72aK1xLC9sAuRhFGsILupaQXxpkITJuo",
  "nonce":     "WYVxNuwz3RBEhnJKM4LvVh2tOdXI9WRUPYqA_qa0klM",
  "updateId":  "_YDKmjcnIkHDY6rnRwrO86id5H1Onycy7Bz62jYq6GA",
  "collapsed": "-_________________________________________8",
  "hashes":    [ "s-2LV-dfS-x___DBpNeH4KaBBSJj0xCSpn8ZlusZwLo" ]
}
```

- `id` is the SMT root (what the beacon transaction commits to).
- `nonce` and `updateId` are optional. Their presence selects the leaf value. `updateId` is the JSON Document Hash of the signed update (32 bytes). `nonce` has any length.
- In `collapsed`, bit `i` set means the sibling at tree level `i` is empty (the verifier substitutes the precomputed `cachedZero[255 - i]`); bit `i` clear means the next entry in `hashes` is the sibling at that level. Bit `i` is `bitAt(i)` of the decoded value, counted from the left: bit `0` is the most significant bit of the first byte, the root level; bit `255` is the least significant bit of the last byte, the leaf level. The number of entries in `hashes` plus the number of set bits in `collapsed` is `256`.

## Low-level: zero-hash API

If you need direct control over indexes and leaf hashes (outside the did:btcr2 leaf convention), use the zero-hash functions that `BTCR2MerkleTree` is built on:

```typescript
import {
  zeroHashRoot,
  generateZeroHashProof,
  verifyZeroHash,
  serializeProof,
  didToIndex,
  leafValue,
} from '@did-btcr2/smt';

const leaves = [
  { index: didToIndex('did:btcr2:k1qexample1'), leaf: leafValue(nonce1, updateId1) },
  { index: didToIndex('did:btcr2:k1qexample2'), leaf: leafValue(nonce2, updateId2) },
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
| `TreeEntry` | Entry shape: `{ did, nonce?, updateId? }`. The presence of `nonce` and `updateId` selects the leaf value. |
| `SerializedSMTProof` | Wire proof: `{ id, collapsed, hashes, nonce?, updateId? }`, all base64url no-pad. |
| `didToIndex(did)` | Leaf index: `bigint(SHA-256(did))`, big-endian. The most significant bit selects the child of the root. |
| `leafValue(nonce?, updateId?)` | The four leaf values: `SHA-256(SHA-256(nonce) \|\| updateId)`, `SHA-256(SHA-256(nonce))`, `updateId`, or `cachedZero[0]`. |
| `serializeProof(rootHash, proof, opts?)` | Convert a `ZeroHashProof` (plus optional `nonce`/`updateId`) to `SerializedSMTProof`. |
| `deserializeProof(serialized)` | Parse a wire proof back to `{ rootHash, collapsed, hashes, nonce?, updateId? }`. Throws on a field that does not decode. |
| `verifyProof(serialized, did)` | SMT Proof Verification of the specification. `false` on any malformed field, never throws. |
| `verifySerializedProof(serialized, index, candidateHash)` | The same walk against a caller-supplied leaf value. |

### Zero-hash core

| Export | Description |
|---|---|
| `zeroHashRoot(leaves)` | Compute the root over `ZeroHashEntry[]`. |
| `generateZeroHashProof(leaves, index)` | Inclusion proof `{ collapsed, hashes }` for one index. |
| `verifyZeroHash(collapsed, hashes, index, candidate, root)` | The spec's verification walk, from the leaf (`bitAt(255)`) to the root (`bitAt(0)`). |
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

**Four leaf values.** The DID controller selects the value of its leaf for each signal. With a `nonce`, an update is `SHA-256(SHA-256(nonce) \|\| updateId)` and a non-update is `SHA-256(SHA-256(nonce))`: an observer cannot tell whether a given DID has an update in a given signal, nor link a leaf to its update. Without a `nonce`, an update is the `updateId` itself, and a non-update leaves the index empty at `cachedZero[0]`: all parties can see whether there is an update.

**Compact proofs.** A proof is the `collapsed` bitmap plus only the non-empty sibling hashes. The verifier walks the path from the leaf to the root (`n` from 0 to 255, level `i = 255 - n`, bit `i` counted from the left), taking `cachedZero[n]` wherever `collapsed` bit `i` is set and the next supplied sibling otherwise, combining by bit `i` of the index (`0`: the candidate goes left, `1`: right), and finally checks that every supplied sibling was consumed and the reconstructed value equals the root. The most significant bit of `hash(did)` selects the child of the root.

> Note on cross-implementation compatibility: the zero-hash model produces a **different root** than a collapsing / path-compressing SMT for the same leaves. Roots and proofs from this package are only interoperable with implementations that follow the did:btcr2 [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification) algorithm.

## Spec conformance

This package targets the did:btcr2 [SMT Proof Verification](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification) algorithm and [SMT Proof data structure](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof) as the source of truth. `verifyZeroHash` is a line-for-line implementation of the specified verifier, and `verifyProof` adds the leaf-value selection and the malformed-proof rules of the algorithm.

The specification pins the seed of the hashed-zero cache (`0` is 32 zero bytes, `cachedZero[0] = hash(0 + 0)`), the bit sequence of the walk (`bitAt(i)` counts from the left), the four leaf values, and the conditions under which the result is `false`. This package follows them (specification pull request 365, 2026-09-22). See the monorepo ADRs [035 (proof wire format)](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/035-smt-proof-base64url-wire-format.md), [036 (zero-hash model)](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/036-zero-hash-smt-model.md), and [120 (leaf values, bit sequence, signal results)](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/120-smt-leaf-values-proof-bit-sequence-and-signal-results.md).

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
