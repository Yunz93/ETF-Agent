import calendar
import datetime as dt
import json
import unittest
from unittest.mock import Mock, patch

import stockagent.portfolio_research as portfolio_research
from stockagent.portfolio_research import MAX_HISTORY_ROWS, run_portfolio_research
from stockagent.portfolio_backtest import _lot_buy
from stockagent.quotes import fetch_tencent_history


def history(count, price=lambda i: 10):
    rows = []
    for i in range(count):
        year, month = 2010 + i // 12, i % 12 + 1
        rows.append({"date": f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}", "close": price(i)})
    return rows


def request(rows=None):
    payload = {"target_weights": {"510300": 100}, "monthly_budget": 2000,
               "trading_cost": {"lot_size": 1, "min_commission": 0, "commission_rate_pct": 0, "max_fee_ratio_pct": 0},
               "investment_goal": {"annual_return_target_pct": 10, "horizon_years": 10}}
    if rows is not None:
        payload["price_history"] = {"510300": rows}
    return payload


class PortfolioResearchTests(unittest.TestCase):
    def test_provider_max_fallback_keeps_actual_shorter_history(self):
        responses = []
        for data in [{}, {"day": [["2024-01-31", "10", "11"]]}]:
            response = Mock()
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            response.read.return_value = json.dumps({"data": {"sh513500": data}}).encode()
            responses.append(response)
        with patch("stockagent.quotes.urllib.request.urlopen", side_effect=responses) as fetch:
            rows = fetch_tencent_history("513500", "A", "513500.SS", "max")
        self.assertEqual(rows, [{"date": "2024-01-31", "close": 11}])
        self.assertEqual(fetch.call_count, 2)

    def test_rolling_counts_and_deposits_never_become_return(self):
        status, body = run_portfolio_research(request(history(61)))
        self.assertEqual(status, 200)
        self.assertEqual(body["goal_horizon_status"], "insufficient_history")
        self.assertFalse(body["methodology"]["out_of_sample"])
        self.assertFalse(body["methodology"]["future_target_validated"])
        for row in body["strategies"]:
            self.assertEqual(row["annualized_return_pct"], 0)
            self.assertEqual(row["net_profit"], 0)
            self.assertEqual(row["contributed_capital"], 122000)
            self.assertEqual([window["count"] for window in row["rolling"]], [25, 1, 0])
            self.assertEqual(row["rolling"][0]["target_hit_pct"], 0)
            self.assertNotIn("min_return_pct", row["rolling"][2])

    def test_ten_year_window_needs_121_observations(self):
        _, body = run_portfolio_research(request(history(121)))
        self.assertEqual(body["goal_horizon_status"], "historical_only")
        self.assertEqual(body["strategies"][0]["rolling"][-1]["count"], 1)

    def test_short_etf_cannot_be_replaced_or_dropped(self):
        payload = request(history(61))
        payload["target_weights"] = {"510300": 50, "563360": 50}
        payload["price_history"]["563360"] = history(24)
        status, body = run_portfolio_research(payload)
        self.assertEqual(status, 422)
        self.assertEqual(body["observations"], 24)
        self.assertEqual(body["strategies"], [])
        self.assertEqual([r["months"] for r in body["coverage"]], [61, 24])

    def test_gaps_conflicts_and_no_common_trading_dates_fail_closed(self):
        rows = history(40)
        cases = [rows[:10] + rows[11:], rows + [{**rows[0], "close": 99}]]
        for sample in cases:
            with self.subTest(sample=sample[-1]):
                status, body = run_portfolio_research(request(sample))
                self.assertEqual(status, 422)
                self.assertEqual(body["strategies"], [])
        payload = request(rows)
        payload["target_weights"] = {"510300": 50, "518880": 50}
        payload["price_history"]["518880"] = [{**r, "date": (dt.date.fromisoformat(r["date"]) - dt.timedelta(days=1)).isoformat()} for r in rows]
        self.assertEqual(run_portfolio_research(payload)[1]["observations"], 0)

    def test_current_month_and_future_prices_are_excluded(self):
        status, body = run_portfolio_research(request(history(50)), today=dt.date(2013, 2, 15))
        self.assertEqual(status, 200)
        self.assertEqual(body["observations"], 37)
        self.assertEqual(body["end"], "2013-01-31")
        self.assertEqual(body["coverage"][0]["excluded_rows"], 13)

    def test_invalid_values_and_malformed_requests_do_not_start_fetches(self):
        loader = Mock()
        for payload in [[], {}, {**request(), "monthly_budget": 0}, {**request(), "target_weights": {"510300": 99}},
                        {**request(), "monthly_budget": True}, {**request(), "trading_cost": {"lot_size": 0}},
                        {**request(), "price_history": []}]:
            self.assertEqual(run_portfolio_research(payload, history_loader=loader)[0], 400)
        loader.assert_not_called()

    def test_explicit_history_rejects_unknown_symbols_and_oversized_arrays(self):
        payload = request(history(40))
        payload["price_history"]["999999"] = []
        self.assertEqual(run_portfolio_research(payload)[0], 400)
        oversized = request([{"date": "2020-01-01", "close": 10}] * (MAX_HISTORY_ROWS + 1))
        self.assertEqual(run_portfolio_research(oversized)[0], 400)

    def test_zero_weight_symbols_do_not_count_toward_limit(self):
        payload = request(history(40))
        payload["target_weights"].update({f"{index:06d}": 0 for index in range(13)})
        self.assertEqual(run_portfolio_research(payload)[0], 200)

    def test_concurrency_and_rate_guards_fail_fast(self):
        self.assertTrue(portfolio_research._RESEARCH_SLOTS.acquire(blocking=False))
        self.assertTrue(portfolio_research._RESEARCH_SLOTS.acquire(blocking=False))
        try:
            status, body = run_portfolio_research(request(history(40)))
            self.assertEqual((status, body["status"]), (429, "busy"))
        finally:
            portfolio_research._RESEARCH_SLOTS.release()
            portfolio_research._RESEARCH_SLOTS.release()
        key = "test-rate-key"
        portfolio_research._RATE_STARTS.pop(key, None)
        for second in range(portfolio_research.MAX_REQUESTS_PER_MINUTE):
            self.assertTrue(portfolio_research._rate_allowed(key, now=second))
        self.assertFalse(portfolio_research._rate_allowed(key, now=10))
        self.assertTrue(portfolio_research._rate_allowed(key, now=61))
        portfolio_research._RATE_STARTS.pop(key, None)

    def test_live_loader_reports_source_and_partial_failure(self):
        loader = Mock(return_value={"points": history(40), "provider": "测试供应商", "updated_at": "测试时刻"})
        _, body = run_portfolio_research(request(), history_loader=loader)
        loader.assert_called_once_with("510300", market="A", range_key="max")
        self.assertEqual(body["coverage"][0]["provider"], "测试供应商")
        loader.side_effect = TimeoutError("private detail")
        status, body = run_portfolio_research(request(), history_loader=loader)
        self.assertEqual(status, 422)
        self.assertNotIn("private detail", str(body))

    def test_fees_and_cashflow_baseline_have_no_fabricated_gains(self):
        payload = request(history(40))
        payload["trading_cost"]["min_commission"] = 5
        _, body = run_portfolio_research(payload)
        for row in body["strategies"]:
            self.assertAlmostEqual(row["net_profit"], -row["fees"])
            self.assertLess(row["annualized_return_pct"], 0)
        self.assertEqual(_lot_buy(100_000_000, 0.001, 1, 0, 0.01, 0.001), (0, 0, 0))
        self.assertEqual(_lot_buy(100, 10, 1, 5, 0, 0), (9, 90, 5))

    def test_cashflow_never_sells_while_annual_baseline_can(self):
        payload = request(history(61, lambda i: 10 if i < 12 else 100))
        payload["target_weights"] = {"510300": 50, "518880": 50}
        payload["price_history"]["518880"] = history(61)
        _, body = run_portfolio_research(payload)
        by_mode = {row["id"]: row for row in body["strategies"]}
        self.assertGreater(by_mode["rebalance"]["turnover_pct"], by_mode["cashflow"]["turnover_pct"])

    def test_exported_aligned_history_reproduces_results(self):
        payload = request(history(40))
        _, result = run_portfolio_research(payload)
        payload["price_history"] = result["price_history"]
        _, replay = run_portfolio_research(payload)
        self.assertEqual(result["strategies"], replay["strategies"])

    def test_short_or_invalid_quotes_are_not_silently_filled(self):
        rows = history(40)
        rows[10]["close"] = float("nan")
        _, body = run_portfolio_research(request(rows))
        self.assertEqual(body["status"], "insufficient_history")
        self.assertEqual(body["coverage"][0]["invalid_rows"], 1)

    def test_extreme_finite_prices_fail_closed_and_remain_json_safe(self):
        for value in (5e-324, 1e308, 10 ** 1000):
            rows = history(40)
            rows[20]["close"] = value
            status, body = run_portfolio_research(request(rows))
            self.assertEqual(status, 422)
            self.assertEqual(body["status"], "insufficient_history")
            json.dumps(body, allow_nan=False)
