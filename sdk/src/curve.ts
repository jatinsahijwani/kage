// @ts-expect-error no published types for snarkjs
import * as snarkjs from "snarkjs";

// snarkjs/ffjavascript keep a shared worker-thread pool alive for BN254
// curve arithmetic once any groth16 proving/verification has happened, so
// short-lived scripts (tests, the demo, one-shot CLI tools) hang forever
// after finishing unless that pool is explicitly torn down. Long-running
// processes (the relayer server) should NOT call this.
export async function terminateCurve(): Promise<void> {
  const curve = await snarkjs.curves.getCurveFromName("bn128");
  await curve.terminate();
}
