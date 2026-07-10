import { DECISION_LABELS, GROUP_LABELS } from "../constants.js";
import { els, provider, state } from "../state.js";
import { daysUntil, formatNextEarnings, watchAlertLevel, watchAlertText } from "../analysis.js";
import { escapeHtml, findStock, marketLabel, money, normalizeClientSymbol, signed, stockKey } from "../utils.js";
import { saveWatchlist } from "../workspace.js";
import { evaluateAlerts, registerRenderers, renderDetail, renderWorkbench, selectStock } from "./render.js";

export function renderWatchlist() {
  if (!els.watchlistRows) return;
  const showTargets = Boolean(state.prefs.showWatchTargets);
  document.querySelector("#watchTable")?.classList.toggle("show-targets", showTargets);
  if (els.watchShowTargets) els.watchShowTargets.checked = showTargets;

  let items = Object.values(state.watchlist)
    .map((saved) => {
      const stock = findStock(saved.symbol, saved.market);
      return stock ? { stock, saved } : null;
    })
    .filter(Boolean);

  if (state.watchGroupFilter !== "all") {
    items = items.filter(({ saved }) => (saved.group || "watch") === state.watchGroupFilter);
  }
  if (state.watchAlertFilter === "hit") {
    items = items.filter(({ stock, saved }) => watchAlertLevel(stock, saved) === "hit");
  } else if (state.watchAlertFilter === "near") {
    items = items.filter(({ stock, saved }) => ["hit", "near"].includes(watchAlertLevel(stock, saved)));
  }

  items.sort((a, b) => {
    const rank = { hit: 0, near: 1, calm: 2 };
    const diff = rank[watchAlertLevel(a.stock, a.saved)] - rank[watchAlertLevel(b.stock, b.saved)];
    if (diff !== 0) return diff;
    return (b.stock.quote.change_pct || 0) - (a.stock.quote.change_pct || 0);
  });

  if (!Object.keys(state.watchlist).length) {
    els.watchlistRows.innerHTML = "";
    if (els.watchlistEmpty) els.watchlistEmpty.hidden = false;
    return;
  }
  if (els.watchlistEmpty) els.watchlistEmpty.hidden = true;
  if (!items.length) {
    els.watchlistRows.innerHTML = `<tr><td colspan="11"><div class="empty-state">当前筛选下没有自选。</div></td></tr>`;
    return;
  }

  els.watchlistRows.innerHTML = items
    .map(({ stock, saved }) => {
      const level = watchAlertLevel(stock, saved);
      const alert = watchAlertText(stock, saved);
      const note = state.notes[stockKey(stock)] || {};
      const decision = DECISION_LABELS[note.decision] || "观望";
      return `
        <tr class="watch-row ${level === "hit" ? "hit" : ""}" data-key="${stockKey(stock)}">
          <td>
            <button class="linkish" data-open="${stockKey(stock)}" type="button">
              <strong>${escapeHtml(stock.name)}</strong>
              <span class="muted">${stock.symbol} · ${marketLabel(stock.market)}${stock.industry ? ` · ${escapeHtml(stock.industry)}` : ""}</span>
            </button>
          </td>
          <td>
            <select data-group="${stockKey(stock)}">
              ${Object.entries(GROUP_LABELS)
                .map(([value, label]) => `<option value="${value}" ${ (saved.group || "watch") === value ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </td>
          <td class="num">${money(stock.quote.price, stock.currency)}</td>
          <td class="num ${stock.quote.change_pct >= 0 ? "up" : "down"}">${signed(stock.quote.change_pct)}%</td>
          <td><span class="tag calm">${escapeHtml(decision)}</span></td>
          <td><span class="tag ${level}">${escapeHtml(alert)}</span></td>
          <td class="num watch-extra"><input data-field="buy" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.buy ?? ""}" /></td>
          <td class="num watch-extra"><input data-field="add" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.add ?? ""}" /></td>
          <td class="num watch-extra"><input data-field="takeProfit" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.takeProfit ?? ""}" /></td>
          <td class="num watch-extra"><input data-field="stopLoss" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.stopLoss ?? ""}" /></td>
          <td><button class="ghost-button compact" data-remove="${stockKey(stock)}" type="button">移除</button></td>
        </tr>
      `;
    })
    .join("");

  els.watchlistRows.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
  els.watchlistRows.querySelectorAll("[data-group]").forEach((select) => {
    select.addEventListener("change", () => {
      state.watchlist[select.dataset.group].group = select.value;
      saveWatchlist();
      renderWatchlist();
      renderWorkbench();
    });
  });
  els.watchlistRows.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const field = input.dataset.field;
      const value = input.value === "" ? null : Number(input.value);
      state.watchlist[key][field] = value;
      if (field === "buy") state.watchlist[key].targetPrice = value;
      saveWatchlist();
      renderWatchlist();
      renderWorkbench();
      evaluateAlerts({ notify: state.prefs.notify });
    });
  });
  els.watchlistRows.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.watchlist[button.dataset.remove];
      saveWatchlist();
      renderWatchlist();
      renderWorkbench();
      renderDetail();
    });
  });
}
export function toggleWatch(stock) {
  const key = stockKey(stock);
  if (state.watchlist[key]) {
    delete state.watchlist[key];
  } else {
    state.watchlist[key] = createWatchlistEntry(stock);
  }
  saveWatchlist();
  renderDetail();
  renderWatchlist();
  renderWorkbench();
}

export function parseWatchlistTokens(raw, defaultMarket) {
  return String(raw || "")
    .split(/[\s,;，；\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const prefixed = token.match(/^(A|HK|US)[:：\-/]?(.+)$/i);
      if (prefixed) {
        return {
          market: prefixed[1].toUpperCase(),
          symbol: normalizeClientSymbol(prefixed[2], prefixed[1].toUpperCase()),
        };
      }
      return {
        market: defaultMarket,
        symbol: normalizeClientSymbol(token, defaultMarket),
      };
    })
    .filter((item) => item.symbol)
    .slice(0, 40);
}

export function createWatchlistEntry(stock, group = "watch") {
  return {
    symbol: stock.symbol,
    market: stock.market,
    group,
    buy: stock.valuation.watch_zone[1],
    add: stock.valuation.watch_zone[0],
    takeProfit: stock.valuation.bull_price,
    stopLoss: stock.valuation.bear_price,
    targetPrice: stock.valuation.watch_zone[1],
    createdAt: new Date().toISOString(),
  };
}

export async function addSymbolToWatchlist(market, rawSymbol) {
  return addSymbolsToWatchlist(market, rawSymbol);
}

export async function addSymbolsToWatchlist(market, rawInput) {
  if (!els.addSymbolStatus) return;
  const tokens = parseWatchlistTokens(rawInput, market);
  if (!tokens.length) {
    els.addSymbolStatus.textContent = "请输入至少一个代码。";
    return;
  }
  els.addSymbolStatus.textContent = tokens.length > 1 ? `批量查询 ${tokens.length} 只…` : "查询中…";
  const added = [];
  const existed = [];
  const failed = [];
  for (const token of tokens) {
    try {
      const stock = await provider.ensureStock(token.symbol, token.market);
      if (!stock) {
        failed.push(`${token.market}:${token.symbol}`);
        continue;
      }
      const key = stockKey(stock);
      if (state.watchlist[key]) {
        existed.push(stock.name);
        continue;
      }
      state.watchlist[key] = createWatchlistEntry(stock);
      added.push(stock.name);
    } catch {
      failed.push(`${token.market}:${token.symbol}`);
    }
  }
  if (added.length) saveWatchlist();
  if (els.addSymbol) els.addSymbol.value = "";
  const parts = [];
  if (added.length) parts.push(`新加入 ${added.length} 只`);
  if (existed.length) parts.push(`已在自选 ${existed.length} 只`);
  if (failed.length) parts.push(`失败 ${failed.length} 只`);
  els.addSymbolStatus.textContent = parts.join(" · ") || "未加入任何标的";
  if (failed.length && failed.length <= 5) {
    els.addSymbolStatus.textContent += `（${failed.join(", ")}）`;
  }
  renderWatchlist();
  renderWorkbench();
  evaluateAlerts({ notify: false });
}

registerRenderers({ renderWatchlist, toggleWatch });
