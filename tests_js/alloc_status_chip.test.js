import test from "node:test";
import assert from "node:assert/strict";
import { allocStatusChip } from "../js/decision-status.js";

test("allocStatusChip re-export path stays stable for pool-alloc consumers", () => {
  assert.equal(allocStatusChip({ amount: 1 }), "可买");
  assert.equal(allocStatusChip({ amount: 0, band: "高估区" }), "偏贵");
});
