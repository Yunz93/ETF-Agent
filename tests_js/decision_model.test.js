import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultDecision,
  normalizeDecision,
  primaryInstrument,
  projectDecisionEtfs,
  sleeveBySymbol,
  upsertInstrument,
} from "../js/decision-model.js";

test("default decision includes nasdaq, spx, dividend and gold", () => {
  const decision = defaultDecision();
  const codes = decision.sleeves.map((row) => row.index_code).sort();
  assert.deepEqual(codes, ["GOLD", "H30269", "NDX", "SPX"]);
  assert.equal(decision.sleeves.reduce((sum, row) => sum + row.target_pct, 0), 100);
});

test("normalize keeps exchange ETF and OTC fund in the same sleeve", () => {
  const decision = normalizeDecision({
    sleeves: [
      {
        id: "nasdaq",
        name: "纳指",
        index_code: "NDX",
        target_pct: 70,
        instruments: [
          { symbol: "513390", kind: "exchange", role: "primary", name: "博时纳指" },
          { symbol: "000834", kind: "fund", name: "场外联接" },
        ],
      },
      {
        id: "gold",
        name: "黄金",
        index_code: "GOLD",
        target_pct: 30,
        instruments: [{ symbol: "159937", kind: "exchange", role: "primary" }],
      },
    ],
  });
  const nasdaq = decision.sleeves.find((row) => row.id === "nasdaq");
  assert.equal(nasdaq.instruments.length, 2);
  assert.equal(nasdaq.instruments.some((row) => row.kind === "fund"), true);
  assert.equal(primaryInstrument(nasdaq).symbol, "513390");
  assert.equal(sleeveBySymbol(decision, "000834").id, "nasdaq");
});

test("projectDecisionEtfs uses sleeve target on the primary exchange product", () => {
  const etfs = projectDecisionEtfs(defaultDecision());
  const nasdaq = etfs.find((row) => row.symbol === "513390");
  assert.ok(nasdaq);
  assert.equal(nasdaq.target_weight, 25);
  assert.equal(nasdaq.shares, 0);
});

test("upsertInstrument can add an alternate fund without dropping the primary", () => {
  const base = defaultDecision();
  const sleeve = base.sleeves.find((row) => row.id === "dividend");
  const next = upsertInstrument(sleeve, { symbol: "007394", kind: "fund", name: "红利联接" });
  assert.equal(next.instruments.length, 2);
  assert.equal(primaryInstrument(next).symbol, "512890");
});
