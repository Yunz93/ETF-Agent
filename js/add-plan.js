/**
 * 分档加仓预案：按回调跌幅拆分本期额度，纯函数可测。
 * 只拆执行节奏，不改变定投金额分配。
 */

import { orderPreview } from "./decision-support.js";

const LEVEL_NAMES = Object.freeze(["第一档", "第二档", "第三档", "第四档"]);

/** 按资产类别的默认档位；commodity / bond 为 null 表示不分档。 */
export const DEFAULT_ADD_PLAN_LEVELS_BY_CLASS = Object.freeze({
  equity_core: Object.freeze([
    Object.freeze({ drawdown_pct: 3, ratio: 0.4 }),
    Object.freeze({ drawdown_pct: 5, ratio: 0.6 }),
  ]),
  dividend: Object.freeze([
    Object.freeze({ drawdown_pct: 3, ratio: 0.4 }),
    Object.freeze({ drawdown_pct: 5, ratio: 0.6 }),
  ]),
  equity_growth: Object.freeze([
    Object.freeze({ drawdown_pct: 5, ratio: 0.4 }),
    Object.freeze({ drawdown_pct: 10, ratio: 0.6 }),
  ]),
  commodity: null,
  bond: null,
});

const FALLBACK_LEVELS = DEFAULT_ADD_PLAN_LEVELS_BY_CLASS.equity_core;

/**
 * 预设方案：用户只选策略，档位建议值由预设给出。
 * - auto：按资产类别默认档距 + 估值联动缩放（商品/债券不分档）
 * - steady / deep：固定档距，对所有资产类别生效（显式选择即视为知情）
 * - custom：沿用已保存的自定义档位（兼容旧配置，不再提供编辑入口）
 */
export const ADD_PLAN_PRESETS = Object.freeze({
  auto: Object.freeze({
    id: "auto",
    label: "智能推荐",
    summary: "按资产类别默认档距（宽基/红利 −3%/−5%，成长 −5%/−10%），低估收窄、偏高放宽；商品/债券不分档",
  }),
  steady: Object.freeze({
    id: "steady",
    label: "稳健两档",
    summary: "固定 −3% / −5%，预留 40% / 60%，不随估值缩放",
    levels: Object.freeze([
      Object.freeze({ drawdown_pct: 3, ratio: 0.4 }),
      Object.freeze({ drawdown_pct: 5, ratio: 0.6 }),
    ]),
  }),
  deep: Object.freeze({
    id: "deep",
    label: "深回调两档",
    summary: "固定 −5% / −10%，预留 40% / 60%，只接较深回调",
    levels: Object.freeze([
      Object.freeze({ drawdown_pct: 5, ratio: 0.4 }),
      Object.freeze({ drawdown_pct: 10, ratio: 0.6 }),
    ]),
  }),
  custom: Object.freeze({
    id: "custom",
    label: "自定义档位",
    summary: "沿用已保存的自定义档位",
  }),
});

/**
 * 规范化分档加仓配置。
 * preset 缺失时：带合法 levels 视为 custom（兼容旧配置），否则 auto。
 * preset 非 custom 时 levels 恒为 null（档位由预设给出）。
 * @param {unknown} raw
 * @returns {{ enabled: boolean, anchor: "price"|"cost", preset: string, levels: Array<{drawdown_pct:number,ratio:number}>|null }}
 */
export function normalizeAddPlanConfig(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const enabled = source.enabled === false || source.enabled === 0 || source.enabled === "0"
    ? false
    : true;
  const anchorRaw = String(source.anchor || "price").trim().toLowerCase();
  const anchor = anchorRaw === "cost" ? "cost" : "price";
  let levels = normalizeLevels(source.levels);
  const presetRaw = String(source.preset || "").trim().toLowerCase();
  let preset = Object.prototype.hasOwnProperty.call(ADD_PLAN_PRESETS, presetRaw)
    ? presetRaw
    : levels
      ? "custom"
      : "auto";
  if (preset === "custom" && !levels) preset = "auto";
  if (preset !== "custom") levels = null;
  return { enabled, anchor, preset, levels };
}

/**
 * @param {unknown} raw
 * @returns {Array<{drawdown_pct:number,ratio:number}>|null}
 */
