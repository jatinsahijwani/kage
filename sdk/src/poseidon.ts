// @ts-expect-error no published types for circomlibjs
import { buildPoseidon } from "circomlibjs";

export type Hasher = (inputs: bigint[]) => bigint;

let cached: Promise<Hasher> | undefined;

// circomlibjs's poseidon is expensive to build (loads a wasm module); share
// one instance across a process instead of rebuilding it per call.
export function getPoseidon(): Promise<Hasher> {
  if (!cached) {
    cached = buildPoseidon().then((poseidon: any) => {
      const F = poseidon.F;
      return (inputs: bigint[]) => F.toObject(poseidon(inputs)) as bigint;
    });
  }
  return cached;
}
