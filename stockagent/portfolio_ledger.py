"""Canonical multi-account portfolio ledger. No network or persistence side effects."""

from copy import deepcopy
from datetime import date
from decimal import Decimal, InvalidOperation


DEFAULT_CATEGORIES = (
    ("sp500", "标普500", 45), ("nasdaq", "纳指100", 25),
    ("gold", "黄金", 15), ("dividend", "红利", 15),
)
TRADE_TYPES = {"buy", "sell", "deposit", "withdrawal", "dividend", "reinvest", "adjustment"}
ZERO = Decimal("0")


class PortfolioError(ValueError):
    """Invalid accounting operation; safe to show to the user."""


def number(value, label="金额", *, nullable=False):
    if nullable and value is None:
        return None
    if isinstance(value, bool):
        raise PortfolioError(f"{label}必须为有效数字")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise PortfolioError(f"{label}必须为有效数字") from None
    if not result.is_finite() or result < 0 or result > Decimal("1000000000000000"):
        raise PortfolioError(f"{label}超出有效范围")
    return result


def day(value, label="日期"):
    text = str(value or "")
    try:
        if date.fromisoformat(text).isoformat() != text:
            raise ValueError
    except ValueError:
        raise PortfolioError(f"{label}格式无效") from None
    return text


def identifier(value):
    text = str(value or "").strip()
    if not text or len(text) > 120 or any(not (c.isascii() and (c.isalnum() or c in "_:-.")) for c in text):
        raise PortfolioError("记录标识无效")
    return text


def named_rows(rows, label):
    if not isinstance(rows, list) or len(rows) > 10000:
        raise PortfolioError(f"{label}列表无效或过长")
    found = {}
    for row in rows:
        if not isinstance(row, dict):
            raise PortfolioError(f"{label}记录无效")
        key = identifier(row.get("id"))
        if key in found:
            raise PortfolioError(f"{label}含重复记录：{key}")
        found[key] = row
    return found


