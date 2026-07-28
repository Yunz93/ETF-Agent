#!/usr/bin/env python3
"""红利低波日度决策模块的离线单元测试（不依赖外网）。

覆盖：
- 技术指标数学（SMA / 年线乖离 / 布林 / RSI / KDJ / 分位）
- 评分分项与档位映射
- 股债利差历史序列的回推口径与前向填充
- 历史同评分回测
- 完整 analyze_dividend_data 组装与小红书笔记文本
"""

from __future__ import annotations

import datetime
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from stockagent import indicators  # noqa: E402
from stockagent import dividend  # noqa: E402


def synthetic_index_rows(days=900, base=100.0):
    """正弦叠加缓慢上行的合成指数序列，带每日 PE。"""
    rows = []
    start = datetime.date(2022, 1, 3)
    previous = None
    for i in range(days):
        date = start + datetime.timedelta(days=i)
        close = base + 10 * math.sin(i / 40) + i * 0.02
        change_pct = None if previous is None else (close / previous - 1) * 100
        rows.append(
            {
                "date": date.isoformat(),
                "close": close,
                "high": close * 1.01,
                "low": close * 0.99,
                "change_pct": round(change_pct, 2) if change_pct is not None else None,
                "pe": 8 + 2 * math.sin(i / 60),
            }
        )
        previous = close
    return rows


def synthetic_treasury_rows(index_rows):
    return [
        {"date": row["date"], "yield10y": 2.8 - i * 0.001}
        for i, row in enumerate(index_rows)
    ]


class IndicatorTests(unittest.TestCase):
    def test_sma_and_bias(self):
        values = [1.0, 2.0, 3.0, 4.0, 5.0]
        self.assertEqual(indicators.sma(values, 5), 3.0)
        self.assertIsNone(indicators.sma(values, 6))
        # 现价 5 对 MA5=3 → 乖离 +66.67%
        self.assertAlmostEqual(indicators.bias_pct(values, 5), (5 / 3 - 1) * 100, places=6)

    def test_sma_series_matches_naive(self):
        values = [float(v) for v in [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]]
        series = indicators.sma_series(values, 3)
        self.assertIsNone(series[1])
        for i in range(2, len(values)):
            self.assertAlmostEqual(series[i], sum(values[i - 2 : i + 1]) / 3, places=9)

    def test_bollinger_positions(self):
        flat = [10.0] * 19
        self.assertEqual(indicators.bollinger(flat + [10.0], 20)["position"], "upper_half")
        band = indicators.bollinger(list(range(1, 21)) + [100.0], 21)
        self.assertEqual(band["position"], "above_upper")
        low = indicators.bollinger([float(v) for v in range(20, 0, -1)], 20)
        self.assertIn(low["position"], ("lower_half", "below_lower"))

    def test_rsi_extremes(self):
        rising = [float(i) for i in range(1, 30)]
        self.assertEqual(indicators.rsi(rising, 14), 100.0)
        falling = [float(i) for i in range(30, 1, -1)]
        self.assertLess(indicators.rsi(falling, 14), 5.0)
        self.assertIsNone(indicators.rsi([1.0, 2.0], 14))

    def test_kdj_bounds(self):
        closes = [10 + math.sin(i / 3) for i in range(40)]
        highs = [c * 1.02 for c in closes]
        lows = [c * 0.98 for c in closes]
        kdj = indicators.kdj(highs, lows, closes)
        self.assertIsNotNone(kdj)
        self.assertTrue(0 <= kdj["k"] <= 100)
        self.assertTrue(0 <= kdj["d"] <= 100)

    def test_percentile_rank(self):
        values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        self.assertAlmostEqual(indicators.percentile_rank(values, 5), 0.45)
        self.assertEqual(indicators.percentile_rank(values, 100), 1.0)
        self.assertEqual(indicators.percentile_rank(values, 0), 0.0)
        self.assertIsNone(indicators.percentile_rank([], 5))

    def test_rolling_percentile(self):
        rank = indicators.RollingPercentile()
        for value in [1, 2, 3, 4]:
            rank.add(value)
        self.assertAlmostEqual(rank.rank(2.5), 0.5)
        self.assertAlmostEqual(rank.rank(10), 1.0)


