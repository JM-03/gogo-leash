# Gogo Leash — 5-minute route for judges

## What it is

An AI trading-desk agent on a post-quantum leash. The agent proposes
payments; the **chain** decides whether they happen.

## 1 minute — the idea

- `contracts/GogoLeashVault.sol`: money leaves only with the guardian's
  ML-DSA-87 signature (checked on chain by the `pqcVerify` precompile), to
  an allowlisted recipient, inside a per-payment + daily cap, with the kill
  switch off.
- `agent/leash.mjs`: the agent spends from the owner account only through a
  chain-enforced authenticator link (`send` only, 1 QOR/payment, 3 QOR/day,
  24 h, revocable in one tx). Limits live on chain, not in agent code.

## 2 minutes — run the drill (no funds needed for the local part)

```bash
pnpm install
pnpm test          # 11 forge tests + 13 node tests, all green
node agent/leash.mjs propose   # scores 5 desk proposals, refuses 2 (stranger, daily cap)
```

## 2 minutes — the on-chain proof

- Vault + agent transactions: see `CHAIN_NOTES.md` for the explorer links and
  the `pqc_hybrid_verify` evidence.
- Q-Day drill: `node agent/vault.mjs attack <to> 0.5` — an attacker with the
  classical key but a forged ML-DSA-87 signature is refused by the vault
  (`BadPqcSignature`), live and free via simulation; the real refusal tx is
  in `CHAIN_NOTES.md`.
- Kill switch: `node agent/leash.mjs revoke` then `pay` → refused by the
  chain (`linked key is unbound or revoked`).

## Where to look

- `README.md` — architecture, quickstart, honest limits.
- `THREAT_MODEL.md` — what is protected, what is not, and what we assume.
- `agent/audit.jsonl` — every proposal, decision and tx, append-only.
- `agent/console/` — `pnpm console`, then http://localhost:8787.
