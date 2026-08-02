import { readFile } from "node:fs/promises";
// @ts-expect-error no published types for snarkjs
import * as snarkjs from "snarkjs";
import type { Note } from "./note.js";
import { nullifierHashOf } from "./note.js";
import type { KageMerkleTree } from "./merkleTree.js";

export interface WithdrawProofParams {
  note: Note;
  leafIndex: number;
  tree: KageMerkleTree;
  recipient: string;
  relayer: string;
  fee: bigint;
  wasmPath: string;
  zkeyPath: string;
}

export interface WithdrawCalldata {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  root: bigint;
  nullifierHash: bigint;
  // Native snarkjs proof/publicSignals, kept alongside the reshaped
  // calldata above so callers can run an off-chain groth16.verify() (e.g.
  // a relayer's pre-check) without reverse-engineering the Solidity
  // calldata's G2 coordinate swap.
  rawProof: unknown;
  rawPublicSignals: string[];
}

// Builds the full withdrawal witness, generates a Groth16 proof, and
// formats it exactly as KageShieldedPool.withdraw(...) expects.
export async function buildWithdrawProof(params: WithdrawProofParams): Promise<WithdrawCalldata> {
  const { note, leafIndex, tree, recipient, relayer, fee, wasmPath, zkeyPath } = params;
  const { pathElements, pathIndices } = tree.path(leafIndex);
  const nullifierHash = await nullifierHashOf(note);
  const root = tree.root();

  const input = {
    root,
    nullifierHash,
    recipient: BigInt(recipient),
    relayer: BigInt(relayer),
    fee,
    amount: note.denomination,
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements,
    pathIndices,
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const calldataStr: string = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC] = JSON.parse(`[${calldataStr}]`);

  return {
    pA: [BigInt(pA[0]), BigInt(pA[1])],
    pB: [
      [BigInt(pB[0][0]), BigInt(pB[0][1])],
      [BigInt(pB[1][0]), BigInt(pB[1][1])],
    ],
    pC: [BigInt(pC[0]), BigInt(pC[1])],
    root,
    nullifierHash,
    rawProof: proof,
    rawPublicSignals: publicSignals,
  };
}

// Cheap off-chain check a relayer can run before spending gas on a proof
// that would fail on-chain anyway.
export async function verifyWithdrawProofOffChain(vkeyPath: string, calldata: WithdrawCalldata): Promise<boolean> {
  const vkey = JSON.parse(await readFile(vkeyPath, "utf8"));
  return snarkjs.groth16.verify(vkey, calldata.rawPublicSignals, calldata.rawProof);
}
