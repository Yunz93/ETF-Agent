import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { SIMULATION_LABELS, simulationRequest, comparisonText } from "../strategy-simulation.js";

const money = v => `¥${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = v => Number.isFinite(v) ? `${v.toFixed(2)}%` : "不足一年";
let active = null;
let lastRun = null;

function requestFor(root) {
  return simulationRequest(state.etfs, state.quotesBySymbol, state.plan,
    Object.fromEntries(new FormData(root.querySelector("form"))));
}

function chartHtml(strategies) {
  const curves = strategies.map(s => s.curve);
  const profits = curves.flatMap(c => c.map(p => p.equity - p.capital));
  let low = Math.min(0, ...profits), high = Math.max(0, ...profits);
  if (high === low) { low = -1; high = 1; }
  const start = Date.parse(curves[0][0].date), end = Date.parse(curves[0].at(-1).date);
  const y = value => 210 - (value - low) / (high - low) * 200;
  const lines = curves.map((curve, i) => `<polyline class="simulation-line simulation-line-${i}" points="${curve.map(p => `${((Date.parse(p.date) - start) / (end - start) * 690 + 5).toFixed(2)},${y(p.equity - p.capital).toFixed(2)}`).join(" ")}" />`).join("");
  return `<figure class="simulation-chart"><figcaption>累计盈亏 <span class="muted">已扣佣金，包含闲置现金</span></figcaption>
    <div class="simulation-legend"><span>● 周期定投</span><span>┄ 逢低加仓</span></div>
    <div class="simulation-plot"><div class="simulation-axis"><span>${money(high)}</span><span>${money((high + low) / 2)}</span><span>${money(low)}</span></div>
      <svg viewBox="0 0 700 220" preserveAspectRatio="none" role="img" aria-label="两种策略的历史累计盈亏曲线，可用下方滑块查看逐日数值"><line x1="0" x2="700" y1="10" y2="10"/><line x1="0" x2="700" y1="110" y2="110"/><line x1="0" x2="700" y1="210" y2="210"/><line x1="0" x2="700" y1="${y(0)}" y2="${y(0)}"/>${lines}</svg></div>
    <div class="simulation-dates muted"><span>${curves[0][0].date}</span><span>${curves[0].at(-1).date}</span></div>
    <label class="simulation-scrubber">查看某日<input type="range" min="0" max="${curves[0].length - 1}" value="${curves[0].length - 1}" step="1" data-simulation-day /></label>
    <p class="simulation-readout" data-simulation-readout aria-live="polite"></p></figure>`;
}

function resultsHtml(result, names) {
  const coverage = `<details class="simulation-details"><summary>数据来源与模拟规则</summary>
    <p>本金收益率＝净盈亏 ÷ 累计投入；资金加权年化考虑每笔入金的时间。回撤按剔除入金影响的每日净值计算，不足一年不展示年化。</p>
    <ul>${(result.limitations || []).map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
    <div class="simulation-table-scroll" tabindex="0" role="region" aria-label="历史数据覆盖"><table class="goal-table simulation-table"><thead><tr><th>ETF / 来源</th><th>可用历史</th><th>记录数</th></tr></thead><tbody>${(result.coverage || []).map(r => `<tr><th>${escapeHtml(names[r.symbol] || r.symbol)}<small>${escapeHtml(r.symbol)} · ${escapeHtml(r.provider)}</small></th><td>${escapeHtml(r.start || "暂无")}<br>${escapeHtml(r.end || "")}</td><td>${r.observations}</td></tr>${r.error ? `<tr><td colspan="3">${escapeHtml(r.error)}</td></tr>` : ""}`).join("")}</tbody></table></div></details>`;
  if (result.status !== "ready") return `<p class="research-goal-note">${escapeHtml(result.limitations?.[0] || "本次未能完成模拟，请稍后重试。")}</p>${coverage}`;
  const [a, b] = result.strategies;
  const metrics = [
    ["期末总资产", s => money(s.ending_value)], ["累计净盈亏", s => money(s.net_profit)],
    ["本金收益率", s => pct(s.profit_on_capital_pct)],
    ["历史年化（资金加权）", s => Number.isFinite(s.money_weighted_return_pct) ? pct(s.money_weighted_return_pct)
      : Date.parse(result.end) - Date.parse(result.start) < 365 * 86400000 ? "不足一年" : "无法计算"],
    ["最大回撤（含现金）", s => pct(s.max_drawdown_pct)], ["期末闲置现金", s => money(s.ending_cash)],
    ["累计佣金", s => money(s.fees)], ["买入笔数", s => `${s.trade_count} 笔`],
  ];
  return `<div class="simulation-conclusion"><h4>${escapeHtml(comparisonText(a, b))}</h4>
    <p>${escapeHtml(result.start)} 至 ${escapeHtml(result.end)} · ${result.observations} 个共同交易日 · 两边各投入 ${money(a.contributed_capital)}</p>
    <p class="muted">本次参数：${result.cadence === "monthly" ? "每月" : "每周"}投入 ${money(result.budget)} · 回撤档距 ${result.dip_pct}% · 起始现金 ${money(result.initial_cash)}</p>
    <p class="muted">仅基于历史价格；分红与滑点未完整计入，不代表未来结果。</p></div>
    ${result.warnings.map(s => `<p class="research-goal-note">${escapeHtml(s)}</p>`).join("")}
    <table class="goal-table simulation-summary"><caption>相同组合、相同入金、相同费用</caption><thead><tr><th scope="col">组合对比</th><th scope="col">周期定投</th><th scope="col">逢低加仓</th></tr></thead>
    <tbody>${metrics.map(([label, fn]) => `<tr><th scope="row">${label}</th><td>${fn(a)}</td><td>${fn(b)}</td></tr>`).join("")}</tbody></table>
    ${chartHtml(result.strategies)}
    <h4>每只 ETF，哪种买法在这段历史里更好？</h4>
    <div class="simulation-table-scroll" tabindex="0" role="region" aria-label="每只 ETF 的策略比较"><table class="goal-table simulation-table"><thead><tr><th scope="col">ETF / 比例</th><th scope="col">定投净盈亏<small>本金收益率 / 最大回撤</small></th><th scope="col">逢低净盈亏<small>本金收益率 / 最大回撤</small></th><th scope="col">历史净收益较高</th></tr></thead><tbody>${a.etfs.map((row, i) => {
      const dip = b.etfs[i]; const delta = dip.net_profit - row.net_profit;
      return `<tr><th scope="row">${escapeHtml(names[row.symbol] || row.symbol)}<small>${escapeHtml(row.symbol)} · ${pct(row.weight)}</small></th><td>${money(row.net_profit)}<small>${pct(row.profit_on_capital_pct)} / ${pct(row.max_drawdown_pct)}</small><small>${row.trade_count} 笔 · 现金 ${money(row.ending_cash)}</small></td><td>${money(dip.net_profit)}<small>${pct(dip.profit_on_capital_pct)} / ${pct(dip.max_drawdown_pct)}</small><small>${dip.trade_count} 笔 · 现金 ${money(dip.ending_cash)}</small></td><td>${Math.abs(delta) < 0.01 ? "相同" : delta > 0 ? "逢低加仓" : "周期定投"}${row.blocked_days || dip.blocked_days ? "<small>部分买入受现金、整手或费用限制</small>" : ""}</td></tr>`;
    }).join("")}</tbody></table></div>
    <details class="simulation-details"><summary>模拟买入记录（共 ${a.trade_count + b.trade_count} 笔）</summary>
      <div class="simulation-table-scroll simulation-trade-scroll" tabindex="0" role="region" aria-label="模拟交易明细"><table class="goal-table simulation-table"><thead><tr><th>策略 / ETF</th><th>信号日 → 成交日</th><th>份额 / 价格</th><th>金额 / 佣金</th></tr></thead><tbody>${result.strategies.flatMap(s => s.trades.map(t => ({ ...t, mode: s.id }))).sort((x, y) => x.date.localeCompare(y.date)).slice(-200).map(t => `<tr><th>${SIMULATION_LABELS[t.mode]}<small>${escapeHtml(t.symbol)}${t.drawdown_tier ? ` · 第 ${t.drawdown_tier} 档` : ""}</small></th><td>${t.signal_date || "按周期"}<br>→ ${t.date}</td><td>${t.shares} 份<small>¥${t.price}</small></td><td>${money(t.amount)}<small>${money(t.fee)}</small></td></tr>`).join("")}</tbody></table></div></details>
    ${coverage}`;
}

function updateDay(root, result) {
  if (result?.status !== "ready") return;
  const slider = root.querySelector("[data-simulation-day]");
  const points = result.strategies.map(s => s.curve[Number(slider.value)]);
  root.querySelector("[data-simulation-readout]").textContent = `${points[0].date} · 定投 ${money(points[0].equity - points[0].capital)} · 逢低 ${money(points[1].equity - points[1].capital)}`;
  slider.setAttribute("aria-valuetext", points[0].date);
}

export function renderStrategySimulation() {
  const root = document.querySelector("#strategySimulationPanel");
  if (!root) return;
  if (!root.querySelector("form")) {
    root.innerHTML = `<div class="plan-section-heading"><h3 class="plan-section-title">同一组合，两种买法</h3></div>
      <form class="simulation-form">
        <label>组合比例<select name="basis"><option value="target">按目标比例</option><option value="holdings">按当前持仓市值比例</option></select></label>
        <label>历史区间<select name="years"><option value="1">最近 1 年</option><option value="3" selected>最近 3 年</option><option value="5">最近 5 年</option><option value="10">最近 10 年</option><option value="0">全部可用历史</option></select></label>
        <label>投入频率<select name="cadence"><option value="monthly">每月</option><option value="weekly">每周</option></select></label>
        <label>每期投入总额（元）<input name="budget" type="number" min="1" max="100000000" step="1" required /></label>
        <label>每回撤多少加一档（%）<input name="dip_pct" type="number" min="1" max="50" step="0.5" value="5" required list="simulationDipPresets" /><datalist id="simulationDipPresets"><option value="3"></option><option value="5"></option></datalist></label>
        <label>起始备用现金（元）<input name="initial_cash" type="number" min="0" max="100000000" step="1" value="0" required /></label>
        <div class="simulation-composition" data-simulation-composition></div>
        <details class="simulation-rules"><summary>计算规则与交易费用</summary><p><strong>周期定投：</strong>每个周期的首个共同交易日入金并买入，未花完的钱留到下期。</p>
        <p><strong>逢低加仓：</strong><span data-simulation-rule></span>每笔最多买入该 ETF 的一期额度，未触发的钱留作现金。</p>
        <p>两边同日拿到同样的钱，按比例分给各 ETF，互不挪用。起始现金另加在首期；定投首期会一并投入，逢低仍按档位分批买。</p><p data-simulation-cost></p><p>模拟不会修改持仓、计划或真实交易记录。</p></details>
        <div class="simulation-actions"><button type="submit" class="primary-button">开始比较</button><button type="button" class="ghost-button" data-simulation-cancel hidden>取消</button></div>
      </form>
      <p role="status" data-simulation-status class="muted"></p>
      <div data-simulation-result></div>`;
    root.querySelector("form").addEventListener("input", event => {
      if (event.target.name) root.dataset[`${event.target.name}Edited`] = "true";
      renderStrategySimulation();
    });
    root.querySelector("form").addEventListener("change", () => renderStrategySimulation());
    root.querySelector("[data-simulation-cancel]").addEventListener("click", () => active?.abort());
    root.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      if (active) return;
      let request;
      try { request = requestFor(root); } catch (error) {
        root.querySelector("[data-simulation-status]").textContent = error.message; return;
      }
      const controller = new AbortController(); active = controller;
      lastRun = { request, names: Object.fromEntries(state.etfs.map(e => [e.symbol, e.name || e.symbol])), result: null,
        message: "正在获取各 ETF 日线并对齐区间，首次获取可能需要一两分钟…" };
      renderStrategySimulation();
      const timeout = setTimeout(() => controller.abort("timeout"), 180000);
      try {
        const response = await fetch("/api/strategy/simulate", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request), signal: controller.signal });
        const result = await response.json();
        lastRun.result = result;
        lastRun.message = result.status === "ready" ? "模拟完成。可调整参数再比较。" : "未能生成可靠的对比，请查看下方原因。";
      } catch (error) {
        lastRun.message = controller.signal.aborted ? (controller.signal.reason === "timeout" ? "获取历史超时，请稍后重试。" : "已取消模拟。") : `模拟失败：${error.message}`;
      } finally {
        clearTimeout(timeout); active = null; renderStrategySimulation();
      }
    });
  }
  if (!lastRun && root.dataset.budgetEdited !== "true") root.querySelector('[name="budget"]').value = Math.round(state.plan?.amount || 20000);
  if (!lastRun && root.dataset.cadenceEdited !== "true") root.querySelector('[name="cadence"]').value = state.plan?.cadence === "weekly" ? "weekly" : "monthly";
  let current, issue;
  try { current = requestFor(root); } catch (error) { issue = error.message; }
  const names = Object.fromEntries(state.etfs.map(e => [e.symbol, e.name || e.symbol]));
  root.querySelector("[data-simulation-composition]").innerHTML = issue ? `<p class="research-goal-note">${escapeHtml(issue)}</p>`
    : `<div class="simulation-weight-list">${Object.entries(current.target_weights).map(([s, w]) => `<span>${escapeHtml(names[s] || s)} <b>${w.toFixed(1)}%</b></span>`).join("")}</div>`;
  const threshold = Number(root.querySelector('[name="dip_pct"]').value);
  root.querySelector("[data-simulation-rule]").textContent = `各 ETF 相对模拟期间的历史高点每回撤 ${threshold || "设定"}% 加一档${threshold > 0 ? `（如 ${threshold}%、${threshold * 2}%、${threshold * 3}%）` : ""}，同档只买一次，创新高后重置。信号次日买入。`;
  const cost = current?.trading_cost;
  root.querySelector("[data-simulation-cost]").textContent = cost ? `沿用计划费用：最低佣金 ${money(cost.min_commission)} · 费率 ${cost.commission_rate_pct}% · 费用占比上限 ${cost.max_fee_ratio_pct === 0 ? "不限制" : `${cost.max_fee_ratio_pct}%`} · ${cost.lot_size} 份起买` : "";
  root.querySelector('[type="submit"]').disabled = Boolean(active) || Boolean(issue);
  root.querySelector("[data-simulation-cancel]").hidden = !active;
  root.querySelector("[data-simulation-result]").setAttribute("aria-busy", String(Boolean(active)));
  if (lastRun) {
    const stale = !current || JSON.stringify(current) !== JSON.stringify(lastRun.request);
    root.querySelector("[data-simulation-status]").textContent = stale ? "参数、组合或费用已变化，下方为上次运行的结果，请重新比较。" : lastRun.message;
    root.querySelector("[data-simulation-status]").classList.toggle("research-stale", stale);
    if (root._simulationResult !== lastRun.result) {
      root.querySelector("[data-simulation-result]").innerHTML = lastRun.result ? resultsHtml(lastRun.result, lastRun.names) : "";
      root._simulationResult = lastRun.result;
      root.querySelector("[data-simulation-day]")?.addEventListener("input", () => updateDay(root, lastRun.result));
      updateDay(root, lastRun.result);
    }
  }
}
