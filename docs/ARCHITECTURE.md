# Architecture

Status: draft, filled in as each component lands. See root README for the quickstart.

## Overview

Kage is a shielded pool for a single ERC20-style test asset, deployed as one
contract (`KageShieldedPool`) that supports a small, fixed set of deposit
denominations (initially 1 and 10 units). Each denomination gets its own
Merkle tree of commitments inside the same contract, so the anonymity set for
each denomination is countable and independent.

```
 depositor                          KageShieldedPool                withdrawer / relayer
 ---------                          -----------------                --------------------
 pick amount in {D1, D2}
 sample nullifier, secret
 commitment = Poseidon(nullifier, secret, amount)
      |
      | deposit(amount, commitment)
      v
                              transferFrom(depositor, pool, amount)
                              insert commitment into tree[amount]
                              emit Deposit(amount, commitment, leafIndex, root)

 ... time passes, more deposits land in both trees ...

 build Merkle path for own leaf
 generate Groth16 proof for withdraw.circom
 (root, nullifierHash, recipient, relayer, fee, amount are public)
      |
      | POST /relay {proof, publicSignals}  ---->  relayer service
                                                     off-chain verify
                                                     submit withdraw() tx, pays gas
                                                          |
                                                          v
                                                 verify proof on-chain
                                                 check root known, nullifier unspent
                                                 transfer amount-fee to recipient
                                                 transfer fee to relayer
                                                 emit Withdrawal(...)
```

## Why one pool with per-denomination trees, not one contract per denomination

Tornado Cash's original design deploys a separate contract per denomination,
so "amount" is implicit in which contract you call — the contract itself
only ever holds one fixed value. That does not protect a pool where a single
contract (or a UI in front of it) is expected to support multiple
denominations: nothing stops a modified client from depositing an arbitrary
amount into a pool whose anonymity-set accounting assumes uniform
denominations. Once one non-standard deposit lands, every later withdrawal
proof from that tree can potentially be correlated back to it by amount,
degrading the whole set.

Kage instead bakes the amount into the commitment
(`Poseidon(nullifier, secret, amount)`) and constrains it inside the circuit:
`(amount - D1) * (amount - D2) === 0`. A proof for a non-allowed amount
cannot be constructed, full stop — this isn't a client-side or contract-side
check that a modified frontend could skip, it's a property of the arithmetic
circuit itself. The contract re-checks the allow-list on top as cheap
defense in depth, but the circuit is the actual guarantee.

## Circuit (`circuits/withdraw.circom`)

Public signals: `root, nullifierHash, recipient, relayer, fee, amount`
Private signals: `nullifier, secret, pathElements[20], pathIndices[20]`

1. `commitment = Poseidon(nullifier, secret, amount)`
2. `nullifierHash = Poseidon(nullifier)`
3. Merkle inclusion: walk `pathElements`/`pathIndices` with Poseidon(2) at
   each level, constrain the computed root equals the public `root`.
4. Fixed denomination: `(amount - D1) * (amount - D2) === 0`.
5. Fee bound: `fee < amount` via a `LessThan` range check.
6. Binding: `recipient`, `relayer` are wired into real constraints (forced
   "square" signals) so they are genuinely part of the R1CS instance, not
   just unused public inputs — a proof cannot be replayed with different
   withdrawal parameters (Tornado Cash's anti-malleability pattern).

## Relayer trust model

The relayer is untrusted for privacy (it never learns the depositor's
identity beyond what the proof reveals, which is nothing) but is trusted for
liveness/fee-honesty in this MVP: it could refuse to relay, or attempt to
front-run/censor. It cannot alter `recipient`, `relayer`, or `fee` and still
produce a valid proof, because those are bound into the SNARK's public
inputs (see above). See `docs/THREAT_MODEL.md` for the full list of
assumptions and known limitations.

## Anonymity set / privacy score (dashboard)

The dashboard counts total commitments ever inserted into each
denomination's tree as that denomination's anonymity set size, and derives a
simple heuristic score `100 * ln(1 + setSize) / ln(1 + target)` capped at
100, where `target` is a configurable "healthy set size" per denomination.
This is intentionally simple and is *not* a rigorous unlinkability metric —
see `docs/THREAT_MODEL.md`.
