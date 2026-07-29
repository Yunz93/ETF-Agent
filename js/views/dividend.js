import { els, state, appConfig } from "../state.js";
import { escapeHtml, money, signed } from "../utils.js";
import { analysisSupported, INDEX_CHART_RANGE_WINDOWS, INDEX_CHART_RANGE_LABELS } from "../constants.js";
import { getPeriodAdvice, STANCE } from "../period-advice.js";
import { drawPriceChart, buyEventMarkers, sellEventMarkers } from "../chart.js";
import {
  cycleExecution,
  orderPreview,
  projectedPosition,
  returnCorrelation,
  riskMetrics,
} from "../decision-support.js";
import { callRenderer, registerRenderers } from "./render.js";

const loadingByKey = new Map();
let indexChartBound = false;

const GRADE_TONES = { A: "grade-a", B: "grade-b", C: "grade-c", D: "grade-d", E: "grade-e" };

function cacheKey(symbol) {
  return symbol || "__default__";
}

function currentPayload() {
  return state.analysisCache[cacheKey(state.analysisSymbol)] || null;
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
  if (els.dividendSectionTitle) {
    els.dividendSectionTitle.textContent = indexName;
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
  if (loadingByKey.has(key)) return loadingByKey.get(key);

  const request = (async () => {
    const label = symbol || "分析";
    if (els.dividendStatus && cacheKey(state.analysisSymbol) === key) {
      els.dividendStatus.textContent = `正在拉取 ${label} 数据（指数历史 / 估值 / 国债收益率 / ETF 行情）…`;
    }
    try {
      const params = new URLSearchParams();
      if (force) params.set("refresh", "1");
      if (symbol) params.set("symbol", symbol);
      const query = params.toString();
      const response = await fetch(`/api/dividend/daily${query ? `?${query}` : ""}`);
      const payload = await response.json();
      state.analysisCache[key] = payload;
      if (cacheKey(state.analysisSymbol) !== key) return payload;
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
      state.analysisCache[key] = payload;
      if (els.dividendStatus && cacheKey(state.analysisSymbol) === key) {
        els.dividendStatus.textContent = `数据不可用：${error}`;
      }
      return payload;
    } finally {
      loadingByKey.delete(key);
    }
  })();
  loadingByKey.set(key, request);
  return request;
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

function currentAIReview() {
  const symbol = state.analysisSymbol || currentPayload()?.symbol || "";
  return state.aiReviews[symbol] || null;
}

function aiListHtml(items, empty = "暂无") {
  if (!Array.isArray(items) || !items.length) return `<p class="muted">${empty}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function aiReviewHtml(advice, context) {
  const enabled = appConfig?.ai?.enabled === true;
  const review = currentAIReview();
  if (!enabled) {
    return `
      <section class="panel-block ai-review-card is-disabled" aria-label="AI 建议校正">
        <div class="panel-heading">
          <div><h2 class="section-title">AI 建议校正</h2></div>
          <span class="muted">未启用</span>
        </div>
        <p class="muted">可在设置中配置 DeepSeek 或 OpenAI。模型只有提案权，最终金额受本地风控约束。</p>
      </section>
    `;
  }
  if (review?.status === "loading") {
    return `
      <section class="panel-block ai-review-card is-loading" aria-live="polite">
        <div class="panel-heading"><div><h2 class="section-title">AI 建议校正</h2></div></div>
        <p class="muted">正在复核规则建议与当前数据，请稍候…</p>
      </section>
    `;
  }
  if (review?.status === "error") {
    return `
      <section class="panel-block ai-review-card is-error">
        <div class="panel-heading">
          <div><h2 class="section-title">AI 建议校正</h2></div>
          <button class="ghost-button compact" data-ai-review type="button">重试</button>
        </div>
        <p class="down">${escapeHtml(review.error)}</p>
        <p class="muted">规则建议保持有效，AI 失败不会改变本期结论。</p>
      </section>
    `;
  }
  const result = review?.result;
  if (!result) {
    return `
      <section class="panel-block ai-review-card">
        <div class="panel-heading">
          <div>
            <h2 class="section-title">AI 建议校正</h2>
            <p class="muted">复核规则盲点，不自动修改持仓或长期策略。</p>
          </div>
          <button class="primary-button compact" data-ai-review type="button">开始校正</button>
        </div>
        <p class="muted">将发送估值、技术面、数据质量、仓位比例和本期规则建议；不发送账户凭证。</p>
      </section>
    `;
  }
  const proposal = result.ai_proposal || {};
  const policy = result.policy_decision || {};
  const baselineAmount = result.baseline_recommendation?.remaining_amount || 0;
  const correctedAmount = result.final_recommendation?.amount || 0;
  const useCorrection = review.selection !== "baseline";
  const displayedAmount = useCorrection ? correctedAmount : baselineAmount;
  const actionLabels = {
    keep: "维持",
    increase: "提高",
    reduce: "降低",
    pause: "暂停",
  };
  const confidenceLabels = { low: "低", medium: "中", high: "高" };
  return `
    <section class="panel-block ai-review-card" aria-label="AI 建议校正">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">AI 建议校正</h2>
          <p class="muted">${escapeHtml(result.provider)} · ${escapeHtml(result.model)}${result.cached ? " · 缓存" : ""}</p>
        </div>
        <button class="ghost-button compact" data-ai-review data-force="true" type="button">重新生成</button>
      </div>
      <div class="ai-review-summary">
        <div><span>规则剩余额度</span><strong>${money(baselineAmount)}</strong></div>
        <div><span>AI 提案</span><strong>${escapeHtml(actionLabels[proposal.action] || proposal.action)} · ${fmt(policy.accepted_multiplier, 2)}×</strong></div>
        <div><span>校正后额度</span><strong>${money(correctedAmount)}</strong></div>
        <div><span>可信度</span><strong>${escapeHtml(confidenceLabels[proposal.confidence] || "—")}</strong></div>
      </div>
      <p class="ai-review-headline">${escapeHtml(proposal.summary || "模型未提供摘要")}</p>
      <div class="ai-review-details">
        <div><h3>支持因素</h3>${aiListHtml(proposal.supporting_factors)}</div>
        <div><h3>风险</h3>${aiListHtml(proposal.risks)}</div>
        <div><h3>观察与反转条件</h3>${aiListHtml([...(proposal.watch_items || []), ...(proposal.conditions_to_reverse || [])])}</div>
      </div>
      <p class="muted">风控裁决：${escapeHtml((policy.reasons || []).join("；"))}</p>
      <div class="ai-review-choice" role="group" aria-label="选择本期参考建议">
        <button class="${useCorrection ? "primary-button" : "ghost-button"} compact" data-ai-choice="corrected" type="button">采用本期校正</button>
        <button class="${useCorrection ? "ghost-button" : "primary-button"} compact" data-ai-choice="baseline" type="button">保持规则建议</button>
        <strong>当前参考：${money(displayedAmount)}</strong>
      </div>
      <p class="muted ai-review-disclaimer">${escapeHtml(result.disclaimer || "")}</p>
    </section>
  `;
}

async function requestAIReview({ force = false } = {}) {
  const payload = currentPayload();
  const symbol = state.analysisSymbol || payload?.symbol || payload?.etf?.symbol || "";
  if (!symbol) return;
  const advice = currentPeriodAdvice();
  const context = decisionContext(advice);
  state.aiReviews[symbol] = { status: "loading" };
  paintDividend();
  try {
    const response = await fetch("/api/ai/review-recommendation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        force,
        baseline: {
          stance: advice.stance,
          headline: advice.headline,
          reason: advice.reason,
          amount: advice.amount,
          remaining_amount: context.cycle.remainingAmount,
        },
        position: {
          target_weight: advice.position?.targetWeight,
          actual_weight: advice.position?.actualWeight,
          projected_weight: context.position.projectedWeight,
          blocked: context.position.blocked,
          would_exceed: context.position.wouldExceed,
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `AI API ${response.status}`);
    state.aiReviews[symbol] = { status: "ready", result, selection: "corrected" };
  } catch (error) {
    state.aiReviews[symbol] = { status: "error", error: String(error.message || error) };
  }
  paintDividend();
}

function decisionContext(advice) {
  const payload = currentPayload() || {};
  const symbol = state.analysisSymbol || payload.symbol || payload.etf?.symbol || "";
  const entry = state.etfs.find((item) => item.symbol === symbol) || null;
  const price = payload.etf?.price != null ? Number(payload.etf.price) : Number(payload.index?.close);
  const cycle = cycleExecution({
    plan: state.plan,
    buys: state.buys,
    symbol,
    recommendedAmount: advice?.amount || 0,
  });
  const executableAmount = advice?.canAdd ? cycle.remainingAmount : 0;
  const order = orderPreview(executableAmount, price);
  let portfolioValue = 0;
  state.etfs.forEach((item) => {
    const itemPrice =
      item.symbol === symbol && price > 0
        ? price
        : Number(state.quotesBySymbol[item.symbol]?.price);
    if (itemPrice > 0 && item.shares > 0) portfolioValue += itemPrice * item.shares;
  });
  const currentValue = entry && price > 0 ? entry.shares * price : 0;
  const position = projectedPosition({
    currentValue,
    portfolioValue,
    buyAmount: order.estimatedAmount,
    targetWeight: advice?.position?.targetWeight,
  });
  const points = payload.chart?.points || [];
  const risk = riskMetrics(points);
  const correlations = Object.entries(state.analysisCache)
    .filter(([key, cached]) => key !== symbol && Array.isArray(cached?.chart?.points))
    .map(([key, cached]) => ({
      symbol: key,
      name: state.etfs.find((item) => item.symbol === key)?.name || cached.etf_name || key,
      correlation: returnCorrelation(points, cached.chart.points),
    }))
    .filter((item) => item.correlation)
    .sort((left, right) => Math.abs(right.correlation.value) - Math.abs(left.correlation.value));
  return {
    symbol,
    entry,
    price,
    cycle,
    order,
    position,
    portfolioValue,
    currentValue,
    risk,
    strongestCorrelation: correlations[0] || null,
  };
}

const CYCLE_STATUS_LABELS = {
  waiting: "等待执行日",
  due: "今日执行",
  overdue: "已过执行日",
  partial: "本期部分完成",
  completed: "本期已完成",
  not_required: "本期无需执行",
};

function executionPanelHtml(advice, context) {
  const { cycle, order, position } = context;
  const lastBuyText = cycle.lastBuy
    ? `${cycle.lastBuy.date} · ${Number(cycle.lastBuy.price).toFixed(3)}`
    : "暂无记录";
  const action =
    position.blocked || position.wouldExceed
      ? "暂停新增，先恢复仓位约束"
      : cycle.status === "completed"
        ? "本期已完成，避免重复买入"
        : order.shares > 0
          ? `可买 ${order.shares.toLocaleString("zh-CN")} 份`
          : advice.amount > 0
            ? "预算不足 100 份，保留现金"
            : "本期不下单";
  return `
    <div class="decision-execution" aria-label="本期执行状态">
      <div class="decision-execution-head">
        <strong>${escapeHtml(action)}</strong>
        <span>${escapeHtml(CYCLE_STATUS_LABELS[cycle.status] || cycle.status)}</span>
      </div>
      <dl class="decision-execution-grid">
        <div><dt>计划执行日</dt><dd>${escapeHtml(cycle.scheduled)}</dd></div>
        <div><dt>本期已买</dt><dd>${money(cycle.executedAmount)}</dd></div>
        <div><dt>剩余额度</dt><dd>${money(cycle.remainingAmount)}</dd></div>
        <div><dt>预计成交</dt><dd>${order.shares > 0 ? money(order.estimatedAmount) : "—"}</dd></div>
        <div><dt>取整余款</dt><dd>${money(order.cashRemainder)}</dd></div>
        <div><dt>最近买入</dt><dd>${escapeHtml(lastBuyText)}</dd></div>
      </dl>
    </div>
  `;
}

function commentaryHtml() {
  const raw = (currentPayload() || {}).commentary || [];
  // 兼容旧缓存：盘面只保留分析，不重复展示建议卡中的执行结论
  const lines = raw.filter((line) => {
    const text = String(line || "").trim();
    return text && !text.startsWith("结论：");
  });
  if (!lines.length) return '<p class="muted">暂无盘面点评。</p>';
  return `<ol class="dividend-commentary">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
}

function addPlanHtml(entry, price, advice) {
  if (!entry || !(entry.shares > 0)) return "";
  const cost = entry.cost > 0 ? entry.cost : null;
  const canAdd = advice?.canAdd === true;
  if (!canAdd) {
    return `<p class="muted dividend-holdings-hint">本期策略结论：不加仓（${escapeHtml(advice?.reason || "不投")}）</p>`;
  }
  if (cost == null) {
    return `<p class="muted dividend-holdings-hint">补成本价后可生成分档加仓预案。</p>`;
  }

  const amount = Number(advice?.amount) || 0;
  const add1 = cost * 0.97;
  const levels = [
    { name: "第一档", trigger: add1, drawdown: "-3%", ratio: 0.4 },
    { name: "第二档", trigger: cost * 0.95, drawdown: "-5%", ratio: 0.6 },
  ];
  return `
    <div class="dividend-add-plan">
      <div class="dividend-add-levels">
        ${levels
          .map((level) => {
            const levelAmount = amount * level.ratio;
            const lots = level.trigger > 0 ? Math.floor(levelAmount / level.trigger / 100) * 100 : 0;
            const distance = price != null && price > 0 ? ((level.trigger - price) / price) * 100 : null;
            const triggered = price != null && price <= level.trigger;
            return `
              <article class="dividend-add-level${triggered ? " is-triggered" : ""}">
                <div class="dividend-add-level-top">
                  <strong>${level.name}</strong>
                  <span>${level.drawdown}</span>
                </div>
                <div class="dividend-add-trigger">
                  <small>触发价</small>
                  <strong>${level.trigger.toFixed(3)}</strong>
                </div>
                <dl>
                  <div>
                    <dt>距离现价</dt>
                    <dd>${triggered ? "已触发" : distance != null ? `${fmtSigned(distance, 2, "%")}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>预留额度</dt>
                    <dd>${money(levelAmount)}</dd>
                  </div>
                  <div>
                    <dt>参考份额</dt>
                    <dd>${lots > 0 ? `${lots.toLocaleString("zh-CN")} 份` : "不足 100 份"}</dd>
                  </div>
                </dl>
              </article>
            `;
          })
          .join("")}
      </div>
      <p class="muted dividend-add-plan-foot">两档合计不超过本期建议额 ${money(amount)}，实际成交以触发时价格为准。</p>
    </div>
  `;
}

function dcaAdviceHtml(advice, context) {
  const payload = currentPayload() || {};
  const score = payload.score || {};
  const grade = score.grade || "—";
  const proxy = payload.analysis_mode === "etf_proxy";
  const active = advice || currentPeriodAdvice();
  const symbol = state.analysisSymbol || payload.symbol || payload.etf?.symbol || "";
  const entry = state.etfs.find((item) => item.symbol === symbol);
  const price = payload.etf?.price != null ? payload.etf.price : payload.index?.close;
  const bullets = [...(active.bullets || [])];
  if (proxy && active.pePct == null) bullets.push("ETF 口径，无 PE 分位");

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
          <h2 class="section-title">定投建议</h2>
        </div>
        <span class="dividend-advice-grade">${escapeHtml(active.strategyName)} · ${escapeHtml(active.band)}</span>
      </div>
      <p class="dividend-advice-headline">${escapeHtml(active.headline)}</p>
      <ul class="dividend-advice-list">
        ${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
      ${executionPanelHtml(active, context)}
      ${context.cycle.remainingAmount > 0 ? addPlanHtml(entry, price, { ...active, amount: context.cycle.remainingAmount }) : ""}
    </section>
  `;
}

