import unittest

from stockagent.portfolio_ledger import replay, validate_portfolio, PortfolioError
from stockagent.portfolio_performance import performance
from stockagent.portfolio_service import apply_command
from tests.test_portfolio_ledger import fixture, trade


class PortfolioPerformanceTests(unittest.TestCase):
    def test_application_reserves_cash_until_confirmation(self):
        p = fixture()
        p['transactions'] = [trade('buy', status='pending', amount=200)]
        p = apply_command(p, {'action': 'confirm', 'data': {'id': 'test:buy', 'date': '2026-01-05', 'shares': 99, 'price': 2, 'fee': 2}})
        earlier = replay(p, '2026-01-03')
        self.assertEqual(earlier['cash']['legacy'], 800)
        self.assertEqual(earlier['pending']['legacy'], 200)
        self.assertEqual(replay(p)['cash']['legacy'], 800)
        self.assertEqual(replay(p)['pending']['legacy'], 0)

    def test_cancel_preserves_historical_reservation(self):
        p = fixture()
        p['transactions'] = [trade('buy', status='pending', amount=200)]
        p = apply_command(p, {'action': 'cancel', 'data': {'id': 'test:buy', 'date': '2026-01-05'}})
        self.assertEqual(replay(p, '2026-01-03')['cash']['legacy'], 800)
        self.assertEqual(replay(p)['cash']['legacy'], 1000)

    def test_pending_cash_cannot_be_spent_before_settlement(self):
        p = fixture()
        p['transactions'] = [trade('buy', status='pending', amount=900), trade('withdrawal', amount=200, date='2026-01-03')]
        with self.assertRaises(PortfolioError):
            apply_command(p, {'action': 'confirm', 'data': {'id': 'test:buy', 'date': '2026-01-05', 'shares': 10, 'price': 2}})

    def test_external_cash_is_excluded_from_period_profit(self):
        p = fixture()
        p['transactions'] = [trade('deposit', amount=500)]
        p['products'][0]['price_history'] = [{'date': '2026-01-03', 'price': 3, 'source': 'manual'}]
        result = performance(p, '2026-01-03')
        self.assertEqual(result['points'][-1]['assets'], 1800)
        self.assertEqual(result['points'][-1]['profit'], 100)

    def test_no_future_fill_or_stale_valuation(self):
        p = fixture()
        p['products'][0]['mark']['date'] = '2026-01-03'
        points = performance(p, '2026-01-12')['points']
        self.assertIsNone(points[0]['assets'])
        self.assertIsNone(points[-1]['assets'])
        self.assertTrue(all(row['profit'] is None for row in points))

    def test_bad_history_is_rejected(self):
        p = fixture()
        p['products'][0]['price_history'] = [{'date': '2026-01-03', 'price': float('nan'), 'source': 'manual'}]
        with self.assertRaises(PortfolioError):
            validate_portfolio(p)

    def test_adjustment_does_not_become_investment_return(self):
        p = fixture()
        p['transactions'] = [trade('adjustment', shares=200, cost_total=400, note='核对')]
        self.assertIsNone(performance(p, '2026-01-03')['points'][-1]['profit'])

    def test_baseline_day_fees_are_not_erased(self):
        p = fixture()
        p['transactions'] = [trade('buy', date='2026-01-01', shares=10, price=2, fee=2)]
        result=performance(p, '2026-01-02')['points'][-1]
        self.assertEqual(result['profit'],-2)
        self.assertAlmostEqual(result['return_pct'],-2/1200*100,places=5)

    def test_return_weights_dated_external_cash(self):
        p=fixture()
        p['transactions']=[trade('deposit',amount=1000,date='2026-01-02')]
        p['products'][0]['price_history']=[{'date':'2026-01-03','price':3,'source':'manual'}]
        result=performance(p,'2026-01-03')['points'][-1]
        self.assertAlmostEqual(result['return_pct'],100/1700*100,places=5)

    def test_product_return_includes_sale_fees_and_dividends_without_account_cash(self):
        p=fixture()
        p['accounts'][0]['opening_cash']=None
        p['transactions']=[trade('sell',shares=50,price=3,fee=5),trade('dividend',amount=20)]
        p['products'][0]['price_history']=[{'date':'2026-01-03','price':3,'source':'manual'}]
        result=performance(p,'2026-01-03',{'exchange:513500'})['points'][-1]
        self.assertEqual(result['assets'],150)
        self.assertEqual(result['net_flows'],-165)
        self.assertEqual(result['profit'],115)

    def test_pending_subscription_is_not_product_capital_until_confirmed(self):
        p=fixture();p['transactions']=[trade('buy',status='pending',amount=100)]
        result=performance(p,'2026-01-03',{'exchange:513500'})['points'][-1]
        self.assertEqual(result['net_flows'],0)
        self.assertEqual(result['assets'],200)
