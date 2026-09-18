import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../js/state.js';
import {runPortfolioSimulation,simulationPanel} from '../js/views/portfolio-simulation.js';

const portfolio=()=>({revision:1,accounts:[{id:'a',name:'账户'}],products:[]});
const response=()=>({ok:true,json:async()=>({status:'ready',strategies:[],coverage:[],limitations:[]})});

test('simulation retains submitted parameters and clears results when portfolio changes',async()=>{
  state.portfolioEnvelope={portfolio:portfolio()};
  const original=globalThis.fetch;
  globalThis.fetch=async()=>response();
  try {
    await runPortfolioSimulation({account_id:'a',budget:'2345',initial_cash:'77',cadence:'weekly',dip_pct:'5',years:'3'},()=>{});
    let html=simulationPanel(state.portfolioEnvelope.portfolio);
    assert.match(html,/模拟完成/);
    assert.match(html,/name="budget"[^>]*value="2345"/);
    assert.match(html,/<option value="3" selected>/);
    assert.doesNotMatch(html,/<option value="5" selected>/);
    state.portfolioEnvelope.portfolio.revision++;
    html=simulationPanel(state.portfolioEnvelope.portfolio);
    assert.match(html,/组合或行情已变化/);
    assert.doesNotMatch(html,/数据覆盖与模拟口径/);
  } finally {globalThis.fetch=original;}
});

test('late response cannot revive results for an edited portfolio',async()=>{
  state.portfolioEnvelope={portfolio:portfolio()};
  const original=globalThis.fetch;
  let finish;
  globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
  try {
    const pending=runPortfolioSimulation({account_id:'a',budget:1000,initial_cash:0,cadence:'monthly',dip_pct:5,years:3},()=>{});
    state.portfolioEnvelope.portfolio.revision++;
    finish(response());
    await pending;
    assert.match(simulationPanel(state.portfolioEnvelope.portfolio),/本次结果已失效/);
  } finally {globalThis.fetch=original;}
});
