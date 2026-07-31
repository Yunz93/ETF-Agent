#!/usr/bin/env python3
"""Offline unit tests for market sentiment math."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from stockagent import sentiment_math as sm  # noqa: E402


def rising_then_crash(days=400, crash_days=40):
    closes = []
    price = 100.0
    for i in range(days - crash_days):
        price *= 1.0015 + 0.0004 * math.sin(i / 11)
        closes.append(price)
    for i in range(crash_days):
        # Varying shock magnitudes so realized vol is clearly elevated.
        price *= 0.97 - 0.01 * math.sin(i / 3)
        closes.append(price)
    return closes


def calm_uptrend(days=400):
    closes = []
    price = 100.0
    for i in range(days):
        price *= 1.0008 + 0.00005 * math.sin(i / 17)
        closes.append(price)
    return closes


class SentimentMathTests(unittest.TestCase):
    def test_realized_vol_detects_crash(self):
        calm = calm_uptrend()
        crash = rising_then_crash()
        self.assertGreater(sm.realized_vol(crash, 20), sm.realized_vol(calm, 20))

    def test_drawdown_negative_after_crash(self):
        crash = rising_then_crash()
        dd = sm.drawdown_pct(crash, lookback=250)
        self.assertIsNotNone(dd)
        self.assertLess(dd, -10)

    def test_crash_score_lower_than_calm(self):
        calm_score, _ = sm.smoothed_sentiment_score(calm_uptrend(), smooth_days=5)
        crash_score, _ = sm.smoothed_sentiment_score(rising_then_crash(), smooth_days=5)
        self.assertIsNotNone(calm_score)
        self.assertIsNotNone(crash_score)
        self.assertLess(crash_score, calm_score)

    def test_extremes_only_dead_zone(self):
        mid = sm.multiplier_from_sentiment_bands(50, extremes_only=True)
        self.assertEqual(mid["mult"], 1.0)
        self.assertEqual(mid["band"], "中性死区")

        panic = sm.multiplier_from_sentiment_bands(10, extremes_only=True)
        self.assertGreater(panic["mult"], 1.0)
        hot = sm.multiplier_from_sentiment_bands(90, extremes_only=True)
        self.assertLess(hot["mult"], 1.0)

    def test_missing_score_is_neutral(self):
        result = sm.multiplier_from_sentiment_bands(None)
        self.assertEqual(result["mult"], 1.0)
        self.assertEqual(result["zone"], "unknown")

    def test_build_snapshot_includes_components(self):
        snap = sm.build_sentiment_snapshot(
            rising_then_crash(),
            market="A",
            anchor_symbol="563360",
            as_of="2026-07-31",
        )
        self.assertEqual(snap["market"], "A")
        self.assertFalse(snap["degraded"])
        self.assertIsNotNone(snap["score"])
        self.assertEqual(len(snap["components"]), 2)
        self.assertIn(snap["zone"], {"panic", "fear", "neutral", "greed", "euphoria"})


if __name__ == "__main__":
    unittest.main()
