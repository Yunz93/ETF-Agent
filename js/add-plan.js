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

/** Explicitly saved plan; prices and tier budgets never move on a render. */
export function createAddPlanSession({ symbol, period, expires, buys = [], previousSession = null, remainingAmount = null, now = new Date(), ...options }) {
  let amount = Number(options.amount);
  if (remainingAmount != null && Number.isFinite(Number(remainingAmount))) amount = Math.min(amount, Math.max(0, Number(remainingAmount)));
  const prior = normalizeAddPlanSessions({ [symbol]: previousSession })[symbol] || null;
  const today = now.toLocaleDateString("sv-SE");
  const previous = prior ? evaluateAddPlanSession(prior, { buys, today }) : null;
  if (prior?.period === period && prior?.expires === expires) amount = Math.min(amount, previous.remaining);
  const preview = buildAddPlan({ ...options, amount });
  if (!preview.applicable || !Number.isFinite(amount)) return null;
  const history = prior ? [...(prior.previous_snapshots || []), {
    period: prior.period, expires: prior.expires, created_at: prior.created_at,
    anchor_price: prior.anchor_price, anchor: prior.anchor, amount: prior.amount,
    preset_label: prior.preset_label, levels: prior.levels,
    closed_at: now.toISOString(), spent: previous.spent, remaining: previous.remaining,
  }].slice(-24) : [];
  const session = {
    symbol, period, expires, created_at: now.toISOString(),
    anchor_price: preview.anchorPrice, anchor: preview.anchor,
    amount, preset_label: preview.presetLabel,
    levels: preview.levels.map(({ drawdownPct, ratio }) => ({ drawdown_pct: drawdownPct, ratio })),
    baseline_buy_ids: buys.filter((row) => row.symbol === symbol).map((row) => row.id),
    previous_snapshots: history,
  };
  return normalizeAddPlanSessions({ [symbol]: session })[symbol] || null;
}

function validSessionDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validSessionTimestamp(value) {
  return typeof value === "string" && validSessionDate(value.slice(0, 10)) && value[10] === "T" && Number.isFinite(Date.parse(value));
}

function normalizeSessionSnapshot(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (!(Number(row.anchor_price) > 0) || !Number.isFinite(Number(row.anchor_price)) || !(Number(row.amount) > 0) || !Number.isFinite(Number(row.amount))) return null;
  if (!validSessionDate(row.period) || !validSessionDate(row.expires) || row.expires <= row.period || !validSessionTimestamp(row.created_at)) return null;
  if (!Array.isArray(row.levels) || !row.levels.length || row.levels.length > 4 || row.levels.some((level) =>
    !level || !Number.isFinite(Number(level.drawdown_pct)) || Number(level.drawdown_pct) < 0.5 || Number(level.drawdown_pct) > 30 || !Number.isFinite(Number(level.ratio)) || !(Number(level.ratio) > 0)
  )) return null;
  const levels = normalizeLevels(row.levels);
  if (!levels || !levels.every(level => level.ratio > 0)) return null;
  return { period: row.period, expires: row.expires, created_at: row.created_at,
    anchor_price: Number(row.anchor_price), anchor: row.anchor === "cost" ? "cost" : "price", amount: Number(row.amount),
    preset_label: String(row.preset_label || "已保存档位"), levels };
}

export function normalizeAddPlanSessions(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = [];
  for (const [symbol, row] of Object.entries(raw).slice(0, 100)) {
    if (!/^\d{6}$/.test(symbol)) continue;
    const snapshot = normalizeSessionSnapshot(row);
    if (!snapshot) continue;
    const history = (Array.isArray(row.previous_snapshots) ? row.previous_snapshots : []).slice(-24).flatMap((item) => {
      const historical = normalizeSessionSnapshot(item);
      if (!historical || !validSessionTimestamp(item.closed_at)) return [];
      const spent = Number(item.spent);
      const remaining = Number(item.remaining);
      if (!Number.isFinite(spent) || spent < 0 || !Number.isFinite(remaining) || remaining < 0 || remaining > historical.amount) return [];
      return [{ ...historical, closed_at: item.closed_at, spent, remaining }];
    });
    entries.push([symbol, { symbol, ...snapshot,
      baseline_buy_ids: Array.isArray(row.baseline_buy_ids) ? row.baseline_buy_ids.slice(0, 5000).map(String) : [],
      previous_snapshots: history,
    }]);
  }
  return Object.fromEntries(entries);
}

export function evaluateAddPlanSession(session, { price, buys = [], today, tradingCost = {} } = {}) {
  if (!session) return null;
  const expired = today >= session.expires || today < session.period;
  const baseline = new Set(session.baseline_buy_ids || []);
  const spent = buys.filter((row) => row.symbol === session.symbol && !baseline.has(row.id) && row.date >= session.period && row.date < session.expires)
    .reduce((sum, row) => sum + Math.max(0, Number(row.shares) * Number(row.price)) + Math.max(0, Number(row.fee) || 0), 0);
  let remainingSpent = spent;
  const levels = session.levels.map((level, index) => {
    const original = session.amount * level.ratio;
    const consumed = Math.min(original, remainingSpent);
    remainingSpent -= consumed;
    const amount = Math.max(0, original - consumed);
    const trigger = session.anchor_price * (1 - level.drawdown_pct / 100);
    const preview = orderPreview(amount, trigger, tradingCost);
    return { name: LEVEL_NAMES[index] || `第${index + 1}档`, drawdownPct: level.drawdown_pct, trigger, amount,
      shares: preview.shares, completed: amount <= 0, triggered: !expired && amount > 0 && price > 0 && price <= trigger };
  });
  return { applicable: true, levels, expired, anchorPrice: session.anchor_price, presetLabel: session.preset_label,
    remaining: Math.max(0, session.amount - spent), spent };
}
