#!/usr/bin/env python3
"""dividend_sources 历史行情适配层的离线回归测试（mock HTTP，不依赖外网）。

回归背景：ETF 代理分析（如 159937 黄金ETF博时）曾双源失败——
- 腾讯 newfqkline 的前复权请求返回键是 "qfqday"，代码只读 "day"；
- 新浪兜底用指数前缀规则把深市 ETF 拼成 "sh159937"。
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from stockagent import dividend_sources  # noqa: E402


def _tencent_payload(symbol, key, rows):
    return {"code": 0, "data": {symbol: {key: rows}}}


TENCENT_ROWS = [
    ["2026-07-25", "8.30", "8.35", "8.36", "8.28", "100.0", {}, "0.50", "1.0", ""],
    ["2026-07-28", "8.372", "8.381", "8.387", "8.351", "301246.00", {}, "0.64", "2.5", ""],
]


class TencentIndexHistoryTests(unittest.TestCase):
    def test_reads_qfqday_key_for_etf(self):
        with patch.object(dividend_sources, "http_get_json") as mock_get:
            mock_get.return_value = _tencent_payload("sz159937", "qfqday", TENCENT_ROWS)
            rows = dividend_sources.fetch_tencent_index_history("159937", market_symbol="sz159937")
        self.assertEqual(len(rows), 2)
        latest = rows[-1]
        self.assertEqual(latest["date"], "2026-07-28")
        self.assertEqual(latest["close"], 8.381)
        self.assertEqual(latest["high"], 8.387)
        self.assertEqual(latest["low"], 8.351)
        self.assertEqual(latest["change_pct"], 0.64)

    def test_reads_day_key_for_index(self):
        with patch.object(dividend_sources, "http_get_json") as mock_get:
            mock_get.return_value = _tencent_payload("sh000922", "day", TENCENT_ROWS)
            rows = dividend_sources.fetch_tencent_index_history("000922", market_symbol="sh000922")
        self.assertEqual(len(rows), 2)

    def test_raises_when_no_rows(self):
        with patch.object(dividend_sources, "http_get_json") as mock_get:
            mock_get.return_value = _tencent_payload("sz159937", "day", [])
            with self.assertRaises(RuntimeError):
                dividend_sources.fetch_tencent_index_history("159937", market_symbol="sz159937")


class SinaHistoryMarketSymbolTests(unittest.TestCase):
    def test_market_symbol_overrides_index_prefix(self):
        captured = {}

        def fake_get(url, headers=None, timeout=None):
            captured["url"] = url
            return [{"day": "2026-07-28", "open": "8.372", "high": "8.387", "low": "8.351", "close": "8.381"}]

        with patch.object(dividend_sources, "http_get_json", side_effect=fake_get):
            rows = dividend_sources.fetch_sina_index_history("159937", market_symbol="sz159937")
        self.assertIn("symbol=sz159937", captured["url"])
        self.assertEqual(rows[-1]["close"], 8.381)

    def test_default_prefix_still_index_style(self):
        captured = {}

        def fake_get(url, headers=None, timeout=None):
            captured["url"] = url
            return [{"day": "2026-07-28", "open": "1", "high": "1", "low": "1", "close": "1"}]

        with patch.object(dividend_sources, "http_get_json", side_effect=fake_get):
            dividend_sources.fetch_sina_index_history("399006")
        self.assertIn("symbol=sz399006", captured["url"])


class EtfAsIndexHistoryTests(unittest.TestCase):
    def test_shenzhen_etf_uses_sz_prefix_on_both_sources(self):
        urls = []

        def fake_get(url, headers=None, timeout=None):
            urls.append(url)
            if "qq.com" in url:
                return _tencent_payload("sz159937", "qfqday", TENCENT_ROWS)
            raise AssertionError("腾讯成功时不应请求新浪")

        with patch.object(dividend_sources, "http_get_json", side_effect=fake_get):
            rows, source = dividend_sources.fetch_etf_as_index_history("159937")
        self.assertEqual(source, "腾讯行情")
        self.assertEqual(len(rows), 2)
        self.assertIn("sz159937", urls[0])

    def test_falls_back_to_sina_with_same_market_symbol(self):
        urls = []

        def fake_get(url, headers=None, timeout=None):
            urls.append(url)
            if "qq.com" in url:
                raise RuntimeError("tencent down")
            return [{"day": "2026-07-28", "open": "8.372", "high": "8.387", "low": "8.351", "close": "8.381"}]

        with patch.object(dividend_sources, "http_get_json", side_effect=fake_get):
            rows, source = dividend_sources.fetch_etf_as_index_history("159937")
        self.assertEqual(source, "新浪财经")
        self.assertEqual(rows[-1]["close"], 8.381)
        self.assertIn("symbol=sz159937", urls[-1])

    def test_shanghai_etf_uses_sh_prefix(self):
        urls = []

        def fake_get(url, headers=None, timeout=None):
            urls.append(url)
            return _tencent_payload("sh512890", "qfqday", TENCENT_ROWS)

        with patch.object(dividend_sources, "http_get_json", side_effect=fake_get):
            rows, source = dividend_sources.fetch_etf_as_index_history("512890")
        self.assertIn("sh512890", urls[0])
        self.assertEqual(source, "腾讯行情")


if __name__ == "__main__":
    unittest.main()
