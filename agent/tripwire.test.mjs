import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTripwire, isWithdrawCall, WITHDRAW_SELECTOR } from "./tripwire.mjs";

const NOW = 1_800_000_000;
const VAULT = "0xC82274b045f7481C953f3DC0e88e9e54B308Dfd4";

test("tripwire fires at exactly the threshold inside the window", () => {
  const v = evaluateTripwire([NOW - 100, NOW - 50, NOW - 10], NOW, 3, 3600);
  assert.equal(v.fire, true);
  assert.equal(v.count, 3);
  assert.equal(v.windowStart, NOW - 100);
});

test("tripwire does not fire below the threshold", () => {
  const v = evaluateTripwire([NOW - 100, NOW - 10], NOW, 3, 3600);
  assert.equal(v.fire, false);
  assert.equal(v.count, 2);
});

test("old failures outside the window do not count", () => {
  const v = evaluateTripwire([NOW - 7200, NOW - 7100, NOW - 10], NOW, 3, 3600);
  assert.equal(v.fire, false);
  assert.equal(v.count, 1);
});

test("a failure exactly at the cutoff is outside the window", () => {
  const v = evaluateTripwire([NOW - 3600, NOW - 10], NOW, 2, 3600);
  assert.equal(v.fire, false);
  assert.equal(v.count, 1);
});

test("empty failure list never fires", () => {
  const v = evaluateTripwire([], NOW, 3, 3600);
  assert.equal(v.fire, false);
  assert.equal(v.count, 0);
  assert.equal(v.windowStart, null);
});

test("isWithdrawCall matches only withdraw() calls to our vault", () => {
  const good = { to: VAULT, input: `${WITHDRAW_SELECTOR}deadbeef` };
  assert.equal(isWithdrawCall(good, VAULT), true);
  // Different function selector.
  assert.equal(isWithdrawCall({ to: VAULT, input: "0x9aa54181deadbeef" }, VAULT), false);
  // Same selector, different contract.
  assert.equal(isWithdrawCall({ to: "0x1111111111111111111111111111111111111111", input: `${WITHDRAW_SELECTOR}deadbeef` }, VAULT), false);
  // Case-insensitive address + selector.
  assert.equal(isWithdrawCall({ to: VAULT.toLowerCase(), input: WITHDRAW_SELECTOR.toUpperCase() + "00" }, VAULT), true);
});