class ScoringTests(unittest.TestCase):
    def test_spread_anchor_monotonic(self):
        samples = [-0.5, 0.5, 1.2, 1.8, 2.4, 2.9, 3.5, 4.5]
        scores = [dividend.spread_anchor_score(s) for s in samples]
        self.assertEqual(scores, sorted(scores))
        self.assertEqual(dividend.spread_anchor_score(10), 100.0)

    def test_score_valuation_pb_bonus(self):
        cheap = dividend.score_valuation(0.2, pb=0.8)
        expensive = dividend.score_valuation(0.9, pb=2.5)
        self.assertGreater(cheap, expensive)
        self.assertEqual(dividend.score_valuation(0.5, pb=0.9) - dividend.score_valuation(0.5, pb=1.2), 10)

    def test_score_trend_prefers_pullback(self):
        self.assertGreater(dividend.score_trend(-4), dividend.score_trend(0))
        self.assertGreater(dividend.score_trend(0), dividend.score_trend(8))

    def test_combine_score_renormalizes_missing(self):
        full = dividend.combine_score({"spread": 80, "valuation": 80, "trend": 80, "technical": 80})
        partial = dividend.combine_score({"spread": 80, "valuation": None, "trend": 80, "technical": 80})
        self.assertEqual(full, 80.0)
        self.assertEqual(partial, 80.0)
        self.assertIsNone(dividend.combine_score({"spread": None, "valuation": None, "trend": None, "technical": None}))

    def test_grade_bands(self):
        self.assertEqual(dividend.grade_for_score(88)["grade"], "A")
        self.assertEqual(dividend.grade_for_score(70)["grade"], "B")
        self.assertEqual(dividend.grade_for_score(55)["grade"], "C")
        self.assertEqual(dividend.grade_for_score(40)["grade"], "D")
        self.assertEqual(dividend.grade_for_score(10)["grade"], "E")
        self.assertIsNone(dividend.grade_for_score(None)["grade"])

    def test_percentile_label(self):
        self.assertEqual(dividend.percentile_label(0.9), "历史高位")
        self.assertEqual(dividend.percentile_label(0.5), "历史中位")
        self.assertEqual(dividend.percentile_label(0.05), "历史低位")


class SpreadSeriesTests(unittest.TestCase):
    def test_forward_fill_and_payout_approximation(self):
        index_rows = [
            {"date": "2024-01-01", "close": 100, "high": 101, "low": 99, "pe": 10.0},
            {"date": "2024-01-02", "close": 100, "high": 101, "low": 99, "pe": 8.0},
            {"date": "2024-01-03", "close": 100, "high": 101, "low": 99, "pe": None},
        ]
        treasury = [{"date": "2024-01-01", "yield10y": 2.0}]
        # 当前股息率 5%、当前 PE 10 → 派息水平 50；PE=8 时 dy=6.25%
        series = dividend.build_spread_series(index_rows, 0.05, 10.0, treasury)
        self.assertAlmostEqual(series[0], 5.0 - 2.0)
        self.assertAlmostEqual(series[1], 50 / 8 - 2.0)
        self.assertIsNone(series[2])

    def test_missing_inputs_return_empty(self):
        self.assertEqual(dividend.build_spread_series([], 0.05, 10, []), [])
        self.assertEqual(dividend.build_spread_series([{"date": "2024-01-01", "close": 1, "high": 1, "low": 1}], None, 10, []), [])