def validate_portfolio(raw):
    """Validate references and ledger invariants without rounding the source records."""
    if not isinstance(raw, dict) or raw.get("schema_version") != 1:
        raise PortfolioError("不支持的组合数据版本")
    p = deepcopy(raw)
    identifier(p.get("id"))
    if p.get("currency") != "CNY":
        raise PortfolioError("当前组合记账币种为人民币")
    day(p.get("baseline_date"), "建账日期")
    if type(p.get("revision")) is not int or p["revision"] < 0:
        raise PortfolioError("组合版本号无效")
    categories = named_rows(p.get("categories"), "资产类别")
    products = named_rows(p.get("products"), "产品")
    accounts = named_rows(p.get("accounts"), "账户")
    named_rows(p.get("openings"), "期初持仓")
    named_rows(p.get("transactions"), "交易")
    total = sum((number(c.get("target_pct"), "目标比例") for c in categories.values()), ZERO)
    if total != 100:
        raise PortfolioError("资产类别目标比例合计必须为100%")
    for c in categories.values():
        if number(c["target_pct"]) > 100 or not str(c.get("name", "")).strip():
            raise PortfolioError("资产类别名称或比例无效")
        primary = c.get("primary_product_id")
        if primary and (primary not in products or products[primary]["category_id"] != c["id"]):
            raise PortfolioError("主要买入产品必须属于该资产类别")
    for product in products.values():
        if product.get("category_id") not in categories:
            raise PortfolioError("产品所属资产类别不存在")
        if product.get("kind") not in {"exchange", "fund"}:
            raise PortfolioError("产品类型必须为场内或场外")
        if not str(product.get("name", "")).strip() or not str(product.get("symbol", "")).strip():
            raise PortfolioError("产品名称和代码不能为空")
        if product.get("currency", "CNY") != "CNY":
            raise PortfolioError("请先使用人民币计价产品")
        number(product.get("allocation_weight", 0), "类内分配比例")
        if number(product.get("allocation_weight", 0)) > 100:
            raise PortfolioError("类内分配权重不能超过100")
        for field in ("fee_rate_pct", "purchase_limit", "min_purchase"):
            if product.get(field) is not None:
                number(product[field], field)
        lot = number(product.get("lot_size", 100), "交易单位")
        if lot <= 0 or lot != lot.to_integral_value():
            raise PortfolioError("交易单位必须大于0")
        history = product.get("price_history", [])
        if not isinstance(history, list) or len(history) > 50000:
            raise PortfolioError("历史行情格式无效或过长")
        if len({row.get("date") for row in history if isinstance(row, dict)}) != len(history):
            raise PortfolioError("历史行情日期重复或格式无效")
        for mark in history + ([product["mark"]] if product.get("mark") else []):
            if not isinstance(mark, dict):
                raise PortfolioError("行情格式无效")
            if number(mark.get("price"), "价格/净值") <= 0:
                raise PortfolioError("价格/净值必须大于0")
            if day(mark.get("date"), "行情日期") > date.today().isoformat():
                raise PortfolioError("行情日期不能晚于今天")
            if not str(mark.get("source", "")).strip():
                raise PortfolioError("行情必须记录来源")
    for account in accounts.values():
        if not str(account.get("name", "")).strip():
            raise PortfolioError("账户名称不能为空")
        number(account.get("opening_cash"), "期初现金", nullable=True)
        if not isinstance(account.get("trading_cost",{}),dict):
            raise PortfolioError("账户费用格式无效")
        for field in ("commission_rate_pct", "min_commission"):
            number((account.get("trading_cost") or {}).get(field, 0), field)
    for plan in named_rows(p.get("plans", []), "投资计划").values():
        if plan.get("account_id") not in accounts or not str(plan.get("name", "")).strip():
            raise PortfolioError("计划名称或账户无效")
        if plan.get("strategy") not in {"initial", "dca", "dip"} or plan.get("cadence") not in {"weekly", "monthly"}:
            raise PortfolioError("计划策略或周期无效")
        day(plan.get("next_date"), "下次执行日期")
        if number(plan.get("amount"), "计划预算") <= 0:
            raise PortfolioError("计划预算必须大于0")
        if plan["strategy"] == "initial" and number(plan.get("target_capital"), "目标投资总额") <= 0:
            raise PortfolioError("建仓目标必须大于0")
        if plan["strategy"] == "dip" and not 0 < number(plan.get("drawdown_pct"), "回撤阈值") < 100:
            raise PortfolioError("回撤阈值必须介于0和100之间")
    for opening in p["openings"]:
        if opening.get("product_id") not in products or opening.get("account_id") not in accounts:
            raise PortfolioError("期初持仓引用的产品或账户不存在")
        number(opening.get("shares"), "期初份额")
        number(opening.get("cost_total"), "期初成本", nullable=True)
    seen_openings = [(o["account_id"], o["product_id"]) for o in p["openings"]]
    if len(set(seen_openings)) != len(seen_openings):
        raise PortfolioError("同账户同产品只能有一条期初持仓")
    for trade in p["transactions"]:
        if trade.get("account_id") not in accounts:
            raise PortfolioError("交易账户不存在")
        if trade.get("type") not in TRADE_TYPES or trade.get("status") not in {"pending", "confirmed", "cancelled"}:
            raise PortfolioError("交易类型或状态无效")
        if day(trade.get("date"), "交易日期") < p["baseline_date"]:
            raise PortfolioError("新交易不能早于建账日期，请调整期初持仓或导入完整历史")
        if trade["date"] > date.today().isoformat():
            raise PortfolioError("未来交易请录入投资计划")
        if trade.get("requested_date"):
            requested = day(trade["requested_date"], "申请日期")
            if not p["baseline_date"] <= requested <= trade["date"]:
                raise PortfolioError("申请日期必须介于建账和确认日期之间")
            if trade["type"] not in {"buy", "sell"}:
                raise PortfolioError("只有申赎可以包含申请日期")
            number(trade.get("requested_shares", trade.get("shares", 0)), "申请份额")
        if trade.get("cancelled_date"):
            if not trade["date"] <= day(trade["cancelled_date"], "取消日期") <= date.today().isoformat():
                raise PortfolioError("取消日期无效")
        if trade["type"] not in {"deposit", "withdrawal"} and trade.get("product_id") not in products:
            raise PortfolioError("交易产品不存在")
        if trade["status"] == "pending" and trade["type"] not in {"buy", "sell"}:
            raise PortfolioError("只有申购或赎回可以待确认")
        for field in ("amount", "shares", "price", "fee"):
            number(trade.get(field, 0), field)
        if trade["type"] == "adjustment" and not str(trade.get("note", "")).strip():
            raise PortfolioError("持仓校正必须填写原因")
    replay(p)
    return p


