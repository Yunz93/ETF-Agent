#!/usr/bin/env python3
"""Unit tests for multi-market quote field mapping and freshness.

Covers the regressions fixed in the data-source accuracy work:
- Tencent PE/PB/market-cap layout differs by A / HK / US
- Eastmoney ulist uses clist-style fields (f2/f3/...), not stock/get IDs
- A/HK lunch breaks are outside the live session
- In-session live delay budget is capped at 15 minutes
- Missing Tencent symbols are backfilled from Eastmoney
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def _tencent_fields(overrides=None):
    """Build a sparse Tencent qt.gtimg.cn field list with shared price block."""
    fields = [""] * 70
    fields[3] = "100.5"
    fields[6] = "1000000"
    fields[30] = "20260710103000"
    fields[32] = "1.25"
    fields[36] = "2000000"
    fields[39] = "18.5"
    fields[44] = "1200"
    fields[45] = "1500"
    for key, value in (overrides or {}).items():
        fields[key] = value
    return fields


class TencentNumericTests(unittest.TestCase):
    def test_skips_blank_and_non_numeric(self):
        fields = [""] * 70
        fields[39] = ""
        fields[46] = "腾讯控股"
        fields[57] = "12.3"
        self.assertEqual(server.tencent_numeric(fields, 39, 46, 57), 12.3)

    def test_returns_none_when_all_invalid(self):
        fields = [""] * 10
        fields[1] = "-"
        fields[2] = "N/A"
        self.assertIsNone(server.tencent_numeric(fields, 1, 2, 9))


class TencentValuationMappingTests(unittest.TestCase):
    def test_a_share_uses_pb_46_and_52w_67_68(self):
        fields = _tencent_fields({46: "4.2", 67: "120", 68: "80"})
        valuation = server.tencent_valuation_fields("A", fields)
        self.assertEqual(valuation["pe"], 18.5)
        self.assertEqual(valuation["pb"], 4.2)
        self.assertEqual(valuation["market_cap"], 1500 * 100_000_000)
        self.assertEqual(valuation["week_52_high"], 120.0)
        self.assertEqual(valuation["week_52_low"], 80.0)

    def test_hk_does_not_treat_ticker_text_as_pb(self):
        fields = _tencent_fields({46: "00700", 57: "22.1", 58: "3.8", 48: "500", 49: "300"})
        valuation = server.tencent_valuation_fields("HK", fields)
        self.assertEqual(valuation["pe"], 22.1)
        self.assertEqual(valuation["pb"], 3.8)
        self.assertNotEqual(valuation["pb"], 700)  # must not parse ticker text
        self.assertEqual(valuation["week_52_high"], 500.0)
        self.assertEqual(valuation["week_52_low"], 300.0)

    def test_hk_falls_back_to_shared_pe_when_alt_blank(self):
        fields = _tencent_fields({39: "19.0", 46: "00700", 57: "", 58: "3.5"})
        valuation = server.tencent_valuation_fields("HK", fields)
        self.assertEqual(valuation["pe"], 19.0)
        self.assertEqual(valuation["pb"], 3.5)

    def test_us_uses_pb_51_not_company_name_at_46(self):
        fields = _tencent_fields({46: "Apple Inc.", 51: "45.6", 48: "220", 49: "160"})
        valuation = server.tencent_valuation_fields("US", fields)
        self.assertEqual(valuation["pe"], 18.5)
        self.assertEqual(valuation["pb"], 45.6)
        self.assertIsNone(server.clean_market_value(fields[46]))
        self.assertEqual(valuation["week_52_high"], 220.0)
        self.assertEqual(valuation["week_52_low"], 160.0)

    def test_market_cap_falls_back_to_field_44(self):
        fields = _tencent_fields({45: "", 44: "980"})
        valuation = server.tencent_valuation_fields("A", fields)
        self.assertEqual(valuation["market_cap"], 980 * 100_000_000)

    def test_pe_never_falls_back_to_market_cap_field(self):
        fields = _tencent_fields({39: "", 45: "1500", 46: "2.1"})
        valuation = server.tencent_valuation_fields("A", fields)
        self.assertIsNone(valuation["pe"])
        self.assertEqual(valuation["market_cap"], 1500 * 100_000_000)


class QuoteFromTencentItemTests(unittest.TestCase):
    def test_quote_includes_market_aware_valuation(self):
        fields = _tencent_fields({46: "Apple Inc.", 51: "40.0", 48: "210", 49: "150"})
        quote = server.quote_from_tencent_item("AAPL", "US", "AAPL", fields)
        self.assertEqual(quote["price"], 100.5)
        self.assertEqual(quote["change_pct"], 1.25)
        self.assertEqual(quote["pe"], 18.5)
        self.assertEqual(quote["pb"], 40.0)
        self.assertEqual(quote["week_52_high"], 210.0)
        self.assertEqual(quote["week_52_low"], 150.0)
        self.assertEqual(quote["market_cap"], 1500 * 100_000_000)


class EastmoneyMappingTests(unittest.TestCase):
    def test_secid_a_hk_us(self):
        self.assertEqual(server.eastmoney_secid("600519", "A", "600519.SS"), "1.600519")
        self.assertEqual(server.eastmoney_secid("000001", "A", "000001.SZ"), "0.000001")
        self.assertEqual(server.eastmoney_secid("0700", "HK", "0700.HK"), "116.00700")
        self.assertEqual(server.eastmoney_secid("AAPL", "US", "AAPL"), "105.AAPL")
        self.assertEqual(server.eastmoney_secid("JPM", "US", "JPM"), "106.JPM")

    def test_us_dotted_class_share_rejected(self):
        self.assertIsNone(server.eastmoney_secid("BRK.B", "US", "BRK-B"))

    def test_quote_from_ulist_clist_fields(self):
        item = {
            "f2": 188.2,
            "f3": -0.55,
            "f5": 123456,
            "f9": 28.4,
            "f12": "AAPL",
            "f20": 2_900_000_000_000,
            "f23": 42.1,
            "f124": 1_720_000_000,
        }
        quote = server.quote_from_eastmoney_item("AAPL", "US", "AAPL", item)
        self.assertEqual(quote["price"], 188.2)
        self.assertEqual(quote["change_pct"], -0.55)
        self.assertEqual(quote["volume"], 123456.0)
        self.assertEqual(quote["pe"], 28.4)
        self.assertEqual(quote["pb"], 42.1)
        self.assertEqual(quote["market_cap"], 2_900_000_000_000.0)
        self.assertEqual(quote["provider"], "东方财富（兜底）")
        # Must not read obsolete stock/get field IDs.
        self.assertNotIn("f43", item)  # fixture sanity
        self.assertIsNone(server.clean_market_value(item.get("f43")))


class MarketSessionFreshnessTests(unittest.TestCase):
    def test_a_lunch_break_is_out_of_session(self):
        lunch = datetime(2026, 7, 10, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.assertFalse(server.in_market_session("A", lunch))

    def test_a_morning_and_afternoon_are_in_session(self):
        morning = datetime(2026, 7, 10, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        afternoon = datetime(2026, 7, 10, 14, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.assertTrue(server.in_market_session("A", morning))
        self.assertTrue(server.in_market_session("A", afternoon))

    def test_hk_lunch_break_is_out_of_session(self):
        lunch = datetime(2026, 7, 10, 12, 30, tzinfo=ZoneInfo("Asia/Hong_Kong"))
        self.assertFalse(server.in_market_session("HK", lunch))

    def test_weekend_is_out_of_session(self):
        saturday = datetime(2026, 7, 11, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        self.assertFalse(server.in_market_session("A", saturday))

    def test_in_session_live_uses_15m_cap(self):
        # Friday 2026-07-10 10:30 Shanghai = in A-share morning session.
        now_local = datetime(2026, 7, 10, 10, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
        now = now_local.timestamp()
        fresh_ts = now - 600  # 10 minutes
        stale_ts = now - 1200  # 20 minutes
        fresh = server.market_freshness("A", fresh_ts, now=now, max_age=1800)
        stale = server.market_freshness("A", stale_ts, now=now, max_age=1800)
        self.assertTrue(fresh["in_session"])
        self.assertEqual(fresh["status"], "live")
        self.assertTrue(fresh["fresh"])
        self.assertTrue(stale["in_session"])
        self.assertEqual(stale["status"], "stale")
        self.assertFalse(stale["fresh"])

    def test_lunch_quote_is_recent_close_not_stale_live(self):
        # Mid-day lunch: not in session, so a 20-minute-old quote is recent_close.
        now_local = datetime(2026, 7, 10, 12, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
        now = now_local.timestamp()
        ts = now - 1200
        result = server.market_freshness("A", ts, now=now, max_age=1800)
        self.assertFalse(result["in_session"])
        self.assertEqual(result["status"], "recent_close")
        self.assertTrue(result["fresh"])
        self.assertEqual(result["delay_seconds"], 1200)

    def test_missing_timestamp(self):
        result = server.market_freshness("US", None)
        self.assertEqual(result["status"], "missing")
        self.assertFalse(result["fresh"])
        self.assertFalse(result["in_session"])


class PricesAgreeTests(unittest.TestCase):
    def test_relative_and_absolute_tolerance(self):
        self.assertTrue(server.prices_agree(100.0, 101.0, rel=0.02, abs_tol=0.5))
        self.assertFalse(server.prices_agree(100.0, 105.0, rel=0.02, abs_tol=0.5))
        self.assertTrue(server.prices_agree(1.0, 1.4, rel=0.02, abs_tol=0.5))

    def test_none_or_invalid(self):
        self.assertFalse(server.prices_agree(None, 1.0))
        self.assertFalse(server.prices_agree(1.0, "x"))


class FetchQuotesPartialFillTests(unittest.TestCase):
    def test_missing_tencent_symbol_filled_from_eastmoney(self):
        stocks = [
            ("600519", "A", "600519.SS"),
            ("000001", "A", "000001.SZ"),
        ]
        tencent_fields = _tencent_fields({46: "5.0", 67: "2000", 68: "1000"})
        eastmoney_item = {
            "f2": 11.2,
            "f3": 0.5,
            "f5": 999,
            "f9": 6.1,
            "f12": "000001",
            "f20": 2e11,
            "f23": 0.8,
            "f124": int(datetime(2026, 7, 10, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp()),
        }

        with patch.object(
            server,
            "fetch_tencent_quotes",
            return_value={("A", "600519"): tencent_fields},
        ), patch.object(
            server,
            "fetch_eastmoney_quotes",
            return_value={("A", "000001"): eastmoney_item},
        ):
            response = server.fetch_quotes_for_stocks(stocks, market="A")

        self.assertEqual(response["returned"], 2)
        self.assertEqual(response["fallback_filled"], 1)
        self.assertEqual(response["provider"], "腾讯行情 + 东方财富补齐")
        symbols = {row["symbol"] for row in response["quotes"]}
        self.assertEqual(symbols, {"600519", "000001"})
        filled = next(row for row in response["quotes"] if row["symbol"] == "000001")
        self.assertEqual(filled["price"], 11.2)
        self.assertEqual(filled["pb"], 0.8)
        self.assertIn("东方财富补齐", filled["note"])

    def test_empty_stocks_returns_error_payload(self):
        response = server.fetch_quotes_for_stocks([], market="A")
        self.assertEqual(response["quotes"], [])
        self.assertIn("error", response)


if __name__ == "__main__":
    unittest.main()
