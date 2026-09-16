#!/usr/bin/env python3
"""场外定投与交易渠道字段持久化。"""

import unittest

from stockagent.workspace_store import normalize_otc_dca_schedules, normalize_workspace


class OtcDcaWorkspaceTests(unittest.TestCase):
    def test_normalize_otc_schedule(self):
        rows = normalize_otc_dca_schedules(
            [
                {
                    "id": "s1",
                    "symbol": "512890",
                    "amount": 1000,
                    "cadence": "monthly",
                    "day": 31,
                    "start_date": "2026-01-01",
                    "unit_price": 1.2,
                    "fee_rate_pct": 0.15,
                },
                {"symbol": "512890", "amount": 1000, "start_date": "2026-01-01"},
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["day"], 28)
        self.assertEqual(rows[0]["fee_rate_pct"], 0.15)

    def test_workspace_persists_otc_fields(self):
        workspace = normalize_workspace(
            {
                "etfs": [{"symbol": "512890", "name": "红利低波", "shares": 0, "cost": 0}],
                "plan": {
                    "name": "测试",
                    "otc_dca": [
                        {
                            "id": "s1",
                            "symbol": "512890",
                            "amount": 1000,
                            "cadence": "monthly",
                            "day": 8,
                            "start_date": "2026-01-01",
                            "unit_price": 1.1,
                            "fee_rate_pct": 0,
                            "enabled": True,
                        }
                    ],
                },
                "buys": [
                    {
                        "id": "otc_dca_s1_2026-01-08",
                        "symbol": "512890",
                        "date": "2026-01-08",
                        "price": 1.1,
                        "shares": 900,
                        "fee": 0,
                        "channel": "otc",
                        "otc_schedule_id": "s1",
                        "note": "场外定投自动记账",
                    }
                ],
            }
        )
        self.assertEqual(workspace["version"], 10)
        self.assertEqual(len(workspace["plan"]["otc_dca"]), 1)
        self.assertEqual(workspace["plan"]["otc_dca"][0]["symbol"], "512890")
        self.assertEqual(workspace["buys"][0]["channel"], "otc")
        self.assertEqual(workspace["buys"][0]["otc_schedule_id"], "s1")

    def test_legacy_trades_default_to_exchange(self):
        workspace = normalize_workspace(
            {
                "etfs": [{"symbol": "512890", "shares": 100, "cost": 1}],
                "buys": [
                    {
                        "id": "buy_1",
                        "symbol": "512890",
                        "date": "2026-01-02",
                        "price": 1,
                        "shares": 100,
                        "fee": 5,
                    }
                ],
            }
        )
        self.assertEqual(workspace["buys"][0]["channel"], "exchange")
        self.assertIsNone(workspace["buys"][0]["otc_schedule_id"])
        self.assertEqual(workspace["plan"]["otc_dca"], [])


if __name__ == "__main__":
    unittest.main()