def replay(p, as_of=None):
    """Apply opening balances and confirmed trades; pending buys reserve cash once."""
    cash = {a["id"]: number(a.get("opening_cash"), nullable=True) for a in p["accounts"]}
    holdings = {}
    pending = {a["id"]: ZERO for a in p["accounts"]}
    external = ZERO
    for row in p["openings"]:
        holdings[(row["account_id"], row["product_id"])] = {
            "shares": number(row["shares"]), "cost": number(row.get("cost_total"), nullable=True),
            "realized": ZERO, "dividends": ZERO, "fees": ZERO, "reserved": ZERO,
        }
    # Replay applications and settlements separately so historical cash stays reserved.
    events = []
    for trade in p["transactions"]:
        requested = trade.get("requested_date")
        if requested and trade["status"] in {"confirmed", "cancelled"}:
            events.append({**trade, "date": requested, "status": "pending",
                           "shares": trade.get("requested_shares", trade.get("shares", 0))})
            events.append({**trade, "date": trade.get("cancelled_date", trade["date"]), "release": True})
        elif trade["status"] != "cancelled":
            events.append(trade)
    # Array order is the explicit tie breaker for multiple entries on a day.
    trades = sorted(enumerate(events), key=lambda pair: (pair[1]["date"], pair[0]))
    for _, trade in trades:
        if as_of and trade["date"] > as_of:
            continue
        account = trade["account_id"]
        kind = trade["type"]
        amount = number(trade.get("amount", 0))
        shares = number(trade.get("shares", 0))
        price = number(trade.get("price", 0))
        fee = number(trade.get("fee", 0))
        delta = ZERO
        if trade.get("release"):
            if kind == "buy":
                pending[account] -= amount
                if cash[account] is not None:
                    cash[account] += amount
            else:
                holdings[(account, trade["product_id"])]["reserved"] -= number(trade.get("requested_shares", shares))
            if trade["status"] == "cancelled":
                continue
        if kind in {"deposit", "withdrawal"}:
            if amount <= 0:
                raise PortfolioError("资金进出金额必须大于0")
            delta = amount if kind == "deposit" else -amount
            external += delta
        else:
            key = (account, trade["product_id"])
            h = holdings.setdefault(key, {"shares": ZERO, "cost": ZERO, "realized": ZERO,
                                          "dividends": ZERO, "fees": ZERO, "reserved": ZERO})
            if trade["status"] == "pending":
                if kind == "buy":
                    if amount <= 0:
                        raise PortfolioError("申购金额必须大于0")
                    delta = -amount
                    pending[account] += amount
                else:
                    if shares <= 0 or shares > h["shares"] - h["reserved"]:
                        raise PortfolioError("赎回份额超过可用持仓")
                    h["reserved"] += shares
            elif kind in {"buy", "reinvest"}:
                if shares <= 0 or price <= 0:
                    raise PortfolioError("成交份额和价格必须大于0")
                paid = shares * price + fee
                if kind == "buy":
                    delta = -paid
                else:
                    h["dividends"] += paid
                h["shares"] += shares
                if h["cost"] is not None:
                    h["cost"] += paid
                h["fees"] += fee
            elif kind == "sell":
                if shares <= 0 or price <= 0 or shares > h["shares"] - h["reserved"]:
                    raise PortfolioError("卖出份额超过可用持仓或价格无效")
                proceeds = shares * price - fee
                if proceeds < 0:
                    raise PortfolioError("卖出费用超过成交金额")
                delta = proceeds
                if h["cost"] is not None:
                    removed = h["cost"] * shares / h["shares"]
                    h["cost"] -= removed
                    if h["realized"] is not None:
                        h["realized"] += proceeds - removed
                else:
                    h["realized"] = None
                h["shares"] -= shares
                h["fees"] += fee
            elif kind == "dividend":
                if amount <= 0 or fee > amount:
                    raise PortfolioError("分红金额或费用无效")
                delta = amount - fee
                h["dividends"] += delta
                h["fees"] += fee
            elif kind == "adjustment":
                if h["reserved"] > shares:
                    raise PortfolioError("校正后的份额不足以覆盖待赎回份额")
                h["shares"] = shares
                h["cost"] = number(trade.get("cost_total"), "校正成本", nullable=True)
        if cash[account] is not None:
            cash[account] += delta
            if cash[account] < Decimal("-0.005"):
                raise PortfolioError("账户可用现金不足，请核对入金或期初现金")
    return {"holdings": holdings, "cash": cash, "pending": pending, "external": external}