class BacktestTests(unittest.TestCase):
    def test_forward_returns_and_win_rate(self):
        # 收盘价单调 +1%/天 → 任意起点 60 天收益为正
        rows = []
        close = 100.0
        for i in range(400):
            rows.append({"date": f"2024-{i}", "close": close, "high": close, "low": close})
            close *= 1.01
        scores = [70.0] * 400
        result = dividend.backtest_forward_returns(rows, scores, 70.0, horizon=60, band=5)
        self.assertEqual(result["samples"], 340)
        self.assertEqual(result["win_rate_pct"], 100.0)
        self.assertGreater(result["avg_return_pct"], 0)

    def test_no_samples_outside_band(self):
        rows = [{"date": str(i), "close": 100.0, "high": 100.0, "low": 100.0} for i in range(200)]
        scores = [20.0] * 200
        result = dividend.backtest_forward_returns(rows, scores, 80.0, horizon=60, band=5)
        self.assertEqual(result["samples"], 0)

    def test_none_target_short_circuits(self):
        result = dividend.backtest_forward_returns([], [], None)
        self.assertEqual(result["samples"], 0)


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.index_rows = synthetic_index_rows()
        self.treasury = synthetic_treasury_rows(self.index_rows)
        self.valuation = {
            "pe": 8.5,
            "pb": 0.9,
            "pe_percentile": 0.6,
            "dividend_yield": 0.045,
            "roe": 0.10,
            "source": "测试数据",
        }
        self.settings = {
            "index_code": "H30269",
            "index_name": "红利低波",
            "index_full_name": "中证红利低波",
            "etf_symbol": "512890",
            "etf_name": "红利低波ETF",
        }

    def test_full_payload_structure(self):
        payload = dividend.analyze_dividend_data(self.index_rows, self.valuation, self.treasury, None, self.settings)
        self.assertIsNone(payload.get("error"))
        score = payload["score"]
        self.assertIsNotNone(score["total"])
        self.assertIn(score["grade"], list("ABCDE"))
        self.assertEqual(len(score["components"]), 4)
        technicals = payload["technicals"]
        self.assertIsNotNone(technicals["ma250"])
        self.assertIsNotNone(technicals["rsi14"])
        self.assertIn(technicals["boll"]["position"], ("above_upper", "upper_half", "lower_half", "below_lower"))
        self.assertAlmostEqual(payload["spread"]["value"], 4.5 - self.treasury[-1]["yield10y"], places=2)
        self.assertTrue(payload["commentary"])
        self.assertTrue(payload["commentary"][-1].startswith("盘面观察"))
        self.assertGreaterEqual(payload["backtest"]["samples"], 0)
        chart = payload["chart"]
        self.assertEqual(len(chart["points"]), len(self.index_rows))
        self.assertEqual(chart["available_from"], self.index_rows[0]["date"])
        self.assertEqual(chart["available_to"], self.index_rows[-1]["date"])
        self.assertIsNotNone(chart["markers"]["boll_mid"])

    def test_note_text_contains_expected_sections(self):
        etf_quote = {"price": 1.168, "change_pct": 0.69, "name": "红利低波ETF", "symbol": "512890"}
        payload = dividend.analyze_dividend_data(self.index_rows, self.valuation, self.treasury, etf_quote, self.settings)
        note = payload["note_text"]
        self.assertIn("以下数据截止", note)
        self.assertIn("📊 中证红利低波大盘数据", note)
        self.assertIn("-现价1.168", note)
        self.assertIn("-年线乖离", note)
        self.assertIn("股债利差", note)
        self.assertIn("-综合评分", note)
        self.assertIn("今日盘面：", note)
        self.assertIn("⚠️ 免责声明", note)
        self.assertIn("#红利低波", note)

    def test_analyze_degrades_without_valuation_and_bond(self):
        payload = dividend.analyze_dividend_data(self.index_rows, {}, [], None, self.settings)
        # 蛋卷缺失时用中证官网 PE 序列自算分位；国债缺失时利差为空但评分仍有效
        self.assertIsNone(payload["spread"]["value"])
        self.assertIsNotNone(payload["valuation"]["pe"])
        self.assertIsNotNone(payload["valuation"]["pe_percentile_10y"])
        self.assertIsNotNone(payload["score"]["total"])
        self.assertIn("今日盘面：", payload["note_text"])


