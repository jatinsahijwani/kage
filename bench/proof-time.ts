// Regenerates every number in docs/BENCHMARKS.md: circuit proving/verification
// time, constraint count, key sizes, forge gas report, and PolkaVM bytecode
// sizes. Run with `npm run bench -w bench` from the repo root.
import { execFileSync } from "node:child_process";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error no published types for snarkjs
import * as snarkjs from "snarkjs";
import { getPoseidon, KageMerkleTree, terminateCurve, DENOMINATIONS } from "@kage/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const WASM = path.join(CIRCUITS_DIR, "build", "withdraw_js", "withdraw.wasm");
const ZKEY = path.join(CIRCUITS_DIR, "build", "withdraw_final.zkey");
const VKEY = path.join(CIRCUITS_DIR, "build", "verification_key.json");
const R1CS = path.join(CIRCUITS_DIR, "build", "withdraw.r1cs");

const RUNS = 10;

function rand(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    mean: mean.toFixed(1),
    median: percentile(sorted, 50).toFixed(1),
    p95: percentile(sorted, 95).toFixed(1),
    min: sorted[0].toFixed(1),
    max: sorted[sorted.length - 1].toFixed(1),
  };
}

async function fileSizeKB(p: string): Promise<string> {
  const s = await stat(p);
  return (s.size / 1024).toFixed(1);
}

async function main() {
  console.log(`generating ${RUNS} witnesses/proofs...\n`);

  const hash = await getPoseidon();
  const tree = await KageMerkleTree.create();
  const nullifier = rand();
  const secret = rand();
  const commitment = hash([nullifier, secret, DENOMINATIONS.D1]);
  const leafIndex = tree.insert(commitment);
  const { pathElements, pathIndices } = tree.path(leafIndex);

  const input = {
    root: tree.root(),
    nullifierHash: hash([nullifier]),
    recipient: 0x1111n,
    relayer: 0x2222n,
    fee: 0n,
    amount: DENOMINATIONS.D1,
    nullifier,
    secret,
    pathElements,
    pathIndices,
  };

  const proveTimes: number[] = [];
  let lastProof: unknown;
  let lastPublicSignals: unknown;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    proveTimes.push(performance.now() - t0);
    lastProof = proof;
    lastPublicSignals = publicSignals;
  }

  const vkey = JSON.parse(await readFile(VKEY, "utf8"));
  const verifyTimes: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await snarkjs.groth16.verify(vkey, lastPublicSignals, lastProof);
    verifyTimes.push(performance.now() - t0);
  }

  const r1csInfo = execFileSync("snarkjs", ["r1cs", "info", R1CS], { encoding: "utf8" });

  console.log("=== circuit ===");
  console.log(r1csInfo);
  console.log(`proving key (zkey): ${await fileSizeKB(ZKEY)} KB`);
  console.log(`verification key:   ${await fileSizeKB(VKEY)} KB`);
  console.log(`witness wasm:        ${await fileSizeKB(WASM)} KB`);
  console.log(`\nproof generation (ms), n=${RUNS}:`, stats(proveTimes));
  console.log(`proof verification (ms), n=${RUNS}:`, stats(verifyTimes));

  console.log("\n=== forge gas report ===");
  try {
    const gasReport = execFileSync("forge", ["test", "--gas-report"], {
      cwd: CONTRACTS_DIR,
      encoding: "utf8",
    });
    console.log(gasReport);
  } catch (err) {
    console.log("forge test failed:", err instanceof Error ? err.message : err);
  }

  console.log("=== PolkaVM (resolc) bytecode sizes ===");
  try {
    execFileSync("bash", ["scripts/build-polkavm.sh"], { cwd: CONTRACTS_DIR, encoding: "utf8" });
    const polkavmDir = path.join(CONTRACTS_DIR, "build", "polkavm");
    const matches = execFileSync("bash", ["-c", `ls ${polkavmDir}/*.polkavm 2>/dev/null || true`], {
      encoding: "utf8",
    }).trim();
    if (matches) {
      for (const m of matches.split("\n")) {
        console.log(`${await fileSizeKB(m)} KB  ${path.basename(m)}`);
      }
    } else {
      console.log("no .polkavm artifacts found");
    }
  } catch (err) {
    console.log("resolc build failed:", err instanceof Error ? err.message : err);
  }

  await terminateCurve();
}

main();
