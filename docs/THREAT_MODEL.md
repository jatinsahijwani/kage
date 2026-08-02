# Threat model & known limitations

This document lists what Kage actually guarantees, what it assumes, and
where those assumptions could break. Read it before deploying anything
built on this repo with real value.

## Trusted setup

`circuits/withdraw.circom` uses Groth16, which needs a per-circuit trusted
setup. This repo's setup (`circuits/scripts/setup.sh`) is:

- **Phase 1 (Powers of Tau):** reused from the public Hermez/iden3
  "Perpetual Powers of Tau" ceremony (many independent contributors) — this
  part is legitimate and widely reused across the ecosystem.
- **Phase 2 (circuit-specific):** a **single local contribution made by
  whoever runs the script**, with no multi-party ceremony and no
  destruction of toxic waste beyond trusting that one run. This is
  explicitly a demo/development setup.

**Do not deploy the checked-in `contracts/src/generated/Verifier.sol` or
reuse the `.zkey` it came from for anything holding real value.** Whoever
generated them could theoretically forge withdrawal proofs. A real
deployment needs a proper multi-party phase-2 ceremony (or a switch to a
universal-setup proof system like Plonk, which trades a larger proof/higher
gas for no per-circuit ceremony).

## Fixed-denomination guarantee

The core claim — that a withdrawal proof cannot exist for a non-allowed
amount — rests on the circuit constraint
`(amount - D1) * (amount - D2) === 0` and on `amount` being folded into the
commitment (`Poseidon(nullifier, secret, amount)`) that's actually inserted
into the tree at deposit time. This is a soundness property of the R1CS
system, not a runtime check, so it holds regardless of what a malicious or
modified client sends to the contract. `KageShieldedPool.deposit` and
`.withdraw` additionally check the amount against `denominationAllowed`
on-chain — this is redundant with the circuit by design (cheap
defense-in-depth against, e.g., a future circuit bug), not the primary
guarantee.

Extending the allowed set (more than two denominations) requires
recompiling the circuit and rerunning trusted setup — the values are
compile-time constants in `withdraw.circom`'s `component main` line, not
contract-configurable. This is intentional: allowing the contract owner to
add denominations without a circuit change would reopen exactly the
UI-only-enforcement problem this repo exists to fix.

## Relayer trust model

The relayer in `relayer/` is:

- **Untrusted for privacy.** It never learns anything about the depositor;
  the proof reveals nothing beyond the six public signals
  (`root, nullifierHash, recipient, relayer, fee, amount`). It cannot
  construct a link between a specific deposit and a specific withdrawal
  from the proof alone.
- **Trusted for liveness/censorship resistance in this MVP.** A single
  relayer can refuse to relay a valid proof, or simply go offline. There is
  no fallback relayer discovery, fee market, or self-withdrawal path
  implemented here — a production deployment should run multiple
  independent relayers (or let users self-relay by funding their own
  withdrawal address off-chain) so no single relayer is a liveness
  bottleneck.
- **Cannot alter withdrawal parameters.** `recipient`, `relayer`, and `fee`
  are wired into real circuit constraints (the `recipientSquare`/
  `relayerSquare` forced-use signals, and the `fee < amount` range check),
  so a relayer that tries to redirect funds or change its own fee
  invalidates the proof — `KageShieldedPool.withdraw` reconstructs the
  public-input array from the caller-supplied arguments and checks it
  against the proof, so tampering is caught on-chain even if a relayer's
  own off-chain check were skipped or buggy.
- **Timing/metadata risk still exists.** A relayer (or anyone watching the
  mempool) can observe *when* a withdrawal happens and correlate it with
  gas-payer address, IP address (if not using Tor/a VPN), or timing
  patterns relative to deposits. Kage does not attempt to solve this class
  of problem — it only removes the specific "withdrawal address must
  already hold gas" leak.

## Anonymity set / privacy score

The dashboard's "anonymity set size" is simply the total number of
commitments ever inserted into a denomination's tree
(`KageShieldedPool.leafCount`). This is a useful, easy-to-verify proxy, but
it overstates real privacy in at least two ways:

- It doesn't discount commitments that have already been withdrawn — a
  withdrawn note is still counted as part of the set (which is standard for
  this kind of mixer: the *possibility space* for a given withdrawal is all
  deposits made before it, spent or not, since spentness isn't public per
  se beyond the nullifier).
- It says nothing about the actual distribution of *when* deposits and
  withdrawals happen. A pool with 500 total deposits but where 490 of them
  happened in one burst a year ago and stayed unspent offers much weaker
  real-world unlinkability for a withdrawal happening today than the raw
  count suggests.

The `privacyScore` is a simple `100 * ln(1 + setSize) / ln(1 + target)`
heuristic, log-scaled against a configurable "healthy" target size and
capped at 100. It is meant to give a rough at-a-glance signal, not a
rigorous unlinkability metric. Don't build automated trust decisions on it.

## Nullifier and root-history assumptions

- `ROOT_HISTORY_SIZE = 30` (see `contracts/src/MerkleTreeWithHistory.sol`):
  a withdrawal proof generated against a tree root is valid as long as no
  more than 30 deposits (for that denomination) have landed since. A note
  held too long relative to deposit volume for its denomination could need
  its Merkle path recomputed against a newer root — the SDK's
  `KageMerkleTree.fromChain` handles this by resyncing from events, but the
  *proof* still has to be regenerated with the fresh root before
  submitting.
- Nullifier hashes are tracked per-pool, not per-denomination-tree; this is
  fine because `Poseidon(nullifier)` collisions across independently
  sampled 31-byte random nullifiers are cryptographically negligible.

## Scope not covered by this MVP

- No live deployment to any Kusama Asset Hub / Westend Asset Hub network —
  everything above was verified against a local Foundry/anvil chain plus a
  best-effort `resolc` PolkaVM compilation (see `docs/BENCHMARKS.md`).
- No support for native KSM (only a demo ERC20-style test asset).
- No relayer fee market, discovery mechanism, or multi-relayer redundancy.
- No formal audit of the circuit or contracts. This is a reference
  implementation of a pattern, not production-audited code.
