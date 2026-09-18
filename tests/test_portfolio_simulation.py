import unittest
from datetime import date, timedelta
from copy import deepcopy

from stockagent.portfolio_simulation import evaluate
from tests.test_portfolio_ledger import fixture


class PortfolioSimulationTests(unittest.TestCase):
    def fixture(self):
        p=fixture()
        for c in p['categories']:
            c['target_pct']=100 if c['id']=='sp500' else 0
        product=p['products'][0]
        product['kind']='fund'
        product['price_history']=[{'date':(date(2025,1,1)+timedelta(days=i)).isoformat(),'price':2 if i<35 else 1.8,'source':'测试历史'} for i in range(90)]
        return p

    def test_otc_history_fractional_shares_and_identical_cashflows(self):
        p=self.fixture(); before=deepcopy(p)
        status,result=evaluate(p,{'budget':100,'account_id':'legacy','years':0},today=date(2025,4,2))
        self.assertEqual(status,200)
        a,b=result['strategies']
        self.assertEqual(a['contributed_capital'],b['contributed_capital'])
        self.assertTrue(all(t['signal_date']<t['date'] for t in b['trades']))
        self.assertEqual(p,before)
        self.assertTrue(any(t['shares']%100 for t in a['trades']))

    def test_otc_missing_history_never_uses_exchange_proxy(self):
        p=self.fixture();p['products'][0]['price_history']=[]
        def forbidden(*args,**kwargs):
            self.fail('场外不应使用场内行情')
        status,result=evaluate(p,{'budget':100,'account_id':'legacy'},loader=forbidden)
        self.assertEqual(status,422)
        self.assertFalse(result['strategies'])

    def test_product_fee_is_included(self):
        p=self.fixture();p['products'][0]['fee_rate_pct']=1
        status,result=evaluate(p,{'budget':100,'account_id':'legacy','years':0},today=date(2025,4,2))
        self.assertEqual(status,200)
        self.assertGreater(result['strategies'][0]['fees'],0)
        self.assertGreaterEqual(result['strategies'][0]['ending_cash'],0)

    def test_current_holdings_mode_uses_market_value_not_target_weights(self):
        p=self.fixture()
        p['categories'][0]['target_pct']=0
        p['categories'][1]['target_pct']=100
        status,result=evaluate(p,{'budget':100,'account_id':'legacy','years':0,'weight_mode':'holdings'},today=date(2025,4,2))
        self.assertEqual(status,200)
        self.assertEqual(result['target_weights'],{'exchange:513500':100})
