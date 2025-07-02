import * as tinysecp from 'tiny-secp256k1';
import { payments, script, opcodes } from 'bitcoinjs-lib';
import { CompressedSecp256k1PublicKey } from '@did-btcr2/keypair';

/**
 * Aggregate an array of public keys by point addition
 */
function aggregatePubkeys(pubkeys: Uint8Array[]): Uint8Array {
  if (pubkeys.length === 1) return pubkeys[0];
  return pubkeys.reduce((sum: Uint8Array, pk: Uint8Array) => {
    const added = tinysecp.pointAdd(sum, pk);
    if (!added) throw new Error('Point addition failed');
    return added;
  }, pubkeys[0]);
}

/**
 * Build a P2TR script leaf for a k-of-n multisig with optional locktime/sequence
 */
function buildTapLeafScript(
  pubkeys: Uint8Array[],
  k: number,
  locktime?: number,
  sequence?: number
): Uint8Array {
  const ops: (Uint8Array | number)[] = [];

  // absolute timelock
  if (locktime !== undefined) {
    ops.push(script.number.encode(locktime));
    ops.push(opcodes.OP_CHECKLOCKTIMEVERIFY);
    ops.push(opcodes.OP_DROP);
  }
  // relative timelock
  if (sequence !== undefined) {
    ops.push(script.number.encode(sequence));
    ops.push(opcodes.OP_CHECKSEQUENCEVERIFY);
    ops.push(opcodes.OP_DROP);
  }

  // push each key as x-only pubkey
  for (const pk of pubkeys) {
    const [xOnly] = new CompressedSecp256k1PublicKey(pk).xOnly;
    ops.push(xOnly);
  }
  // push threshold k and total keys n
  ops.push(script.number.encode(k));
  ops.push(script.number.encode(pubkeys.length));
  ops.push(opcodes.OP_CHECKMULTISIG);

  return script.compile(ops);
}

/**
 * Build a P2TR script leaf for a aggregated MuSig key (key-path only)
 */
function buildMusigLeafScript(pubkeys: Uint8Array[]): Uint8Array {
  const agg = aggregatePubkeys(pubkeys);
  const [xOnly] = new CompressedSecp256k1PublicKey(agg).xOnly;
  // In a taproot script path, OP_CHECKSIG runs schnorr
  return script.compile([agg, opcodes.OP_CHECKSIG]);
}

/**
 * Recursively combine an array of leaves into a balanced Merkle tree structure
 */
function buildMerkleTree(nodes: Uint8Array[]): any {
  if (nodes.length === 1) return { output: nodes[0] };
  const next: any[] = [];
  for (let i = 0; i < nodes.length; i += 2) {
    if (i + 1 === nodes.length) {
      next.push({ output: nodes[i] });
    } else {
      next.push([
        { output: nodes[i] },
        { output: nodes[i + 1] },
      ]);
    }
  }
  return buildMerkleTree(next);
}

/**
 * Generate combinations of length k from an array
 */
function* combinations<T>(array: T[], k: number): Generator<T[]> {
  const n = array.length;
  if (k > n || k < 0) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.map(i => array[i]!);
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) {
      i--;
    }
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < k; j++) {
      indices[j] = indices[j - 1] + 1;
    }
  }
}

/**
 * TapRootMultiSig: builds Taproot outputs and trees for multisig and MuSig branches
 */
export class TapRootMultiSig {
  public readonly points: Uint8Array[];
  public readonly k: number;
  public readonly defaultInternalPubkey: Uint8Array;

  constructor(points: Uint8Array[], k: number) {
    if (points.length < k || k < 1) {
      throw new Error(`${k} is invalid for ${points.length} keys`);
    }
    this.points = points;
    this.k = k;
    // MuSig aggregation for default internal key
    this.defaultInternalPubkey = keyAggExport(keyAggregate(points));
  }

