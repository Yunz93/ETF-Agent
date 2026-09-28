/**
 * 决策组合：按跟踪指数分袖，袖内纳管场内 ETF 与场外基金。
 * 不记账、不维护现金/份额流水。
 */

export const INDEX_PRESETS = Object.freeze([
  { id: "sp500", name: "标普500", index_code: "SPX", primary_symbol: "513500" },
  { id: "nasdaq", name: "纳斯达克100", index_code: "NDX", primary_symbol: "513390" },
  { id: "dividend", name: "红利低波", index_code: "H30269", primary_symbol: "512890" },
  { id: "gold", name: "黄金", index_code: "GOLD", primary_symbol: "159937" },
  { id: "hstech", name: "恒生科技", index_code: "HSTECH", primary_symbol: "513010" },
  { id: "a500", name: "中证A500", index_code: "000510", primary_symbol: "563360" },
  { id: "csi300", name: "沪深300", index_code: "000300", primary_symbol: "510300" },
]);

const DEFAULT_SLEEVE_SPECS = [
  ["sp500", "标普500", "SPX", 45, [["513500", "标普500ETF博时", "exchange"]]],
  ["nasdaq", "纳斯达克100", "NDX", 25, [["513390", "纳指100ETF博时", "exchange"]]],
  ["gold", "黄金", "GOLD", 15, [["159937", "黄金ETF博时", "exchange"]]],
  ["dividend", "红利低波", "H30269", 15, [["512890", "红利低波ETF华泰柏瑞", "exchange"]]],
];

const CATEGORY_INDEX = {
  sp500: ["SPX", "标普500"],
  nasdaq: ["NDX", "纳斯达克100"],
  gold: ["GOLD", "黄金"],
  dividend: ["H30269", "红利低波"],
};

export function normalizeEtfCode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits || digits.length > 6) return "";
  return digits.padStart(6, "0");
}

function clampPct(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(100, Math.round(number * 100) / 100);
}

export function defaultDecision() {
  return {
    name: "核心指数组合",
    note: "",
    sleeves: DEFAULT_SLEEVE_SPECS.map(([id, name, indexCode, pct, products]) => ({
      id,
      name,
      index_code: indexCode,
      target_pct: pct,
      note: "",
      instruments: products.map(([symbol, productName, kind], index) => ({
        id: `${kind}_${symbol}`,
        symbol,
        name: productName,
        kind,
        role: index === 0 ? "primary" : "alternate",
        note: "",
        index_code: indexCode,
      })),
    })),
  };
}

export function normalizeInstrument(item, fallbackIndex = "") {
  if (!item || typeof item !== "object") return null;
  const symbol = normalizeEtfCode(item.symbol);
  if (!symbol) return null;
  const kind = item.kind === "fund" ? "fund" : "exchange";
  const role = item.role === "primary" ? "primary" : "alternate";
  return {
    id: String(item.id || `${kind}_${symbol}`).slice(0, 80),
    symbol,
    name: String(item.name || symbol).trim().slice(0, 40) || symbol,
    kind,
    role,
    note: String(item.note || "").trim().slice(0, 80),
    index_code: String(item.index_code || fallbackIndex || "").trim().toUpperCase(),
  };
}

export function normalizeSleeve(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  const name = String(item.name || "").trim();
  const indexCode = String(item.index_code || "").trim().toUpperCase();
  if (!id || !name || !indexCode) return null;
  const seen = new Set();
  const instruments = [];
  for (const raw of item.instruments || []) {
    const row = normalizeInstrument(raw, indexCode);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    instruments.push(row);
  }
  if (!instruments.length) return null;
  if (!instruments.some((row) => row.role === "primary")) instruments[0].role = "primary";
  else {
    let primarySeen = false;
    for (const row of instruments) {
      if (row.role !== "primary") continue;
      if (primarySeen) row.role = "alternate";
      else primarySeen = true;
    }
  }
  return {
    id: id.slice(0, 40),
    name: name.slice(0, 40),
    index_code: indexCode.slice(0, 16),
    target_pct: clampPct(item.target_pct, 0),
    note: String(item.note || "").trim().slice(0, 80),
    instruments,
  };
}

function rescaleTargets(sleeves) {
  const total = sleeves.reduce((sum, row) => sum + row.target_pct, 0);
  if (!(total > 0)) {
    const share = sleeves.length ? Math.round((100 / sleeves.length) * 100) / 100 : 0;
    return sleeves.map((row, index) => ({
      ...row,
      target_pct:
        index === sleeves.length - 1
          ? Math.round((100 - share * (sleeves.length - 1)) * 100) / 100
          : share,
    }));
  }
  if (Math.abs(total - 100) < 0.05) return sleeves;
  let running = 0;
  return sleeves.map((row, index) => {
    if (index === sleeves.length - 1) {
      return { ...row, target_pct: Math.round((100 - running) * 100) / 100 };
    }
    const next = Math.round((row.target_pct * 100) / total * 100) / 100;
    running += next;
    return { ...row, target_pct: next };
  });
}

