# AI usage

This project was built with an AI coding assistant (Muse) working from the
official QoreChain documentation (Workshop 2 guide, "Before you start",
precompile reference) and the public Workshop 2 example repository
(`github.com/qorechain/build-before-qday`, Apache-2.0).

What the assistant did:

- Read the Workshop 2 guide and the public example code to learn the SDK
  surface (`@qorechain/sdk` 0.14.0, `@qorechain/evm`, the EVM window flow,
  the authenticator link flow, `pqcSign` / `generatePqcKeypair`).
- Wrote the original implementation in this repo: `GogoLeashVault` (allowlist
  + caps + kill switch on top of the PQ check), the policy engine, the signal
  scorer, the agent CLI, the vault CLI, the window script and the console.
- Wrote and ran the tests (11 Forge, 13 Node) and fixed the failures they
  found (mock precompiles must be stateless under `vm.etch`; `expectRevert`
  must not have a helper call in between).
- Verified the fest facts (pool, deadline, dates) live on the official site
  and docs; the per-track prize split is reported as *unconfirmed* because
  the official Rules page could not be read as text.

What a human did and must still do:

- The concept, the trading-desk framing and the Q-Day drill narrative are the
  builder's own (Gogo Maduro — a risk-limited trading agent with a kill
  switch is his existing work).
- Registration (GitHub + X + QoreX testnet address), the faucet claim, the
  repo push to his own GitHub account, and the video are the builder's own
  actions. No account of his was ever used by the assistant.
- All testnet keys in this project are throwaways generated for this repo
  only; no real wallet, seed phrase or mainnet funds were involved.
