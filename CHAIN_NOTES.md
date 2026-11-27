# Chain notes — measured, not promised

All facts below were observed live on the QoreChain diana testnet or the
official site/docs. Nothing here is invented; every tx hash was read back
from the chain (REST + explorer).

## Network (checked 27 Nov 2026 ~14:05 WIB, re-verified 18:07 WIB)

- REST `https://api-testnet.qore.host` — live. Node info: network
  `qorechain-diana`, app `qorechain`, CometBFT 0.38.26.
- RPC `https://rpc-testnet.qore.host` — answers HTTP 200 on `/status` and
  JSON-RPC `status` via curl, BUT it closes CosmJS connections from this VM
  (`fetch failed, other side closed` on `StargateClient.connect`). All native
  broadcasts in this repo therefore go through REST
  (`POST /cosmos/tx/v1beta1/txs`, `BROADCAST_MODE_SYNC`) — see
  `agent/common.mjs` `broadcast()`. Same fix applied to `scripts/window.mjs`.
- EVM RPC `https://evm-testnet.qore.host`, chain id 9800.
- Explorer: `https://explore.qore.network`.

## Accounts (throwaways generated for this project only)

- Owner / guardian: `qor109mtxsjsry5v9d0gl8xhpavkhlce240edhxftr`
  (EVM `0x7976B342501928c2b5E8f9cd70f596bfF19555f9`)
- Gas wallet / demo vendor: `qor1pk2muymrj4ps4ual2h48qf3rvz9n2f8aulgluv`
  (EVM `0x0d95bE136395430Af3BF55Ea702623608B3524FD`)
- Keys live in `~/.config/gogo-leash/` (mode 0600), never in the repo.
- `qore-cli pq status` on the owner: `registered: true, algorithm: ML-DSA-87`.

## Faucet (done 27 Nov 2026 18:07 WIB)

- Dashboard sign-in is AWS Cognito; the owner signed in with Google
  (the registered competition account) and accepted the dashboard Terms
  of Service.
