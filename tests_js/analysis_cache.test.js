import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisCacheKey,
  fetchAnalysis,
  isAnalysisFresh,
  prioritizeAnalysis,
} from "../js/analysis-cache.js";
import { state } from "../js/state.js";

function analysisFields() {
  return { asset_class: "equity_core", updated_at: new Date().toISOString(),
    valuation: { pe: 12, pe_percentile_10y: 0.5 },
    technicals: { bias_pct: 0, rsi14: 50 }, spread: { value: 2 },
    score: { status: "diagnostic_only", grade: "C", total: 60, missing_required: [] } };
}

test("analysisCacheKey falls back for empty symbol", () => {
  assert.equal(analysisCacheKey(""), "__default__");
  assert.equal(analysisCacheKey("512890"), "512890");
});

test("isAnalysisFresh respects TTL and errors", () => {
  assert.equal(isAnalysisFresh(null), false);
  assert.equal(isAnalysisFresh({ error: "x" }), false);
  assert.equal(isAnalysisFresh({ supported: false }), false);
  assert.equal(isAnalysisFresh({ supported: true, ...analysisFields(), updated_at: new Date().toISOString() }), true);
  assert.equal(
    isAnalysisFresh({
      supported: true, ...analysisFields(),
      updated_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    }),
    false,
  );
});

test("fetchAnalysis skips network when full cache is fresh", async () => {
  const key = analysisCacheKey("512890");
  state.analysisCache[key] = {
    supported: true, ...analysisFields(),
    symbol: "512890",
    updated_at: new Date().toISOString(),
    score: { grade: "B" },
  };
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    return { json: async () => ({ supported: true, ...analysisFields() }) };
  };
  try {
    const payload = await fetchAnalysis("512890");
    assert.equal(payload.score.grade, "B");
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete state.analysisCache[key];
  }
});

test("fetchAnalysis refetches when only lite cache exists", async () => {
  const key = analysisCacheKey("510300");
  state.analysisCache[key] = {
    supported: true, ...analysisFields(),
    lite: true,
    symbol: "510300",
    updated_at: new Date().toISOString(),
    score: { grade: "C" },
  };
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async (url) => {
    called += 1;
    assert.match(String(url), /symbol=510300/);
    assert.doesNotMatch(String(url), /lite=1/);
    return {
      json: async () => ({
        supported: true, ...analysisFields(),
        symbol: "510300",
        updated_at: new Date().toISOString(),
        score: { grade: "A" },
        chart: { points: [1, 2, 3] },
      }),
    };
  };
  try {
    const payload = await fetchAnalysis("510300", { lite: false });
    assert.equal(called, 1);
    assert.equal(payload.score.grade, "A");
    assert.notEqual(payload.lite, true);
  } finally {
    globalThis.fetch = originalFetch;
    delete state.analysisCache[key];
  }
});

test("prioritizeAnalysis is exported and callable", () => {
  state.etfs = [{ symbol: "512890" }];
  assert.equal(typeof prioritizeAnalysis, "function");
  const result = prioritizeAnalysis("512890");
  assert.ok(result == null || typeof result.then === "function");
});
