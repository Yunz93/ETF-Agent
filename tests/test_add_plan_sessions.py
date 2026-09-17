import copy
import unittest
from stockagent.workspace_store import normalize_add_plan_sessions, normalize_plan


def session(**changes):
    return {"symbol": "513100", "period": "2026-09-01", "expires": "2026-10-01", "created_at": "2026-09-16T02:00:00.000Z", "anchor_price": 100, "anchor": "price", "amount": 1000, "preset_label": "稳健两档", "levels": [{"drawdown_pct": 3, "ratio": 0.4}, {"drawdown_pct": 5, "ratio": 0.6}], "baseline_buy_ids": ["prior"], **changes}


class AddPlanSessionsTests(unittest.TestCase):
    def test_workspace_roundtrip_retains_price_budget_and_fill_baseline(self):
        raw = {"amount": 1000, "add_plan_sessions": {"513100": session()}}
        first = normalize_plan(raw)
        second = normalize_plan(copy.deepcopy(first))
        self.assertEqual(first["add_plan_sessions"], second["add_plan_sessions"])
        saved = second["add_plan_sessions"]["513100"]
        self.assertEqual(saved["anchor_price"], 100)
        self.assertEqual(saved["amount"], 1000)
        self.assertEqual(saved["baseline_buy_ids"], ["prior"])

    def test_invalid_created_at_does_not_crash_workspace_normalization(self):
        for value in [5, {}, [], None]:
            with self.subTest(value=value):
                self.assertEqual(normalize_add_plan_sessions({"513100": session(created_at=value)}), {})

    def test_impossible_or_reversed_periods_are_rejected(self):
        for changes in [{"period": "2026-02-30"}, {"expires": "2026-02-30"}, {"expires": "2026-09-01"}, {"expires": "2026-08-01"}]:
            with self.subTest(changes=changes):
                self.assertEqual(normalize_add_plan_sessions({"513100": session(**changes)}), {})

    def test_nonfinite_tier_weights_are_rejected(self):
        for value in [float("inf"), float("nan")]:
            with self.subTest(value=value):
                self.assertEqual(normalize_add_plan_sessions({"513100": session(levels=[{"drawdown_pct": 3, "ratio": value}])}), {})

    def test_history_is_bounded_and_drops_transaction_detail(self):
        history = [{**session(anchor_price=100 + i), "closed_at": "2026-09-16T03:00:00.000Z", "spent": 400, "remaining": 600, "buys": [{"id": "private-fill"}]} for i in range(30)]
        saved = normalize_add_plan_sessions({"513100": session(previous_snapshots=history)})["513100"]
        self.assertEqual(len(saved["previous_snapshots"]), 24)
        self.assertEqual(saved["previous_snapshots"][0]["anchor_price"], 106)
        self.assertEqual(saved["previous_snapshots"][-1]["anchor_price"], 129)
        self.assertTrue(all("buys" not in row and "baseline_buy_ids" not in row for row in saved["previous_snapshots"]))
        self.assertEqual(normalize_add_plan_sessions({"513100": saved})["513100"], saved)


if __name__ == "__main__":
    unittest.main()
