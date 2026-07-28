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
