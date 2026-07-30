import test from "node:test";
import assert from "node:assert/strict";

import { buildPoolHoldingsForAllocation } from "../js/pool-alloc.js";
import { state } from "../js/state.js";

test("pool allocation input combines holdings, live quotes, and analysis cache", () => {
  state.etfs = [
    { symbol: "512890", name: "红利低波ETF", shares: 1000, target_weight: 60 },
    { symbol: "510300", name: "沪深300ETF", shares: 100, target_weight: 40 },
  ];
  state.quotesBySymbol = {
    "512890": { price: 1.2 },
    "510300": { price: 4.8 },
  };
  state.analysisSymbol = "512890";
  state.analysisCache = {
    "512890": {
      supported: true,
      valuation: { pe_percentile_10y: 0.25 },
      score: { grade: "B" },
    },
  };

  const holdings = buildPoolHoldingsForAllocation();
  assert.equal(holdings[0].analyzed, true);
  assert.equal(holdings[0].pePct, 0.25);
  assert.equal(holdings[0].grade, "B");
  assert.equal(holdings[1].analyzed, false);
  assert.ok(Math.abs(holdings[0].actualWeight + holdings[1].actualWeight - 100) < 0.001);
});

test("pool allocation input passes assetClass and spreadPct from analysis cache", () => {
  state.etfs = [{ symbol: "512890", name: "红利低波ETF", shares: 1000, target_weight: 100 }];
  state.quotesBySymbol = { "512890": { price: 1.2 } };
  state.analysisSymbol = null;
  state.analysisCache = {
    "512890": {
      supported: true,
      asset_class: "dividend",
      valuation: { pe_percentile_10y: 0.4 },
      spread: { percentile: 0.72 },
      score: { grade: "B" },
    },
  };

  const holdings = buildPoolHoldingsForAllocation();
  assert.equal(holdings[0].assetClass, "dividend");
  assert.equal(holdings[0].spreadPct, 0.72);
  assert.equal(holdings[0].pePct, 0.4);
});

test("zero-share holdings still participate in pool weight stats", () => {
  state.etfs = [
    { symbol: "512890", name: "红利低波ETF", shares: 0, target_weight: 60 },
    { symbol: "510300", name: "沪深300ETF", shares: 100, target_weight: 40 },
  ];
  state.quotesBySymbol = {
    "512890": { price: 1.2 },
    "510300": { price: 4 },
  };
  state.analysisSymbol = null;
  state.analysisCache = {};

  const holdings = buildPoolHoldingsForAllocation();
  assert.equal(holdings[0].marketValue, 0);
  assert.equal(holdings[0].actualWeight, 0);
  assert.equal(holdings[1].actualWeight, 100);
});

test("analysis freshness rejects errors and expired payloads", async () => {
  const { isAnalysisFresh, isAnalysisUsable } = await import("../js/analysis-cache.js");
  assert.equal(isAnalysisUsable({ supported: true }), true);
  assert.equal(isAnalysisUsable({ supported: false }), false);
  assert.equal(isAnalysisUsable({ error: "x" }), false);
  assert.equal(isAnalysisFresh({ supported: true, updated_at: new Date().toISOString() }), true);
  assert.equal(
    isAnalysisFresh({
      supported: true,
      updated_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    }),
    false,
  );
});
