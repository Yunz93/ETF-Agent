import copy
import json
import unittest
from unittest.mock import patch

from stockagent.ai_providers import AIProviderError, _decode_json_text, _openai_request
from stockagent.ai_service import (
    _analysis_snapshot,
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

    @patch("stockagent.ai_providers.http_post_json")
    def test_openai_schema_requests_dynamic_analysis_sections(self, post):
        post.return_value = {
            "output_text": json.dumps(
                {
                    "action": "keep",
                    "amount_multiplier": 1,
                    "confidence": "medium",
                    "summary": "维持规则建议。",
                    "focus_title": "仓位是当前首要约束",
                    "analysis_sections": [
                        {
                            "title": "仓位先于估值",
                            "items": ["当前仓位高于目标。"],
                        }
                    ],
                    "watch_items": [],
                    "evidence": [],
                    "conditions_to_reverse": [],
                    "data_limitations": [],
                }
            )
        }
        _openai_request("key", "model", "prompt", {}, 30, 800)
        schema = post.call_args.args[1]["text"]["format"]["schema"]
        self.assertIn("analysis_sections", schema["required"])
        self.assertIn("focus_title", schema["required"])
        self.assertNotIn("supporting_factors", schema["required"])

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

    def test_dynamic_analysis_sections_keep_etf_specific_titles(self):
        result = _validate_proposal(
            {
                "action": "keep",
                "amount_multiplier": 1,
                "confidence": "high",
                "summary": "仓位约束比估值更影响本期决策。",
                "focus_title": "高仓位压过估值优势",
                "analysis_sections": [
                    {
                        "title": "52% 仓位成为首要约束",
                        "items": ["当前仓位 52%，高于 30% 目标。"],
                    },
                    {
                        "title": "年线附近但不宜继续集中",
                        "items": ["年线乖离 -0.45%，趋势风险有限。"],
                    },
                    {"title": "", "items": ["无标题内容应忽略"]},
                ],
                "evidence": ["position.actual_weight"],
            },
            {"position.actual_weight"},
        )
        self.assertEqual(result["focus_title"], "高仓位压过估值优势")
        self.assertEqual(
            [section["title"] for section in result["analysis_sections"]],
            ["52% 仓位成为首要约束", "年线附近但不宜继续集中"],
        )

    def test_analysis_snapshot_includes_etf_identity_and_distinguishing_metrics(self):
        snapshot = _analysis_snapshot(
            {
                "symbol": "563360",
                "index_name": "中证A500",
                "index_full_name": "中证A500",
                "etf_name": "A500ETF华泰柏瑞",
                "etf": {
                    "symbol_name": "A500ETF华泰柏瑞",
                    "product_quality": {"tracking_error_pct": 2.46},
                },
                "technicals": {
                    "kdj": {"k": 37, "d": 38, "j": 34},
                    "kdj_label": "中性区间",
                },
            }
        )
        self.assertEqual(snapshot["index_name"], "中证A500")
        self.assertEqual(snapshot["etf"]["product_quality"]["tracking_error_pct"], 2.46)
        self.assertEqual(snapshot["technicals"]["kdj"]["k"], 37)

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

    def test_initial_build_uses_execution_budget_instead_of_monthly_budget(self):
        policy = apply_policy(
            {"remaining_amount": 18000},
            {
                "action": "keep",
                "amount_multiplier": 1,
                "confidence": "high",
            },
            {"may_increase": True},
            {
                "plan_budget": 5000,
                "execution_budget": 20000,
                "blocked": False,
                "would_exceed": False,
            },
            {"max_increase_multiplier": 1.5},
        )
        self.assertEqual(policy["final_amount"], 18000)

    def test_position_snapshot_uses_remaining_initial_gap(self):
        from stockagent.ai_service import _position_snapshot

        snapshot = _position_snapshot(
            {"execution_phase": "initial"},
            {
                "plan": {
                    "amount": 5000,
                    "capital_base": 100000,
                    "initial_target_pct": 30,
                },
                "etfs": [{"symbol": "512890", "shares": 10000, "cost": 1}],
            },
            "512890",
        )
        self.assertEqual(snapshot["execution_budget"], 20000)
        self.assertEqual(snapshot["plan_budget"], 5000)

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
                "focus_title": "仓位约束压过低估值",
                "analysis_sections": [
                    {
                        "title": "仓位先于估值",
                        "items": ["当前仓位 25%，高于 20% 目标。"],
                    },
                    {
                        "title": "低估值仍可保留观察",
                        "items": ["PE 10，近十年分位 20%。"],
                    },
                ],
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
        self.assertEqual(result["ai_proposal"]["focus_title"], "仓位约束压过低估值")
        sent_payload = provider.call_args.args[4]
        self.assertEqual(sent_payload["output_version"], 2)
        provider.assert_called_once()


if __name__ == "__main__":
    unittest.main()
