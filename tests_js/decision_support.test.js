import test from "node:test";
import assert from "node:assert/strict";

import {
  cycleExecution,
  orderPreview,
  planPeriod,
  projectedPosition,
  returnCorrelation,
  riskMetrics,
} from "../js/decision-support.js";

test("monthly plan exposes current cycle and scheduled day", () => {
  const period = planPeriod({ cadence: "monthly", day: 15 }, new Date(2026, 6, 10));
  assert.deepEqual(period, {
    start: "2026-07-01",
    end: "2026-08-01",
    scheduled: "2026-07-15",
    daysToScheduled: 5,
  });
});

test("cycle execution subtracts recorded buys and detects completion", () => {
  const cycle = cycleExecution({
    plan: { cadence: "monthly", day: 1 },
    symbol: "512890",
    recommendedAmount: 1000,
    now: new Date(2026, 6, 28),
    buys: [
      { symbol: "512890", date: "2026-07-02", price: 1, shares: 1000 },
      { symbol: "512890", date: "2026-06-02", price: 1, shares: 1000 },
    ],
  });
  assert.equal(cycle.executedAmount, 1000);
  assert.equal(cycle.remainingAmount, 0);
  assert.equal(cycle.status, "completed");
  assert.equal(cycle.matchingCount, 1);
});

test("order preview uses board lots and preserves residual cash", () => {
  const preview = orderPreview(1548, 1.266);
  assert.equal(preview.shares, 1200);
  assert.equal(preview.estimatedAmount, 1519.2);
  assert.ok(Math.abs(preview.cashRemainder - 28.8) < 1e-8);
});

test("projected position detects current and post-buy concentration breach", () => {
  const result = projectedPosition({
    currentValue: 20_000,
    portfolioValue: 40_000,
    buyAmount: 2_000,
    targetWeight: 30,
  });
  assert.equal(result.currentWeight, 50);
  assert.ok(result.projectedWeight > 52);
  assert.equal(result.maxWeight, 35);
  assert.equal(result.blocked, true);
  assert.equal(result.wouldExceed, true);
});

test("risk metrics report drawdown and annualized volatility", () => {
  const points = [
    { date: "2026-01-01", close: 100 },
    { date: "2026-01-02", close: 110 },
    { date: "2026-01-03", close: 88 },
    { date: "2026-01-04", close: 99 },
  ];
  const metrics = riskMetrics(points);
  assert.equal(Math.round(metrics.maxDrawdownPct), -20);
  assert.equal(metrics.longestUnderwaterDays, 2);
  assert.ok(metrics.annualizedVolatilityPct > 0);
});

test("return correlation uses aligned daily returns", () => {
  const left = [];
  const right = [];
  for (let index = 0; index < 30; index += 1) {
    left.push({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, close: 100 + index });
    right.push({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, close: 200 + index * 2 });
  }
  const correlation = returnCorrelation(left, right);
  assert.ok(correlation.value > 0.99);
  assert.equal(correlation.samples, 29);
});

