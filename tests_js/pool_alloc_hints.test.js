import test from "node:test";
import assert from "node:assert/strict";

import { sameIndexHigherFeeHints } from "../js/pool-alloc.js";

test("sameIndexHigherFeeHints flags higher-fee twin on shared index", () => {
  const hints = sameIndexHigherFeeHints({
    symbols: ["512890", "563020", "513100", "513390", "510300"],
    analysisRegistry: {
      "512890": { index_code: "H30269" },
      "563020": { index_code: "H30269" },
      "513100": { index_code: "NDX" },
      "513390": { index_code: "NDX" },
      "510300": { index_code: "000300" },
    },
    products: {
      "512890": { annual_fee_pct: 0.6 },
      "563020": { annual_fee_pct: 0.4 },
      "513100": { annual_fee_pct: 0.5 },
      "513390": { annual_fee_pct: 0.5 },
      "510300": { annual_fee_pct: 0.5 },
    },
  });
  assert.equal(hints["512890"], "同指数有更低费率品种");
  assert.equal(hints["563020"], undefined);
  assert.equal(hints["513100"], undefined); // 费率相同不提示
  assert.equal(hints["510300"], undefined); // 独苗
});

test("sameIndexHigherFeeHints skips when fee data missing", () => {
  const hints = sameIndexHigherFeeHints({
    symbols: ["512890", "563020"],
    analysisRegistry: {
      "512890": { index_code: "H30269" },
      "563020": { index_code: "H30269" },
    },
    products: {
      "512890": { annual_fee_pct: 0.6 },
      // 563020 无费率
    },
  });
  assert.deepEqual(hints, {});
});