def scalar(value):
    return None if value is None else float(Decimal(str(value)).quantize(Decimal("0.000001")))


def complete_sum(values):
    values = list(values)
    return None if any(v is None for v in values) else sum(values, ZERO)


def snapshot(p):
    """All three levels share these exact position values; unknowns propagate."""
    book = replay(p)
    positions = []
    for (account, product_id), h in book["holdings"].items():
        product = next(row for row in p["products"] if row["id"] == product_id)
        mark = product.get("mark") or {}
        price = number(mark.get("price"), nullable=True)
        value = h["shares"] * price if price is not None else (ZERO if not h["shares"] else None)
        unrealized = value - h["cost"] if value is not None and h["cost"] is not None else None
        profit = complete_sum((unrealized, h["realized"], h["dividends"]))
        positions.append({"account_id": account, "product_id": product_id, "category_id": product["category_id"],
                          **{k: scalar(v) for k, v in h.items()}, "value": scalar(value),
                          "unrealized": scalar(unrealized), "profit": scalar(profit),
                          "mark_date": mark.get("date"), "mark_source": mark.get("source")})
    def aggregate(rows):
        return {key: scalar(complete_sum(Decimal(str(row[key])) if row[key] is not None else None for row in rows))
                for key in ("value", "cost", "unrealized", "realized", "dividends", "fees", "profit")}
    products = [{**product, **aggregate([r for r in positions if r["product_id"] == product["id"]]),
                 "shares": sum(r["shares"] for r in positions if r["product_id"] == product["id"])}
                for product in p["products"]]
    categories = [{**category, **aggregate([r for r in positions if r["category_id"] == category["id"]])}
                  for category in p["categories"]]
    total = aggregate(positions)
    for row in [*products, *categories, total]:
        row["holding_return_pct"] = row["unrealized"] / row["cost"] * 100 if row["cost"] and row["unrealized"] is not None else None
    cash = complete_sum(book["cash"].values())
    pending = sum(book["pending"].values(), ZERO)
    assets = complete_sum((number(total["value"], nullable=True), cash, pending))
    total.update(cash=scalar(cash), pending=scalar(pending), assets=scalar(assets), net_flows=scalar(book["external"]))
    for category in categories:
        category["actual_pct"] = category["value"] / total["value"] * 100 if total["value"] and category["value"] is not None else None
        category["deviation_pct"] = category["actual_pct"] - category["target_pct"] if category["actual_pct"] is not None else None
    return {"total": total, "categories": categories, "products": products, "positions": positions,
            "accounts": [{**a, "cash": scalar(book["cash"][a["id"]]), "pending": scalar(book["pending"][a["id"]])} for a in p["accounts"]],
            "warnings": ["部分持仓缺少行情，组合市值和比例暂不完整"] if total["value"] is None else []}


def infer_category(entry):
    name = str(entry.get("name", ""))
    symbol = entry.get("symbol")
    if "标普" in name or symbol == "513500":
        return "sp500", "标普500"
    if "纳指" in name or "纳斯达克" in name or symbol == "513100":
        return "nasdaq", "纳指100"
    if "黄金" in name:
        return "gold", "黄金"
    if "红利" in name or symbol in {"512890", "563020"}:
        return "dividend", "红利"
    if "A500" in name.upper() or symbol == "563360":
        return "a500", "中证A500"
    if "恒生科技" in name or symbol == "513010":
        return "hangseng-tech", "恒生科技"
    return "unclassified", "待归类"


