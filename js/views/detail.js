import { appConfig, els, provider, state } from "../state.js";
import { drawMetricChart, loadAndDrawPriceChart } from "../chart.js";
import { formatEvidenceLinks, parseEvidenceLinks, pushDecisionLog } from "./workbench.js";
import { compareIndustryPeers, registerRenderers, renderRows, renderSourceStatus, renderWatchlist, renderWorkbench, showDetail, switchView, toggleWatch } from "./render.js";
import { persistWorkspace } from "../workspace.js";
import { extractAiThesisSnippet, renderAiReport, requestAiAnalysis } from "../markdown.js";
import { formatFinancialMillions, formatMarginOfSafety, latestFinancial, marginOfSafety, markerPosition, paintEvents, peerContext, sourceItems, week52Stats, formatMarketCap } from "../analysis.js";
import { escapeHtml, marketLabel, money, signed, stockKey, valuationLabel } from "../utils.js";

export function selectStock(stock, { openDetail = false, updateHash = true } = {}) {
  if (!stock) {
    state.selected = null;
    if (els.stockDetail) {
      els.stockDetail.innerHTML = `<div class="empty-state">没有匹配的股票。请调整搜索或筛选条件。</div>`;
    }
    return;
  }
  state.selected = stock;
  els.selectedStockSummary.textContent = `${stock.name} · ${formatMarginOfSafety(marginOfSafety(stock))} · ${valuationLabel(stock.valuation.state)}${stock.quote.as_of ? ` · ${stock.quote.as_of}` : ""}`;
  if (els.detailCrumb) {
    els.detailCrumb.textContent = `${stock.name} ${stock.symbol} · ${marketLabel(stock.market)} · ${stock.industry}`;
  }
  renderSourceStatus();
  renderRows();
  renderDetail();
  if (openDetail) {
    showDetail(stock, { updateHash });
  }
}

export function renderDetail() {
  const stock = state.selected;
  if (!stock) return;
  provider.getStock(stock.symbol, stock.market).then((enriched) => {
    if (!enriched || state.selected?.symbol !== enriched.symbol || state.selected?.market !== enriched.market) return;
    state.selected = enriched;
    paintDetail(enriched);
  });
}

