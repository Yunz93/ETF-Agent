import test from "node:test";
import assert from "node:assert/strict";
import { validateTargetAllocation } from "../js/target-allocation.js";

test("target allocation accepts precise weights summing to 100", () => {
  assert.deepEqual(validateTargetAllocation([
    { symbol: "A", value: "33.33" },
    { symbol: "B", value: "66.67" },
  ]), { ok: true, total: 100, weights: [{ symbol: "A", value: 33.33 }, { symbol: "B", value: 66.67 }] });
});

test("target allocation rejects incomplete, excessive, and imprecise values", () => {
  for (const value of ["", "-1", "100.01", "1.001", "abc"]) {
    assert.equal(validateTargetAllocation([{ symbol: "A", value }]).ok, false);
  }
  assert.equal(validateTargetAllocation([{ symbol: "A", value: "40" }, { symbol: "B", value: "50" }]).ok, false);
});
