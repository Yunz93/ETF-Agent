import { ETF_QUOTE_TTL_MS, analysisIsFullIndex } from "../constants.js";
import { appConfig, els, state } from "../state.js";
import { escapeAttr, escapeHtml, money, normalizeEtfSymbol, signed } from "../utils.js";
import { drawPriceChart, buyEventMarkers, sellEventMarkers } from "../chart.js";
import { setSourceStatus } from "../navigation.js";
import { persistWorkspace } from "../workspace.js";
import { poolAllocationHtml } from "../pool-alloc.js";
import { upsertBuy, upsertSell } from "../workspace_model.js";
import { openAnalysis, registerRenderers } from "./render.js";
import {
  DEFAULT_STRATEGY_CONFIG,
  normalizeStrategyConfig,
  normalizeStrategyId,
  strategySummary,
} from "../strategy.js";

let quotesPromise = null;
let editingTrade = null;

function poolSymbols() {
  return state.etfs.map((item) => item.symbol);
}

function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(100, Math.round(number * 100) / 100);
}

function moveEtfRelative(fromSymbol, toSymbol, placeAfter = false) {
  if (!fromSymbol || !toSymbol || fromSymbol === toSymbol) return false;
  const from = state.etfs.findIndex((item) => item.symbol === fromSymbol);
  if (from < 0) return false;
  const [item] = state.etfs.splice(from, 1);
  let to = state.etfs.findIndex((entry) => entry.symbol === toSymbol);
  if (to < 0) {
    state.etfs.push(item);
    return true;
  }
  if (placeAfter) to += 1;
  state.etfs.splice(to, 0, item);
  return true;
}

function commitEtfOrder() {
  persistWorkspace();
  renderMetrics();
  renderRows();
  renderSidebarEtfs();
}

const dragBound = new WeakSet();

function bindDragReorder(container, { itemSelector, handleSelector = null } = {}) {
  if (!container || dragBound.has(container)) return;
  dragBound.add(container);
  let dragSymbol = null;
  let suppressClick = false;

  container.addEventListener("dragstart", (event) => {
    const handle = handleSelector ? event.target.closest(handleSelector) : event.target.closest(itemSelector);
    if (!handle || !container.contains(handle)) return;
    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    dragSymbol = item.dataset.symbol;
    if (!dragSymbol) return;
    suppressClick = false;
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragSymbol);
  });

  container.addEventListener("dragover", (event) => {
    const item = event.target.closest(itemSelector);
    if (!item || !dragSymbol || item.dataset.symbol === dragSymbol) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = item.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    container.querySelectorAll(".drag-over, .drag-over-after").forEach((node) => {
      if (node !== item) node.classList.remove("drag-over", "drag-over-after");
    });
    item.classList.toggle("drag-over", !after);
    item.classList.toggle("drag-over-after", after);
  });

  container.addEventListener("dragleave", (event) => {
    const item = event.target.closest(itemSelector);
    if (item && !item.contains(event.relatedTarget)) {
      item.classList.remove("drag-over", "drag-over-after");
    }
  });

  container.addEventListener("drop", (event) => {
    const item = event.target.closest(itemSelector);
    if (!item || !dragSymbol) return;
    event.preventDefault();
    const toSymbol = item.dataset.symbol;
    const rect = item.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + rect.height / 2;
    item.classList.remove("drag-over", "drag-over-after");
    if (moveEtfRelative(dragSymbol, toSymbol, placeAfter)) {
      suppressClick = true;
      commitEtfOrder();
    }
  });

  container.addEventListener("dragend", () => {
    container.querySelectorAll(".is-dragging, .drag-over, .drag-over-after").forEach((node) => {
      node.classList.remove("is-dragging", "drag-over", "drag-over-after");
    });
    dragSymbol = null;
  });

  container.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    },
    true,
  );
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

function portfolioTotals() {
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
  const targetSum = state.etfs.reduce((sum, entry) => sum + (Number(entry.target_weight) || 0), 0);
  return { totalValue, totalCost, held, targetSum };
}

