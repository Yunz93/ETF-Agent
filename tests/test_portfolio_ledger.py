import unittest
from copy import deepcopy

from stockagent.portfolio_ledger import PortfolioError, migration_preview, snapshot, validate_portfolio


def fixture():
    p = migration_preview({"version": 10, "etfs": [
        {"symbol": "513500", "name": "标普500", "shares": 100, "cost": 2},
    ]}, today="2026-01-01")
    p["accounts"][0]["opening_cash"] = 1000
    p["products"][0]["mark"] = {"price": 2, "date": "2026-01-01", "source": "manual"}
    return p


def trade(kind, **values):
    return {"id": f"test:{kind}", "type": kind, "status": "confirmed", "account_id": "legacy",
            "product_id": "exchange:513500", "date": "2026-01-02", **values}


class PortfolioLedgerTests(unittest.TestCase):
    def test_migration_preserves_holdings_and_does_not_replay_legacy_buys(self):
        old = {"etfs": [{"symbol": "513500", "shares": 100, "cost": 2}],
               "buys": [{"id": "old", "symbol": "513500", "shares": 70, "channel": "exchange"}]}
        original = deepcopy(old)
        p = migration_preview(old, today="2026-01-01")
        self.assertEqual(old, original)
        self.assertEqual(snapshot(p)["products"][0]["shares"], 100)
        self.assertEqual(p["transactions"], [])
        self.assertEqual(p["migration"]["issues"][0]["trade_shares"], 70)
        self.assertIsNone(snapshot(p)["total"]["assets"])

    def test_legacy_non_target_categories_are_retained(self):
        p = migration_preview({"etfs": [{"symbol": "563360", "name": "A500", "shares": 20, "cost": 1}]})
        self.assertEqual(next(c for c in p["categories"] if c["id"] == "a500")["target_pct"], 0)
        self.assertEqual(sum(c["target_pct"] for c in p["categories"]), 100)

    def test_migration_reports_cost_difference_without_overwriting_holdings(self):
        old={"etfs":[{"symbol":"513500","shares":100,"cost":2}],
             "buys":[{"id":"old","symbol":"513500","date":"2026-01-01","shares":100,"price":1.5,"fee":5}]}
        p=migration_preview(old)
        issue=next(r for r in p['migration']['issues'] if r['type']=='cost_mismatch')
        self.assertEqual(issue['trade_cost'],155)
        self.assertEqual(p['openings'][0]['cost_total'],200)

    def test_pending_subscription_and_confirmation_conserve_assets(self):
        p = fixture()
        p["transactions"] = [trade("buy", status="pending", amount=200)]
        s = snapshot(validate_portfolio(p))["total"]
        self.assertEqual((s["cash"], s["pending"], s["assets"]), (800, 200, 1200))
        p["transactions"][0].update(status="confirmed", shares=99, price=2, fee=2)
        s = snapshot(validate_portfolio(p))["total"]
        self.assertEqual((s["cash"], s["pending"], s["assets"], s["profit"]), (800, 0, 1198, -2))
        p["transactions"][0]["status"] = "cancelled"
        self.assertEqual(snapshot(p)["total"]["assets"], 1200)

    def test_cashflow_not_profit_and_sales_include_fees(self):
        p = fixture()
        p["transactions"] = [trade("deposit", amount=500), trade("sell", shares=50, price=3, fee=5)]
        p["products"][0]["mark"]["price"] = 3
        s = snapshot(validate_portfolio(p))["total"]
        self.assertEqual((s["cash"], s["realized"], s["unrealized"], s["profit"]), (1645, 45, 50, 95))
        self.assertEqual(s["net_flows"], 500)

    def test_redemption_reserves_shares_and_prevents_overselling(self):
        p = fixture()
        p["transactions"] = [trade("sell", status="pending", shares=60)]
        p["transactions"].append(trade("sell", id="sell2", shares=50, price=2))
        with self.assertRaises(PortfolioError):
            validate_portfolio(p)

    def test_unknown_cost_does_not_become_profit(self):
        p = fixture()
        p["openings"][0]["cost_total"] = None
        p["transactions"] = [trade("sell", shares=50, price=3)]
        s = snapshot(validate_portfolio(p))["total"]
        self.assertIsNone(s["profit"])
        self.assertIsNone(s["realized"])

    def test_dividend_and_reinvestment_preserve_profit(self):
        p = fixture()
        p["transactions"] = [trade("dividend", amount=20, fee=1)]
        self.assertEqual(snapshot(validate_portfolio(p))["total"]["profit"], 19)
        p["transactions"] = [trade("reinvest", shares=10, price=2)]
        s = snapshot(validate_portfolio(p))["total"]
        self.assertEqual((s["cash"], s["value"], s["profit"]), (1000, 220, 20))

    def test_multi_account_product_aggregation(self):
        p = fixture()
        p["accounts"].append({"id": "second", "name": "另一账户", "opening_cash": 0})
        p["openings"].append({"id": "second_opening", "account_id": "second", "product_id": "exchange:513500", "shares": 50, "cost_total": 75})
        s = snapshot(validate_portfolio(p))
        self.assertEqual(s["products"][0]["value"], 300)
        self.assertEqual(s["categories"][0]["value"], 300)
        self.assertEqual(s["total"]["profit"], 25)

    def test_missing_held_quote_propagates_to_aggregate(self):
        p = fixture()
        p["products"][0]["mark"] = None
        s = snapshot(validate_portfolio(p))
        self.assertIsNone(s["total"]["value"])
        self.assertIsNone(s["categories"][0]["actual_pct"])
        self.assertTrue(s["warnings"])

    def test_invalid_inputs_rejected(self):
        for value in (-1, float("nan"), float("inf"), True):
            p = fixture()
            p["openings"][0]["shares"] = value
            with self.subTest(value=value), self.assertRaises(PortfolioError):
                validate_portfolio(p)
        p = fixture()
        p["transactions"] = [trade("buy", shares=1000, price=2)]
        with self.assertRaises(PortfolioError):
            validate_portfolio(p)
        p = fixture()
        p["transactions"] = [trade("withdrawal", amount=1, date="2025-12-31")]
        with self.assertRaises(PortfolioError):
            validate_portfolio(p)


if __name__ == "__main__":
    unittest.main()
