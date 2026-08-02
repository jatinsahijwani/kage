import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet, Contract, parseEther } from "ethers";
import {
  createNote,
  deployPool,
  depositNote,
  fundAccount,
  KageMerkleTree,
  buildWithdrawProof,
  terminateCurve,
  DENOMINATIONS,
} from "@kage/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const WASM = path.join(CIRCUITS_DIR, "build", "withdraw_js", "withdraw.wasm");
const ZKEY = path.join(CIRCUITS_DIR, "build", "withdraw_final.zkey");
const VKEY = path.join(CIRCUITS_DIR, "build", "verification_key.json");

const RPC_PORT = 8578;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const MIN_FEE = 1_000_000_000_000_000n; // 0.001 unit
const relayerWallet = Wallet.createRandom();

let anvil: ChildProcess;
let relayerServer: Server;
let relayerPort: number;
let provider: JsonRpcProvider;
let deployer: Wallet;
let pool: Contract;
let token: Contract;
let poolAddress: string;

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

  provider = new JsonRpcProvider(RPC_URL);
  deployer = new Wallet(DEPLOYER_KEY, provider);

  const deployed = await deployPool(deployer, CONTRACTS_DIR, [DENOMINATIONS.D1, DENOMINATIONS.D2]);
  pool = deployed.pool;
  token = deployed.token;
  poolAddress = await pool.getAddress();

  // fund the relayer's freshly-generated wallet so it can pay gas
  await fundAccount(deployer, relayerWallet.address, parseEther("10"));

  process.env.RPC_URL = RPC_URL;
  process.env.PRIVATE_KEY = relayerWallet.privateKey;
  process.env.POOL_ADDRESS = poolAddress;
  process.env.VKEY_PATH = VKEY;
  process.env.MIN_FEE_1000000000000000000 = MIN_FEE.toString();
  process.env.KAGE_RELAYER_NO_LISTEN = "1";

  const { app } = await import("../src/server.js");
  relayerServer = app.listen(0);
  relayerPort = (relayerServer.address() as { port: number }).port;
});

after(async () => {
  relayerServer?.close();
  anvil?.kill();
  await terminateCurve();
});

async function relay(proof: unknown, publicSignals: string[]) {
  const res = await fetch(`http://127.0.0.1:${relayerPort}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof, publicSignals }),
  });
  return { status: res.status, body: await res.json() };
}

test("GET /status reports the relayer address", async () => {
  const res = await fetch(`http://127.0.0.1:${relayerPort}/status`);
  const body = await res.json();
  assert.equal(body.relayerAddress.toLowerCase(), relayerWallet.address.toLowerCase());
});

test("relays a valid withdrawal and pays recipient + relayer", async () => {
  const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D1 });
  const leafIndex = await depositNote(pool, token, deployer, note);
  const tree = await KageMerkleTree.fromChain(provider, poolAddress, DENOMINATIONS.D1);
  const recipient = Wallet.createRandom().address;

  const calldata = await buildWithdrawProof({
    note,
    leafIndex,
    tree,
    recipient,
    relayer: relayerWallet.address,
    fee: MIN_FEE,
    wasmPath: WASM,
    zkeyPath: ZKEY,
  });

  const { status, body } = await relay(calldata.rawProof, calldata.rawPublicSignals);
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.txHash);

  assert.equal(await token.balanceOf(recipient), DENOMINATIONS.D1 - MIN_FEE);
  assert.equal(await token.balanceOf(relayerWallet.address), MIN_FEE);
});

test("rejects a fee below the relayer's minimum without spending gas", async () => {
  const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D1 });
  const leafIndex = await depositNote(pool, token, deployer, note);
  const tree = await KageMerkleTree.fromChain(provider, poolAddress, DENOMINATIONS.D1);
  const recipient = Wallet.createRandom().address;

  const calldata = await buildWithdrawProof({
    note,
    leafIndex,
    tree,
    recipient,
    relayer: relayerWallet.address,
    fee: 0n,
    wasmPath: WASM,
    zkeyPath: ZKEY,
  });

  const { status, body } = await relay(calldata.rawProof, calldata.rawPublicSignals);
  assert.equal(status, 400);
  assert.match(body.error, /fee below relayer minimum/);
  assert.equal(await pool.nullifierSpent(calldata.nullifierHash), false);
});

test("rejects a tampered proof", async () => {
  const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D1 });
  const leafIndex = await depositNote(pool, token, deployer, note);
  const tree = await KageMerkleTree.fromChain(provider, poolAddress, DENOMINATIONS.D1);
  const recipient = Wallet.createRandom().address;

  const calldata = await buildWithdrawProof({
    note,
    leafIndex,
    tree,
    recipient,
    relayer: relayerWallet.address,
    fee: MIN_FEE,
    wasmPath: WASM,
    zkeyPath: ZKEY,
  });

  const tamperedProof = JSON.parse(JSON.stringify(calldata.rawProof));
  tamperedProof.pi_a[0] = (BigInt(tamperedProof.pi_a[0]) + 1n).toString();

  const { status, body } = await relay(tamperedProof, calldata.rawPublicSignals);
  assert.equal(status, 400);
  assert.match(body.error, /invalid proof/);
});

test("rejects a proof addressed to a different relayer", async () => {
  const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D1 });
  const leafIndex = await depositNote(pool, token, deployer, note);
  const tree = await KageMerkleTree.fromChain(provider, poolAddress, DENOMINATIONS.D1);
  const recipient = Wallet.createRandom().address;
  const someoneElse = Wallet.createRandom().address;

  const calldata = await buildWithdrawProof({
    note,
    leafIndex,
    tree,
    recipient,
    relayer: someoneElse,
    fee: MIN_FEE,
    wasmPath: WASM,
    zkeyPath: ZKEY,
  });

  const { status, body } = await relay(calldata.rawProof, calldata.rawPublicSignals);
  assert.equal(status, 400);
  assert.match(body.error, /not addressed to this relayer/);
});
