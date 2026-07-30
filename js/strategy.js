/**
 * 定投策略：典型预设 + 自定义 PE 分位网格。
 *
 * strategy:
 *   fixed      定额定投 — 按目标仓位分配全额预算
 *   valuation  估值定投 — PE 近十年分位网格（默认）
 *   grade      评分定投 — 仅用综合评分 A–E
 *   rebalance  再平衡定投 — 优先补低于目标仓位的品种
 *   custom     自定义 — 用户设定 PE 区间倍率与评分倍率
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

export const DEFAULT_STRATEGY_CONFIG = Object.freeze({
  pe_bands: DEFAULT_PE_BANDS.map((band) => ({ ...band })),
  grade_mult: { ...DEFAULT_GRADE_MULT },
  use_rebalance: true,
});

export const POSITION_TOLERANCE_PP = 5;

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

function clampMult(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(5, Math.round(number * 100) / 100);
}

function clampPct(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(1, Math.round(number)));
}

/** 归一化自定义策略配置（非法字段回退默认）。 */
export function normalizeStrategyConfig(config) {
  const base = DEFAULT_STRATEGY_CONFIG;
  if (!config || typeof config !== "object") {
    return {
      pe_bands: base.pe_bands.map((band) => ({ ...band })),
      grade_mult: { ...base.grade_mult },
      use_rebalance: base.use_rebalance,
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
  };
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

/**
 * 按策略解析单只倍率。
 * pePct: 0–1 近十年分位；spreadPct: 0–1 股债利差历史分位（越高越便宜）。
 * assetClass: dividend / commodity / bond / equity_growth / equity_core。
 * 无估值时多数策略退回评分档位；商品/债券类在估值型策略下定额参与。
 */
export function dcaMultiplier({
  strategy = "valuation",
  strategyConfig,
  pePct,
  grade,
  assetClass,
  spreadPct,
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

  // 商品/债券：无股票估值口径，估值型策略下定额参与
  if ((cls === "commodity" || cls === "bond") && (id === "valuation" || id === "grade" || id === "custom")) {
    const band = cls === "commodity" ? "商品类 · 定额参与" : "债券类 · 定额参与";
    return {
      mult: 1,
      band,
      hint: "无股票估值口径,按目标仓位定额参与,不做估值/评分择时",
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

  if (cls === "equity_growth") {
    return (
      multiplierFromPeBands(pePct, GROWTH_PE_BANDS) ||
      multiplierFromGrade(grade, DEFAULT_GRADE_MULT)
    );
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

export function rebalanceHint({ targetWeight, actualWeight, name } = {}) {
  if (targetWeight == null || actualWeight == null) return null;
  const drift = actualWeight - targetWeight;
  if (Math.abs(drift) < 5) return null;
  const label = name || "该 ETF";
  if (drift > 0) return `${label} 高出目标 ${drift.toFixed(1)} pp，可少买`;
  return `${label} 低于目标 ${Math.abs(drift).toFixed(1)} pp，可优先补仓`;
}

function rebalanceFactor(targetWeight, actualWeight, enabled) {
  if (!enabled || targetWeight == null || actualWeight == null) return 1;
  const drift = actualWeight - targetWeight;
  if (drift > 5) return 0.65;
  if (drift < -5) return 1.25;
  return 1;
}

function positionAllowed(targetWeight, actualWeight) {
  if (targetWeight == null || actualWeight == null) return true;
  return actualWeight <= targetWeight + POSITION_TOLERANCE_PP;
}

function emptyAllocation(totalBudget) {
  return {
    budget: Number.isFinite(totalBudget) && totalBudget > 0 ? totalBudget : 0,
    deployTotal: 0,
    cashKeep: Number.isFinite(totalBudget) && totalBudget > 0 ? Math.round(totalBudget) : 0,
    deployFrac: 0,
    allocations: [],
    skipped: [],
    strategy: "valuation",
  };
}

function finalizeEligible({ totalBudget, eligible, skipped, forceFullDeploy, note, strategy }) {
  if (!eligible.length) {
    return {
      ...emptyAllocation(totalBudget),
      budget: Math.round(totalBudget),
      cashKeep: Math.round(totalBudget),
      skipped,
      strategy,
      note: note || "当期均偏弱，建议留现金。",
    };
  }

  let deployFrac;
  if (forceFullDeploy) {
    deployFrac = 1;
  } else {
    const eligTargetSum = eligible.reduce((sum, row) => sum + row.targetWeight, 0) || eligible.length;
    const intensity =
      eligible.reduce((sum, row) => sum + (row.targetWeight / eligTargetSum) * row.mult * row.reb, 0) || 0;
    deployFrac = Math.max(0, Math.min(1, intensity));
  }
  const deployTotal = Math.round(totalBudget * deployFrac);
  const scoreSum = eligible.reduce((sum, row) => sum + row.score, 0) || 1;
  let allocated = 0;
  const allocations = eligible.map((row, index) => {
    let amount;
    if (index === eligible.length - 1) {
      amount = Math.max(0, deployTotal - allocated);
    } else {
      amount = Math.round((deployTotal * row.score) / scoreSum);
      allocated += amount;
    }
    return {
      symbol: row.symbol,
      name: row.name,
      amount,
      band: row.band,
      mult: row.mult,
      targetWeight: row.targetWeight,
      actualWeight: row.actualWeight,
      sharePct: deployTotal > 0 ? (amount / deployTotal) * 100 : 0,
      reason: row.hint,
    };
  });

  return {
    budget: Math.round(totalBudget),
    deployTotal,
    cashKeep: Math.round(totalBudget - deployTotal),
    deployFrac,
    allocations,
    skipped,
    strategy,
    note: deployFrac < 0.999 ? "未部署部分留现金" : note || "",
  };
}

/**
 * 全池定投分配。
 * - budget：整池每期总预算（不是单只 ETF）
 * - strategy / strategyConfig：策略类型与自定义配置
 * - strategyOverrides：按品种覆盖策略（{ symbol: strategyId }）
 * - 某只不建议投（mult=0）时，其份额可让给其他可投品种
 * - 不强制投完（估值/评分/自定义）：整体偏贵时只部署预算的一部分
 * - 定额 / 再平衡：默认打满预算
 *
 * holdings: [{ symbol, name, targetWeight, actualWeight, pePct, grade, assetClass, spreadPct, analyzed }]
 */
export function allocatePoolBudget({
  budget,
  holdings = [],
  strategy = "valuation",
  strategyConfig,
  preferTargetGap = false,
  strategyOverrides,
} = {}) {
  const totalBudget = Number(budget);
  const strategyId = normalizeStrategyId(strategy);
  const config = normalizeStrategyConfig(strategyConfig);
  const overrides =
    strategyOverrides && typeof strategyOverrides === "object" ? strategyOverrides : {};
  const empty = { ...emptyAllocation(totalBudget), strategy: strategyId };
  if (!Number.isFinite(totalBudget) || totalBudget <= 0 || !holdings.length) return empty;

  function resolveRowStrategy(item) {
    const raw = overrides[item.symbol];
    if (raw == null || raw === "") return { id: strategyId, overridden: false };
    const id = String(raw || "").trim().toLowerCase();
    if (!STRATEGY_IDS.includes(id)) return { id: strategyId, overridden: false };
    return { id, overridden: true };
  }

  function rowMultiplier(item, fallbackStrategy) {
    const { id, overridden } = resolveRowStrategy(item);
    const grid = dcaMultiplier({
      strategy: overridden ? id : fallbackStrategy,
      strategyConfig: config,
      pePct: item.pePct,
      grade: item.grade,
      assetClass: item.assetClass,
      spreadPct: item.spreadPct,
    });
    if (overridden) {
      return { ...grid, band: `指定 · ${grid.band}` };
    }
    return grid;
  }

  const n = holdings.length;
  const hasTargets = holdings.some((item) => Number(item.targetWeight) > 0);
  const equal = 100 / n;
  const useReb =
    preferTargetGap || strategyId === "fixed" || strategyId === "rebalance"
      ? false
      : strategyId === "custom"
        ? config.use_rebalance
        : true;

  if (strategyId === "rebalance" || preferTargetGap) {
    const rows = holdings.map((item) => {
      const target = hasTargets
        ? Number(item.targetWeight) > 0
          ? Number(item.targetWeight)
          : 0
        : equal;
      const actual =
        item.actualWeight != null && Number.isFinite(Number(item.actualWeight))
          ? Number(item.actualWeight)
          : null;
      const deficit = actual == null ? target : Math.max(0, target - actual);
      const grid =
        preferTargetGap && strategyId !== "rebalance"
          ? rowMultiplier(item, strategyId)
          : { mult: 1, band: deficit > 0 ? "待补仓" : "已达标", hint: "" };
      const allowed = positionAllowed(target, actual);
      const score =
        !allowed || grid.mult <= 0 ? 0 : (deficit > 0 ? deficit : 0) * grid.mult;
      return {
        symbol: item.symbol,
        name: item.name || item.symbol,
        targetWeight: target,
        actualWeight: actual,
        analyzed: item.analyzed !== false,
        mult: grid.mult,
        band:
          !allowed
            ? "超配暂停"
            : grid.mult <= 0
              ? grid.band || "当期不建议新增"
              : deficit > 0
                ? preferTargetGap
                  ? `${grid.band || "待补仓"} · 建仓补缺`
                  : "待补仓"
                : actual == null
                  ? "无持仓权重"
                  : "已达标",
        hint:
          !allowed
            ? `当前仓位高于目标 ${POSITION_TOLERANCE_PP} pp 上限`
            : grid.mult <= 0
              ? grid.hint || "当期不建议新增"
              : deficit > 0
                ? `低于目标 ${(target - (actual ?? 0)).toFixed(1)} pp`
                : actual == null
                  ? "尚无持仓市值，按目标仓位参与"
                  : "已达或高于目标，本期不补",
        reb: 1,
        score,
        deficit,
        positionBlocked: !allowed,
      };
    });

    let eligible = rows.filter((row) => row.score > 0);
    // 全部达标或无实际权重时：按目标仓位打满（等权兜底）
    if (!eligible.length) {
      eligible = rows
        .filter((row) => row.targetWeight > 0 && row.mult > 0 && !row.positionBlocked)
        .map((row) => ({
          ...row,
          score: row.targetWeight * row.mult,
          band: preferTargetGap ? "按目标建仓" : "按目标",
          hint: "无明显低配，按目标仓位分配",
        }));
    }
    const skipped = rows
      .filter((row) => !eligible.some((item) => item.symbol === row.symbol))
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        band: row.band,
        reason: row.hint,
      }));
    return finalizeEligible({
      totalBudget,
      eligible,
      skipped,
      forceFullDeploy: true,
      strategy: strategyId,
    });
  }

  const rows = holdings.map((item) => {
    const target = hasTargets
      ? Number(item.targetWeight) > 0
        ? Number(item.targetWeight)
        : 0
      : equal;
    const actual =
      item.actualWeight != null && Number.isFinite(Number(item.actualWeight))
        ? Number(item.actualWeight)
        : null;
    const grid = rowMultiplier(item, strategyId);
    const allowed = positionAllowed(target, actual);
    const reb = rebalanceFactor(target, actual, useReb);
    const score = allowed ? (target / 100) * grid.mult * reb : 0;
    return {
      symbol: item.symbol,
      name: item.name || item.symbol,
      targetWeight: target,
      actualWeight: actual,
      analyzed: item.analyzed !== false,
      ...grid,
      positionBlocked: !allowed,
      reb,
      score,
    };
  });

  const eligible = rows.filter((row) => row.score > 0 && row.mult > 0);
  const skipped = rows
    .filter((row) => row.mult <= 0 || row.score <= 0)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      band: row.band,
      reason: row.positionBlocked
        ? `当前仓位高于目标 ${POSITION_TOLERANCE_PP} pp 上限`
        : row.mult <= 0
          ? "当期不建议新增"
          : "吸引力不足",
    }));

  return finalizeEligible({
    totalBudget,
    eligible,
    skipped,
    forceFullDeploy: strategyId === "fixed",
    strategy: strategyId,
  });
}

export function allocationForSymbol(result, symbol) {
  if (!result) return null;
  return (result.allocations || []).find((item) => item.symbol === symbol) || null;
}
