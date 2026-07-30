import test from "node:test";
import assert from "node:assert/strict";

import { clampAxisLabelX, placeChartTooltip } from "../js/chart.js";

test("axis labels stay fully inside the canvas at both edges", () => {
  assert.equal(clampAxisLabelX(64, 48, 320), 64);
  assert.equal(clampAxisLabelX(302, 48, 320), 290);
  assert.equal(clampAxisLabelX(289, 48, 307), 277);
});

test("chart tooltip stays inside the right and bottom edges", () => {
  const position = placeChartTooltip({
    anchorX: 302,
    anchorY: 330,
    tooltipWidth: 148,
    tooltipHeight: 96,
    containerWidth: 320,
    containerHeight: 360,
  });

  assert.deepEqual(position, { left: 164, top: 224 });
  assert.ok(position.left + 148 <= 312);
  assert.ok(position.top + 96 <= 352);
});

test("chart tooltip also fits a narrow mobile chart container", () => {
  const position = placeChartTooltip({
    anchorX: 289,
    anchorY: 180,
    tooltipWidth: 148,
    tooltipHeight: 96,
    containerWidth: 307,
    containerHeight: 360,
  });

  assert.deepEqual(position, { left: 151, top: 74 });
  assert.ok(position.left + 148 <= 299);
});

test("chart tooltip moves below the point when there is no room above", () => {
  const position = placeChartTooltip({
    anchorX: 120,
    anchorY: 18,
    tooltipWidth: 148,
    tooltipHeight: 96,
    containerWidth: 320,
    containerHeight: 360,
  });

  assert.deepEqual(position, { left: 130, top: 28 });
});
