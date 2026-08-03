import test from "node:test";
import assert from "node:assert/strict";

import {
  allocatePoolBudget,
  allocationForSymbol,
  commodityDcaMultiplier,
  dcaMultiplier,
  goldMacroMultiplier,
  inferSentimentMarket,
  normalizeStrategyConfig,
  rebalanceHint,
  sentimentMultiplier,
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

test("overweight soft-tilts instead of hard-blocking new money", () => {
  const result = allocatePoolBudget({
    budget: 2000,
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: false }, use_rebalance: true },
    holdings: [
      { symbol: "OVER", targetWeight: 40, actualWeight: 55, pePct: 0.1 },
      { symbol: "ROOM", targetWeight: 60, actualWeight: 45, pePct: 0.1 },
    ],
  });
  const over = allocationForSymbol(result, "OVER");
  const room = allocationForSymbol(result, "ROOM");
  assert.ok(over?.amount > 0);
  assert.ok(room?.amount > over.amount);
  assert.match(over.band || "", /超配少配/);
});

test("initial build deploys full gap and tilts by valuation multipliers", () => {
  const paused = allocatePoolBudget({
    budget: 20000,
    strategy: "valuation",
    preferTargetGap: true,
    strategyConfig: { sentiment: { enabled: false } },
    holdings: [
      { symbol: "510300", targetWeight: 60, actualWeight: 10, pePct: 0.9 },
      { symbol: "512890", targetWeight: 40, actualWeight: 5, pePct: 0.2 },
    ],
  });
  assert.equal(paused.deployTotal, 20000);
  assert.equal(allocationForSymbol(paused, "510300"), null);
  assert.equal(allocationForSymbol(paused, "512890")?.amount, 20000);
});

test("initial build keeps cash when every name is valuation-paused", () => {
  const result = allocatePoolBudget({
    budget: 10000,
    strategy: "valuation",
    preferTargetGap: true,
    strategyConfig: { sentiment: { enabled: false } },
    holdings: [
      { symbol: "510300", targetWeight: 60, actualWeight: 20, pePct: 0.95 },
      { symbol: "512890", targetWeight: 40, actualWeight: 10, pePct: 0.92 },
    ],
  });
  assert.equal(result.deployTotal, 0);
  assert.equal(result.cashKeep, 10000);
  assert.match(result.note || "", /留现金/);
});

test("initial build keeps overweight names but downweights them", () => {
  const result = allocatePoolBudget({
    budget: 10000,
    strategy: "fixed",
    preferTargetGap: true,
    holdings: [
      { symbol: "OVER", targetWeight: 40, actualWeight: 70 },
      { symbol: "ROOM", targetWeight: 60, actualWeight: 30 },
    ],
  });
  assert.equal(result.deployTotal, 10000);
  const over = allocationForSymbol(result, "OVER");
  const room = allocationForSymbol(result, "ROOM");
  assert.ok(over?.amount > 0);
  assert.ok(room.amount > over.amount);
});

test("commodity valuation uses technical grade, not equity PE pause", () => {
  const hot = dcaMultiplier({
    strategy: "valuation",
    assetClass: "commodity",
    pePct: null,
    grade: "E",
  });
  assert.equal(hot.mult, 0.25);
  assert.match(hot.band, /商品技术面/);
  assert.match(hot.hint, /技术面/);

  const dip = dcaMultiplier({
    strategy: "valuation",
    assetClass: "commodity",
    grade: "A",
  });
  assert.equal(dip.mult, 1.5);

  const byBias = commodityDcaMultiplier({ biasPct: -14 });
  assert.equal(byBias.mult, 1.5);
  assert.match(byBias.band, /深度回调/);
});

test("commodity multiplies technical grade by gold macro overlay", () => {
  assert.equal(goldMacroMultiplier({ degraded: true, mult: 1.2 }).mult, 1);
  const boosted = commodityDcaMultiplier({
    grade: "C",
    goldMacro: { degraded: false, mult: 1.2, band: "宏观友好", score: 80 },
  });
  assert.equal(boosted.techMult, 1);
  assert.equal(boosted.macroMult, 1.2);
  assert.equal(boosted.mult, 1.2);
  assert.match(boosted.band, /宏观友好/);

  const cooled = commodityDcaMultiplier({
    grade: "A",
    goldMacro: { degraded: false, mult: 0.7, band: "宏观逆风", score: 20 },
  });
  assert.equal(cooled.techMult, 1.5);
  assert.equal(cooled.mult, 1.05);
});

test("dividend valuation mixes PE with spread percentile", () => {
  const purePe = dcaMultiplier({
    strategy: "valuation",
    assetClass: "dividend",
    pePct: 0.9,
  });
  assert.equal(purePe.mult, 0);

  const mixed = dcaMultiplier({
    strategy: "valuation",
    assetClass: "dividend",
    pePct: 0.9,
    spreadPct: 0.9,
  });
  assert.ok(mixed.mult > purePe.mult);
  assert.match(mixed.hint, /混合/);

  const spreadOnly = dcaMultiplier({
    strategy: "valuation",
    assetClass: "dividend",
    spreadPct: 0.8,
  });
  assert.equal(spreadOnly.mult, 1.5);
  assert.match(spreadOnly.hint, /混合/);
});

