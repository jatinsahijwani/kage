# Threat model & known limitations

Status: draft, expanded as the implementation lands.

This document will cover: trusted-setup provenance (the phase-2 contribution
used in this repo is a local demo contribution, not a multi-party ceremony —
do not reuse the checked-in `.zkey` for anything holding real value), relayer
liveness/censorship assumptions, nullifier/root-history edge cases, and the
limits of the anonymity-set heuristic used by the dashboard.
