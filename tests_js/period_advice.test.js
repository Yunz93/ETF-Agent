import test from "node:test";
import assert from "node:assert/strict";

import { getPeriodAdvice, STANCE } from "../js/period-advice.js";

test("period advice invests when strategy allocation assigns amount", () => {
  const advice = getPeriodAdvice({
    symbol: "512890",
    plan: { amount: 2000, strategy: "fixed" },
    holdings: [
      { symbol: "512890", name: "红利低波", targetWeight: 40, pePct: 0.9, grade: "E" },
      { symbol: "563360", name: "A500", targetWeight: 60, pePct: 0.9, grade: "E" },
    ],
  });
  assert.equal(advice.stance, STANCE.INVEST);
  assert.equal(advice.amount, 800);
  assert.match(advice.headline, /本期建议投入/);
  assert.equal(advice.canAdd, true);
  assert.match(advice.executionLine, /本期执行：投入/);
});

test("period advice holds cash when valuation pauses the whole pool", () => {
  const advice = getPeriodAdvice({
    symbol: "512890",
    plan: { amount: 2000, strategy: "valuation" },
    holdings: [
      { symbol: "512890", targetWeight: 50, pePct: 0.9, grade: "B" },
      { symbol: "563360", targetWeight: 50, pePct: 0.85, grade: "A" },
    ],
  });
  assert.equal(advice.stance, STANCE.HOLD_CASH);
  assert.equal(advice.amount, 0);
  assert.equal(advice.canAdd, false);
  assert.match(advice.headline, /不投/);
  assert.match(advice.executionLine, /全池不投/);
});

test("period advice skips one name without inventing a buy when others deploy", () => {
  const advice = getPeriodAdvice({
    symbol: "563360",
    plan: { amount: 2000, strategy: "custom", strategy_config: {
      pe_bands: [
        { max_pct: 50, mult: 1.5, label: "便宜" },
        { max_pct: 100, mult: 0, label: "贵" },
      ],
      use_rebalance: false,
    } },
    holdings: [
      { symbol: "512890", targetWeight: 50, pePct: 0.3 },
      { symbol: "563360", targetWeight: 50, pePct: 0.9 },
    ],
  });
  assert.equal(advice.stance, STANCE.SKIP);
  assert.equal(advice.amount, 0);
  assert.equal(advice.canAdd, false);
  assert.match(advice.executionLine, /本只不投/);
});

test("period advice asks for budget before inventing amounts", () => {
  const advice = getPeriodAdvice({
    symbol: "512890",
    plan: { amount: 0, strategy: "valuation" },
    holdings: [{ symbol: "512890", targetWeight: 100, pePct: 0.3 }],
  });
  assert.equal(advice.stance, STANCE.NEED_BUDGET);
  assert.match(advice.headline, /全池每期预算/);
});
