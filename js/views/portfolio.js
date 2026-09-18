import { state, els } from "../state.js";
import { escapeHtml, escapeAttr } from "../utils.js";
import { portfolioCommand } from "../portfolio-client.js";
import { callRenderer, registerRenderers } from "./render.js";
import { portfolioPlans } from "./portfolio-plans.js";
import { runPortfolioSimulation } from "./portfolio-simulation.js";
import { updateTransactionForm } from "../portfolio-transaction-fields.js";

const money = v => v == null ? "待补全" : `¥${Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const percent = v => v == null ? "—" : `${Number(v).toFixed(1)}%`;
const today = () => new Date().toLocaleDateString("sv-SE");
const uid = prefix => `${prefix}:${crypto.randomUUID()}`;
let selection = null;
let notice = "";
let busy = false;
const detailHistory = new Map();

function detailPerformance(type, id) {
  const envelope = state.portfolioEnvelope;
  if (!envelope.active) return '';
  const key = JSON.stringify([envelope.workspace_updated_at,envelope.portfolio.revision,type,id]);
  if (!detailHistory.has(key)) {
    detailHistory.set(key,{loading:true});
    fetch(`/api/portfolio/performance?kind=${type}&id=${encodeURIComponent(id)}`).then(async response=>{
      const body=await response.json();
      if(!response.ok) throw new Error(body.error||'无法读取收益历史');
      if(body.revision!==envelope.portfolio.revision||body.workspace_updated_at!==envelope.workspace_updated_at) throw new Error('组合已更新，请刷新后查看');
      detailHistory.set(key,{result:body.performance});
    }).catch(error=>detailHistory.set(key,{error:error.message})).finally(()=>{
      const panel=document.querySelector('[data-detail-performance]');
      if(panel?.dataset.detailPerformance===key) {
        const completed=detailHistory.get(key);
        panel.innerHTML=completed.result?performanceChart(completed.result):`<p role="status">${escapeHtml(completed.error)}</p>`;
      }
    });
  }
  const cached=detailHistory.get(key);
  return `<div data-detail-performance="${escapeAttr(key)}">${cached.result ? performanceChart(cached.result) : `<p role="status">${escapeHtml(cached.error||'正在读取收益历史…')}</p>`}</div>`;
}

function options(rows, selected = "") {
  return rows.map(r => `<option value="${escapeAttr(r.id)}"${r.id === selected ? " selected" : ""}>${escapeHtml(r.name)}</option>`).join("");
}

function field(label, name, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeAttr(String(value ?? ""))}" ${extra}/></label>`;
}

function stats(summary) {
  return `<div class="portfolio-stats">${[["总资产", summary.assets], ["基金市值", summary.value],
    ["可用现金", summary.cash], ["待确认资金", summary.pending], ["投资盈亏", summary.profit]].map(([name, value]) =>
    `<div><span>${name}</span><strong>${money(value)}</strong></div>`).join("")}</div>`;
}

function categoryTable(categories) {
  return `<div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>资产类别</th><th>目标</th><th>实际</th><th>偏离</th><th>市值</th><th>投资盈亏</th></tr></thead><tbody>${categories.map(c =>
    `<tr><th><button class="link-button" data-category="${escapeAttr(c.id)}">${escapeHtml(c.name)}</button></th><td>${percent(c.target_pct)}</td><td>${percent(c.actual_pct)}</td><td>${c.deviation_pct == null ? "—" : `${c.deviation_pct > 0 ? "+" : ""}${c.deviation_pct.toFixed(1)}%`}</td><td>${money(c.value)}</td><td>${money(c.profit)}</td></tr>`).join("")}</tbody></table></div>`;
}

