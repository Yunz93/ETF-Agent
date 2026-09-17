import datetime as dt
import unittest
from unittest.mock import Mock

from stockagent.strategy_simulation import run_strategy_simulation, simulate


COST = {"lot_size": 1, "min_commission": 0, "commission_rate_pct": 0, "max_fee_ratio_pct": 0}


def history(count=300, price=lambda i: 100):
    rows, day = [], dt.date(2024, 1, 1)
    while len(rows) < count:
        if day.weekday() < 5:
            rows.append({"date": day.isoformat(), "close": price(len(rows))})
        day += dt.timedelta(days=1)
    return rows


def request(rows=None):
    return {"target_weights": {"510300": 100}, "budget": 1000, "cadence": "monthly",
            "dip_pct": 5, "years": 0, "trading_cost": COST,
            "price_history": {"510300": history() if rows is None else rows}}


def run_engine(mode, values, **kwargs):
    dates = [f"2024-01-{i + 1:02d}" for i in range(len(values))]
    return simulate(mode, dates, {"510300": dict(zip(dates, values))}, {"510300": 100},
                    1000, "monthly", 5, kwargs.get("cash", 0), kwargs.get("cost", COST))


class StrategySimulationTests(unittest.TestCase):
    def test_flat_prices_identical_funding_no_fabricated_returns(self):
        status, result = run_strategy_simulation(request())
        self.assertEqual(status, 200)
        a, b = result["strategies"]
        self.assertEqual(a["contributed_capital"], b["contributed_capital"])
        self.assertGreater(a["trade_count"], 0)
        self.assertEqual(b["trade_count"], 0)
        self.assertEqual(b["ending_cash"], b["contributed_capital"])
        for s in (a, b):
            self.assertEqual(s["net_profit"], 0)
            self.assertEqual(s["max_drawdown_pct"], 0)
            self.assertEqual(s["money_weighted_return_pct"], 0)
            self.assertTrue(all(p["equity"] == p["capital"] for p in s["curve"]))

    def test_signal_uses_previous_close_and_cannot_buy_the_known_bottom(self):
        result = run_engine("dip", [100, 95, 110, 110])
        self.assertEqual(len(result["trades"]), 1)
        trade = result["trades"][0]
        self.assertEqual(trade["signal_date"], "2024-01-02")
        self.assertEqual(trade["date"], "2024-01-03")
        self.assertEqual(trade["price"], 110)
        self.assertEqual(trade["shares"], 9)
        self.assertEqual(result["net_profit"], 0)

    def test_three_percent_and_five_percent_are_distinct_thresholds(self):
        dates = ["2024-01-01", "2024-01-02", "2024-01-03"]
        prices = {"510300": dict(zip(dates, [100, 97, 97]))}
        counts = [simulate("dip", dates, prices, {"510300": 100}, 1000, "monthly", threshold, 0, COST)["trade_count"]
                  for threshold in (3, 5)]
        self.assertEqual(counts, [1, 0])

    def test_unfunded_tier_can_retry_after_next_deposit_without_overdraft(self):
        dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-02-01"]
        prices = {"510300": dict(zip(dates, [100, 95, 95, 90, 90, 90]))}
        result = simulate("dip", dates, prices, {"510300": 100}, 1000, "monthly", 5, 0, COST)
        self.assertEqual([t["date"] for t in result["trades"]], ["2024-01-03", "2024-02-01"])
        self.assertEqual([t["drawdown_tier"] for t in result["trades"]], [1, 2])
        self.assertEqual(result["ending_cash"], 60)

    def test_no_repeat_same_tier_new_high_resets_and_gap_only_one_buy(self):
        result = run_engine("dip", [100, 95, 95, 95, 80, 80, 101, 95, 95], cash=10000)
        self.assertEqual([t["drawdown_tier"] for t in result["trades"]], [1, 4, 1])
        self.assertEqual([t["date"] for t in result["trades"]], ["2024-01-03", "2024-01-06", "2024-01-09"])

    def test_future_prices_do_not_change_earlier_trades(self):
        first = run_engine("dip", [100, 95, 90, 95, 200], cash=4000)
        second = run_engine("dip", [100, 95, 90, 95, 1], cash=4000)
        self.assertEqual(first["trades"][:2], second["trades"][:2])

    def test_contributions_are_not_drawdowns_or_gains(self):
        rows = history(100, lambda i: 100 if i < 20 else 50)
        _, result = run_strategy_simulation(request(rows))
        periodic = result["strategies"][0]
        self.assertEqual(periodic["max_drawdown_pct"], 50)
        self.assertEqual(periodic["time_weighted_return_pct"], -50)
        self.assertIsNone(periodic["annualized_return_pct"])
        self.assertIsNone(periodic["money_weighted_return_pct"])

    def test_fees_lots_and_cash_conservation(self):
        payload = request(history(100))
        payload["trading_cost"] = {**COST, "lot_size": 3, "min_commission": 5}
        _, result = run_strategy_simulation(payload)
        s = result["strategies"][0]
        self.assertEqual(s["net_profit"], -s["fees"])
        self.assertTrue(all(t["shares"] % 3 == 0 for t in s["trades"]))
        self.assertAlmostEqual(s["ending_cash"] + sum(t["amount"] + t["fee"] for t in s["trades"]), s["contributed_capital"])
        payload["trading_cost"]["max_fee_ratio_pct"] = 0.0001
        _, blocked = run_strategy_simulation(payload)
        self.assertEqual(blocked["strategies"][0]["trade_count"], 0)
        self.assertEqual(blocked["strategies"][0]["net_profit"], 0)

    def test_daily_short_history_is_usable_without_annualizing(self):
        _, result = run_strategy_simulation(request(history(61)))
        self.assertEqual(result["status"], "ready")
        self.assertTrue(result["warnings"])
        self.assertEqual(result["observations"], 61)
        self.assertIsNone(result["strategies"][0]["money_weighted_return_pct"])

    def test_bad_history_missing_days_and_sparse_monthly_data_stop(self):
        rows = history(100)
        for bad in (rows[:20], rows + [{**rows[0], "close": 200}], rows + [{"date": "bad", "close": 1}]):
            self.assertEqual(run_strategy_simulation(request(bad))[0], 422)
        payload = request(rows)
        payload["target_weights"] = {"510300": 50, "563360": 50}
        payload["price_history"]["563360"] = rows[:50] + rows[51:]
        self.assertEqual(run_strategy_simulation(payload)[0], 422)
        sparse = [{"date": (dt.date(2010, 1, 1) + dt.timedelta(days=i * 30)).isoformat(), "close": 100} for i in range(70)]
        self.assertEqual(run_strategy_simulation(request(sparse))[0], 422)

    def test_common_start_and_each_etf_reconcile_to_portfolio(self):
        payload = request()
        payload["target_weights"] = {"510300": 30, "563360": 70}
        payload["price_history"]["563360"] = history(300, lambda i: 100 + i)[20:]
        payload["initial_cash"] = 12345
        _, result = run_strategy_simulation(payload)
        self.assertEqual(result["start"], history(21)[-1]["date"])
        for s in result["strategies"]:
            for field in ("net_profit", "ending_value", "contributed_capital", "fees", "ending_cash"):
                self.assertAlmostEqual(sum(e[field] for e in s["etfs"]), s[field], delta=0.02)

    def test_weekly_deposits_use_iso_year_not_calendar_year(self):
        dates = ["2020-12-31", "2021-01-01", "2021-01-04"]
        result = simulate("periodic", dates, {"510300": dict.fromkeys(dates, 100)}, {"510300": 100},
                          1000, "weekly", 5, 500, COST)
        self.assertEqual(result["contributed_capital"], 2500)
        self.assertEqual([t["date"] for t in result["trades"]], ["2020-12-31", "2021-01-04"])

    def test_current_and_future_day_excluded_and_invalid_params_do_not_fetch(self):
        _, result = run_strategy_simulation(request(history(100)), today=dt.date(2024, 4, 2))
        self.assertEqual(result["end"], "2024-04-01")
        loader = Mock()
        for override in ({"dip_pct": True}, {"dip_pct": 0}, {"budget": 0}, {"budget": 5e-324}, {"years": 2},
                         {"target_weights": {"510300": 100, "563360": 5e-324}},
                         {"cadence": "daily"}, {"initial_cash": float("inf")}, {"target_weights": {"510300": 90}}):
            payload = {**request(), **override}
            payload.pop("price_history")
            self.assertEqual(run_strategy_simulation(payload, history_loader=loader)[0], 400)
        loader.assert_not_called()

    def test_loader_failure_does_not_expose_internal_errors(self):
        payload = request()
        payload.pop("price_history")
        status, result = run_strategy_simulation(payload, history_loader=Mock(side_effect=OSError("private path")))
        self.assertEqual(status, 422)
        self.assertNotIn("private path", str(result))


if __name__ == "__main__":
    unittest.main()
