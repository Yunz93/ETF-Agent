import test from "node:test";
import assert from "node:assert/strict";
import {
  allocStatusChip,
  allocStatusHint,
  orderActionLabel,
  positionGlance,
} from "../js/decision-status.js";

test("allocStatusChip maps buy and common skip reasons", () => {
  assert.equal(allocStatusChip({ amount: 1200, band: "低估区 · 建仓补缺" }), "可买");
  assert.equal(allocStatusChip({ amount: 0, band: "高估区", reason: "估值偏贵" }), "偏贵");
  assert.equal(allocStatusChip({ amount: 0, band: "等待行情恢复" }), "等行情");
  assert.equal(allocStatusChip({ amount: 0, band: "已达目标" }), "已满");
  assert.equal(allocStatusChip({ amount: 0, reason: "不足一手" }), "攒一手");
  assert.ok(allocStatusHint("偏贵").includes("估值"));
});

test("positionGlance prefers pool structure and appends total-capital secondary", () => {
  const glance = positionGlance({
    targetWeight: 40,
    actualWeight: 45.2,
    drift: 5.2,
    assetWeight: 12.1,
    poolPositionPct: 30,
  });
  assert.match(glance.primary, /池内 45\.2%/);
  assert.match(glance.primary, /目标 40\.0%/);
  assert.match(glance.secondary, /总仓 12\.1%/);
  assert.match(glance.secondary, /池总仓 30\.0%/);
});

test("orderActionLabel stays aligned with alloc chips", () => {
  assert.equal(orderActionLabel({ willOrder: true, shares: 1000 }), "可买 1,000 份");
  assert.equal(
    orderActionLabel({ blockedReason: "insufficient_lot", initial: true }),
    "攒一手（余量下期）",
  );
  assert.equal(orderActionLabel({ blockedReason: "fee_inefficient" }), "攒一手");
  assert.equal(orderActionLabel({}), "不投");
});
