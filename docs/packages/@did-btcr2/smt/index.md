# SMT

TypeScript implementation of a Sparse Merkle Tree (SMT) data structure with support for Merkle Sum (MS) non-inclusion.

## Classes

- [Branch](classes/Branch.md)
- [Leaf](classes/Leaf.md)
- [NodeFactory](classes/NodeFactory.md)
- [Sha256Strategy](classes/Sha256Strategy.md)
- [SparseMerkleTree](classes/SparseMerkleTree.md)

## Interfaces

- [HashStrategy](interfaces/HashStrategy.md)
- [Node](interfaces/Node.md)

## Variables

- [EMPTY\_LEAF](variables/EMPTY_LEAF.md)
- [HASH\_SIZE](variables/HASH_SIZE.md)
- [MAX\_TREE\_LEVELS](variables/MAX_TREE_LEVELS.md)
- [ZERO\_NODE\_HASH](variables/ZERO_NODE_HASH.md)

## Functions

- [bitIndex](functions/bitIndex.md)
- [bufferEq](functions/bufferEq.md)
- [encodeBigUint64BE](functions/encodeBigUint64BE.md)
- [initEmptyLeaf](functions/initEmptyLeaf.md)
- [makeKey](functions/makeKey.md)
- [sha256](functions/sha256.md)
