import { DEFAULT_TARGET_WEIGHTS } from "./constants.js";
import {
  normalizeStrategyConfig,
  normalizeStrategyId,
} from "./strategy.js";

export const DEFAULT_TRADING_COST = Object.freeze({
  min_commission: 5,
  commission_rate_pct: 0.03,
  max_fee_ratio_pct: 0.25,
  lot_size: 100,
});

function nonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizeTradingCost(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    min_commission: nonnegative(source.min_commission, DEFAULT_TRADING_COST.min_commission),
    commission_rate_pct: Math.min(
      10,
      nonnegative(source.commission_rate_pct, DEFAULT_TRADING_COST.commission_rate_pct),
    ),
    max_fee_ratio_pct: Math.min(
      100,
      nonnegative(source.max_fee_ratio_pct, DEFAULT_TRADING_COST.max_fee_ratio_pct),
    ),
    lot_size: Math.min(
      100000,
      Math.max(1, Math.round(nonnegative(source.lot_size, DEFAULT_TRADING_COST.lot_size))),
    ),
  };
}

function normalizePendingOrders(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([symbol, row]) => /^\d{6}$/.test(symbol) && row && typeof row === "object")
      .map(([symbol, row]) => [
        symbol,
        {
          period: /^\d{4}-\d{2}-\d{2}$/.test(String(row.period || "")) ? String(row.period) : "",
          carry: nonnegative(row.carry),
          scheduled: nonnegative(row.scheduled),
          remaining: nonnegative(row.remaining),
        },
      ]),
  );
}

export function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(100, Math.round(number * 100) / 100);
}

export function normalizePlan(plan) {
  const base = {
    name: "默认定投计划",
    amount: 2000,
    capital_base: 0,
    initial_target_pct: 0,
    initial_build_completed_at: null,
    cadence: "monthly",
    day: 1,
    note: "",
    strategy: "valuation",
    strategy_config: normalizeStrategyConfig(null),
    trading_cost: normalizeTradingCost(null),
    pending_orders: {},
  };
  if (!plan || typeof plan !== "object") {
    return {
      ...base,
      strategy_config: normalizeStrategyConfig(null),
    };
  }
  let cadence = String(plan.cadence || base.cadence).toLowerCase();
  if (!["weekly", "biweekly", "monthly"].includes(cadence)) cadence = base.cadence;
  let day = Number.parseInt(plan.day, 10);
  if (!Number.isFinite(day)) day = base.day;
  if (cadence === "monthly") day = Math.min(28, Math.max(1, day));
  else day = Math.min(7, Math.max(1, day));
  const amount = Number(plan.amount);
  const capitalBase = Number(plan.capital_base);
  const initialTargetPct = Number(plan.initial_target_pct);
  return {
    name: String(plan.name || base.name).trim() || base.name,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    capital_base: Number.isFinite(capitalBase) && capitalBase > 0 ? capitalBase : 0,
    initial_target_pct:
      Number.isFinite(initialTargetPct) && initialTargetPct > 0
        ? Math.min(100, initialTargetPct)
        : 0,
    initial_build_completed_at:
      String(plan.initial_build_completed_at || "").trim() || null,
    cadence,
    day,
    note: String(plan.note || "").trim(),
    strategy: normalizeStrategyId(plan.strategy),
    strategy_config: normalizeStrategyConfig(plan.strategy_config ?? plan.strategyConfig),
    trading_cost: normalizeTradingCost(plan.trading_cost),
    pending_orders: normalizePendingOrders(plan.pending_orders),
  };
}

export function normalizeWorkspaceEntries(items = []) {
  const hadTarget = items.some(
    (item) => item && (item.target_weight != null || item.targetWeight != null),
  );
  const etfs = items
    .filter((item) => item && item.symbol)
    .map((item) => {
      const symbol = String(item.symbol || "");
      const targetRaw = item.target_weight ?? item.targetWeight;
      return {
        symbol,
        name: String(item.name || ""),
        shares: Number(item.shares) > 0 ? Number(item.shares) : 0,
        cost: Number(item.cost) > 0 ? Number(item.cost) : 0,
        target_weight: clampWeight(targetRaw),
        note: String(item.note || ""),
      };
    });
  if (!hadTarget) {
    etfs.forEach((entry) => {
      entry.target_weight = clampWeight(DEFAULT_TARGET_WEIGHTS[entry.symbol] || 0);
    });
  }
  return etfs;
}

export function normalizeTrades(items = [], kind = "buy") {
  const seen = new Set();
  const buys = [];
  for (const item of items) {
    if (!item || !item.symbol || !item.date) continue;
    const digits = String(item.symbol).replace(/\D/g, "");
    if (digits.length < 1 || digits.length > 6) continue;
    const symbol = digits.padStart(6, "0");
    const date = String(item.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const [year, month, day] = date.split("-").map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      year < 1990 ||
      year > 2100 ||
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      continue;
    }
    const shares = Number(item.shares);
    const price = Number(item.price);
    if (!(shares > 0) || !(price > 0)) continue;
    const id = String(item.id || "").trim() || `${kind}_${symbol}_${date}_${Math.round(shares)}_${Math.round(price * 10000)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    buys.push({
      id,
      symbol,
      date,
      price: Math.round(price * 1e6) / 1e6,
      shares: Math.round(shares * 1e4) / 1e4,
      fee: Math.round(nonnegative(item.fee) * 100) / 100,
      note: String(item.note || "").trim(),
    });
  }
  buys.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  return buys;
}

export function normalizeBuys(items = []) {
  return normalizeTrades(items, "buy");
}

export function normalizeSells(items = []) {
  return normalizeTrades(items, "sell");
}

export function upsertBuy(items, record) {
  if (!record?.id) return normalizeBuys(items);
  return normalizeBuys([record, ...(items || []).filter((item) => item?.id !== record.id)]);
}

export function upsertSell(items, record) {
  if (!record?.id) return normalizeSells(items);
  return normalizeSells([record, ...(items || []).filter((item) => item?.id !== record.id)]);
}

export function chooseWorkspaceSource(remote, local) {
  if (Array.isArray(remote?.etfs) && remote.etfs.length) {
    return { source: "server", payload: remote, migrate: false };
  }
  if (Array.isArray(local?.etfs) && local.etfs.length) {
    return { source: "local-cache", payload: local, migrate: true };
  }
  return { source: "default-pool", payload: null, migrate: true };
}
