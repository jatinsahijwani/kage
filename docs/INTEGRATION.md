# Integration guide

Kage is two independently reusable patterns wrapped around a working
reference implementation. You don't have to adopt the whole repo — the
circuit-level fixed-denomination constraint and the relayer fee-binding
pattern each stand on their own and can be dropped into an existing
shielded pool.

## Pattern 1: fixed denomination enforced in-circuit

**Problem this solves:** if your pool's frontend is the only thing
checking that a deposit amount matches an allowed value, a modified or
malicious client can deposit a non-standard amount. Once that happens, the
amount itself becomes a correlation signal, and every later withdrawal from
that tree is a little less anonymous.

**The fix, in three pieces:**

1. Bake the amount into the commitment: `commitment = Poseidon(nullifier, secret, amount)` instead of `Poseidon(nullifier, secret)`. See `circuits/withdraw.circom`'s `commitmentHasher`.
2. Add an equality-product constraint over your allowed set:
   `(amount - D1) * (amount - D2) === 0` (extend with more factors for more
   denominations — `(amount-D1)*(amount-D2)*(amount-D3) === 0`, etc.). This
   is a hard constraint: there is no witness that satisfies it for any
   other value, so no proof can be generated for a non-allowed amount, full
   stop.
3. Make `amount` a public signal so the contract can independently check
   `denominationAllowed[amount]` before moving funds (`KageShieldedPool.sol`'s
   `deposit`/`withdraw`) — belt-and-suspenders on top of the circuit
   guarantee, not a replacement for it.

**To adopt this in an existing circuit:** if your circuit already does
Merkle-inclusion + nullifier verification (most Tornado-derived designs
do), the change is additive: extend your commitment hash to take `amount`
as a third input, add the product constraint, and add `amount` to your
public signal list. You'll need a new trusted setup (or a new Plonk/STARK
proving key) since the circuit itself changed — see
`circuits/scripts/setup.sh` for the pattern, and `docs/THREAT_MODEL.md` for
why you must not reuse a demo-only setup.

## Pattern 2: relayer fee/parameter binding

**Problem this solves:** letting a relayer submit your withdrawal
transaction is only safe if the relayer can't tamper with the payout —
redirect funds to itself, inflate its own fee, or replay your proof for a
different fee after the fact.

**The fix:** make `recipient`, `relayer`, and `fee` public signals *that
the circuit actually constrains*, not just declares:

```circom
// force these into the R1CS instance rather than leaving them as
// unconstrained public inputs
signal recipientSquare;
recipientSquare <== recipient * recipient;
signal relayerSquare;
relayerSquare <== relayer * relayer;

component feeCheck = LessEqThan(66);
feeCheck.in[0] <== fee;
feeCheck.in[1] <== amount;
feeCheck.out === 1;
```

Then, on-chain, reconstruct the public-input array from the *caller's
function arguments* (not from anything the relayer separately asserts) and
verify against that:

```solidity
uint256[6] memory pubSignals = [root, nullifierHash,
    uint256(uint160(recipient)), uint256(uint160(relayer)), fee, denomination];
require(verifier.verifyProof(pA, pB, pC, pubSignals), "invalid proof");
```

If a relayer changes `recipient`, `relayer`, or `fee` between receiving the
proof and submitting the transaction, the reconstructed public-input array
no longer matches what the SNARK was proven against, and `verifyProof`
returns `false`. This is the same mechanism Tornado Cash uses; the point of
calling it out here is that it's easy to get wrong by leaving a public
signal *declared* but not actually wired into any constraint, which does
**not** provide this guarantee (Circom will happily compile a circuit where
`recipient` is public but never appears on the left or right of any
constraint — that circuit's proofs are freely replayable against a
different recipient).

**Relayer service shape** (see `relayer/src/server.ts` for a complete
version): expose `GET /fee/:denomination` so clients know what fee to bake
into the proof *before* generating it (proof generation happens client-side
and can't be redone cheaply), and have `POST /relay` do, in order:
off-chain `groth16.verify()` (don't spend gas on a bad proof), a minimum-fee
check, a "is this proof addressed to me" check (`relayer` public signal ==
this service's own address), then submit the transaction.

## Reusing the SDK directly

`sdk/` (`@kage/sdk`) is not published to npm, but it's a plain TypeScript
workspace package — copy it, or `npm install` it from a git dependency, if
you want the note format, off-chain Merkle tree, or proof-building helpers
without the rest of the repo. Its pieces are independent:

- `note.ts` — note encode/decode, commitment/nullifier-hash helpers.
- `merkleTree.ts` — off-chain Poseidon(2) tree mirroring the on-chain one,
  syncable from `Deposit` events (`KageMerkleTree.fromChain`).
- `proof.ts` — witness construction + `snarkjs.groth16.fullProve` +
  Solidity calldata formatting, in one call (`buildWithdrawProof`).
- `curve.ts` — `terminateCurve()`, needed in any short-lived script (tests,
  CLIs, the demo) that calls into snarkjs, or the Node process hangs after
  finishing (see the comment in that file for why).

## What's specific to this repo and not part of either pattern

`KageShieldedPool`'s per-denomination tree design (one contract, N
independent trees) is a implementation choice that happens to pair well
with pattern 1, but pattern 1 works just as well with Tornado's original
one-contract-per-denomination layout if that's what you're starting from —
the circuit constraint doesn't care how many contracts sit in front of it.
