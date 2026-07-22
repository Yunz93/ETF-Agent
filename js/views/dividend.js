import { els } from "../state.js";
import { escapeHtml } from "../utils.js";
import { drawPriceChart } from "../chart.js";
import { registerRenderers } from "./render.js";

let payload = null;
let loadingPromise = null;

const GRADE_TONES = { A: "grade-a", B: "grade-b", C: "grade-c", D: "grade-d", E: "grade-e" };

function fmt(value, digits = 2, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtSigned(value, digits = 2, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}${suffix}`;
}

async function loadDividend(force = false) {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    if (els.dividendStatus) els.dividendStatus.textContent = "正在拉取红利低波数据（指数历史 / 估值 / 国债收益率 / ETF 行情）…";
    try {
      const response = await fetch(`/api/dividend/daily${force ? "?refresh=1" : ""}`);
      payload = await response.json();
      if (els.dividendStatus) {
        els.dividendStatus.textContent = payload.error
          ? `红利低波数据不可用：${payload.error}`
          : `数据更新于 ${payload.updated_at || "—"} · 指数收盘日 ${payload.index?.date || "—"}`;
      }
    } catch (error) {
      payload = { error: String(error) };
      if (els.dividendStatus) els.dividendStatus.textContent = `红利低波数据不可用：${error}`;
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

export async function renderDividend({ force = false } = {}) {
  if (!els.dividendContent) return;
  if (!payload || force) {
    els.dividendContent.hidden = payload == null;
    await loadDividend(force);
  }
  paintDividend();
}

function scoreCardHtml() {
  const score = payload.score || {};
  const backtest = payload.backtest || {};
  const tone = GRADE_TONES[score.grade] || "grade-c";
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
    ? `历史同评分（±${backtest.band}分）共 ${backtest.samples} 个交易日样本：往后 ${backtest.horizon_days} 天平均收益 <strong>${fmtSigned(backtest.avg_return_pct, 1, "%")}</strong>，胜率 <strong>${fmt(backtest.win_rate_pct, 0, "%")}</strong>（${escapeHtml(backtest.label || "")}；区间 ${fmtSigned(backtest.worst_pct, 1, "%")} ~ ${fmtSigned(backtest.best_pct, 1, "%")}）`
    : "历史同评分样本不足，暂无回测参考。";
  return `
    <section class="panel-block dividend-score-card ${tone}">
      <div class="dividend-score-main">
        <div class="dividend-score-number">
          <strong>${score.total == null ? "—" : Math.round(score.total)}</strong>
          <span>综合评分</span>
        </div>
        <div class="dividend-score-grade">
          <span class="dividend-grade-badge">${escapeHtml(score.grade || "—")}档</span>
          <p>${escapeHtml(score.action || "数据不足")}</p>
        </div>
      </div>
      <div class="dividend-components">${components}</div>
      <p class="muted dividend-backtest-line">${backtestLine}</p>
    </section>
  `;
}

function metricsHtml() {
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
      label: "现价 / 单日",
      value: `${fmt(price, priceDigits)} <em class="${changeClass}">${fmtSigned(change, 2, "%")}</em>`,
      sub: priceSub,
    },
    {
      label: "年线乖离",
      value: fmtSigned(technicals.bias_pct, 2, "%"),
      sub: `MA250 ${fmt(technicals.ma250, 2)}`,
    },
    {
      label: "股息率 vs 十年国债",
      value: `${fmt(valuation.dividend_yield_pct, 2, "%")} / ${fmt(bond.yield10y, 2, "%")}`,
      sub: `股债利差 ${fmt(spread.value, 2)}，${escapeHtml(spread.label || "—")}`,
    },
    {
      label: "PE / PB",
      value: `${fmt(valuation.pe, 2)} / ${fmt(valuation.pb, 2)}`,
      sub: pePct == null ? "PE 分位数据不足" : `PE 近 10 年 ${Math.round(pePct * 100)} 分位`,
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
      (card) => `
        <div class="metric-card dividend-metric">
          <span>${card.label}</span>
          <strong>${card.value}</strong>
          <small class="muted">${card.sub}</small>
        </div>
      `,
    )
    .join("");
}

function commentaryHtml() {
  const lines = payload.commentary || [];
  if (!lines.length) return '<p class="muted">暂无盘面点评。</p>';
  return `<ol class="dividend-commentary">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
}

