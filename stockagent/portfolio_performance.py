"""Dated portfolio valuations. Missing observations remain gaps, never future fills."""
from datetime import date
from decimal import Decimal

from .portfolio_ledger import ZERO, complete_sum, replay, scalar


def performance(portfolio, end=None, product_ids=None):
    end = end or date.today().isoformat()
    start = portfolio["baseline_date"]
    histories = {}
    dates = {start, end}
    for product in portfolio["products"]:
        if product_ids is not None and product["id"] not in product_ids:
            continue
        history = {row["date"]: row for row in product.get("price_history", [])}
        if product.get("mark"):
            history[product["mark"]["date"]] = product["mark"]
        histories[product["id"]] = history
        dates.update(d for d in history if start <= d <= end)
    for trade in portfolio["transactions"]:
        dates.update(trade[k] for k in ("date", "requested_date", "cancelled_date") if trade.get(k) and start <= trade[k] <= end)
    points = []
    opening_book = replay({**portfolio, "transactions": []})
    opening_values = []
    for (_, product_id), holding in opening_book["holdings"].items():
        if product_id not in histories:
            continue
        available = [d for d in histories[product_id] if d <= start and (date.fromisoformat(start)-date.fromisoformat(d)).days <= 7]
        opening_values.append(holding["shares"] * Decimal(str(histories[product_id][max(available)]["price"])) if available else (ZERO if not holding["shares"] else None))
    baseline = complete_sum([*opening_values, *(opening_book["cash"].values() if product_ids is None else [])])
    for day in sorted(d for d in dates if start <= d <= end):
        book = replay(portfolio, day)
        values, mark_dates = [], []
        for (_, product_id), holding in book["holdings"].items():
            if product_id not in histories:
                continue
            if not holding["shares"]:
                values.append(ZERO)
                continue
            history = histories[product_id]
            eligible = [d for d in history if d <= day]
            if not eligible:
                values.append(None)
                continue
            latest = max(eligible)
            # Quotes more than seven calendar days old cannot establish a valuation.
            if (date.fromisoformat(day) - date.fromisoformat(latest)).days > 7:
                values.append(None)
                continue
            values.append(holding["shares"] * Decimal(str(history[latest]["price"])))
            mark_dates.append(latest)
        assets = complete_sum([*values, *book["cash"].values(), *book["pending"].values()]) if product_ids is None else complete_sum(values)
        corrected = any(t["type"] == "adjustment" and t["status"] == "confirmed" and t["date"] <= day and (product_ids is None or t["product_id"] in product_ids) for t in portfolio["transactions"])
        elapsed = (date.fromisoformat(day)-date.fromisoformat(start)).days
        weighted_flows = ZERO
        net_flows = ZERO
        for trade in portfolio["transactions"]:
            if trade["status"] != "confirmed" or trade["date"] > day:
                continue
            flow = ZERO
            if product_ids is None and trade["type"] in {"deposit", "withdrawal"}:
                flow = Decimal(str(trade["amount"])) * (1 if trade["type"] == "deposit" else -1)
            elif product_ids is not None and trade.get("product_id") in product_ids:
                fee = Decimal(str(trade.get("fee",0)))
                if trade["type"] in {"buy", "sell"}:
                    flow = Decimal(str(trade["shares"])) * Decimal(str(trade["price"])) * (1 if trade["type"] == "buy" else -1) + fee
                elif trade["type"] == "dividend":
                    flow = -Decimal(str(trade["amount"])) + fee
            weight = Decimal((date.fromisoformat(day)-date.fromisoformat(trade["date"])).days) / elapsed if elapsed else ZERO
            net_flows += flow
            weighted_flows += flow * weight
        profit = assets - baseline - net_flows if assets is not None and baseline is not None and not corrected else None
        denominator = baseline + weighted_flows if baseline is not None else None
        period_return = profit / denominator * 100 if elapsed and profit is not None and denominator is not None and denominator > 0 else None
        points.append({"date": day, "assets": scalar(assets), "net_flows": scalar(net_flows),
                       "profit": scalar(profit), "return_pct": scalar(period_return), "oldest_mark_date": min(mark_dates) if mark_dates else None})
    return {"baseline_date": start, "points": points,
            "status": "available" if len(points) > 1 and all(p["profit"] is not None for p in points) else "incomplete",
            "method": ("以建账日期初市值为起点，买入为流入，卖出和现金分红为流出；不含账户现金及待确认申请。" if product_ids is not None else "建账日期初市值为起点，扣除入出金。") + "区间收益率使用按资金日期加权的Modified Dietz近似法，不是年化。行情最多沿用7个自然日，缺失区间不补值。持仓校正后暂停期间收益统计。"}
