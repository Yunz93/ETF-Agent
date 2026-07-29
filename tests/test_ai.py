import copy
import json
import unittest
from unittest.mock import patch

from stockagent.ai_providers import AIProviderError, _decode_json_text
from stockagent.ai_service import (
    _validate_proposal,
    apply_policy,
    review_recommendation,
    test_connection as run_connection_test,
)
from stockagent.config_store import normalize_config, public_config
from stockagent.defaults import DEFAULT_CONFIG
from stockagent.state import AI_REVIEW_CACHE


class AIConfigTests(unittest.TestCase):
    def test_ai_config_is_normalized_and_capped(self):
        config = normalize_config(
            {
                "ai": {
                    "enabled": True,
                    "provider": "openai",
                    "models": {"openai": "gpt-custom"},
                    "timeout_seconds": 999,
                    "max_output_tokens": 10,
                    "max_increase_multiplier": 4,
                }
            }
        )
        self.assertTrue(config["ai"]["enabled"])
        self.assertEqual(config["ai"]["provider"], "openai")
        self.assertEqual(config["ai"]["models"]["openai"], "gpt-custom")
        self.assertEqual(config["ai"]["timeout_seconds"], 120)
        self.assertEqual(config["ai"]["max_output_tokens"], 400)
        self.assertEqual(config["ai"]["max_increase_multiplier"], 1.5)

    @patch(
        "stockagent.secret_store.credential_status",
        return_value={"configured": True, "source": "keychain"},
    )
    def test_public_config_exposes_status_but_never_key(self, _status):
        payload = public_config(copy.deepcopy(DEFAULT_CONFIG))
        encoded = json.dumps(payload)
        self.assertTrue(payload["ai"]["credentials"]["deepseek"]["configured"])
        self.assertNotIn("api_key", encoded.lower())


class AIProviderTests(unittest.TestCase):
    def test_json_output_accepts_fenced_payload(self):
        self.assertEqual(_decode_json_text('```json\n{"action":"keep"}\n```')["action"], "keep")

    def test_invalid_json_is_rejected(self):
        with self.assertRaises(AIProviderError) as caught:
            _decode_json_text("not-json")
        self.assertEqual(caught.exception.code, "invalid_output")

    @patch("stockagent.ai_service.get_api_key", return_value="test-secret-key")
    @patch(
        "stockagent.ai_service.request_review",
        return_value=(
            {
                "confidence": "low",
                "reasons": ["测试数据为空"],
                "review_opinion": "连接正常",
            },
            {"total_tokens": 20},
        ),
    )
    @patch(
        "stockagent.ai_service.ai_settings",
        return_value={
            "provider": "deepseek",
            "models": {"deepseek": "deepseek-v4-flash"},
            "timeout_seconds": 60,
        },
    )
    def test_connection_accepts_valid_json_without_investment_fields(
        self, _settings, _request, _key
    ):
        result = run_connection_test("deepseek")
        self.assertTrue(result["ok"])


