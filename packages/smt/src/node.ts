/**
 * Abstract base for all tree nodes.
 * Each node has an `index` (its position in the 256-bit key space) and a
 * `depth` (its level in a fully-realized binary tree, 0 = root, 256 = leaf).
 */
export abstract class BaseNode {
  readonly #index: bigint;
  readonly #depth: number;

  constructor(index: bigint, depth: number) {
    this.#index = index;
    this.#depth = depth;
  }

  get index(): bigint { return this.#index; }
  get depth(): number { return this.#depth; }

  /** Reset mutable state so the tree structure can be reused. */
  abstract reset(): void;
}

/**
 * A leaf node stores the hash of the data it represents.
 * The hash is set-once: once assigned it cannot be changed (only {@link reset}).
 */
export class LeafNode extends BaseNode {
  #hash: Uint8Array | null = null;

  get hash(): Uint8Array | null { return this.#hash; }

  set hash(value: Uint8Array) {
    if (this.#hash !== null) {
      throw new RangeError('Leaf hash already set');
    }
    this.#hash = value;
  }

  reset(): void {
    this.#hash = null;
  }
}

/**
 * An internal (parent) node with mutable left and right children.
 */
export class ParentNode extends BaseNode {
  #left: Node;
  #right: Node;

  constructor(index: bigint, depth: number, left: Node, right: Node) {
    super(index, depth);
    this.#left  = left;
    this.#right = right;
  }

  get left(): Node  { return this.#left; }
  set left(node: Node) { this.#left = node; }

  get right(): Node  { return this.#right; }
  set right(node: Node) { this.#right = node; }

  reset(): void {
    this.#left.reset();
    this.#right.reset();
  }
}

/** Union of all concrete node types. */
export type Node = ParentNode | LeafNode;
