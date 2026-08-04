/**
 * 定投策略倍率：典型预设 + PE / 评分 / 情绪 / 商品 / 黄金宏观。
 */
export const STRATEGY_IDS = Object.freeze([
  "fixed",
  "valuation",
  "grade",
  "rebalance",
  "custom",
]);

export const STRATEGY_PRESETS = Object.freeze({
  fixed: {
    id: "fixed",
    label: "定额定投",
    summary: "按目标仓位分配全额预算，不考虑估值",
  },
  valuation: {
    id: "valuation",
    label: "估值定投",
    summary: "按 PE 近十年分位调节倍率，偏贵留现金",
  },
  grade: {
    id: "grade",
    label: "评分定投",
    summary: "按综合评分 A–E 调节倍率",
  },
  rebalance: {
    id: "rebalance",
    label: "再平衡定投",
    summary: "优先补仓低于目标仓位的品种",
  },
  custom: {
    id: "custom",
    label: "自定义策略",
    summary: "自行设定 PE 分位区间与倍率",
  },
});

export const DEFAULT_PE_BANDS = Object.freeze([
  { max_pct: 20, mult: 1.5, label: "低估区" },
  { max_pct: 40, mult: 1.2, label: "偏低区" },
  { max_pct: 60, mult: 1.0, label: "正常区" },
  { max_pct: 80, mult: 0.5, label: "偏高区" },
  { max_pct: 100, mult: 0, label: "高估区" },
]);

/** 长牛高估值指数：高分位降倍率但不归零，保持定投纪律。 */
export const GROWTH_PE_BANDS = Object.freeze([
  { max_pct: 30, mult: 1.3, label: "低估区" },
  { max_pct: 60, mult: 1.1, label: "偏低区" },
  { max_pct: 85, mult: 1.0, label: "正常区" },
  { max_pct: 95, mult: 0.5, label: "偏高区" },
  { max_pct: 100, mult: 0.25, label: "高估区" },
]);

export const DEFAULT_GRADE_MULT = Object.freeze({
  A: 1.5,
  B: 1.2,
  C: 1.0,
  D: 0.5,
  E: 0,
});

/**
 * 黄金/商品定投倍率：用技术面档位（超卖加仓、偏热减仓），
 * E 档保留少量参与以维持对冲仓位纪律，不因「无 PE」而放弃择时。
 */
export const COMMODITY_GRADE_MULT = Object.freeze({
  A: 1.5,
  B: 1.2,
  C: 1.0,
  D: 0.5,
  E: 0.25,
});

export const DEFAULT_SENTIMENT_BANDS = Object.freeze([
  { max_score: 20, mult: 1.3, label: "极端恐慌" },
  { max_score: 40, mult: 1.15, label: "偏恐慌" },
  { max_score: 60, mult: 1.0, label: "中性" },
  { max_score: 80, mult: 0.75, label: "偏热" },
  { max_score: 100, mult: 0.4, label: "极端狂热" },
]);

export const DEFAULT_SENTIMENT_CONFIG = Object.freeze({
  enabled: true,
  mode: "overlay",
  extremes_only: true,
  extreme_low: 25,
  extreme_high: 75,
  apply_to: Object.freeze(["valuation", "grade", "custom"]),
  bands: DEFAULT_SENTIMENT_BANDS.map((band) => ({ ...band })),
  market_by_asset_class: Object.freeze({
    dividend: "A",
    equity_core: "A",
    equity_growth: "auto",
    commodity: "off",
    bond: "off",
  }),
});

export const DEFAULT_STRATEGY_CONFIG = Object.freeze({
  pe_bands: DEFAULT_PE_BANDS.map((band) => ({ ...band })),
  grade_mult: { ...DEFAULT_GRADE_MULT },
  use_rebalance: true,
  sentiment: {
    ...DEFAULT_SENTIMENT_CONFIG,
    apply_to: [...DEFAULT_SENTIMENT_CONFIG.apply_to],
    bands: DEFAULT_SENTIMENT_BANDS.map((band) => ({ ...band })),
    market_by_asset_class: { ...DEFAULT_SENTIMENT_CONFIG.market_by_asset_class },
  },
});

/** 池内目标权重的软偏离提示阈值（百分点）；不再作为硬顶停买。 */
export const POSITION_TOLERANCE_PP = 5;

