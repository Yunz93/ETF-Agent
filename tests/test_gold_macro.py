#!/usr/bin/env python3
import unittest
from unittest.mock import patch

from stockagent import gold_macro
from stockagent.handler import Handler


class GoldMacroServiceTests(unittest.TestCase):
    def setUp(self):
        gold_macro.clear_gold_macro_cache()

    def test_get_gold_macro_uses_fetchers(self):
        us_rows = [{"date": f"2024-01-{i:02d}", "us10y": 4.0} for i in range(1, 70)]
        usd_rows = [{"date": f"2024-01-{i:02d}", "close": 100.0} for i in range(1, 150)]
        with patch.object(gold_macro, "fetch_us_treasury_yield_history", return_value=us_rows), patch.object(
            gold_macro, "fetch_usd_index_history", return_value=usd_rows
        ):
            payload = gold_macro.get_gold_macro(refresh=True)
        self.assertIn("score", payload)
        self.assertIn("mult", payload)
        self.assertFalse(payload["degraded"])

    def test_both_legs_fail_degrades(self):
        with patch.object(
            gold_macro, "fetch_us_treasury_yield_history", side_effect=RuntimeError("us down")
        ), patch.object(
            gold_macro, "fetch_usd_index_history", side_effect=RuntimeError("usd down")
        ):
            payload = gold_macro.get_gold_macro(refresh=True)
        self.assertTrue(payload["degraded"])
        self.assertEqual(payload["mult"], 1.0)


class GoldMacroApiTests(unittest.TestCase):
    def test_route_exists(self):
        self.assertTrue(hasattr(Handler, "do_GET"))


if __name__ == "__main__":
    unittest.main()
