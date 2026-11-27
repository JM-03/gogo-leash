// signal.mjs — deterministic paper scoring for desk proposals.
// Pure functions, no network, no keys. This is a screening filter, not a
// trading strategy and not financial advice: it only decides whether a
// proposed settlement is worth the agent's time, using the same discipline
// as the desk's manual rules (trend with the EMA, no chasing against it).
//
// scoreSeries(closes, side):
//   closes — array of recent close prices, oldest first (at least 27 points
//   for a full EMA26 read; fewer still scores, with a note).
//   side   — "long" | "short" (the direction the proposal bets on).
// Returns { score 0..100, fastEma, slowEma, momentumPct, trend, reasons[] }.
//   +40  fast EMA(12) on the proposal's side of slow EMA(26)
//   +30  last close on the proposal's side of fast EMA
//   +30  momentum over the last 5 closes on the proposal's side (scaled)
// Threshold: the agent only acts on score >= 60.

export function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function scoreSeries(closes, side) {
  const reasons = [];
  if (!Array.isArray(closes) || closes.length < 2) {
    return { score: 0, fastEma: null, slowEma: null, momentumPct: 0, trend: "no-data", reasons: ["not enough price data"] };
  }
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const last = closes[closes.length - 1];
  const prev5 = closes[Math.max(0, closes.length - 6)];
  const momentumPct = ((last - prev5) / prev5) * 100;
  const trend = fast > slow ? "up" : fast < slow ? "down" : "flat";
  const withTrend = side === "long" ? trend === "up" : trend === "down";

  let score = 0;
  if (withTrend) {
    score += 40;
    reasons.push(`EMA12 ${trend === "up" ? "above" : "below"} EMA26 (with trend)`);
  } else {
    reasons.push(`EMA12 ${trend === "up" ? "above" : "below"} EMA26 (against proposal)`);
  }
  const priceVsFast = side === "long" ? last > fast : last < fast;
  if (priceVsFast) {
    score += 30;
    reasons.push("last close on the proposal side of EMA12");
  } else {
    reasons.push("last close against the proposal side of EMA12");
  }
  const momentumWith = side === "long" ? momentumPct > 0 : momentumPct < 0;
  if (momentumWith) {
    score += Math.min(30, Math.round(Math.abs(momentumPct) * 10));
    reasons.push(`5-close momentum ${momentumPct.toFixed(2)}% with proposal`);
  } else {
    reasons.push(`5-close momentum ${momentumPct.toFixed(2)}% against proposal`);
  }
  return { score, fastEma: fast, slowEma: slow, momentumPct, trend, reasons };
}