const SENTIMENT_ZONE_HINTS = Object.freeze({
  panic: "极端恐慌，定投可加码",
  fear: "偏恐慌，定投可小幅加码",
  neutral: "情绪中性，不调节倍率",
  greed: "偏热，定投宜减码",
  euphoria: "极端狂热，定投明显减码",
  unknown: "情绪数据不可用，按中性",
});

/** 按指数代码 / 名称推断情绪市场分区。 */
export function inferSentimentMarket({ indexCode = "", name = "", symbol = "" } = {}) {
  const code = String(indexCode || "").trim().toUpperCase();
  const text = `${name} ${symbol}`.toLowerCase();
  if (["NDX", "SPX", "IXIC", "DJI"].includes(code) || /纳指|纳斯达克|标普|标普500|sp500|s&p/.test(text)) {
    return "US";
  }
  if (["HSI", "HSTECH"].includes(code) || /恒生|港股|hang\s*seng/.test(text)) {
    return "HK";
  }
  return "A";
}

const GRADE_HINTS = Object.freeze({
  A: "综合评分偏乐观",
  B: "综合评分较好",
  C: "综合评分中性",
  D: "综合评分偏弱",
  E: "综合评分过热",
});

export function normalizeStrategyId(value) {
  const id = String(value || "").trim().toLowerCase();
  return STRATEGY_IDS.includes(id) ? id : "valuation";
}

export function strategyLabel(strategy) {
  const id = normalizeStrategyId(strategy);
  return STRATEGY_PRESETS[id]?.label || STRATEGY_PRESETS.valuation.label;
}

export function strategySummary(strategy) {
  const id = normalizeStrategyId(strategy);
  return STRATEGY_PRESETS[id]?.summary || STRATEGY_PRESETS.valuation.summary;
}

function clampMult(value, fallback = 1, max = 5) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(max, Math.round(number * 100) / 100);
}

function clampPct(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(1, Math.round(number)));
}

