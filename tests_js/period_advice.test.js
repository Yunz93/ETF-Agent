import test from "node:test";
import assert from "node:assert/strict";

import { getPeriodAdvice, STANCE } from "../js/period-advice.js";

test("period advice invests when strategy allocation assigns amount", () => {
  const advice = getPeriodAdvice({
    symbol: "512890",
    plan: { amount: 2000, strategy: "fixed" },
    holdings: [
      { symbol: "512890", name: "红利低波", targetWeight: 40, actualWeight: 44.9, pePct: 0.9, grade: "E" },
      { symbol: "563360", name: "A500", targetWeight: 60, pePct: 0.9, grade: "E" },
    ],
  });
  assert.equal(advice.stance, STANCE.INVEST);
  assert.equal(advice.amount, 800);
  assert.match(advice.headline, /本期建议投入/);
  assert.equal(advice.canAdd, true);
  assert.deepEqual(advice.bullets, ["定投倍率 1×", "约占全池部署 40%"]);
  assert.deepEqual(advice.position, {
    targetWeight: 40,
    actualWeight: 44.9,
    drift: 4.9,
    maxWeight: 45,
    overweight: false,
    blocked: false,
  });
});

test("period advice soft-tilts overweight instead of hard-blocking", () => {
  const advice = getPeriodAdvice({
    symbol: "512890",
    plan: { amount: 2000, strategy: "fixed" },
    holdings: [
      { symbol: "512890", name: "红利低波", targetWeight: 40, actualWeight: 55 },
      { symbol: "563360", name: "A500", targetWeight: 60, actualWeight: 45 },
    ],
  });
  assert.equal(advice.stance, STANCE.INVEST);
  assert.ok(advice.amount > 0);
  assert.equal(advice.position.blocked, false);
  assert.equal(advice.position.overweight, true);
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
  assert.match(advice.bullets.join(" "), /留现金/);
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
  assert.match(advice.headline, /本期不投/);
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

test("period advice uses initial build gap instead of recurring budget", () => {
  const advice = getPeriodAdvice({
    symbol: "512890",
    plan: {
      amount: 5000,
      capital_base: 100000,
      initial_target_pct: 30,
      strategy: "fixed",
    },
    holdings: [
      {
        symbol: "512890",
        targetWeight: 100,
        actualWeight: 100,
        marketValue: 10000,
      },
    ],
  });
  assert.equal(advice.execution.phase, "initial");
  assert.equal(advice.pool.budget, 20000);
  assert.equal(advice.amount, 20000);
  assert.match(advice.headline, /建议投入/);
});