function syncCustomStrategyForm(config) {
  const cfg = normalizeStrategyConfig(config);
  if (els.planUseRebalance) els.planUseRebalance.checked = cfg.use_rebalance !== false;
  if (els.planPeBands) {
    els.planPeBands.innerHTML = `
      <div class="plan-pe-head"><span>上限 %</span><span>倍率</span><span>名称</span></div>
      ${cfg.pe_bands
        .map(
          (band, index) => `
        <div class="plan-pe-row" data-band-index="${index}">
          <input class="js-pe-max" type="number" min="1" max="100" step="1" value="${band.max_pct}" ${
            index === cfg.pe_bands.length - 1 ? "readonly" : ""
          } aria-label="区间上限百分比" />
          <input class="js-pe-mult" type="number" min="0" max="5" step="0.1" value="${band.mult}" aria-label="定投倍率" />
          <input class="js-pe-label" type="text" maxlength="12" value="${escapeAttr(band.label)}" aria-label="区间名称" />
        </div>`,
        )
        .join("")}
    `;
  }
  if (els.planGradeMult) {
    els.planGradeMult.innerHTML = ["A", "B", "C", "D", "E"]
      .map(
        (grade) => `
        <label>
          <span>评分 ${grade}</span>
          <input class="js-grade-mult" data-grade="${grade}" type="number" min="0" max="5" step="0.1" value="${cfg.grade_mult[grade]}" />
        </label>`,
      )
      .join("");
  }
}

function readCustomStrategyConfigFromForm() {
  const pe_bands = [];
  els.planPeBands?.querySelectorAll(".plan-pe-row").forEach((row) => {
    pe_bands.push({
      max_pct: Number(row.querySelector(".js-pe-max")?.value),
      mult: Number(row.querySelector(".js-pe-mult")?.value),
      label: String(row.querySelector(".js-pe-label")?.value || "").trim(),
    });
  });
  const grade_mult = {};
  els.planGradeMult?.querySelectorAll(".js-grade-mult").forEach((input) => {
    grade_mult[input.dataset.grade] = Number(input.value);
  });
  return normalizeStrategyConfig({
    pe_bands: pe_bands.length ? pe_bands : DEFAULT_STRATEGY_CONFIG.pe_bands,
    grade_mult: Object.keys(grade_mult).length ? grade_mult : DEFAULT_STRATEGY_CONFIG.grade_mult,
    use_rebalance: els.planUseRebalance?.checked !== false,
  });
}

function syncPlanForm() {
  const plan = state.plan || {};
  if (els.planName) els.planName.value = plan.name || "";
  if (els.planAmount) els.planAmount.value = plan.amount > 0 ? plan.amount : "";
  if (els.planCadence) els.planCadence.value = plan.cadence || "monthly";
  if (els.planDay) {
    els.planDay.value = plan.day || 1;
    els.planDay.max = plan.cadence === "monthly" ? "28" : "7";
  }
  if (els.planNote) els.planNote.value = plan.note || "";
  if (els.planDayHint) {
    els.planDayHint.textContent = plan.cadence === "monthly" ? "执行日（号）" : "执行日（周几 1–7）";
  }
  const strategy = normalizeStrategyId(plan.strategy);
  if (els.planStrategy) els.planStrategy.value = strategy;
  if (els.planStrategyHint) els.planStrategyHint.textContent = strategySummary(strategy);
  if (els.planStrategyCustom) els.planStrategyCustom.hidden = strategy !== "custom";
  syncCustomStrategyForm(plan.strategy_config);
}

export function readPlanFormIntoState() {
  if (!state.plan) state.plan = {};
  const cadence = els.planCadence?.value || "monthly";
  let day = Number.parseInt(els.planDay?.value, 10);
  if (!Number.isFinite(day)) day = 1;
  if (cadence === "monthly") day = Math.min(28, Math.max(1, day));
  else day = Math.min(7, Math.max(1, day));
  const amount = Number(els.planAmount?.value);
  const strategy = normalizeStrategyId(els.planStrategy?.value);
  const previousConfig = state.plan.strategy_config;
  const strategy_config =
    strategy === "custom" ? readCustomStrategyConfigFromForm() : normalizeStrategyConfig(previousConfig);
  state.plan = {
    name: String(els.planName?.value || "").trim() || "默认定投计划",
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    cadence,
    day,
    note: String(els.planNote?.value || "").trim(),
    strategy,
    strategy_config,
  };
  if (els.planDay) {
    els.planDay.max = cadence === "monthly" ? "28" : "7";
    els.planDay.value = String(day);
  }
  if (els.planDayHint) {
    els.planDayHint.textContent = cadence === "monthly" ? "执行日（号）" : "执行日（周几 1–7）";
  }
  if (els.planStrategyHint) els.planStrategyHint.textContent = strategySummary(strategy);
  if (els.planStrategyCustom) els.planStrategyCustom.hidden = strategy !== "custom";
}

