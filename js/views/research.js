import { RESEARCH_INDICES } from "../constants.js";
import { els, provider, state } from "../state.js";
import { daysUntil, formatMarginOfSafety, marginOfSafety, week52Stats } from "../analysis.js";
import { escapeHtml, marketLabel, money, sameStock, signed, stockKey, valuationLabel } from "../utils.js";
import { evaluateAlerts, renderHoldings, renderSourceStatus, renderWatchlist, renderWorkbench, selectStock, registerRenderers } from "./render.js";

export function renderIndexSegment() {
  if (!els.indexSegment) return;
  els.indexSegment.innerHTML = RESEARCH_INDICES.map(
    (item) => `
      <button class="segment-button ${state.index === item.code ? "active" : ""}" data-index="${item.code}" type="button">
        ${item.name}
      </button>
    `,
  ).join("");
  els.indexSegment.querySelectorAll("[data-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.index === button.dataset.index) return;
      state.index = button.dataset.index;
      state.market = provider.indexMeta(state.index)?.market || state.market;
      state.page = 1;
      renderIndexSegment();
      await refreshStocks({ resetQuotes: true });
    });
  });
}

export function renderResearchLoadStatus() {
  if (!els.researchLoadStatus) return;
  const progress = provider.quoteState(state.index);
  const meta = provider.catalogMeta[state.index] || provider.indexMeta(state.index) || {};
  const name = meta.index_name || meta.name || state.index;
  const loaded = progress.loaded || 0;
  const total = progress.total || meta.count || 0;
  els.researchLoadStatus.classList.toggle("is-loading", Boolean(progress.loading));
  if (progress.loading) {
    els.researchLoadStatus.innerHTML = `${name}加载中… 已获取 ${loaded}/${total || "?"} 只行情`;
    return;
  }
  if (progress.error && !loaded) {
    els.researchLoadStatus.textContent = `${name}行情不可用：${progress.error}`;
    return;
  }
  const moreButton = progress.hasMore
    ? `<span class="research-load-actions"><button class="ghost-button compact" id="loadMoreQuotes" type="button">继续加载下一批</button></span>`
    : "";
  els.researchLoadStatus.innerHTML = `${name} · 行情 ${loaded}/${total}${progress.provider ? ` · ${progress.provider}` : ""}${moreButton}`;
  els.researchLoadStatus.querySelector("#loadMoreQuotes")?.addEventListener("click", async () => {
    await refreshStocks({ loadMore: true });
  });
}

export async function refreshStocks({ resetQuotes = false, loadMore = false } = {}) {
  renderIndexSegment();
  if (resetQuotes) {
    await provider.hydrateQuotes(state.index, { reset: true });
  } else if (loadMore) {
    await provider.hydrateQuotes(state.index, { more: true });
  }
  state.filtered = await provider.search({
    query: els.searchInput?.value || "",
    index: state.index,
    industry: els.industryFilter?.value || "all",
    valuation: els.valuationFilter?.value || "all",
  });
  state.filtered.sort((a, b) => marginOfSafety(b) - marginOfSafety(a));
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize) || 1);
  if (state.page > totalPages) state.page = totalPages;
  fillIndustryFilter();
  renderSourceStatus();
  renderMetrics();
  renderResearchLoadStatus();
  renderUpcoming();
  renderRows();
  renderPager();
  renderWorkbench();
  renderWatchlist();
  renderHoldings();
  renderCompare();
  evaluateAlerts({ notify: state.prefs.notify });
  if (!state.selected || !provider.stocks.some((stock) => sameStock(stock, state.selected))) {
    selectStock(state.filtered[0] || provider.stocks[0] || null, { openDetail: false });
  }
}

