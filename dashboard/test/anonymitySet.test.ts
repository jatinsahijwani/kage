import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet } from "ethers";
import { createNote, deployPool, depositNote, DENOMINATIONS } from "@kage/sdk";
import { fetchAnonymitySets, privacyScore, formatDenomination } from "../src/anonymitySet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.join(__dirname, "..", "..", "contracts");

const RPC_PORT = 8579;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

let anvil: ChildProcess;

async function waitForRpc(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anvil did not start in time");
}

before(async () => {
  anvil = spawn("anvil", ["--port", String(RPC_PORT), "--silent"], { stdio: "ignore" });
  await waitForRpc(RPC_URL);
});

after(() => {
  anvil?.kill();
});

test("fetchAnonymitySets reports exactly what was deposited on-chain", async () => {
  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(DEPLOYER_KEY, provider);

  const { pool, token } = await deployPool(deployer, CONTRACTS_DIR, [DENOMINATIONS.D1, DENOMINATIONS.D2]);
  const poolAddress = await pool.getAddress();

  // 3 deposits into the D1 tree, 1 into the D2 tree.
  for (let i = 0; i < 3; i++) {
    const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D1 });
    await depositNote(pool, token, deployer, note);
  }
  const d2Note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D2 });
  await depositNote(pool, token, deployer, d2Note);

  const stats = await fetchAnonymitySets(RPC_URL, poolAddress, 100);
  assert.equal(stats.length, 2);

  const d1Stats = stats.find((s) => s.denomination === DENOMINATIONS.D1);
  const d2Stats = stats.find((s) => s.denomination === DENOMINATIONS.D2);
  assert.equal(d1Stats?.count, 3);
  assert.equal(d2Stats?.count, 1);
  assert.equal(d1Stats?.privacyScore, privacyScore(3, 100));
  assert.equal(formatDenomination(DENOMINATIONS.D1), "1");
  assert.equal(formatDenomination(DENOMINATIONS.D2), "10");
});

test("privacyScore is monotonic and caps at 100", () => {
  assert.equal(privacyScore(0), 0);
  assert.ok(privacyScore(10) < privacyScore(100));
  assert.equal(privacyScore(100, 100), 100);
  assert.equal(privacyScore(100000, 100), 100);
});
