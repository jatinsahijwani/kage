import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { config } from "./config.js";

export const POOL_ABI = [
  "function withdraw(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee, uint256 denomination) external",
  "function denominationAllowed(uint256) view returns (bool)",
  "function nullifierSpent(uint256) view returns (bool)",
  "function isKnownRoot(uint256 denomination, uint256 root) view returns (bool)",
];

export const provider = new JsonRpcProvider(config.rpcUrl);
export const wallet = new Wallet(config.privateKey, provider);
export const pool = new Contract(config.poolAddress, POOL_ABI, wallet);
