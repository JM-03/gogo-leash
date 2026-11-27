# Video script — Gogo Leash (≤ 3 minutes)

Target: 2:45 spoken (~400 words). Screen: console + terminal + explorer.
Elgi records; this is the script + shot list only.

## 0:00–0:20 — Hook

> "A quantum computer breaks your wallet key one day. What happens to your
> trading desk's money the next minute?"
>
> [Shot: console, kill switch OFF, vault balance visible.]

## 0:20–0:50 — The problem

> "Today an AI trading agent holds a key and its limits live in its own
> code. One bug, one stolen server, and the limits are gone. Gogo Leash
> moves the limits onto the chain."
>
> [Shot: README architecture — vault + agent + chain.]

## 0:50–1:40 — The demo, live

1. `node agent/leash.mjs propose` — five desk bills evaluated. Three READY,
   one refused: unknown sender, not allowlisted. One refused: over the daily
   cap. "The agent refuses before spending gas."
2. `node agent/leash.mjs run` — the three READY bills pay; explorer links
   show `pqc_hybrid_verify: verified`.
   [Shot: terminal + explorer tx pages.]
3. Q-Day drill: `node agent/vault.mjs attack` — the attacker stole the
   classical key and signs with a forged post-quantum key. "BLOCKED by the
   vault: BadPqcSignature." Then the real withdrawal with the guardian's key
   pays. "Same vault, same amount — the signature is the difference."

## 1:40–2:20 — How it works

> "Two lanes. The agent spends through a chain-enforced link: send only,
> 1 QOR per payment, 3 per day, 24 hours, revocable in one transaction. The
> vault pays only with an ML-DSA-87 signature checked on chain, to an
> allowlisted address, inside the caps, with the kill switch off."
>
> [Shot: contract code — withdraw checks; console rules page.]

## 2:20–2:45 — Close

> "When Q-Day comes — or a key leaks today — the most a compromised agent
> can lose is its daily limit, and one transaction stops it. Gogo Leash:
> the desk keeps trading, the money stays leashed."
>
> [Shot: repo URL + testnet addresses + explorer links on screen.]

## Recording notes

- Record the terminal runs for real; do not fake output. If a live call
  fails, keep the take and say what happened — the drill failing closed is
  the point.
- Keep the vault address + tx hashes on screen at the end (from
  CHAIN_NOTES.md).
- No music bed needed; plain voiceover is fine.
