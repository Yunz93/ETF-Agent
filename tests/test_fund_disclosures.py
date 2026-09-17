import copy
import unittest
from stockagent.workspace_store import normalize_fund_disclosures, normalize_plan

class DisclosureTests(unittest.TestCase):
    def setUp(self):
        self.report = {'as_of': '2026-06-30', 'source_url': 'https://example.com/report', 'holdings': [{'id': 'US:ABC', 'name': 'ABC', 'weight_pct': 20, 'sector': '科技', 'currency': 'USD'}]}

    def test_roundtrip_partial_disclosure(self):
        raw = {'513100': self.report}
        self.assertEqual(normalize_plan({'fund_disclosures': raw})['fund_disclosures'], raw)

    def test_reject_invalid_source_dates_and_weights(self):
        for patch in [{'source_url': 'https://'}, {'source_url': 'javascript:alert(1)'}, {'as_of': '2026-02-30'}, {'holdings': [{'id':'a', 'weight_pct':True}]}, {'holdings':[{'id':'a','weight_pct':70},{'id':'b','weight_pct':40}]}, {'holdings':[{'id':'a','weight_pct':1}]*1001}]:
            with self.subTest(patch=patch):
                report = copy.deepcopy(self.report)
                report.update(patch)
                self.assertEqual(normalize_fund_disclosures({'513100':report}), {})

    def test_cash_debt_unknown_is_distinct_from_zero(self):
        goal = normalize_plan({'investment_goal':{'account_cash':10000,'account_debt':0}})['investment_goal']
        self.assertEqual(goal['account_debt'], 0)
        self.assertIsNone(normalize_plan({})['investment_goal']['account_debt'])