- Claim 1 — SUCCEEDED: 100 QOR (+ 1000 fUSD, 0.5 fETH, 0.02 fBTC test
  tokens) to the owner address.
  Tx `DA188CF8CF3F4F07928B9162A82032E041B7A7198C68280BA35086EB6B449F99`
  ([explorer](https://explore.qore.network/tx/DA188CF8CF3F4F07928B9162A82032E041B7A7198C68280BA35086EB6B449F99)).
- Claim 2 — BLOCKED by the faucet: "Rate Limit Reached — Rate limited for
  another 23:59" (one claim per 24 h per account AND per address). Retry
  after ~28 Nov 18:07 WIB. The gas wallet was instead funded with 5 QOR by
  the owner on chain (tx `40B26D3D4BBDA4361A31A501B6998A32FE9ABE91880ED9068E195CBF0DBD5CE1`).

## On-chain evidence (27 Nov 2026, evening WIB)

All native-lane txs verified with `qore-cli pq status` (tier `pqc` =
hybrid secp256k1 + ML-DSA-87, 1 layer). EVM-lane txs are honestly labelled
`tier: classical` (EVM lane: keccak-256 + secp256k1, no ML-DSA-87 layer) —
the vault's PQ check happens inside the contract via the `pqcVerify`
precompile, not in the tx signature.

| Step | Tx | Result |
| --- | --- | --- |
| Register owner ML-DSA-87 key | `ABAAB225D2A1DEBCD0689F57F1B26B345707F04C1561EDEBB835C0C759F378B1` (height 10846052, code 0, gas 298429) | key registered |
| Fund gas wallet 5 QOR | `40B26D3D4BBDA4361A31A501B6998A32FE9ABE91880ED9068E195CBF0DBD5CE1` | gas balance 5 QOR |
| Register gas ML-DSA-87 key | `E6D1B58E4892DECCE6540A63A70C1B84288A39CDD1D45805F1F0AF766D6B4622` | key registered |
| Link agent (1 QOR/tx, 3 QOR/day, 24 h) | `9C1A4B49C83E3DCD1B9299025A7C5410C831041D1DA0E6C67614CF9770495938` (height 10846079) | `tier: pqc`, hybrid verified |
| Open EVM window (600 blocks, 5 txs) | `0ABED5B20CB8674632509EA4386AC8AE8F3441AFC4D556DBE466C2CC4568CBDC` | window live |
| Deploy `GogoLeashVault` (2 QOR deposit) | `0x4ccc61539d60789d72d5b4adfbf6e6294c5d4c20aad9dbf686c269f05e7e5218` | vault `0xC82274b045f7481C953f3DC0e88e9e54B308Dfd4` |
| Allowlist demo vendor (gas EVM) | `0x664eb43719de488925abd5eb53a0c7192c8cf2b1d8404fd1821e7457c05c87b3` | allowlisted |
| Q-Day Drill — forged PQ signature | (simulation, no tx) | **BLOCKED: `BadPqcSignature`** |
| Real PQ-signed withdrawal 0.5 QOR | EVM `0x19b2208bbccd04233e40b29705ae6148243ba5a0349b56d583cbd62bc8ea6fea` (native record `A534F1AAD2CC61B17ACF62626F3035F71CC0296EBFA80372EDC6352B5140FABF`, height 10846173, code 0) | WITHDRAWN, `tier: classical` (EVM lane) |
| Second withdrawal 0.5 QOR (video take) | EVM `0xc45070e7a9081c30653d6558cb689f133e6b6126e90bbe8702e9d6878fb04ab4` (native record `983EFFA35C4EF4BFEF9CC0C75F34105E7F2AAF1AE46F06308110F499B70E966D`, height 10849064, code 0) | WITHDRAWN, receipt status 0x1 |
| Agent pays 0.8 QOR (Server hosting) | `F96612BECA02D6337A4E53488DD5699C3E1336783CF743905327B68E3F3091B6` | PAID, hybrid verified |
| Agent pays 0.5 QOR (Domain renewal) | `CC6672ABB4B8A9F7A994514A51029C6F889F7A5E46E857C6C38FDBE6CC00D7B2` | PAID, hybrid verified |
| Agent pays 1 QOR (API credits top-up) | `1B08400B39C3F2FECF77B3541C449BE16A913D2B28E0F96A028DC26257C2AC56` | PAID, hybrid verified |
| Unknown sender 5 QOR | (no tx) | REFUSED — not allowlisted |
| 0.9 QOR after daily cap spent | (no tx) | REFUSED — exceeds daily remainder 0.7 QOR |

Vault after the drill: 1.5 QOR, 1 withdrawal, spent today 0.5 QOR, kill
switch off. Balances read back from the chain: owner 90.05 QOR
(100 faucet − 5 to gas − 2.3 agent payments − ~2.65 tx fees); gas wallet
7.32 QOR (5 funded + 0.5 vault withdrawal + 2.3 agent payments − ~0.48
fees). Agent link expires 24 h after the link tx (~28 Nov 18:0x WIB).

## Local test evidence (no chain)

- `forge test`: 11 passed, 0 failed (vault: good/bad/replayed sig, allowlist,
  per-tx + daily caps, daily reset, kill switch, unregistered/unproven key).
- `node --test agent/`: 13 passed, 0 failed (policy engine + signal scorer).
- `node agent/leash.mjs propose`: 5 proposals — 3 READY (2.3 QOR), 2 refused
  (unknown sender not allowlisted; 0.9 QOR over daily remainder 0.7 QOR).

## Vault v2 — deployed 28 Nov 2026 ~00:30 WIB

Why v2 (see REDTEAM.md): v1's daily cap was a UTC calendar-day bucket —
3 QOR at 23:59 plus 3 more at 00:01 slipped through. V2 counts every payment
in a rolling 24-hour window, and adds a tripwire: 3 rejected withdrawal
attempts inside 1 hour pauses the vault automatically (watcher,
`agent/tripwire.mjs`, submits `trip()`; the vault cannot count rejections
itself because a reverted `withdraw()` rolls its counter back too).

| Step | Tx | Result |
| --- | --- | --- |
| Open EVM window (600 blocks, 12 txs) | `864B3364534A17E3CD46C91EC1BA2D901ABA321F5D3662F25E6F1BE3BB4050D3` | window live |
| Deploy `GogoLeashVaultV2` (3 QOR deposit) | `0x330924e9be043d6649ce750710ab327e3e86098a9e9cf9a505cbbb75ba62d530` | vault `0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f` |
| Allowlist demo vendor (gas EVM) | `0xf5d7a2c5e03a59b2c1d88d49ae4fd6a7000272341163ca89380796d0f277be37` | allowlisted |
| Guardian-signed withdrawal 0.8 QOR | `0xe5e33881dbe9b183505d6b4b31f5d480264a33d9ab5a335b4ab47f8b0b08e45b` | WITHDRAWN, nonce 0 → 1 |
| Guardian-signed withdrawal 0.5 QOR | `0x1251e86d902c2f903b53f7b6d0451a4f3c488ac309ae0d66458cd0fe4e1db2ed` | WITHDRAWN, nonce 1 → 2 |
| Guardian-signed withdrawal 1.0 QOR | `0xef20982fbbb18c8ce798f1098f9b0c20975a60a02c572c60329620ff3518d358` | WITHDRAWN, nonce 2 → 3 |

Vault v2 after the payments: 0.7 QOR, nonce 3, spent in rolling window
2.3 QOR, caps 1 QOR/payment, 3 QOR/rolling 24h, kill switch off, tripwire
0 trips (3 rejections inside 3600 s trips it). Top-up 28 Nov ~05:15 WIB:
owner deposited 0.3 QOR (`0xb3d0356cf2212b18511e74e68343dc5ba8ee1422413bc0422aefa7ad9c8c7c33`,
window `3F96A4FDD1CD40EE97543FA955285F0F8C658CBF67230A5AC1A22BAA34583B4A`) so the
vault holds exactly 1.0 QOR — the figure the demo video narration states.
Live tripwire demo (real reverted attacks → watcher trips) not yet run on v2.

## Local test evidence, v2 (no chain)

- `forge test`: 31 passed, 0 failed (11 v1 + 20 v2, incl. the
  midnight-crossing test — cap does NOT reset at midnight — and the
  window-sliding test, plus tripwire pause/unpause and v1-signature-dead-on-v2).
  Re-verified from a clean clone 28 Nov ~05:00 WIB (`npm install && npm test`).
- `node --test agent/`: 33 passed, 0 failed (13 policy + signal, 6 tripwire
  rule, 10 MCP server, 4 vendor-sig).

## Vendor PQ signatures — verified live 28 Nov 2026 ~00:40 WIB

The vendor (gas wallet) signs each invoice with its own ML-DSA-87 key;
the agent verifies the signature locally AND against the on-chain
pqcVerify precompile before paying (`agent/vendor-sig.mjs`, wired into
`agent/leash.mjs pay()` — a proposal carrying `vendorSig` must verify).

- Invoice `INV-2026-11-001`: 0.8 QOR to the vendor, vault v2
  `0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f`. Signature 4627 bytes.
- Live verify: VERIFIED (local ML-DSA-87 + on-chain precompile).
- Tampered signature: REFUSED (local=false, on-chain=false).
- Same signature, wrong amount (0.5 QOR): REFUSED (local=false, on-chain=false).
- Agent run 28 Nov ~00:45 WIB (`node agent/leash.mjs run`, link still live
  until 18:19 WIB): vendor signature INV-2026-11-001 VERIFIED, then PAID
  0.8 QOR hybrid ML-DSA-87 verified, tx
  `8F951F54C746B3294D711F7A489B3D1822E3587890AC36416579327FE74080AA`;
  Domain renewal 0.5 QOR PAID tx
  `B609E911C31759A81C9B9F9EFDB3C61F1A2E67FC18C23A84872A134A76F9E657`;
  API credits 1 QOR PAID tx
  `A92EA3249376F8DC68171BF46B10B6BF04E9C02ADE7BF5F98D8F1EB1CA9E3586`.
  2 proposals skipped as designed (unknown sender, over daily remainder).

## MCP server — live smoke test 28 Nov 2026 ~00:20 WIB

`agent/mcp-server.mjs` (stdio JSON-RPC, read-only, 5 tools). Against the
real v2 vault: `vault_status` returned 0.7 QOR / 3 withdrawals / 2.3 QOR
spent in window / kill switch off; `drill_attack` returned BLOCKED with
revert `0xf35e1976` (BadPqcSignature).

## Local test evidence, v2 final (no chain)

- `forge test`: 31 passed, 0 failed (11 v1 + 20 v2, incl. a fuzz test:
  random payment sequences + time jumps can never leave the rolling
  window holding more than the daily cap).
- `node --test agent/`: 33 passed, 0 failed (policy + signal 13,
  tripwire 6, MCP server 10, vendor-sig 4).
