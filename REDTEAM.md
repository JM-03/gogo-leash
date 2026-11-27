# Red-team scorecard — Gogo Leash

**Score: 11/11 attacks blocked** (re-run against vault v2, 28 Nov 2026).
Run `node scripts/redteam.mjs` to reproduce
it yourself — no keys, no gas, no transactions. Every live attack is a
read-only `eth_call` against the deployed vault v2
[`0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f`](https://explore.qore.network/address/0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f)
on the qorechain-diana testnet. Results are also saved in
`scripts/redteam-results.json`.

Note on the daily CI run: if forge cannot be installed on the runner
(the Foundry release download has 504'd on GitHub's side), the 5 local
Foundry cases are skipped and that run scores the 6 live attacks; a real
forge test failure still fails the run. The local cases stay proven here
in the repo (31/31 Forge).

## Live attacks (against the real vault)

| # | Attack | Expected | Got | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Forged ML-DSA-87 signature (4,627 random bytes, 0.5 QOR, allowlisted, within caps) | `BadPqcSignature` `0xf35e1976` | `0xf35e1976` | BLOCKED |
| 2 | Unapproved payee (0.5 QOR to an address never allowlisted) | `NotAllowlisted` `0x6f7a5275` | `0x6f7a5275` | BLOCKED |
| 3 | Over per-payment cap (2 QOR, cap is 1 QOR) | `OverPerTxCap` `0xc8c92ec8` | `0xc8c92ec8` | BLOCKED |
| 4 | Replay of the real v2 0.8 QOR withdrawal (`0xe5e33881…`, nonce already spent) | `BadPqcSignature` `0xf35e1976` or `OverDailyCap` `0x92ec8899` | `0x92ec8899` | BLOCKED |
| 5 | Non-guardian tries `setAllowlisted` (stolen agent key changes the rules) | `NotGuardian` `0xef6d0f02` | `0xef6d0f02` | BLOCKED |
| 6 | Non-guardian tries `setCaps` (stolen agent key lifts the limits) | `NotGuardian` `0xef6d0f02` | `0xef6d0f02` | BLOCKED |

## Local attacks (Foundry — states the live vault cannot reach without real money moving)

| # | Attack | Test | Verdict |
| --- | --- | --- | --- |
| 7 | Over daily cap (spent 2 QOR, then 1 QOR more) | `testOverDailyCapIsRefused` | BLOCKED |
| 8 | Kill switch on (paused vault) | `testKillSwitchBlocksWithdrawals` | BLOCKED |
| 9 | Only guardian can pause | `testOnlyGuardianCanPause` | BLOCKED |
| 10 | Guardian key not registered | `testUnregisteredGuardianKeyIsRefused` | BLOCKED |
| 11 | Guardian key not proven | `testUnprovenGuardianKeyIsRefused` | BLOCKED |

## What the attacks prove

- **A stolen classical key buys nothing.** The agent's key can only ask the
  vault to pay; it cannot change the allowlist, raise the caps, pause or
  unpause anything (attacks 5, 6, 9). The PQ signature is the only thing that
  authorises money out, and it never leaves the guardian.
- **A forged PQ signature buys nothing.** The vault reads the guardian's
  registered ML-DSA-87 key from the chain and verifies with the `pqcVerify`
  precompile on every withdrawal (attack 1).
- **A signature works once, on one vault, on one chain.** The signed message
  binds the chain id, the vault address, the recipient, the amount and the
  nonce (attack 4).
- **The rules live in the contract, not in the agent's code.** A bug, a prompt
  injection, or a stolen agent server cannot lift them (attacks 2, 3, 5, 6).

## Known limitation — stated, not hidden

The v1 daily cap was a **UTC calendar-day bucket**. 3 QOR at 23:59 plus 3 QOR
at 00:01 would both pass. **Fixed in v2 (deployed 28 Nov 2026):** the cap is
a **rolling 24h window**, proven by a midnight-crossing test and a fuzz test
over random payment sequences. V2 also adds a **tripwire**: 3 rejected
withdrawals inside 1 hour auto-pause the vault until the guardian reopens
it — proven in Forge + Node tests and the watcher code, but the live
on-chain trip demo has not run yet.

Why attack 4 lists two expected reverts: v2 checks the rolling-window cap
**before** the signature. While the window holds 2.3 QOR, replaying the
0.8 QOR withdrawal is refused as `OverDailyCap` (2.3 + 0.8 > 3); once the
window slides it is refused as `BadPqcSignature` (the signature binds the
spent nonce). Either way the replay cannot pay.