function renderMetrics() {
  if (!els.etfMetrics) return;
  const { totalValue, totalCost, held, targetSum } = portfolioTotals();
  const pnl = totalCost ? totalValue - totalCost : null;
  const pnlPct = totalCost ? ((totalValue - totalCost) / totalCost) * 100 : null;
  const targetClass = Math.abs(targetSum - 100) < 0.05 ? "" : targetSum > 100.05 ? "down" : "up";
  const cards = [
    ["计划内 ETF", `${state.etfs.length} 只 · 持仓 ${held}`],
    ["目标合计", `<span class="${targetClass}">${targetSum.toFixed(1)}%</span>`],
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
  const { totalValue } = portfolioTotals();
  els.etfRows.innerHTML = state.etfs
    .map((entry) => {
      const { quote, price, value, pnl, pnlPct } = entryMetrics(entry);
      const change = quote?.change_pct;
      const changeClass = change > 0 ? "up" : change < 0 ? "down" : "";
      const actualWeight = value != null && totalValue ? (value / totalValue) * 100 : null;
      const target = Number(entry.target_weight) || 0;
      const drift = actualWeight != null ? actualWeight - target : null;
      const driftClass = drift != null ? (drift > 0.5 ? "up" : drift < -0.5 ? "down" : "") : "";
      const selected = state.selectedEtf === entry.symbol;
      const fullIndex = analysisIsFullIndex(appConfig, entry.symbol);
      return `
        <tr class="${selected ? "etf-row-selected" : ""}" data-symbol="${escapeAttr(entry.symbol)}">
          <td class="etf-drag-cell">
            <span class="etf-drag-handle" draggable="true" title="拖动排序" aria-label="拖动排序">⋮⋮</span>
          </td>
          <td>
            <button class="link-button etf-name" data-analyze="${escapeAttr(entry.symbol)}" type="button" title="打开定投分析">
              <strong>${escapeHtml(entry.name || quote?.name || entry.symbol)}</strong>
              <span class="muted">${escapeHtml(entry.symbol)}${fullIndex ? "" : " · ETF 口径"}</span>
            </button>
          </td>
          <td class="num">${price != null ? price.toFixed(3) : "—"}</td>
          <td class="num ${changeClass}">${change != null ? `${signed(change)}%` : "—"}</td>
          <td class="num etf-input-cell">
            <input type="number" min="0" max="100" step="any" value="${target || ""}" placeholder="0" data-field="target_weight" data-symbol="${escapeAttr(entry.symbol)}" aria-label="目标仓位" />
          </td>
          <td class="num">${actualWeight != null ? `${actualWeight.toFixed(1)}%` : "—"}</td>
          <td class="num ${driftClass}">${drift != null ? `${signed(drift, 1)}` : "—"}</td>
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
          <td class="etf-actions">
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
      if (input.dataset.field === "target_weight") {
        entry.target_weight = clampWeight(value);
        input.value = entry.target_weight || "";
      } else {
        entry[input.dataset.field] = Number.isFinite(value) && value > 0 ? value : 0;
      }
      persistWorkspace();
      renderMetrics();
      renderRows();
      renderSidebarEtfs();
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
      renderSidebarEtfs();
    });
  });
  els.etfRows.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", () => openAnalysis(button.dataset.analyze));
  });
  bindDragReorder(els.etfRows, {
    itemSelector: "tr[data-symbol]",
    handleSelector: ".etf-drag-handle",
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
    markers.push(
      ...buyEventMarkers(
        (state.buys || []).filter((item) => item.symbol === symbol),
        { useBuyPrice: true },
      ),
      ...sellEventMarkers(
        (state.sells || []).filter((item) => item.symbol === symbol),
        { useSellPrice: true },
      ),
    );
    drawPriceChart(els.etfChart, els.etfChartTooltip, points, markers, "CNY", payload.error);
    els.etfChartPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    if (els.etfChartSummary) els.etfChartSummary.textContent = `走势暂不可用：${error}`;
  }
}

export async function addEtf(rawSymbol, shares, cost, targetWeight) {
  const symbol = normalizeEtfSymbol(rawSymbol);
  if (!symbol) {
    if (els.etfFormStatus) els.etfFormStatus.textContent = "请输入 6 位 ETF 代码，例如 512890";
    return;
  }
  if (state.etfs.some((item) => item.symbol === symbol)) {
    if (els.etfFormStatus) els.etfFormStatus.textContent = `${symbol} 已在计划中`;
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
      target_weight: clampWeight(targetWeight),
      note: "",
    });
    state.quotesBySymbol[symbol] = quote;
    persistWorkspace();
    if (els.etfFormStatus) els.etfFormStatus.textContent = `已加入 ${quote.name || symbol}`;
    if (els.etfSymbol) els.etfSymbol.value = "";
    if (els.etfShares) els.etfShares.value = "";
    if (els.etfCost) els.etfCost.value = "";
    if (els.etfTargetWeight) els.etfTargetWeight.value = "";
    renderMetrics();
    renderRows();
    renderBuys();
    renderSidebarEtfs();
  } catch (error) {
    if (els.etfFormStatus) els.etfFormStatus.textContent = `添加失败：${String(error).replace("Error: ", "")}`;
  }
}

function renderPoolAllocation() {
  if (!els.poolAllocPanel) return;
  els.poolAllocPanel.innerHTML = poolAllocationHtml({ clickable: true });
  els.poolAllocPanel.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", () => openAnalysis(button.dataset.analyze));
  });
}

function renderBuySymbolOptions() {
  if (!els.buySymbol && !els.buyFilterSymbol) return;
  const current = els.buySymbol?.value || "";
  const currentFilter = els.buyFilterSymbol?.value || "";
  const options = state.etfs
    .map((entry) => {
      const quote = state.quotesBySymbol[entry.symbol];
      const name = entry.name || quote?.name || entry.symbol;
      return `<option value="${escapeAttr(entry.symbol)}">${escapeHtml(name)}（${escapeHtml(entry.symbol)}）</option>`;
    })
    .join("");
  if (els.buySymbol) {
    els.buySymbol.innerHTML = `<option value="">选择品种</option>${options}`;
    if (current && state.etfs.some((item) => item.symbol === current)) {
      els.buySymbol.value = current;
    }
  }
  if (els.buyFilterSymbol) {
    els.buyFilterSymbol.innerHTML = `<option value="">全部 ETF</option>${options}`;
    if (currentFilter && state.etfs.some((item) => item.symbol === currentFilter)) {
      els.buyFilterSymbol.value = currentFilter;
    }
  }
}

export function renderBuys() {
  if (!els.buyRows) return;
  renderBuySymbolOptions();
  const trades = [
    ...(state.buys || []).map((item) => ({ ...item, type: "buy" })),
    ...(state.sells || []).map((item) => ({ ...item, type: "sell" })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  const filterSymbol = els.buyFilterSymbol?.value || "";
  const filterType = els.buyFilterType?.value || "";
  const filteredTrades = trades.filter(
    (trade) => (!filterSymbol || trade.symbol === filterSymbol) && (!filterType || trade.type === filterType),
  );
  if (els.buyFilterCount) {
    const filtered = Boolean(filterSymbol || filterType);
    els.buyFilterCount.textContent = filtered ? `显示 ${filteredTrades.length} / 共 ${trades.length} 笔` : `共 ${trades.length} 笔`;
  }
  if (els.buyEmpty) {
    els.buyEmpty.hidden = filteredTrades.length > 0;
    els.buyEmpty.textContent = filterSymbol || filterType ? "当前筛选条件下暂无交易记录。" : "暂无交易记录。";
  }
  if (!filteredTrades.length) {
    els.buyRows.innerHTML = "";
    return;
  }
  els.buyRows.innerHTML = filteredTrades
    .map((trade) => {
      const entry = state.etfs.find((item) => item.symbol === trade.symbol);
      const quote = state.quotesBySymbol[trade.symbol];
      const name = entry?.name || quote?.name || trade.symbol;
      const amount = trade.price * trade.shares;
      const editing = editingTrade?.id === trade.id && editingTrade?.type === trade.type;
      return `
        <tr data-trade-id="${escapeAttr(trade.id)}" class="${editing ? "is-editing" : ""}">
          <td>${escapeHtml(trade.date)}</td>
          <td><span class="trade-type ${trade.type}">${trade.type === "sell" ? "卖出" : "买入"}</span></td>
          <td>
            <button class="link-button etf-name" data-analyze="${escapeAttr(trade.symbol)}" type="button">${escapeHtml(name)}</button>
            <span class="muted"> ${escapeHtml(trade.symbol)}</span>
          </td>
          <td class="num">${money(trade.price)}</td>
          <td class="num">${trade.shares}</td>
          <td class="num">${money(amount)}</td>
          <td>${escapeHtml(trade.note || "—")}</td>
          <td class="num">
            <span class="buy-row-actions">
              <button class="ghost-button compact" type="button" data-edit-trade="${escapeAttr(trade.id)}" data-trade-type="${trade.type}">修改</button>
              <button class="ghost-button compact danger" type="button" data-remove-trade="${escapeAttr(trade.id)}" data-trade-type="${trade.type}">删除</button>
            </span>
          </td>
        </tr>
      `;
    })
    .join("");

  els.buyRows.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", () => openAnalysis(button.dataset.analyze));
  });
  els.buyRows.querySelectorAll("[data-edit-trade]").forEach((button) => {
    button.addEventListener("click", () => startBuyEdit(button.dataset.tradeType, button.dataset.editTrade));
  });
  els.buyRows.querySelectorAll("[data-remove-trade]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.tradeType;
      const id = button.dataset.removeTrade;
      if (editingTrade?.id === id && editingTrade?.type === type) cancelBuyEdit();
      if (type === "sell") state.sells = (state.sells || []).filter((item) => item.id !== id);
      else state.buys = (state.buys || []).filter((item) => item.id !== id);
      persistWorkspace();
      renderBuys();
      if (state.selectedEtf) selectEtfChart(state.selectedEtf);
      if (els.buyFormStatus) els.buyFormStatus.textContent = `已删除${type === "sell" ? "卖出" : "买入"}记录`;
    });
  });
}

function startBuyEdit(type, id) {
  const collection = type === "sell" ? state.sells : state.buys;
  const trade = (collection || []).find((item) => item.id === id);
  if (!trade) return;
  editingTrade = { id: trade.id, type };
  if (els.tradeType) els.tradeType.value = type;
  if (els.buySymbol) els.buySymbol.value = trade.symbol;
  if (els.buyDate) els.buyDate.value = trade.date;
  if (els.buyPrice) els.buyPrice.value = String(trade.price);
  if (els.buyShares) els.buyShares.value = String(trade.shares);
  if (els.buyNote) els.buyNote.value = trade.note || "";
  if (els.buySubmit) els.buySubmit.textContent = "保存修改";
  if (els.buyCancelEdit) els.buyCancelEdit.hidden = false;
  if (els.buyFormStatus) els.buyFormStatus.textContent = `正在修改 ${trade.symbol} ${trade.date} 的${type === "sell" ? "卖出" : "买入"}记录`;
  renderBuys();
  els.buyForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function cancelBuyEdit() {
  editingTrade = null;
  if (els.buySubmit) els.buySubmit.textContent = els.tradeType?.value === "sell" ? "添加卖出" : "添加买入";
  if (els.buyCancelEdit) els.buyCancelEdit.hidden = true;
  if (els.buyPrice) els.buyPrice.value = "";
  if (els.buyShares) els.buyShares.value = "";
  if (els.buyNote) els.buyNote.value = "";
  if (els.buyFormStatus) els.buyFormStatus.textContent = "";
  renderBuys();
}

function newTradeId(type, symbol, date) {
  return `${type}_${symbol}_${date}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function addBuyRecord() {
  const type = els.tradeType?.value === "sell" ? "sell" : "buy";
  const symbol = String(els.buySymbol?.value || "").trim();
  const date = String(els.buyDate?.value || "").trim();
  const price = Number(els.buyPrice?.value);
  const shares = Number(els.buyShares?.value);
  const note = String(els.buyNote?.value || "").trim();
  if (!symbol) {
    if (els.buyFormStatus) els.buyFormStatus.textContent = "请选择 ETF";
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (els.buyFormStatus) els.buyFormStatus.textContent = "请填写交易日期";
    return;
  }
  if (!(price > 0) || !(shares > 0)) {
    if (els.buyFormStatus) els.buyFormStatus.textContent = "成交价与份额需大于 0";
    return;
  }
  if (!state.etfs.some((item) => item.symbol === symbol)) {
    if (els.buyFormStatus) els.buyFormStatus.textContent = "该 ETF 不在计划中";
    return;
  }
  const wasEditing = Boolean(editingTrade);
  if (editingTrade) {
    if (editingTrade.type === "sell") state.sells = state.sells.filter((item) => item.id !== editingTrade.id);
    else state.buys = state.buys.filter((item) => item.id !== editingTrade.id);
  }
  const record = {
    id: editingTrade?.id || newTradeId(type, symbol, date),
    symbol,
    date,
    price,
    shares,
    note,
  };
  if (type === "sell") state.sells = upsertSell(state.sells, record);
  else state.buys = upsertBuy(state.buys, record);
  editingTrade = null;
  persistWorkspace();
  if (els.buySubmit) els.buySubmit.textContent = type === "sell" ? "添加卖出" : "添加买入";
  if (els.buyCancelEdit) els.buyCancelEdit.hidden = true;
  if (els.buyPrice) els.buyPrice.value = "";
  if (els.buyShares) els.buyShares.value = "";
  if (els.buyNote) els.buyNote.value = "";
  renderBuys();
  if (state.selectedEtf) selectEtfChart(state.selectedEtf);
  if (els.buyFormStatus) {
    const label = type === "sell" ? "卖出" : "买入";
    els.buyFormStatus.textContent = wasEditing ? `已更新 ${symbol} ${date} 的${label}记录` : `已记录 ${symbol} ${date} ${label}`;
  }
}

export async function renderEtfPool({ refresh = false } = {}) {
  if (!els.etfRows) return;
  syncPlanForm();
  await refreshQuotes(refresh);
  renderMetrics();
  renderPoolAllocation();
  renderRows();
  renderBuys();
  renderSidebarEtfs();
}

export function renderSidebarEtfs() {
  if (!els.sidebarEtfList) return;
  if (els.sidebarPoolCount) els.sidebarPoolCount.textContent = String(state.etfs.length);
  if (!state.etfs.length) {
    els.sidebarEtfList.innerHTML = `<p class="sidebar-etf-empty muted">计划为空，去「定投计划」添加</p>`;
    return;
  }
  const activeSymbol = state.analysisSymbol;
  els.sidebarEtfList.innerHTML = state.etfs
    .map((entry) => {
      const quote = state.quotesBySymbol[entry.symbol];
      const name = entry.name || quote?.name || entry.symbol;
      const change = quote?.change_pct;
      const changeClass = change > 0 ? "up" : change < 0 ? "down" : "";
      const active = activeSymbol === entry.symbol ? " active" : "";
      const fullIndex = analysisIsFullIndex(appConfig, entry.symbol);
      const target = Number(entry.target_weight) || 0;
      return `
        <div class="sidebar-etf-item${active}" data-symbol="${escapeAttr(entry.symbol)}">
          <span class="sidebar-etf-handle" draggable="true" title="拖动排序" aria-label="拖动排序">⋮⋮</span>
          <button
            class="sidebar-etf-button"
            type="button"
            data-analyze="${escapeAttr(entry.symbol)}"
            title="${escapeAttr(name)}（${escapeAttr(entry.symbol)}）${target ? ` · 目标 ${target}%` : ""}${fullIndex ? "" : " · ETF 口径分析"}"
          >
            <span class="sidebar-etf-mark" aria-hidden="true">${escapeHtml(entry.symbol.slice(-3))}</span>
            <span class="sidebar-etf-name">
              <strong>${escapeHtml(name)}</strong>
              <em>${escapeHtml(entry.symbol)}${target ? ` · ${target}%` : ""}</em>
            </span>
            <span class="sidebar-etf-meta ${changeClass}">
              ${change != null ? `${signed(change)}%` : "—"}
            </span>
          </button>
        </div>
      `;
    })
    .join("");

  els.sidebarEtfList.querySelectorAll("[data-analyze]").forEach((button) => {
    button.addEventListener("click", () => openAnalysis(button.dataset.analyze));
  });
  bindDragReorder(els.sidebarEtfList, {
    itemSelector: ".sidebar-etf-item[data-symbol]",
    handleSelector: ".sidebar-etf-handle",
  });
}

registerRenderers({ renderEtfPool, renderSidebarEtfs });
