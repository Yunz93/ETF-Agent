import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOtcDcaBuy,
  enumerateOtcScheduleDates,
  materializeOtcDcaBuys,
  normalizeOtcDcaSchedule,
  otcDcaTradeId,
} from "../js/otc-dca.js";
import { normalizeBuys, normalizePlan, WORKSPACE_VERSION } from "../js/workspace_model.js";

test("workspace version is 10 for otc fields", () => {
  assert.equal(WORKSPACE_VERSION, 10);
});

test("normalize otc schedule clamps cadence day and requires price", () => {
  const ok = normalizeOtcDcaSchedule({
    symbol: "512890",
    amount: 1000,
    cadence: "monthly",
    day: 31,
    start_date: "2026-01-01",
    unit_price: 1.2,
    fee_rate_pct: 0.15,
  });
  assert.equal(ok.day, 28);
  assert.equal(ok.symbol, "512890");
  assert.equal(ok.fee_rate_pct, 0.15);

  assert.equal(
    normalizeOtcDcaSchedule({
      symbol: "512890",
      amount: 1000,
      start_date: "2026-01-01",
      unit_price: 0,
    }),
    null,
  );
});

test("enumerate monthly dates from start through asOf", () => {
  const dates = enumerateOtcScheduleDates(
    {
      id: "s1",
      symbol: "512890",
      amount: 1000,
      cadence: "monthly",
      day: 8,
      start_date: "2026-01-01",
      unit_price: 1,
    },
    new Date(2026, 2, 10),
  );
  assert.deepEqual(dates, ["2026-01-08", "2026-02-08", "2026-03-08"]);
});

test("build buy deducts fee from amount before shares", () => {
  const buy = buildOtcDcaBuy({
    schedule: {
      id: "s1",
      symbol: "512890",
      amount: 1000,
      cadence: "monthly",
      day: 1,
      start_date: "2026-01-01",
      unit_price: 1,
      fee_rate_pct: 0.15,
    },
    date: "2026-01-01",
  });
  assert.equal(buy.channel, "otc");
  assert.equal(buy.otc_schedule_id, "s1");
  assert.equal(buy.fee, 1.5);
  assert.equal(buy.shares, 998.5);
  assert.equal(buy.id, otcDcaTradeId("s1", "2026-01-01"));
});

test("materialize creates buys once and advances last_synced_date", () => {
  const schedule = {
    id: "s1",
    symbol: "512890",
    amount: 1000,
    cadence: "monthly",
    day: 1,
    start_date: "2026-01-01",
    unit_price: 2,
    fee_rate_pct: 0,
    enabled: true,
  };
  const first = materializeOtcDcaBuys({
    schedules: [schedule],
    buys: [],
    asOf: new Date(2026, 2, 15),
  });
  assert.equal(first.created, 3);
  assert.equal(first.buys.length, 3);
  assert.equal(first.schedules[0].last_synced_date, "2026-03-01");

  const second = materializeOtcDcaBuys({
    schedules: first.schedules,
    buys: first.buys,
    asOf: new Date(2026, 2, 15),
  });
  assert.equal(second.created, 0);
  assert.equal(second.buys.length, 3);

  const april = materializeOtcDcaBuys({
    schedules: second.schedules,
    buys: second.buys,
    asOf: new Date(2026, 3, 2),
  });
  assert.equal(april.created, 1);
  assert.equal(april.buys.length, 4);
  assert.equal(april.schedules[0].last_synced_date, "2026-04-01");
});

test("deleted auto buy is not recreated after sync advanced", () => {
  const schedule = {
    id: "s1",
    symbol: "512890",
    amount: 500,
    cadence: "monthly",
    day: 1,
    start_date: "2026-01-01",
    unit_price: 1,
    enabled: true,
  };
  const first = materializeOtcDcaBuys({
    schedules: [schedule],
    buys: [],
    asOf: new Date(2026, 1, 5),
  });
  assert.equal(first.created, 2);
  const remaining = first.buys.filter((row) => row.date !== "2026-01-01");
  const again = materializeOtcDcaBuys({
    schedules: first.schedules,
    buys: remaining,
    asOf: new Date(2026, 1, 5),
  });
  assert.equal(again.created, 0);
  assert.equal(again.buys.length, 1);
});

test("plan and buys normalize preserve otc fields", () => {
  const plan = normalizePlan({
    otc_dca: [
      {
        id: "s1",
        symbol: "512890",
        amount: 800,
        cadence: "weekly",
        day: 9,
        start_date: "2026-01-05",
        unit_price: 1.05,
        fee_rate_pct: 0.1,
      },
    ],
  });
  assert.equal(plan.otc_dca.length, 1);
  assert.equal(plan.otc_dca[0].day, 7);
  const buys = normalizeBuys([
    {
      id: "otc_dca_s1_2026-01-05",
      symbol: "512890",
      date: "2026-01-05",
      price: 1.05,
      shares: 100,
      fee: 0.8,
      channel: "otc",
      otc_schedule_id: "s1",
    },
  ]);
  assert.equal(buys[0].channel, "otc");
  assert.equal(buys[0].otc_schedule_id, "s1");
});
