// leash.mjs — the Gogo Leash agent CLI (native lane, QoreChain diana testnet).
// The agent never holds the owner's money: it holds an ed25519 key linked to
// the owner account under rules the chain enforces (send only, per-payment
// and daily caps, expiry). Every decision is written to agent/audit.jsonl.
//
//   node agent/leash.mjs owner-init            throwaway owner account (testnet)
//   node agent/leash.mjs init                  agent key + gas wallet
//   node agent/leash.mjs whoami
//   node agent/leash.mjs register owner|gas    register the ML-DSA-87 key (once)
//   node agent/leash.mjs link <perTxQOR> <dailyQOR> [hours]
//   node agent/leash.mjs rules                 what the chain enforces
//   node agent/leash.mjs propose [file]        score + policy-check, no chain writes
//   node agent/leash.mjs run <file>            pay the proposals that pass
//   node agent/leash.mjs pay <to> <QOR> [memo]
//   node agent/leash.mjs revoke                owner revokes the agent key
//   node agent/leash.mjs balance
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import {
  deriveUnifiedAccount,
  generateMnemonic,
  fetchPqcStatus,
  buildRegisterPqcKeyMsg,
  signProofOfPossession,
  signAuthenticatorLinkEd25519,
  linkAuthenticatorMsgs,
  revokeAuthenticatorMsg,
  buildPhantomExecuteCosmos,
  fetchAuthNonce,
  fetchSpendingRules,
  fetchAuthenticators,
  decodeAuthenticatorExecutions,
} from "@qorechain/sdk";
import { evaluateProposal, formatQor } from "./policy.mjs";
import { scoreSeries } from "./signal.mjs";
import { audit } from "./audit.mjs";
import {
  AGENT_ENV,
  OWNER_ENV,
  EXPLORER,
  REST,
  parseEnvFile,
  writeSecret,
  loadPolicy,
  toUqor,
  fmtQor,
  hex,
  getJson,
  balanceOf,
  broadcast,
  onChain,
  REPO_ROOT,
} from "./common.mjs";
import { join } from "node:path";

const SCORE_THRESHOLD = 60;

const readEnv = (file, hint) => {
  if (!existsSync(file)) throw new Error(`missing ${file}: run "node agent/leash.mjs ${hint}" first`);
  return parseEnvFile(file);
};
const owner = async () => deriveUnifiedAccount(readEnv(OWNER_ENV, "owner-init").QORE_MNEMONIC, 0);
const gas = async () => deriveUnifiedAccount(readEnv(AGENT_ENV, "init").GAS_MNEMONIC, 0);
const agentKey = () => {
  const sk = Uint8Array.from(Buffer.from(readEnv(AGENT_ENV, "init").AGENT_ED25519_KEY, "hex"));
  const pk = ed25519.getPublicKey(sk);
  return { sk, pk, wallet: { publicKey: pk, async signMessage(m) { return { signature: ed25519.sign(m, sk) }; } } };
};

const loadProposals = (file) => JSON.parse(readFileSync(file ?? join(REPO_ROOT, "agent", "proposals.json"), "utf8"));

