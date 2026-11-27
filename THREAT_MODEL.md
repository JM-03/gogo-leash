# Threat model

## What Gogo Leash protects against

| Attack | Protection | Where enforced |
| --- | --- | --- |
| Classical (secp256k1) key stolen — incl. a future quantum break of it | Vault withdrawals need the guardian's ML-DSA-87 signature, verified on chain by `pqcVerify` | `GogoLeashVault.withdraw` |
| Signature replayed for a second withdrawal | Message binds chain id + vault + recipient + amount + nonce; nonce increments before payment | `withdrawalMessage`, `nonce` |
| Agent server compromised / prompt-injected into overspending | Per-payment + daily caps + allowlist in the vault contract; authenticator link limits on the native lane | Contract + chain authenticator rules |
| Agent key stolen | The agent key holds no money; one `revoke` transaction switches it off; worst case is the daily limit | Authenticator link, `revoke` |
| Guardian's EVM window abused while open | Window is scoped (600 blocks, 5 txs, value-bounded) and the vault still demands the PQ signature for every withdrawal | EVM window + vault |
| Vault drained to an unknown address | Allowlist: only guardian-approved recipients | `allowlisted` mapping |

## What it does NOT protect against

- **Guardian's ML-DSA-87 key stolen.** If both keys are gone, the vault
  pays. Mitigation: the guardian key lives in the owner's wallet; rotation
  is possible on chain and the vault reads the registered key fresh on every
  withdrawal — but rotation must happen *before* the theft is used.
- **Guardian's own device compromised.** The guardian is the trust root.
  The leash limits the *agent*, not the owner.
- **Smart-contract bugs.** The vault is unaudited demo code (testnet only).
  `audit/` in Workshop 2's example shows the pattern we followed: draft,
  audit, fix, re-audit. This repo has local tests, not a professional audit.
- **EVM lane honesty.** Ethereum-style transactions carry no post-quantum
  signature (`qore-cli pq status` reports `tier: classical, reason:
  evm_lane`). The vault's PQ protection is the contract checking an
  ML-DSA-87 signature via the precompile — plus the scoped EVM window.
- **Chain / precompile compromise.** We trust QoreChain's `pqcVerify` and
  `pqcKeyStatus` precompiles and the ML-DSA-87 implementation.
- **Price-feed manipulation.** Signal scoring uses a local price series for
  the demo; a production desk must source prices from a trusted feed and
  treat the score as a filter, not a decision.

## Assumptions

- Testnet only. QOR here has no value; no real funds are ever at stake.
- The owner and the guardian are the same account (solo builder).
- The allowlist and caps in `agent/policy.json` mirror the on-chain values;
  the chain is authoritative when they disagree.
