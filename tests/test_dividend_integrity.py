"""Decision-boundary regressions: absent evidence must not produce stronger advice."""
import datetime
import time
import unittest
from unittest import mock

from stockagent import dividend_analysis as analysis
from stockagent import dividend_sources as sources
from stockagent.state import HISTORY_CACHE


def rows(count=500, verified=False):
    result = []
    for i in range(count):
        date = (datetime.date(2020, 1, 1) + datetime.timedelta(days=i)).isoformat()
        close = 1000 - i
        row = {"date": date, "close": close, "high": close + 1, "low": close - 1, "pe": 10 + i / 1000}
        if verified:
            row.update(valuation_point_in_time=True, valuation_available_at=date,
                       valuation_source="test publication archive", dividend_yield=0.04)
        result.append(row)
    return result


class DecisionEvidenceTests(unittest.TestCase):
    def test_missing_valuation_never_receives_positive_grade(self):
        history = rows()
        for row in history:
            row["pe"] = None
        payload = analysis.analyze_dividend_data(history, settings={"asset_class": "equity_core"})
        self.assertIsNone(payload["score"]["grade"])
        self.assertIsNone(payload["score"]["total"])
        self.assertFalse(payload["data_quality"]["decision_usable"])
        self.assertIn("valuation", payload["score"]["missing_required"])
        self.assertIsNotNone(payload["technicals"]["rsi14"])

    def test_invalid_valuation_is_not_scored_as_cheap(self):
        history = rows()
        for row in history:
            row["pe"] = None
        for pe, percentile in [(float("nan"), 0), (-3, 0), (12, float("nan")), (12, -0.1), (12, 1.1)]:
            with self.subTest(pe=pe, percentile=percentile):
                payload = analysis.analyze_dividend_data(history, {"pe": pe, "pe_percentile": percentile}, settings={"asset_class": "equity_core"})
                self.assertIsNone(payload["score"]["total"])

    def test_unknown_ohlc_does_not_produce_kdj(self):
        history = rows()
        history[-1]["ohlc_complete"] = False
        payload = analysis.analyze_dividend_data(history, settings={"asset_class": "equity_core"})
        self.assertIsNone(payload["technicals"]["kdj"])
        self.assertFalse(payload["technicals"]["ohlc_complete"])

    def test_overseas_growth_does_not_use_chinese_bond_spread(self):
        payload = analysis.analyze_dividend_data(rows(), {"pe": 25, "pe_percentile": 0.5, "dividend_yield": 0.04},
            [{"date": "2021-01-01", "yield10y": 2}], settings={"asset_class": "equity_growth", "index_code": "NDX"})
        self.assertIsNone(payload["spread"]["value"])
        self.assertIsNone(payload["bond"]["yield10y"])
        self.assertFalse(payload["spread"]["applicable"])
        self.assertNotIn("spread", {part["key"] for part in payload["score"]["components"]})
        self.assertEqual(payload["score"]["model"], "growth")

    def test_retrospective_pe_is_not_point_in_time_evidence(self):
        payload = analysis.analyze_dividend_data(rows(), {"pe": 12, "pe_percentile": 0.2}, settings={"asset_class": "equity_core"})
        self.assertIsNotNone(payload["score"]["total"])
        self.assertEqual(payload["backtest"]["samples"], 0)
        self.assertEqual(payload["backtest"]["status"], "insufficient_point_in_time_history")

    def test_future_publication_cannot_enter_historical_scores(self):
        history = rows(verified=True)
        verified = analysis.compute_score_series(history, [], weights={"valuation": 0.6, "trend": 0.25, "technical": 0.15})
        self.assertIsNotNone(verified[-1])
        for row in history:
            row["valuation_available_at"] = "2099-01-01"
        rejected = analysis.compute_score_series(history, [], weights={"valuation": 0.6, "trend": 0.25, "technical": 0.15})
        self.assertTrue(all(score is None for score in rejected))

    def test_current_dividend_snapshot_does_not_change_published_history(self):
        history = rows(5, verified=True)
        bonds = [{"date": history[0]["date"], "available_at": history[0]["date"], "source": "release", "yield10y": 2}]
        first = analysis.build_spread_series(history, 0.01, 10, bonds)
        second = analysis.build_spread_series(history, 0.08, 40, bonds)
        self.assertEqual(first, second)
        self.assertEqual(first, [2.0] * 5)
        bonds[0]["available_at"] = "2099-01-01"
        self.assertEqual(analysis.build_spread_series(history, 0.08, 40, bonds), [None] * 5)

    def test_published_history_can_produce_descriptive_samples_without_future_leak(self):
        history = rows(verified=True)
        kwargs = {"framework": "valuation", "weights": {"valuation": 0.6, "trend": 0.25, "technical": 0.15}}
        full = analysis.compute_score_series(history, [], **kwargs)
        prefix = analysis.compute_score_series(history[:350], [], **kwargs)
        self.assertEqual(full[:350], prefix)
        payload = analysis.analyze_dividend_data(history, {"pe": 12, "pe_percentile": 0.2}, settings={"asset_class": "equity_core"})
        self.assertEqual(payload["backtest"]["status"], "descriptive_only")
        self.assertIn("不代表未来概率", payload["backtest"]["label"])
        self.assertEqual(payload["backtest"]["target_score"], full[-1])

    def test_close_only_cache_is_not_fabricated_ohlc(self):
        history = rows(80)
        points = [{"date": row["date"], "close": row["close"]} for row in history]
        with mock.patch.dict(HISTORY_CACHE, {"A:512890:5y": {"expires": time.time() + 300, "payload": {"points": points}}}, clear=True), \
             mock.patch.object(sources, "fetch_tencent_index_history", return_value=history) as fetch:
            result, source = sources.fetch_etf_as_index_history("512890")
        fetch.assert_called_once()
        self.assertEqual(source, "腾讯行情")
        self.assertGreater(result[-1]["high"], result[-1]["close"])


if __name__ == "__main__":
    unittest.main()
