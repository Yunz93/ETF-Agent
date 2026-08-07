import test from "node:test";
import assert from "node:assert/strict";
import { allocStatusChip } from "../js/pool-alloc.js";

test("allocStatusChip maps buy and common skip reasons", () => {
  assert.equal(allocStatusChip({ amount: 1200, band: "低估区 · 建仓补缺" }), "可买");
  assert.equal(allocStatusChip({ amount: 0, band: "高估区", reason: "估值偏贵" }), "偏贵");
  assert.equal(allocStatusChip({ amount: 0, band: "等待行情恢复" }), "等行情");
  assert.equal(allocStatusChip({ amount: 0, band: "已达目标" }), "已满");
  assert.equal(allocStatusChip({ amount: 0, band: "无目标" }), "无目标");
  assert.equal(allocStatusChip({ amount: 0, reason: "不足一手" }), "攒一手");
});
