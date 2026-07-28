import test from "node:test";
import assert from "node:assert/strict";

import {
  allocatePoolBudget,
  allocationForSymbol,
  rebalanceHint,
  valuationDcaMultiplier,
} from "../js/strategy.js";

test("valuation grid follows PE percentile boundaries", () => {
  assert.equal(valuationDcaMultiplier({ pePct: 0.2 }).mult, 1.5);
  assert.equal(valuationDcaMultiplier({ pePct: 0.4 }).mult, 1.2);
  assert.equal(valuationDcaMultiplier({ pePct: 0.6 }).mult, 1);
  assert.equal(valuationDcaMultiplier({ pePct: 0.8 }).mult, 0.5);
  assert.equal(valuationDcaMultiplier({ pePct: 0.81 }).mult, 0);
});

test("allocation preserves budget and leaves cash when the pool is expensive", () => {
  const result = allocatePoolBudget({
    budget: 2000,
    holdings: [
      { symbol: "510300", targetWeight: 60, actualWeight: 60, pePct: 0.7 },
      { symbol: "512890", targetWeight: 40, actualWeight: 40, pePct: 0.5 },
    ],
  });
  const allocated = result.allocations.reduce((sum, item) => sum + item.amount, 0);
  assert.equal(allocated, result.deployTotal);
  assert.equal(result.deployTotal + result.cashKeep, result.budget);
  assert.ok(result.cashKeep > 0);
  assert.equal(allocationForSymbol(result, "510300")?.symbol, "510300");
});

test("allocation keeps all cash when every holding is paused", () => {
  const result = allocatePoolBudget({
    budget: 2000,
    holdings: [
      { symbol: "510300", targetWeight: 50, pePct: 0.9 },
      { symbol: "512890", targetWeight: 50, grade: "E" },
    ],
  });
  assert.equal(result.deployTotal, 0);
  assert.equal(result.cashKeep, 2000);
  assert.equal(result.skipped.length, 2);
});

test("rebalance hint only appears outside the five-point tolerance", () => {
  assert.equal(rebalanceHint({ targetWeight: 30, actualWeight: 34.9 }), null);
  assert.match(
    rebalanceHint({ targetWeight: 30, actualWeight: 36, name: "红利低波" }),
    /高出目标 6.0 pp/,
  );
});
