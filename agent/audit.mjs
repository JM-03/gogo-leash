// audit.mjs — append-only audit log. Every proposal, decision and
// transaction the agent touches gets one JSON line in agent/audit.jsonl.
// The log holds public testnet addresses and amounts only — never keys.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const AUDIT_PATH = join(dirname(fileURLToPath(import.meta.url)), "audit.jsonl");

export function audit(event, details = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...details }) + "\n";
  appendFileSync(AUDIT_PATH, line);
  return line.trim();
}

export function readAuditTail(n = 50) {
  if (!existsSync(AUDIT_PATH)) return [];
  const lines = readFileSync(AUDIT_PATH, "utf8").split("\n").filter(Boolean);
  return lines.slice(-n).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}
