import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFundDisclosures, lookThroughPortfolio } from '../js/portfolio-risk.js';
import { assessPortfolioGoal } from '../js/portfolio-goal.js';
import { normalizePlan, chooseWorkspaceSource } from '../js/workspace_model.js';
const today = new Date('2026-09-16T12:00:00Z');
const report = { as_of:'2026-06-30', source_url:'https://example.com/report', holdings:[{id:'US:ABC',name:'ABC',weight_pct:20,sector:'科技',currency:'USD'}] };
test('partial disclosed companies combine across funds without filling unknown exposure',()=>{
 const result=lookThroughPortfolio([{symbol:'513100',target:40},{symbol:'513500',target:60}],{'513100':report,'513500':report},today);
 assert.equal(result.known,20); assert.equal(result.companies[0].target,20); assert.equal(result.companies[0].funds.length,2); assert.equal(result.sectors[0].target,20);
});
test('stale, future and invalid disclosures cannot claim coverage',()=>{
 for(const date of ['2025-01-01','2027-01-01','2026-02-30']) {
  assert.equal(lookThroughPortfolio([{symbol:'513100',target:100}],{'513100':{...report,as_of:date}},today).known,0);
 }
 for(const weights of [[true],[NaN],[70,40],[20,20]]){
  const holdings=weights.map(weight_pct=>({id:'same',weight_pct}));
  assert.deepEqual(normalizeFundDisclosures({'513100':{...report,holdings}}),{});
 }
});
test('disclosure and account fields survive workspace normalization',()=>{
 const plan=normalizePlan({investment_goal:{account_cash:5000,account_debt:0,near_term_cash_need:1000},fund_disclosures:{'513100':report}});
 assert.deepEqual(plan.fund_disclosures['513100'],normalizeFundDisclosures({'513100':report})['513100']);
 assert.equal(plan.investment_goal.account_cash,5000); assert.equal(plan.investment_goal.account_debt,0);
});
const config={etfs:[{symbol:'513100',shares:100,target_weight:100}],quotes:{'513100':{price:10}},registry:{'513100':{index_code:'NDX'}},plan:{initial_target_pct:60,cash_reserve:{balance:500},amount:2000,trading_cost:{min_commission:5,max_fee_ratio_pct:0.05}}};
test('account stress includes cash once and debt; target uses initial proportion',()=>{
 const result=assessPortfolioGoal({...config,goal:{account_cash:1000,account_debt:0}});
 assert.ok(Math.abs(result.scenarios[0].current-45)<1e-9); assert.ok(Math.abs(result.scenarios[0].accountCurrent-22.5)<1e-9); assert.ok(Math.abs(result.scenarios[0].accountTarget-27)<1e-9);
 assert.equal(result.efficientAmount,10000);
 const leveraged=assessPortfolioGoal({...config,goal:{account_cash:0,account_debt:500}});
 assert.ok(Math.abs(leveraged.scenarios[0].accountCurrent-90)<1e-9);
});
test('unknown cash or debt and nonpositive net assets do not fabricate account returns',()=>{
 for(const goal of [{},{account_cash:1000},{account_cash:0,account_debt:1000}]) assert.equal(assessPortfolioGoal({...config,goal}).scenarios[0].accountCurrent,null);
});
test('currency and premium losses compound, growth shock differs from broad equity',()=>{
 const result=assessPortfolioGoal({...config,goal:{account_cash:0,account_debt:0}});
 assert.equal(result.scenarios[1].current,60);
 assert.ok(Math.abs(result.scenarios[2].current-(1-.85/1.05)*100)<1e-9);
 const domestic=assessPortfolioGoal({...config,registry:{'513100':{index_code:'000300'}}});
 assert.equal(domestic.scenarios[1].current,25); assert.equal(domestic.scenarios[2].current,0);
});

test('invalid total weights do not fabricate disclosure coverage and research-only workspace persists',()=>{
 assert.equal(lookThroughPortfolio([{symbol:'513100',target:200}],{'513100':report},today).known,null);
 const remote={etfs:[],plan:{fund_disclosures:{'513100':report}}};
 assert.equal(chooseWorkspaceSource(remote,null).source,'server');
 assert.deepEqual(normalizeFundDisclosures({'513100':{...report,source_url:'https://'}}),{});
 assert.deepEqual(normalizeFundDisclosures({'513100':{...report,holdings:Array.from({length:1001},(_,i)=>({id:String(i),weight_pct:.05}))}}),{});
});
