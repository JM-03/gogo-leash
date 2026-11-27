# Decisions — why Gogo Leash is built this way

Each decision below was made against a concrete failure, not a preference.
Dates are WIB, Nov 2026.

## 1. Rolling 24-hour window, not a calendar-day cap (v2, 28 Nov)

v1's daily cap was a UTC calendar-day bucket: 3 QOR at 23:59 + 3 QOR at
00:01 would both pass. That is a hole a patient thief walks through, so
v2 replaced it with a rolling 24-hour window over an append-only
`Payment[]` log. `spentInWindowAmount()` walks newest-first and stops at
the first entry older than 24h. Proven by a midnight-crossing test and a
fuzz test: random payment sequences + time jumps never leave the window
holding more than the cap. `spentTodayAmount()` stays as an alias so v1
tooling keeps working.

## 2. Tripwire is split on-chain / off-chain (v2, 28 Nov)

A reverted `withdraw()` cannot persist a failure counter — the revert
rolls it back. So the tripwire is two halves: on chain, a guardian-only
`trip(uint256 failures)` that pauses the vault and emits `TripwireTripped`;
off chain, `agent/tripwire.mjs` scans the last 200 blocks for reverted
`withdraw()` calls and submits `trip()` when failures-in-window reach the
threshold (3 in 1 hour). The rule itself (`evaluateTripwire`) is pure and
unit-tested. The live on-chain trip demo has not run yet — the logic is
proven in Forge + Node tests only, and that is stated honestly in
`SUBMISSION.md`.

## 3. v1 signatures are dead on v2 (28 Nov)

v2 withdrawals are signed over the tag `"GogoLeash:withdraw:v2"`, so a
signature made for v1 can never pay on v2. Tested
(`testV1SignatureIsDeadOnV2`).

## 4. Vendor signatures are verified before paying (28 Nov)

The vault cannot tell a real invoice from a forged one — both are just an
address and an amount. So the vendor signs each invoice with its own
ML-DSA-87 key, and the agent verifies that signature twice (local SDK
`pqcVerify` + the on-chain precompile) before paying. A tampered signature
or a signature for the wrong amount is refused. This closes the same gap
Invoice Leash closed, with the same pattern.

## 5. The agent runs itself daily on GitHub Actions (28 Nov)

The daily run (09:00 WIB) re-links the agent, pays READY proposals,
reports vault status, runs the red-team suite and the tripwire watch. It
lives on GitHub Actions instead of a PC cron because the log is public
(judges can read every run), it survives the PC being off, and it cannot
be silently edited. The workflow is 504-tolerant: if GitHub cannot
download Foundry, the install step continues and the red-team suite scores
only the live cases (5 local Foundry cases skipped, documented).

## 6. The MCP server is read-only by design (28 Nov)

`agent/mcp-server.mjs` holds no key and exposes no spend tool — five
read-only tools (vault status, proposals, evaluation, drill, tripwire).
Any agent client can inspect the vault; none can move money through it.

## 7. Native broadcasts go via REST, not the public RPC (27 Nov)

The public CometBFT RPC closes CosmJS connections from this environment,
so `agent/common.mjs` signs locally and broadcasts via REST
`POST /cosmos/tx/v1beta1/txs` (`BROADCAST_MODE_SYNC`). Gas is fixed at
800000, fee = gasLimit × 0.15 uqor. The same REST path is used by
`scripts/window.mjs`.

## 8. Video is a real screen recording, not slides (27–28 Nov)

Judges trust what they can see run. The 86 s video is a real recording:
live console, terminal replaying the real `propose` + `attack` outputs,
and the attack lab with all 3 attacks clicked live plus both real-key
checks. Re-recorded against vault v2 on 28 Nov ~05:15 WIB (sha256
`4f183bdc35…`, 3.14 MB): console, terminal, lab and close card all show
the v2 vault; the first cut showed v1.

## 9. No personal data in the public repo (27 Nov)

The owner's personal email was found in a public doc once and removed the
same day (still visible in earlier git history — disclosed to the owner).
The repo now carries no personal email anywhere; the git identity is
"Gogo Maduro <gogo-maduro@example.invalid>".
