import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionFields} from '../js/portfolio-transaction-fields.js';

test('cashflow entry never requires an ETF or execution price',()=>{
  for(const kind of ['deposit','withdrawal']) {
    const fields=transactionFields(kind);
    assert.ok(fields.includes('amount'));
    for(const name of ['shares','price','product_id','cost_total','fee']) assert.ok(!fields.includes(name));
  }
});
test('subscription application and settlement collect different facts',()=>{
  assert.ok(transactionFields('buy','pending').includes('amount'));
  assert.ok(!transactionFields('buy','pending').includes('price'));
  assert.ok(transactionFields('buy','confirmed').includes('price'));
  assert.ok(!transactionFields('buy','confirmed').includes('amount'));
  assert.ok(transactionFields('sell','pending').includes('shares'));
});
test('position correction permits cost and shares without a fake trade price',()=>{
  assert.ok(transactionFields('adjustment').includes('cost_total'));
  assert.ok(!transactionFields('adjustment').includes('price'));
});
