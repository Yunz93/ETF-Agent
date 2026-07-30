import test from "node:test";
import assert from "node:assert/strict";

import { buildChartNarrative, rangeText } from "../js/chart-narrative.js";

function makePoints(closes) {
  return closes.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    close,
  }));
}

test("returns empty for insufficient data", () => {
  assert.deepEqual(buildChartNarrative({ points: [] }), []);
  assert.deepEqual(buildChartNarrative({ points: makePoints([1.2]) }), []);
  assert.deepEqual(
    buildChartNarrative({ points: [{ date: "2026-01-01", close: null }, { date: "2026-01-02", close: 0 }] }),
    [],
  );
});

test("returns at most two lines: trend + ma/boll relationship", () => {
  const lines = buildChartNarrative({
    points: makePoints([1.0, 1.05, 1.1, 1.2]),
    markers: { ma250: 1.0, boll_upper: 1.25, boll_lower: 0.95, boll_mid: 1.1 },
    rangeKey: "1m",
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("走势解读："));
  assert.ok(lines[0].includes("近 1 个月"));
  assert.ok(lines[0].includes("上涨 +20.0%"));
  assert.ok(lines[0].includes("最高点附近"));
  assert.ok(lines[1].startsWith("年线与布林："));
  assert.ok(lines[1].includes("MA250"));
  assert.ok(!lines.some((line) => /RSI|KDJ|股息|利差|成交记录|本期结论/.test(line)));
});

test("explains year line + bollinger relationship", () => {
  const weak = buildChartNarrative({
    points: makePoints([1.0, 1.02, 0.9]),
    markers: { ma250: 1.0, boll_upper: 1.2, boll_lower: 0.95, boll_mid: 1.05 },
  });
  assert.equal(weak.length, 2);
  assert.ok(weak[1].includes("下方"));
  assert.ok(weak[1].includes("下沿") || weak[1].includes("偏弱"));

  const hot = buildChartNarrative({
    points: makePoints([1.0, 1.19]),
    markers: { ma250: 1.0, boll_upper: 1.2, boll_lower: 1.0, boll_mid: 1.1 },
  });
  assert.ok(hot[1].includes("上方"));
  assert.ok(hot[1].includes("偏急") || hot[1].includes("偏热"));
});

test("uses live price over last close when provided", () => {
  const lines = buildChartNarrative({
    points: makePoints([1.0, 1.1]),
    markers: { ma250: 1.0, boll_upper: 1.2, boll_lower: 0.8 },
    price: 0.9,
  });
  assert.ok(lines[1].includes("下方"));
});

test("falls back to bollinger-only when year line missing", () => {
  const lines = buildChartNarrative({
    points: makePoints([1.0, 1.1]),
    markers: { boll_upper: 1.2, boll_lower: 1.0, boll_mid: 1.1 },
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes("年线暂缺"));
  assert.ok(lines[1].includes("布林"));
});

test("labels index levels when priceBasis is index", () => {
  const lines = buildChartNarrative({
    points: makePoints([5000, 5100, 5200]),
    markers: { ma250: 5050, boll_upper: 5300, boll_lower: 4900, boll_mid: 5100 },
    priceBasis: "index",
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("指数 5200") || lines[0].includes("指数 5100"));
  assert.ok(lines[1].includes("指数"));
  assert.ok(!lines[1].includes("MA250（5050）")); // must be labeled 指数
  assert.ok(lines[1].includes("指数 5050"));
});

test("etf priceBasis keeps decimal levels without 指数 label", () => {
  const lines = buildChartNarrative({
    points: makePoints([1.0, 1.05, 1.1, 1.2]),
    markers: { ma250: 1.0, boll_upper: 1.25, boll_lower: 0.95, boll_mid: 1.1 },
    priceBasis: "etf",
  });
  assert.ok(lines[1].includes("1.000"));
  assert.ok(!lines.some((line) => line.includes("指数")));
});

test("rangeText falls back for unknown keys", () => {
  assert.equal(rangeText("1y"), "近 1 年");
  assert.equal(rangeText("nope"), "所选区间");
});
