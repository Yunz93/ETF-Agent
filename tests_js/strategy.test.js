import test from "node:test";
import assert from "node:assert/strict";

import {
  allocatePoolBudget,
  allocationForSymbol,
  dcaMultiplier,
  normalizeStrategyConfig,
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

test("fixed strategy always uses 1x and deploys full budget by target weight", () => {
  const result = allocatePoolBudget({
    budget: 2000,
    strategy: "fixed",
    holdings: [
      { symbol: "510300", targetWeight: 60, pePct: 0.9 },
      { symbol: "512890", targetWeight: 40, pePct: 0.9 },
    ],
  });
  assert.equal(result.deployTotal, 2000);
  assert.equal(result.cashKeep, 0);
  assert.equal(allocationForSymbol(result, "510300")?.amount, 1200);
  assert.equal(allocationForSymbol(result, "512890")?.amount, 800);
});

test("grade strategy ignores PE and uses score bands", () => {
  assert.equal(dcaMultiplier({ strategy: "grade", pePct: 0.9, grade: "A" }).mult, 1.5);
  assert.equal(dcaMultiplier({ strategy: "grade", pePct: 0.1, grade: "E" }).mult, 0);
});

test("rebalance strategy prefers underweight holdings", () => {
  const result = allocatePoolBudget({
    budget: 1000,
    strategy: "rebalance",
    holdings: [
      { symbol: "510300", targetWeight: 50, actualWeight: 70 },
      { symbol: "512890", targetWeight: 50, actualWeight: 30 },
    ],
  });
  assert.equal(result.deployTotal, 1000);
  assert.equal(allocationForSymbol(result, "512890")?.amount, 1000);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].symbol, "510300");
});

test("custom strategy uses editable PE bands", () => {
  const config = normalizeStrategyConfig({
    pe_bands: [
      { max_pct: 50, mult: 2, label: "便宜" },
      { max_pct: 100, mult: 0, label: "贵" },
    ],
    use_rebalance: false,
  });
  assert.equal(dcaMultiplier({ strategy: "custom", strategyConfig: config, pePct: 0.4 }).mult, 2);
  assert.equal(dcaMultiplier({ strategy: "custom", strategyConfig: config, pePct: 0.7 }).mult, 0);

  const result = allocatePoolBudget({
    budget: 2000,
    strategy: "custom",
    strategyConfig: config,
    holdings: [
      { symbol: "510300", targetWeight: 50, pePct: 0.4 },
      { symbol: "512890", targetWeight: 50, pePct: 0.7 },
    ],
  });
  assert.equal(result.deployTotal, 2000);
  assert.equal(allocationForSymbol(result, "510300")?.amount, 2000);
  assert.equal(result.skipped[0].symbol, "512890");
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

test("allocation blocks an ETF above the hard position ceiling", () => {
  const result = allocatePoolBudget({
    budget: 2000,
    strategy: "valuation",
    holdings: [
      { symbol: "OVER", targetWeight: 40, actualWeight: 45.1, pePct: 0.1 },
      { symbol: "ROOM", targetWeight: 60, actualWeight: 54.9, pePct: 0.1 },
    ],
  });
  assert.equal(result.allocations.some((item) => item.symbol === "OVER"), false);
  assert.equal(result.allocations.find((item) => item.symbol === "ROOM")?.amount, result.deployTotal);
  assert.match(result.skipped.find((item) => item.symbol === "OVER")?.reason || "", /仓位高于目标/);
});

test("initial build prefers target gaps while still respecting valuation pause", () => {
  const paused = allocatePoolBudget({
    budget: 20000,
    strategy: "valuation",
    preferTargetGap: true,
    holdings: [
      { symbol: "510300", targetWeight: 60, actualWeight: 10, pePct: 0.9 },
      { symbol: "512890", targetWeight: 40, actualWeight: 5, pePct: 0.2 },
    ],
  });
  assert.equal(allocationForSymbol(paused, "510300"), null);
  assert.ok(allocationForSymbol(paused, "512890")?.amount > 0);
});
