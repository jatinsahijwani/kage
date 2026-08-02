import type { Poseidon } from "circomlibjs";

// Minimal fixed-depth (e.g. 20) Merkle tree over Poseidon(2), zero-leaf = 0n.
// Empty subtrees are represented by precomputed zero hashes rather than
// materialized, so root()/path() stay cheap even at depth 20 with only a
// handful of real leaves inserted. Mirrors the on-chain tree in
// contracts/src/MerkleTreeWithHistory.sol and the off-chain tree in
// sdk/src/merkleTree.ts — all three must agree on this convention.
export class SimpleMerkleTree {
  readonly levels: number;
  private readonly poseidon: Poseidon;
  private readonly zeros: bigint[];
  private leaves: bigint[] = [];

  constructor(levels: number, poseidon: Poseidon) {
    this.levels = levels;
    this.poseidon = poseidon;
    this.zeros = [0n];
    for (let i = 1; i <= levels; i++) {
      this.zeros.push(this.hash2(this.zeros[i - 1], this.zeros[i - 1]));
    }
  }

  private hash2(a: bigint, b: bigint): bigint {
    return this.poseidon.F.toObject(this.poseidon([a, b]));
  }

  insert(leaf: bigint): number {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }

  // Hash of the 2^level-wide subtree starting at leaf index `start*2^level`.
  // Falls back to the precomputed zero hash the instant the subtree range
  // is entirely past the inserted leaves.
  private subtreeHash(level: number, start: number): bigint {
    const width = 1 << level;
    if (start * width >= this.leaves.length) return this.zeros[level];
    if (level === 0) return this.leaves[start] ?? this.zeros[0];
    return this.hash2(
      this.subtreeHash(level - 1, start * 2),
      this.subtreeHash(level - 1, start * 2 + 1),
    );
  }

  root(): bigint {
    return this.subtreeHash(this.levels, 0);
  }

  path(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const isRight = idx % 2 === 1;
      const siblingStart = isRight ? idx - 1 : idx + 1;
      pathElements.push(this.subtreeHash(level, siblingStart));
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }
}
