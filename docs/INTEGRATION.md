# Integration guide

Status: draft, filled in once the circuit and contracts are finalized.

Will cover how another shielded-pool project can adopt two things from this
repo independently of the rest: (1) the fixed-denomination-in-circuit
pattern (`(amount - D1) * (amount - D2) === 0` baked into the commitment),
and (2) the relayer fee-binding pattern (public inputs wired into real
constraints so a relayer cannot alter withdrawal parameters).
