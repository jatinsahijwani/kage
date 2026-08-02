import express from "express";
import { readFile } from "node:fs/promises";
// @ts-expect-error no published types for snarkjs
import * as snarkjs from "snarkjs";
import { config } from "./config.js";
import { pool, wallet, provider } from "./chain.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

let vkeyCache: unknown;
async function getVkey() {
  if (!vkeyCache) vkeyCache = JSON.parse(await readFile(config.vkeyPath, "utf8"));
  return vkeyCache;
}

function addressFromField(value: string): string {
  return "0x" + BigInt(value).toString(16).padStart(40, "0");
}

app.get("/status", async (_req, res) => {
  const balance = await provider.getBalance(wallet.address);
  res.json({ relayerAddress: wallet.address, balance: balance.toString(), poolAddress: config.poolAddress });
});

// Clients must fetch this *before* generating a proof: `relayer` and `fee`
// are baked into the SNARK's public inputs, so a proof built for the wrong
// relayer address or a fee below the relayer's minimum can never be
// relayed successfully — regenerating it is the only fix.
app.get("/fee/:denomination", (req, res) => {
  const denomination = BigInt(req.params.denomination);
  res.json({
    denomination: denomination.toString(),
    minFee: config.minFeeFor(denomination).toString(),
    relayerAddress: wallet.address,
  });
});

app.post("/relay", async (req, res) => {
  try {
    const { proof, publicSignals } = req.body ?? {};
    if (!proof || !Array.isArray(publicSignals) || publicSignals.length !== 6) {
      res.status(400).json({ error: "malformed request body" });
      return;
    }

    const [root, nullifierHash, recipientField, relayerField, feeStr, denominationStr] = publicSignals;
    const fee = BigInt(feeStr);
    const denomination = BigInt(denominationStr);
    const recipient = addressFromField(recipientField);
    const relayerAddress = addressFromField(relayerField);

    if (relayerAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      res.status(400).json({ error: "proof is not addressed to this relayer" });
      return;
    }
    if (fee < config.minFeeFor(denomination)) {
      res.status(400).json({ error: "fee below relayer minimum" });
      return;
    }
    if (!(await pool.denominationAllowed(denomination))) {
      res.status(400).json({ error: "denomination not allowed" });
      return;
    }
    if (await pool.nullifierSpent(nullifierHash)) {
      res.status(409).json({ error: "note already spent" });
      return;
    }
    if (!(await pool.isKnownRoot(denomination, root))) {
      res.status(400).json({ error: "unknown merkle root" });
      return;
    }

    const vkey = await getVkey();
    const validOffChain = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!validOffChain) {
      res.status(400).json({ error: "invalid proof" });
      return;
    }

    const calldataStr: string = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const [pA, pB, pC] = JSON.parse(`[${calldataStr}]`);

    const tx = await pool.withdraw(pA, pB, pC, root, nullifierHash, recipient, relayerAddress, fee, denomination);
    const receipt = await tx.wait();

    res.json({ txHash: receipt.hash, blockNumber: receipt.blockNumber, fee: fee.toString() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

if (process.env.KAGE_RELAYER_NO_LISTEN !== "1") {
  app.listen(config.port, () => {
    console.log(`kage relayer listening on :${config.port}`);
    console.log(`relayer address: ${wallet.address}`);
    console.log(`pool: ${config.poolAddress}`);
  });
}

export { app };
