/**
 * 走势图白话解读：只回答两件事——
 * 1) 当前走势本身说了什么；
 * 2) 年线与布林线的关系说明了什么趋势。
 * 纯函数、不依赖 DOM。
 * 数字与图表同口径（默认 ETF 价）；priceBasis=index 时标注「指数」。
 */

const RANGE_TEXT = {
  "1w": "近 1 周",
  "1m": "近 1 个月",
  "3m": "近 3 个月",
  "6m": "近 6 个月",
  "1y": "近 1 年",
  "3y": "近 3 年",
  "5y": "近 5 年",
  max: "全部历史",
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 1) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function levelText(value, priceBasis = "etf") {
  const n = num(value);
  if (n == null) return "—";
  if (priceBasis === "index" || Math.abs(n) >= 100) return `指数 ${n.toFixed(0)}`;
  if (Math.abs(n) >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

export function rangeText(rangeKey) {
  return RANGE_TEXT[rangeKey] || "所选区间";
}

function bollBucket(current, upper, lower) {
  if (upper == null || lower == null || upper <= lower) return null;
  const ratio = (current - lower) / (upper - lower);
  if (ratio >= 1) return "above_upper";
  if (ratio >= 0.75) return "near_upper";
  if (ratio >= 0.25) return "middle";
  if (ratio >= 0) return "near_lower";
  return "below_lower";
}

function maBollTrendText({ bias, bollPos, ma250, upper, lower, priceBasis }) {
  const biasAbs = Math.abs(bias).toFixed(1);
  const side = bias >= 0 ? "上方" : "下方";
  const maPart = `现价在年线 MA250（${levelText(ma250, priceBasis)}）${side} ${biasAbs}%`;

  if (bollPos == null) {
    if (bias >= 8) return `${maPart}：中期趋势偏强，但偏离已大，回撤风险上升。`;
    if (bias >= 0) return `${maPart}：中期趋势偏稳。`;
    if (bias >= -8) return `${maPart}：中期走势偏弱，价格相对过去一年平均成本更便宜。`;
    return `${maPart}：中期明显偏弱，便宜的同时也说明跌幅较大。`;
  }

  const bandPart = `布林带 ${levelText(upper, priceBasis)} / ${levelText(lower, priceBasis)}`;
  const above = bias >= 0;

  if (above && (bollPos === "above_upper" || bollPos === "near_upper")) {
    return `${maPart}，且靠近/冲出${bandPart} 上沿：中期仍偏强，但短期涨得偏急。`;
  }
  if (above && bollPos === "middle") {
    return `${maPart}，且落在${bandPart} 中部：中期趋势偏稳，短期没有明显过热或超跌。`;
  }
  if (above && (bollPos === "near_lower" || bollPos === "below_lower")) {
    return `${maPart}，但已靠近/跌破${bandPart} 下沿：中期仍站上年线，短期属于上涨趋势里的回踩。`;
  }
  if (!above && (bollPos === "near_lower" || bollPos === "below_lower")) {
    return `${maPart}，且靠近/跌破${bandPart} 下沿：中期偏弱，短期已落到波动区间下沿。`;
  }
  if (!above && bollPos === "middle") {
    return `${maPart}，且落在${bandPart} 中部：中期仍偏弱，短期只是在弱势区间里震荡。`;
  }
  return `${maPart}，但已靠近/冲出${bandPart} 上沿：中期仍在年线下方，短期反弹偏急，趋势尚未确认转强。`;
}

/**
 * @param {object} opts
 * @param {Array<{date: string, close: number}>} opts.points 可见区间内的收盘点
 * @param {{ma250?: number, boll_mid?: number, boll_upper?: number, boll_lower?: number}} [opts.markers]
 * @param {number} [opts.price] 最新价（有实时行情用实时价，否则用最后收盘）
 * @param {string} [opts.rangeKey] 当前区间键（1w/1m/.../max）
 * @param {"etf"|"index"} [opts.priceBasis] 价格口径；index 时数字前标注「指数」
 * @returns {string[]} 白话句子列表（最多 2 条）；数据不足时返回空数组
 */
export function buildChartNarrative({
  points = [],
  markers = {},
  price = null,
  rangeKey = "1y",
  priceBasis = "etf",
} = {}) {
  const closes = (points || [])
    .map((point) => num(point?.close))
    .filter((value) => value != null && value > 0);
  if (closes.length < 2) return [];

  const lines = [];
  const first = closes[0];
  const last = closes[closes.length - 1];
  const current = num(price) != null && num(price) > 0 ? num(price) : last;
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const label = rangeText(rangeKey);
  const basis = priceBasis === "index" ? "index" : "etf";

  // 1. 走势本身
  const change = (last / first - 1) * 100;
  const fromHigh = (current / high - 1) * 100;
  const trendWord = change > 1 ? "上涨" : change < -1 ? "下跌" : "基本走平";
  let positionText;
  if (fromHigh >= -1) {
    positionText = "目前价格就在这段时间的最高点附近";
  } else if ((current / low - 1) * 100 <= 1) {
    positionText = "目前价格就在这段时间的最低点附近";
  } else {
    positionText = `目前价格比这段时间的最高点低 ${Math.abs(fromHigh).toFixed(1)}%`;
  }
  lines.push(
    `走势解读：${label}累计${trendWord} ${pct(change)}（最高 ${levelText(high, basis)}、最低 ${levelText(low, basis)}），${positionText}。`,
  );

  // 2. 年线与布林的关系 → 趋势含义
  const ma250 = num(markers?.ma250);
  const upper = num(markers?.boll_upper);
  const lower = num(markers?.boll_lower);
  if (ma250 != null && ma250 > 0) {
    const bias = (current / ma250 - 1) * 100;
    const bollPos = bollBucket(current, upper, lower);
    lines.push(
      `年线与布林：${maBollTrendText({ bias, bollPos, ma250, upper, lower, priceBasis: basis })}`,
    );
  } else if (upper != null && lower != null && upper > lower) {
    const bollPos = bollBucket(current, upper, lower);
    const band = `布林带 ${levelText(upper, basis)} / ${levelText(lower, basis)}`;
    const map = {
      above_upper: `现价已冲出${band}上沿，短期涨得偏急。`,
      near_upper: `现价靠近${band}上沿，短期偏热。`,
      middle: `现价落在${band}中部，短期没有明显过热或超跌。`,
      near_lower: `现价靠近${band}下沿，短期跌幅较大。`,
      below_lower: `现价已跌破${band}下沿，短期属于超跌。`,
    };
    lines.push(`年线与布林：年线暂缺，仅看布林——${map[bollPos]}`);
  }

  return lines;
}
