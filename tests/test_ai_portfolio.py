#!/usr/bin/env python3
"""全池 AI 审视：仲裁逻辑与入口单测（mock provider，不触网）。"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from stockagent.ai_service import (
    apply_portfolio_policy,
    review_portfolio,
    _validate_portfolio_proposal,
    _evidence_paths,
    _portfolio_snapshot,
    _validate_proposal,
)
from stockagent.state import AI_REVIEW_CACHE, AI_USAGE_SESSION


BASELINE = {
    "budget": 2000,
    "deploy_total": 2000,
    "cash_keep": 0,
    "cash_release": 1000,
    "strategy": "valuation",
    "allocations": [
        {"symbol": "512890", "name": "红利", "amount": 1200, "band": "低估区", "mult": 1.5},
        {"symbol": "510300", "name": "沪深300", "amount": 800, "band": "正常区", "mult": 1.0},
    ],
    "skipped": [],
}


class PortfolioPolicyTests(unittest.TestCase):
    def test_low_confidence_keeps_rule_amounts(self):
        policy = apply_portfolio_policy(
            BASELINE,
            {
                "action": "adjust",
                "confidence": "low",
                "evidence": ["baseline.deploy_total", "holdings"],
                "per_symbol_adjustments": [
                    {"symbol": "512890", "multiplier": 1.5, "reason": "加仓"}
                ],
            },
            {"may_increase": True},
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["status"], "kept")
        by_symbol = {row["symbol"]: row for row in policy["allocations"]}
        self.assertEqual(by_symbol["512890"]["final_amount"], 1200)
        self.assertFalse(by_symbol["512890"]["changed"])

    def test_insufficient_evidence_keeps_rule(self):
        proposal = _validate_portfolio_proposal(
            {
                "action": "adjust",
                "confidence": "high",
                "summary": "建议微调",
                "focus_title": "集中度偏高",
                "analysis_sections": [
                    {"title": "集中度", "items": ["前两名占比过高"]},
                    {"title": "估值", "items": ["红利仍便宜"]},
                ],
                "per_symbol_adjustments": [
                    {"symbol": "512890", "multiplier": 0.5, "reason": "降权"}
                ],
                "evidence": ["baseline.deploy_total"],
                "watch_items": [],
                "conditions_to_reverse": [],
                "data_limitations": [],
            },
            {"baseline.deploy_total", "holdings"},
        )
        self.assertEqual(proposal["confidence"], "low")
        policy = apply_portfolio_policy(
            BASELINE,
            proposal,
            {"may_increase": True},
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["allocations"][0]["final_amount"], 1200)

    def test_over_cap_scales_back(self):
        # budget 2000 + release 1000 = 3000 上限；1.5× 后 1800+1200=3000 刚好；用更大倍率触发缩回
        baseline = {
            **BASELINE,
            "allocations": [
                {"symbol": "512890", "name": "红利", "amount": 2000, "band": "低估", "mult": 1.5},
                {"symbol": "510300", "name": "沪深300", "amount": 1000, "band": "正常", "mult": 1.0},
            ],
        }
        policy = apply_portfolio_policy(
            baseline,
            {
                "action": "adjust",
                "confidence": "high",
                "evidence": ["baseline.budget", "baseline.cash_release"],
                "per_symbol_adjustments": [
                    {"symbol": "512890", "multiplier": 1.5, "reason": "加码"},
                    {"symbol": "510300", "multiplier": 1.5, "reason": "加码"},
                ],
            },
            {"may_increase": True},
            {"max_increase_multiplier": 1.5},
        )
        self.assertLessEqual(policy["final_total"], 3000.01)
        self.assertEqual(policy["cap"], 3000)
        self.assertTrue(any("缩回" in reason for reason in policy["reasons"]))

    def test_degraded_data_blocks_increase(self):
        policy = apply_portfolio_policy(
            BASELINE,
            {
                "action": "adjust",
                "confidence": "high",
                "evidence": ["baseline.deploy_total", "holdings"],
                "per_symbol_adjustments": [
                    {"symbol": "512890", "multiplier": 1.5, "reason": "加仓"},
                    {"symbol": "510300", "multiplier": 0.5, "reason": "减仓"},
                ],
            },
            {"may_increase": False, "critical_degraded_fields": ["512890.analysis"]},
            {"max_increase_multiplier": 1.5},
        )
        by_symbol = {row["symbol"]: row for row in policy["allocations"]}
        self.assertEqual(by_symbol["512890"]["final_amount"], 1200)  # 上调被禁
        self.assertEqual(by_symbol["510300"]["final_amount"], 400)  # 下调仍可


class EvidenceAndMarketSnapshotTests(unittest.TestCase):
    def test_only_nonempty_leaf_facts_include_array_indices(self):
        self.assertEqual(_evidence_paths({"holdings": [{"pe": 0, "missing": None}], "empty": {}, "blank": ""}), {"holdings.0.pe"})

    def test_repeated_evidence_cannot_authorize_single_or_portfolio_change(self):
        for validate, action in ((_validate_proposal, "increase"), (_validate_portfolio_proposal, "adjust")):
            proposal = validate({"action": action, "confidence": "high", "evidence": ["baseline.budget", "baseline.budget"]}, {"baseline.budget"})
            self.assertEqual(proposal["confidence"], "low")
            self.assertEqual(proposal["evidence"], ["baseline.budget"])

    def test_adjustment_requires_related_holding_not_names_or_other_symbols(self):
        holdings = [{"symbol": "512890", "actual_weight_pct": 80, "name": "红利"}, {"symbol": "510300", "actual_weight_pct": 20}]
        payload = {"holdings": holdings, "baseline": {"budget": 1000}}
        raw = {"action": "adjust", "confidence": "high", "per_symbol_adjustments": [{"symbol": "512890", "multiplier": 0.5}], "evidence": ["baseline.budget", "holdings.1.actual_weight_pct"]}
        self.assertEqual(_validate_portfolio_proposal(raw, _evidence_paths(payload), holdings)["confidence"], "low")
        raw["evidence"] = ["baseline.budget", "holdings.0.name"]
        self.assertEqual(_validate_portfolio_proposal(raw, _evidence_paths(payload), holdings)["confidence"], "low")
        raw["evidence"] = ["baseline.budget", "holdings.0.actual_weight_pct"]
        self.assertEqual(_validate_portfolio_proposal(raw, _evidence_paths(payload), holdings)["confidence"], "high")

    def test_weights_and_target_gaps_use_current_price(self):
        workspace = {"plan": {"capital_base": 10000, "initial_target_pct": 60}, "etfs": [
            {"symbol": "512890", "shares": 1000, "cost": 1, "target_weight": 50},
            {"symbol": "510300", "shares": 500, "cost": 4, "target_weight": 50},
        ]}
        snapshot = _portfolio_snapshot(workspace, {"512890": {"price": 4}, "510300": {"price": 2}})
        self.assertEqual(snapshot["weight_basis"], "market")
        first, second = snapshot["positions"]
        self.assertEqual(first["actual_weight_pct"], 80)
        self.assertEqual(second["actual_weight_pct"], 20)
        self.assertEqual(first["target_gap"], 0)
        self.assertEqual(second["target_gap"], 2000)

    def test_missing_one_held_price_invalidates_all_weights(self):
        with patch("stockagent.ai_service._cached_quote", return_value=None):
            snapshot = _portfolio_snapshot({"etfs": [
                {"symbol": "512890", "shares": 1, "cost": 99}, {"symbol": "510300", "shares": 1, "cost": 99}
            ]}, {"512890": {"price": 4}})
        self.assertFalse(snapshot["weights_complete"])
        self.assertTrue(all(row["actual_weight_pct"] is None for row in snapshot["positions"]))


class PortfolioReviewEntryTests(unittest.TestCase):
    def setUp(self):
        AI_REVIEW_CACHE.clear()
        AI_USAGE_SESSION.update({"requests": 0, "prompt_tokens": 0, "completion_tokens": 0})

    @patch("stockagent.ai_service.get_api_key", return_value="test-key")
    @patch("stockagent.ai_service.get_workspace")
    @patch("stockagent.ai_service.get_dividend_dashboard")
    @patch("stockagent.ai_service.request_review")
    @patch("stockagent.ai_service.ai_settings")
    def test_review_portfolio_keeps_on_low_confidence(
        self, settings, provider, dashboard, workspace, _key
    ):
        settings.return_value = {
            "enabled": True,
            "provider": "deepseek",
            "models": {"deepseek": "deepseek-v4-flash"},
            "timeout_seconds": 60,
            "max_output_tokens": 1800,
            "cache_minutes": 30,
            "max_increase_multiplier": 1.5,
        }
        workspace.return_value = {
            "plan": {
                "amount": 2000,
                "strategy": "valuation",
                "cash_reserve": {"balance": 500, "history": []},
            },
            "etfs": [
                {"symbol": "512890", "name": "红利", "shares": 1000, "cost": 1, "target_weight": 60},
                {"symbol": "510300", "name": "沪深300", "shares": 500, "cost": 4, "target_weight": 40},
            ],
        }
        dashboard.return_value = {
            "supported": True,
            "asset_class": "dividend",
            "valuation": {"pe_percentile_10y": 0.2},
            "spread": {"percentile": 0.7},
            "score": {"total": 78, "grade": "B"},
        }
        provider.return_value = (
            {
                "action": "adjust",
                "confidence": "low",
                "summary": "证据不足，维持规则。",
                "focus_title": "数据不够改分配",
                "analysis_sections": [
                    {"title": "规则优先", "items": ["置信度低时不动分配。"]},
                    {"title": "观察点", "items": ["等待估值更新。"]},
                ],
                "per_symbol_adjustments": [
                    {"symbol": "512890", "multiplier": 1.5, "reason": "本应加仓"}
                ],
                "watch_items": [],
                "evidence": ["baseline.deploy_total"],
                "conditions_to_reverse": [],
                "data_limitations": [],
            },
            {"prompt_tokens": 40, "completion_tokens": 10},
        )
        result = review_portfolio({"baseline": BASELINE, "force": True})
        self.assertEqual(result["policy_decision"]["status"], "kept")
        self.assertFalse(any(row["changed"] for row in result["final_allocations"]))
        # openai schema 参数应传到 request_review
        kwargs = provider.call_args.kwargs
        self.assertEqual(kwargs.get("schema_name"), "portfolio_review")
        self.assertEqual(AI_USAGE_SESSION["requests"], 1)
        model_input = provider.call_args.args[4]
        self.assertIn("investment_goal", model_input["plan"])
        self.assertIn("execution_policy", model_input["plan"])
        self.assertIn("trading_cost", model_input["plan"])
        self.assertIn("target_gap", model_input["holdings"][0])
        self.assertIn("premium_discount_pct", model_input["holdings"][0])
        self.assertFalse(result["amounts_executable"])
        self.assertTrue(result["requires_execution_validation"])


if __name__ == "__main__":
    unittest.main()
