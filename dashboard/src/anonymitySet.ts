import { Contract, JsonRpcProvider } from "ethers";

const POOL_ABI = [
  "function getDenominations() view returns (uint256[])",
  "function getAnonymitySet(uint256 denomination) view returns (uint256 count, uint256 currentRoot)",
];

export interface DenominationStats {
  denomination: bigint;
  count: number;
  currentRoot: bigint;
  privacyScore: number; // 0-100 heuristic, see privacyScore() below
}

// Log-scaled against a configurable "healthy" target set size, capped at
// 100. This is a simple, clearly-labeled heuristic, not a rigorous
// unlinkability metric: it only counts total commitments ever deposited
// for a denomination — see docs/THREAT_MODEL.md for what it does and
// doesn't tell you.
export function privacyScore(setSize: number, target = 100): number {
  if (setSize <= 0) return 0;
  const score = (100 * Math.log(1 + setSize)) / Math.log(1 + target);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function fetchAnonymitySets(
  rpcUrl: string,
  poolAddress: string,
  target = 100,
): Promise<DenominationStats[]> {
  const provider = new JsonRpcProvider(rpcUrl);
  const pool = new Contract(poolAddress, POOL_ABI, provider);
  const denominations: bigint[] = await pool.getDenominations();

  const stats: DenominationStats[] = [];
  for (const denomination of denominations) {
    const [count, currentRoot] = await pool.getAnonymitySet(denomination);
    stats.push({
      denomination,
      count: Number(count),
      currentRoot,
      privacyScore: privacyScore(Number(count), target),
    });
  }
  return stats;
}

// 18-decimal base units -> a readable "1" / "10" / "0.5" string.
export function formatDenomination(value: bigint, decimals = 18): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
