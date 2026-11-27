// Gogo Leash red-team suite — read-only attacks against the LIVE vault.
//
// No keys, no gas, no transactions: every attack is an eth_call simulation
// against the deployed vault on the qorechain-diana testnet. An attack
// "passes" (for us) when the chain refuses it with the expected revert.
//
// Run:  node scripts/redteam.mjs
// Exit:  0 when every attack is blocked, 1 otherwise.
//
// Live cases (eth_call vs the real vault):
//   1. Forged PQ signature          -> BadPqcSignature
//   2. Unapproved payee             -> NotAllowlisted
//   3. Over per-payment cap         -> OverPerTxCap
//   4. Replay of a real withdrawal  -> BadPqcSignature (signature binds nonce)
//   5. Rule change by non-guardian  -> NotGuardian (setAllowlisted)
//   6. Cap change by non-guardian   -> NotGuardian (setCaps)
// Local cases (Foundry, test/GogoLeashVault.t.sol — state the live vault
// cannot reach without real money moving):
//   7. Over daily cap               -> OverDailyCap
//   8. Kill switch on               -> PausedVault
//   9. Only guardian can pause      -> NotGuardian
//  10. Unregistered guardian key    -> GuardianKeyNotRegistered
//  11. Unproven guardian key        -> GuardianKeyNotProven
//
// Known limitation (honest, not hidden): vault v1's daily cap was a UTC
// calendar-day bucket, so 3 QOR at 23:59 + 3 QOR at 00:01 would pass. This
// suite now runs against vault v2, where the cap is a rolling 24-hour
// window (see REDTEAM.md). The tripwire auto-pause is proven in Forge +
// Node tests and the watcher code; a live on-chain trip demo has not run yet.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const RPC = 'https://evm-testnet.qore.host';
const VAULT = '0x9C254f3bBAFa6d4C03196c8C65C0d30F2cD57B0f'; // vault v2 (rolling 24h window + tripwire)
const GAS_WALLET = '0x0d95bE136395430Af3BF55Ea702623608B3524FD'; // allowlisted vendor
const UNAPPROVED = '0x1111111111111111111111111111111111111111'; // never allowlisted
const REPLAY_TX = '0xe5e33881dbe9b183505d6b4b31f5d480264a33d9ab5a335b4ab47f8b0b08e45b'; // real v2 0.8 QOR withdrawal, nonce 0

const ERR = {
  BadPqcSignature: '0xf35e1976',
  NotAllowlisted: '0x6f7a5275',
  OverPerTxCap: '0xc8c92ec8',
  OverDailyCap: '0x92ec8899',
  PausedVault: '0xf0d97246',
  NotGuardian: '0xef6d0f02',
  GuardianKeyNotRegistered: '0xe5835348',
  GuardianKeyNotProven: '0x46fd6690',
};

const WITHDRAW_SEL = '31f09265';
const SET_ALLOWLISTED_SEL = '9aa54181';
const SET_CAPS_SEL = '212bf316';

const hex = (n) => n.toString(16).padStart(64, '0');
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function buildWithdrawCalldata(to, amountWei, sigBytes) {
  const addr = to.slice(2).toLowerCase().padStart(64, '0');
  const sig = toHex(sigBytes);
  const padded = sig + '0'.repeat(((32 - (sigBytes.length % 32)) % 32) * 2); // 2 hex chars per byte
  return '0x' + WITHDRAW_SEL + addr + hex(amountWei) + hex(96n) + hex(BigInt(sigBytes.length)) + padded;
}

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return r.json();
}

async function ethCall(from, to, data) {
  const j = await rpc('eth_call', [{ ...(from ? { from } : {}), to, data }, 'latest']);
  if (j.error) return { reverted: true, data: (j.error.data || '').toLowerCase(), message: j.error.message };
  return { reverted: false, result: j.result };
}

const results = [];
function record(id, name, expected, got) {
  // expected may be one selector or a list: the replay (case 4) is refused
  // as OverDailyCap while the rolling window is nearly full, and as
  // BadPqcSignature once it slides — either way the replay cannot pay.
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const pass = got.reverted && expectedList.some((e) => got.data.startsWith(e.toLowerCase()));
  results.push({ id, name, expected: expectedList.join(' or '), got: got.reverted ? got.data.slice(0, 10) : 'NO REVERT (' + got.result + ')', blocked: pass });
  console.log(`${pass ? 'BLOCKED' : '!! NOT BLOCKED'}  ${id}. ${name}\n    expected ${expectedList.join(' or ')}, got ${results.at(-1).got}`);
}

// --- live vault state, for context ---
const bal = await rpc('eth_getBalance', [VAULT, 'latest']);
const nonce = await rpc('eth_call', [{ to: VAULT, data: '0xaffed0e0' }, 'latest']);
const spent = await rpc('eth_call', [{ to: VAULT, data: '0xa37d07e9' }, 'latest']);
console.log(`Vault ${VAULT}`);
console.log(`  balance ${Number(BigInt(bal.result)) / 1e18} QOR, nonce ${BigInt(nonce.result)}, spent in rolling 24h window ${Number(BigInt(spent.result)) / 1e18} QOR of 3 QOR\n`);

