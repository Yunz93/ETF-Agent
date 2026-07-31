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

function friendlyFetchError(error, response) {
  const raw = error?.message || String(error || "");
  if (response && (response.status === 404 || /Unexpected token\s*'<'|DOCTYPE|is not valid JSON/i.test(raw))) {
    return "接口不可用，请重启后端后再试";
  }
  if (response && !response.ok) {
    return `HTTP ${response.status}`;
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return "网络不可用";
  }
  return raw.slice(0, 80) || "未知错误";
}

async function readJsonResponse(response) {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(response.ok ? "空响应" : `HTTP ${response.status}`);
  }
  if (trimmed.startsWith("<") || trimmed.startsWith("<!")) {
    const err = new Error("接口返回了网页而非 JSON");
    err.code = "html_instead_of_json";
    throw err;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const err = new Error("响应不是合法 JSON");
    err.code = "invalid_json";
    err.cause = error;
    throw err;
  }
}

export async function ensureMarketSentiment({ refresh = false } = {}) {
  if (!refresh && state.marketSentiment?.items && !state.marketSentiment.degraded) {
    const ageMs = Date.now() - (state.marketSentimentFetchedAt || 0);
    if (ageMs < 15 * 60 * 1000) return state.marketSentiment;
  }
  if (inFlight && !refresh) return inFlight;

  inFlight = (async () => {
    let response = null;
    try {
      const query = new URLSearchParams({ markets: "A,HK,US" });
      if (refresh) query.set("refresh", "1");
      response = await fetch(`/api/market/sentiment?${query}`);
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      if (!payload || typeof payload !== "object" || !payload.items) {
        throw new Error("情绪数据格式异常");
      }
      state.marketSentiment = payload;
      state.marketSentimentFetchedAt = Date.now();
      state.marketSentimentError = payload.degraded ? "部分市场数据降级" : null;
      return payload;
    } catch (error) {
      state.marketSentimentError = friendlyFetchError(error, response);
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
