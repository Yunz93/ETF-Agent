export const CURRENCY = {
  CNY: "¥",
};

export const PAGE_TITLES = {
  dividend: "分析",
  etf: "定投计划",
  settings: "设置",
};

/** 种子池目标仓位（%），与后端 DEFAULT_TARGET_WEIGHTS 对齐 */
export const DEFAULT_TARGET_WEIGHTS = {
  "563360": 20,
  "513390": 15,
  "513500": 15,
  "563020": 15,
  "512890": 20,
  "513010": 10,
  "159937": 5,
};

export const PLAN_CADENCE_LABELS = {
  weekly: "每周",
  biweekly: "每两周",
  monthly: "每月",
};

/** 指数走势可见区间（相对最新交易日往前推） */
export const INDEX_CHART_RANGE_MONTHS = {
  "6m": 6,
  "1y": 12,
  "3y": 36,
  "5y": 60,
  max: null,
};

export const INDEX_CHART_RANGE_LABELS = {
  "6m": "6M",
  "1y": "1Y",
  "3y": "3Y",
  "5y": "5Y",
  max: "全部",
};

export const THEME_KEY = "stockagent.theme";
export const SIDEBAR_KEY = "stockagent.sidebar";
export const SIDEBAR_COLLAPSE_MIN = 1181;
export const WORKSPACE_CACHE_KEY = "stockagent.workspace.cache";
export const WORKSPACE_SYNC_DEBOUNCE_MS = 500;
export const ETF_QUOTE_TTL_MS = 60_000;

/** 定投池内 ETF 均可分析；无指数映射时后端走 ETF 行情兜底。 */
export function analysisSupported(appConfig, symbol) {
  if (!symbol) return true;
  const support = appConfig?.etf?.analysis_support?.[symbol];
  if (support && Object.prototype.hasOwnProperty.call(support, "supported")) {
    return Boolean(support.supported);
  }
  return true;
}

/** 是否为完整指数估值（相对 ETF 行情兜底）。 */
export function analysisIsFullIndex(appConfig, symbol) {
  if (!symbol) return true;
  const support = appConfig?.etf?.analysis_support?.[symbol];
  if (support?.mode) return support.mode !== "etf_proxy";
  const registry = appConfig?.etf?.analysis_registry || {};
  return Boolean(registry[symbol]?.index_code);
}
