# @did-btcr2/smt

Optimized Sparse Merkle Tree for [did:btcr2](https://dcdpr.github.io/did-btcr2/).

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package implements the [Optimized Sparse Merkle Tree (SMT)](https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html) described in the did:btcr2 specification. It's used by the `@did-btcr2/method` package for the aggregate SMT beacon — the mechanism that lets many DID updates share a single on-chain transaction.

The tree operates over a 256-bit key space (SHA-256 hashes as indexes). Rather than materializing all 2^256 nodes, it only stores the leaves you actually insert and collapses empty subtrees. Proofs use a converge bitmap to indicate which tree levels have real siblings, keeping proof size proportional to the number of leaves rather than the depth of the tree. Depth-byte padding prevents index substitution attacks on collapsed branches.

There are zero production dependencies. All cryptography uses Node.js built-in `crypto`.

## Install

```bash
npm install @did-btcr2/smt
```

Or with pnpm:

```bash
pnpm add @did-btcr2/smt
```

Requires Node.js >= 22.

## Usage

### Low-level: OptimizedSMT

If you need full control over indexes and hashes, use `OptimizedSMT` directly.

```typescript
import { OptimizedSMT, hashToBigInt, blockHash } from '@did-btcr2/smt';

// Build a tree
const smt = new OptimizedSMT(false); // false = all leaves must have hashes set

// Add leaf indexes (256-bit bigints)
const index1 = hashToBigInt(blockHash(new TextEncoder().encode('leaf-1')));
const index2 = hashToBigInt(blockHash(new TextEncoder().encode('leaf-2')));
smt.add([index1, index2]);

// Set a hash for each leaf
smt.setHash(index1, blockHash(new Uint8Array([1, 2, 3])));
smt.setHash(index2, blockHash(new Uint8Array([4, 5, 6])));

// Finalize — computes the root hash and generates all proofs in one pass
smt.finalize();

console.log(smt.rootHash); // Uint8Array(32)

// Get and verify a proof
const proof = smt.proof(index1);
const leafHash = blockHash(new Uint8Array([1, 2, 3]));
console.log(proof.isValid(index1, leafHash, smt.rootHash)); // true
```

### High-level: BTCR2MerkleTree

For did:btcr2 use cases, `BTCR2MerkleTree` handles index computation, leaf hash construction, and proof serialization for you.

```typescript
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import { randomBytes } from 'node:crypto';

const tree = new BTCR2MerkleTree();

tree.addEntries([
  {
    did: 'did:btcr2:k1qexample1',
    nonce: randomBytes(32),
    signedUpdate: new Uint8Array(/* canonical bytes of a signed BTCR2 update */),
  },
  {
    did: 'did:btcr2:k1qexample2',
    nonce: randomBytes(32),
    // no signedUpdate — this is a non-inclusion entry
  },
]);

tree.finalize();

// Get a serialized proof (hex strings, ready for JSON)
const proof = tree.proof('did:btcr2:k1qexample1');
// { id, collapsed, hashes, nonce, updateId }
```

### Verifying a serialized proof

```typescript
import { verifySerializedProof, didToIndex, inclusionLeafHash } from '@did-btcr2/smt';

const did = 'did:btcr2:k1qexample1';
const index = didToIndex(did);
const leafHash = inclusionLeafHash(nonce, signedUpdateBytes);

const valid = verifySerializedProof(serializedProof, index, leafHash);
```

### Proof serialization

Proofs can also be serialized to JSON or a compact binary format:

```typescript
import { SMTProof } from '@did-btcr2/smt';

// JSON (hex-encoded by default)
const json = proof.toJSON();
const restored = SMTProof.fromJSON(json);

// JSON with base64url encoding (smaller)
const jsonB64 = proof.toJSON({ base64: true });
const restoredB64 = SMTProof.fromJSON(jsonB64, true);

// Binary
const binary = proof.toBinary();
const restoredBin = await SMTProof.fromBinary(binary);
```

## API

### Core

| Export | Description |
|---|---|
| `OptimizedSMT` | Core tree class. Lifecycle: `add()` -> `setHash()` -> `finalize()` -> `proof()` |
| `SMTProof` | Proof with `isValid()`, `isValidBatch()`, and serialization methods |

### did:btcr2

| Export | Description |
|---|---|
| `BTCR2MerkleTree` | High-level wrapper with DID indexing and leaf hash construction |
| `didToIndex(did)` | SHA-256 of the DID string as a 256-bit bigint |
| `inclusionLeafHash(nonce, signedUpdate)` | `SHA-256(SHA-256(nonce) \|\| SHA-256(signedUpdate))` |
| `nonInclusionLeafHash(nonce)` | `SHA-256(SHA-256(nonce))` |
| `serializeProof(proof, rootHash, opts?)` | Convert an `SMTProof` to hex-string format |
| `deserializeProof(serialized)` | Parse a hex-string proof back to typed objects |
| `verifySerializedProof(serialized, index, hash)` | Verify a hex-string proof directly |

### Hash utilities

| Export | Description |
|---|---|
| `blockHash(...blocks)` | SHA-256 of concatenated `Uint8Array` blocks |
| `hashToBigInt(hash)` / `bigIntToHash(value)` | 32-byte <-> 256-bit bigint |
| `hashToHex(hash)` / `hexToHash(hex)` | 32-byte <-> 64-char hex |
| `hashesEqual(a, b)` | Constant-time comparison via `crypto.timingSafeEqual` |

### Constants

| Export | Value |
|---|---|
| `HASH_BYTE_LENGTH` | `32` |
| `HASH_BIT_LENGTH` | `256` |
| `HASH_HEX_LENGTH` | `64` |
| `NULL_HASH` | 32 zero bytes (non-inclusion sentinel) |

## How it works

A standard Merkle tree over 256-bit keys would have 2^256 leaves — obviously impractical. A Sparse Merkle Tree avoids this by only materializing the paths to leaves that actually exist. Empty subtrees are represented implicitly with a null hash.

This implementation goes further with two optimizations:

**Converge bitmap.** Instead of storing 256 sibling hashes per proof (one per tree level), a proof carries a bigint bitmap indicating which levels have a real sibling. A set bit at position `d` means "there's a non-empty subtree on the other side at depth `d`, and the next hash in the proof array belongs to that level." Unset bits are levels where the sibling is empty, so no hash is needed. For a tree with a handful of leaves, this cuts proof size dramatically.

**Depth-byte padding.** When a subtree is collapsed (a leaf sits higher in the tree than its full 256-bit path would place it), the hash is padded with the depth values of the skipped levels. This prevents an attacker from reusing a proof for one index at a different index position — the depth bytes are baked into the hash chain, so any index swap produces a different root.

## Links

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/)
- [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js)
- [npm: @did-btcr2/smt](https://www.npmjs.com/package/@did-btcr2/smt)
- [Implementation docs](https://btcr2.dev/impls/ts)
