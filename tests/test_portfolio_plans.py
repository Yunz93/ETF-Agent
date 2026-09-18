import unittest
from copy import deepcopy

from stockagent.portfolio_plans import proposals
from stockagent.portfolio_service import apply_command
from tests.test_portfolio_ledger import fixture


def planned(strategy='dca'):
    p = fixture()
    p['products'][0]['mark']['date'] = '2026-01-10'
    p['plans'] = [{'id':'plan1','name':'测试','account_id':'legacy','amount':1000,'strategy':strategy,
                   'cadence':'monthly','next_date':'2026-01-10','target_capital':1000,'drawdown_pct':5}]
    return p


class PortfolioPlansTests(unittest.TestCase):
    def test_dca_reserves_unconfigured_category_cash(self):
        p = planned()
        original = deepcopy(p)
        result = proposals(p, '2026-01-10')[0]
        self.assertEqual(result['orders'][0]['amount'], 400)
        self.assertEqual(result['unallocated'], 600)
        self.assertEqual(p, original)

    def test_initial_uses_remaining_target_not_recurring_weight(self):
        p = planned('initial')
        result = proposals(p, '2026-01-10')[0]
        self.assertEqual(result['orders'][0]['amount'], 200)
        self.assertEqual(result['unallocated'], 800)

    def test_pending_or_unknown_cash_does_not_get_spent(self):
        p = planned()
        p['accounts'][0]['opening_cash'] = None
        result = proposals(p, '2026-01-10')[0]
        self.assertFalse(result['orders'])
        self.assertTrue(result['blocked'])

    def test_cost_is_inside_budget_and_lot_rounding(self):
        p = planned()
        p['accounts'][0]['trading_cost'] = {'min_commission':5,'commission_rate_pct':0.03}
        result = proposals(p, '2026-01-10')[0]
        self.assertEqual(result['orders'][0]['amount'], 405)
        self.assertEqual(result['orders'][0]['estimated_fee'], 5)

    def test_substitution_requires_explicit_category_setting(self):
        p = planned()
        p['products'][0]['purchase_blocked'] = True
        p['products'].append({**p['products'][0], 'id':'other', 'purchase_blocked':False})
        self.assertFalse(proposals(p,'2026-01-10')[0]['orders'])
        p['categories'][0]['allow_substitution'] = True
        result = proposals(p,'2026-01-10')[0]['orders'][0]
        self.assertEqual(result['product_id'],'other')
        self.assertTrue(result['substituted'])

    def test_due_plan_never_writes_trade_and_advances_calendar(self):
        p = planned()
        p['plans'][0]['next_date'] = '2026-01-31'
        result = apply_command(p, {'action':'advance-plan','data':{'id':'plan1'}})
        self.assertEqual(result['plans'][0]['next_date'], '2026-02-28')
        self.assertEqual(result['transactions'], [])

    def test_dip_missing_history_cannot_invent_signal(self):
        self.assertFalse(proposals(planned('dip'),'2026-01-10')[0]['orders'])

    def test_category_weight_splits_between_exchange_and_otc(self):
        p = planned()
        p['products'][0]['allocation_weight']=50
        p['products'].append({**p['products'][0],'id':'fund:1','kind':'fund','name':'联接基金'})
        result=proposals(p,'2026-01-10')[0]
        self.assertEqual(len(result['orders']),2)
        self.assertEqual(result['orders'][0]['amount'],200)
        self.assertEqual(result['orders'][1]['amount'],225)
        self.assertEqual(result['unallocated'],575)