function sourcesHtml() {
  const sources = payload.sources || [];
  return sources
    .map(
      (source) =>
        `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a> · ${escapeHtml(source.role)}</li>`,
    )
    .join("");
}

function errorsHtml() {
  const errors = payload.errors || {};
  const entries = Object.values(errors);
  if (!entries.length) return "";
  return `<p class="dividend-degraded muted">部分数据降级：${entries.map((entry) => escapeHtml(entry)).join("；")}</p>`;
}

function paintDividend() {
  if (!els.dividendContent) return;
  if (!payload) return;
  if (payload.error) {
    els.dividendContent.hidden = false;
    els.dividendContent.innerHTML = `<div class="empty-state">红利低波数据加载失败：${escapeHtml(payload.error)}<br />请确认本机可以访问中证指数官网 / 蛋卷基金 / 东方财富，然后点右上角「刷新数据」。</div>`;
    return;
  }
  els.dividendContent.hidden = false;
  els.dividendContent.innerHTML = `
    ${errorsHtml()}
    <div class="dividend-hero">
      ${scoreCardHtml()}
      <div class="metric-grid dividend-metrics">${metricsHtml()}</div>
    </div>
    <section class="panel-block dividend-chart-block">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">指数走势 · 年线与布林带</h2>
          <p class="muted">近 ${(payload.chart?.points || []).length} 个交易日 · ${escapeHtml(payload.index_full_name || "")}（${escapeHtml(payload.index_code || "")}）</p>
        </div>
      </div>
      <div class="price-chart-shell">
        <canvas id="dividendChart" width="960" height="360" aria-label="红利低波指数走势"></canvas>
        <div class="price-tooltip" id="dividendChartTooltip" hidden></div>
      </div>
    </section>
    <div class="dividend-columns">
      <section class="panel-block">
        <div class="panel-heading"><h2 class="section-title">今日盘面</h2><span class="muted">规则化点评</span></div>
        ${commentaryHtml()}
      </section>
      <section class="panel-block">
        <div class="panel-heading">
          <h2 class="section-title">笔记文本</h2>
          <div class="inline-actions">
            <button id="dividendCopyNote" class="ghost-button compact" type="button">复制笔记</button>
          </div>
        </div>
        <p class="muted">小红书风格日更笔记，复制即可发布。</p>
        <textarea id="dividendNoteText" class="dividend-note" rows="16" readonly>${escapeHtml(payload.note_text || "")}</textarea>
      </section>
    </div>
    <section class="panel-block dividend-sources">
      <h2 class="section-title">数据来源</h2>
      <ul>${sourcesHtml()}</ul>
      ${payload.spread?.note ? `<p class="muted">口径说明：${escapeHtml(payload.spread.note)}。</p>` : ""}
    </section>
    <footer class="disclaimer">${escapeHtml(payload.disclaimer || "仅供研究参考，不构成投资建议。")}</footer>
  `;

  const canvas = els.dividendContent.querySelector("#dividendChart");
  const tooltip = els.dividendContent.querySelector("#dividendChartTooltip");
  const markers = [];
  const markerValues = payload.chart?.markers || {};
  if (markerValues.ma250 != null) markers.push({ key: "fair", label: "年线 MA250", value: markerValues.ma250 });
  if (markerValues.boll_mid != null) markers.push({ key: "add", label: "布林中轨", value: markerValues.boll_mid });
  if (markerValues.boll_upper != null) markers.push({ key: "tp", label: "布林上轨", value: markerValues.boll_upper });
  if (markerValues.boll_lower != null) markers.push({ key: "sl", label: "布林下轨", value: markerValues.boll_lower });
  if (canvas) drawPriceChart(canvas, tooltip, payload.chart?.points || [], markers, "CNY", null);

  const copyButton = els.dividendContent.querySelector("#dividendCopyNote");
  copyButton?.addEventListener("click", async () => {
    const textarea = els.dividendContent.querySelector("#dividendNoteText");
    if (!textarea) return;
    try {
      await navigator.clipboard.writeText(textarea.value);
      copyButton.textContent = "已复制";
    } catch {
      textarea.select();
      document.execCommand("copy");
      copyButton.textContent = "已复制";
    }
    setTimeout(() => {
      copyButton.textContent = "复制笔记";
    }, 2000);
  });
}

registerRenderers({ renderDividend });
