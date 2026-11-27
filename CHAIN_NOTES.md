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