export function fillIndustryFilter() {
  if (!els.industryFilter) return;
  const current = els.industryFilter.value || "all";
  const pool = provider.stocksByIndex[state.index] || [];
  const industries = [...new Set(pool.map((stock) => stock.industry).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  els.industryFilter.innerHTML = `<option value="all">全部行业</option>`;
  industries.forEach((industry) => {
    const option = document.createElement("option");
    option.value = industry;
    option.textContent = industry;
    els.industryFilter.append(option);
  });
  els.industryFilter.value = industries.includes(current) ? current : "all";
}

export function renderMetrics() {
  if (!els.marketMetrics) return;
  const total = state.filtered.length;
  const undervalued = state.filtered.filter((stock) => stock.valuation.state === "undervalued").length;
  const highRisk = state.filtered.filter((stock) => stock.valuation.state === "risk" || stock.analysis.risks.length >= 3).length;
  const progress = provider.quoteState(state.index);
  const catalogCount = provider.catalogMeta[state.index]?.count || progress.total || total;
  const metrics = [
    ["指数成分", `${catalogCount} 只`],
    ["已加载行情", `${progress.loaded || 0} 只`],
    ["当前筛选", `${total} 只`],
    ["低估 / 风险", `${undervalued} / ${highRisk}`],
  ];
  els.marketMetrics.innerHTML = metrics
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

export function renderUpcoming() {
  if (!els.upcomingPanel) return;
  const items = state.filtered
    .map((stock) => ({
      stock,
      date: stock.quote.earnings_date,
      days: daysUntil(stock.quote.earnings_date),
    }))
    .filter((item) => item.date && item.days >= 0 && item.days <= 45)
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);

  if (!items.length) {
    els.upcomingPanel.hidden = true;
    els.upcomingPanel.innerHTML = "";
    return;
  }

  els.upcomingPanel.hidden = false;
  els.upcomingPanel.innerHTML = `
    <div class="upcoming-heading">
      <h3>近期财报</h3>
      <span class="muted">45 天内</span>
    </div>
    <ul class="upcoming-list">
      ${items
        .map(
          ({ stock, date, days }) => `
            <li>
              <button class="upcoming-item" data-symbol="${stock.symbol}" data-market="${stock.market}" type="button">
                <strong>${escapeHtml(stock.name)}</strong>
                <span>${date} · ${days === 0 ? "今天" : `${days} 天后`}</span>
              </button>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;

  els.upcomingPanel.querySelectorAll(".upcoming-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const stock = await provider.getStock(button.dataset.symbol, button.dataset.market);
      selectStock(stock, { openDetail: true });
    });
  });
}

export function pagedStocks() {
  const start = (state.page - 1) * state.pageSize;
  return state.filtered.slice(start, start + state.pageSize);
}

export function renderPager() {
  if (!els.listPager) return;
  const total = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize) || 1);
  if (!total) {
    els.listPager.hidden = true;
    els.listPager.innerHTML = "";
    return;
  }
  els.listPager.hidden = false;
  const startIdx = (state.page - 1) * state.pageSize + 1;
  const endIdx = Math.min(total, state.page * state.pageSize);
  els.listPager.innerHTML = `
    <button type="button" class="ghost-button compact" data-page-action="prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pager-status">第 ${state.page}/${totalPages} 页 · 显示 ${startIdx}-${endIdx} / ${total}</span>
    <button type="button" class="ghost-button compact" data-page-action="next" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>
  `;
  els.listPager.querySelectorAll("[data-page-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.pageAction === "prev" && state.page > 1) state.page -= 1;
      if (button.dataset.pageAction === "next" && state.page < totalPages) state.page += 1;
      renderRows();
      renderPager();
    });
  });
}