function clampScoreBoundary(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

export function normalizeSentimentConfig(config) {
  const base = DEFAULT_SENTIMENT_CONFIG;
  const raw = config && typeof config === "object" ? config : {};
  const rawBands = Array.isArray(raw.bands) ? raw.bands : null;
  let bands;
  if (rawBands && rawBands.length) {
    bands = rawBands.slice(0, 8).map((band, index) => {
      const fallback = base.bands[Math.min(index, base.bands.length - 1)];
      return {
        max_score: clampScoreBoundary(band?.max_score ?? band?.maxScore, fallback.max_score),
        mult: clampMult(band?.mult, fallback.mult, 2),
        label: String(band?.label || fallback.label || "").trim() || fallback.label,
      };
    });
    bands.sort((a, b) => a.max_score - b.max_score);
    bands[bands.length - 1].max_score = 100;
  } else {
    bands = base.bands.map((band) => ({ ...band }));
  }

  const rawApply = Array.isArray(raw.apply_to) ? raw.apply_to : base.apply_to;
  const apply_to = rawApply
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((id) => STRATEGY_IDS.includes(id));
  const marketRaw =
    raw.market_by_asset_class && typeof raw.market_by_asset_class === "object"
      ? raw.market_by_asset_class
      : {};
  const market_by_asset_class = { ...base.market_by_asset_class };
  for (const key of Object.keys(market_by_asset_class)) {
    const value = String(marketRaw[key] ?? market_by_asset_class[key])
      .trim()
      .toLowerCase();
    if (value === "off" || value === "auto" || value === "a" || value === "hk" || value === "us") {
      market_by_asset_class[key] = value === "off" || value === "auto" ? value : value.toUpperCase();
    }
  }

  let extreme_low = clampScoreBoundary(raw.extreme_low ?? raw.extremeLow, base.extreme_low);
  let extreme_high = clampScoreBoundary(raw.extreme_high ?? raw.extremeHigh, base.extreme_high);
  if (extreme_low > extreme_high) {
    const swap = extreme_low;
    extreme_low = extreme_high;
    extreme_high = swap;
  }

  return {
    enabled: raw.enabled !== false && raw.enabled !== 0,
    mode: String(raw.mode || base.mode).trim().toLowerCase() === "off" ? "off" : "overlay",
    extremes_only: raw.extremes_only !== false && raw.extremes_only !== 0,
    extreme_low,
    extreme_high,
    apply_to: apply_to.length ? apply_to : [...base.apply_to],
    bands,
    market_by_asset_class,
  };
}

/** 归一化自定义策略配置（非法字段回退默认）。 */
export function normalizeStrategyConfig(config) {
  const base = DEFAULT_STRATEGY_CONFIG;
  if (!config || typeof config !== "object") {
    return {
      pe_bands: base.pe_bands.map((band) => ({ ...band })),
      grade_mult: { ...base.grade_mult },
      use_rebalance: base.use_rebalance,
      sentiment: normalizeSentimentConfig(base.sentiment),
    };
  }

  const rawBands = Array.isArray(config.pe_bands) ? config.pe_bands : null;
  let pe_bands;
  if (rawBands && rawBands.length) {
    pe_bands = rawBands.slice(0, 8).map((band, index) => {
      const fallback = base.pe_bands[Math.min(index, base.pe_bands.length - 1)];
      const max_pct = clampPct(band?.max_pct ?? band?.maxPct, fallback.max_pct);
      const mult = clampMult(band?.mult, fallback.mult);
      const label = String(band?.label || fallback.label || "").trim() || fallback.label;
      return { max_pct, mult, label };
    });
    pe_bands.sort((a, b) => a.max_pct - b.max_pct);
    pe_bands[pe_bands.length - 1].max_pct = 100;
  } else {
    pe_bands = base.pe_bands.map((band) => ({ ...band }));
  }

  const rawGrade = config.grade_mult && typeof config.grade_mult === "object" ? config.grade_mult : {};
  const grade_mult = {};
  for (const key of ["A", "B", "C", "D", "E"]) {
    grade_mult[key] = clampMult(rawGrade[key], base.grade_mult[key]);
  }

  return {
    pe_bands,
    grade_mult,
    use_rebalance: config.use_rebalance !== false && config.use_rebalance !== 0,
    sentiment: normalizeSentimentConfig(config.sentiment ?? base.sentiment),
  };
}

/**
 * 将情绪快照映射为叠加倍率。
 * snapshot.score: 0–100，越高越狂热；缺失或降级时返回 1×。
 */
export function sentimentMultiplier(snapshot, sentimentConfig) {
  const config = normalizeSentimentConfig(sentimentConfig);
  if (!snapshot || snapshot.degraded || snapshot.score == null || !Number.isFinite(Number(snapshot.score))) {
    return {
      mult: 1,
      zone: "unknown",
      band: "数据不足",
      hint: SENTIMENT_ZONE_HINTS.unknown,
      score: null,
    };
  }
  const score = Number(snapshot.score);
  if (config.extremes_only && score > config.extreme_low && score < config.extreme_high) {
    return {
      mult: 1,
      zone: snapshot.zone || "neutral",
      band: "中性死区",
      hint: "非极端情绪，不调节倍率",
      score,
    };
  }
  for (const band of config.bands) {
    if (score <= band.max_score) {
      return {
        mult: band.mult,
        zone: snapshot.zone || "neutral",
        band: band.label,
        hint: SENTIMENT_ZONE_HINTS[snapshot.zone] || band.label,
        score,
      };
    }
  }
  const last = config.bands[config.bands.length - 1];
  return {
    mult: last?.mult ?? 1,
    zone: snapshot.zone || "euphoria",
    band: last?.label || "极端狂热",
    hint: SENTIMENT_ZONE_HINTS.euphoria,
    score,
  };
}

/** Resolve which market sentiment bucket applies to a holding. */
export function sentimentMarketForHolding(item = {}, sentimentConfig, registry = {}) {
  const config = normalizeSentimentConfig(sentimentConfig);
  const cls = String(item.assetClass || "").trim().toLowerCase() || "equity_core";
  const mapped = config.market_by_asset_class[cls] ?? "A";
  if (mapped === "off") return null;
  if (mapped === "A" || mapped === "HK" || mapped === "US") return mapped;
  if (item.sentimentMarket === "A" || item.sentimentMarket === "HK" || item.sentimentMarket === "US") {
    return item.sentimentMarket;
  }
  const reg = registry[item.symbol] || {};
  return inferSentimentMarket({
    indexCode: reg.index_code || item.indexCode || "",
    name: `${item.name || ""} ${reg.index_name || ""} ${reg.etf_name || ""}`,
    symbol: item.symbol || "",
  });
}

function multiplierFromPeBands(pePct, bands) {
  const p = Number(pePct);
  if (!Number.isFinite(p)) return null;
  const pct = p <= 1 ? p * 100 : p;
  for (const band of bands) {
    if (pct <= band.max_pct) {
      const hint =
        band.mult <= 0
          ? `PE 分位>${bands[bands.indexOf(band) - 1]?.max_pct ?? 80}%，暂停新增`
          : `PE 分位≤${band.max_pct}%，倍率 ${band.mult}×`;
      return { mult: band.mult, band: band.label || "自定义区间", hint };
    }
  }
  const last = bands[bands.length - 1];
  return {
    mult: last?.mult ?? 0,
    band: last?.label || "高估区",
    hint: "超出网格上沿，按末档处理",
  };
}

function multiplierFromGrade(grade, gradeMult) {
  const key = String(grade || "").toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(gradeMult, key)) {
    return { mult: 1.0, band: "数据不足", hint: "估值与评分不足，先按中性参与" };
  }
  return {
    mult: gradeMult[key],
    band: `评分 ${key}`,
    hint: GRADE_HINTS[key] || "按评分参与",
  };
}