  /**
   * Single multisig leaf as the only script path
   */
  public singleLeaf(locktime?: number, sequence?: number) {
    const leaf = buildTapLeafScript(this.points, this.k, locktime, sequence);
    return payments.p2tr({
      internalPubkey : this.defaultInternalPubkey,
      scriptTree     : { output: leaf },
    });
  }

  /**
   * All k-of-n multisig combinations as separate leaf scripts, combined into one tree
   */
  public multiLeafTree(locktime?: number, sequence?: number) {
    const leaves: Uint8Array[] = [];
    for (const combo of combinations(this.points, this.k)) {
      leaves.push(buildTapLeafScript(combo, this.k, locktime, sequence));
    }
    const tree = buildMerkleTree(leaves);
    return payments.p2tr({
      internalPubkey : this.defaultInternalPubkey,
      scriptTree     : tree,
    });
  }

  /**
   * MuSig key-path scripts for each k-of-n combination in the script tree
   */
  public musigTree() {
    const leaves: Uint8Array[] = [];
    for (const combo of combinations(this.points, this.k)) {
      leaves.push(buildMusigLeafScript(combo));
    }
    const tree = buildMerkleTree(leaves);
    return payments.p2tr({
      internalPubkey : this.defaultInternalPubkey,
      scriptTree     : tree,
    });
  }

  /**
   * Default address for this multisig, using the aggregated MuSig key.
   * @type {string} Taproot address
   */
  public get defaultAddress(): string | undefined {
    return payments.p2tr({ internalPubkey: this.defaultInternalPubkey }).address;
  }

  /**
   * A two-branch tree: one branch is the singleLeaf script, the other is the muSig tree
   */
  public musigAndSingleLeafTree(locktime?: number, sequence?: number) {
    const single = buildTapLeafScript(this.points, this.k, locktime, sequence);
    const musigLeaves: Uint8Array[] = [];
    for (const combo of combinations(this.points, this.k)) {
      musigLeaves.push(buildMusigLeafScript(combo));
    }
    const tree = {
      output     : single,
      scriptTree : buildMerkleTree(musigLeaves),
    };
    return payments.p2tr({
      internalPubkey : this.defaultInternalPubkey,
      scriptTree     : tree,
    });
  }

  /**
   * Nested tree of singleLeaf, multiLeafTree, and musigTree
   */
  public everythingTree(locktime?: number, sequence?: number) {
    const single = buildTapLeafScript(this.points, this.k, locktime, sequence);

    const multiLeaves: Uint8Array[] = [];
    for (const combo of combinations(this.points, this.k)) {
      multiLeaves.push(buildTapLeafScript(combo, this.k, locktime, sequence));
    }
    const multiTree = buildMerkleTree(multiLeaves);

    const musigLeaves: Uint8Array[] = [];
    for (const combo of combinations(this.points, this.k)) {
      musigLeaves.push(buildMusigLeafScript(combo));
    }
    const musigTree = buildMerkleTree(musigLeaves);

    const tree = {
      output     : single,
      scriptTree : [multiTree, musigTree],
    };
    return payments.p2tr({
      internalPubkey : this.defaultInternalPubkey,
      scriptTree     : tree,
    });
  }

  /**
   * Degrading multisig: k-of-n initially, then (k-1)-of-n after delay, ... until 1-of-n
   */
  public degradingMultisigTree(
    sequenceBlockInterval?: number,
    sequenceTimeInterval?: number
  ) {
    const leaves: Uint8Array[] = [];
    for (let num = this.k; num >= 1; num--) {
      let seq: number | undefined;
      if (num === this.k) {
        seq = undefined;
      } else if (sequenceBlockInterval != null) {
        seq = sequenceBlockInterval * (this.k - num);
      } else if (sequenceTimeInterval != null) {
        seq = sequenceTimeInterval * (this.k - num);
      }
      for (const combo of combinations(this.points, num)) {
        leaves.push(buildTapLeafScript(combo, num, undefined, seq));
      }
    }
    const tree = buildMerkleTree(leaves);
    return payments.p2tr({
      internalPubkey : this.defaultInternalPubkey,
      scriptTree     : tree,
    });
  }
}
