# Daily live agent runs

The agent runs itself every day on GitHub Actions
(`.github/workflows/daily-agent.yml`, 09:00 WIB, plus a manual
**Run workflow** button on the Actions tab). Each run is a fresh on-chain
proof that Gogo Leash is a live system, not a one-off demo.

## What one run does

1. **Link** — re-links the agent key to the owner account (send-only,
   1 QOR per payment, 3 QOR per day, 24 h expiry). The link from the
   previous day has expired by then, so this is a real fresh link.
2. **Run** — evaluates the 5 proposals in `agent/proposals.json` and pays
   the READY ones (normally 3, totalling 2.3 QOR). The vendor-signed
   invoice (`INV-2026-11-001`) is verified before paying; the unknown
   sender and the over-cap proposal are refused as designed.
3. **Vault status** — prints the live v2 vault state (balance, caps,
   spent in the rolling 24 h window, kill switch, tripwire).
4. **Red-team suite** — re-runs the 11 attack checks against the live
   vault (read-only, no keys, no gas).
5. **Tripwire watch** — one scan for reverted withdrawals; if 3 land
   inside an hour it trips the vault itself. A small EVM window is opened
   first so a real trip can land.

A green run means all of that happened on chain. A red run is a visible
alarm — check the Actions log, not a silent failure.

## Activation (needs Elgi, once, in the GitHub web UI)

The workflow is in the repo, but it cannot run until 4 secrets exist
(repo → **Settings → Secrets and variables → Actions → New repository
secret**). All four are the existing **throwaway diana-testnet-only**
keys — never a real key, never a mainnet key:

| Secret | Value (from the VM, never paste it in chat) |
| --- | --- |
| `GOGO_OWNER_MNEMONIC` | the owner mnemonic in `~/.config/gogo-leash/owner.env` |
| `GOGO_GAS_MNEMONIC` | the gas mnemonic in `~/.config/gogo-leash/agent.env` |
| `GOGO_AGENT_ED25519_KEY` | the agent ed25519 key in `~/.config/gogo-leash/agent.env` |
| `GOGO_PRIVATE_KEY` | the owner EVM key in the repo `.env` |

After the secrets are set, run it once by hand (Actions → Daily live
agent run → Run workflow) and check it goes green before relying on the
schedule.

## Runway

Each run pays ~2.3 QOR from the owner account. The owner held ~87 QOR
after the 28 Nov run — about 37 days of daily runs, past the 16 Dec
judging. Top up from the faucet (100 QOR / 24 h) if it ever runs low.
