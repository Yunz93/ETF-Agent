"""Focused evidence and execution-boundary tests for the US market playbook."""

import datetime
import unittest
from functools import partial
from unittest.mock import patch

from stockagent import us_market_judgment
TODAY = datetime.date(2026, 9, 16)
judge_index = partial(us_market_judgment.judge_index, today=TODAY)


def observation_dates(count, as_of=TODAY):
    dates = []
    day = as_of
    while len(dates) < count:
        if day.weekday() < 5:
            dates.append(day.isoformat())
        day -= datetime.timedelta(days=1)
    return list(reversed(dates))


def prices(drawdown, as_of=TODAY):
    dates = observation_dates(250, as_of)
    return [{"date": date, "close": 100.0} for date in dates[:-1]] + [
        {"date": dates[-1], "close": 100 * (1 - drawdown / 100)}
    ]


def rates(start10=3.0, end10=3.4, start2=3.0, end2=3.3, as_of=TODAY):
    dates = observation_dates(21, as_of)
    rows = [{"date": date, "us10y": start10, "us2y": start2} for date in dates[:-1]]
    rows.append({"date": dates[-1], "us10y": end10, "us2y": end2})
    return rows


class USMarketJudgmentTests(unittest.TestCase):
    def test_rate_drawdown_retains_research_tier_without_unverified_allocation(self):
        result = judge_index("SPX", prices(16), rates(), premium_pct=0.5)
        self.assertEqual(result["market_state"], "rate_drawdown")
        self.assertEqual(result["add_tier"], 2)
        self.assertIsNone(result["suggested_intensity"])
        self.assertEqual(result["allocation_status"], "not_budget_validated")
        self.assertIn("20%", result["next_add_condition"])
        self.assertEqual(result["execution"]["etf_buy_status"], "check_execution_policy")

    def test_falling_yield_does_not_erase_crisis_risk(self):
        result = judge_index("NDX", prices(31), rates(end10=2.7),
                             premium_pct=1, earnings_outlook="deteriorating",
                             shock="economic_liquidity")
        self.assertEqual(result["market_state"], "economic_liquidity_crisis")
        self.assertEqual(result["risk_level"], "high")
        self.assertIsNone(result["suggested_intensity"])

    def test_policy_shock_and_high_premium(self):
        result = judge_index("SPX", prices(21), rates(end10=3.0),
                             premium_pct=5.1, shock="policy")
        self.assertEqual(result["market_state"], "policy_shock")
        self.assertEqual(result["execution"]["etf_buy_status"], "blocked_high_premium")
        self.assertIn("QDII", result["execution"]["alternative"])

    def test_earnings_weakness_alone_does_not_claim_crisis(self):
        result = judge_index("SPX", prices(16), rates(end10=3.0),
                             premium_pct=1, earnings_outlook="deteriorating")
        self.assertEqual(result["market_state"], "drawdown_unclassified")
        self.assertIn("盈利预期恶化", result["trigger_conditions"])

    def test_missing_history_is_explicit(self):
        result = judge_index("SPX", prices(10)[:30], rates())
        self.assertEqual(result["market_state"], "insufficient_data")
        self.assertIsNone(result["suggested_intensity"])

    def test_live_service_keeps_missing_premium_blocked(self):
        def index_rows(code, **_kwargs):
            return prices(16 if code == "SPX" else 22), "mock index"

        with patch.object(us_market_judgment, "fetch_index_history", side_effect=index_rows), \
             patch.object(us_market_judgment, "fetch_us_treasury_yield_history", return_value=rates()), \
             patch.object(us_market_judgment, "get_etf_quotes", return_value={"quotes": []}):
            payload = us_market_judgment.get_us_market_judgment(refresh=True, today=TODAY)
        self.assertEqual(set(payload["items"]), {"SPX", "NDX"})
        for item in payload["items"].values():
            self.assertEqual(item["execution"]["etf_buy_status"], "blocked_missing_premium")
            self.assertEqual(item["evidence"]["fed_policy"], "unknown")
        self.assertEqual(payload["items"]["NDX"]["execution_by_symbol"]["513390"]["etf_buy_status"],
                         "blocked_missing_premium")

    def test_same_index_etfs_keep_separate_premiums(self):
        quotes = {"quotes": [
            {"symbol": "513100", "product_quality": {"premium_discount_pct": 5.2}},
            {"symbol": "513390", "product_quality": {"premium_discount_pct": 0.4}},
        ]}
        with patch.object(us_market_judgment, "fetch_index_history", return_value=(prices(22), "mock")), \
             patch.object(us_market_judgment, "fetch_us_treasury_yield_history", return_value=rates()), \
             patch.object(us_market_judgment, "get_etf_quotes", return_value=quotes):
            payload = us_market_judgment.get_us_market_judgment(refresh=True, today=TODAY)
        statuses = payload["items"]["NDX"]["execution_by_symbol"]
        self.assertEqual(statuses["513100"]["etf_buy_status"], "blocked_high_premium")
        self.assertEqual(statuses["513390"]["etf_buy_status"], "check_execution_policy")

    def test_stale_and_future_observations_do_not_produce_market_judgment(self):
        for offset in (-10, 1):
            as_of = TODAY + datetime.timedelta(days=offset)
            with self.subTest(offset=offset):
                result = judge_index("SPX", prices(25, as_of), rates(as_of=as_of), premium_pct=0)
                self.assertEqual(result["market_state"], "insufficient_data")
                self.assertIsNone(result["suggested_intensity"])
                self.assertTrue(result["data_quality"]["issues"])
                self.assertIn("等待数据核验", result["suggested_action"])

    def test_latest_index_and_two_treasury_dates_must_align(self):
        treasury = rates()
        treasury[-1]["us2y"] = None
        result = judge_index("NDX", prices(25), treasury, premium_pct=0)
        self.assertEqual(result["market_state"], "insufficient_data")
        self.assertIn("日期不一致", "；".join(result["data_quality"]["issues"]))
        self.assertNotEqual(result["data_quality"]["latest_dates"]["us10y"], result["data_quality"]["latest_dates"]["us2y"])

    def test_duplicate_rows_cannot_inflate_minimum_history(self):
        duplicated = prices(25)[-10:] * 25
        result = judge_index("SPX", duplicated, rates(), premium_pct=0)
        self.assertEqual(result["market_state"], "insufficient_data")
        self.assertEqual(result["add_tier"], 0)

    def test_unsorted_history_is_ordered_before_last_date_and_trend_checks(self):
        expected = judge_index("SPX", prices(25), rates(), premium_pct=0)
        result = judge_index("SPX", list(reversed(prices(25))), list(reversed(rates())), premium_pct=0)
        self.assertEqual(result["evidence"], expected["evidence"])
        self.assertEqual(result["add_tier"], expected["add_tier"])

    def test_deepest_tier_does_not_propose_reserve_fraction_or_defensive_sale(self):
        for code in ("SPX", "NDX"):
            result = judge_index(code, prices(50), rates(end10=2.5), premium_pct=0)
            self.assertEqual(result["add_tier"], 4)
            self.assertEqual(result["tier_purpose"], "research_only")
            self.assertIsNone(result["suggested_intensity"])
            self.assertNotIn("%", result["suggested_action"])
            self.assertNotIn("转出", result["defensive_rebalance"])
            self.assertIn("执行页", result["suggested_action"])

    def test_live_service_degrades_stale_history_even_when_fetch_succeeds(self):
        quotes = {"quotes": [{"symbol": symbol, "product_quality": {"premium_discount_pct": 0}}
                             for symbol in ("513500", "513100", "513390")]}
        stale = TODAY - datetime.timedelta(days=10)
        with patch.object(us_market_judgment, "fetch_index_history", return_value=(prices(25, stale), "mock")), \
             patch.object(us_market_judgment, "fetch_us_treasury_yield_history", return_value=rates(as_of=stale)), \
             patch.object(us_market_judgment, "get_etf_quotes", return_value=quotes):
            payload = us_market_judgment.get_us_market_judgment(refresh=True, today=TODAY)
        self.assertTrue(payload["degraded"])
        self.assertEqual(payload["errors"], {})
        self.assertTrue(all(item["market_state"] == "insufficient_data" for item in payload["items"].values()))


if __name__ == "__main__":
    unittest.main()
