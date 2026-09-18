import { escapeHtml, escapeAttr } from "../utils.js";
import { simulationPanel } from "./portfolio-simulation.js";

const money = v => v == null ? "未知" : `¥${Number(v).toLocaleString("zh-CN",{maximumFractionDigits:2})}`;
const strategies = {initial:"初期建仓",dca:"周期定投",dip:"逢低加仓"};

function planForm(p, plan = {}) {
  return `<form data-form="plan" data-id="${escapeAttr(plan.id||'')}" class="portfolio-form">
    <label>名称<input name="name" value="${escapeAttr(plan.name||'')}" required></label>
    <label>策略<select name="strategy">${Object.entries(strategies).map(([id,name])=>`<option value="${id}">${name}</option>`).join("")}</select></label>
    <label>资金账户<select name="account_id">${p.accounts.map(a=>`<option value="${escapeAttr(a.id)}">${escapeHtml(a.name)}</option>`).join("")}</select></label>
    <label>本期预算（元）<input name="amount" type="number" min="0.01" step="0.01" value="${Number(plan.amount)||1000}" required></label>
    <label>建仓目标总额（元）<input name="target_capital" type="number" min="0" step="0.01" value="${Number(plan.target_capital)||0}"></label>
    <label>回撤阈值（%）<input name="drawdown_pct" type="number" min="0.1" max="99.9" step="0.1" value="${Number(plan.drawdown_pct)||5}"></label>
    <label>周期<select name="cadence"><option value="monthly">每月</option><option value="weekly">每周</option></select></label>
    <label>下次执行日期<input name="next_date" type="date" value="${escapeAttr(plan.next_date||new Date().toLocaleDateString('sv-SE'))}" required></label>
    <button class="primary-button">保存计划</button></form>`.replace(/<select name="([^"]+)">([\s\S]*?)<\/select>/g,(_,key,content)=>`<select name="${key}">${content.replace(/<option value="([^"]+)"/g,(tag,value)=>tag+(String(plan[key])===value?' selected':''))}</select>`);
}

export function portfolioPlans(p, proposals = []) {
  const legacy = p.migration?.legacy_plan || {};
  return `<section class="portfolio-section"><h2>新增投资计划</h2>${planForm(p,{amount:legacy.amount,target_capital:legacy.capital_base})}</section>
    ${p.plans.map(plan=>{
      const proposal=proposals.find(r=>r.id===plan.id);
      return `<section class="portfolio-section"><div class="portfolio-heading"><h2>${escapeHtml(plan.name)} · ${strategies[plan.strategy]}</h2><button class="ghost-button" ${plan.enabled===false?'disabled':''} data-plan-advance="${escapeAttr(plan.id)}">本期处理完毕</button></div>
        <p>${plan.enabled===false?'已停用 · ':''}${escapeHtml(plan.next_date)} · ${plan.cadence==='weekly'?'每周':'每月'} · 预算 ${money(plan.amount)}${proposal?.due?' · 待执行':''}</p>
        ${proposal ? `<div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>类别</th><th>产品</th><th>预算金额</th><th>预计费用</th><th>建议份额</th></tr></thead><tbody>${proposal.orders.map(order=>`<tr><th>${escapeHtml(p.categories.find(c=>c.id===order.category_id)?.name||'')}</th><td><button class="link-button" data-product="${escapeAttr(order.product_id)}">${escapeHtml(p.products.find(r=>r.id===order.product_id)?.name||'')}</button>${order.substituted?'（类内替代）':''}</td><td>${money(order.amount)}</td><td>${money(order.estimated_fee)}</td><td>${order.shares??'以申购确认份额为准'}</td></tr>`).join('')}</tbody></table></div><p>保留现金 ${money(proposal.unallocated)}</p>${proposal.blocked.map(reason=>`<p class="portfolio-warning">${escapeHtml(reason)}</p>`).join('')}`:`<p>${plan.enabled===false?'计划已停用':'保存并启用组合后生成分配明细。'}</p>`}
        <button class="primary-button" data-go="transactions">录入实际交易</button>
        <button class="ghost-button" data-plan-toggle="${escapeAttr(plan.id)}">${plan.enabled===false?'启用':'停用'}</button><details><summary>编辑计划</summary>${planForm(p,plan)}</details></section>`;
    }).join('')}
    <details class="portfolio-section"><summary>计算规则</summary><p>初期建仓按类别目标金额减现有市值分配；定投按类别目标比例分配；逢低加仓按主要产品最近120条历史价格的高点回撤判断，至少需要20条记录。未满足条件的资金保留现金。</p><p>计划不会自动产生真实成交。场内按交易单位及费用取整；场外以申购金额生成建议，实际份额在交易记录中确认。</p></details>${simulationPanel(p)}`;
}