function normalizeLevels(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const rows = [];
  for (const item of raw.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const drawdown = Number(item.drawdown_pct ?? item.drawdownPct);
    const ratio = Number(item.ratio);
    if (!(Number.isFinite(drawdown) && Number.isFinite(ratio) && ratio > 0)) continue;
    rows.push({
      drawdown_pct: Math.min(30, Math.max(0.5, drawdown)),
      ratio,
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.drawdown_pct - b.drawdown_pct);
  const total = rows.reduce((sum, row) => sum + row.ratio, 0);
  if (!(total > 0)) return null;
  return rows.map((row) => ({
    drawdown_pct: row.drawdown_pct,
    ratio: row.ratio / total,
  }));
}

function resolveDefaultLevels(assetClass) {
  if (assetClass == null || assetClass === "") return FALLBACK_LEVELS;
  if (Object.prototype.hasOwnProperty.call(DEFAULT_ADD_PLAN_LEVELS_BY_CLASS, assetClass)) {
    return DEFAULT_ADD_PLAN_LEVELS_BY_CLASS[assetClass];
  }
  return FALLBACK_LEVELS;
}

function depthFromMult(mult) {
  const value = Number(mult);
  const safe = Number.isFinite(value) ? value : 1;
  if (safe >= 1.2) return { depthScale: 0.6, depthLabel: "低估收窄" };
  if (safe >= 1) return { depthScale: 1, depthLabel: "标准" };
  return { depthScale: 1.5, depthLabel: "偏高放宽" };
}

/**
 * 构建分档加仓预案。
 * @param {{
 *   cost?: number|null,
 *   price?: number|null,
 *   amount?: number,
 *   assetClass?: string|null,
 *   mult?: number,
 *   config?: object|null,
 *   tradingCost?: object|number|null,
 * }} opts
 */
export function buildAddPlan({
  cost = null,
  price = null,
  amount = 0,
  assetClass = null,
  mult = 1,
  config = null,
  tradingCost = null,
} = {}) {
  const cfg = normalizeAddPlanConfig(config);
  const presetDef = ADD_PLAN_PRESETS[cfg.preset] || ADD_PLAN_PRESETS.auto;
  const notApplicable = (reason) => ({
    applicable: false,
    reason,
    anchor: cfg.anchor,
    anchorPrice: null,
    preset: presetDef.id,
    presetLabel: presetDef.label,
    depthScale: 1,
    depthLabel: "标准",
    levels: [],
  });
  const budget = Number(amount);
  const quote = Number(price);
  const costPrice = Number(cost);

  if (!(budget > 0)) {
    return notApplicable("本期无可用额度");
  }
  if (!(quote > 0) && !(costPrice > 0)) {
    return notApplicable("缺少有效价格，无法生成分档");
  }

  // 按预设解析档位来源：auto 用资产类别默认并随估值缩放；其余为固定档距
  let sourceLevels;
  let valuationLinked = false;
  if (cfg.preset === "custom" && cfg.levels) {
    sourceLevels = cfg.levels;
  } else if (presetDef.levels) {
    sourceLevels = presetDef.levels;
  } else {
    const classLevels = resolveDefaultLevels(assetClass);
    if (classLevels == null) {
      return notApplicable(
        assetClass === "bond"
          ? "债券类不做回调分档，按执行日整笔参与"
          : "商品类不做回调分档，按执行日整笔参与",
      );
    }
    sourceLevels = classLevels;
    valuationLinked = true;
  }

  let anchor = cfg.anchor;
  let anchorPrice = null;
  if (anchor === "cost") {
    if (costPrice > 0) {
      anchorPrice = costPrice;
    } else if (quote > 0) {
      anchor = "price";
      anchorPrice = quote;
    }
  } else if (quote > 0) {
    anchorPrice = quote;
  } else if (costPrice > 0) {
    anchor = "cost";
    anchorPrice = costPrice;
  }

  if (!(anchorPrice > 0)) {
    return { ...notApplicable("缺少有效价格，无法生成分档"), anchor };
  }

  // 估值联动仅作用于智能推荐；固定预设与自定义档位按原值执行
  const { depthScale, depthLabel } = valuationLinked
    ? depthFromMult(mult)
    : { depthScale: 1, depthLabel: "固定档距" };
  const levels = sourceLevels.map((row, index) => {
    const drawdownPct = row.drawdown_pct * depthScale;
    const trigger = anchorPrice * (1 - drawdownPct / 100);
    const levelAmount = budget * row.ratio;
    const preview = orderPreview(levelAmount, trigger, tradingCost || {});
    const triggered = quote > 0 && quote <= trigger;
    return {
      name: LEVEL_NAMES[index] || `第${index + 1}档`,
      drawdownPct,
      trigger,
      ratio: row.ratio,
      amount: levelAmount,
      shares: preview.shares,
      triggered,
    };
  });

  return {
    applicable: true,
    reason: "",
    anchor,
    anchorPrice,
    preset: presetDef.id,
    presetLabel: presetDef.label,
    depthScale,
    depthLabel,
    levels,
  };
}
