import test from "node:test";
import assert from "node:assert/strict";

import { applyIndexExposureGroups } from "../js/index-exposure.js";

test("applyIndexExposureGroups keeps lowest-fee twin and merges weights", () => {
  const { holdings, skipped } = applyIndexExposureGroups(
    [
      { symbol: "512890", name: "华泰", targetWeight: 20 },
      { symbol: "563020", name: "易方达", targetWeight: 15 },
      { symbol: "510300", name: "沪深300", targetWeight: 65 },
    ],
    {
      analysisRegistry: {
        "512890": { index_code: "H30269" },
        "563020": { index_code: "H30269" },
        "510300": { index_code: "000300" },
      },
      products: {
        "512890": { annual_fee_pct: 0.6 },
        "563020": { annual_fee_pct: 0.4 },
      },
    },
  );
  const by = Object.fromEntries(holdings.map((row) => [row.symbol, row]));
  assert.equal(by["563020"].targetWeight, 35);
  assert.equal(by["512890"].targetWeight, 0);
  assert.ok(skipped.some((row) => row.symbol === "512890"));
});

test("applyIndexExposureGroups without fee data keeps both and tags group weight", () => {
  const { holdings, skipped } = applyIndexExposureGroups(
    [
      { symbol: "513100", targetWeight: 10 },
      { symbol: "513390", targetWeight: 15 },
    ],
    {
      analysisRegistry: {
        "513100": { index_code: "NDX" },
        "513390": { index_code: "NDX" },
      },
      products: {},
    },
  );
  assert.equal(skipped.length, 0);
  assert.equal(holdings[0].indexGroupWeight, 25);
  assert.equal(holdings[1].indexGroupWeight, 25);
  assert.equal(holdings[0].targetWeight, 10);
});
