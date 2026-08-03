#!/usr/bin/env python3
import unittest

from stockagent.gold_macro_math import (
    build_gold_macro_snapshot,
    multiplier_from_gold_macro_score,
    score_us10y_level,
    score_usd_bias,
)


class GoldMacroMathTests(unittest.TestCase):
    def test_lower_yields_and_weaker_dollar_score_higher(self):
        self.assertGreater(score_us10y_level(3.0), score_us10y_level(5.0))
        self.assertGreater(score_usd_bias(-4.0), score_usd_bias(4.0))

    def test_multiplier_bands(self):
        self.assertEqual(multiplier_from_gold_macro_score(80)["mult"], 1.2)
        self.assertEqual(multiplier_from_gold_macro_score(50)["mult"], 1.0)
        self.assertEqual(multiplier_from_gold_macro_score(20)["mult"], 0.7)
        self.assertEqual(multiplier_from_gold_macro_score(None)["mult"], 1.0)

    def test_snapshot_combines_legs(self):
        us_rows = [{"date": f"2024-01-{i:02d}", "us10y": 5.2 - i * 0.02} for i in range(1, 70)]
        # Falling USD: start high, end lower vs MA120
        closes = [110 - i * 0.05 for i in range(150)]
        snap = build_gold_macro_snapshot(us_rows, closes)
        self.assertFalse(snap["degraded"])
        self.assertIsNotNone(snap["score"])
        self.assertGreater(snap["mult"], 1.0)
        self.assertIsNotNone(snap["us10y"]["value"])
        self.assertIsNotNone(snap["usd_index"]["bias_ma120_pct"])


if __name__ == "__main__":
    unittest.main()
