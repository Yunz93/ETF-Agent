/**
 * 交易入账纯函数：供 UI 与清单→持仓路径测试共用。
 */

import { estimatedTradeFee, holdingFromTrades } from "./decision-support.js";
import { upsertBuy, upsertSell } from "./workspace_model.js";
import {
  bookCashReserveSell,
  settleCashReserveOnPeriodComplete,
  updateExecutionDraft,
} from "./execution-drafts.js";

function newTradeId(type, symbol, date, now = Date.now()) {
  return `${type}_${symbol}_${date}_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function syncHoldingSharesFromTrades(etfs, buys, sells, symbol) {
  const nextEtfs = (etfs || []).map((item) => ({ ...item }));
  const entry = nextEtfs.find((item) => item.symbol === symbol);
  if (!entry) return nextEtfs;
  const hasTrades =
    (buys || []).some((item) => item.symbol === symbol) ||
    (sells || []).some((item) => item.symbol === symbol);
  if (!hasTrades) return nextEtfs;
  const derived = holdingFromTrades(buys, sells, symbol);
  entry.shares = derived.shares;
  entry.cost = derived.cost;
  return nextEtfs;
}

/**
 * 确认执行草稿并写入买卖记录 + 同步持仓。
 * @returns {{ etfs, buys, sells, executionDrafts, plan, trade }}
 */
export function confirmDraftIntoLedger({
  draft,
  etfs = [],
  buys = [],
  sells = [],
  executionDrafts = [],
  plan = {},
  tradingCost = null,
  price = null,
  shares = null,
  fee = null,
  date = null,
  note = null,
  now = new Date(),
} = {}) {
  if (!draft || draft.status !== "pending") {
    throw new Error("draft not pending");
  }
  const side = draft.side === "sell" ? "sell" : "buy";
  const symbol = String(draft.symbol || "").trim();
  if (!symbol) throw new Error("missing symbol");
  if (!(etfs || []).some((item) => item.symbol === symbol)) {
    throw new Error("symbol not in plan");
  }

  const tradeDate = String(date || draft.date || "").trim();
  const tradePrice = Number(price ?? draft.price);
  const tradeShares = Number(shares ?? draft.shares);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error("bad date");
  if (!(tradePrice > 0) || !(tradeShares > 0)) throw new Error("bad price/shares");

  const cost = tradingCost || plan?.trading_cost;
  const resolvedFee =
    fee != null && Number.isFinite(Number(fee)) && Number(fee) >= 0
      ? Number(fee)
      : estimatedTradeFee(tradePrice * tradeShares, cost);

  const trade = {
    id: newTradeId(side, symbol, tradeDate, now.getTime()),
    symbol,
    date: tradeDate,
    price: tradePrice,
    shares: tradeShares,
    fee: resolvedFee,
    note:
      note != null
        ? String(note)
        : draft.note || (side === "sell" ? `卖出纪律 ${draft.period}` : `执行清单 ${draft.period}`),
  };

  let nextBuys = buys || [];
  let nextSells = sells || [];
  if (side === "sell") nextSells = upsertSell(nextSells, trade);
  else nextBuys = upsertBuy(nextBuys, trade);

  let nextEtfs = syncHoldingSharesFromTrades(etfs, nextBuys, nextSells, symbol);

  // updateExecutionDraft 读 state；这里做本地映射，避免测试污染
  let nextDrafts = (executionDrafts || []).map((item) =>
    item.id === draft.id
      ? {
          ...item,
          status: "confirmed",
          confirmed_trade_id: trade.id,
          price: trade.price,
          shares: trade.shares,
          fee: trade.fee,
          date: trade.date,
        }
      : item,
  );

  let nextPlan = plan;
  const confirmed = nextDrafts.find((item) => item.id === draft.id);
  if (confirmed?.side === "sell") {
    const withSell = bookCashReserveSell({ draft: confirmed, plan: nextPlan });
    if (withSell) nextPlan = withSell;
  }

  // settle 依赖 state.executionDrafts / state.etfs；调用方若在 UI 中应先写回 state
  return {
    etfs: nextEtfs,
    buys: nextBuys,
    sells: nextSells,
    executionDrafts: nextDrafts,
    plan: nextPlan,
    trade,
    confirmedDraft: confirmed,
  };
}

/** UI 路径：在已写入 state 后结算现金池。 */
export function settlePlanAfterDrafts({ plan, now = new Date() } = {}) {
  return settleCashReserveOnPeriodComplete({ plan, now }) || plan;
}

export { updateExecutionDraft };
