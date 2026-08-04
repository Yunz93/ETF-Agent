/**
 * 定投策略公共入口（re-export，保持既有 import 路径兼容）。
 */

export {
  STRATEGY_IDS,
  STRATEGY_PRESETS,
  DEFAULT_PE_BANDS,
  GROWTH_PE_BANDS,
  DEFAULT_GRADE_MULT,
  COMMODITY_GRADE_MULT,
  DEFAULT_SENTIMENT_BANDS,
  DEFAULT_SENTIMENT_CONFIG,
  DEFAULT_STRATEGY_CONFIG,
  POSITION_TOLERANCE_PP,
  inferSentimentMarket,
  normalizeStrategyId,
  strategyLabel,
  strategySummary,
  normalizeSentimentConfig,
  normalizeStrategyConfig,
  sentimentMultiplier,
  sentimentMarketForHolding,
  goldMacroMultiplier,
  commodityDcaMultiplier,
  dcaMultiplier,
  valuationDcaMultiplier,
} from "./strategy-multipliers.js";

export { computeCashRelease } from "./strategy-cash.js";

export {
  rebalanceHint,
  buildGapTilt,
  allocateWithCaps,
  allocatePoolBudget,
  allocationForSymbol,
} from "./strategy-allocate.js";
