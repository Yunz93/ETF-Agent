import { CURRENCY, FX_TO_CNY } from "./constants.js";
import { provider } from "./state.js";

export function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function stockKey(stock) {
  return `${stock.market}:${stock.symbol}`;
}

export function sameStock(a, b) {
  return a.symbol === b.symbol && a.market === b.market;
}

export function findStock(symbol, market) {
  return provider.stocks.find((item) => item.symbol === symbol && item.market === market);
}

export function marketLabel(market) {
  return { A: "A 股", HK: "港股", US: "美股" }[market] || market;
}

export function valuationLabel(stateName) {
  return {
    undervalued: "低估区间",
    fair: "合理区间",
    expensive: "偏贵区间",
    risk: "风险区间",
  }[stateName];
}

export function money(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${CURRENCY[currency] || ""}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function signed(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}`;
}

export function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function toBase(amount, fromCurrency, baseCurrency) {
  const from = FX_TO_CNY[fromCurrency] || 1;
  const to = FX_TO_CNY[baseCurrency] || 1;
  return (amount * from) / to;
}

export function normalizeClientSymbol(symbol, market) {
  const raw = String(symbol || "").trim().toUpperCase();
  if (market === "HK") {
    const digits = raw.replace(/\D/g, "");
    return digits.padStart(4, "0");
  }
  if (market === "A") {
    const digits = raw.replace(/\D/g, "");
    return digits.padStart(6, "0");
  }
  return raw.replace("/", ".");
}

export function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
