# Benchmarks

Measured on a single developer machine (Apple Silicon, macOS) with
`circom 2.2.3`, `snarkjs 0.7.6`, `forge 1.6.0`, and `@parity/resolc 1.4.0`.
These are illustrative, not authoritative hardware numbers — regenerate them
yourself with:

```
npm run bench -w bench
```

which re-runs everything below from scratch (10 fresh proofs, `forge test
--gas-report`, and a resolc PolkaVM build) rather than reading cached
figures.

## Circuit (`circuits/withdraw.circom`)

| Metric | Value |
|---|---|
| Non-linear + linear constraints | 11,494 |
| Wires | 11,518 |
| Public inputs | 6 (`root, nullifierHash, recipient, relayer, fee, amount`) |
| Private inputs | 42 |
| Proving key (`.zkey`) | 5.1 MB |
| Verification key (`.json`) | 3.8 KB |
| Witness generator (`.wasm`) | 2.4 MB |

## Proof generation & verification (n = 10 runs, Groth16)

| | mean | median | p95 | min | max |
|---|---|---|---|---|---|
| Proof generation | ~900 ms | ~900 ms | ~1.5 s | ~790 ms | ~1.5 s |
| Off-chain verification | ~10 ms | ~10 ms | ~14 ms | ~9 ms | ~14 ms |

Proof generation time is dominated by witness calculation over the 20-level
Merkle inclusion check (20 Poseidon(2) hashes) plus the commitment and
nullifier hashes — small relative to typical Groth16 circuits, so this
comfortably runs client-side in a browser or CLI wallet.

## On-chain gas (Foundry `forge test --gas-report`, local EVM)

| Function | Min | Avg | Median | Max |
|---|---|---|---|---|
| `deposit` | 23,963 | 861,828 | 850,330 | 923,783 |
| `withdraw` | 29,955 | 194,361 | 262,793 | 344,080 |
| `getAnonymitySet` (view) | 6,879 | | | |
| `nullifierSpent` (view) | 2,492 | | | |
| `KageShieldedPool` deployment | 3,124,653 gas / 5,984 bytes | | | |

`deposit`'s cost is dominated by the depth-20 incremental Merkle tree
update (up to 20 `SSTORE`s for `filledSubtrees` plus a new root-history
entry) — this is the same tree-update cost Tornado Cash's original
contracts pay, not something specific to the fixed-denomination design.
Reducing tree depth, or batching multiple deposits into one root update,
are the natural follow-ups if this needs to be cheaper. The min figures
above are revert-path calls (e.g. the disallowed-denomination test), not
real deposits/withdrawals — see the median/max for realistic costs.

## PolkaVM (resolc) bytecode size

Compiled with `npm run build:polkavm -w contracts` (`@parity/resolc`
1.4.0), confirming every deployable contract actually compiles to PolkaVM
bytecode — see `docs/THREAT_MODEL.md` for what this does and doesn't prove
(no live deployment to any pallet-revive chain was attempted from this
repo).

| Contract | Size |
|---|---|
| `KageShieldedPool` | 109.5 KB |
| `PoseidonT3` (library) | 100.9 KB |
| `Groth16Verifier` | 10.7 KB |
| `MockERC20` | 22.0 KB |

`pallet-revive` implements the standard Ethereum `bn128`
add/mul/pairing-check precompiles (addresses `0x06`–`0x08`) that
`Groth16Verifier` calls via `staticcall` — confirmed against Polkadot's
published precompile docs — so the verifier's on-chain proof check has no
known blocker on Kusama Asset Hub beyond an actual deployment being run.

## Known limitations of these numbers

- The Groth16 trusted setup used to generate these keys is a demo-only
  local contribution (see `docs/THREAT_MODEL.md`) — proving/verification
  time and key sizes are still representative, but the keys themselves must
  not be reused for anything real.
- `deposit` gas is the main optimization target if this design were taken
  further; it is unchanged from Tornado Cash's original tree-update cost
  and orthogonal to the fixed-denomination and relayer-binding work this
  repo actually adds.
- No live weight/gas measurement on an actual `pallet-revive` chain was
  taken — PolkaVM gas metering differs from EVM gas, and only bytecode
  size and precompile availability were verified here.
