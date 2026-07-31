/**
 * 市场情绪：拉取宽基 ETF 衍生温度，供定投 overlay 使用。
 */

import { appConfig, state } from "./state.js";

let inFlight = null;

export function sentimentByMarketFromState() {
  const payload = state.marketSentiment;
  if (!payload || typeof payload !== "object") return null;
  return payload.items || null;
}

export function analysisRegistryFromConfig() {
  return appConfig?.etf?.analysis_registry || {};
}

export async function ensureMarketSentiment({ refresh = false } = {}) {
  if (!refresh && state.marketSentiment?.items && !state.marketSentiment.degraded) {
    const ageMs = Date.now() - (state.marketSentimentFetchedAt || 0);
    if (ageMs < 15 * 60 * 1000) return state.marketSentiment;
  }
  if (inFlight && !refresh) return inFlight;

  inFlight = (async () => {
    try {
      const query = new URLSearchParams({ markets: "A,HK,US" });
      if (refresh) query.set("refresh", "1");
      const response = await fetch(`/api/market/sentiment?${query}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      state.marketSentiment = payload;
      state.marketSentimentFetchedAt = Date.now();
      state.marketSentimentError = null;
      return payload;
    } catch (error) {
      state.marketSentimentError = error?.message || String(error);
      if (!state.marketSentiment) {
        state.marketSentiment = {
          items: {},
          degraded: true,
          error: state.marketSentimentError,
        };
      }
      return state.marketSentiment;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