export function decisionFromPortfolio(portfolio) {
  if (!portfolio || typeof portfolio !== "object") return null;
  const categories = Array.isArray(portfolio.categories) ? portfolio.categories : [];
  const products = Array.isArray(portfolio.products) ? portfolio.products : [];
  if (!categories.length) return null;
  const sleeves = [];
  for (const category of categories) {
    const cid = String(category?.id || "").trim();
    const name = String(category?.name || "").trim();
    if (!cid || !name) continue;
    const mapped = CATEGORY_INDEX[cid];
    const indexCode = mapped ? mapped[0] : cid.toUpperCase();
    const display = mapped ? mapped[1] : name;
    const owned = products.filter((row) => row?.category_id === cid);
    const instruments = [];
    for (const product of owned) {
      const symbol = normalizeEtfCode(product.symbol);
      if (!symbol) continue;
      const kind = product.kind === "fund" ? "fund" : "exchange";
      instruments.push({
        id: String(product.id || `${kind}_${symbol}`),
        symbol,
        name: String(product.name || symbol),
        kind,
        role: product.id === category.primary_product_id ? "primary" : "alternate",
        note: "",
        index_code: indexCode,
      });
    }
    if (!instruments.length) continue;
    sleeves.push({
      id: cid,
      name: display,
      index_code: indexCode,
      target_pct: clampPct(category.target_pct, 0),
      note: "",
      instruments,
    });
  }
  if (!sleeves.length) return null;
  return {
    name: String(portfolio.name || "核心指数组合"),
    note: "由持仓账本迁移为决策组合",
    sleeves,
  };
}

export function normalizeDecision(payload, { portfolio = null } = {}) {
  let source = payload && typeof payload === "object" ? payload : null;
  if (!source?.sleeves?.length) {
    source = decisionFromPortfolio(portfolio) || defaultDecision();
  }
  const seen = new Set();
  const sleeves = [];
  for (const item of source.sleeves || []) {
    const sleeve = normalizeSleeve(item);
    if (!sleeve || seen.has(sleeve.id)) continue;
    seen.add(sleeve.id);
    sleeves.push(sleeve);
  }
  if (!sleeves.length) return defaultDecision();
  return {
    name: String(source.name || "核心指数组合").trim().slice(0, 40) || "核心指数组合",
    note: String(source.note || "").trim().slice(0, 120),
    sleeves: rescaleTargets(sleeves),
  };
}

export function primaryInstrument(sleeve) {
  if (!sleeve?.instruments?.length) return null;
  return sleeve.instruments.find((row) => row.role === "primary") || sleeve.instruments[0];
}

export function sleeveById(decision, id) {
  return (decision?.sleeves || []).find((row) => row.id === id) || null;
}

export function sleeveBySymbol(decision, symbol) {
  const wanted = normalizeEtfCode(symbol);
  if (!wanted) return null;
  return (
    (decision?.sleeves || []).find((sleeve) =>
      (sleeve.instruments || []).some((row) => row.symbol === wanted),
    ) || null
  );
}

export function projectDecisionEtfs(decision) {
  const rows = [];
  const seen = new Set();
  for (const sleeve of decision?.sleeves || []) {
    const primary = primaryInstrument(sleeve);
    for (const instrument of sleeve.instruments || []) {
      if (instrument.kind !== "exchange" || seen.has(instrument.symbol)) continue;
      seen.add(instrument.symbol);
      rows.push({
        symbol: instrument.symbol,
        name: instrument.name,
        shares: 0,
        cost: 0,
        target_weight: instrument.id === primary?.id ? sleeve.target_pct : 0,
        note: instrument.kind === "fund" ? "场外" : "",
      });
    }
  }
  return rows;
}

export function upsertInstrument(sleeve, instrument) {
  const row = normalizeInstrument(instrument, sleeve.index_code);
  if (!row) return sleeve;
  const existing = (sleeve.instruments || []).filter((item) => item.id !== row.id && item.symbol !== row.symbol);
  if (row.role === "primary") {
    for (const item of existing) item.role = "alternate";
  }
  return { ...sleeve, instruments: [...existing, row] };
}

export function removeInstrument(sleeve, instrumentId) {
  const next = (sleeve.instruments || []).filter((row) => row.id !== instrumentId);
  if (!next.length) return sleeve;
  if (!next.some((row) => row.role === "primary")) next[0].role = "primary";
  return { ...sleeve, instruments: next };
}

export function kindLabel(kind) {
  return kind === "fund" ? "场外基金" : "场内 ETF";
}