// 1. Forged PQ signature: 4,627 random bytes, 0.5 QOR to the allowlisted vendor.
const forged = new Uint8Array(4627);
crypto.getRandomValues(forged);
record(1, 'Forged ML-DSA-87 signature (0.5 QOR, allowlisted, within caps)',
  ERR.BadPqcSignature,
  await ethCall(undefined, VAULT, buildWithdrawCalldata(GAS_WALLET, 500000000000000000n, forged)));

// 2. Unapproved payee: any signature, 0.5 QOR to an address that was never allowlisted.
record(2, 'Unapproved payee (0.5 QOR, forged signature)',
  ERR.NotAllowlisted,
  await ethCall(undefined, VAULT, buildWithdrawCalldata(UNAPPROVED, 500000000000000000n, forged)));

// 3. Over per-payment cap: 2 QOR to the allowlisted vendor (cap is 1 QOR).
record(3, 'Over per-payment cap (2 QOR, cap is 1 QOR)',
  ERR.OverPerTxCap,
  await ethCall(undefined, VAULT, buildWithdrawCalldata(GAS_WALLET, 2000000000000000000n, forged)));

// 4. Replay: the exact calldata of the real v2 0.8 QOR withdrawal, sent again.
//    The signature binds the nonce, and the nonce has moved on — but v2 checks
//    the rolling-window cap BEFORE the signature, so while the window holds
//    2.3 QOR this replay is refused as OverDailyCap (2.3 + 0.8 > 3), and once
//    the window slides it is refused as BadPqcSignature. Either way it cannot pay.
const replayTx = await rpc('eth_getTransactionByHash', [REPLAY_TX]);
record(4, `Replay of real withdrawal ${REPLAY_TX.slice(0, 12)}… (nonce already spent)`,
  [ERR.BadPqcSignature, ERR.OverDailyCap],
  await ethCall(undefined, VAULT, replayTx.result.input));

// 5. Rule change by a non-guardian: the agent/vendor key tries to allowlist an address.
const allowlistCalldata = '0x' + SET_ALLOWLISTED_SEL + UNAPPROVED.slice(2).toLowerCase().padStart(64, '0') + hex(1n);
record(5, 'Non-guardian tries setAllowlisted (stolen agent key changes the rules)',
  ERR.NotGuardian,
  await ethCall(GAS_WALLET, VAULT, allowlistCalldata));

// 6. Cap change by a non-guardian: the agent/vendor key tries to raise the caps.
const capsCalldata = '0x' + SET_CAPS_SEL + hex(100000000000000000000n) + hex(1000000000000000000000n);
record(6, 'Non-guardian tries setCaps (stolen agent key lifts the limits)',
  ERR.NotGuardian,
  await ethCall(GAS_WALLET, VAULT, capsCalldata));

// --- local cases: Foundry proves the states the live vault cannot reach ---
const localCases = [
  ['testOverDailyCapIsRefused', 'Over daily cap (state: spent 2 QOR, then 1 QOR)', ERR.OverDailyCap],
  ['testKillSwitchBlocksWithdrawals', 'Kill switch on (paused vault)', ERR.PausedVault],
  ['testOnlyGuardianCanPause', 'Only guardian can pause', ERR.NotGuardian],
  ['testUnregisteredGuardianKeyIsRefused', 'Guardian key not registered', ERR.GuardianKeyNotRegistered],
  ['testUnprovenGuardianKeyIsRefused', 'Guardian key not proven', ERR.GuardianKeyNotProven],
];
let forgeOk = false;
try {
  const env = { ...process.env, PATH: process.env.HOME + '/.foundry/bin:' + process.env.PATH };
  const out = execSync('forge test --match-test "testOverDailyCapIsRefused|testKillSwitchBlocksWithdrawals|testOnlyGuardianCanPause|testUnregisteredGuardianKeyIsRefused|testUnprovenGuardianKeyIsRefused"', { encoding: 'utf8', env });
  forgeOk = /5 passed/.test(out);
  console.log('\nFoundry local cases (test/GogoLeashVault.t.sol):');
  for (const [name, label] of localCases) {
    const pass = forgeOk && out.includes('[PASS] ' + name + '()');
    results.push({ id: 6 + localCases.findIndex((c) => c[0] === name) + 1, name: label, expected: 'Foundry test ' + name, got: pass ? 'reverted as expected' : 'NOT VERIFIED', blocked: pass });
    console.log(`${pass ? 'BLOCKED' : '!! NOT VERIFIED'}  ${label}  [${name}]`);
  }
} catch (e) {
  console.log('\n!! forge test did not run — local cases NOT verified this run:', (e.message || '').split('\n')[0]);
  for (const [name, label, expected] of localCases) {
    results.push({ id: 7 + localCases.findIndex((c) => c[0] === name), name: label, expected, got: 'forge not run', blocked: false });
  }
}

const blocked = results.filter((r) => r.blocked).length;
console.log(`\nSCORE: ${blocked}/${results.length} attacks blocked.`);
writeFileSync(new URL('./redteam-results.json', import.meta.url),
  JSON.stringify({ runAt: new Date().toISOString(), vault: VAULT, score: `${blocked}/${results.length}`, results }, null, 2));
console.log('Wrote scripts/redteam-results.json');
process.exit(blocked === results.length ? 0 : 1);
