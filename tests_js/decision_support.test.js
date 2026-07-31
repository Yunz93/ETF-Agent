import test from "node:test";
import assert from "node:assert/strict";

import {
  cycleExecution,
  estimatedTradeFee,
  holdingFromTrades,
  orderPreview,
  pendingOrderState,
  planExecutionContext,
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

test("order preview includes minimum commission and blocks inefficient small orders", () => {
  const tradingCost = {
    min_commission: 5,
    commission_rate_pct: 0.03,
    max_fee_ratio_pct: 0.25,
    lot_size: 100,
  };
  const blocked = orderPreview(2000, 1.275, tradingCost);
  assert.equal(blocked.shares, 0);
  assert.equal(blocked.minimumEfficientShares, 1600);
  assert.equal(blocked.blockedReason, "fee_inefficient");

  const executable = orderPreview(2045, 1.275, tradingCost);
  assert.equal(executable.shares, 1600);
  assert.equal(executable.estimatedAmount, 2040);
  assert.equal(executable.fee, 5);
  assert.equal(executable.totalCash, 2045);
  assert.ok(executable.feeRatioPct < 0.25);
  assert.equal(estimatedTradeFee(2040, tradingCost), 5);

  const forced = orderPreview(2000, 1.275, { ...tradingCost, allowInefficient: true });
  assert.equal(forced.shares, 1500);
  assert.equal(forced.inefficient, true);
  assert.ok(forced.feeRatioPct > 0.25);
});

test("holding cost basis includes buy fees and sell net proceeds", () => {
  const holding = holdingFromTrades(
    [{ id: "b1", symbol: "512890", date: "2026-01-01", price: 1, shares: 1000, fee: 5 }],
    [{ id: "s1", symbol: "512890", date: "2026-02-01", price: 1.1, shares: 400, fee: 5 }],
    "512890",
  );
  assert.equal(holding.shares, 600);
  assert.ok(Math.abs(holding.cost - 1.005) < 1e-9);
  assert.ok(holding.realizedPnl > 0);
});

test("initial build budget is independent from recurring contribution", () => {
  const context = planExecutionContext({
    plan: {
      amount: 5000,
      capital_base: 100000,
      initial_target_pct: 30,
    },
    holdings: [{ marketValue: 10000 }],
  });
  assert.equal(context.phase, "initial");
  assert.equal(context.targetAmount, 30000);
  assert.equal(context.budget, 20000);
});

test("completed initial build stays in recurring mode after a drawdown", () => {
  const context = planExecutionContext({
    plan: {
      amount: 5000,
      capital_base: 100000,
      initial_target_pct: 30,
      initial_build_completed_at: "2026-07-30T00:00:00Z",
    },
    holdings: [{ marketValue: 24000 }],
  });
  assert.equal(context.phase, "recurring");
  assert.equal(context.budget, 5000);
});

test("pending order rolls remaining budget into the next period", () => {
  const plan = {
    cadence: "monthly",
    day: 1,
    pending_orders: {
      "512890": {
        period: "2026-06-01",
        carry: 0,
        scheduled: 800,
        remaining: 800,
      },
    },
  };
  const pending = pendingOrderState({
    plan,
    symbol: "512890",
    recommendedAmount: 900,
    buys: [],
    now: new Date(2026, 6, 10),
  });
  assert.equal(pending.carry, 800);
  assert.equal(pending.scheduled, 900);
  assert.equal(pending.remaining, 1700);
});

test("projected position marks overweight without hard-blocking by default", () => {
  const soft = projectedPosition({
    currentValue: 20_000,
    portfolioValue: 40_000,
    buyAmount: 2_000,
    targetWeight: 30,
  });
  assert.equal(soft.currentWeight, 50);
  assert.ok(soft.projectedWeight > 52);
  assert.equal(soft.maxWeight, 35);
  assert.equal(soft.overweight, true);
  assert.equal(soft.blocked, false);
  assert.equal(soft.wouldExceed, false);

  const hard = projectedPosition({
    currentValue: 20_000,
    portfolioValue: 40_000,
    buyAmount: 2_000,
    targetWeight: 30,
    enforceCeiling: true,
  });
  assert.equal(hard.blocked, true);
  assert.equal(hard.wouldExceed, true);
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