function holdingsPanel(symbol, price, advice, context) {
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
  const position = advice?.position || {};
  const rows = [
    ["目标仓位", position.targetWeight != null ? `${position.targetWeight.toFixed(1)}%` : "未设置"],
    ["当前仓位", position.actualWeight != null ? `${position.actualWeight.toFixed(1)}%` : "—"],
    ["买后仓位", context.position.projectedWeight != null ? `${context.position.projectedWeight.toFixed(1)}%` : "—"],
    ["偏离目标", position.drift != null ? `${signed(position.drift, 1)} pp` : "—"],
    ["允许上限", position.maxWeight != null ? `${position.maxWeight.toFixed(1)}%` : "—"],
    ["持有份额", entry.shares.toLocaleString("zh-CN")],
    ["成本价", cost != null ? cost.toFixed(3) : "—"],
    ["现价", price != null ? Number(price).toFixed(3) : "—"],
    ["市值", value != null ? money(value) : "—"],
    ["浮盈亏", pnl != null ? `${money(pnl)}（${signed(pnlPct, 1)}%）` : "—"],
  ];
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
    </div>
  `;
}

function holdingsCardHtml(advice, context) {
  const payload = currentPayload() || {};
  const price = payload.etf?.price != null ? payload.etf.price : payload.index?.close;
  const symbol = state.analysisSymbol || payload.symbol || payload.etf?.symbol || "";
  const active = advice || currentPeriodAdvice();

  return `
    <section class="panel-block dividend-holdings-card" aria-label="持仓对照">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">持仓对照</h2>
        </div>
      </div>
      ${holdingsPanel(symbol, price, active, context)}
    </section>
  `;
}

function optionalMetric(value, formatter) {
  return value == null || value === "" ? '<span class="decision-missing">暂无可靠数据</span>' : formatter(value);
}

function vehicleQualityHtml(context) {
  const payload = currentPayload() || {};
  const etf = payload.etf || {};
  const metadata = {
    ...(etf.product_quality || {}),
    ...(appConfig?.etf?.products?.[context.symbol] || {}),
  };
  const volume = etf.volume != null
    ? Number(etf.volume).toLocaleString("zh-CN", { maximumFractionDigits: 0 })
    : null;
  const rows = [
    ["当日成交量", optionalMetric(volume, (value) => `${value}（行情源口径）`)],
    ["基金规模", optionalMetric(metadata.fund_size_yi, (value) => `${fmt(value, 2)} 亿元`)],
    ["综合费率", optionalMetric(metadata.annual_fee_pct, (value) => `${fmt(value, 2)}% / 年`)],
    ["跟踪误差", optionalMetric(metadata.tracking_error_pct, (value) => `${fmt(value, 2)}%`)],
    ["溢价 / 折价", optionalMetric(metadata.premium_discount_pct, (value) => `${fmtSigned(value, 2, "%")}`)],
    ["买卖价差", optionalMetric(metadata.bid_ask_spread_pct, (value) => `${fmt(value, 3)}%`)],
  ];
  return `
    <section class="panel-block decision-detail-card" aria-label="ETF 交易质量">
      <div class="panel-heading"><div><h2 class="section-title">ETF 交易质量</h2></div></div>
      <dl class="decision-quality-grid">
        ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}
      </dl>
      <p class="muted decision-card-note">规模与费率来自东方财富基金档案；折溢价与价差来自腾讯实时盘口；跟踪误差为近一年 ETF 与指数同日收益差的年化估算。以上数据不参与建议金额计算。</p>
    </section>
  `;
}

function riskAndConfidenceHtml(context) {
  const payload = currentPayload() || {};
  const risk = context.risk;
  const correlation = context.strongestCorrelation;
  const errorCount = Object.keys(payload.errors || {}).length;
  const dataDate = String(payload.index?.date || "").slice(0, 10);
  const dataTime = dataDate ? new Date(`${dataDate}T00:00:00`).getTime() : Number.NaN;
  const stale = Number.isFinite(dataTime) && Date.now() - dataTime > 5 * 86_400_000;
  const confidenceLabel = stale
    ? "数据已陈旧"
    : errorCount
      ? `${errorCount} 项降级`
      : "数据完整";
  const analysisMode = payload.analysis_mode === "etf_proxy" ? "ETF 行情代理" : "完整指数映射";
  const rows = [
    ["年化波动", risk ? `${fmt(risk.annualizedVolatilityPct, 1)}%` : "—"],
    ["最大回撤", risk ? `${fmtSigned(risk.maxDrawdownPct, 1, "%")}` : "—"],
    ["最长水下期", risk ? `${risk.longestUnderwaterDays} 个交易日` : "—"],
    ["年化收益", risk ? `${fmtSigned(risk.annualizedReturnPct, 1, "%")}` : "—"],
    [
      "最高相关",
      correlation
        ? `${escapeHtml(correlation.name)} · ${fmt(correlation.correlation.value, 2)}`
        : "需先分析池内其他 ETF",
    ],
    ["历史样本", risk ? `${risk.samples} 个交易日` : "不足"],
  ];
  return `
    <section class="panel-block decision-detail-card" aria-label="风险与数据可信度">
      <div class="panel-heading">
        <div><h2 class="section-title">风险与数据可信度</h2></div>
        <span class="decision-confidence${errorCount || stale ? " is-degraded" : ""}">${confidenceLabel}</span>
      </div>
      <dl class="decision-quality-grid">
        ${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}
      </dl>
      <p class="muted decision-card-note">${escapeHtml(analysisMode)} · 行情 ${escapeHtml(payload.etf?.as_of || payload.updated_at || "时间未知")} · 指数 ${escapeHtml(payload.index?.date || "日期未知")}</p>
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
    ...sellEventMarkers(
      (state.sells || []).filter((item) => item.symbol === symbol),
      { useSellPrice: false },
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
  const context = decisionContext(advice);
  els.dividendContent.innerHTML = `
    ${errorsHtml()}
    <div class="dividend-hero">
      <div class="dividend-hero-main">
        ${scoreCardHtml()}
        ${dcaAdviceHtml(advice, context)}
      </div>
      <div class="dividend-hero-aside">
        <div class="metric-grid dividend-metrics">${metricsHtml()}</div>
        ${holdingsCardHtml(advice, context)}
      </div>
    </div>
    <div class="decision-detail-grid">
      ${vehicleQualityHtml(context)}
      ${riskAndConfidenceHtml(context)}
    </div>
    ${aiReviewHtml(advice, context)}
    <section class="panel-block dividend-chart-block">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">ETF 走势 · 年线与布林</h2>
          <p class="muted" id="indexChartSummary">加载区间… · ${escapeHtml(payload.chart?.name || payload.etf_name || "")}（${escapeHtml(payload.chart?.symbol || payload.symbol || "")}）</p>
        </div>
        <div class="range-segment" role="group" aria-label="ETF 走势区间">
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
        <canvas id="dividendChart" width="960" height="360" aria-label="ETF 价格走势"></canvas>
        <div class="price-tooltip" id="dividendChartTooltip" hidden></div>
      </div>
    </section>
    <section class="panel-block">
      <div class="panel-heading">
        <div>
          <h2 class="section-title">今日盘面</h2>
        </div>
        <span class="muted">规则点评 · 执行跟策略</span>
      </div>
      ${commentaryHtml()}
    </section>
    <section class="panel-block dividend-sources">
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
  const window = INDEX_CHART_RANGE_WINDOWS[rangeKey];
  if (window == null) return points;
  const lastDate = points[points.length - 1]?.date;
  if (!lastDate) return points;
  const end = new Date(`${lastDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return points;
  const start = new Date(end);
  if (window.days) start.setDate(start.getDate() - window.days);
  if (window.months) start.setMonth(start.getMonth() - window.months);
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
    const name = payload?.chart?.name || payload?.etf_name || "";
    const code = payload?.chart?.symbol || payload?.symbol || "";
    const buyCount = (markers || []).filter((item) => item?.date && item.key === "buy").length;
    summary.textContent = `${label} · ${points.length} 个交易日（${from} → ${to}） · ${name}${code ? `（${code}）` : ""} · ETF 实际价格 · 共可看 ${allPoints.length} 日${buyCount ? ` · 买入点 ${buyCount}` : ""}`;
  }
  drawPriceChart(canvas, tooltip, points, markers || [], "CNY", null, state.indexChartRange);
}

function bindIndexChartRangeControls() {
  if (!els.dividendContent || indexChartBound) return;
  indexChartBound = true;
  els.dividendContent.addEventListener("click", (event) => {
    const aiButton = event.target.closest?.("[data-ai-review]");
    if (aiButton && els.dividendContent.contains(aiButton)) {
      requestAIReview({ force: aiButton.dataset.force === "true" });
      return;
    }
    const choiceButton = event.target.closest?.("[data-ai-choice]");
    if (choiceButton && els.dividendContent.contains(choiceButton)) {
      const symbol = state.analysisSymbol || currentPayload()?.symbol || "";
      if (state.aiReviews[symbol]) {
        state.aiReviews[symbol].selection = choiceButton.dataset.aiChoice;
        paintDividend();
      }
      return;
    }
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
