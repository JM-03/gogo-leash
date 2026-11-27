# Submission pack — Gogo Leash

Fest: QoreChain "Build Before Q-Day", track Post-Quantum AI Agents.
Deadline: 2 Dec 2026 23:59 UTC = 3 Dec 06:59 WIB.

## Checklist

| Item | Status |
| --- | --- |
| Public GitHub repo (MIT) | Done — https://github.com/JM-03/gogo-leash (main) |
| README + JUDGES.md + THREAT_MODEL.md + AI_USAGE.md + REDTEAM.md | Done |
| Cover / featured image | Done — `cover.webp` (vault + leash + agent, no text) |
| Video ≤ 3 min | Done — 85 s, `video/gogo-leash-demo.mp4` (English narration, all frames from real outputs; GitHub does not preview-play a file this size — judges download it) |
| Live demo (no clone needed) | Done — console https://jm-03.github.io/gogo-leash/console/ · attack lab https://jm-03.github.io/gogo-leash/lab/ |
| Red-team attack suite | Done — 11/11 attacks blocked, `scripts/redteam.mjs` (read-only, reruns against the live vault) + `REDTEAM.md` scorecard |
| Tests from a clean clone | Done — 11/11 Forge + 13/13 Node, one command: `npm install && npm test` (verified from a fresh clone 27 Nov) |
| Testnet address used | `qor109mtxsjsry5v9d0gl8xhpavkhlce240edhxftr` (owner/guardian, throwaway) |
| Gas wallet | `qor1pk2muymrj4ps4ual2h48qf3rvz9n2f8aulgluv` (throwaway) |
| Vault contract address | Done — `0xC82274b045f7481C953f3DC0e88e9e54B308Dfd4` (chain 9800, deploy tx `0x4ccc61539d60789d72d5b4adfbf6e6294c5d4c20aad9dbf686c269f05e7e5218`, 2 QOR deposit) |
| On-chain proof txs | Done — see CHAIN_NOTES.md: faucet claim `DA188CF8…`, owner+gas ML-DSA-87 registrations, agent link `9C1A4B49…` (tier pqc, hybrid verified), vault deploy, Q-Day Drill forged signature **BLOCKED `BadPqcSignature`**, real PQ-signed withdrawal `0x19b2208b…`, 3 agent payments paid (2.3 QOR, hybrid verified), 2 refused as designed |
| Fest registration (GitHub + X + QoreX testnet address) | Done — 4/4 complete 27 Nov 20:27 WIB (GitHub JM-03, Level Advanced, Team Solo, 18+; X @Jmartil1 post `2126306395545076060`; QoreX proof tx `878B2FED…`) |
| Project submission form (build.qorechain.io/projects/new) | Pending — tagline + "How it's made" text await Elgi's approval; form already filled up to that point, then paused |

## Registration notes (for Elgi)

- Register at build.qorechain.io with GitHub JM-03 + X @jmartil1 + a QoreX
  testnet address. Use the Gmail-connected competition account, so
  confirmation + links can be fetched.
- Faucet (dashboard.qorechain.io/faucet, 100 QOR / 24h per address) — claim
  for the two throwaway addresses above so the deploy + agent link can run.
  No keys are ever shared: the faucet only needs the public `qor1...`
  addresses.

## Known honest limitations

- Daily cap is a UTC calendar-day bucket — 3 QOR at 23:59 + 3 QOR at 00:01
  would both pass. Vault v2 (rolling 24h window + tripwire auto-pause) is
  planned 29–30 Nov; see REDTEAM.md.
- EVM-lane withdrawals are "classical" tier at the tx level — the PQ check
  is inside the contract via the precompile, not the tx signature.
  Labelled honestly wherever it appears.
- Video (v2, 86 s) is a real screen recording: the live console, the
  terminal running the real propose/drill commands, and the attack lab
  with all 3 attacks clicked live plus both real-key checks.
