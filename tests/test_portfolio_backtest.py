#!/usr/bin/env python3
import unittest
import datetime
import json
from pathlib import Path

from stockagent.portfolio_backtest import evaluate_backtest_request, run_backtest_from_workspace_symbols, run_strategy, _xirr


def _series(months, start=1.0, step=0.01):
    rows = []
    price = start
    for i in range(months):
        year = 2020 + (i // 12)
        month = (i % 12) + 1
        day = f"{year:04d}-{month:02d}-28"
        rows.append({"date": day, "close": round(price, 4)})
        price += step
    return rows


def _pe_series(months):
    rows = []
    for i in range(months):
        year = 2020 + (i // 12)
        month = (i % 12) + 1
        day = f"{year:04d}-{month:02d}-27"
        rows.append({"date": day, "pe_percentile": 0.4})
    return rows


class PortfolioBacktestTests(unittest.TestCase):
    def test_discounted_pe_multiplier_reduces_deployment_not_only_relative_weights(self):
        dates = ["2020-01-28", "2020-02-28"]
        kwargs = dict(month_dates=dates, prices={"510300": {d: 10 for d in dates}},
                      pe_series={"510300": {"2020-01-01": 0.7}}, weights={"510300": 100},
                      monthly_budget=2000, lot_size=1, min_commission=0, commission_rate=0,
                      max_fee_ratio=0, pe_bands=[{"max_pct": 100, "mult": 0.5}])
        discounted = run_strategy(mode="current", **kwargs)
        fixed = run_strategy(mode="fixed", **kwargs)
        self.assertEqual(discounted["ending_cash_pct"], 37.5)
        self.assertEqual(fixed["ending_cash_pct"], 0)
        self.assertEqual(discounted["contributed_capital"], fixed["contributed_capital"])
        self.assertEqual(discounted["net_profit"], 0)

    def test_shared_performance_fixtures(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/portfolio_performance.json").read_text())
        dates = fixture["dates"]
        days = (datetime.date.fromisoformat(dates[-1]) - datetime.date.fromisoformat(dates[0])).days
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                result = run_strategy(
                    mode="fixed", month_dates=dates,
                    prices={"510300": dict(zip(dates, case["prices"]))},
                    pe_series={}, weights={"510300": 100}, monthly_budget=fixture["monthly_budget"],
                    lot_size=1, min_commission=0, commission_rate=0, max_fee_ratio=0, pe_bands=[],
                )
                self.assertEqual(result["ending_value"], case["ending_value"])
                self.assertEqual(result["contributed_capital"], 30000)
                self.assertEqual(result["net_profit"], case["ending_value"] - 30000)
                for key, expected in [
                    ("total_return_pct", case["total_return"] * 100),
                    ("max_drawdown_pct", case["max_drawdown"] * 100),
                    ("annualized_volatility_pct", case["volatility"] * 100),
                    ("annualized_return_pct", ((1 + case["total_return"]) ** (365 / days) - 1) * 100),
                ]:
                    self.assertAlmostEqual(result[key], expected, delta=0.000051)
                # Independent cash-flow identity: all deposits compounded to
                # liquidation at reported XIRR must equal terminal wealth.
                rate = result["money_weighted_return_pct"] / 100
                end = datetime.date.fromisoformat(dates[-1])
                terminal = sum(fixture["monthly_budget"] * (1 + rate) **
                               ((end - datetime.date.fromisoformat(day)).days / 365) for day in dates)
                self.assertAlmostEqual(terminal, case["ending_value"], delta=0.1)

    def test_flat_prices_do_not_turn_deposits_into_returns(self):
        for fee in (0, 5):
            with self.subTest(fee=fee):
                status, body = evaluate_backtest_request(
                    {"target_weights": {"510300": 100}, "monthly_budget": 2000,
                     "trading_cost": {"min_commission": fee, "commission_rate_pct": 0,
                                      "max_fee_ratio_pct": 0, "lot_size": 1}},
                    price_history={"510300": _series(36, start=10, step=0)},
                    pe_history={"510300": _pe_series(36)},
                )
                self.assertEqual(status, 200)
                for result in body["strategies"]:
                    self.assertEqual(result["status"], "ready")
                    self.assertEqual(result["contributed_capital"], 72000)
                    self.assertAlmostEqual(result["net_profit"], -result["fees"])
                    if fee:
                        self.assertLess(result["annualized_return_pct"], 0)
                        self.assertLess(result["money_weighted_return_pct"], 0)
                        self.assertGreater(result["max_drawdown_pct"], 0)
                    else:
                        for key in ("annualized_return_pct", "annualized_volatility_pct",
                                    "money_weighted_return_pct", "max_drawdown_pct"):
                            self.assertEqual(result[key], 0)

    def test_price_only_history_still_runs_benchmarks(self):
        status, body = run_backtest_from_workspace_symbols({
            "target_weights": {"518880": 100},
            "price_history": {"518880": _series(36)},
        })
        self.assertEqual(status, 200)
        self.assertFalse(body["comparison_complete"])
        self.assertEqual(body["benchmark_id"], "fixed")
        self.assertEqual([r["status"] for r in body["strategies"]],
                         ["ready", "ready", "insufficient_history"])
        self.assertNotIn("annualized_return_pct", body["strategies"][2])
        self.assertEqual(body["methodology"]["observation_frequency"], "monthly")

    def test_future_same_day_stale_or_late_published_pe_cannot_validate_current(self):
        histories = [
            [{"date": "2099-01-01", "pe_percentile": 0.4}] * 36,
            [{"date": "2020-01-28", "pe_percentile": 0.4}] * 36,
            [{"date": "2010-01-01", "pe_percentile": 0.4}] * 36,
            [{**r, "as_of": "2099-01-01"} for r in _pe_series(36)],
        ]
        for pe in histories:
            with self.subTest(pe=pe[0]):
                status, body = evaluate_backtest_request(
                    {"target_weights": {"510300": 100}},
                    price_history={"510300": _series(36)}, pe_history={"510300": pe},
                )
                self.assertEqual(status, 200)
                self.assertEqual(body["strategies"][2]["status"], "insufficient_history")

    def test_xirr_uses_calendar_days_and_preserves_undefined_results(self):
        self.assertAlmostEqual(_xirr(["2021-01-01", "2022-01-01"], [100, 0], 110), 0.1)
        self.assertEqual(round(_xirr(["2021-01-01", "2022-01-01"], [100, 100], 200), 8), 0)
        self.assertIsNone(_xirr(["2021-01-01"], [100], 99))
        self.assertIsNone(_xirr(["2021-01-01", "2022-01-01"], [0, 0], 0))

    def test_missing_months_do_not_get_treated_as_monthly_returns(self):
        prices = _series(40)
        del prices[20]
        status, body = evaluate_backtest_request(
            {"target_weights": {"510300": 100}}, price_history={"510300": prices},
        )
        self.assertEqual(status, 422)
        self.assertIn("缺口", body["limitations"][0])

    def test_invalid_prices_are_not_accepted_as_history(self):
        for value in (0, float("nan"), float("inf")):
            prices = _series(36)
            prices[0]["close"] = value
            status, body = evaluate_backtest_request(
                {"target_weights": {"510300": 100}}, price_history={"510300": prices},
            )
            self.assertEqual(status, 422)
            self.assertEqual(body["status"], "insufficient_history")

    def test_first_aligned_month_requires_a_known_price_for_every_asset(self):
        prices = _series(36)
        prices[0]["date"] = "2020-01-29"
        status, body = evaluate_backtest_request(
            {"target_weights": {"510300": 50, "518880": 50}},
            price_history={"510300": _series(36), "518880": prices},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["status"], "insufficient_history")

    def test_middle_month_requires_an_exact_shared_trading_date(self):
        shifted = _series(37)
        shifted[20]["date"] = shifted[20]["date"][:-2] + "29"
        status, body = evaluate_backtest_request(
            {"target_weights": {"510300": 50, "518880": 50}},
            price_history={"510300": _series(37), "518880": shifted},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["status"], "insufficient_history")

    def test_extreme_finite_prices_fail_closed(self):
        for value in (5e-324, 1e308, 10 ** 1000):
            prices = _series(36)
            prices[0]["close"] = value
            status, body = evaluate_backtest_request(
                {"target_weights": {"510300": 100}}, price_history={"510300": prices},
            )
            self.assertEqual(status, 422)
            self.assertEqual(body["status"], "insufficient_history")

    def test_extreme_budget_cannot_return_nonfinite_metrics(self):
        status, body = evaluate_backtest_request(
            {"target_weights": {"510300": 100}, "monthly_budget": 1e308},
            price_history={"510300": _series(36, start=10, step=0)},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["status"], "insufficient_history")

    def test_insufficient_months(self):
        status, body = evaluate_backtest_request(
            {
                "symbols": ["512890"],
                "target_weights": {"512890": 100},
                "monthly_budget": 1000,
                "price_history": {"512890": _series(12)},
                "pe_history": {"512890": _pe_series(12)},
            },
            price_history={"512890": _series(12)},
            pe_history={"512890": _pe_series(12)},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["status"], "insufficient_history")

    def test_missing_symbol_coverage(self):
        status, body = evaluate_backtest_request(
            {
                "target_weights": {"512890": 50, "563360": 50},
                "monthly_budget": 1000,
            },
            price_history={"512890": _series(40)},
            pe_history={"512890": _pe_series(40)},
        )
        self.assertEqual(status, 422)
        self.assertIn("563360", body["missing_symbols"])

    def test_ready_path_with_fees_and_cash(self):
        prices = {
            "512890": _series(48, start=1.0, step=0.005),
            "563360": _series(48, start=2.0, step=0.008),
        }
        pe = {"512890": _pe_series(48), "563360": _pe_series(48)}
        status, body = evaluate_backtest_request(
            {
                "target_weights": {"512890": 60, "563360": 40},
                "monthly_budget": 2000,
                "trading_cost": {
                    "min_commission": 5,
                    "commission_rate_pct": 0.03,
                    "max_fee_ratio_pct": 0.25,
                    "lot_size": 100,
                },
                "strategy_config": {
                    "pe_bands": [
                        {"max_pct": 100, "mult": 1},
                    ]
                },
            },
            price_history=prices,
            pe_history=pe,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ready")
        self.assertEqual(len(body["strategies"]), 3)
        for row in body["strategies"]:
            self.assertGreaterEqual(row["fees"], 0)
            self.assertTrue(0 <= row["average_cash_pct"] <= 100)
            self.assertEqual(round(row["ending_value"], 2), row["ending_value"])

    def test_empty_payload_not_green(self):
        status, body = run_backtest_from_workspace_symbols({})
        self.assertEqual(status, 422)
        self.assertEqual(body["status"], "insufficient_history")
        self.assertNotEqual(body.get("status"), "ready")

    def test_no_future_signal_used_when_pe_dates_ok(self):
        # PE only available on earlier dates; still runnable
        prices = {"512890": _series(40)}
        pe = {"512890": _pe_series(40)}
        _, baseline = evaluate_backtest_request(
            {"target_weights": {"512890": 100}, "monthly_budget": 1000},
            price_history=prices, pe_history=pe,
        )
        # inject a future pe that must not be required
        pe["512890"].append({"date": "2099-01-01", "pe_percentile": 0.01})
        status, body = evaluate_backtest_request(
            {"target_weights": {"512890": 100}, "monthly_budget": 1000},
            price_history=prices,
            pe_history=pe,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["strategies"], baseline["strategies"])


if __name__ == "__main__":
    unittest.main()
