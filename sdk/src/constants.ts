// Must stay in sync with circuits/withdraw.circom and
// contracts/src/MerkleTreeWithHistory.sol.
export const LEVELS = 20;
export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const DENOMINATIONS = {
  D1: 1_000_000_000_000_000_000n, // 1 unit, 18 decimals
  D2: 10_000_000_000_000_000_000n, // 10 units, 18 decimals
} as const;
