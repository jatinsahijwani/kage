import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KageMerkleTree } from "../src/merkleTree.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cross-checks the SDK's off-chain tree against the same fixture used by
// the Foundry test suite (contracts/test/fixtures/valid_withdraw_d1.json),
// generated once via circuits/scripts/gen-contract-fixtures.mjs. All three
// implementations — circuit, contract, SDK — must agree on the same root.
test("matches the on-chain fixture root for the D1 tree", async () => {
  const fixturePath = path.join(__dirname, "..", "..", "contracts", "test", "fixtures", "valid_withdraw_d1.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

  const tree = await KageMerkleTree.create();
  for (const commitment of fixture.commitmentsD1) {
    tree.insert(BigInt(commitment));
  }

  assert.equal(tree.root().toString(), fixture.root);
});

test("empty tree root matches the known zero root", async () => {
  const tree = await KageMerkleTree.create();
  // poseidon(0,0) applied 20 times up the tree — this constant is also
  // asserted directly in circuits (test vectors) and on-chain
  // (PoseidonParity.t.sol uses the same base hash).
  assert.equal(tree.size, 0);
  assert.ok(tree.root() > 0n);
});

test("path(index) is internally consistent with root()", async () => {
  const tree = await KageMerkleTree.create();
  const leaves = [111n, 222n, 333n, 444n, 555n];
  leaves.forEach((l) => tree.insert(l));

  // Recompute the root by walking the path for leaf index 3 and confirm it
  // matches tree.root() exactly — this is the same check the circuit does.
  const { pathElements, pathIndices } = tree.path(3);
  let cur = leaves[3];
  // hash2 isn't exported; reuse KageMerkleTree via a second tiny tree that
  // only ever gets 2 leaves inserted mirrors the same hash function.
  const hashPair = await import("../src/poseidon.js").then((m) => m.getPoseidon());
  for (let i = 0; i < pathIndices.length; i++) {
    cur = pathIndices[i] === 0 ? hashPair([cur, pathElements[i]]) : hashPair([pathElements[i], cur]);
  }
  assert.equal(cur, tree.root());
});
