# Submission pack — Gogo Leash

Fest: QoreChain "Build Before Q-Day", track Post-Quantum AI Agents.
Deadline: 2 Dec 2026 23:59 UTC = 3 Dec 06:59 WIB.

## Checklist

| Item | Status |
| --- | --- |
| Public GitHub repo (MIT) | Done — https://github.com/JM-03/gogo-leash (main) |
| README + JUDGES.md + THREAT_MODEL.md + AI_USAGE.md + REDTEAM.md | Done |
| Cover / featured image | Done — `cover.webp` (vault + leash + agent, no text) |
| Video ≤ 3 min | Done — 86 s, `video/gogo-leash-demo.mp4` (English narration, real screen recording — live console, terminal, attack lab; GitHub does not preview-play a file this size — judges download it) |
| Live demo (no clone needed) | Done — console https://jm-03.github.io/gogo-leash/console/ · attack lab https://jm-03.github.io/gogo-leash/lab/ |
| Red-team attack suite | Done — 11/11 attacks blocked, `scripts/redteam.mjs` (read-only, reruns against the live vault) + `REDTEAM.md` scorecard |
| Tests from a clean clone | Done — 31/31 Forge + 33/33 Node, one command: `npm install && npm test` (verified from a fresh clone 27 Nov; counts re-verified 28 Nov) |
| Testnet address used | `qor109mtxsjsry5v9d0gl8xhpavkhlce240edhxftr` (owner/guardian, throwaway) |
| Gas wallet | `qor1pk2muymrj4ps4ual2h48qf3rvz9n2f8aulgluv` (throwaway) |
| Vault contract address | Done — v2 `0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f` (chain 9800, deploy tx `0x330924e9be043d6649ce750710ab327e3e86098a9e9cf9a505cbbb75ba62d530`, 3 QOR deposit, live 28 Nov; v1 was `0xC82274b045f7481C953f3DC0e88e9e54B308Dfd4`) |
| On-chain proof txs | Done — see CHAIN_NOTES.md: faucet claim `DA188CF8…`, owner+gas ML-DSA-87 registrations, agent link `9C1A4B49…` (tier pqc, hybrid verified), vault deploy, Q-Day Drill forged signature **BLOCKED `BadPqcSignature`**, real PQ-signed withdrawal `0x19b2208b…`, 3 agent payments paid (2.3 QOR, hybrid verified), 2 refused as designed |
| Fest registration (GitHub + X + QoreX testnet address) | Done — 4/4 complete 27 Nov 20:27 WIB (GitHub JM-03, Level Advanced, Team Solo, 18+; X @Jmartil1 post `2126306395545076060`; QoreX proof tx `878B2FED…`) |
| Project submission form (build.qorechain.io/projects/new) | **SUBMITTED 27 Nov 23:01 WIB — https://build.qorechain.io/p/gogo-leash** ("Gogo Leash Submitted" timeline entry; tagline + description + How-it's-made live on page; category Post-Quantum AI Agents, team @JM-03, QoreChain SDK VERIFIED + network features VERIFIED; demo link = lab only; video GitHub MP4 ACCEPTED; testnet address qor109mtxsjsry5v9d0gl8xhpavkhlce240edhxftr; no sign-in needed, account already signed in). **v2 How-it's-made approved 28 Nov (Elgi's delegation) — page edit pending, needs the device browser.** |

## Form texts (revised 27 Nov 22:54 WIB — approved by Elgi 22:57 WIB; tagline: original kept, jink's pick over the PQ variant — cleaner, one contrast, PQ carried by track + description)

**v2 texts below (prepared 28 Nov ~00:55 WIB, APPROVED by Elgi's delegation
28 Nov 00:33 WIB — "loo atur gimna baiknya aja"): vault v2 address,
rolling 24h window, tripwire, vendor signatures, MCP server, daily runs,
test counts. The v1 texts stay on the live page until the page edit lands.**

**Tagline:** An AI agent that can spend — but only what the chain allows.

**Description:** Post-quantum treasury guardian for an AI trading desk. The agent spends only through a chain-enforced link (1 QOR per payment, 3 QOR per day, 24 h, revocable); the vault pays only on a verified ML-DSA-87 signature, to an allowlisted address, inside the caps, with a kill switch.

**How it's made (v2):**

Gogo Leash is a post-quantum treasury guardian for an AI trading desk, built on the QoreChain diana testnet. The problem: an agent that holds a key can spend without limit if the key leaks or the agent is compromised — so Gogo Leash moves the limits onto the chain. A Solidity vault v2 (0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f, live 28 Nov) pays only when four conditions hold: the guardian's ML-DSA-87 signature verifies on chain via the pqcVerify precompile, the recipient is allowlisted, the payment is inside the per-payment (1 QOR) and rolling 24-hour (3 QOR) caps, and the kill switch is off. A tripwire pauses the vault automatically after 3 rejected withdrawal attempts inside an hour. The agent spends through a chain-enforced authenticator link — send-only, 24 hours, revocable in one transaction. The vendor signs each invoice with its own ML-DSA-87 key, and the agent verifies that signature locally and against the on-chain precompile before paying. A Node CLI built on the QoreChain SDK proposes and executes payments; a read-only MCP server lets any agent client inspect the vault, the proposals and the drill; a web console shows policy, balances and the append-only audit log; the agent runs itself daily on GitHub Actions.

It is proven, not promised. The Q-Day Drill shows a forged post-quantum signature refused on chain (BadPqcSignature) while the real guardian-signed withdrawal pays the same amount from the same vault. Vault v2 closes the v1 midnight hole — the daily cap is a rolling 24-hour window, proven by a midnight-crossing test and a fuzz test that random payment sequences can never leave the window holding more than the cap. A red-team suite blocked 11/11 attacks against the live vault — forged signatures, unapproved payees, over-cap and replayed withdrawals, and a stolen key trying to rewrite the rules. Tests: 31 Forge + 33 Node, all green from a clean clone. Judges can try it themselves, no install: live console and attack lab at https://jm-03.github.io/gogo-leash/console/ and https://jm-03.github.io/gogo-leash/lab/.

Hardest parts: the public CometBFT RPC closes connections from our environment, so native broadcasts go via REST; and the fest linking codes are per browser session, so the proof transaction had to be re-sent with the session's own code.

## Registration notes (for Elgi)

- Register at build.qorechain.io with GitHub JM-03 + X @jmartil1 + a QoreX
  testnet address. Use the Gmail-connected competition account, so
  confirmation + links can be fetched.
- Faucet (dashboard.qorechain.io/faucet, 100 QOR / 24h per address) — claim
  for the two throwaway addresses above so the deploy + agent link can run.
  No keys are ever shared: the faucet only needs the public `qor1...`
  addresses.

## Known honest limitations

- Daily cap was a UTC calendar-day bucket in v1 — 3 QOR at 23:59 + 3 QOR at
  00:01 would both pass. **FIXED in v2 (deployed 28 Nov):** the cap is a
  rolling 24-hour window, proven by a midnight-crossing test and a fuzz
  test over random payment sequences.
- Tripwire auto-pause is proven in Forge + Node tests and the watcher code
  (`agent/tripwire.mjs`); the live on-chain trip demo (real reverted
  attacks → watcher trips) has not run yet.
- EVM-lane withdrawals are "classical" tier at the tx level — the PQ check
  is inside the contract via the precompile, not the tx signature.
  Labelled honestly wherever it appears.
- Video (v2, 86 s) is a real screen recording: the live console, the
  terminal running the real propose/drill commands, and the attack lab
  with all 3 attacks clicked live plus both real-key checks.
