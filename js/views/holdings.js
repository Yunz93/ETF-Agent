import { els, provider, state } from "../state.js";
import { money, signed, stockKey, toBase, marketLabel, normalizeClientSymbol } from "../utils.js";
import { persistWorkspace } from "../workspace.js";
import { registerRenderers, renderWatchlist, renderWorkbench, selectStock } from "./render.js";

export function renderHoldings() {
  if (!els.holdingsRows) return;
  const base = state.prefs.baseCurrency || "CNY";
  const rows = Object.values(state.holdings)
    .map((holding) => {
      const stock = provider.stocks.find((item) => item.symbol === holding.symbol && item.market === holding.market);
      if (!stock) return null;
      const marketValue = holding.shares * stock.quote.price;
      const costValue = holding.shares * holding.cost;
      const pnl = marketValue - costValue;
      const pnlPct = costValue ? (pnl / costValue) * 100 : 0;
      const marketValueBase = toBase(marketValue, stock.currency, base);
      const fair = stock.valuation.base_price;
      const vsFair = fair ? ((stock.quote.price - fair) / fair) * 100 : null;
      return { stock, holding, marketValue, costValue, pnl, pnlPct, marketValueBase, vsFair };
    })
    .filter(Boolean);

  const totalBase = rows.reduce((sum, row) => sum + row.marketValueBase, 0);
  const totalPnlBase = rows.reduce((sum, row) => sum + toBase(row.pnl, row.stock.currency, base), 0);

  if (els.holdingsMetrics) {
    els.holdingsMetrics.innerHTML = [
      ["持仓市值", money(totalBase, base)],
      ["浮盈亏", `${money(totalPnlBase, base)}`],
      ["持仓只数", `${rows.length}`],
      ["本位币", base],
    ]
      .map(
        ([label, value]) => `
          <div class="metric-card">
            <span>${label}</span>
            <strong>${value}</strong>
          </div>
        `,
      )
      .join("");
  }

  if (!Object.keys(state.holdings).length) {
    els.holdingsRows.innerHTML = "";
    if (els.holdingsEmpty) els.holdingsEmpty.hidden = false;
    return;
  }
  if (els.holdingsEmpty) els.holdingsEmpty.hidden = true;
  if (!rows.length) {
    els.holdingsRows.innerHTML = `<tr><td colspan="9"><div class="empty-state">持仓标的暂无行情，请确认代码或网络。</div></td></tr>`;
    return;
  }

  els.holdingsRows.innerHTML = rows
    .map(({ stock, holding, marketValue, pnl, pnlPct, marketValueBase, vsFair }) => {
      const weight = totalBase ? (marketValueBase / totalBase) * 100 : 0;
      return `
        <tr>
          <td>
            <button class="linkish" data-open="${stockKey(stock)}" type="button">
              <strong>${escapeHtml(stock.name)}</strong>
              <span class="muted">${stock.symbol} · ${marketLabel(stock.market)}</span>
            </button>
          </td>
          <td class="num"><input data-holding-field="shares" data-key="${stockKey(stock)}" type="number" step="any" value="${holding.shares}" /></td>
          <td class="num"><input data-holding-field="cost" data-key="${stockKey(stock)}" type="number" step="any" value="${holding.cost}" /></td>
          <td class="num">${money(stock.quote.price, stock.currency)}</td>
          <td class="num">${money(marketValue, stock.currency)}</td>
          <td class="num ${pnl >= 0 ? "up" : "down"}">${money(pnl, stock.currency)} (${signed(pnlPct)}%)</td>
          <td class="num">${weight.toFixed(1)}%</td>
          <td class="num ${vsFair == null ? "" : vsFair <= 0 ? "up" : "down"}">${vsFair == null ? "—" : `${signed(vsFair)}%`}</td>
          <td><button class="ghost-button compact" data-remove-holding="${stockKey(stock)}" type="button">删除</button></td>
        </tr>
      `;
    })
    .join("");

  els.holdingsRows.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
  els.holdingsRows.querySelectorAll("[data-holding-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const field = input.dataset.holdingField;
      state.holdings[key][field] = Number(input.value);
      persistWorkspace();
      renderHoldings();
      renderWorkbench();
    });
  });
  els.holdingsRows.querySelectorAll("[data-remove-holding]").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.holdings[button.dataset.removeHolding];
      persistWorkspace();
      renderHoldings();
      renderWorkbench();
    });
  });
}
export async function upsertHolding({ market, symbol, shares, cost }) {
  if (!els.holdingFormStatus) return;
  els.holdingFormStatus.textContent = "保存中…";
  const normalized = normalizeClientSymbol(symbol, market);
  const stock = await provider.ensureStock(normalized, market);
  if (!stock) {
    els.holdingFormStatus.textContent = "未找到行情，无法保存持仓。";
    return;
  }
  const key = stockKey(stock);
  state.holdings[key] = {
    symbol: stock.symbol,
    market: stock.market,
    shares,
    cost,
    updatedAt: new Date().toISOString(),
  };
  if (!state.watchlist[key]) {
    state.watchlist[key] = createWatchlistEntry(stock, "core");
  }
  persistWorkspace();
  els.holdingSymbol.value = "";
  els.holdingShares.value = "";
  els.holdingCost.value = "";
  els.holdingFormStatus.textContent = `已保存 ${stock.name}`;
  renderHoldings();
  renderWatchlist();
  renderWorkbench();
}

registerRenderers({ renderHoldings });
