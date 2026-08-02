import { test, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error no published types for circom_tester
import circomTester from "circom_tester";
// @ts-expect-error no published types for circomlibjs
import { buildPoseidon } from "circomlibjs";
import { SimpleMerkleTree } from "./utils/merkleTree.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVELS = 20;
const D1 = 1_000_000_000_000_000_000n; // 1 unit, 18 decimals
const D2 = 10_000_000_000_000_000_000n; // 10 units, 18 decimals

function rand(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

let circuit: any;
let poseidon: any;

before(async () => {
  circuit = await circomTester.wasm(path.join(__dirname, "..", "withdraw.circom"), {
    output: path.join(__dirname, "..", "build", "test"),
  });
  poseidon = await buildPoseidon();
});

function hash(inputs: bigint[]): bigint {
  return poseidon.F.toObject(poseidon(inputs));
}

function buildFixture() {
  const tree = new SimpleMerkleTree(LEVELS, poseidon);

  function makeNote(amount: bigint) {
    const nullifier = rand();
    const secret = rand();
    const commitment = hash([nullifier, secret, amount]);
    const leafIndex = tree.insert(commitment);
    return { nullifier, secret, amount, commitment, leafIndex };
  }

  function witnessFor(
    note: ReturnType<typeof makeNote>,
    overrides: Partial<{
      root: bigint;
      nullifierHash: bigint;
      recipient: bigint;
      relayer: bigint;
      fee: bigint;
      amount: bigint;
      pathElements: bigint[];
    }> = {},
  ) {
    const { pathElements, pathIndices } = tree.path(note.leafIndex);
    return {
      root: overrides.root ?? tree.root(),
      nullifierHash: overrides.nullifierHash ?? hash([note.nullifier]),
      recipient: overrides.recipient ?? 0x1111n,
      relayer: overrides.relayer ?? 0x2222n,
      fee: overrides.fee ?? 0n,
      amount: overrides.amount ?? note.amount,
      nullifier: note.nullifier,
      secret: note.secret,
      pathElements: overrides.pathElements ?? pathElements,
      pathIndices,
    };
  }

  return { tree, makeNote, witnessFor };
}

test("valid witness satisfies all constraints for D1", async () => {
  const { makeNote, witnessFor } = buildFixture();
  const note = makeNote(D1);
  const w = await circuit.calculateWitness(witnessFor(note), true);
  await circuit.checkConstraints(w);
});

test("valid witness satisfies all constraints for D2", async () => {
  const { makeNote, witnessFor } = buildFixture();
  const note = makeNote(D2);
  const w = await circuit.calculateWitness(witnessFor(note), true);
  await circuit.checkConstraints(w);
});

test("rejects amount outside the fixed denomination set", async () => {
  const { makeNote, witnessFor } = buildFixture();
  const note = makeNote(D1);
  // Claim a leaf of 5 units — no witness can satisfy (amount-D1)*(amount-D2)=0,
  // and there is no other value of `amount` for which the commitment
  // Poseidon(nullifier, secret, amount) matches what's actually in the tree.
  await assert.rejects(() =>
    circuit.calculateWitness(witnessFor(note, { amount: 5_000_000_000_000_000_000n }), true),
  );
});

test("rejects an invalid merkle path", async () => {
  const { makeNote, witnessFor, tree } = buildFixture();
  const note = makeNote(D1);
  const w = witnessFor(note);
  const corrupted = w.pathElements.slice();
  corrupted[0] = tree.root(); // clearly wrong sibling
  await assert.rejects(() => circuit.calculateWitness(witnessFor(note, { pathElements: corrupted }), true));
});

test("rejects a tampered nullifier hash", async () => {
  const { makeNote, witnessFor } = buildFixture();
  const note = makeNote(D1);
  const w = witnessFor(note, { nullifierHash: 12345n });
  await assert.rejects(() => circuit.calculateWitness(w, true));
});

test("rejects a fee greater than the withdrawn amount", async () => {
  const { makeNote, witnessFor } = buildFixture();
  const note = makeNote(D1);
  const w = witnessFor(note, { fee: D1 + 1n });
  await assert.rejects(() => circuit.calculateWitness(w, true));
});
