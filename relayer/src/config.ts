import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

export const config = {
  rpcUrl: required("RPC_URL"),
  privateKey: required("PRIVATE_KEY"),
  poolAddress: required("POOL_ADDRESS"),
  vkeyPath: required("VKEY_PATH"),
  port: Number(process.env.PORT ?? 8787),
  minFeeFor(denomination: bigint): bigint {
    const value = process.env[`MIN_FEE_${denomination.toString()}`];
    return value ? BigInt(value) : 0n;
  },
};
