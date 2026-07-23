import { ETF_QUOTE_TTL_MS } from "../constants.js";
import { els, state } from "../state.js";
import { escapeAttr, escapeHtml, money, normalizeEtfSymbol, signed } from "../utils.js";
import { drawPriceChart } from "../chart.js";
import { setSourceStatus } from "../navigation.js";
import { persistWorkspace } from "../workspace.js";
import { registerRenderers } from "./render.js";

let quotesPromise = null;

function poolSymbols() {
  return state.etfs.map((item) => item.symbol);
}

async function refreshQuotes(force = false) {
  const symbols = poolSymbols();
  if (!symbols.length) return;
  const fresh = Date.now() - state.quotesFetchedAt < ETF_QUOTE_TTL_MS;
  if (!force && fresh && Object.keys(state.quotesBySymbol).length) return;
  if (quotesPromise) return quotesPromise;
  quotesPromise = (async () => {
    try {
      const response = await fetch(`/api/etf/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
      const payload = await response.json();
      state.quotesMeta = payload;
      if (!payload.error) {
        const map = {};
        (payload.quotes || []).forEach((quote) => {
          map[quote.symbol] = quote;
        });
        state.quotesBySymbol = map;
        state.quotesFetchedAt = Date.now();
        // 用行情名称补全池中的空名称
        state.etfs.forEach((entry) => {
          if (!entry.name && map[entry.symbol]?.name) entry.name = map[entry.symbol].name;
        });
      }
      setSourceStatus(payload.error ? `行情不可用：${payload.error}` : payload.provider || "行情已连接", payload.error ? "error" : "connected");
      if (els.etfQuoteStatus) {
        els.etfQuoteStatus.textContent = payload.error
          ? `行情不可用：${payload.error}`
          : `${payload.provider || ""} · 更新于 ${payload.updated_at || "—"}${payload.warning ? ` · ${payload.warning}` : ""}`;
      }
    } catch (error) {
      setSourceStatus(`行情不可用：${error}`, "error");
      if (els.etfQuoteStatus) els.etfQuoteStatus.textContent = `行情不可用：${error}`;
    } finally {
      quotesPromise = null;
    }
  })();
  return quotesPromise;
}

function entryMetrics(entry) {
  const quote = state.quotesBySymbol[entry.symbol];
  const price = quote?.price;
  const value = price != null && entry.shares > 0 ? price * entry.shares : null;
  const costValue = entry.shares > 0 && entry.cost > 0 ? entry.cost * entry.shares : null;
  const pnl = value != null && costValue != null ? value - costValue : null;
  const pnlPct = pnl != null && costValue ? (pnl / costValue) * 100 : null;
  return { quote, price, value, costValue, pnl, pnlPct };
}

function renderMetrics() {
  if (!els.etfMetrics) return;
  let totalValue = 0;
  let totalCost = 0;
  let held = 0;
  state.etfs.forEach((entry) => {
    const { value, costValue } = entryMetrics(entry);
    if (value != null) {
      totalValue += value;
      held += 1;
    }
    if (costValue != null) totalCost += costValue;
  });
  const pnl = totalCost ? totalValue - totalCost : null;
  const pnlPct = totalCost ? ((totalValue - totalCost) / totalCost) * 100 : null;
  const cards = [
    ["池内 ETF", `${state.etfs.length} 只`],
    ["有持仓", `${held} 只`],
    ["组合市值", totalValue ? money(totalValue) : "—"],
    ["浮盈亏", pnl != null ? `${money(pnl)}（${signed(pnlPct, 1)}%）` : "—"],
  ];
  els.etfMetrics.innerHTML = cards
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

function renderRows() {
  if (!els.etfRows) return;
  if (!state.etfs.length) {
    els.etfRows.innerHTML = "";
    if (els.etfEmpty) els.etfEmpty.hidden = false;
    return;
  }
  if (els.etfEmpty) els.etfEmpty.hidden = true;
  const totalValue = state.etfs.reduce((sum, entry) => {
    const { value } = entryMetrics(entry);
    return sum + (value || 0);
  }, 0);
  els.etfRows.innerHTML = state.etfs
    .map((entry) => {
      const { quote, price, value, pnl, pnlPct } = entryMetrics(entry);
      const change = quote?.change_pct;
      const changeClass = change > 0 ? "up" : change < 0 ? "down" : "";
      const weight = value != null && totalValue ? (value / totalValue) * 100 : null;
      const selected = state.selectedEtf === entry.symbol;
      return `
        <tr class="${selected ? "etf-row-selected" : ""}" data-symbol="${escapeAttr(entry.symbol)}">
          <td>
            <button class="link-button etf-name" data-chart="${escapeAttr(entry.symbol)}" type="button" title="查看走势">
              <strong>${escapeHtml(entry.name || quote?.name || entry.symbol)}</strong>
              <span class="muted">${escapeHtml(entry.symbol)}</span>
            </button>
          </td>
          <td class="num">${price != null ? price.toFixed(3) : "—"}</td>
          <td class="num ${changeClass}">${change != null ? `${signed(change)}%` : "—"}</td>
          <td class="num etf-input-cell">
            <input type="number" min="0" step="any" value="${entry.shares || ""}" placeholder="0" data-field="shares" data-symbol="${escapeAttr(entry.symbol)}" aria-label="持有份额" />
          </td>
          <td class="num etf-input-cell">
            <input type="number" min="0" step="any" value="${entry.cost || ""}" placeholder="0" data-field="cost" data-symbol="${escapeAttr(entry.symbol)}" aria-label="成本价" />
          </td>
          <td class="num">${value != null ? money(value) : "—"}</td>
          <td class="num ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}">${
            pnl != null ? `${money(pnl)}<br /><small>${signed(pnlPct, 1)}%</small>` : "—"
          }</td>
          <td class="num">${weight != null ? `${weight.toFixed(1)}%` : "—"}</td>
          <td class="etf-actions">
            <button class="ghost-button compact" data-chart="${escapeAttr(entry.symbol)}" type="button">走势</button>
            <button class="ghost-button compact danger" data-remove="${escapeAttr(entry.symbol)}" type="button">移除</button>
          </td>
        </tr>
      `;
    })
    .join("");

  els.etfRows.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const entry = state.etfs.find((item) => item.symbol === input.dataset.symbol);
      if (!entry) return;
      const value = Number(input.value);
      entry[input.dataset.field] = Number.isFinite(value) && value > 0 ? value : 0;
      persistWorkspace();
      renderMetrics();
      renderRows();
    });
  });
  els.etfRows.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.etfs = state.etfs.filter((item) => item.symbol !== button.dataset.remove);
      if (state.selectedEtf === button.dataset.remove) {
        state.selectedEtf = null;
        if (els.etfChartPanel) els.etfChartPanel.hidden = true;
      }
      persistWorkspace();
      renderMetrics();
      renderRows();
    });
  });
  els.etfRows.querySelectorAll("[data-chart]").forEach((button) => {
    button.addEventListener("click", () => selectEtfChart(button.dataset.chart));
  });
}

export async function selectEtfChart(symbol) {
  state.selectedEtf = symbol;
  renderRows();
  if (!els.etfChartPanel) return;
  els.etfChartPanel.hidden = false;
  const entry = state.etfs.find((item) => item.symbol === symbol);
  const quote = state.quotesBySymbol[symbol];
  if (els.etfChartTitle) {
    els.etfChartTitle.textContent = `${entry?.name || quote?.name || symbol}（${symbol}）`;
  }
  document.querySelectorAll("#etfChartPanel .js-range").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === state.priceRange);
  });
  if (els.etfChartSummary) els.etfChartSummary.textContent = "加载走势…";
  try {
    const response = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(state.priceRange)}`);
    const payload = await response.json();
    if (state.selectedEtf !== symbol) return;
    const points = payload.points || [];
    if (els.etfChartSummary) {
      if (!points.length) {
        els.etfChartSummary.textContent = payload.error ? `走势暂不可用：${payload.error}` : "暂无历史价格";
      } else {
        const first = points[0].close;
        const last = points[points.length - 1].close;
        const changePct = first ? ((last - first) / first) * 100 : 0;
        els.etfChartSummary.textContent = `${points[0].date} → ${points[points.length - 1].date} · 区间 ${signed(changePct, 1)}%${payload.provider ? ` · ${payload.provider}` : ""}`;
      }
    }
    const markers = [];
    if (entry && entry.cost > 0) markers.push({ key: "cost", label: "成本", value: entry.cost });
    drawPriceChart(els.etfChart, els.etfChartTooltip, points, markers, "CNY", payload.error);
    els.etfChartPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    if (els.etfChartSummary) els.etfChartSummary.textContent = `走势暂不可用：${error}`;
  }
}

export async function addEtf(rawSymbol, shares, cost) {
  const symbol = normalizeEtfSymbol(rawSymbol);
  if (!symbol) {
    if (els.etfFormStatus) els.etfFormStatus.textContent = "请输入 6 位 ETF 代码，例如 512890";
    return;
  }
  if (state.etfs.some((item) => item.symbol === symbol)) {
    if (els.etfFormStatus) els.etfFormStatus.textContent = `${symbol} 已在池中`;
    return;
  }
  if (els.etfFormStatus) els.etfFormStatus.textContent = `正在核验 ${symbol} 行情…`;
  try {
    const response = await fetch(`/api/etf/quotes?symbols=${encodeURIComponent(symbol)}`);
    const payload = await response.json();
    const quote = (payload.quotes || [])[0];
    if (!quote || quote.price == null) {
      throw new Error(payload.error || "行情源没有该代码，确认是 A 股场内 ETF");
    }
    state.etfs.push({
      symbol,
      name: quote.name || "",
      shares: Number(shares) > 0 ? Number(shares) : 0,
      cost: Number(cost) > 0 ? Number(cost) : 0,
      note: "",
    });
    state.quotesBySymbol[symbol] = quote;
    persistWorkspace();
    if (els.etfFormStatus) els.etfFormStatus.textContent = `已加入 ${quote.name || symbol}`;
    if (els.etfSymbol) els.etfSymbol.value = "";
    if (els.etfShares) els.etfShares.value = "";
    if (els.etfCost) els.etfCost.value = "";
    renderMetrics();
    renderRows();
  } catch (error) {
    if (els.etfFormStatus) els.etfFormStatus.textContent = `添加失败：${String(error).replace("Error: ", "")}`;
  }
}

export async function renderEtfPool({ refresh = false } = {}) {
  if (!els.etfRows) return;
  await refreshQuotes(refresh);
  renderMetrics();
  renderRows();
}

registerRenderers({ renderEtfPool });
