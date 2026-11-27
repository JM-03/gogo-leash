# Gogo Leash — 5-minute route for judges

## What it is

An AI trading-desk agent on a post-quantum leash. The agent proposes
payments; the **chain** decides whether they happen.

## 1 minute — the idea

- `contracts/GogoLeashVaultV2.sol`: money leaves only with the guardian's
  ML-DSA-87 signature (checked on chain by the `pqcVerify` precompile), to
  an allowlisted recipient, inside a per-payment (1 QOR) + rolling 24-hour
  (3 QOR) cap, with the kill switch off. A tripwire pauses the vault
  automatically after 3 rejected withdrawal attempts inside an hour.
  Vault v2: `0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f` (diana testnet,
  deployed 28 Nov, 3 QOR deposit).
- `agent/leash.mjs`: the agent spends from the owner account only through a
  chain-enforced authenticator link (`send` only, 1 QOR/payment, 3 QOR/day,
  24 h, revocable in one tx). Limits live on chain, not in agent code.
- The vendor signs each invoice with its own ML-DSA-87 key; the agent
  verifies that signature locally and against the on-chain precompile
  before paying (`agent/vendor-sig.mjs`).

## 2 minutes — run the checks (no keys, no funds, no network for tests)

```bash
npm install            # 84 packages, ~20 s
npm test               # 31/31 Forge + 33/33 Node, all green from a clean clone
npm run verify         # npm test + the red-team suite (read-only, live vault)
```

`forge coverage` (28 Nov): vault v2 100% lines, 95.7% statements,
100% functions; v1 78% lines. Deploy scripts are 0% (they are not tested).

Try the agent's decisions without spending anything:

```bash
node agent/leash.mjs propose   # scores 5 desk proposals, refuses 2 (stranger, daily cap)
```

## 2 minutes — the on-chain proof

- Vault + agent transactions: see `CHAIN_NOTES.md` for the explorer links
  and the `pqc_hybrid_verify` evidence. Explorer defaults to Mainnet —
  switch it to Testnet (diana) first, or the transactions show as "not found".
- Q-Day drill: `node agent/vault.mjs attack <to> 0.5` — an attacker with the
  classical key but a forged ML-DSA-87 signature is refused by the vault
  (`BadPqcSignature`), live and free via simulation; the real refusal tx is
  in `CHAIN_NOTES.md`. Try it in the browser, no install:
  https://jm-03.github.io/gogo-leash/lab/
- Red-team score: **11/11 attacks blocked** — 6 live against the vault + 5 in
  Forge tests; see `REDTEAM.md`, or run it yourself (read-only, no keys, no
  gas): `node scripts/redteam.mjs`.
- Kill switch: `node agent/leash.mjs revoke` then `pay` → refused by the
  chain (`linked key is unbound or revoked`).
- Daily live runs: the agent runs itself every day on GitHub Actions
  (09:00 WIB) — re-link, pay READY proposals, vault status, red-team,
  tripwire watch. Latest run green; see `DAILY_RUNS.md`.

## Where to look

- `README.md` — architecture, quickstart, honest limits.
- `DECISIONS.md` — why the rolling window, why the tripwire is split
  on/off chain, why daily runs live on GitHub Actions.
- `THREAT_MODEL.md` — what is protected, what is not, worst case first.
- `agent/audit.jsonl` — every proposal, decision and tx, append-only.
- `agent/console/` — `npm run console`, then http://localhost:8787.