export function renderRows() {
  if (!els.stockRows) return;
  if (els.researchEmptyHint) {
    els.researchEmptyHint.hidden = Boolean(state.filtered.length || state.compare.length);
  }
  if (!state.filtered.length) {
    els.stockRows.innerHTML = `<tr><td colspan="10"><div class="empty-state">暂无行情数据。请运行 python3 server.py 并确认网络可用。</div></td></tr>`;
    renderPager();
    return;
  }
  const rows = pagedStocks();
  els.stockRows.innerHTML = rows
    .map((stock) => {
      const selected = state.selected && sameStock(stock, state.selected) ? "active" : "";
      const mos = marginOfSafety(stock);
      const w52 = week52Stats(stock);
      const mosClass = mos >= 0 ? "up" : "down";
      const compared = state.compare.some((item) => sameStock(item, stock));
      const indexText = (stock.indices || []).join(" / ");
      return `
        <tr class="stock-row ${selected}" data-symbol="${stock.symbol}" data-market="${stock.market}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <td>
            <input type="checkbox" class="compare-check" data-compare="${stockKey(stock)}" ${compared ? "checked" : ""} aria-label="加入对比" />
          </td>
          <td>
            <div class="stock-id">
              <strong>${escapeHtml(stock.name)}</strong>
              <span>${stock.symbol} · ${escapeHtml(stock.englishName)}${indexText ? ` · ${escapeHtml(indexText)}` : ""}</span>
            </div>
          </td>
          <td>${marketLabel(stock.market)}</td>
          <td>${escapeHtml(stock.industry)}</td>
          <td class="num">${money(stock.quote.price, stock.currency)}</td>
          <td class="num ${stock.quote.change_pct >= 0 ? "up" : "down"}">${signed(stock.quote.change_pct)}%</td>
          <td class="num">${stock.quote.pe ? stock.quote.pe.toFixed(1) : "—"}</td>
          <td class="num ${mosClass}">${formatMarginOfSafety(mos)}</td>
          <td class="num muted">${w52 ? `-${w52.fromHigh}%` : "—"}</td>
          <td><span class="tag">${valuationLabel(stock.valuation.state)}</span></td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".stock-row").forEach((row) => {
    const activate = async () => {
      const stock = await provider.getStock(row.dataset.symbol, row.dataset.market);
      selectStock(stock, { openDetail: true });
    };
    row.addEventListener("click", (event) => {
      if (event.target.closest(".compare-check")) return;
      activate();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });

  document.querySelectorAll(".compare-check").forEach((input) => {
    input.addEventListener("change", () => {
      const [market, symbol] = input.dataset.compare.split(":");
      const stock = provider.stocks.find((item) => item.market === market && item.symbol === symbol);
      if (!stock) return;
      if (input.checked) {
        if (state.compare.length >= 4) {
          input.checked = false;
          return;
        }
        if (!state.compare.some((item) => sameStock(item, stock))) state.compare.push(stock);
      } else {
        state.compare = state.compare.filter((item) => !sameStock(item, stock));
      }
      renderCompare();
    });
  });
}
export function renderCompare() {
  if (!els.compareBar || !els.compareTable) return;
  if (els.researchEmptyHint) {
    els.researchEmptyHint.hidden = Boolean(state.filtered.length || state.compare.length);
  }
  if (!state.compare.length) {
    els.compareBar.textContent = "勾选研究池中的股票，或用「同行业一键对比」（最多 4 只）。";
    els.compareTable.innerHTML = "";
    return;
  }
  els.compareBar.innerHTML = state.compare
    .map((stock) => `<span class="tag">${escapeHtml(stock.name)} ${stock.symbol}</span>`)
    .join(" ");
  const rows = [
    ["价格", (s) => money(s.quote.price, s.currency)],
    ["涨跌", (s) => `${signed(s.quote.change_pct)}%`],
    ["PE", (s) => (s.quote.pe ? s.quote.pe.toFixed(1) : "—")],
    ["PB", (s) => (s.quote.pb ? s.quote.pb.toFixed(2) : "—")],
    ["安全边际", (s) => formatMarginOfSafety(marginOfSafety(s))],
    ["估值", (s) => valuationLabel(s.valuation.state)],
    ["评分", (s) => `${s.analysis.score}`],
    ["行业", (s) => s.industry],
  ];
  els.compareTable.innerHTML = `
    <table class="stock-table compare-table">
      <thead>
        <tr>
          <th>指标</th>
          ${state.compare.map((stock) => `<th>${escapeHtml(stock.name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            ([label, getter]) => `
              <tr>
                <td>${label}</td>
                ${state.compare.map((stock) => `<td>${escapeHtml(String(getter(stock)))}</td>`).join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

export function compareIndustryPeers() {
  const seed =
    state.selected ||
    state.compare[0] ||
    state.filtered.find((stock) => stock.industry && !["未分类", "恒生成分", "标普500", "自定义"].includes(stock.industry));
  if (!seed) {
    if (els.compareBar) els.compareBar.textContent = "请先在研究池选择一只股票，或筛选到具体行业。";
    return;
  }
  const industry = seed.industry;
  if (!industry || ["未分类", "恒生成分", "标普500", "自定义"].includes(industry)) {
    if (els.compareBar) els.compareBar.textContent = `${seed.name} 行业信息不足，无法一键同业对比。`;
    return;
  }
  const peers = (provider.stocks || [])
    .filter((item) => item.market === seed.market && item.industry === industry)
    .sort((a, b) => marginOfSafety(b) - marginOfSafety(a));
  const selected = [];
  const seedMatch = peers.find((item) => sameStock(item, seed));
  if (seedMatch) selected.push(seedMatch);
  for (const peer of peers) {
    if (selected.length >= 4) break;
    if (!selected.some((item) => sameStock(item, peer))) selected.push(peer);
  }
  if (selected.length < 2) {
    if (els.compareBar) els.compareBar.textContent = `${industry} 在当前已加载行情中不足 2 只，可先加载更多成分股。`;
    return;
  }
  state.compare = selected.slice(0, 4);
  if (els.industryFilter && [...els.industryFilter.options].some((option) => option.value === industry)) {
    els.industryFilter.value = industry;
    state.page = 1;
    refreshStocks();
  }
  renderCompare();
  renderRows();
  if (els.compareBar) {
    els.compareBar.insertAdjacentHTML(
      "afterbegin",
      `<span class="tag">同业 · ${escapeHtml(industry)}</span> `,
    );
  }
}

registerRenderers({ renderIndexSegment, renderResearchLoadStatus, refreshStocks, renderRows, renderPager, renderCompare, compareIndustryPeers });