export function paintDetail(stock) {
  if (!els.template || !els.stockDetail) return;
  const fragment = els.template.content.cloneNode(true);
  const root = fragment.querySelector(".report-card");
  const latest = latestFinancial(stock);
  const hasFinancials = Boolean(latest);
  const watchKey = stockKey(stock);
  const watched = Boolean(state.watchlist[watchKey]);
  const note = state.notes[watchKey] || {};
  const holding = state.holdings[watchKey];

  root.querySelector(".js-name").textContent = `${stock.name} ${stock.symbol}`;
  root.querySelector(".js-meta").textContent = `${marketLabel(stock.market)} · ${stock.exchange} · ${stock.industry} · ${stock.englishName} · ${stock.currency}${stock.quote.as_of ? ` · 更新 ${stock.quote.as_of}` : ""}`;
  root.querySelector(".js-price").textContent = money(stock.quote.price, stock.currency);
  root.querySelector(".js-valuation-state").textContent = valuationLabel(stock.valuation.state);
  root.querySelector(".js-margin").textContent = formatMarginOfSafety(marginOfSafety(stock));
  root.querySelector(".js-margin").className = `js-margin ${marginOfSafety(stock) >= 0 ? "up" : "down"}`;
  root.querySelector(".js-score").textContent = hasFinancials ? `${stock.analysis.score}/100` : "—";

  root.querySelector(".js-pe").textContent = stock.quote.pe ? `${stock.quote.pe.toFixed(1)}x` : "—";
  root.querySelector(".js-pb").textContent = stock.quote.pb ? `${stock.quote.pb.toFixed(2)}x` : "—";
  root.querySelector(".js-ps").textContent = stock.quote.ps ? `${stock.quote.ps.toFixed(2)}x` : "—";
  root.querySelector(".js-dividend").textContent =
    stock.quote.dividend_yield != null ? `${stock.quote.dividend_yield.toFixed(2)}%` : "—";
  root.querySelector(".js-market-cap").textContent = formatMarketCap(stock.quote.market_cap, stock.currency);
  const w52 = week52Stats(stock);
  root.querySelector(".js-week52").textContent = w52
    ? `${money(stock.quote.week_52_low, stock.currency)} – ${money(stock.quote.week_52_high, stock.currency)} · ${w52.position}%`
    : "—";

  root.querySelector(".js-valuation-method").textContent = `估值方法：${stock.valuation.method}`;
  root.querySelector(".js-bear").textContent = money(stock.valuation.bear_price, stock.currency);
  root.querySelector(".js-base").textContent = money(stock.valuation.base_price, stock.currency);
  root.querySelector(".js-bull").textContent = money(stock.valuation.bull_price, stock.currency);
  const peer = peerContext(stock, provider.stocks);
  const peerEl = root.querySelector(".js-peer");
  peerEl.innerHTML = "";
  if (peer) {
    peerEl.hidden = false;
    peerEl.append(document.createTextNode(peer + " "));
    const peerBtn = document.createElement("button");
    peerBtn.type = "button";
    peerBtn.className = "ghost-button compact js-compare-peers";
    peerBtn.textContent = "同行业对比";
    peerBtn.addEventListener("click", () => {
      state.selected = stock;
      compareIndustryPeers();
      switchView("research");
    });
    peerEl.append(peerBtn);
  } else {
    peerEl.hidden = true;
  }

  root.querySelector(".js-rating-label").textContent = stock.analysis.rating_label;
  root.querySelector(".js-summary").textContent = stock.analysis.summary;

  const financialSection = root.querySelector("#detail-financials");
  if (hasFinancials) {
    root.querySelector(".js-revenue-growth").textContent = `${signed(latest.revenue_growth)}% YoY`;
    root.querySelector(".js-net-income").textContent = formatFinancialMillions(latest.net_income, stock.currency);
    root.querySelector(".js-gross-margin").textContent = `${latest.gross_margin.toFixed(1)}%`;
    root.querySelector(".js-debt-ratio").textContent = `${latest.debt_ratio.toFixed(1)}%`;
  } else {
    financialSection.innerHTML = `<div class="empty-state">暂无财报数据，数据源未返回可解析的财务指标。</div>`;
  }

  const marker = root.querySelector(".js-marker");
  marker.style.left = `${markerPosition(stock)}%`;

  root.querySelector(".js-band-labels").innerHTML = [
    `关注 ${money(stock.valuation.watch_zone[0], stock.currency)}-${money(stock.valuation.watch_zone[1], stock.currency)}`,
    `合理 ${money(stock.valuation.fair_zone[0], stock.currency)}-${money(stock.valuation.fair_zone[1], stock.currency)}`,
    `偏贵 ${money(stock.valuation.expensive_zone[0], stock.currency)}-${money(stock.valuation.expensive_zone[1], stock.currency)}`,
    `风险 > ${money(stock.valuation.risk_price, stock.currency)}`,
  ]
    .map((label) => `<span>${label}</span>`)
    .join("");

  root.querySelector(".js-positives").innerHTML = (stock.analysis.positives.length ? stock.analysis.positives : ["暂无自动提取的积极因素。"])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  root.querySelector(".js-risks").innerHTML = stock.analysis.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  root.querySelector(".js-assumptions").innerHTML = stock.valuation.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  root.querySelector(".js-sources").innerHTML = sourceItems(stock)
    .map((source) => `<li><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>：${escapeHtml(source.role)}</li>`)
    .join("");

  root.querySelector(".js-breakdown").innerHTML = hasFinancials
    ? Object.entries(stock.analysis.breakdown)
        .map(
          ([label, value]) => `
        <div class="score-row">
          <span>${label}</span>
          <div class="score-bar"><span style="width:${value}%"></span></div>
          <strong>${value}</strong>
        </div>
      `,
        )
        .join("")
    : `<p class="muted">需财报数据后展示评分拆解。</p>`;

  paintEvents(root, stock.events || []);

  const thesis = root.querySelector(".js-thesis");
  const invalidation = root.querySelector(".js-invalidation");
  const decision = root.querySelector(".js-decision");
  const watchPrice = root.querySelector(".js-watch-price");
  const reviewDate = root.querySelector(".js-review-date");
  const evidence = root.querySelector(".js-evidence");
  const noteStatus = root.querySelector(".js-note-status");
  thesis.value = note.thesis || "";
  if (invalidation) invalidation.value = note.invalidation || "";
  decision.value = note.decision || "watch";
  if (watchPrice) watchPrice.value = note.watchPrice != null && note.watchPrice !== "" ? note.watchPrice : "";
  if (reviewDate) reviewDate.value = note.reviewDate || "";
  if (evidence) evidence.value = formatEvidenceLinks(note.evidence);
  root.querySelector(".js-save-note").addEventListener("click", () => {
    const parsedWatchPrice = watchPrice?.value.trim() ? Number(watchPrice.value) : null;
    state.notes[watchKey] = {
      thesis: thesis.value.trim(),
      invalidation: invalidation?.value.trim() || "",
      decision: decision.value,
      watchPrice: Number.isFinite(parsedWatchPrice) ? parsedWatchPrice : null,
      reviewDate: reviewDate?.value || "",
      evidence: parseEvidenceLinks(evidence?.value || ""),
      updatedAt: new Date().toISOString(),
    };
    persistWorkspace();
    noteStatus.textContent = "已保存";
    pushDecisionLog(stock, decision.value);
    renderWorkbench();
  });

  bindAiAnalysisSection(root, stock, {
    thesis,
    noteStatus,
    watchKey,
  });

  const watchButton = root.querySelector(".js-watch");
  watchButton.textContent = watched ? "已加入自选" : "加入自选";
  watchButton.classList.toggle("active", watched);
  watchButton.addEventListener("click", () => toggleWatch(stock));

  root.querySelectorAll(".js-range").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === state.priceRange);
    button.addEventListener("click", () => {
      state.priceRange = button.dataset.range;
      paintDetail(stock);
    });
  });

  const legend = root.querySelector(".js-price-legend");
  const summary = root.querySelector(".js-price-summary");
  const markers = [];
  const saved = state.watchlist[watchKey];
  if (saved?.buy) markers.push({ key: "buy", label: "买入关注", value: saved.buy, color: "--accent-strong" });
  if (saved?.add) markers.push({ key: "add", label: "加仓", value: saved.add, color: "--blue" });
  if (saved?.takeProfit) markers.push({ key: "tp", label: "止盈", value: saved.takeProfit, color: "--warn" });
  if (saved?.stopLoss) markers.push({ key: "sl", label: "止损", value: saved.stopLoss, color: "--danger" });
  if (holding?.cost) markers.push({ key: "cost", label: "成本", value: holding.cost, color: "--ink" });
  markers.push({ key: "fair", label: "合理下沿", value: stock.valuation.fair_zone[0], color: "--accent-ink" });
  if (summary) summary.textContent = "加载走势中…";
  if (legend) {
    legend.innerHTML = [
      `<span class="price-legend-chip line" style="color:var(--chart-line)"><i></i>收盘价</span>`,
      `<span class="price-legend-chip line" style="color:var(--blue)"><i></i>均线</span>`,
      ...markers.map(
        (item) =>
          `<span class="price-legend-chip" style="color:var(${item.color})"><i></i>${escapeHtml(item.label)} ${money(item.value, stock.currency)}</span>`,
      ),
    ].join("");
  }

  els.stockDetail.replaceChildren(fragment);
  if (hasFinancials) {
    els.stockDetail.querySelectorAll(".js-chart").forEach((canvas) => {
      drawMetricChart(canvas, stock.financials, canvas.dataset.metric);
    });
  }
  const priceCanvas = els.stockDetail.querySelector(".js-price-chart");
  const priceTooltip = els.stockDetail.querySelector(".js-price-tooltip");
  const priceSummary = els.stockDetail.querySelector(".js-price-summary");
  loadAndDrawPriceChart(priceCanvas, priceTooltip, priceSummary, stock, markers);
  renderWatchlist();
}
export function bindAiAnalysisSection(root, stock, { thesis, noteStatus, watchKey }) {
  const section = root.querySelector("#detail-ai");
  if (!section) return;
  const rangeSelect = root.querySelector(".js-ai-range");
  const focusInput = root.querySelector(".js-ai-focus");
  const analyzeButton = root.querySelector(".js-ai-analyze");
  const statusEl = root.querySelector(".js-ai-status");
  const resultEl = root.querySelector(".js-ai-result");
  const toThesisButton = root.querySelector(".js-ai-to-thesis");
  const cached = state.aiReports[watchKey];

  if (rangeSelect) {
    rangeSelect.value = state.aiRange || "1y";
    rangeSelect.addEventListener("change", () => {
      state.aiRange = rangeSelect.value;
    });
  }
  if (cached?.focus && focusInput) focusInput.value = cached.focus;
  renderAiReport(resultEl, statusEl, toThesisButton, cached);

  const ai = appConfig?.ai || {};
  if (ai.enabled === false) {
    if (statusEl) statusEl.textContent = "AI 分析已在设置中关闭。";
    if (analyzeButton) analyzeButton.disabled = true;
  } else if (!ai.has_api_key) {
    if (statusEl) statusEl.textContent = "请先到设置页配置 DeepSeek / OpenAI 兼容 API Key。";
  } else if (statusEl && !cached) {
    statusEl.textContent = `将使用 ${ai.provider_name || ai.provider || "外部模型"} · ${ai.model || ""}`.trim();
  }

  analyzeButton?.addEventListener("click", async () => {
    if (!analyzeButton || analyzeButton.disabled) return;
    analyzeButton.disabled = true;
    if (statusEl) statusEl.textContent = "正在汇总行情、历史走势与财报，请求大模型…";
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p class="muted">分析中，通常需要数秒到数十秒…</p>`;
    }
    if (toThesisButton) toThesisButton.hidden = true;
    try {
      const report = await requestAiAnalysis(stock, {
        historyRange: rangeSelect?.value || state.aiRange || "1y",
        focus: focusInput?.value.trim() || "",
      });
      state.aiReports[watchKey] = report;
      renderAiReport(resultEl, statusEl, toThesisButton, report);
    } catch (error) {
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.innerHTML = `<p class="ai-error">${escapeHtml(error.message || "分析失败")}</p>`;
      }
      if (statusEl) statusEl.textContent = "分析失败";
    } finally {
      analyzeButton.disabled = false;
    }
  });

  toThesisButton?.addEventListener("click", () => {
    const report = state.aiReports[watchKey];
    if (!report?.content || !thesis) return;
    const snippet = extractAiThesisSnippet(report.content);
    thesis.value = thesis.value.trim() ? `${thesis.value.trim()}\n\n${snippet}` : snippet;
    if (noteStatus) noteStatus.textContent = "已填入论点，记得保存判断卡";
  });
}

registerRenderers({ selectStock, renderDetail, paintDetail });
