// policy.mjs — the leash policy engine. Pure functions, no chain access,
// no keys. The same rules the vault contract enforces on chain are mirrored
// here so the agent refuses a bad proposal BEFORE it ever tries a transaction.
//
// policy: { allowlist: string[], perTxUqor: string|number|bigint,
//           dailyUqor: string|number|bigint, killSwitch: boolean }
// state:  { spentTodayUqor: string|number|bigint }
// proposal: { to: string, amountUqor: string|number|bigint, memo?: string }
//
// Returns { decision: "APPROVE" | "REFUSE", reason: string }.
// Refusal order is deliberate: kill switch first (total stop), then
// allowlist, then per-payment cap, then daily cap.

const norm = (addr) => String(addr ?? "").trim().toLowerCase();
const uqor = (v) => BigInt(v ?? 0);

export function evaluateProposal(proposal, policy, state) {
  const to = norm(proposal?.to);
  const amount = uqor(proposal?.amountUqor);
  const allowlist = new Set((policy?.allowlist ?? []).map(norm));

  if (policy?.killSwitch) {
    return { decision: "REFUSE", reason: "kill switch is ON" };
  }
  if (!to) {
    return { decision: "REFUSE", reason: "missing recipient address" };
  }
  if (!allowlist.has(to)) {
    return { decision: "REFUSE", reason: `recipient ${to} is not allowlisted` };
  }
  if (amount <= 0n) {
    return { decision: "REFUSE", reason: "amount must be positive" };
  }
  if (amount > uqor(policy?.perTxUqor)) {
    return {
      decision: "REFUSE",
      reason: `amount ${amount} uqor exceeds per-payment cap ${uqor(policy?.perTxUqor)} uqor`,
    };
  }
  const remaining = uqor(policy?.dailyUqor) - uqor(state?.spentTodayUqor);
  if (amount > remaining) {
    return {
      decision: "REFUSE",
      reason: `amount ${amount} uqor exceeds daily remainder ${remaining} uqor`,
    };
  }
  return { decision: "APPROVE", reason: "within allowlist, per-payment and daily caps" };
}

export function formatQor(uqorAmount) {
  const v = uqor(uqorAmount);
  const whole = v / 1000000n;
  const frac = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} QOR` : `${whole} QOR`;
}
