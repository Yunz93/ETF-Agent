/**
 * 分析缓存与全池串行预取：复用单只分析接口，避免并发打爆数据源。
 */

import { ANALYSIS_CACHE_TTL_MS } from "./constants.js";
import { state } from "./state.js";

const loadingByKey = new Map();
let prefetchPromise = null;
let prefetchListener = null;

export function analysisCacheKey(symbol) {
  return symbol || "__default__";
}

export function getCachedAnalysis(symbol) {
  return state.analysisCache[analysisCacheKey(symbol)] || null;
}

/** 缓存有效：有载荷、无错误、且未超过 TTL。 */
export function isAnalysisFresh(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.error || payload.supported === false) return false;
  const updated = Date.parse(String(payload.updated_at || ""));
  if (!Number.isFinite(updated)) return true;
  return now - updated < ANALYSIS_CACHE_TTL_MS;
}

export function isAnalysisUsable(payload) {
  return Boolean(payload && payload.supported !== false && !payload.error);
}

function poolSymbols() {
  return (state.etfs || []).map((item) => item.symbol).filter(Boolean);
}

function analyzedCount(symbols = poolSymbols()) {
  return symbols.filter((symbol) => isAnalysisUsable(getCachedAnalysis(symbol))).length;
}

function setPrefetchState(partial) {
  state.analysisPrefetch = {
    ...(state.analysisPrefetch || { status: "idle", total: 0, done: 0, current: null }),
    ...partial,
  };
}

/** 拉取单只分析；已有未过期缓存时直接返回。 */
export async function fetchAnalysis(symbol, { force = false } = {}) {
  const key = analysisCacheKey(symbol);
  const cached = state.analysisCache[key];
  if (!force && isAnalysisFresh(cached)) {
    return cached;
  }
  if (!force && cached != null && !cached.error && cached.supported !== false && !isAnalysisFresh(cached)) {
    // 过期但仍可用：允许后台刷新，不阻塞；此处仍重新拉取以保持与单只页一致
  }
  if (loadingByKey.has(key)) return loadingByKey.get(key);

  const request = (async () => {
    try {
      const params = new URLSearchParams();
      if (force) params.set("refresh", "1");
      if (symbol) params.set("symbol", symbol);
      const query = params.toString();
      const response = await fetch(`/api/dividend/daily${query ? `?${query}` : ""}`);
      const payload = await response.json();
      state.analysisCache[key] = payload;
      return payload;
    } catch (error) {
      const payload = { supported: false, error: String(error), symbol };
      state.analysisCache[key] = payload;
      return payload;
    } finally {
      loadingByKey.delete(key);
    }
  })();

  loadingByKey.set(key, request);
  return request;
}

/**
 * 串行预取池内全部 ETF 分析；已有未过期缓存的跳过。
 * onUpdate 在每只完成后回调，便于渐进重渲染。
 */
export async function ensurePoolAnalysisPrefetch({ onUpdate } = {}) {
  if (typeof onUpdate === "function") prefetchListener = onUpdate;
  const notify = () => {
    if (typeof prefetchListener === "function") prefetchListener();
  };

  const symbols = poolSymbols();
  if (!symbols.length) {
    setPrefetchState({ status: "done", total: 0, done: 0, current: null });
    return;
  }

  const pending = symbols.filter((symbol) => !isAnalysisFresh(getCachedAnalysis(symbol)));
  if (!pending.length) {
    setPrefetchState({
      status: "done",
      total: symbols.length,
      done: symbols.length,
      current: null,
    });
    return;
  }

  if (prefetchPromise) return prefetchPromise;

  setPrefetchState({
    status: "running",
    total: symbols.length,
    done: analyzedCount(symbols),
    current: null,
  });
  notify();

  prefetchPromise = (async () => {
    for (const symbol of pending) {
      // 池变更时中止本轮，由下次 render 再启
      if (!poolSymbols().includes(symbol)) break;
      setPrefetchState({
        status: "running",
        total: poolSymbols().length,
        done: analyzedCount(),
        current: symbol,
      });
      notify();
      await fetchAnalysis(symbol, { force: false });
      setPrefetchState({
        status: "running",
        total: poolSymbols().length,
        done: analyzedCount(),
        current: symbol,
      });
      notify();
    }
    setPrefetchState({
      status: "done",
      total: poolSymbols().length,
      done: analyzedCount(),
      current: null,
    });
    notify();
  })().finally(() => {
    prefetchPromise = null;
  });

  return prefetchPromise;
}

export function analysisPrefetchIsPreliminary() {
  const prefetch = state.analysisPrefetch;
  if (!poolSymbols().length) return false;
  if (!prefetch || prefetch.status === "idle") return true;
  if (prefetch.status === "running") return true;
  return false;
}