def legacy_cost_basis(workspace, symbol):
    """Only reconstruct a complete legacy ledger; partial histories remain unknown."""
    rows = [(t, 1) for t in workspace.get("buys",[]) if t.get("symbol") == symbol]
    rows += [(t, -1) for t in workspace.get("sells",[]) if t.get("symbol") == symbol]
    shares, cost = ZERO, ZERO
    for trade, direction in sorted(rows,key=lambda pair:pair[0].get("date", "")):
        qty = number(trade.get("shares",0))
        price = number(trade.get("price",0))
        if price <= 0 or (direction < 0 and qty > shares):
            return None
        if direction > 0:
            shares += qty
            cost += qty * price + number(trade.get("fee",0))
        elif shares:
            cost -= cost * qty / shares
            shares -= qty
    return cost


def migration_preview(workspace, today=None):
    """Preserve reported holdings at cutover; archive earlier trades without replay."""
    today = today or date.today().isoformat()
    categories = [{"id": key, "name": name, "target_pct": pct, "primary_product_id": None,
                   "allow_substitution": False} for key, name, pct in DEFAULT_CATEGORIES]
    p = {"schema_version": 1, "id": "main", "name": workspace.get("plan", {}).get("name") or "我的投资组合",
         "currency": "CNY", "baseline_date": today, "revision": 0, "categories": categories,
         "products": [], "accounts": [{"id": "legacy", "name": "原持仓（待核对账户）", "opening_cash": None}],
         "openings": [], "transactions": [], "plans": [], "migration": {"source_version": workspace.get("version", 10),
             "confirmed": False, "issues": [], "legacy_buys": deepcopy(workspace.get("buys", [])),
             "legacy_sells": deepcopy(workspace.get("sells", [])), "legacy_plan": deepcopy(workspace.get("plan", {})), "legacy_schedules": deepcopy(workspace.get("plan", {}).get("otc_dca", []))}}
    for entry in workspace.get("etfs", []):
        category_id, category_name = infer_category(entry)
        if category_id not in {c["id"] for c in categories}:
            categories.append({"id": category_id, "name": category_name, "target_pct": 0,
                               "primary_product_id": None, "allow_substitution": False})
        symbol = str(entry["symbol"])
        channels = {t.get("channel", "exchange") for t in workspace.get("buys", []) + workspace.get("sells", []) if t.get("symbol") == symbol}
        kind = "fund" if channels == {"otc"} else "exchange"
        product_id = f"{kind}:{symbol}"
        p["products"].append({"id": product_id, "symbol": symbol, "name": entry.get("name") or symbol,
                              "kind": kind, "category_id": category_id, "currency": "CNY", "allocation_weight": 0,
                              "mark": None, "active": True, "identity_review_required": channels == {"otc", "exchange"}})
        category = next(c for c in categories if c["id"] == category_id)
        if not category["primary_product_id"]:
            category["primary_product_id"] = product_id
        shares, unit_cost = number(entry.get("shares", 0)), number(entry.get("cost", 0))
        p["openings"].append({"id": f"opening:{symbol}", "account_id": "legacy", "product_id": product_id,
                              "shares": scalar(shares), "cost_total": scalar(shares * unit_cost) if unit_cost or not shares else None})
        traded = sum(number(t.get("shares", 0)) for t in workspace.get("buys", []) if t.get("symbol") == symbol) - sum(number(t.get("shares", 0)) for t in workspace.get("sells", []) if t.get("symbol") == symbol)
        if traded != shares:
            p["migration"]["issues"].append({"symbol": symbol, "type": "shares_mismatch", "holding_shares": scalar(shares), "trade_shares": scalar(traded)})
        else:
            legacy_cost = legacy_cost_basis(workspace,symbol)
            if unit_cost and legacy_cost is not None and abs(legacy_cost-shares*unit_cost)>Decimal("0.01"):
                p["migration"]["issues"].append({"symbol":symbol,"type":"cost_mismatch","holding_cost":scalar(shares*unit_cost),"trade_cost":scalar(legacy_cost)})
        if len(channels) > 1:
            p["migration"]["issues"].append({"symbol": symbol, "type": "mixed_channels"})
        if category_id == "unclassified":
            p["migration"]["issues"].append({"symbol": symbol, "type": "unclassified"})
    estimated = [t["id"] for t in workspace.get("buys", []) if t.get("otc_schedule_id")]
    p["migration"]["estimated_trade_ids"] = estimated
    return validate_portfolio(p)