function productTable(products) {
  return `<div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>产品</th><th>渠道</th><th>份额</th><th>市值</th><th>投资盈亏</th><th>持仓收益率</th><th>行情日期</th></tr></thead><tbody>${products.map(p =>
    `<tr><th><button class="link-button" data-product="${escapeAttr(p.id)}">${escapeHtml(p.name)}</button><small>${escapeHtml(p.symbol)}</small></th><td>${p.kind === "fund" ? "场外" : "场内"}</td><td>${p.shares ?? 0}</td><td>${money(p.value)}</td><td>${money(p.profit)}</td><td>${percent(p.holding_return_pct)}</td><td>${escapeHtml(p.mark?.date || "未录入")}</td></tr>`).join("")}</tbody></table></div>`;
}

function treemap(p, s) {
  const valued = s.categories.filter(c => c.value > 0);
  if (!valued.length) return `<p class="portfolio-empty">${p.openings.some(o => o.shares > 0) ? "持仓行情待补全，刷新场内行情或在产品详情录入场外净值。" : "添加产品和期初持仓后显示配置图。"}</p>`;
  return `<div class="portfolio-map" aria-label="按实际市值划分的资产配置">${valued.map(c => {
    const index = p.categories.findIndex(r => r.id === c.id);
    return `<div class="portfolio-map-category tone-${index % 6}" style="flex-basis:${c.value/valued.reduce((sum,row)=>sum+row.value,0)*100}%"><button data-category="${escapeAttr(c.id)}" title="${escapeAttr(c.name)} ${percent(c.actual_pct)}"><strong>${escapeHtml(c.name)}</strong><span>${percent(c.actual_pct)} · 目标 ${percent(c.target_pct)}</span></button><div class="portfolio-map-products">${s.products.filter(r => r.category_id === c.id && r.value > 0).map(r => `<button style="flex-grow:${r.value}" data-product="${escapeAttr(r.id)}"><span class="portfolio-map-name">${escapeHtml(r.name)}</span><span class="portfolio-map-channel">${r.kind === "fund" ? "场外" : "场内"}</span><strong>${money(r.value)}</strong><small>${r.kind === "fund" ? "场外" : "场内"} · 盈亏 ${money(r.profit)}</small></button>`).join("")}</div></div>`;
  }).join("")}</div>`;
}

function migration(p) {
  const issues = p.migration?.issues || [];
  return `<section class="portfolio-migration"><div><h2>核对组合迁移</h2><p>标普45% · 纳指25% · 黄金15% · 红利15%</p></div><button class="primary-button" data-activate ${busy ? "disabled" : ""}>备份并启用组合</button>
    <details><summary>迁移核对：${issues.length} 项 · 估算场外记录 ${p.migration?.estimated_trade_ids?.length || 0} 笔</summary>
    <p>以 ${escapeHtml(p.baseline_date)} 为建账日保留现有份额与成本，旧交易独立存档。尚未核对的现金保持未知。</p>
    <ul>${issues.map(i => `<li>${escapeHtml(i.symbol)}：${i.type === "shares_mismatch" ? `当前份额 ${i.holding_shares}，旧流水净份额 ${i.trade_shares}` : i.type === "cost_mismatch" ? `当前成本 ${money(i.holding_cost)}，旧流水成本 ${money(i.trade_cost)}` : i.type === "mixed_channels" ? "场内与场外记录混用，请在启用后核对产品类型与账户" : "需要指定资产类别"}</li>`).join("")}</ul></details></section>`;
}

function home(p, s) {
  return `${stats(s.total)}<section class="portfolio-section"><div class="portfolio-heading"><h2>资产配置</h2><button class="ghost-button" data-go="assets">调整配置</button></div>${treemap(p, s)}${categoryTable(s.categories)}</section>
    ${performanceChart(state.portfolioEnvelope.performance)}<section class="portfolio-section"><h2>待处理</h2>${p.transactions.filter(t => t.status === "pending").length ? `<button class="link-button" data-go="transactions">${p.transactions.filter(t => t.status === "pending").length} 笔申赎待确认</button>` : `<p class="muted">暂无待确认交易</p>`}
    ${(state.portfolioEnvelope.proposals||[]).filter(r=>r.due).map(r=>`<p><button class="link-button" data-go="plans">${escapeHtml(r.name)} · ${escapeHtml(r.date)} 待执行</button></p>`).join("")}
    ${s.products.filter(r => r.shares > 0 && !r.mark).map(r => `<p><button class="link-button" data-product="${escapeAttr(r.id)}">${escapeHtml(r.name)}：补充行情</button></p>`).join("")}</section>`;
}

