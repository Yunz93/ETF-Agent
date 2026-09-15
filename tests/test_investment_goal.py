import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from stockagent import workspace_store


class InvestmentGoalTests(unittest.TestCase):
    def test_shared_normalization_fixtures(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/investment_goal.json").read_text())
        for row in fixture:
            with self.subTest(row=row):
                self.assertEqual(workspace_store.normalize_investment_goal(row["input"]), row["expected"])

    def test_goal_round_trip_preserves_plan_policy_and_trades(self):
        goal = {"annual_return_target_pct": 10, "horizon_years": 12, "max_drawdown_pct": 30}
        payload = {
            "etfs": [{"symbol": "510300", "shares": 100, "cost": 4, "target_weight": 100}],
            "buys": [{"id": "one", "symbol": "510300", "date": "2026-09-01", "shares": 100, "price": 4, "fee": 5}],
            "plan": {"strategy": "valuation", "investment_goal": goal, "execution_policy": {"premium_block_pct": 4}},
        }
        with tempfile.TemporaryDirectory() as tmp, patch.object(workspace_store, "WORKSPACE_PATH", Path(tmp) / "workspace.json"), \
                patch("stockagent.blob_store.blob_enabled", return_value=False), \
                patch("stockagent.blob_store.hydrate_local_json"), patch("stockagent.blob_store.persist_json"):
            saved = workspace_store.save_workspace(payload)
            loaded = workspace_store.get_workspace()
        self.assertEqual(loaded["plan"]["investment_goal"], workspace_store.normalize_investment_goal(goal))
        self.assertEqual(loaded["plan"]["execution_policy"]["premium_block_pct"], 4)
        self.assertEqual(loaded["plan"]["strategy"], "valuation")
        self.assertEqual(loaded["etfs"], saved["etfs"])
        self.assertEqual(loaded["buys"], saved["buys"])

    def test_legacy_plan_does_not_assume_risk_tolerance(self):
        plan = workspace_store.normalize_plan({"strategy": "valuation"})
        self.assertIsNone(plan["investment_goal"]["max_drawdown_pct"])
        self.assertIsNone(plan["investment_goal"]["annual_return_target_pct"])
        self.assertEqual(plan["strategy"], "valuation")