/** 宏观快照 → 叠加倍率；缺失/降级时中性 1×。 */
export function goldMacroMultiplier(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.degraded) {
    return { mult: 1, zone: "unknown", band: "宏观中性", hint: "" };
  }
  const mult = Number(snapshot.mult);
  if (!Number.isFinite(mult) || mult <= 0) {
    return { mult: 1, zone: "unknown", band: "宏观中性", hint: "" };
  }
  return {
    mult: Math.round(mult * 1000) / 1000,
    zone: snapshot.zone || "neutral",
    band: snapshot.band || "宏观",
    hint: snapshot.hint || "",
    score: snapshot.score ?? null,
  };
}

function clampCommodityMult(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.max(0.2, Math.min(1.8, n)) * 1000) / 1000;
}

/**
 * 黄金/商品：技术面档位/年线乖离 × 宏观（美债+美元）软叠加。
 * 逻辑是「对冲仓位逢低多买、偏热少买」，再按利率/美元环境微调。
 */
export function commodityDcaMultiplier({ grade, biasPct, goldMacro, strategyConfig } = {}) {
  const config = normalizeStrategyConfig(strategyConfig);
  const gradeTable = { ...COMMODITY_GRADE_MULT, ...(config.grade_mult || {}) };
  // 商品 E 档保底 0.25，避免自定义评分表把对冲仓位打到 0
  if (!(Number(gradeTable.E) > 0)) gradeTable.E = COMMODITY_GRADE_MULT.E;

  let tech;
  const gradeKey = String(grade || "").toUpperCase();
  if (Object.prototype.hasOwnProperty.call(COMMODITY_GRADE_MULT, gradeKey)) {
    const fromGrade = multiplierFromGrade(gradeKey, gradeTable);
    tech = {
      ...fromGrade,
      band: `商品技术面 · ${gradeKey}`,
      hint: "黄金/商品按技术面强弱调节：超卖加仓、偏热减仓，不用股票估值",
    };
  } else {
    const bias = Number(biasPct);
    if (Number.isFinite(bias)) {
      if (bias <= -12) {
        tech = { mult: 1.5, band: "商品 · 深度回调", hint: "相对年线显著折价，加仓对冲仓位" };
      } else if (bias <= -5) {
        tech = { mult: 1.2, band: "商品 · 回调区", hint: "相对年线折价，适度加仓" };
      } else if (bias <= 8) {
        tech = { mult: 1, band: "商品 · 中性", hint: "年线附近震荡，按目标仓位参与" };
      } else if (bias <= 18) {
        tech = { mult: 0.5, band: "商品 · 偏强", hint: "相对年线偏贵，降低节奏" };
      } else {
        tech = { mult: 0.25, band: "商品 · 过热", hint: "相对年线过热，仅保留少量对冲参与" };
      }
    } else {
      tech = {
        mult: 1,
        band: "商品类 · 中性兜底",
        hint: "技术面暂缺，按目标仓位中性参与（非放弃投资逻辑）",
      };
    }
  }

  const macro = goldMacroMultiplier(goldMacro);
  const mult = clampCommodityMult(tech.mult * macro.mult);
  const band =
    macro.mult !== 1 && tech.band ? `${tech.band} · ${macro.band}` : tech.band;
  const hint =
    macro.mult !== 1
      ? `${tech.hint}；${macro.hint || macro.band} ×${macro.mult}`
      : tech.hint;
  return {
    ...tech,
    mult,
    band,
    hint,
    techMult: tech.mult,
    macroMult: macro.mult,
    goldMacro: macro,
  };
}

