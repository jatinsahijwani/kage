// Local-devnet-only helpers: deploying the pool stack from Foundry build
// artifacts and depositing notes. Used by the relayer's integration tests
// and demo/e2e.ts — never intended for talking to a real deployment (real
// deployments should use a proper migration/deploy script, not this).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Contract, ContractFactory, type Wallet } from "ethers";
import { commitmentOf, type Note } from "./note.js";

async function loadArtifact(contractsDir: string, relPath: string) {
  const raw = await readFile(path.join(contractsDir, "out", relPath), "utf8");
  const json = JSON.parse(raw);
  return { abi: json.abi, bytecode: json.bytecode.object as string };
}

// PoseidonT3.hash is `public` (see src/generated/PoseidonT3.sol for why),
// so solc emits an unresolved `__$<hash>$__` link placeholder everywhere
// KageShieldedPool calls it. forge resolves this automatically for
// `forge test`/`forge script`; deploying the raw artifact bytecode
// ourselves means we have to link it by hand, exactly like solc/forge do.
function linkLibrary(bytecode: string, placeholderToAddress: Record<string, string>): string {
  let linked = bytecode;
  for (const [placeholder, address] of Object.entries(placeholderToAddress)) {
    const addressHex = address.replace(/^0x/, "").toLowerCase().padStart(40, "0");
    linked = linked.split(placeholder).join(addressHex);
  }
  return linked;
}

export interface DeployedPool {
  token: Contract;
  verifier: Contract;
  pool: Contract;
}

export async function deployPool(
  deployer: Wallet,
  contractsDir: string,
  denominations: bigint[],
): Promise<DeployedPool> {
  const tokenArtifact = await loadArtifact(contractsDir, "MockERC20.sol/MockERC20.json");
  const verifierArtifact = await loadArtifact(contractsDir, "Verifier.sol/Groth16Verifier.json");
  const poseidonArtifact = await loadArtifact(contractsDir, "PoseidonT3.sol/PoseidonT3.json");
  const poolArtifact = await loadArtifact(contractsDir, "KageShieldedPool.sol/KageShieldedPool.json");

  // Managed explicitly: some local dev nodes' "pending" nonce reporting
  // lags their own instamining just enough that back-to-back
  // ContractFactory.deploy() calls relying on automatic nonce lookup race
  // and collide.
  let nonce = await deployer.getNonce("pending");

  const token = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer).deploy({
    nonce: nonce++,
  });
  await token.waitForDeployment();

  const verifier = await new ContractFactory(verifierArtifact.abi, verifierArtifact.bytecode, deployer).deploy({
    nonce: nonce++,
  });
  await verifier.waitForDeployment();

  const poseidon = await new ContractFactory(poseidonArtifact.abi, poseidonArtifact.bytecode, deployer).deploy({
    nonce: nonce++,
  });
  await poseidon.waitForDeployment();

  const poseidonAddress = await poseidon.getAddress();
  const placeholders = poolArtifact.bytecode.match(/__\$[0-9a-f]+\$__/g) ?? [];
  const linkedPoolBytecode = linkLibrary(
    poolArtifact.bytecode,
    Object.fromEntries(placeholders.map((p) => [p, poseidonAddress])),
  );

  const pool = await new ContractFactory(poolArtifact.abi, linkedPoolBytecode, deployer).deploy(
    await verifier.getAddress(),
    await token.getAddress(),
    denominations,
    { nonce: nonce++ },
  );
  await pool.waitForDeployment();

  return {
    token: new Contract(await token.getAddress(), tokenArtifact.abi, deployer),
    verifier: new Contract(await verifier.getAddress(), verifierArtifact.abi, deployer),
    pool: new Contract(await pool.getAddress(), poolArtifact.abi, deployer),
  };
}

// Mints enough tokens for `note.denomination`, approves the pool, deposits
// the note's commitment, and returns its on-chain leaf index.
export async function depositNote(pool: Contract, token: Contract, depositor: Wallet, note: Note): Promise<number> {
  const commitment = await commitmentOf(note);
  let nonce = await depositor.getNonce("pending");
  const tokenAsDepositor = token.connect(depositor) as Contract;
  await (await tokenAsDepositor.mint(depositor.address, note.denomination, { nonce: nonce++ })).wait();
  await (await tokenAsDepositor.approve(await pool.getAddress(), note.denomination, { nonce: nonce++ })).wait();
  const tx = await (pool.connect(depositor) as Contract).deposit(note.denomination, commitment, { nonce: nonce++ });
  const receipt = await tx.wait();
  const event = receipt.logs.map((l: any) => {
    try {
      return pool.interface.parseLog(l);
    } catch {
      return null;
    }
  }).find((e: any) => e?.name === "Deposit");
  if (!event) throw new Error("Deposit event not found in receipt");
  return Number(event.args.leafIndex);
}
