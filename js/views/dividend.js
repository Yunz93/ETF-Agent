import { els, state, appConfig } from "../state.js";
import { escapeHtml, money, signed } from "../utils.js";
import { analysisSupported, INDEX_CHART_RANGE_MONTHS, INDEX_CHART_RANGE_LABELS } from "../constants.js";
import { getPeriodAdvice, STANCE } from "../period-advice.js";
import { drawPriceChart, buyEventMarkers } from "../chart.js";
import { callRenderer, registerRenderers } from "./render.js";

let loadingPromise = null;
let loadingKey = null;
let indexChartBound = false;

const GRADE_TONES = { A: "grade-a", B: "grade-b", C: "grade-c", D: "grade-d", E: "grade-e" };

function cacheKey(symbol) {
  return symbol || "__default__";
}

function currentPayload() {
  return state.analysisCache[cacheKey(state.analysisSymbol)] || null;
}

function setCurrentPayload(payload) {
  state.analysisCache[cacheKey(state.analysisSymbol)] = payload;
}

function fmt(value, digits = 2, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtSigned(value, digits = 2, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}${suffix}`;
}

function syncAnalysisChrome(payload) {
  const symbol = state.analysisSymbol;
  const indexName = payload?.index_name || payload?.name || symbol || "指数";
  const etfName = payload?.etf?.symbol_name || payload?.etf?.name || payload?.etf_name || "";
  const title = etfName || indexName || symbol || "分析";

  if (els.pageTitle) els.pageTitle.textContent = title;
  if (els.dividendEyebrow) {
    els.dividendEyebrow.textContent = symbol ? `Analysis · ${symbol}` : "Analysis";
  }
  if (els.dividendSectionTitle) {
    els.dividendSectionTitle.textContent = `${indexName} · 今日位置`;
  }
  if (els.dividendLede) {
    const proxy = payload?.analysis_mode === "etf_proxy";
    els.dividendLede.textContent = symbol
      ? proxy
        ? `${symbol}${etfName ? ` · ${etfName}` : ""} · ETF 口径`
        : `${symbol}${etfName ? ` · ${etfName}` : ""}`
      : "看档位、估值分位与年线位置。";
  }
}

async function loadDividend(force = false) {
  const symbol = state.analysisSymbol;
  const key = cacheKey(symbol);
  if (!force && state.analysisCache[key] != null) {
    return state.analysisCache[key];
  }
  if (loadingPromise && loadingKey === key) return loadingPromise;

  loadingKey = key;
  loadingPromise = (async () => {
    const label = symbol || "分析";
    if (els.dividendStatus) {
      els.dividendStatus.textContent = `正在拉取 ${label} 数据（指数历史 / 估值 / 国债收益率 / ETF 行情）…`;
    }
    try {
      const params = new URLSearchParams();
      if (force) params.set("refresh", "1");
      if (symbol) params.set("symbol", symbol);
      const query = params.toString();
      const response = await fetch(`/api/dividend/daily${query ? `?${query}` : ""}`);
      const payload = await response.json();
      setCurrentPayload(payload);
      syncAnalysisChrome(payload);
      if (els.dividendStatus) {
        if (payload.supported === false) {
          els.dividendStatus.textContent = payload.error || "暂不支持完整估值分析";
        } else {
          els.dividendStatus.textContent = payload.error
            ? `数据不可用：${payload.error}`
            : `数据更新于 ${payload.updated_at || "—"} · 指数收盘日 ${payload.index?.date || "—"}`;
        }
      }
      if (els.topSourceStatus) {
        els.topSourceStatus.textContent =
          payload.supported === false
            ? "分析不可用"
            : payload.error
              ? `分析不可用：${payload.error}`
              : payload.etf?.provider || "分析数据已就绪";
      }
      document.body.dataset.quoteStatus =
        payload.supported === false || payload.error ? "error" : "connected";
      return payload;
    } catch (error) {
      const payload = { supported: false, error: String(error), symbol };
      setCurrentPayload(payload);
      if (els.dividendStatus) els.dividendStatus.textContent = `数据不可用：${error}`;
      return payload;
    } finally {
      if (loadingKey === key) {
        loadingPromise = null;
        loadingKey = null;
      }
    }
  })();
  return loadingPromise;
}

export async function renderDividend({ force = false } = {}) {
  if (!els.dividendContent) return;
  const cached = currentPayload();
  if (!cached || force) {
    els.dividendContent.hidden = cached == null;
    await loadDividend(force);
  } else {
    syncAnalysisChrome(cached);
  }
  paintDividend();
}

/** 打开某只池内 ETF 的分析页；symbol 为空则回到红利低波快捷入口。 */
/** 打开某只池内 ETF 的分析页。 */
export async function openAnalysis(symbol = null) {
  if (!symbol) {
    const preferred = appConfig?.dividend?.etf_symbol || "512890";
    symbol = state.etfs.find((item) => item.symbol === preferred)?.symbol || state.etfs[0]?.symbol || null;
  }
  if (!symbol) {
    callRenderer("switchView", "etf");
    return;
  }
  state.analysisSymbol = symbol;
  state.activeView = "dividend";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === "dividendView");
  });
  callRenderer("renderSidebarEtfs");
  const cached = state.analysisCache[cacheKey(symbol)];
  const forceRefresh =
    Boolean(cached?.error) ||
    (cached?.supported === false && analysisSupported(appConfig, symbol));
  await renderDividend({ force: forceRefresh });
  document.querySelector("#dividendView")?.scrollIntoView({ block: "start" });
}

function scoreCardHtml() {
  const payload = currentPayload() || {};
  const score = payload.score || {};
  const backtest = payload.backtest || {};
  const tone = GRADE_TONES[score.grade] || "grade-c";
  const grade = score.grade || "—";
  const components = (score.components || [])
    .map((component) => {
      const width = component.score == null ? 0 : Math.max(2, Math.min(100, component.score));
      return `
        <div class="dividend-component">
          <span class="dividend-component-label">${escapeHtml(component.label)}<em>${Math.round(component.weight * 100)}%</em></span>
          <span class="dividend-component-track"><i style="width:${width}%"></i></span>
          <strong>${component.score == null ? "—" : Math.round(component.score)}</strong>
        </div>
      `;
    })
    .join("");
  const backtestLine = backtest.samples
    ? `同评分 ±${backtest.band} · ${backtest.samples} 日样本 · ${backtest.horizon_days} 日均 <strong>${fmtSigned(backtest.avg_return_pct, 1, "%")}</strong> · 胜率 <strong>${fmt(backtest.win_rate_pct, 0, "%")}</strong>（${escapeHtml(backtest.label || "")} · ${fmtSigned(backtest.worst_pct, 1, "%")} ~ ${fmtSigned(backtest.best_pct, 1, "%")}）`
    : "历史同评分样本不足，暂无回测参考。";
  return `
    <section class="panel-block dividend-score-card ${tone}" aria-label="综合评分档位">
      <div class="dividend-score-main">
        <div class="dividend-grade-mark" aria-hidden="true">${escapeHtml(grade)}</div>
        <div class="dividend-score-copy">
          <p class="dividend-grade-kicker">${escapeHtml(grade)} 档 · 综合评分（诊断，非本期执行）</p>
          <strong class="dividend-score-total">${score.total == null ? "—" : Math.round(score.total)}</strong>
        </div>
      </div>
      <div class="dividend-components">${components}</div>
      <p class="muted dividend-backtest-line">${backtestLine}</p>
    </section>
  `;
}

function metricsHtml() {
  const payload = currentPayload() || {};
  const etf = payload.etf || {};
  const index = payload.index || {};
  const valuation = payload.valuation || {};
  const bond = payload.bond || {};
  const spread = payload.spread || {};
  const technicals = payload.technicals || {};
  const kdj = technicals.kdj || {};
  const price = etf.price != null ? etf.price : index.close;
  const change = etf.price != null ? etf.change_pct : index.change_pct;
  const priceDigits = etf.price != null ? 3 : 2;
  const priceSub = etf.price != null
    ? `${escapeHtml(etf.symbol_name || etf.name || "ETF")} ${escapeHtml(etf.symbol || "")} · 指数 ${fmt(index.close, 2)}`
    : "指数收盘（中证指数官网）";
  const changeClass = change > 0 ? "up" : change < 0 ? "down" : "";
  const pePct = valuation.pe_percentile_10y;
  const cards = [
    {
      label: "PE 近 10 年分位",
      value: pePct == null ? "—" : `${Math.round(pePct * 100)}<em>%</em>`,
      sub: `PE ${fmt(valuation.pe, 2)} · PB ${fmt(valuation.pb, 2)}`,
      priority: true,
    },
    {
      label: "年线乖离",
      value: fmtSigned(technicals.bias_pct, 2, "%"),
      sub: `MA250 ${fmt(technicals.ma250, 2)}`,
      priority: true,
    },
    {
      label: "股债利差",
      value: fmt(spread.value, 2),
      sub: `股息 ${fmt(valuation.dividend_yield_pct, 2, "%")} / 国债 ${fmt(bond.yield10y, 2, "%")} · ${escapeHtml(spread.label || "—")}`,
      priority: true,
    },
    {
      label: "现价 / 单日",
      value: `${fmt(price, priceDigits)} <em class="${changeClass}">${fmtSigned(change, 2, "%")}</em>`,
      sub: priceSub,
    },
    {
      label: "RSI(14)",
      value: fmt(technicals.rsi14, 0),
      sub: escapeHtml(technicals.rsi_label || "—"),
    },
    {
      label: "KDJ(9,3,3)",
      value: `K ${fmt(kdj.k, 0)} · D ${fmt(kdj.d, 0)} · J ${fmt(kdj.j, 0)}`,
      sub: escapeHtml(technicals.kdj_label || "—"),
    },
  ];
  return cards
    .map(
      (card, index) => `
        <div class="metric-card dividend-metric${card.priority ? " metric-priority" : ""}" style="--stagger:${index}">
          <span>${card.label}</span>
          <strong>${card.value}</strong>
          <small class="muted">${card.sub}</small>
        </div>
      `,
    )
    .join("");
}

function currentPeriodAdvice() {
  const payload = currentPayload() || {};
  const symbol = state.analysisSymbol || payload.symbol || payload.etf?.symbol || "";
  return getPeriodAdvice({
    symbol,
    preferLive: payload && !payload.error ? payload : null,
  });
}

function commentaryHtml(advice) {
  const raw = (currentPayload() || {}).commentary || [];
  // 兼容旧缓存：去掉按评分写的买卖结论，统一换成策略执行结论
  const lines = raw.filter((line) => {
    const text = String(line || "").trim();
    return text && !text.startsWith("结论：");
  });
  if (advice?.executionLine) lines.push(advice.executionLine);
  if (!lines.length) return '<p class="muted">暂无盘面点评。</p>';
  return `<ol class="dividend-commentary">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
}