/**
 * 按策略解析单只倍率。
 * pePct: 0–1 近十年分位；spreadPct: 0–1 股债利差历史分位（越高越便宜）。
 * biasPct: 年线乖离（%），商品类在无档位时用作技术面代理。
 * assetClass: dividend / commodity / bond / equity_growth / equity_core。
 * 无估值时多数策略退回评分档位；商品类走技术面逻辑，债券类定额参与。
 */
export function dcaMultiplier({
  strategy = "valuation",
  strategyConfig,
  pePct,
  grade,
  assetClass,
  spreadPct,
  biasPct,
  goldMacro,
} = {}) {
  const id = normalizeStrategyId(strategy);
  const config = normalizeStrategyConfig(strategyConfig);
  const cls = String(assetClass || "").trim().toLowerCase();

  if (id === "fixed") {
    return { mult: 1, band: "定额", hint: "按目标仓位定额分配" };
  }
  if (id === "rebalance") {
    return { mult: 1, band: "再平衡", hint: "按相对目标仓位缺口分配" };
  }

  // 黄金/商品：估值策略下改走技术面择时 + 宏观软叠加
  if (cls === "commodity" && (id === "valuation" || id === "grade" || id === "custom")) {
    return commodityDcaMultiplier({ grade, biasPct, goldMacro, strategyConfig: config });
  }

  // 债券：利率/久期框架尚未接入，先定额参与目标仓位
  if (cls === "bond" && (id === "valuation" || id === "grade" || id === "custom")) {
    return {
      mult: 1,
      band: "债券类 · 定额参与",
      hint: "无股票估值口径，按目标仓位定额参与；利率择时尚未接入",
    };
  }

  if (id === "grade") {
    return multiplierFromGrade(grade, config.grade_mult);
  }
  if (id === "custom") {
    return (
      multiplierFromPeBands(pePct, config.pe_bands) ||
      multiplierFromGrade(grade, config.grade_mult)
    );
  }

  // valuation（默认）：按资产类别差异化
  if (cls === "dividend") {
    const mixed = dividendMixedPct(pePct, spreadPct);
    if (mixed != null) {
      const result = multiplierFromPeBands(mixed, DEFAULT_PE_BANDS);
      if (result) {
        return {
          ...result,
          hint: `${result.hint}（PE 分位 + 股债利差分位混合）`,
        };
      }
    }
    return multiplierFromGrade(grade, DEFAULT_GRADE_MULT);
  }

  // 成长类：定额 + 极端高估保护（不再使用 GROWTH_PE_BANDS 网格）
  if (cls === "equity_growth") {
    const p = Number(pePct);
    if (Number.isFinite(p)) {
      const pct01 = p <= 1 ? p : p / 100;
      if (pct01 >= 0.95) {
        const pctLabel = Math.round(pct01 * 100);
        return {
          mult: 0.5,
          band: "极端高估保护",
          hint: `PE 近十年分位 ${pctLabel}%，极端高估保护降至 0.5×`,
        };
      }
    }
    return {
      mult: 1,
      band: "成长定额",
      hint: "成长类不做估值择时，按目标仓位定额参与",
    };
  }

  return (
    multiplierFromPeBands(pePct, DEFAULT_PE_BANDS) ||
    multiplierFromGrade(grade, DEFAULT_GRADE_MULT)
  );
}

/** 红利类：PE 分位与「1−利差分位」各 50% 混合；仅一方可用时用可用侧。 */
function dividendMixedPct(pePct, spreadPct) {
  const pe = Number(pePct);
  const spread = Number(spreadPct);
  const hasPe = Number.isFinite(pe);
  const hasSpread = Number.isFinite(spread);
  const norm = (value) => (value <= 1 ? value : value / 100);
  if (hasPe && hasSpread) return norm(pe) * 0.5 + (1 - norm(spread)) * 0.5;
  if (hasPe) return norm(pe);
  if (hasSpread) return 1 - norm(spread);
  return null;
}

/** @deprecated 兼容旧调用；等同 valuation 策略 */
export function valuationDcaMultiplier({ pePct, grade, assetClass, spreadPct } = {}) {
  return dcaMultiplier({ strategy: "valuation", pePct, grade, assetClass, spreadPct });
}