class AnalysisRoutingTests(unittest.TestCase):
    def test_resolve_default_and_registry(self):
        default = dividend.resolve_analysis_settings(None)
        self.assertEqual(default["etf_symbol"], "512890")
        self.assertEqual(default["index_code"], "H30269")

        hs300 = dividend.resolve_analysis_settings("510300")
        self.assertIsNotNone(hs300)
        self.assertEqual(hs300["index_code"], "000300")
        self.assertEqual(hs300["danjuan_code"], "CSI000300")

        cyb = dividend.resolve_analysis_settings("159915")
        self.assertIsNotNone(cyb)
        self.assertEqual(cyb["index_code"], "399006")
        self.assertEqual(cyb["danjuan_code"], "SZ399006")
        self.assertEqual(cyb.get("history_source"), "sina")

        a500 = dividend.resolve_analysis_settings("563360")
        self.assertIsNotNone(a500)
        self.assertEqual(a500["index_code"], "000510")

        ndx = dividend.resolve_analysis_settings("513100")
        self.assertIsNotNone(ndx)
        self.assertEqual(ndx["danjuan_code"], "NDX")
        self.assertEqual(ndx.get("history_symbol"), "us.NDX")

        ndx_bosera = dividend.resolve_analysis_settings("513390")
        self.assertIsNotNone(ndx_bosera)
        self.assertEqual(ndx_bosera["index_code"], "NDX")
        self.assertEqual(ndx_bosera.get("history_symbol"), "us.NDX")

        gold = dividend.resolve_analysis_settings("518880")
        self.assertIsNotNone(gold)
        self.assertEqual(gold.get("analysis_mode"), "etf_proxy")

        gold_bosera = dividend.resolve_analysis_settings("159937", name="黄金ETF博时")
        self.assertIsNotNone(gold_bosera)
        self.assertEqual(gold_bosera.get("analysis_mode"), "etf_proxy")

        inferred = dividend.resolve_analysis_settings("999999", name="华安黄金ETF")
        self.assertEqual(inferred.get("analysis_mode"), "etf_proxy")

        by_name = dividend.infer_mapping_from_name("某红利低波ETF联接")
        self.assertEqual(by_name["index_code"], "H30269")

        unsupported = dividend.unsupported_analysis_payload("518880", "黄金ETF")
        self.assertFalse(unsupported["supported"])
        self.assertIn("暂不支持", unsupported["error"])

    def test_new_registry_mappings(self):
        kc50 = dividend.resolve_analysis_settings("588000")
        self.assertEqual(kc50["index_code"], "000688")
        self.assertEqual(kc50["danjuan_code"], "SH000688")
        self.assertEqual(kc50.get("analysis_mode"), "index")

        zzhl = dividend.resolve_analysis_settings("515080")
        self.assertEqual(zzhl["index_code"], "000922")
        self.assertEqual(zzhl["danjuan_code"], "SH000922")

        hsi = dividend.resolve_analysis_settings("159920")
        self.assertEqual(hsi["index_code"], "HSI")
        self.assertEqual(hsi["danjuan_code"], "HKHSI")
        self.assertEqual(hsi.get("history_symbol"), "hkHSI")

    def test_new_name_inference_rules(self):
        kc50 = dividend.resolve_analysis_settings("588080", name="科创板50ETF易方达")
        self.assertEqual(kc50.get("analysis_mode"), "index")
        self.assertEqual(kc50["index_code"], "000688")

        zzhl = dividend.resolve_analysis_settings("159905", name="中证红利ETF工银")
        self.assertEqual(zzhl["index_code"], "000922")

        hsi = dividend.resolve_analysis_settings("513600", name="恒生指数ETF")
        self.assertEqual(hsi["index_code"], "HSI")

        # 「红利低波」优先于「中证红利」
        hldb = dividend.infer_mapping_from_name("中证红利低波ETF")
        self.assertEqual(hldb["index_code"], "H30269")
        # 「恒生科技」不被「恒生指数/恒生ETF」规则吞掉
        hstech = dividend.infer_mapping_from_name("恒生科技ETF")
        self.assertEqual(hstech["index_code"], "HSTECH")

    def test_proxy_asset_class_and_note(self):
        self.assertEqual(dividend.proxy_asset_class("黄金ETF博时"), "commodity")
        self.assertEqual(dividend.proxy_asset_class("豆粕ETF"), "commodity")
        self.assertEqual(dividend.proxy_asset_class("十年国债ETF"), "bond")
        self.assertEqual(dividend.proxy_asset_class("短融ETF"), "bond")
        self.assertEqual(dividend.proxy_asset_class("证券公司ETF"), "equity")
        self.assertEqual(dividend.proxy_asset_class(""), "equity")

        self.assertIn("商品类", dividend.proxy_valuation_note("黄金ETF博时"))
        self.assertIn("不适用", dividend.proxy_valuation_note("黄金ETF博时"))
        self.assertIn("债券/货币类", dividend.proxy_valuation_note("国开债ETF"))
        self.assertIn("etf.analysis", dividend.proxy_valuation_note("机器人ETF"))

        gold = dividend.resolve_analysis_settings("159937", name="黄金ETF博时")
        self.assertEqual(gold.get("asset_class"), "commodity")

    def test_market_prefixed_index(self):
        self.assertEqual(dividend._market_prefixed_index("399006"), "sz399006")
        self.assertEqual(dividend._market_prefixed_index("000300"), "sh000300")

    def test_fill_missing_pe(self):
        rows = [{"date": "2024-01-02", "close": 1.0, "pe": None}, {"date": "2024-01-03", "close": 1.1, "pe": 12.0}]
        dividend.fill_missing_pe(rows, 44.5)
        self.assertEqual(rows[0]["pe"], 44.5)
        self.assertEqual(rows[1]["pe"], 12.0)

    def test_analysis_support_map(self):
        items = dividend.analysis_support_map(["512890", "518880", "513100", "563360", "513390", "159937"])
        self.assertTrue(items["512890"]["supported"])
        self.assertTrue(items["518880"]["supported"])
        self.assertEqual(items["518880"]["mode"], "etf_proxy")
        self.assertTrue(items["513100"]["supported"])
        self.assertTrue(items["563360"]["supported"])
        self.assertTrue(items["513390"]["supported"])
        self.assertEqual(items["513390"]["mode"], "index")
        self.assertTrue(items["159937"]["supported"])
        self.assertEqual(items["159937"]["mode"], "etf_proxy")


class ServerFacadeTests(unittest.TestCase):
    def test_dividend_symbols_exposed_via_server(self):
        import server

        self.assertTrue(callable(server.get_dividend_dashboard))
        self.assertTrue(callable(server.analyze_dividend_data))
        self.assertIn("dividend", server.DEFAULT_CONFIG)


if __name__ == "__main__":
    unittest.main()