function dcaAdviceHtml(advice) {
  const payload = currentPayload() || {};
  const score = payload.score || {};
  const grade = score.grade || "—";
  const bias = payload.technicals?.bias_pct;
  const proxy = payload.analysis_mode === "etf_proxy";
  const active = advice || currentPeriodAdvice();
  const bullets = [...(active.bullets || [])];
  if (proxy && active.pePct == null) bullets.push("ETF 口径，无 PE 分位");
  if (bias != null) bullets.push(`年线乖离 ${fmtSigned(bias, 2, "%")}`);

  const tone =
    active.stance === STANCE.INVEST
      ? GRADE_TONES[grade] || "grade-c"
      : active.stance === STANCE.NEED_BUDGET
        ? "grade-c"
        : "grade-d";

  return `
    <section class="panel-block dividend-advice ${tone}" aria-label="本只定投建议">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">This ETF</p>
          <h2 class="section-title">定投建议</h2>
        </div>
        <span class="dividend-advice-grade">${escapeHtml(active.strategyName)} · ${escapeHtml(active.band)}</span>
      </div>
      <p class="dividend-advice-headline">${escapeHtml(active.headline)}</p>
      <ul class="dividend-advice-list">
        ${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function operationPlan(advice, technicals) {
  const active = advice || currentPeriodAdvice();
  const ma250 = technicals?.ma250;
  const bollMid = technicals?.boll?.mid;
  const triggers = [...(active.playbookTriggers || [])];
  if (ma250 != null) triggers.push(`年线 ${fmt(ma250, 2)}`);
  if (bollMid != null) triggers.push(`布林中轨 ${fmt(bollMid, 2)}`);

  return [
    { label: "策略", value: active.strategyName },
    { label: "本期结论", value: active.headline },
    { label: "倍率", value: `${active.mult}× · ${active.band}` },
    {
      label: "全池部署",
      value:
        active.stance === STANCE.NEED_BUDGET
          ? "未设置预算"
          : `${money(active.pool.deployTotal)}（留现金 ${money(active.pool.cashKeep)}）`,
    },
    {
      label: "本只建议",
      value: active.stance === STANCE.INVEST ? money(active.amount) : "不投",
    },
    { label: "执行要点", value: triggers.join("；") },
  ];
}

function holdingsPanel(symbol, price, advice) {
  const entry = state.etfs.find((item) => item.symbol === symbol);
  if (!entry || !(entry.shares > 0)) {
    return `
      <div class="dividend-holdings empty">
        <p class="muted">计划内暂无持仓份额。</p>
      </div>
    `;
  }
  const cost = entry.cost > 0 ? entry.cost : null;
  const value = price != null ? price * entry.shares : null;
  const costValue = cost != null ? cost * entry.shares : null;
  const pnl = value != null && costValue != null ? value - costValue : null;
  const pnlPct = pnl != null && costValue ? (pnl / costValue) * 100 : null;
  const vsCost = price != null && cost != null ? ((price - cost) / cost) * 100 : null;
  const add1 = cost != null ? cost * 0.97 : null;
  const add2 = cost != null ? cost * 0.95 : null;
  const canAdd = advice?.canAdd === true;
  const rows = [
    ["目标仓位", entry.target_weight > 0 ? `${Number(entry.target_weight).toFixed(1)}%` : "未设置"],
    ["持有份额", entry.shares.toLocaleString("zh-CN")],
    ["成本价", cost != null ? cost.toFixed(3) : "—"],
    ["现价", price != null ? Number(price).toFixed(3) : "—"],
    ["市值", value != null ? money(value) : "—"],
    ["浮盈亏", pnl != null ? `${money(pnl)}（${signed(pnlPct, 1)}%）` : "—"],
    ["相对成本", vsCost != null ? `${signed(vsCost, 2)}%` : "—"],
  ];
  let hint;
  if (!canAdd) {
    hint = `<p class="muted dividend-holdings-hint">本期策略结论：不加仓（${escapeHtml(advice?.reason || "不投")}）</p>`;
  } else if (add1 != null) {
    hint = `<p class="muted dividend-holdings-hint">加仓参考：${add1.toFixed(3)} / ${add2.toFixed(3)}（成本 -3% / -5%）</p>`;
  } else {
    hint = `<p class="muted dividend-holdings-hint">补成本价后可生成加仓参考。</p>`;
  }
  return `
    <div class="dividend-holdings">
      <dl class="dividend-holdings-grid">
        ${rows
          .map(
            ([label, valueText]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd class="${label === "浮盈亏" && pnl != null ? (pnl > 0 ? "up" : pnl < 0 ? "down" : "") : ""}">${valueText}</dd>
          </div>
        `,
          )
          .join("")}
      </dl>
      ${hint}
    </div>
  `;
}

function auxPanelHtml(advice) {
  const payload = currentPayload() || {};
  const technicals = payload.technicals || {};
  const price = payload.etf?.price != null ? payload.etf.price : payload.index?.close;
  const symbol = state.analysisSymbol || payload.symbol || payload.etf?.symbol || "";
  const active = advice || currentPeriodAdvice();
  const steps = operationPlan(active, technicals);

  return `
    <section class="panel-block dividend-aux" aria-label="操作清单与持仓对照">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Playbook</p>
          <h2 class="section-title">操作清单</h2>
        </div>
      </div>
      <ul class="dividend-playbook">
        ${steps
          .map(
            (step) => `
          <li>
            <span>${escapeHtml(step.label)}</span>
            <strong>${escapeHtml(step.value)}</strong>
          </li>
        `,
          )
          .join("")}
      </ul>
      <div class="dividend-aux-divider">
        <p class="eyebrow">Holdings</p>
        <h3 class="section-title">持仓对照</h3>
      </div>
      ${holdingsPanel(symbol, price, active)}
    </section>
  `;
}

function sourcesHtml() {
  const sources = (currentPayload() || {}).sources || [];
  return sources
    .map(
      (source) =>
        `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a> · ${escapeHtml(source.role)}</li>`,
    )
    .join("");
}

function errorsHtml() {
  const errors = (currentPayload() || {}).errors || {};
  const entries = Object.values(errors);
  if (!entries.length) return "";
  return `<p class="dividend-degraded muted">部分数据降级：${entries.map((entry) => escapeHtml(entry)).join("；")}</p>`;
}

function buildIndexChartMarkers(payload) {
  const markers = [];
  const markerValues = payload?.chart?.markers || {};
  if (markerValues.ma250 != null) markers.push({ key: "fair", label: "年线 MA250", value: markerValues.ma250 });
  if (markerValues.boll_mid != null) markers.push({ key: "add", label: "布林中轨", value: markerValues.boll_mid });
  if (markerValues.boll_upper != null) markers.push({ key: "tp", label: "布林上轨", value: markerValues.boll_upper });
  if (markerValues.boll_lower != null) markers.push({ key: "sl", label: "布林下轨", value: markerValues.boll_lower });
  const symbol = state.analysisSymbol || payload?.symbol || "";
  markers.push(
    ...buyEventMarkers(
      (state.buys || []).filter((item) => item.symbol === symbol),
      { useBuyPrice: false },
    ),
  );
  return markers;
}

function paintDividend() {
  if (!els.dividendContent) return;
  const payload = currentPayload();
  if (!payload) return;

  if (payload.supported === false) {
    els.dividendContent.hidden = false;
    els.dividendContent.innerHTML = `
      <div class="empty-state analysis-unsupported">
        <p class="eyebrow">Unsupported</p>
        <h3 class="section-title">${escapeHtml(payload.name || payload.symbol || state.analysisSymbol || "该 ETF")}</h3>
        <p>${escapeHtml(payload.error || "暂不支持完整估值分析")}</p>
        <p class="muted">${escapeHtml(payload.reason || "缺少指数/估值映射。")}</p>
      </div>
    `;
    return;
  }

  if (payload.error && !payload.score) {
    els.dividendContent.hidden = false;
    els.dividendContent.innerHTML = `<div class="empty-state">分析数据加载失败：${escapeHtml(payload.error)}<br />请确认本机可以访问中证指数官网 / 蛋卷基金 / 东方财富，然后点「刷新」。</div>`;
    return;
  }

  els.dividendContent.hidden = false;
  const advice = currentPeriodAdvice();
  els.dividendContent.innerHTML = `
    ${errorsHtml()}
    <div class="dividend-hero">
      <div class="dividend-hero-main">
        ${scoreCardHtml()}
        ${dcaAdviceHtml(advice)}
      </div>
      <div class="dividend-hero-aside">
        <div class="metric-grid dividend-metrics">${metricsHtml()}</div>
        ${auxPanelHtml(advice)}
      </div>
    </div>
    <section class="panel-block dividend-chart-block">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Chart</p>
          <h2 class="section-title">指数走势 · 年线与布林</h2>
          <p class="muted" id="indexChartSummary">加载区间… · ${escapeHtml(payload.index_full_name || "")}（${escapeHtml(payload.index_code || "")}）</p>
        </div>
        <div class="range-segment" role="group" aria-label="指数走势区间">
          ${Object.entries(INDEX_CHART_RANGE_LABELS)
            .map(
              ([key, label]) => `
            <button class="segment-button js-index-range${state.indexChartRange === key ? " active" : ""}" data-index-range="${key}" type="button">${label}</button>
          `,
            )
            .join("")}
        </div>
      </div>
      <div class="price-chart-shell">
        <canvas id="dividendChart" width="960" height="360" aria-label="指数走势"></canvas>
        <div class="price-tooltip" id="dividendChartTooltip" hidden></div>
      </div>
    </section>
    <section class="panel-block">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Tape</p>
          <h2 class="section-title">今日盘面</h2>
        </div>
        <span class="muted">规则点评 · 执行跟策略</span>
      </div>
      ${commentaryHtml(advice)}
    </section>
    <section class="panel-block dividend-sources">
      <p class="eyebrow">Sources</p>
      <h2 class="section-title">数据来源</h2>
      <ul>${sourcesHtml()}</ul>
      ${payload.spread?.note ? `<p class="muted">口径说明：${escapeHtml(payload.spread.note)}。</p>` : ""}
    </section>
    <footer class="disclaimer">${escapeHtml(payload.disclaimer || "仅供研究参考，不构成投资建议。")}</footer>
  `;

  const canvas = els.dividendContent.querySelector("#dividendChart");
  const tooltip = els.dividendContent.querySelector("#dividendChartTooltip");
  drawIndexChart(payload, canvas, tooltip, buildIndexChartMarkers(payload));
  bindIndexChartRangeControls();
}

function sliceIndexChartPoints(points, rangeKey) {
  if (!Array.isArray(points) || !points.length) return [];
  const months = INDEX_CHART_RANGE_MONTHS[rangeKey];
  if (months == null) return points;
  const lastDate = points[points.length - 1]?.date;
  if (!lastDate) return points;
  const end = new Date(`${lastDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return points;
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  const startStr = start.toISOString().slice(0, 10);
  const sliced = points.filter((point) => point.date >= startStr);
  return sliced.length ? sliced : points;
}

function drawIndexChart(payload, canvas, tooltip, markers) {
  if (!canvas) return;
  const allPoints = payload?.chart?.points || [];
  const points = sliceIndexChartPoints(allPoints, state.indexChartRange || "1y");
  const summary = els.dividendContent?.querySelector("#indexChartSummary");
  if (summary) {
    const label = INDEX_CHART_RANGE_LABELS[state.indexChartRange] || "1Y";
    const from = points[0]?.date || payload?.chart?.available_from || "—";
    const to = points[points.length - 1]?.date || payload?.chart?.available_to || "—";
    const name = payload?.index_full_name || "";
    const code = payload?.index_code || "";
    const buyCount = (markers || []).filter((item) => item?.date && item.key === "buy").length;
    summary.textContent = `${label} · ${points.length} 个交易日（${from} → ${to}） · ${name}${code ? `（${code}）` : ""} · 共可看 ${allPoints.length} 日${buyCount ? ` · 买入点 ${buyCount}` : ""}`;
  }
  drawPriceChart(canvas, tooltip, points, markers || [], "CNY", null);
}

function bindIndexChartRangeControls() {
  if (!els.dividendContent || indexChartBound) return;
  indexChartBound = true;
  els.dividendContent.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-index-range]");
    if (!button || !els.dividendContent.contains(button)) return;
    const next = button.dataset.indexRange;
    if (!next || next === state.indexChartRange) return;
    state.indexChartRange = next;
    els.dividendContent.querySelectorAll("[data-index-range]").forEach((node) => {
      node.classList.toggle("active", node.dataset.indexRange === next);
    });
    const payload = currentPayload();
    if (!payload) return;
    const canvas = els.dividendContent.querySelector("#dividendChart");
    const tooltip = els.dividendContent.querySelector("#dividendChartTooltip");
    drawIndexChart(payload, canvas, tooltip, buildIndexChartMarkers(payload));
  });
}

registerRenderers({ renderDividend, openAnalysis });
