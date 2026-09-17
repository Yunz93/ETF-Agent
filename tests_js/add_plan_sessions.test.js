import test from "node:test";
import assert from "node:assert/strict";
import { createAddPlanSession, evaluateAddPlanSession, normalizeAddPlanSessions } from "../js/add-plan.js";
import { normalizePlan } from "../js/workspace_model.js";

function session(options = {}) {
  return createAddPlanSession({ symbol: "513100", period: "2026-09-01", expires: "2026-10-01", now: new Date("2026-09-16T02:00:00Z"), price: 100, amount: 1000, config: { preset: "steady" }, ...options });
}

const evaluate = (value, options = {}) => evaluateAddPlanSession(value, { today: "2026-09-16", price: 95, ...options });

test("saved anchor and tier prices remain stable as the market falls", () => {
  const saved = session();
  const first = evaluate(saved, { price: 100 });
  const second = evaluate(saved, { price: 95 });
  assert.deepEqual(first.levels.map(row => row.trigger), [97, 95]);
  assert.deepEqual(second.levels.map(row => row.trigger), [97, 95]);
  assert.equal(first.levels[0].triggered, false);
  assert.equal(second.levels[0].triggered, true);
  assert.equal(second.levels[1].triggered, true);
  assert.equal(saved.anchor_price, 100);
});

test("new fills including commission consume tier budgets only once across evaluations", () => {
  const saved = session();
  const buys = [{ id: "fill-1", symbol: "513100", date: "2026-09-16", shares: 4, price: 100, fee: 5 }];
  const first = evaluate(saved, { buys });
  const second = evaluate(saved, { buys });
  assert.equal(first.remaining, 595);
  assert.equal(first.levels[0].completed, true);
  assert.equal(first.levels[1].amount, 595);
  assert.deepEqual(first, second);
  buys.push({ id: "fill-2", symbol: "513100", date: "2026-09-17", shares: 6, price: 100, fee: 5 });
  const exhausted = evaluate(saved, { buys });
  assert.equal(exhausted.remaining, 0);
  assert.ok(exhausted.levels.every(row => row.completed && !row.triggered));
});

test("existing fills are excluded when caller supplies remaining period budget", () => {
  const existing = { id: "prior", symbol: "513100", date: "2026-09-15", shares: 4, price: 100, fee: 0 };
  const saved = session({ buys: [existing], amount: 600 });
  assert.equal(evaluate(saved, { buys: [existing] }).remaining, 600);
  const fills = [existing, { id: "new", symbol: "513100", date: "2026-09-16", shares: 2, price: 100, fee: 0 }];
  assert.equal(evaluate(saved, { buys: fills }).remaining, 400);
});

test("other ETFs and fills outside the saved period do not consume the session", () => {
  const saved = session();
  const buys = [
    { id: "other", symbol: "513500", date: "2026-09-16", shares: 4, price: 100 },
    { id: "past", symbol: "513100", date: "2026-08-31", shares: 4, price: 100 },
    { id: "future", symbol: "513100", date: "2026-10-01", shares: 4, price: 100 },
  ];
  assert.equal(evaluate(saved, { buys }).remaining, 1000);
});

test("expiration disables triggers without mutating saved price or consumption history", () => {
  const saved = session();
  const original = structuredClone(saved);
  const expired = evaluate(saved, { today: "2026-10-01", price: 90 });
  assert.equal(expired.expired, true);
  assert.ok(expired.levels.every(row => !row.triggered));
  assert.deepEqual(saved, original);
});

test("workspace normalization retains saved session and is idempotent", () => {
  const saved = session({ buys: [{ id: "prior", symbol: "513100" }] });
  const initial = normalizePlan({ amount: 1000, add_plan_sessions: { "513100": saved } });
  const loaded = normalizePlan(JSON.parse(JSON.stringify(initial)));
  assert.deepEqual(loaded.add_plan_sessions, initial.add_plan_sessions);
  assert.deepEqual(loaded.add_plan_sessions["513100"].baseline_buy_ids, ["prior"]);
  assert.equal(loaded.add_plan_sessions["513100"].anchor_price, 100);
});

test("session normalization rejects impossible calendar dates and reversed expiration", () => {
  const saved = session();
  for (const invalid of [{ period: "2026-02-30" }, { expires: "2026-02-30" }, { expires: saved.period }, { expires: "2026-08-01" }, { created_at: 5 }]) {
    assert.deepEqual(normalizeAddPlanSessions({ "513100": { ...saved, ...invalid } }), {}, JSON.stringify(invalid));
  }
});

test("reanchoring cannot replenish spent budget and archives the superseded observation", () => {
  const old = session();
  const buys = [{ id: "fill", symbol: "513100", date: "2026-09-16", shares: 4, price: 100, fee: 0 }];
  const next = session({ price: 95, amount: 1000, previousSession: old, buys });
  assert.equal(next.amount, 600);
  assert.equal(evaluate(next, { buys }).remaining, 600);
  assert.equal(next.previous_snapshots.length, 1);
  const archived = next.previous_snapshots[0];
  assert.equal(archived.anchor_price, 100);
  assert.equal(archived.spent, 400);
  assert.equal(archived.remaining, 600);
  assert.ok(!Object.hasOwn(archived, "baseline_buy_ids"));
  assert.ok(!Object.hasOwn(archived, "buys"));
  const again = session({ price: 93, amount: 1000, remainingAmount: 500, previousSession: next, buys });
  assert.equal(again.amount, 500);
  assert.equal(again.previous_snapshots.length, 2);
  assert.equal(old.anchor_price, 100);
});

test("new period can start a new budget and retains the expired session history", () => {
  const old = session();
  const next = session({ period: "2026-10-01", expires: "2026-11-01", now: new Date("2026-10-02T02:00:00Z"), amount: 2000, previousSession: old });
  assert.equal(next.amount, 2000);
  assert.equal(next.previous_snapshots[0].expires, "2026-10-01");
  assert.equal(next.previous_snapshots[0].anchor_price, 100);
});

test("saved history retains at most 24 summaries across workspace normalization", () => {
  let prior = session();
  for (let i = 0; i < 30; i++) prior = session({ previousSession: prior, price: 100 + i });
  assert.equal(prior.previous_snapshots.length, 24);
  const loaded = normalizePlan({ add_plan_sessions: { "513100": prior } }).add_plan_sessions["513100"];
  assert.deepEqual(loaded.previous_snapshots, prior.previous_snapshots);
});
