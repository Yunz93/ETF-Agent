#!/usr/bin/env python3
"""Market sentiment service tests (mocked history + optional live smoke)."""

from __future__ import annotations

import datetime
import math
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from stockagent import sentiment  # noqa: E402
from stockagent.state import HISTORY_CACHE, SENTIMENT_CACHE  # noqa: E402


def fake_history(symbol, market="A", range_key="5y", crash=False):
    start = datetime.date(2022, 1, 3)
    points = []
    price = 1.0
    days = 800
    for i in range(days):
        if crash and i > days - 50:
            price *= 0.98
        else:
            price *= 1.001 + 0.0003 * math.sin(i / 21)
        points.append({"date": (start + datetime.timedelta(days=i)).isoformat(), "close": round(price, 4)})
    return {
        "symbol": symbol,
        "market": market,
        "range": range_key,
        "points": points,
        "provider": "mock",
        "source_url": "https://example.test/",
        "updated_at": "mock",
    }


class SentimentServiceTests(unittest.TestCase):
    def setUp(self):
        HISTORY_CACHE.clear()
        SENTIMENT_CACHE.clear()

    def test_get_market_sentiment_uses_real_anchor_symbols(self):
        with mock.patch("stockagent.sentiment.get_price_history", side_effect=fake_history) as mocked:
            payload = sentiment.get_market_sentiment(markets="A,US,HK", refresh=True)
        self.assertFalse(payload["degraded"])
        self.assertEqual(set(payload["items"]), {"A", "US", "HK"})
        self.assertEqual(payload["items"]["A"]["anchor_symbol"], "563360")
        self.assertEqual(payload["items"]["US"]["anchor_symbol"], "513390")
        self.assertEqual(payload["items"]["HK"]["anchor_symbol"], "513010")
        for market, snap in payload["items"].items():
            self.assertIsNotNone(snap["score"])
            self.assertGreaterEqual(snap["point_count"], 60)
            self.assertEqual(mocked.call_count, 3)

    def test_crash_history_marks_fear_side(self):
        def crash_hist(symbol, market="A", range_key="5y"):
            return fake_history(symbol, market, range_key, crash=True)

        with mock.patch("stockagent.sentiment.get_price_history", side_effect=crash_hist):
            payload = sentiment.get_market_sentiment(markets="A", refresh=True)
        snap = payload["items"]["A"]
        self.assertLess(snap["score"], 50)
        self.assertIn(snap["zone"], {"panic", "fear", "neutral"})

    def test_history_failure_degrades_without_raising(self):
        def boom(symbol, market="A", range_key="5y"):
            return {"symbol": symbol, "points": [], "error": "network down"}

        with mock.patch("stockagent.sentiment.get_price_history", side_effect=boom):
            payload = sentiment.get_market_sentiment(markets="A", refresh=True)
        self.assertTrue(payload["degraded"])
        self.assertTrue(payload["items"]["A"]["degraded"])
        self.assertEqual(payload["items"]["A"]["mult"], 1.0)

    @unittest.skipUnless(os.environ.get("STOCKAGENT_LIVE_SENTIMENT") == "1", "live network opt-in")
    def test_live_anchors_return_scores(self):
        HISTORY_CACHE.clear()
        SENTIMENT_CACHE.clear()
        payload = sentiment.get_market_sentiment(markets="A,US,HK", refresh=True)
        self.assertIn("A", payload["items"])
        ok_count = sum(1 for item in payload["items"].values() if item.get("score") is not None)
        self.assertGreaterEqual(ok_count, 1, payload)


if __name__ == "__main__":
    unittest.main()
