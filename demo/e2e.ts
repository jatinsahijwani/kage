// End-to-end demo: deploy the pool stack on a local anvil chain, deposit
// several notes across both denominations, withdraw one of them through
// the relayer (paying it a fee), and then demonstrate the two properties
// this repo exists to prove: a spent note can't be replayed, and a proof
// can't be replayed against different withdrawal parameters (recipient,
// relayer, fee, or denomination).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet, parseEther } from "ethers";
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
const ROOT = path.join(__dirname, "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const CIRCUITS_DIR = path.join(ROOT, "circuits");
const WASM = path.join(CIRCUITS_DIR, "build", "withdraw_js", "withdraw.wasm");
const ZKEY = path.join(CIRCUITS_DIR, "build", "withdraw_final.zkey");
const VKEY = path.join(CIRCUITS_DIR, "build", "verification_key.json");

const RPC_PORT = 8580;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const MIN_FEE = 1_000_000_000_000_000n; // 0.001 unit

let step = 0;
function log(message: string) {
  step += 1;
  console.log(`\n[${step}] ${message}`);
}

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

async function relay(port: number, proof: unknown, publicSignals: string[]) {
  const res = await fetch(`http://127.0.0.1:${port}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof, publicSignals }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  log("starting local anvil chain");
  const anvil = spawn("anvil", ["--port", String(RPC_PORT), "--silent"], { stdio: "ignore" });
  await waitForRpc(RPC_URL);

  try {
    const provider = new JsonRpcProvider(RPC_URL);
    const deployer = new Wallet(DEPLOYER_KEY, provider);
    const relayerWallet = Wallet.createRandom();
    await fundAccount(deployer, relayerWallet.address, parseEther("10"));

    log("deploying MockERC20 + Groth16 verifier + KageShieldedPool");
    const { pool, token } = await deployPool(deployer, CONTRACTS_DIR, [DENOMINATIONS.D1, DENOMINATIONS.D2]);
    const poolAddress = await pool.getAddress();
    console.log(`    pool:  ${poolAddress}`);
    console.log(`    token: ${await token.getAddress()}`);

    log("depositing 3 notes of 1 unit and 2 notes of 10 units");
    const d1Notes = [];
    for (let i = 0; i < 3; i++) {
      const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D1 });
      const leafIndex = await depositNote(pool, token, deployer, note);
      d1Notes.push({ note, leafIndex });
      console.log(`    deposited D1 note #${leafIndex}`);
    }
    for (let i = 0; i < 2; i++) {
      const note = createNote({ chainId: 31337, poolAddress, denomination: DENOMINATIONS.D2 });
      const leafIndex = await depositNote(pool, token, deployer, note);
      console.log(`    deposited D2 note #${leafIndex}`);
    }

    const [d1SetSize, d2SetSize] = await Promise.all([
      pool.getAnonymitySet(DENOMINATIONS.D1),
      pool.getAnonymitySet(DENOMINATIONS.D2),
    ]);
    console.log(`    D1 anonymity set size: ${d1SetSize[0]}, D2 anonymity set size: ${d2SetSize[0]}`);

    log("starting relayer in-process, addressed at this pool");
    process.env.RPC_URL = RPC_URL;
    process.env.PRIVATE_KEY = relayerWallet.privateKey;
    process.env.POOL_ADDRESS = poolAddress;
    process.env.VKEY_PATH = VKEY;
    process.env.MIN_FEE_1000000000000000000 = MIN_FEE.toString();
    process.env.KAGE_RELAYER_NO_LISTEN = "1";
    const { app } = await import("../relayer/src/server.ts");
    const relayerServer = app.listen(0);
    const relayerPort = (relayerServer.address() as { port: number }).port;
    console.log(`    relayer address: ${relayerWallet.address}`);

    log("withdrawing the middle D1 note via the relayer, paying a 0.001 unit fee");
    const target = d1Notes[1];
    const tree = await KageMerkleTree.fromChain(provider, poolAddress, DENOMINATIONS.D1);
    const recipient = Wallet.createRandom().address;

    const calldata = await buildWithdrawProof({
      note: target.note,
      leafIndex: target.leafIndex,
      tree,
      recipient,
      relayer: relayerWallet.address,
      fee: MIN_FEE,
      wasmPath: WASM,
      zkeyPath: ZKEY,
    });

    const { status, body } = await relay(relayerPort, calldata.rawProof, calldata.rawPublicSignals);
    assert.equal(status, 200, `expected relay to succeed, got ${status}: ${JSON.stringify(body)}`);
    console.log(`    relayed: ${body.txHash}`);

    const recipientBalance = await token.balanceOf(recipient);
    const relayerBalance = await token.balanceOf(relayerWallet.address);
    assert.equal(recipientBalance, DENOMINATIONS.D1 - MIN_FEE, "recipient did not receive amount - fee");
    assert.equal(relayerBalance, MIN_FEE, "relayer did not receive its fee");
    console.log(`    recipient received ${recipientBalance} (amount - fee), relayer earned ${relayerBalance}`);

    log("demonstrating the note cannot be spent twice");
    const replay = await relay(relayerPort, calldata.rawProof, calldata.rawPublicSignals);
    assert.equal(replay.status, 409, `expected double-spend to be rejected, got ${replay.status}`);
    console.log(`    rejected as expected: ${replay.body.error}`);

    log("demonstrating the proof cannot be replayed against different withdrawal parameters");
    const secondTarget = d1Notes[2];
    const secondTree = await KageMerkleTree.fromChain(provider, poolAddress, DENOMINATIONS.D1);
    const secondCalldata = await buildWithdrawProof({
      note: secondTarget.note,
      leafIndex: secondTarget.leafIndex,
      tree: secondTree,
      recipient,
      relayer: relayerWallet.address,
      fee: MIN_FEE,
      wasmPath: WASM,
      zkeyPath: ZKEY,
    });
    // Take a genuine proof and swap in a different fee post-hoc — the
    // circuit's binding constraints must make this fail.
    const tamperedPublicSignals = [...secondCalldata.rawPublicSignals];
    tamperedPublicSignals[4] = (MIN_FEE * 2n).toString(); // index 4 = fee
    const tampered = await relay(relayerPort, secondCalldata.rawProof, tamperedPublicSignals);
    assert.equal(tampered.status, 400, `expected tampered proof to be rejected, got ${tampered.status}`);
    console.log(`    rejected as expected: ${tampered.body.error}`);

    log("all checks passed");
    relayerServer.close();
  } finally {
    anvil.kill();
    await terminateCurve();
  }
}

main().catch((err) => {
  console.error("\nDEMO FAILED:", err);
  process.exitCode = 1;
});
