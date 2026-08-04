#!/usr/bin/env python3
"""全池 AI 审视：仲裁逻辑与入口单测（mock provider，不触网）。"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from stockagent.ai_service import (
    apply_portfolio_policy,
    review_portfolio,
    _validate_portfolio_proposal,
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


if __name__ == "__main__":
    unittest.main()
