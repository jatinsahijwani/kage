# Kage

Kage is a small, open-source toolkit for making shielded pools on Kusama
Asset Hub actually private in practice, not just in the UI. It targets the
two failures that most commonly break a mixer's anonymity-set assumptions:

1. **Denomination amounts enforced only in the frontend.** A modified
   client can deposit a non-standard amount, poisoning the pool's
   anonymity accounting. Kage bakes the amount into the deposit commitment
   and constrains it to a fixed allow-list *inside the ZK circuit*
   (`(amount - D1) * (amount - D2) === 0`) — there is no witness for a
   non-allowed amount, so no proof can exist for one.
2. **No relayer, so withdrawing requires the destination address to
   already hold gas** — an on-chain link between depositor and withdrawer.
   Kage ships a minimal relayer that submits the withdrawal for you, paid
   from the shielded funds themselves, with the fee and recipient bound
   into the SNARK's public inputs so the relayer can't tamper with either.

See `docs/ARCHITECTURE.md` for the full design, `docs/THREAT_MODEL.md` for
what this does and doesn't guarantee, and `docs/INTEGRATION.md` if you want
to lift either pattern into an existing pool.

## Layout

| Path | What |
|---|---|
| `circuits/` | `withdraw.circom` — fixed-denomination + relayer-binding ZK circuit, trusted setup, tests |
| `contracts/` | `KageShieldedPool.sol` + generated Groth16 verifier, Foundry tests, resolc/PolkaVM build |
| `sdk/` | `@kage/sdk` — notes, off-chain Merkle tree, proof builder, devnet helpers |
| `relayer/` | Minimal Express relayer service |
| `dashboard/` | Static anonymity-set monitor (per-denomination set size + privacy score) |
| `demo/` | `e2e.ts` — full deposit → relayed-withdraw flow on a local chain |
| `bench/` | Regenerates `docs/BENCHMARKS.md` |

## Quickstart

Requires `node` (>=20), `circom`, `snarkjs`, and Foundry (`forge`/`anvil`)
already installed.

```
npm run setup   # installs deps, compiles the circuit, runs trusted setup,
                 # builds contracts — see scripts/setup-dev.sh
npm run demo    # deploys everything to a local anvil chain, deposits
                 # several notes, withdraws one through the relayer, and
                 # demonstrates double-spend + tamper rejection
```

Expected `npm run demo` output ends with:

```
[8] all checks passed
```

To poke around individual pieces:

```
npm test -w circuits    # circuit positive + negative constraint tests
cd contracts && forge test --gas-report
npm test -w sdk
npm test -w relayer      # spins up its own anvil + deployment
npm test -w dashboard    # same
npm run bench -w bench   # regenerates docs/BENCHMARKS.md
```

To look at the dashboard against your own deployment:

```
npm run dev -w dashboard
# open http://localhost:5173/?rpc=http://127.0.0.1:8545&pool=0x...
```

## Deploying beyond a local chain

Everything above runs against a local `anvil` chain. This repo does not
deploy anywhere else — see `docs/THREAT_MODEL.md` for exactly why (the
trusted setup here is demo-only) before pointing any of this at a real
network. `contracts/scripts/build-polkavm.sh` compiles the contracts to
PolkaVM bytecode via `resolc` as a build-correctness check; see
`docs/BENCHMARKS.md` for the resulting sizes and what was and wasn't
verified about running on an actual `pallet-revive` chain.

## License

MIT, see `LICENSE`. The generated Groth16 verifier
(`contracts/src/generated/Verifier.sol`) carries snarkjs's own GPL-3.0
header, as snarkjs-generated verifiers normally do — everything else in the
repo is MIT.
