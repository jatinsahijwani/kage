import { getPoseidon } from "./poseidon.js";

export interface Note {
  chainId: number;
  poolAddress: string;
  denomination: bigint;
  nullifier: bigint;
  secret: bigint;
}

// 31 bytes keeps every sampled value comfortably below the BN254 scalar
// field prime (~2^254), same convention Tornado Cash uses.
function randomFieldElement(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

export async function commitmentOf(note: Pick<Note, "nullifier" | "secret" | "denomination">): Promise<bigint> {
  const hash = await getPoseidon();
  return hash([note.nullifier, note.secret, note.denomination]);
}

export async function nullifierHashOf(note: Pick<Note, "nullifier">): Promise<bigint> {
  const hash = await getPoseidon();
  return hash([note.nullifier]);
}

export function createNote(params: { chainId: number; poolAddress: string; denomination: bigint }): Note {
  return {
    chainId: params.chainId,
    poolAddress: params.poolAddress,
    denomination: params.denomination,
    nullifier: randomFieldElement(),
    secret: randomFieldElement(),
  };
}

// kage-v1-<chainId>-<poolAddress>-<denomination>-<nullifier hex>-<secret hex>
// nullifier/secret are the only secret components; everything else is
// public context that lets a wallet/relayer locate the right pool+tree
// without guessing.
export function serializeNote(note: Note): string {
  return [
    "kage-v1",
    note.chainId.toString(),
    note.poolAddress.toLowerCase(),
    note.denomination.toString(),
    note.nullifier.toString(16),
    note.secret.toString(16),
  ].join("-");
}

export function parseNote(serialized: string): Note {
  const parts = serialized.split("-");
  if (parts.length !== 7 || parts[0] !== "kage" || parts[1] !== "v1") {
    throw new Error("invalid kage note format");
  }
  const [, , chainId, poolAddress, denomination, nullifierHex, secretHex] = parts;
  return {
    chainId: Number(chainId),
    poolAddress,
    denomination: BigInt(denomination),
    nullifier: BigInt(`0x${nullifierHex}`),
    secret: BigInt(`0x${secretHex}`),
  };
}
