#!/usr/bin/env python3
"""ETF 池后端的离线单元测试：代码清洗、批量行情组装、工作区与配置归一化。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402
from stockagent import workspace_store  # noqa: E402
from stockagent.config_store import normalize_config  # noqa: E402


def _tencent_fields(price="1.168", change="0.69", name="红利低波ETF"):
    fields = [""] * 70
    fields[1] = name
    fields[3] = price
    fields[6] = "1000000"
    fields[30] = "20260722150000"
    fields[32] = change
    fields[36] = "2000000"
    return fields


class GetEtfQuotesTests(unittest.TestCase):
    def setUp(self):
        server.QUOTE_MARKET_CACHE.clear()

    def test_cleans_and_dedupes_symbols(self):
        with patch.object(server, "fetch_tencent_quotes") as mock_fetch:
            mock_fetch.return_value = {
                ("A", "512890"): _tencent_fields(),
                ("A", "510300"): _tencent_fields(price="4.765", change="-0.46", name="沪深300ETF"),
            }
            payload = server.get_etf_quotes(["512890", "sh512890", "510300", "abc", "1234567"])
        requested = mock_fetch.call_args[0][0]
        self.assertEqual([item[0] for item in requested], ["512890", "510300"])
        # 沪市 5 开头 → .SS
        self.assertEqual(requested[0][2], "512890.SS")
        quotes = {q["symbol"]: q for q in payload["quotes"]}
        self.assertEqual(quotes["512890"]["name"], "红利低波ETF")
        self.assertEqual(quotes["510300"]["price"], 4.765)

    def test_no_valid_symbols(self):
        payload = server.get_etf_quotes(["abc", ""])
        self.assertTrue(payload["error"])
        self.assertEqual(payload["quotes"], [])

    def test_shenzhen_symbol_maps_to_sz(self):
        with patch.object(server, "fetch_tencent_quotes") as mock_fetch:
            mock_fetch.return_value = {("A", "159915"): _tencent_fields(name="创业板ETF")}
            server.get_etf_quotes(["159915"])
        requested = mock_fetch.call_args[0][0]
        self.assertEqual(requested[0][2], "159915.SZ")

    def test_caches_for_same_symbol_set(self):
        with patch.object(server, "fetch_tencent_quotes") as mock_fetch:
            mock_fetch.return_value = {("A", "512890"): _tencent_fields()}
            server.get_etf_quotes(["512890"])
            server.get_etf_quotes(["512890"])
        self.assertEqual(mock_fetch.call_count, 1)


class WorkspaceNormalizationTests(unittest.TestCase):
    def test_normalizes_etf_entries(self):
        workspace = workspace_store.normalize_workspace(
            {
                "etfs": [
                    {"symbol": "512890", "name": "红利低波ETF", "shares": 1000, "cost": 1.1, "target_weight": 30},
                    {"symbol": "sh510300", "shares": -5, "cost": "abc", "target_weight": 120},
                    {"symbol": "512890", "name": "重复"},
                    {"symbol": "bad"},
                    "not-a-dict",
                ],
                "plan": {"name": "测试计划", "amount": 3000, "cadence": "weekly", "day": 9},
            }
        )
        self.assertEqual(len(workspace["etfs"]), 2)
        first, second = workspace["etfs"]
        self.assertEqual(first["symbol"], "512890")
        self.assertEqual(first["shares"], 1000)
        self.assertEqual(first["target_weight"], 30)
        self.assertEqual(second["symbol"], "510300")
        self.assertEqual(second["shares"], 0)
        self.assertEqual(second["cost"], 0)
        self.assertEqual(second["target_weight"], 100)
        self.assertEqual(workspace["version"], 4)
        self.assertEqual(workspace["plan"]["name"], "测试计划")
        self.assertEqual(workspace["plan"]["amount"], 3000)
        self.assertEqual(workspace["plan"]["cadence"], "weekly")
        self.assertEqual(workspace["plan"]["day"], 7)

    def test_buy_records_are_normalized_deduplicated_and_date_validated(self):
        workspace = workspace_store.normalize_workspace(
            {
                "etfs": [],
                "buys": [
                    {"id": "buy-1", "symbol": "sh510300", "date": "2026-07-28", "shares": 10, "price": 4.2},
                    {"id": "buy-1", "symbol": "510300", "date": "2026-07-28", "shares": 20, "price": 4.1},
                    {"symbol": "512890", "date": "2026-02-31", "shares": 10, "price": 1.2},
                ],
            }
        )
        self.assertEqual(workspace["version"], 4)
        self.assertEqual(len(workspace["buys"]), 1)
        self.assertEqual(workspace["buys"][0]["symbol"], "510300")
        self.assertTrue(workspace_store.workspace_has_user_data(workspace))

    def test_legacy_workspace_fills_default_targets(self):
        workspace = workspace_store.normalize_workspace(
            {
                "etfs": [
                    {"symbol": "512890", "name": "红利低波ETF", "shares": 100, "cost": 1.2},
                    {"symbol": "510300", "shares": 0, "cost": 0},
                ]
            }
        )
        by_symbol = {item["symbol"]: item for item in workspace["etfs"]}
        self.assertEqual(by_symbol["512890"]["target_weight"], 30)
        self.assertEqual(by_symbol["510300"]["target_weight"], 25)
        self.assertEqual(workspace["plan"]["cadence"], "monthly")

    def test_normalizes_buy_records(self):
        workspace = workspace_store.normalize_workspace(
            {
                "etfs": [{"symbol": "512890", "target_weight": 100}],
                "buys": [
                    {"symbol": "512890", "date": "2026-01-15", "price": 1.2, "shares": 1000, "note": "首笔"},
                    {"symbol": "bad", "date": "2026-01-15", "price": 1, "shares": 1},
                    {"symbol": "512890", "date": "bad-date", "price": 1, "shares": 1},
                    {"symbol": "512890", "date": "2026-02-01", "price": 0, "shares": 500},
                    {"id": "keep", "symbol": "sh510300", "date": "2025-12-01", "price": 4.5, "shares": 200},
                ],
            }
        )
        self.assertEqual(len(workspace["buys"]), 2)
        self.assertEqual(workspace["buys"][0]["date"], "2026-01-15")
        self.assertEqual(workspace["buys"][0]["symbol"], "512890")
        self.assertEqual(workspace["buys"][0]["shares"], 1000)
        self.assertEqual(workspace["buys"][1]["id"], "keep")
        self.assertEqual(workspace["buys"][1]["symbol"], "510300")
        self.assertEqual(workspace["version"], 4)

    def test_invalid_payload_returns_empty(self):
        workspace = workspace_store.normalize_workspace(None)
        self.assertEqual(workspace["etfs"], [])
        self.assertEqual(workspace["buys"], [])
        self.assertEqual(workspace["plan"]["name"], "默认定投计划")
        self.assertFalse(workspace_store.workspace_has_user_data(workspace))


class ConfigNormalizationTests(unittest.TestCase):
    def test_etf_pool_cleaned(self):
        config = normalize_config(
            {
                "etf": {
                    "pool": [
                        {"symbol": "512890", "name": "红利低波ETF"},
                        {"symbol": "sz159915", "name": "创业板ETF"},
                        {"symbol": "nope"},
                    ]
                }
            }
        )
        symbols = [item["symbol"] for item in config["etf"]["pool"]]
        self.assertEqual(symbols, ["512890", "159915"])

    def test_dividend_block_merges(self):
        config = normalize_config({"dividend": {"index_code": "000922", "danjuan_code": "SH000922"}})
        self.assertEqual(config["dividend"]["index_code"], "000922")
        # 未覆盖字段保留默认
        self.assertEqual(config["dividend"]["etf_symbol"], "512890")

    def test_custom_analysis_keeps_optional_history_fields_without_valuation(self):
        config = normalize_config(
            {
                "etf": {
                    "analysis": {
                        "513500": {
                            "index_code": "SPX",
                            "index_name": "标普500",
                            "danjuan_code": "",
                            "history_source": "tencent",
                            "history_symbol": "us.INX",
                        }
                    }
                }
            }
        )
        analysis = config["etf"]["analysis"]["513500"]
        self.assertEqual(analysis["index_code"], "SPX")
        self.assertNotIn("danjuan_code", analysis)
        self.assertEqual(analysis["history_source"], "tencent")
        self.assertEqual(analysis["history_symbol"], "us.INX")

    def test_legacy_blocks_dropped(self):
        config = normalize_config({"ai": {"provider": "deepseek"}, "sec": {"enabled": True}, "catalog": {}})
        self.assertNotIn("ai", config)
        self.assertNotIn("sec", config)
        self.assertNotIn("catalog", config)


if __name__ == "__main__":
    unittest.main()