const cmds = {
  async init() {
    const sk = randomBytes(32);
    const gasMnemonic = generateMnemonic(256);
    writeSecret(AGENT_ENV, [
      "# Gogo Leash agent keys. QoreChain diana TESTNET only. Never fund on mainnet.",
      `AGENT_ED25519_KEY=${sk.toString("hex")}`,
      `GAS_MNEMONIC="${gasMnemonic}"`,
    ]);
    const g = await deriveUnifiedAccount(gasMnemonic, 0);
    console.log(`agent key   ed25519 ${hex(ed25519.getPublicKey(sk)).slice(0, 16)}...  (saved in ${AGENT_ENV})`);
    console.log(`gas wallet  ${g.cosmos}`);
    console.log(`\nNext: send ~3 testnet QOR to the gas wallet (faucet), then: node agent/leash.mjs register gas`);
    audit("agent.init", { gasWallet: g.cosmos });
  },

  async "owner-init"() {
    const m = generateMnemonic(256);
    writeSecret(OWNER_ENV, ["# Gogo Leash owner account. QoreChain diana TESTNET only.", `QORE_MNEMONIC="${m}"`]);
    console.log(`owner       ${(await deriveUnifiedAccount(m, 0)).cosmos}  (saved in ${OWNER_ENV})`);
    console.log("Next: fund it from the faucet, then: node agent/leash.mjs register owner");
    audit("agent.owner-init", { owner: (await deriveUnifiedAccount(m, 0)).cosmos });
  },

  async whoami() {
    const o = existsSync(OWNER_ENV) ? (await owner()).cosmos : "(no owner yet)";
    console.log(`owner       ${o}`);
    if (existsSync(AGENT_ENV)) {
      console.log(`agent key   ed25519 ${hex(agentKey().pk).slice(0, 16)}...`);
      console.log(`gas wallet  ${(await gas()).cosmos}`);
    }
  },

  async register(who) {
    const acc = who === "gas" ? await gas() : await owner();
    const st = await fetchPqcStatus({ rest: REST, address: acc.cosmos });
    if (st.registered) {
      console.log(`${acc.cosmos}: ML-DSA-87 key already registered`);
      return;
    }
    const pop = signProofOfPossession({ chainId: "qorechain-diana", account: acc.cosmos, keypair: acc.pqc });
    const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop });
    const res = await broadcast(acc, [msg], "register ML-DSA-87 key", "classical");
    console.log(res.code === 0 ? `${acc.cosmos}: ML-DSA-87 key registered  ${res.transactionHash}` : `REFUSED code ${res.code}: ${res.rawLog}`);
    audit("agent.register", { who, address: acc.cosmos, tx: res.transactionHash, code: res.code });
    if (res.code) process.exitCode = 1;
  },

  async link(perTx, daily, hours = "24") {
    const o = await owner();
    const k = agentKey();
    const proof = signAuthenticatorLinkEd25519({ chainId: "qorechain-diana", account: o.cosmos, privateKey: k.sk });
    const msgs = linkAuthenticatorMsgs({
      owner: o.cosmos,
      chainId: "qorechain-diana",
      ...proof,
      permissions: ["send"],
      expiryUnix: Math.floor(Date.now() / 1000) + Number(hours) * 3600,
      label: "gogo-leash agent",
      spendingRule: { id: "gogo-leash", enabled: true, perTxLimit: toUqor(perTx), dailyLimit: toUqor(daily), allowedDenoms: ["uqor"] },
    });
    const res = await broadcast(o, msgs, "link gogo-leash agent");
    if (res.code) {
      console.log(`REFUSED code ${res.code}: ${res.rawLog}`);
      process.exitCode = 1;
      return;
    }
    const c = await onChain(res.transactionHash);
    console.log(`agent linked to ${o.cosmos}`);
    console.log(`  may do      send QOR only`);
    console.log(`  per payment ${perTx} QOR   per day ${daily} QOR   expires in ${hours} h`);
    console.log(`  owner tx    ${res.transactionHash}  ${c?.hybrid ? "hybrid ML-DSA-87: verified" : ""}`);
    audit("agent.link", { owner: o.cosmos, perTxQor: perTx, dailyQor: daily, hours, tx: res.transactionHash, hybridVerified: Boolean(c?.hybrid) });
  },

  async rules() {
    const o = await owner();
    const k = agentKey();
    const policy = loadPolicy();
    const [r, auths, n] = await Promise.all([
      fetchSpendingRules({ rest: REST, address: o.cosmos }),
      fetchAuthenticators({ rest: REST, address: o.cosmos }),
      fetchAuthNonce({ rest: REST, address: o.cosmos, pubkey: k.pk }),
    ]);
    console.log(`account ${o.cosmos}  balance ${fmtQor(await balanceOf(o.cosmos))}`);
    console.log(`local policy: per payment ${fmtQor(policy.perTxUqor)}, per day ${fmtQor(policy.dailyUqor)}, kill switch ${policy.killSwitch ? "ON" : "off"}, allowlist ${policy.allowlist.length} addresses`);
    for (const x of r.rules) {
      console.log(`  chain rule "${x.id}" ${x.enabled ? "on" : "off"}: per payment ${fmtQor(x.perTxLimit)}, per day ${fmtQor(x.dailyLimit)}, denoms ${x.allowedDenoms.join(",") || "any"}`);
    }
    const me = auths.find((a) => a.pubkeyHex.toLowerCase() === hex(k.pk));
    if (!me) {
      console.log("  agent key: not linked");
      return;
    }
    console.log(`  agent key: ${me.revoked ? "REVOKED" : "linked"}, may: ${me.permissions.join(",")}, expires ${new Date(Number(me.expiryUnix) * 1000).toISOString().slice(0, 16)}Z, payments made: ${n.nonce}`);
  },

  async propose(file) {
    const proposals = loadProposals(file);
    const policy = loadPolicy();
    let spent = 0n;
    console.log(`gogo-leash: ${proposals.length} proposals to evaluate (score threshold ${SCORE_THRESHOLD})\n`);
    for (const p of proposals) {
      const score = scoreSeries(p.closes ?? [], p.side ?? "long");
      const check = evaluateProposal({ to: p.to, amountUqor: toUqor(p.qor) }, policy, { spentTodayUqor: spent.toString() });
      const ready = score.score >= SCORE_THRESHOLD && check.decision === "APPROVE";
      const verdict = ready ? "READY" : "SKIP";
      console.log(`- ${p.name}: ${p.qor} QOR -> ${String(p.to).slice(0, 14)}...  score ${score.score}/100 (${score.trend})  ${verdict}`);
      console.log(`    signal: ${score.reasons.join("; ")}`);
      console.log(`    leash:  ${check.decision} — ${check.reason}`);
      audit("proposal.evaluated", { name: p.name, to: p.to, qor: String(p.qor), score: score.score, verdict, leashReason: check.reason });
      if (ready) spent += BigInt(toUqor(p.qor));
    }
    console.log(`\npropose: ${proposals.length} evaluated, local daily spend if all READY paid: ${fmtQor(spent.toString())} (chain is the final enforcer)`);
  },

  async pay(to, qor, memo = "gogo-leash payment") {
    const o = await owner();
    const g = await gas();
    const k = agentKey();
    const policy = loadPolicy();
    const check = evaluateProposal({ to, amountUqor: toUqor(qor) }, policy, { spentTodayUqor: "0" });
    if (check.decision !== "APPROVE") {
      console.log(`  ${qor} QOR -> ${String(to).slice(0, 14)}...  REFUSED BY LOCAL POLICY: ${check.reason}`);
      audit("payment.refused-local", { to, qor: String(qor), reason: check.reason });
      process.exitCode = 1;
      return false;
    }
    const { nonce } = await fetchAuthNonce({ rest: REST, address: o.cosmos, pubkey: k.pk });
    const msg = await buildPhantomExecuteCosmos({ wallet: k.wallet, relayer: g.cosmos, chainId: "qorechain-diana", account: o.cosmos, to, amount: `${toUqor(qor)}uqor`, nonce });
    let res;
    try {
      res = await broadcast(g, [msg], memo);
    } catch (e) {
      const why = String(e?.message ?? e).match(/: ([^:()]*(revoked|expired|not permitted)[^()]*)\)/)?.[1] ?? String(e?.message ?? e);
      console.log(`  ${qor} QOR -> ${String(to).slice(0, 14)}...  REFUSED BY THE CHAIN: ${why}`);
      audit("payment.refused-chain", { to, qor: String(qor), reason: why });
      process.exitCode = 1;
      return false;
    }
    if (res.code) {
      console.log(`  ${qor} QOR -> ${to}: REFUSED code ${res.code}: ${res.rawLog}`);
      audit("payment.refused-chain", { to, qor: String(qor), code: res.code, rawLog: res.rawLog });
      process.exitCode = 1;
      return false;
    }
    const c = await onChain(res.transactionHash);
    const [x] = decodeAuthenticatorExecutions({ msgResponses: res.msgResponses ?? [], events: c?.events ?? res.events ?? [] }, [msg]);
    if (x && !x.success) {
      console.log(`  ${qor} QOR -> ${String(to).slice(0, 14)}...  REFUSED BY THE CHAIN: ${x.reason || x.vmError || "execution failed"}`);
      console.log(`      ${EXPLORER}${res.transactionHash}`);
      audit("payment.refused-chain", { to, qor: String(qor), reason: x.reason || x.vmError, tx: res.transactionHash });
      return false;
    }
    console.log(`  ${qor} QOR -> ${String(to).slice(0, 14)}...  PAID  (${memo})${c?.hybrid ? "  hybrid ML-DSA-87: verified" : ""}`);
    console.log(`      ${EXPLORER}${res.transactionHash}`);
    audit("payment.paid", { to, qor: String(qor), memo, tx: res.transactionHash, hybridVerified: Boolean(c?.hybrid) });
    return true;
  },

  async run(file) {
    const proposals = loadProposals(file);
    const policy = loadPolicy();
    let spent = 0n;
    let paid = 0;
    console.log(`gogo-leash: ${proposals.length} proposals from ${(await owner()).cosmos}\n`);
    for (const p of proposals) {
      const score = scoreSeries(p.closes ?? [], p.side ?? "long");
      if (score.score < SCORE_THRESHOLD) {
        console.log(`- ${p.name}: SKIP — signal score ${score.score}/100 below ${SCORE_THRESHOLD}`);
        audit("proposal.skipped-signal", { name: p.name, score: score.score });
        continue;
      }
      const check = evaluateProposal({ to: p.to, amountUqor: toUqor(p.qor) }, policy, { spentTodayUqor: spent.toString() });
      if (check.decision !== "APPROVE") {
        console.log(`- ${p.name}: SKIP — leash: ${check.reason}`);
        audit("proposal.skipped-leash", { name: p.name, reason: check.reason });
        continue;
      }
      console.log(`- ${p.name}: ${p.qor} QOR (score ${score.score})`);
      if (await cmds.pay(p.to, String(p.qor), p.name)) {
        paid++;
        spent += BigInt(toUqor(p.qor));
      }
    }
    console.log(`\ngogo-leash: ${paid} paid, ${proposals.length - paid} not paid (skipped or refused)`);
    process.exitCode = 0;
  },

  async revoke() {
    const o = await owner();
    const k = agentKey();
    const res = await broadcast(o, [revokeAuthenticatorMsg({ owner: o.cosmos, scheme: "ed25519", pubkey: k.pk })], "revoke gogo-leash agent");
    console.log(res.code === 0 ? `agent revoked  ${res.transactionHash}` : `REFUSED code ${res.code}: ${res.rawLog}`);
    audit("agent.revoke", { owner: o.cosmos, tx: res.transactionHash, code: res.code });
    if (res.code) process.exitCode = 1;
  },

  async balance() {
    const o = await owner();
    const g = await gas();
    console.log(`owner       ${o.cosmos}  ${fmtQor(await balanceOf(o.cosmos))}`);
    console.log(`gas wallet  ${g.cosmos}  ${fmtQor(await balanceOf(g.cosmos))}`);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmds[cmd]) {
  console.log([
    "gogo-leash agent — usage:",
    "  node agent/leash.mjs owner-init | init | whoami | balance",
    "  node agent/leash.mjs register owner|gas",
    "  node agent/leash.mjs link <perTxQOR> <dailyQOR> [hours]",
    "  node agent/leash.mjs rules",
    "  node agent/leash.mjs propose [file] | run <file> | pay <to> <QOR> [memo]",
    "  node agent/leash.mjs revoke",
  ].join("\n"));
  process.exit(cmd ? 1 : 0);
}
cmds[cmd](...args).catch((e) => {
  console.error(`error: ${e?.message ?? e}`);
  process.exitCode = 1;
});
