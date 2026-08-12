---
'@did-btcr2/smt': minor
---

Build the zero-hash tree once and serve proofs by trie walk.

Added:

- `ZeroHashTree`: a persistent compressed-trie zero-hash SMT. `ZeroHashTree.fromLeaves(leaves)` builds and hashes every subtree once; `.root` exposes the Merkle root and `.proof(index)` serves inclusion or non-inclusion proofs for any 256-bit index by a single trie walk with memoized subtree hashes. `BTCR2MerkleTree` now holds a `ZeroHashTree` across proofs instead of recomputing the sibling set of every level per proof (previously O(256^2 * n) bit operations per proof), so generating proofs for every member of a large cohort is no longer quadratic in the tree depth per proof. The one-shot `zeroHashRoot` and `generateZeroHashProof` wrappers are unchanged in behavior and delegate to `ZeroHashTree`.

Fixed:

- Building a tree with a duplicate leaf index throws a `RangeError` at construction instead of silently collapsing the duplicates into one leaf.