test("equity_growth uses GROWTH_PE_BANDS and keeps 0.25x above 95%", () => {
  assert.equal(
    dcaMultiplier({ strategy: "valuation", assetClass: "equity_growth", pePct: 0.2 }).mult,
    1.3,
  );
  assert.equal(
    dcaMultiplier({ strategy: "valuation", assetClass: "equity_growth", pePct: 0.96 }).mult,
    0.25,
  );
  assert.equal(
    dcaMultiplier({ strategy: "valuation", assetClass: "equity_core", pePct: 0.96 }).mult,
    0,
  );
});

test("strategyOverrides apply per-symbol multipliers", () => {
  const result = allocatePoolBudget({
    budget: 2000,
    strategy: "valuation",
    strategyOverrides: { "159937": "fixed" },
    holdings: [
      { symbol: "159937", targetWeight: 50, pePct: 0.99, grade: "E", assetClass: "commodity" },
      { symbol: "510300", targetWeight: 50, pePct: 0.99, assetClass: "equity_core" },
    ],
  });
  const gold = allocationForSymbol(result, "159937");
  assert.ok(gold);
  assert.equal(gold.mult, 1);
  assert.match(gold.band, /指定/);
  assert.equal(allocationForSymbol(result, "510300"), null);
});

test("sentiment disabled keeps allocation identical to baseline", () => {
  const holdings = [
    { symbol: "510300", targetWeight: 60, actualWeight: 60, pePct: 0.5, assetClass: "equity_core" },
    { symbol: "512890", targetWeight: 40, actualWeight: 40, pePct: 0.3, assetClass: "dividend" },
  ];
  const baseline = allocatePoolBudget({ budget: 2000, holdings, strategy: "valuation" });
  const withOff = allocatePoolBudget({
    budget: 2000,
    holdings,
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: false } },
    sentimentByMarket: { A: { score: 10, zone: "panic", degraded: false } },
  });
  assert.equal(withOff.deployTotal, baseline.deployTotal);
  assert.equal(allocationForSymbol(withOff, "510300")?.amount, allocationForSymbol(baseline, "510300")?.amount);
});

test("extreme panic raises deploy while euphoria lowers it; pause stays zero", () => {
  // pePct 0.7 → base 0.5× so overlay can still move deployFrac below the 1.0 cap
  const holdings = [
    { symbol: "510300", targetWeight: 50, actualWeight: 50, pePct: 0.7, assetClass: "equity_core" },
    { symbol: "512890", targetWeight: 50, actualWeight: 50, pePct: 0.7, assetClass: "dividend" },
  ];
  const neutral = allocatePoolBudget({
    budget: 2000,
    holdings,
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: true, extremes_only: true }, use_rebalance: false },
    sentimentByMarket: { A: { score: 50, zone: "neutral", degraded: false } },
  });
  const panic = allocatePoolBudget({
    budget: 2000,
    holdings,
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: true, extremes_only: true }, use_rebalance: false },
    sentimentByMarket: { A: { score: 10, zone: "panic", degraded: false } },
  });
  const hot = allocatePoolBudget({
    budget: 2000,
    holdings,
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: true, extremes_only: true }, use_rebalance: false },
    sentimentByMarket: { A: { score: 90, zone: "euphoria", degraded: false } },
  });
  assert.ok(panic.deployTotal > neutral.deployTotal);
  assert.ok(hot.deployTotal < neutral.deployTotal);

  const paused = allocatePoolBudget({
    budget: 2000,
    holdings: [{ symbol: "510300", targetWeight: 100, pePct: 0.95, assetClass: "equity_core" }],
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: true } },
    sentimentByMarket: { A: { score: 5, zone: "panic", degraded: false } },
  });
  assert.equal(paused.deployTotal, 0);
});

test("commodity ignores A-share sentiment overlay", () => {
  const result = allocatePoolBudget({
    budget: 1000,
    strategy: "valuation",
    strategyConfig: { sentiment: { enabled: true, extremes_only: false } },
    sentimentByMarket: { A: { score: 10, zone: "panic", degraded: false } },
    holdings: [{ symbol: "159937", targetWeight: 100, pePct: null, grade: "E", assetClass: "commodity" }],
  });
  const gold = allocationForSymbol(result, "159937");
  // 商品走技术面 E=0.25，且不叠加 A 股情绪
  assert.equal(gold.mult, 0.25);
  assert.equal(gold.sentimentMult, 1);
});

test("sentimentMultiplier dead zone and market inference", () => {
  assert.equal(sentimentMultiplier({ score: 50, degraded: false }, { extremes_only: true }).mult, 1);
  assert.equal(sentimentMultiplier({ score: 12, degraded: false }, { extremes_only: true }).mult, 1.3);
  assert.equal(inferSentimentMarket({ indexCode: "NDX" }), "US");
  assert.equal(inferSentimentMarket({ indexCode: "HSTECH" }), "HK");
  assert.equal(inferSentimentMarket({ indexCode: "000510" }), "A");
});

test("normalizeStrategyConfig includes sentiment defaults", () => {
  const cfg = normalizeStrategyConfig(null);
  assert.equal(cfg.sentiment.enabled, true);
  assert.equal(cfg.sentiment.extremes_only, true);
  assert.deepEqual(cfg.sentiment.apply_to, ["valuation", "grade", "custom"]);
});
