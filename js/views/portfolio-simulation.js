import {escapeHtml,escapeAttr} from '../utils.js';
import {state} from '../state.js';

let result = null;
let running = false;
let message = '';
let sourceSignature = null;
let inputs = {budget:1000,initial_cash:0,cadence:'monthly',dip_pct:5,years:3,weight_mode:'target'};
const names = {periodic:'周期定投',dip:'逢低加仓'};
const number = (v, suffix='') => v == null ? '—' : `${Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2})}${suffix}`;

export function simulationPanel(p) {
  if (result && sourceSignature !== JSON.stringify(p)) {
    result = null;
    message = '组合或行情已变化，请重新模拟';
  }
  return `<section class="portfolio-section"><h2>历史买入策略对比</h2><form data-form="portfolio-simulation" class="portfolio-form">
    <label>组合权重<select name="weight_mode"><option value="target">类别目标比例</option><option value="holdings">当前持仓市值比例</option></select></label>
    <label>费用账户<select name="account_id">${p.accounts.map(a=>`<option value="${escapeAttr(a.id)}">${escapeHtml(a.name)}</option>`).join('')}</select></label>
    <label>每期投入（元）<input name="budget" type="number" min="1" max="100000000" value="1000" required></label>
    <label>起始现金（元）<input name="initial_cash" type="number" min="0" max="100000000" value="0" required></label>
    <label>周期<select name="cadence"><option value="monthly">每月</option><option value="weekly">每周</option></select></label>
    <label>回撤档距（%）<input name="dip_pct" type="number" min="1" max="50" step="0.1" value="5" required></label>
    <label>历史区间<select name="years"><option value="3">近3年</option><option value="1">近1年</option><option value="5">近5年</option><option value="10">近10年</option><option value="0">全部</option></select></label>
    <button class="primary-button" ${running?'disabled':''}>${running?'正在模拟…':'比较策略'}</button></form>
    <p role="status">${escapeHtml(message)}</p>${result?renderResult(result):''}</section>`
    .replace(/(<input name="(budget|initial_cash|dip_pct)"[^>]*value=")[^"]*/g, (_,prefix,key)=>prefix+escapeAttr(String(inputs[key])))
    .replace(/<select name="([^"]+)">([\s\S]*?)<\/select>/g,(_,key,content)=>`<select name="${key}">${content.replace(/<option value="([^"]+)"/g,(tag,value)=>tag+(String(inputs[key])===value?' selected':''))}</select>`);
}

function comparisonChart(strategies) {
  const values = strategies.flatMap(s=>s.curve.map(p=>p.equity));
  const max = Math.max(1,...values);
  const first = Date.parse(strategies[0].curve[0].date);
  const last = Date.parse(strategies[0].curve.at(-1).date);
  return `<figure class="simulation-chart"><figcaption>总资产走势（含闲置现金）</figcaption><div class="simulation-legend"><span>周期定投</span><span>逢低加仓</span></div><svg class="portfolio-performance" viewBox="0 0 900 240" role="img" aria-label="周期定投与逢低加仓的总资产走势">${strategies.map((s,index)=>`<path class="simulation-line simulation-line-${index}" d="${s.curve.map((p,i)=>`${i?'L':'M'}${70+(Date.parse(p.date)-first)/Math.max(1,last-first)*800},${200-p.equity/max*170}`).join(' ')}"/>`).join('')}<text x="0" y="30">${number(max)}</text><text x="0" y="200">0</text><text x="70" y="230">${strategies[0].curve[0].date}</text><text x="790" y="230">${strategies[0].curve.at(-1).date}</text></svg></figure>`;
}

function renderResult(r) {
  const strategies=r.strategies||[];
  return `${strategies.length?`<p>${escapeHtml(r.start)} — ${escapeHtml(r.end)} · ${r.observations} 个共同日期</p>
    ${comparisonChart(strategies)}
    <div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>指标</th>${strategies.map(s=>`<th>${names[s.id]}</th>`).join('')}</tr></thead><tbody>${[['累计投入','contributed_capital','元'],['期末资产','ending_value','元'],['投资盈亏','net_profit','元'],['资金加权年化','money_weighted_return_pct','%'],['时间加权区间收益','time_weighted_return_pct','%'],['最大回撤','max_drawdown_pct','%'],['闲置现金','ending_cash','元'],['总费用','fees','元']].map(([label,key,unit])=>`<tr><th>${label}</th>${strategies.map(s=>`<td>${number(s[key],unit)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <details><summary>逐产品结果</summary>${strategies.map(s=>`<h3>${names[s.id]}</h3><div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>产品</th><th>投入</th><th>期末资产</th><th>盈亏</th><th>买入次数</th></tr></thead><tbody>${s.etfs.map(e=>`<tr><th>${escapeHtml(r.product_names[e.symbol])}</th><td>${number(e.contributed_capital)}</td><td>${number(e.ending_value)}</td><td>${number(e.net_profit)}</td><td>${e.trade_count}</td></tr>`).join('')}</tbody></table></div>`).join('')}</details>`:''}
    <details ${strategies.length?'':'open'}><summary>数据覆盖与模拟口径</summary>${(r.coverage||[]).map(c=>`<p>${escapeHtml(c.name)} · ${c.observations} 条 · ${escapeHtml(c.provider)} · ${escapeHtml(c.start||'无数据')} — ${escapeHtml(c.end||'')}</p>`).join('')}<ul>${(r.limitations||[]).map(t=>`<li>${escapeHtml(t)}</li>`).join('')}</ul></details>`;
}

export async function runPortfolioSimulation(values, render) {
  if(running) return;
  inputs={...values};
  sourceSignature=JSON.stringify(state.portfolioEnvelope.portfolio);
  running=true;message='正在读取所选产品的历史数据';result=null;render();
  try {
    const payload={...values};
    const current=state.portfolioEnvelope;
    payload.revision=current.portfolio.revision;
    payload.workspace_updated_at=current.workspace_updated_at;
    if(!current.active) payload.draft=current.portfolio;
    for(const key of ['budget','initial_cash','dip_pct','years']) payload[key]=Number(payload[key]);
    const response=await fetch('/api/portfolio/simulation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await response.json();
    if(!response.ok&&response.status!==422) throw new Error(body.error||(body.limitations||[]).join('；')||'模拟失败');
    if(sourceSignature!==JSON.stringify(state.portfolioEnvelope.portfolio)) {
      message='组合已变化，本次结果已失效，请重新模拟';
    } else {
      result=body;message=body.status==='ready'?'模拟完成':'历史数据不足，未生成收益结果';
    }
  } catch(error) {message=error.message;} finally {running=false;render();}
}
