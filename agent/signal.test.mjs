// Signal scoring tests — no chain, no keys.
import test from "node:test";
import assert from "node:assert/strict";
import { ema, scoreSeries } from "./signal.mjs";

const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
const falling = Array.from({ length: 30 }, (_, i) => 160 - i * 2);
const flat = Array.from({ length: 30 }, () => 100);

test("ema follows the series direction", () => {
  assert.ok(ema(rising, 12) > ema(rising, 26));
  assert.ok(ema(falling, 12) < ema(falling, 26));
});

test("a rising series scores high for long, low for short", () => {
  const longScore = scoreSeries(rising, "long").score;
  const shortScore = scoreSeries(rising, "short").score;
  assert.ok(longScore >= 60, `long score ${longScore} should clear the 60 threshold`);
  assert.ok(shortScore < longScore);
});

test("a falling series scores high for short", () => {
  assert.ok(scoreSeries(falling, "short").score >= 60);
});

test("a flat series does not clear the threshold", () => {
  assert.ok(scoreSeries(flat, "long").score < 60);
});

test("too little data scores zero with a reason", () => {
  const r = scoreSeries([100], "long");
  assert.equal(r.score, 0);
  assert.match(r.reasons.join(" "), /not enough price data/);
});