class AIPolicyTests(unittest.TestCase):
    def setUp(self):
        AI_REVIEW_CACHE.clear()

    def test_low_confidence_cannot_change_baseline(self):
        policy = apply_policy(
            {"remaining_amount": 1000},
            {
                "action": "increase",
                "amount_multiplier": 1.5,
                "confidence": "low",
            },
            {"may_increase": True},
            {"plan_budget": 2000, "blocked": False, "would_exceed": False},
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["accepted_multiplier"], 1)
        self.assertEqual(policy["final_amount"], 1000)

    def test_stale_data_cannot_increase_amount(self):
        policy = apply_policy(
            {"remaining_amount": 1000},
            {
                "action": "increase",
                "amount_multiplier": 1.5,
                "confidence": "high",
            },
            {"may_increase": False},
            {"plan_budget": 2000, "blocked": False, "would_exceed": False},
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["accepted_multiplier"], 1)

    def test_unknown_evidence_path_is_removed_and_confidence_is_lowered(self):
        proposal = {
            "action": "keep",
            "amount_multiplier": 1,
            "confidence": "high",
            "summary": "维持",
            "evidence": ["analysis.nonexistent"],
        }
        result = _validate_proposal(proposal, {"analysis.valuation.pe"})
        self.assertEqual(result["evidence"], [])
        self.assertEqual(result["confidence"], "low")
        self.assertIn("不可验证字段", result["data_limitations"][0])

    def test_valid_evidence_survives_when_unknown_path_is_removed(self):
        proposal = {
            "action": "increase",
            "amount_multiplier": 1.5,
            "confidence": "high",
            "summary": "估值较低",
            "evidence": [
                "analysis.valuation.pe",
                "analysis.valuation.nonexistent",
            ],
        }
        result = _validate_proposal(proposal, {"analysis.valuation.pe"})
        self.assertEqual(result["evidence"], ["analysis.valuation.pe"])
        self.assertEqual(result["confidence"], "low")

    def test_position_breach_cannot_increase_amount(self):
        policy = apply_policy(
            {"remaining_amount": 1000},
            {
                "action": "increase",
                "amount_multiplier": 1.5,
                "confidence": "high",
            },
            {"may_increase": True},
            {"plan_budget": 2000, "blocked": True, "would_exceed": True},
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["accepted_multiplier"], 1)

    def test_reduce_action_cannot_raise_amount(self):
        policy = apply_policy(
            {"remaining_amount": 1000},
            {
                "action": "reduce",
                "amount_multiplier": 1.4,
                "confidence": "high",
            },
            {"may_increase": True},
            {"plan_budget": 2000, "blocked": False, "would_exceed": False},
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["accepted_multiplier"], 1)

    @patch("stockagent.ai_service.get_api_key", return_value="test-secret-key")
    @patch("stockagent.ai_service.get_workspace")
    @patch("stockagent.ai_service.get_dividend_dashboard")
    @patch("stockagent.ai_service.request_review")
    @patch("stockagent.ai_service.ai_settings")
    def test_review_uses_model_proposal_and_local_policy(
        self,
        settings,
        provider,
        dashboard,
        workspace,
        _key,
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
            "plan": {"amount": 2000, "strategy": "valuation"},
            "etfs": [{"symbol": "512890", "shares": 1000, "cost": 1, "target_weight": 20}],
        }
        dashboard.return_value = {
            "supported": True,
            "symbol": "512890",
            "updated_at": "2026-07-29T10:00:00+08:00",
            "analysis_mode": "index",
            "etf": {
                "symbol": "512890",
                "price": 1.2,
                "market": "A",
                "market_timestamp": 1,
            },
            "index": {"date": "2026-07-29", "close": 5000},
            "valuation": {"pe": 10, "pe_percentile_10y": 0.2},
            "score": {"total": 80, "grade": "A", "components": []},
        }
        provider.return_value = (
            {
                "action": "reduce",
                "amount_multiplier": 0.7,
                "confidence": "high",
                "summary": "仓位接近上限，降低本期投入。",
                "supporting_factors": ["估值较低"],
                "risks": ["仓位偏高"],
                "watch_items": ["观察仓位回落"],
                "evidence": ["position.actual_weight"],
                "conditions_to_reverse": ["仓位回到目标附近"],
                "data_limitations": [],
            },
            {"total_tokens": 100},
        )
        result = review_recommendation(
            {
                "symbol": "512890",
                "baseline": {
                    "stance": "invest",
                    "amount": 1000,
                    "remaining_amount": 1000,
                },
                "position": {
                    "actual_weight": 25,
                    "target_weight": 20,
                    "blocked": False,
                    "would_exceed": False,
                },
            }
        )
        self.assertEqual(result["policy_decision"]["accepted_multiplier"], 0.7)
        self.assertEqual(result["final_recommendation"]["amount"], 700)
        provider.assert_called_once()


if __name__ == "__main__":
    unittest.main()