function performanceChart(result) {
  const points = result?.points || [];
  const valid = points.filter(p => p.profit != null);
  if (valid.length < 2) return `<section class="portfolio-section"><h2>建账以来收益</h2><p class="portfolio-empty">${valid.length ? "积累至少两个日期的行情后显示收益曲线。" : "请补齐建账日现金与持仓行情。"}</p></section>`;
  const min = Math.min(0, ...valid.map(p => p.profit)), max = Math.max(0, ...valid.map(p => p.profit));
  const first = Date.parse(points[0].date), span = Math.max(1, Date.parse(points.at(-1).date) - first);
  const x = p => 70 + (Date.parse(p.date) - first) / span * 800;
  const y = p => 200 - (p.profit - min) / (max - min || 1) * 160;
  let connected = false;
  const path = points.map(p => {
    if (p.profit == null) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${x(p)},${y(p)}`;
  }).join(" ");
  return `<section class="portfolio-section"><div class="portfolio-heading"><h2>建账以来收益</h2><strong>${money(points.at(-1).profit)} · ${percent(points.at(-1).return_pct)}</strong></div><svg class="portfolio-performance" viewBox="0 0 900 240" role="img" aria-label="扣除入出金后的收益曲线"><text x="0" y="44">${money(max)}</text><text x="0" y="200">${money(min)}</text><path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>${valid.map(p => `<circle cx="${x(p)}" cy="${y(p)}" r="3"><title>${p.date}：${money(p.profit)}</title></circle>`).join("")}<text x="70" y="230">${points[0].date}</text><text x="790" y="230">${points.at(-1).date}</text></svg><details><summary>查看数据与计算口径</summary><p>${escapeHtml(result.method)}</p><table class="portfolio-table"><thead><tr><th>日期</th><th>资产</th><th>净入金</th><th>期间盈亏</th></tr></thead><tbody>${points.map(p => `<tr><td>${p.date}</td><td>${money(p.assets)}</td><td>${money(p.net_flows)}</td><td>${money(p.profit)}</td></tr>`).join("")}</tbody></table></details></section>`;
}

function assets(p, s) {
  if (selection?.type === "product") return productDetail(p, s, selection.id);
  if (selection?.type === "category") return categoryDetail(p, s, selection.id);
  return `<section class="portfolio-section"><h2>类别配置</h2><form data-form="categories" class="portfolio-form"><div class="portfolio-category-inputs">${p.categories.map(c => field(c.name, c.id, c.target_pct, "number", 'min="0" max="100" step="0.01" required')).join("")}</div><button class="primary-button">保存类别目标</button></form>
    <details><summary>新增资产类别</summary><form data-form="category" class="portfolio-form">${field("名称", "name", "", "text", "required")}<button class="ghost-button">新增</button></form></details>${categoryTable(s.categories)}</section>
    <section class="portfolio-section"><h2>基金产品</h2>${productTable(s.products)}<details><summary>添加产品</summary><form data-form="product" class="portfolio-form">
    ${field("产品名称", "name", "", "text", "required")}${field("产品代码", "symbol", "", "text", "required")}
    <label>类型<select name="kind"><option value="exchange">场内 ETF</option><option value="fund">场外基金／联接基金</option></select></label><label>资产类别<select name="category_id">${options(p.categories)}</select></label><button class="primary-button">添加产品</button></form></details></section>
    <section class="portfolio-section"><h2>账户</h2>${p.accounts.map(a => `<form data-form="account" class="portfolio-form" data-id="${escapeAttr(a.id)}">${field("账户名称", "name", a.name, "text", "required")}${field("建账日期现金（元）", "opening_cash", a.opening_cash, "number", 'min="0" step="0.01" placeholder="未知"')}${field("佣金费率（%）","commission_rate_pct",a.trading_cost?.commission_rate_pct??0,"number",'min="0" max="100" step="any"')}${field("最低佣金（元）","min_commission",a.trading_cost?.min_commission??0,"number",'min="0" step="any"')}<button class="ghost-button">保存</button><span>当前现金 ${money(s.accounts.find(r => r.id === a.id)?.cash)}</span></form>`).join("")}
    <details><summary>新增账户</summary><form data-form="account" class="portfolio-form">${field("账户名称", "name", "", "text", "required")}${field("期初现金（元）", "opening_cash", "", "number", 'min="0" step="0.01" placeholder="未知"')}<button class="primary-button">添加账户</button></form></details></section>`;
}

function categoryDetail(p, s, id) {
  const category = s.categories.find(c => c.id === id);
  if (!category) { selection = null; return assets(p, s); }
  const products = s.products.filter(r => r.category_id === id);
  return `<button class="ghost-button" data-back>返回资产与持仓</button><section class="portfolio-section"><h2>${escapeHtml(category.name)}</h2>
    <div class="portfolio-stats"><div><span>目标 / 实际</span><strong>${percent(category.target_pct)} / ${percent(category.actual_pct)}</strong></div><div><span>市值</span><strong>${money(category.value)}</strong></div><div><span>投资盈亏</span><strong>${money(category.profit)}</strong></div></div>
    <form data-form="category-routing" data-id="${escapeAttr(id)}" class="portfolio-form">${field("类别名称","name",category.name,"text","required")}<label>主要买入产品<select name="primary_product_id"><option value="">暂不指定</option>${options(products, category.primary_product_id)}</select></label><label>类内替代<select name="allow_substitution"><option value="false">关闭</option><option value="true"${category.allow_substitution ? " selected" : ""}>允许使用同类产品</option></select></label><button class="primary-button">保存</button></form>
    ${productTable(products)}</section>${detailPerformance("category",id)}`;
}

function productDetail(p, s, id) {
  const product = s.products.find(r => r.id === id);
  if (!product) { selection = null; return assets(p, s); }
  const positions = s.positions.filter(r => r.product_id === id);
  return `<button class="ghost-button" data-back>返回资产与持仓</button><section class="portfolio-section"><div class="portfolio-heading"><h2>${escapeHtml(product.name)} <small>${escapeHtml(product.symbol)}</small></h2>${product.kind === "exchange" ? `<button class="ghost-button" data-research="${escapeAttr(product.symbol)}">产品研究</button>` : ""}</div>
    <div class="portfolio-stats">${[["市值",product.value],["持仓盈亏",product.unrealized],["已实现盈亏",product.realized],["分红",product.dividends]].map(([name,v])=>`<div><span>${name}</span><strong>${money(v)}</strong></div>`).join("")}</div>
    <form data-form="product-edit" data-id="${escapeAttr(id)}" class="portfolio-form">${field("名称","name",product.name,"text","required")}${field("产品代码","symbol",product.symbol,"text","required")}<label>类别<select name="category_id">${options(p.categories,product.category_id)}</select></label><label>类型<select name="kind"><option value="exchange">场内ETF</option><option value="fund"${product.kind === "fund" ? " selected" : ""}>场外基金</option></select></label><button class="ghost-button">保存产品</button></form>
    <details><summary>买入规则与费用</summary><form data-form="product-terms" data-id="${escapeAttr(id)}" class="portfolio-form">
    ${field("类内分配权重","allocation_weight",product.allocation_weight||0,"number",'min="0" max="100" step="0.01"')}${field("交易单位（场内）","lot_size",product.lot_size||100,"number",'min="1" step="1"')}${field("买入费率（%）","fee_rate_pct",product.fee_rate_pct,"number",'min="0" max="100" step="any" placeholder="使用账户费率"')}${field("单笔限额（元）","purchase_limit",product.purchase_limit,"number",'min="0" step="any" placeholder="不限"')}${field("最低申购（元）","min_purchase",product.min_purchase??1,"number",'min="0" step="any"')}
    <label>产品状态<select name="active"><option value="true">使用中</option><option value="false"${product.active===false?' selected':''}>归档（保留持仓）</option></select></label><label>买入状态<select name="purchase_blocked"><option value="false">正常</option><option value="true"${product.purchase_blocked?' selected':''}>暂停买入</option></select></label><button class="ghost-button">保存买入规则</button></form></details>
    <h3>${product.kind === "fund" ? "基金净值" : "价格"} ${product.mark ? money(product.mark.price) : "待录入"}</h3><p class="muted">${escapeHtml(product.mark?.date || "")} ${escapeHtml(product.mark?.source || "")}</p>
    <details><summary>录入价格或净值</summary><form data-form="mark" data-id="${escapeAttr(id)}" class="portfolio-form">${field("日期","date",today(),"date","required")}${field("价格/净值","price","","number",'min="0.000001" step="any" required')}${field("来源","source","手动录入","text","required")}<button class="primary-button">保存行情</button></form></details>
    <details><summary>导入历史价格／净值</summary><form data-form="history" data-id="${escapeAttr(id)}" class="portfolio-form"><label>每行：日期,价格<textarea name="rows" rows="5" placeholder="2026-01-01,1.2345" required></textarea></label>${field("数据来源","source","","text","required")}<button class="primary-button">导入历史</button></form></details>
    <div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>账户</th><th>份额</th><th>成本</th><th>市值</th><th>盈亏</th></tr></thead><tbody>${positions.map(r=>`<tr><th>${escapeHtml(p.accounts.find(a=>a.id===r.account_id)?.name || "")}</th><td>${r.shares}</td><td>${money(r.cost)}</td><td>${money(r.value)}</td><td>${money(r.profit)}</td></tr>`).join("")}</tbody></table></div>
    <details><summary>录入期初持仓</summary><form data-form="opening" data-id="${escapeAttr(id)}" class="portfolio-form"><label>账户<select name="account_id">${options(p.accounts)}</select></label>${field("期初份额","shares","","number",'min="0" step="any" required')}${field("总成本（元）","cost_total","","number",'min="0" step="any" placeholder="未知"')}<button class="primary-button">保存期初</button></form></details>
    <h3>交易记录</h3>${transactionTable(p, p.transactions.filter(t=>t.product_id===id))}</section>${detailPerformance("product",id)}`;
}

const types = {buy:"买入／申购",sell:"卖出／赎回",deposit:"入金",withdrawal:"出金",dividend:"现金分红",reinvest:"红利再投",adjustment:"持仓校正"};
function transactionTable(p, trades) {
  if (!trades.length) return `<p class="muted">暂无交易</p>`;
  return `<div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>日期</th><th>产品 / 账户</th><th>类型</th><th>份额 / 金额</th><th>状态</th><th>操作</th></tr></thead><tbody>${[...trades].reverse().map(t=>`<tr><td>${escapeHtml(t.date)}</td><th>${escapeHtml(p.products.find(r=>r.id===t.product_id)?.name || "现金")}<small>${escapeHtml(p.accounts.find(r=>r.id===t.account_id)?.name || "")}</small></th><td>${types[t.type]}</td><td>${t.shares || "—"} / ${money(t.type === "buy" && t.status === "confirmed" ? t.shares*t.price+(t.fee||0) : t.type === "sell" && t.status === "confirmed" ? t.shares*t.price-(t.fee||0) : t.amount||0)}</td><td>${{pending:"待确认",confirmed:"已确认",cancelled:"已取消"}[t.status]}</td><td>${t.status === "pending" ? `<button class="link-button" data-confirm="${escapeAttr(t.id)}">确认</button> <button class="link-button" data-cancel="${escapeAttr(t.id)}">取消</button>` : `<button class="link-button" data-correct="${escapeAttr(t.id)}">更正</button>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function legacyTransactions(p) {
  const rows = [...(p.migration?.legacy_buys||[]).map(r=>({...r,side:"买入"})),...(p.migration?.legacy_sells||[]).map(r=>({...r,side:"卖出"}))];
  if(!rows.length) return '<p>暂无旧记录</p>';
  const estimated=new Set(p.migration?.estimated_trade_ids||[]);
  return `<div class="portfolio-table-wrap"><table class="portfolio-table"><thead><tr><th>日期</th><th>产品代码</th><th>方向</th><th>份额</th><th>价格</th><th>标记</th></tr></thead><tbody>${rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(r=>`<tr><td>${escapeHtml(r.date||"")}</td><td>${escapeHtml(r.symbol||"")}</td><td>${r.side}</td><td>${Number(r.shares)||0}</td><td>${money(r.price)}</td><td>${estimated.has(r.id)?"历史自动估算":"历史录入"}</td></tr>`).join("")}</tbody></table></div>`;
}

function transactions(p) {
  const correcting = selection?.type === "correct" && p.transactions.find(t=>t.id===selection.id);
  if (correcting) return `<section class="portfolio-section"><h2>更正交易</h2><p>${types[correcting.type]} · ${escapeHtml(p.products.find(r=>r.id===correcting.product_id)?.name || "现金")}</p><form data-form="correct" data-trade-type="${escapeAttr(correcting.type)}" data-trade-status="${correcting.status==='cancelled'&&!correcting.price?'pending':'confirmed'}" data-id="${escapeAttr(correcting.id)}" class="portfolio-form">
    ${field("日期","date",correcting.date,"date","required")}${field("份额","shares",correcting.shares||0,"number",'min="0" step="any"')}${field("价格/净值","price",correcting.price||0,"number",'min="0" step="any"')}${field("金额","amount",correcting.amount||0,"number",'min="0" step="any"')}${field("手续费","fee",correcting.fee||0,"number",'min="0" step="any"')}${field("校正后总成本","cost_total",correcting.cost_total,"number",'min="0" step="any"')}${field("备注／校正原因","note",correcting.note||"")}${field("更正原因","reason","","text","required")}
    <button class="primary-button">保存更正</button><button type="button" class="ghost-button" data-back>返回</button></form>
    <details><summary>更正历史（${correcting.corrections?.length||0}）</summary>${(correcting.corrections||[]).map(c=>`<p>${escapeHtml(c.reason)} · 原日期 ${escapeHtml(c.before.date)} · 原份额 ${Number(c.before.shares)||0} · 原价格 ${Number(c.before.price)||0}</p>`).join("")}</details></section>`;
  const confirming = selection?.type === "confirm" && p.transactions.find(t=>t.id===selection.id);
  return `<section class="portfolio-section"><h2>${confirming ? "确认申赎" : "录入交易"}</h2><form data-form="${confirming ? "confirm" : "trade"}" data-id="${escapeAttr(confirming?.id || "")}" class="portfolio-form">
    ${!confirming ? `<label>类型<select name="type">${Object.entries(types).map(([key,name])=>`<option value="${key}">${name}</option>`).join("")}</select></label><label>产品<select name="product_id">${options(p.products)}</select></label><label>账户<select name="account_id">${options(p.accounts)}</select></label><label>状态<select name="status"><option value="confirmed">已成交</option><option value="pending">申请待确认</option></select></label>` : `<p>${escapeHtml(p.products.find(r=>r.id===confirming.product_id)?.name || "")} · 申请金额 ${money(confirming.amount||0)}</p>`}
    ${field("日期","date",today(),"date","required")}${field("份额","shares",confirming?.shares || 0,"number",'min="0" step="any"')}${field("成交价格/净值","price",0,"number",'min="0" step="any"')}${field("手续费（元）","fee",0,"number",'min="0" step="any"')}
    ${!confirming ? `${field("申购／入出金／分红金额（元）","amount",0,"number",'min="0" step="any"')}${field("校正后总成本（元）","cost_total","","number",'min="0" step="any"')}${field("备注／校正原因","note")}` : ""}
    <button class="primary-button">${confirming ? "按实际成交确认" : "记录交易"}</button>${confirming ? '<button type="button" class="ghost-button" data-back>返回</button>' : ""}</form></section><section class="portfolio-section"><h2>交易流水</h2>${transactionTable(p,p.transactions)}
    <details><summary>迁移前交易档案</summary><p>以下记录不重复计入期初持仓。</p>${legacyTransactions(p)}</details></section>`;
}

export async function refreshPortfolio() {
  const startingView=state.activeView;
  try {
    busy = true;
    await portfolioCommand("refresh");
    notice = state.portfolioEnvelope.quote_warning || "行情已更新";
  } catch (error) { notice = error.message; }
  finally {
    busy = false;
    if(state.activeView===startingView&&!document.activeElement?.closest('form')) renderPortfolio();
    else renderPortfolioSidebar();
  }
}

export function renderPortfolio() {
  const view = ["home","assets","transactions","plans"].includes(state.activeView) ? state.activeView : "home";
  const root = document.querySelector(`#${view}View [data-portfolio-root]`);
  if (!root) return;
  const data = state.portfolioEnvelope;
  if (!data) { root.innerHTML = '<p role="status">正在读取组合…</p>'; return; }
  const p = data.portfolio, s = data.summary;
  root.innerHTML = `${!data.active ? migration(p) : ""}<p role="status" class="portfolio-status">${escapeHtml(notice)}</p>${s.warnings.map(w=>`<p class="portfolio-warning">${escapeHtml(w)}</p>`).join("")}${view === "home" ? home(p,s) : view === "assets" ? assets(p,s) : view === "transactions" ? transactions(p) : portfolioPlans(p,data.proposals)}`;
  if (els.topSourceStatus) els.topSourceStatus.textContent = busy ? "正在更新" : s.warnings.length ? "行情待补全" : "组合已载入";
  root.querySelectorAll('[data-form="trade"], [data-form="correct"]').forEach(updateTransactionForm);
  root.onchange = event => {
    const form = event.target.closest('[data-form="trade"]');
    if (form && ['type','status'].includes(event.target.name)) updateTransactionForm(form);
  };
  root.onclick = event => {
    const p=state.portfolioEnvelope.portfolio;
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.go) { selection = null; callRenderer("switchView",button.dataset.go); }
    if (button.dataset.category) { selection = {type:"category",id:button.dataset.category}; callRenderer("switchView","assets"); }
    if (button.dataset.product) { selection = {type:"product",id:button.dataset.product}; callRenderer("switchView","assets"); }
    if (button.hasAttribute("data-back")) { selection = null; renderPortfolio(); }
    if (button.dataset.research) callRenderer("openAnalysis",button.dataset.research);
    if (button.hasAttribute("data-activate")) save("activate",p);
    if (button.dataset.cancel) save("cancel",{id:button.dataset.cancel});
    if (button.dataset.correct) { selection = {type:"correct",id:button.dataset.correct}; callRenderer("switchView","transactions"); }
    if (button.dataset.confirm) { selection = {type:"confirm",id:button.dataset.confirm}; callRenderer("switchView","transactions"); }
    if (button.dataset.planToggle) save("configure",{plans:p.plans.map(plan=>plan.id===button.dataset.planToggle?{...plan,enabled:plan.enabled===false}:plan)});
    if (button.dataset.planAdvance) save("advance-plan",{id:button.dataset.planAdvance});
  };
  root.onsubmit = async event => {
    event.preventDefault();
    const p=state.portfolioEnvelope.portfolio;
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    for (const key of ["opening_cash","shares","cost_total","price","amount","fee","target_capital","drawdown_pct","allocation_weight","lot_size","fee_rate_pct","purchase_limit","min_purchase","commission_rate_pct","min_commission"]) if (key in values) values[key] = values[key] === "" ? null : Number(values[key]);
    const type = form.dataset.form, id = form.dataset.id;
    if (type === "portfolio-simulation") return runPortfolioSimulation(values,renderPortfolio);
    if (type === "categories") return save("configure",{categories:p.categories.map(c=>({...c,target_pct:Number(values[c.id])}))});
    if (type === "category") return save("configure",{categories:[...p.categories,{id:uid("category"),name:values.name,target_pct:0,primary_product_id:null,allow_substitution:false}]});
    if (type === "product") return save("configure",{products:[...p.products,{...values,id:uid("product"),currency:"CNY",mark:null,allocation_weight:0,active:true}]});
    if (type === "product-edit") return save("configure",{products:p.products.map(r=>r.id===id?{...r,...values}:r),categories:p.categories.map(c=>c.primary_product_id===id&&c.id!==values.category_id?{...c,primary_product_id:null}:c)});
    if (type === "category-routing") return save("configure",{categories:p.categories.map(c=>c.id===id?{...c,name:values.name,primary_product_id:values.primary_product_id||null,allow_substitution:values.allow_substitution==="true"}:c)});
    if (type === "product-terms") {
      values.purchase_blocked = values.purchase_blocked === "true";
      values.active = values.active === "true";
      if (values.fee_rate_pct == null) delete values.fee_rate_pct;
      return save("configure",{products:p.products.map(r=>r.id===id?{...r,...values,fee_rate_pct:values.fee_rate_pct}:r)});
    }
    if (type === "account") {
      values.trading_cost = {commission_rate_pct:values.commission_rate_pct??0.03,min_commission:values.min_commission??5};
      delete values.commission_rate_pct; delete values.min_commission;
      return save("configure",{accounts:id?p.accounts.map(a=>a.id===id?{...a,...values}:a):[...p.accounts,{...values,id:uid("account")}]});
    }
    if (type === "opening") return save("configure",{openings:[...p.openings.filter(o=>!(o.product_id===id&&o.account_id===values.account_id)),{...values,id:uid("opening"),product_id:id}]});
    if (type === "mark") return save("mark",{...values,product_id:id});
    if (type === "history") {
      const rows = values.rows.trim().split(/\r?\n/).map(line => {
        const [date, price] = line.trim().split(/[,，\t]/);
        return {date:date?.trim(),price:Number(price),source:values.source};
      });
      return save("history",{product_id:id,rows});
    }
    if (type === "trade") return save("record",values);
    if (type === "plan") return save("configure",{plans:id?p.plans.map(plan=>plan.id===id?{...plan,...values}:plan):[...p.plans,{...values,id:uid("plan"),enabled:true}]});
    if (type === "confirm") return save("confirm",{...values,id});
    if (type === "correct") return save("correct",{...values,id});
  };
  renderPortfolioSidebar();
}

async function save(action, data) {
  if (busy) return;
  busy = true;
  try {
    await portfolioCommand(action,data);
    notice = "已保存";
    if (["confirm","correct"].includes(action)) selection = null;
    busy = false;
    renderPortfolio();
  } catch (error) {
    notice = error.message;
    const status = document.querySelector(`#${state.activeView}View .portfolio-status`);
    if (status) status.textContent = notice;
  } finally { busy = false; }
}

export function renderPortfolioSidebar() {
  if (!els.sidebarEtfList || !state.portfolioEnvelope) return;
  els.sidebarEtfList.innerHTML = state.portfolioEnvelope.portfolio.categories.map(c=>`<button type="button" class="sidebar-etf-item" data-category="${escapeAttr(c.id)}" title="${escapeAttr(c.name)}"><span class="sidebar-etf-mark">${escapeHtml(c.name.slice(0,1))}</span><span class="sidebar-etf-name"><strong>${escapeHtml(c.name)}</strong></span><span class="sidebar-etf-meta">${percent(c.target_pct)}</span></button>`).join("");
  els.sidebarEtfList.onclick = event => {
    const button = event.target.closest("[data-category]");
    if (button) { selection={type:"category",id:button.dataset.category};callRenderer("switchView","assets"); }
  };
  if (els.sidebarPoolCount) els.sidebarPoolCount.textContent=state.portfolioEnvelope.portfolio.categories.length;
}

registerRenderers({renderPortfolio,renderPortfolioSidebar,refreshPortfolio,
  renderEtfPool:async({refresh=false}={})=>refresh?refreshPortfolio():renderPortfolio(),
  renderSidebarEtfs:renderPortfolioSidebar});
