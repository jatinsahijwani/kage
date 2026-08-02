// Generates a real Groth16 proof + calldata fixture for the Foundry test
// suite (contracts/test/fixtures/). Deposits here must mirror exactly what
// contracts/test/KageShieldedPool.t.sol deposits on-chain in the same
// order, or the merkle path computed here won't match the on-chain root.
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS = path.join(__dirname, "..");
const OUT_DIR = path.join(__dirname, "..", "..", "contracts", "test", "fixtures");

const D1 = 1_000_000_000_000_000_000n;
const D2 = 10_000_000_000_000_000_000n;
const LEVELS = 20;

const RECIPIENT = 0xbeefn;
const RELAYER = 0xcafen;
const FEE = 10_000_000_000_000_000n; // 0.01 unit

const poseidon = await buildPoseidon();
const F = poseidon.F;
const hash = (inputs) => F.toObject(poseidon(inputs));

class Tree {
  constructor(levels) {
    this.levels = levels;
    this.leaves = [];
    this.zeros = [0n];
    for (let i = 1; i <= levels; i++) this.zeros.push(hash([this.zeros[i - 1], this.zeros[i - 1]]));
  }
  insert(leaf) {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }
  subtreeHash(level, start) {
    const width = 1 << level;
    if (start * width >= this.leaves.length) return this.zeros[level];
    if (level === 0) return this.leaves[start] ?? this.zeros[0];
    return hash([this.subtreeHash(level - 1, start * 2), this.subtreeHash(level - 1, start * 2 + 1)]);
  }
  root() {
    return this.subtreeHash(this.levels, 0);
  }
  path(index) {
    const pathElements = [];
    const pathIndices = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const isRight = idx % 2 === 1;
      const siblingStart = isRight ? idx - 1 : idx + 1;
      pathElements.push(this.subtreeHash(level, siblingStart));
      pathIndices.push(isRight ? 1 : 0);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }
}

// Fixed test notes (nullifier, secret) — deterministic so the fixture is
// reproducible. NOT for any real deployment.
const NOTES_D1 = [
  { nullifier: 111111111111111111111111111111n, secret: 222222222222222222222222222222n },
  { nullifier: 333333333333333333333333333333n, secret: 444444444444444444444444444444n },
  { nullifier: 555555555555555555555555555555n, secret: 666666666666666666666666666666n },
];
const NOTES_D2 = [{ nullifier: 777777777777777777777777777777n, secret: 888888888888888888888888888888n }];

const treeD1 = new Tree(LEVELS);
const treeD2 = new Tree(LEVELS);

const commitmentsD1 = NOTES_D1.map((n) => hash([n.nullifier, n.secret, D1]));
const commitmentsD2 = NOTES_D2.map((n) => hash([n.nullifier, n.secret, D2]));

commitmentsD1.forEach((c) => treeD1.insert(c));
commitmentsD2.forEach((c) => treeD2.insert(c));

// Target: withdraw NOTES_D1[1] (the middle deposit), proving it's a member
// of a 3-leaf tree — a non-trivial, realistic path.
const targetIndex = 1;
const note = NOTES_D1[targetIndex];
const { pathElements, pathIndices } = treeD1.path(targetIndex);

const input = {
  root: treeD1.root(),
  nullifierHash: hash([note.nullifier]),
  recipient: RECIPIENT,
  relayer: RELAYER,
  fee: FEE,
  amount: D1,
  nullifier: note.nullifier,
  secret: note.secret,
  pathElements,
  pathIndices,
};

console.log("generating fixture proof...");
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  path.join(CIRCUITS, "build/withdraw_js/withdraw.wasm"),
  path.join(CIRCUITS, "build/withdraw_final.zkey"),
);

const calldata = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`);
// exportSolidityCallData emits 0x-hex strings; normalize everything to
// decimal strings so forge-std's stdJson (which expects decimal) parses
// cleanly and the fixture is unambiguous to read by eye.
const dec = (x) => BigInt(x).toString();
const [pARaw, pBRaw, pCRaw, pubSignalsRaw] = calldata;
const pA = pARaw.map(dec);
const pC = pCRaw.map(dec);
const pubSignals = pubSignalsRaw.map(dec);
// forge-std's stdJson can't parse nested arrays; flatten pB row-major and
// reshape it back to [2][2] in Solidity.
const pBFlat = [dec(pBRaw[0][0]), dec(pBRaw[0][1]), dec(pBRaw[1][0]), dec(pBRaw[1][1])];

await writeFile(
  path.join(OUT_DIR, "valid_withdraw_d1.json"),
  JSON.stringify(
    {
      description: "Valid withdrawal proof for NOTES_D1[1] against a 3-leaf D1 tree + 1-leaf D2 tree",
      denomination: D1.toString(),
      recipient: RECIPIENT.toString(),
      relayer: RELAYER.toString(),
      fee: FEE.toString(),
      commitmentsD1: commitmentsD1.map(String),
      commitmentsD2: commitmentsD2.map(String),
      root: input.root.toString(),
      nullifierHash: input.nullifierHash.toString(),
      pA,
      pBFlat,
      pC,
      pubSignals,
    },
    null,
    2,
  ),
);

console.log("wrote", path.join(OUT_DIR, "valid_withdraw_d1.json"));

// snarkjs/ffjavascript keep a worker-thread pool alive for curve
// arithmetic once groth16 proving has happened; without this the process
// never exits on its own.
const curve = await snarkjs.curves.getCurveFromName("bn128");
await curve.terminate();
