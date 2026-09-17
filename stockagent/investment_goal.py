#!/usr/bin/env python3
"""Investment-goal normalization shared by storage and research services."""

import math


def normalize_investment_goal(payload):
    source = payload if isinstance(payload, dict) else {}

    def optional_number(key, minimum, maximum):
        value = source.get(key)
        if value is None or value == "" or isinstance(value, bool):
            return None
        try:
            number = float(value)
        except (ValueError, TypeError):
            return None
        if not math.isfinite(number) or not minimum <= number <= maximum:
            return None
        return math.floor(number * 100 + 0.5) / 100

    need = source.get("liquidity_need")
    return {
        "currency": "CNY",
        "account_cash": optional_number("account_cash", 0, 1e12),
        "account_debt": optional_number("account_debt", 0, 1e12),
        "near_term_cash_need": optional_number("near_term_cash_need", 0, 1e12),
        "annual_return_target_pct": optional_number("annual_return_target_pct", 0, 100),
        "horizon_years": optional_number("horizon_years", 1, 60),
        "max_drawdown_pct": optional_number("max_drawdown_pct", 0, 100),
        "single_index_warn_pct": optional_number("single_index_warn_pct", 1, 100),
        "liquidity_need": need if need in ("long_term", "within_3_years") else "unknown",
    }
