# Gogo Leash — a post-quantum treasury guardian for an AI trading desk

[![Chain: QoreChain diana testnet](https://img.shields.io/badge/chain-QoreChain%20diana%20testnet-6b5ce7)](https://explore.qore.network)
[![Tests: 31/31 Forge + 33/33 Node](https://img.shields.io/badge/tests-31%2F31%20Forge%20%2B%2033%2F33%20Node-green)](CHAIN_NOTES.md)
[![Cost: $0 testnet](https://img.shields.io/badge/cost-%240%20testnet-blue)](CHAIN_NOTES.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Track:** Post-Quantum AI Agents — QoreChain "Build Before Q-Day" developer fest
**Builder:** Gogo Maduro (solo) · **Chain:** QoreChain testnet `qorechain-diana` only
**Status:** ✅ LIVE on testnet — vault v2 deployed (rolling 24h window + tripwire auto-pause), 3 agent payments paid, Q-Day drill blocked a forged signature and a real guardian withdrawal paid; vendor-signed invoices verified before paying; read-only MCP server; the agent runs itself daily on GitHub Actions
**Live demo (no install):** [treasury console](https://jm-03.github.io/gogo-leash/console/) — vault state read live from the chain · [attack lab](https://jm-03.github.io/gogo-leash/lab/) — try the 3 attacks yourself, then verify the real signature and the real payment

An AI trading agent proposes payments and settlements, but **nothing moves
unless the chain says so**:

1. Every withdrawal from the desk vault needs the guardian's **ML-DSA-87
   post-quantum signature**, verified on chain by QoreChain's `pqcVerify`
   precompile. A stolen classical (secp256k1) key alone pays nothing.
2. The vault enforces an **allowlist of recipients**, a **per-payment cap**
   and a **rolling 24-hour cap**, plus a guardian **kill switch** and a
   **tripwire** that pauses the vault automatically after 3 rejected
   withdrawal attempts inside an hour. All of it lives in
   the contract, not in the agent's code.
3. The agent itself spends from the owner account only through a
   chain-enforced **authenticator link**: `send` only, per-payment and daily
   limits, 24-hour expiry, revocable in one transaction.
4. Every proposal, decision and transaction is written to an append-only
   **audit log** (`agent/audit.jsonl`).

## Live on testnet (all verifiable on [explore.qore.network](https://explore.qore.network))

> Explorer links open on Mainnet by default — switch it to Testnet (diana) first, or the transactions show as "not found".

| What | Address / tx |
| --- | --- |
| **Vault v2** | [`0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f`](https://explore.qore.network/address/0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f) — 3 QOR deposit, 0.7 QOR left after 3 withdrawals (rolling 24h window, tripwire) |
| **Owner / guardian** | `qor109mtxsjsry5v9d0gl8xhpavkhlce240edhxftr` (EVM `0x7976B342501928c2b5E8f9cd70f596bfF19555f9`) |
| **Agent link** | 1 QOR/payment, 3 QOR/day, 24h, tier `pqc` hybrid-verified — tx `9C1A4B49C83E3DCD1B9299025A7C5410C831041D1DA0E6C67614CF9770495938` |
| **Payments paid** | 0.8 / 0.5 / 1.0 QOR — txs `F96612BECA02D6337A4E53488DD5699C3E1336783CF743905327B68E3F3091B6`, `CC6672ABB4B8A9F7A994514A51029C6F889F7A5E46E857C6C38FDBE6CC00D7B2`, `1B08400B39C3F2FECF77B3541C449BE16A913D2B28E0F96A028DC26257C2AC56` |
| **Q-Day drill** | forged PQ signature refused (`BadPqcSignature`); real 0.8 QOR withdrawal paid — tx [`0xe5e33881dbe9b183505d6b4b31f5d480264a33d9ab5a335b4ab47f8b0b08e45b`](https://explore.qore.network/tx/6FD5D69E45DDFB8240DD2019A5BFC335607CF7BDF90DD7CC30A44BC585DD5AC4) |
| **Vendor signatures** | the vendor signs each invoice with its own ML-DSA-87 key; the agent verifies it locally + against the on-chain `pqcVerify` precompile before paying — real invoice `INV-2026-11-001` VERIFIED, tampered + wrong-amount REFUSED — see `agent/vendor-sig.mjs` |
| **MCP server** | read-only stdio JSON-RPC (`agent/mcp-server.mjs`, 5 tools: vault status, proposals, evaluation, drill, tripwire) — no keys, no spend |
| **Daily live runs** | the agent runs itself every day on GitHub Actions (09:00 WIB): re-link, pay READY proposals, vault status, red-team, tripwire watch — see [DAILY_RUNS.md](DAILY_RUNS.md) |
| **Red-team** | **11/11 attacks blocked** against the live vault — forged signature, unapproved payee, over-cap, replay, stolen agent key (live) + daily cap, kill switch, unregistered/unproven key (Forge) — see [REDTEAM.md](REDTEAM.md) |

## The Q-Day drill (the demo)

`node agent/leash.mjs drill` plays the attacker who stole the classical key:

- a vault withdrawal signed with a random ML-DSA-87 key is **refused on
  chain** (`BadPqcSignature`) — verified live on testnet;
- a payment attempted after the agent link is revoked is **refused**
  (`linked key is unbound or revoked`);
- a real guardian-signed withdrawal of 0.8 QOR **pays** (tx
  `0xe5e33881dbe9b183505d6b4b31f5d480264a33d9ab5a335b4ab47f8b0b08e45b`).

The point: when Q-Day comes — or a key leaks today — the most a compromised
agent can lose is its daily limit, and one transaction stops it.

## Try it in 2 minutes (no keys, no faucet)

```bash
# tools: node >= 22, npm or pnpm, foundry
npm install            # or: pnpm install (via corepack: corepack enable && corepack prepare pnpm@latest --activate)
npm run forge-std      # one-time: install forge-std
npm test               # 33 Node tests + 31 Forge tests — green, no account needed
```

## Layout

| Path | What it is |
| --- | --- |
| `contracts/GogoLeashVault.sol` | Vault v1: PQ-signed withdrawals + allowlist + caps + kill switch |
| `contracts/GogoLeashVaultV2.sol` | Vault v2: rolling 24h window + tripwire auto-pause (v1 signatures are dead on it) |
| `test/GogoLeashVault.t.sol` | Forge tests v1 (mocked precompiles via `vm.etch`) |
| `test/GogoLeashVaultV2.t.sol` | Forge tests v2 incl. midnight-crossing + rolling-window fuzz invariant |
| `script/DeployGogoLeash.s.sol` | Foundry deploy script (testnet) |
| `script/DeployGogoLeashV2.s.sol` | Foundry deploy script for v2 |
| `agent/leash.mjs` | The agent CLI: keys, link, pay, propose, run, revoke, drill |
| `agent/policy.mjs` | Pure leash policy engine (allowlist, caps, kill switch) |
| `agent/signal.mjs` | Pure proposal scoring (EMA trend + momentum filter) |
| `agent/tripwire.mjs` | Tripwire watcher: scans for reverted withdrawals, trips the vault |
| `agent/mcp-server.mjs` | Read-only MCP server (stdio JSON-RPC, 5 tools, no keys) |
| `agent/vendor-sig.mjs` | Vendor invoice signatures: sign + verify (local + on-chain precompile) |
| `agent/proposals.json` | Sample desk intents the agent evaluates |
| `agent/console/` | Tiny web console: policy, balances, rules, audit tail |
| `.github/workflows/daily-agent.yml` | Daily live agent run (09:00 WIB) — see [DAILY_RUNS.md](DAILY_RUNS.md) |
| `scripts/window.mjs` | Open/check the EVM authorisation window (deploy path) |
| `scripts/redteam.mjs` | Red-team suite (read-only, 11 attacks vs the live v2 vault) |

## Quickstart (testnet only, throwaway keys only)

```bash
# tools: node >= 22, pnpm >= 9, foundry
pnpm install
forge test            # vault logic, no account needed

# agent keys (testnet throwaways, stored in ~/.config/gogo-leash/, mode 0600)
node agent/leash.mjs owner-init
node agent/leash.mjs init
node agent/leash.mjs whoami
# fund owner + gas wallet from the faucet (100 QOR / 24h): dashboard.qorechain.io/faucet
node agent/leash.mjs register owner
node agent/leash.mjs register gas
node agent/leash.mjs link 1 3        # 1 QOR per payment, 3 QOR per day, 24h
node agent/leash.mjs propose         # score proposals, no chain writes
node agent/leash.mjs run agent/proposals.json
node agent/leash.mjs drill           # Q-Day drill (needs a deployed vault for part 1)

# vault (needs an open EVM window first)
cp .env.example .env   # fill PRIVATE_KEY + QORE_PQC_RECOVERY_CODE (testnet only)
node scripts/window.mjs register
node scripts/window.mjs open
forge script script/DeployGogoLeash.s.sol --rpc-url qorechain_testnet --broadcast
```

Never put a real key, a real recovery phrase, or mainnet funds in `.env` or
any file in this repo. `.env` and `~/.config/gogo-leash/` are git-ignored.

## Honest limits

- The EVM lane carries **no** post-quantum signature itself; the vault's
  protection is the contract checking an ML-DSA-87 signature via the
  precompile, plus the scoped EVM window. `qore-cli pq status` on a vault
  withdrawal honestly reports `tier: classical, reason: evm_lane`.
- The authenticator's relaying key is ed25519 (authenticators accept only
  classical keys today); the vault contract makes that key insufficient on
  its own for vault money.
- Signal scoring is a deterministic paper filter (EMA trend + momentum), not
  a live market feed and not financial advice. No real funds are ever at
  stake: testnet QOR has no value.
- Prize note: the fest's official site states a **$20,000 total pool** and
  that rules/prizes/dates "are not final and may still change". Any per-track
  split quoted elsewhere is unconfirmed until the official Rules page says so.

## Submission

- Public repo, MIT licence. Testnet address used: see `SUBMISSION.md`
  (filled in after the testnet deploy).
- Video (≤ 3 min): `docs/VIDEO_SCRIPT.md`.
- Judges' 5-minute route: `JUDGES.md`.
- Threat model and measured chain notes: `THREAT_MODEL.md`, `CHAIN_NOTES.md`.
- AI usage: `AI_USAGE.md`.
