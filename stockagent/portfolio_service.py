"""Revision-checked portfolio commands using the existing workspace store."""

import datetime
import calendar
import re
import json
from copy import deepcopy
from uuid import uuid4

from .paths import WORKSPACE_LOCK
from . import workspace_store
from .portfolio_ledger import PortfolioError, day, migration_preview, snapshot, validate_portfolio
from .portfolio_performance import performance
from .portfolio_plans import proposals


class PortfolioConflict(PortfolioError):
    pass


def backup_workspace():
    source = workspace_store.WORKSPACE_PATH
    name = f"workspace-before-portfolio-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex}.json"
    content = source.read_bytes() if source.exists() else json.dumps(workspace_store.empty_workspace()).encode()
    source.with_name(name).write_bytes(content)
    return name


def backups():
    folder = workspace_store.WORKSPACE_PATH.parent
    return [{"name": path.name, "saved_at": datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()}
            for path in sorted(folder.glob("workspace-before-portfolio-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            if not path.is_symlink() and path.is_file()]


def rollback_workspace(name, revision):
    if not isinstance(name, str) or not re.fullmatch(r"workspace-before-portfolio-[A-Za-z0-9-]+\.json", name):
        raise PortfolioError("备份文件名无效")
    target = workspace_store.WORKSPACE_PATH.with_name(name)
    if target.is_symlink() or not target.is_file():
        raise PortfolioError("备份不存在")
    content = target.read_bytes()
    try:
        restored = json.loads(content)
    except (ValueError, UnicodeError):
        raise PortfolioError("备份内容无效") from None
    if not isinstance(restored, dict) or not isinstance(restored.get("etfs"), list):
        raise PortfolioError("备份工作区格式无效")
    normalized = workspace_store.normalize_workspace(restored)
    normalized["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if normalized.get("portfolio"):
        normalized["portfolio"]["revision"] = max(revision, normalized["portfolio"]["revision"]) + 1
    backup_workspace()
    from .blob_store import WORKSPACE_BLOB_PATH, persist_json
    persist_json(WORKSPACE_BLOB_PATH, normalized)
    temporary = workspace_store.WORKSPACE_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(workspace_store.WORKSPACE_PATH)
    return envelope(normalized)


def envelope(workspace):
    portfolio = workspace.get("portfolio")
    preview = portfolio or migration_preview(workspace)
    return {"active": bool(portfolio), "portfolio": preview, "summary": snapshot(preview), "performance": performance(preview), "proposals": proposals(preview),
            "workspace_updated_at": workspace.get("updated_at"), "backups": backups()}


def get_portfolio(refresh=False):
    workspace = workspace_store.get_workspace()
    result = envelope(workspace)
    if refresh:
        result["portfolio"], result["quote_warning"] = refresh_marks(result["portfolio"])
        result["summary"] = snapshot(result["portfolio"])
        result["performance"] = performance(result["portfolio"])
    return result


def get_detail_performance(kind, identifier):
    workspace = workspace_store.get_workspace()
    p = workspace.get("portfolio") or migration_preview(workspace)
    if kind == "product":
        ids = {r["id"] for r in p["products"] if r["id"] == identifier}
    elif kind == "category" and any(c["id"] == identifier for c in p["categories"]):
        ids = {r["id"] for r in p["products"] if r["category_id"] == identifier}
    else:
        raise PortfolioError("找不到资产类别或产品")
    if kind == "product" and not ids:
        raise PortfolioError("找不到产品")
    return {"revision":p["revision"], "workspace_updated_at":workspace.get("updated_at"), "performance":performance(p,product_ids=ids)}


def refresh_marks(portfolio):
    from .quotes import get_etf_quotes

    p = deepcopy(portfolio)
    symbols = [r["symbol"] for r in p["products"] if r["kind"] == "exchange"]
    if not symbols:
        return p, None
    response = get_etf_quotes(symbols)
    quotes = {q["symbol"]: q for q in response.get("quotes", [])}
    for product in p["products"]:
        quote = quotes.get(product["symbol"]) if product["kind"] == "exchange" else None
        if not quote or not quote.get("price") or not quote.get("market_timestamp"):
            continue
        mark_date = datetime.datetime.fromtimestamp(quote["market_timestamp"], datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()
        if product.get("mark") and product["mark"]["date"] > mark_date:
            continue
        product["mark"] = {"price": quote["price"], "date": mark_date,
                           "source": response.get("provider") or "行情服务", "timestamp": quote["market_timestamp"]}
        product["quote"] = quote
        history = {r["date"]: r for r in product.get("price_history", [])}
        history[mark_date] = deepcopy(product["mark"])
        product["price_history"] = sorted(history.values(), key=lambda r: r["date"])
    return validate_portfolio(p), response.get("error") or response.get("warning")


def apply_command(portfolio, command):
    p = deepcopy(portfolio)
    action = command.get("action")
    data = command.get("data") or {}
    if not isinstance(data, dict):
        raise PortfolioError("操作数据必须为对象")
    if action == "configure":
        previous_products = {r["id"]:r for r in p["products"]}
        for key in ("name", "categories", "products", "accounts", "openings", "plans"):
            if key in data:
                p[key] = deepcopy(data[key])
        for product in p["products"]:
            previous = previous_products.get(product["id"])
            if previous and any(product.get(k) != previous.get(k) for k in ("symbol","kind")):
                if any(t.get("product_id") == product["id"] for t in p["transactions"]):
                    raise PortfolioError("已有交易的产品不能更换代码或类型，请新增产品并校正持仓")
                product["mark"] = None
                product["price_history"] = []
                product.pop("quote",None)
                product["identity_review_required"] = False
    elif action == "advance-plan":
        plan = next((r for r in p["plans"] if r["id"] == data.get("id")), None)
        if not plan:
            raise PortfolioError("找不到投资计划")
        if plan.get("enabled") is False:
            raise PortfolioError("请先启用计划")
        previous = datetime.date.fromisoformat(plan["next_date"])
        if plan["cadence"] == "weekly":
            following = previous + datetime.timedelta(days=7)
        else:
            year, month = previous.year + (previous.month == 12), previous.month % 12 + 1
            following = datetime.date(year, month, min(previous.day, calendar.monthrange(year, month)[1]))
        plan.setdefault("completed_periods", []).append(plan["next_date"])
        plan["next_date"] = following.isoformat()
    elif action == "record":
        row = deepcopy(data)
        row.setdefault("id", f"trade:{uuid4().hex}")
        row.setdefault("status", "confirmed")
        p["transactions"].append(row)
    elif action in {"confirm", "cancel", "correct"}:
        trade = next((t for t in p["transactions"] if t["id"] == data.get("id")), None)
        if trade is None:
            raise PortfolioError("找不到交易记录")
        if action in {"confirm", "cancel"} and trade["status"] != "pending":
            raise PortfolioError("该申请已经处理，不能重复确认或取消")
        if action == "cancel":
            trade["requested_date"] = trade["date"]
            trade["cancelled_date"] = day(data.get("date") or datetime.date.today().isoformat(), "取消日期")
            if trade["cancelled_date"] < trade["date"]:
                raise PortfolioError("取消日期不能早于申请日期")
            trade["status"] = "cancelled"
        elif action == "confirm":
            trade["requested_date"] = trade["date"]
            trade["requested_shares"] = trade.get("shares", 0)
            confirmed_date = day(data.get("date"), "确认日期")
            if confirmed_date < trade["date"]:
                raise PortfolioError("确认日期不能早于申请日期")
            trade.update({k: data[k] for k in ("date", "shares", "price", "fee") if k in data})
            trade["status"] = "confirmed"
        else:
            if not str(data.get("reason", "")).strip():
                raise PortfolioError("更正交易必须填写原因")
            before = deepcopy(trade)
            before.pop("corrections", None)
            trade.setdefault("corrections", []).append({"before": before, "reason": data["reason"]})
            trade.update({k: data[k] for k in ("date", "shares", "price", "fee", "amount", "note", "cost_total") if k in data})
    elif action in {"mark", "history"}:
        product = next((r for r in p["products"] if r["id"] == data.get("product_id")), None)
        if not product:
            raise PortfolioError("找不到产品")
        history = {r["date"]: r for r in product.get("price_history", [])}
        if product.get("mark"):
            history[product["mark"]["date"]] = product["mark"]
        rows = data.get("rows") if action == "history" else [{"price": data.get("price"), "date": data.get("date"), "source": data.get("source") or "手动录入"}]
        if not isinstance(rows, list) or not rows or len(rows) > 50000:
            raise PortfolioError("请提供有效的历史行情记录")
        for row in rows:
            if not isinstance(row, dict):
                raise PortfolioError("历史行情格式无效")
            history[day(row.get("date"), "行情日期")] = deepcopy(row)
        product["price_history"] = sorted(history.values(), key=lambda r: r["date"])
        product["mark"] = deepcopy(product["price_history"][-1])
    else:
        raise PortfolioError("不支持的组合操作")
    p["revision"] = portfolio["revision"] + 1
    return validate_portfolio(p)


def portfolio_command(command):
    if not isinstance(command, dict):
        raise PortfolioError("操作格式无效")
    refreshed = None
    if command.get("action") == "refresh":
        workspace = workspace_store.get_workspace()
        current = workspace.get("portfolio") or validate_portfolio(command.get("draft") or migration_preview(workspace))
        refreshed, warning = refresh_marks(current)
    with WORKSPACE_LOCK:
        workspace = workspace_store.get_workspace()
        current = workspace.get("portfolio")
        if command.get("action") == "rollback":
            if command.get("revision") != (current or {}).get("revision", 0) or command.get("workspace_updated_at") != workspace.get("updated_at"):
                raise PortfolioConflict("工作区已更新，请刷新后重试")
            return rollback_workspace((command.get("data") or {}).get("name"), (current or {}).get("revision", 0))
        if not current and command.get("action") in {"configure", "mark", "history", "refresh"}:
            if command.get("workspace_updated_at") != workspace.get("updated_at"):
                raise PortfolioConflict("原工作区已变化，请重新核对迁移预览")
            draft = refreshed or apply_command(validate_portfolio(command.get("draft")), command)
            return {"active": False, "portfolio": draft, "summary": snapshot(draft), "performance": performance(draft), "proposals": proposals(draft),
                    "workspace_updated_at": workspace.get("updated_at"),
                    "quote_warning": warning if refreshed is not None else None}
        if command.get("action") == "restore":
            if command.get("revision") != (current or {}).get("revision", 0):
                raise PortfolioConflict("组合已更新，请刷新后重试")
            if not current and command.get("workspace_updated_at") != workspace.get("updated_at"):
                raise PortfolioConflict("原工作区已变化，请刷新后重试")
            proposed = validate_portfolio(command.get("data"))
            proposed["revision"] = (current or {}).get("revision", 0) + 1
            source = workspace_store.WORKSPACE_PATH
            backup_name = f"workspace-before-portfolio-restore-{uuid4().hex}.json"
            source.with_name(backup_name).write_text(source.read_text(encoding="utf-8") if source.exists() else json.dumps(workspace, ensure_ascii=False), encoding="utf-8")
        elif command.get("action") == "activate":
            if current:
                raise PortfolioConflict("组合已启用，请刷新页面")
            if command.get("workspace_updated_at") != workspace.get("updated_at"):
                raise PortfolioConflict("原工作区已变化，请重新核对迁移预览")
            proposed = validate_portfolio(command.get("data"))
            # Archive the authoritative cutover state, never an edited client-supplied history.
            original = migration_preview(workspace, proposed["baseline_date"])
            proposed["migration"] = original["migration"]
            proposed["migration"]["confirmed"] = True
            proposed["revision"] = 1
            proposed["transactions"] = []
            proposed = validate_portfolio(proposed)
            backup_name = f"workspace-before-portfolio-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:6]}.json"
            backup = workspace_store.WORKSPACE_PATH.with_name(backup_name)
            source = workspace_store.WORKSPACE_PATH
            backup.write_text(source.read_text(encoding="utf-8") if source.exists() else json.dumps(workspace, ensure_ascii=False, indent=2), encoding="utf-8")
            proposed["migration"]["backup_file"] = backup_name
        else:
            if not current:
                raise PortfolioError("请先确认组合迁移")
            if command.get("revision") != current["revision"]:
                raise PortfolioConflict("组合已更新，请刷新后重试")
            if refreshed is not None:
                proposed = refreshed
                proposed["revision"] = current["revision"] + 1
            else:
                proposed = apply_command(current, command)
        updated = {**workspace, "portfolio": proposed,
                   "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        saved = workspace_store.save_workspace(updated)
        result = envelope(saved)
        if refreshed is not None:
            result["quote_warning"] = warning
        return result
