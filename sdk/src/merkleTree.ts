import { Contract, type Provider } from "ethers";
import { LEVELS } from "./constants.js";
import { getPoseidon, type Hasher } from "./poseidon.js";

const DEPOSIT_EVENT_ABI = [
  "event Deposit(uint256 indexed denomination, uint256 indexed commitment, uint32 leafIndex, uint256 root, uint256 timestamp)",
];

// Off-chain mirror of contracts/src/MerkleTreeWithHistory.sol: Poseidon(2)
// per level, zero-leaf = 0, empty subtrees represented by precomputed zero
// hashes so root()/path() stay cheap at depth 20 with only a handful of
// real leaves. Must produce bit-for-bit the same roots as the on-chain
// tree and circuits/test/utils/merkleTree.ts (parity is checked in
// contracts/test/PoseidonParity.t.sol and sdk/test/merkleTree.test.ts).
export class KageMerkleTree {
  readonly levels: number;
  private readonly hash: Hasher;
  private readonly zeros: bigint[];
  private leaves: bigint[] = [];

  constructor(hash: Hasher, levels: number = LEVELS) {
    this.hash = hash;
    this.levels = levels;
    this.zeros = [0n];
    for (let i = 1; i <= levels; i++) {
      this.zeros.push(this.hash2(this.zeros[i - 1], this.zeros[i - 1]));
    }
  }

  static async create(levels: number = LEVELS): Promise<KageMerkleTree> {
    const hash = await getPoseidon();
    return new KageMerkleTree(hash, levels);
  }

  // Rebuilds the tree for one denomination purely from on-chain Deposit
  // events, in leafIndex order — this is how a client with no local state
  // (a fresh wallet, or a relayer) recovers the current tree.
  static async fromChain(provider: Provider, poolAddress: string, denomination: bigint): Promise<KageMerkleTree> {
    const tree = await KageMerkleTree.create();
    const contract = new Contract(poolAddress, DEPOSIT_EVENT_ABI, provider);
    const events = await contract.queryFilter(contract.filters.Deposit(denomination));
    const leaves = events
      .map((e: any) => ({ leafIndex: Number(e.args.leafIndex), commitment: BigInt(e.args.commitment) }))
      .sort((a: { leafIndex: number }, b: { leafIndex: number }) => a.leafIndex - b.leafIndex);
    for (const leaf of leaves) {
      const index = tree.insert(leaf.commitment);
      if (index !== leaf.leafIndex) {
        throw new Error(`Deposit events out of order or missing: expected leafIndex ${index}, got ${leaf.leafIndex}`);
      }
    }
    return tree;
  }

  private hash2(a: bigint, b: bigint): bigint {
    return this.hash([a, b]);
  }

  insert(leaf: bigint): number {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }

  get size(): number {
    return this.leaves.length;
  }

  // Hash of the 2^level-wide subtree starting at leaf index `start*2^level`.
  private subtreeHash(level: number, start: number): bigint {
    const width = 1 << level;
    if (start * width >= this.leaves.length) return this.zeros[level];
    if (level === 0) return this.leaves[start] ?? this.zeros[0];
    return this.hash2(this.subtreeHash(level - 1, start * 2), this.subtreeHash(level - 1, start * 2 + 1));
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

  indexOfCommitment(commitment: bigint): number {
    return this.leaves.indexOf(commitment);
  }
}
