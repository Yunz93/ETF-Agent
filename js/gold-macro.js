/**
 * 黄金宏观层：美债 10Y + 美元指数，供商品定投 overlay。
 */

import { state } from "./state.js";

let inFlight = null;

export function goldMacroFromState() {
  const payload = state.goldMacro;
  if (!payload || typeof payload !== "object") return null;
  return payload;
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

export async function ensureGoldMacro({ refresh = false } = {}) {
  if (!refresh && state.goldMacro && !state.goldMacro.degraded) {
    const ageMs = Date.now() - (state.goldMacroFetchedAt || 0);
    if (ageMs < 15 * 60 * 1000) return state.goldMacro;
  }
  if (inFlight && !refresh) return inFlight;

  inFlight = (async () => {
    let response = null;
    try {
      const query = new URLSearchParams();
      if (refresh) query.set("refresh", "1");
      const suffix = query.toString() ? `?${query}` : "";
      response = await fetch(`/api/market/gold-macro${suffix}`);
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }
      if (!payload || typeof payload !== "object") {
        throw new Error("黄金宏观数据格式异常");
      }
      state.goldMacro = payload;
      state.goldMacroFetchedAt = Date.now();
      state.goldMacroError = payload.degraded ? "宏观数据降级" : null;
      return payload;
    } catch (error) {
      state.goldMacroError = friendlyFetchError(error, response);
      if (!state.goldMacro) {
        state.goldMacro = {
          degraded: true,
          mult: 1,
          score: null,
          band: "宏观暂缺",
          error: state.goldMacroError,
        };
      }
      return state.goldMacro;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
