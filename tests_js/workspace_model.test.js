import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseWorkspaceSource,
  normalizeBuys,
  normalizePlan,
  normalizeWorkspaceEntries,
} from "../js/workspace_model.js";

test("workspace source prefers server, then local cache, then defaults", () => {
  const remote = { etfs: [{ symbol: "510300" }] };
  const local = { etfs: [{ symbol: "512890" }] };
  assert.equal(chooseWorkspaceSource(remote, local).source, "server");
  assert.equal(chooseWorkspaceSource({ etfs: [] }, local).source, "local-cache");
  assert.equal(chooseWorkspaceSource({ etfs: [] }, { etfs: [] }).source, "default-pool");
});

test("legacy workspace entries receive default target weights", () => {
  const entries = normalizeWorkspaceEntries([
    { symbol: "512890", shares: 100, cost: 1.2 },
    { symbol: "510300", shares: -1, cost: "bad" },
  ]);
  assert.equal(entries[0].target_weight, 30);
  assert.equal(entries[1].target_weight, 25);
  assert.equal(entries[1].shares, 0);
  assert.equal(entries[1].cost, 0);
});

test("plan normalization clamps execution day by cadence", () => {
  assert.equal(normalizePlan({ cadence: "monthly", day: 31 }).day, 28);
  assert.equal(normalizePlan({ cadence: "weekly", day: 9 }).day, 7);
  assert.equal(normalizePlan({ amount: -1 }).amount, 0);
});

test("buy normalization deduplicates records and rejects impossible dates", () => {
  const buys = normalizeBuys([
    { id: "buy-1", symbol: "sh510300", date: "2026-07-28", shares: 10, price: 4.2 },
    { id: "buy-1", symbol: "510300", date: "2026-07-28", shares: 20, price: 4.1 },
    { symbol: "512890", date: "2026-02-31", shares: 10, price: 1.2 },
  ]);
  assert.equal(buys.length, 1);
  assert.equal(buys[0].symbol, "510300");
});
