#!/usr/bin/env python3
"""Decision portfolio: index sleeves with exchange ETFs and OTC funds."""

import unittest

from stockagent.decision_portfolio import (
    default_decision,
    index_instrument_catalog,
    normalize_decision,
    primary_symbol,
)
from stockagent.workspace_store import normalize_workspace


class DecisionPortfolioTests(unittest.TestCase):
    def test_default_covers_requested_indexes(self):
        decision = default_decision()
        codes = {row["index_code"] for row in decision["sleeves"]}
        self.assertEqual(codes, {"SPX", "NDX", "GOLD", "H30269"})
        self.assertEqual(sum(row["target_pct"] for row in decision["sleeves"]), 100)

    def test_normalize_rescales_weights_and_keeps_otc_fund(self):
        decision = normalize_decision(
            {
                "name": "试验组合",
                "sleeves": [
                    {
                        "id": "nasdaq",
                        "name": "纳指",
                        "index_code": "NDX",
                        "target_pct": 60,
                        "instruments": [
                            {
                                "symbol": "513390",
                                "name": "博时纳指",
                                "kind": "exchange",
                                "role": "primary",
                            },
                            {
                                "symbol": "000834",
                                "name": "某纳指联接",
                                "kind": "fund",
                            },
                        ],
                    },
                    {
                        "id": "sp500",
                        "name": "标普",
                        "index_code": "SPX",
                        "target_pct": 40,
                        "instruments": [
                            {"symbol": "513500", "kind": "exchange", "role": "primary"}
                        ],
                    },
                ],
            }
        )
        self.assertEqual(decision["sleeves"][0]["target_pct"] + decision["sleeves"][1]["target_pct"], 100)
        kinds = {row["kind"] for row in decision["sleeves"][0]["instruments"]}
        self.assertEqual(kinds, {"exchange", "fund"})
        self.assertEqual(primary_symbol(decision["sleeves"][0]), "513390")

    def test_migrate_from_portfolio_ledger(self):
        decision = normalize_decision(
            None,
            portfolio={
                "name": "旧账本",
                "categories": [
                    {"id": "nasdaq", "name": "纳指100", "target_pct": 25, "primary_product_id": "p1"},
                    {"id": "sp500", "name": "标普500", "target_pct": 75, "primary_product_id": "p2"},
                ],
                "products": [
                    {"id": "p1", "category_id": "nasdaq", "symbol": "513390", "name": "纳指ETF", "kind": "exchange"},
                    {"id": "p2", "category_id": "sp500", "symbol": "513500", "name": "标普ETF", "kind": "exchange"},
                    {"id": "p3", "category_id": "nasdaq", "symbol": "000834", "name": "纳指联接", "kind": "fund"},
                ],
            },
        )
        self.assertEqual(decision["name"], "旧账本")
        nasdaq = next(row for row in decision["sleeves"] if row["id"] == "nasdaq")
        self.assertEqual(nasdaq["index_code"], "NDX")
        self.assertEqual(len(nasdaq["instruments"]), 2)
        self.assertEqual(primary_symbol(nasdaq), "513390")

    def test_workspace_always_has_decision(self):
        workspace = normalize_workspace({"etfs": [{"symbol": "512890", "name": "红利"}]})
        self.assertIn("decision", workspace)
        self.assertGreaterEqual(len(workspace["decision"]["sleeves"]), 1)

    def test_catalog_groups_duplicate_index_etfs(self):
        catalog = index_instrument_catalog()
        ndx = next(row for row in catalog["indexes"] if row["index_code"] == "NDX")
        symbols = {row["symbol"] for row in ndx["instruments"]}
        self.assertIn("513390", symbols)
        self.assertIn("513100", symbols)


if __name__ == "__main__":
    unittest.main()
