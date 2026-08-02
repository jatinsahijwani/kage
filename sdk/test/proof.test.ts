import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNote, commitmentOf } from "../src/note.js";
import { KageMerkleTree } from "../src/merkleTree.js";
import { buildWithdrawProof, verifyWithdrawProofOffChain } from "../src/proof.js";
import { terminateCurve } from "../src/curve.js";
import { DENOMINATIONS } from "../src/constants.js";

// groth16 proving/verifying leaves a worker-thread pool alive; tear it
// down or this process never exits on its own (see src/curve.ts).
after(() => terminateCurve());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS = path.join(__dirname, "..", "..", "circuits");
const WASM = path.join(CIRCUITS, "build", "withdraw_js", "withdraw.wasm");
const ZKEY = path.join(CIRCUITS, "build", "withdraw_final.zkey");
const VKEY = path.join(CIRCUITS, "build", "verification_key.json");

// End-to-end SDK check: build a note, insert it into a tree alongside some
// decoys, generate a real proof against the compiled circuit, and verify
// it off-chain — exercising the exact path the relayer and demo use.
test("buildWithdrawProof produces a proof that verifies off-chain", async () => {
  const note = createNote({
    chainId: 1,
    poolAddress: "0x0000000000000000000000000000000000000000",
    denomination: DENOMINATIONS.D1,
  });

  const tree = await KageMerkleTree.create();
  tree.insert(111n); // decoy
  const leafIndex = tree.insert(await commitmentOf(note));
  tree.insert(222n); // decoy

  const calldata = await buildWithdrawProof({
    note,
    leafIndex,
    tree,
    recipient: "0xBEEF",
    relayer: "0xCAFE",
    fee: 0n,
    wasmPath: WASM,
    zkeyPath: ZKEY,
  });

  assert.equal(calldata.root, tree.root());
  const ok = await verifyWithdrawProofOffChain(VKEY, calldata);
  assert.equal(ok, true);
});
