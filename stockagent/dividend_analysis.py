"""Pure scoring, backtest, commentary, and payload assembly."""

import datetime
import math
import statistics
import time

from .dividend_constants import (
    BACKTEST_HORIZON_DAYS,
    BACKTEST_SCORE_BAND,
    DISCLAIMER,
    GRADE_BANDS,
    SCORE_WEIGHTS,
    TECH_GRADE_BANDS,
    TECH_SCORE_WEIGHTS,
    TEN_YEARS_TRADING_DAYS,
    WEEKDAY_ZH,
)
from .dividend_registry import dividend_settings, valuation_framework_applicable
from .indicators import RollingPercentile, bias_pct, bollinger, kdj, percentile_rank, rsi, sma, sma_series
from .symbols import as_of

def clamp(value, low=0.0, high=100.0):
    return max(low, min(high, value))


def annualized_tracking_error(etf_rows, index_rows, lookback=252):
    """同日收盘收益差的年化标准差，返回百分比。"""
    etf_by_date = {row.get("date"): row.get("close") for row in etf_rows or [] if row.get("date")}
    index_by_date = {row.get("date"): row.get("close") for row in index_rows or [] if row.get("date")}
    dates = sorted(set(etf_by_date) & set(index_by_date))
    differences = []
    for previous, current in zip(dates, dates[1:]):
        try:
            etf_return = float(etf_by_date[current]) / float(etf_by_date[previous]) - 1
            index_return = float(index_by_date[current]) / float(index_by_date[previous]) - 1
        except (TypeError, ValueError, ZeroDivisionError):
            continue
        differences.append(etf_return - index_return)
    differences = differences[-lookback:]
    if len(differences) < 30:
        return None
    return round(statistics.stdev(differences) * math.sqrt(252) * 100, 3)

def spread_anchor_score(spread):
    """股债利差绝对水平锚点分（利差越厚越值得买）。"""
    anchors = [(-1.0, 0.0), (0.0, 5.0), (1.0, 22.0), (1.5, 38.0), (2.0, 55.0), (2.5, 72.0), (3.0, 85.0), (4.0, 100.0)]
    if spread <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if spread <= x1:
            return y0 + (spread - x0) / (x1 - x0) * (y1 - y0)
    return anchors[-1][1]

def score_spread(spread, spread_percentile):
    """股债性价比分：绝对利差锚点 70% + 历史分位 30%。"""
    if spread is None:
        return None
    absolute = spread_anchor_score(spread)
    if spread_percentile is None:
        return clamp(absolute)
    return clamp(absolute * 0.7 + spread_percentile * 100 * 0.3)

def score_valuation(pe_percentile, pb=None):
    """估值分：PE 近 10 年分位（0..1）越低越好；PB 破净小幅加分。"""
    if pe_percentile is None:
        return None
    score = 100 - 60 * pe_percentile
    if pb is not None and pb < 1:
        score += 10
    return clamp(score)

def score_trend(bias):
    """趋势分：年线乖离为负（回调释放风险）加分，正乖离过大减分。"""
    if bias is None:
        return None
    return clamp(62 - 6 * bias, 5, 98)

def score_technical(rsi_value, kdj_values):
    """技术分：RSI 与 KDJ 越接近超卖越高。"""
    parts = []
    if rsi_value is not None:
        parts.append(clamp(100 - 1.6 * (rsi_value - 25), 5, 95))
    if kdj_values and kdj_values.get("k") is not None:
        parts.append(clamp(100 - 1.2 * (kdj_values["k"] - 15), 5, 95))
    if not parts:
        return None
    return sum(parts) / len(parts)

def combine_score(components, weights=None):
    """按权重合成综合评分；缺失分项按剩余权重归一。"""
    active_weights = weights or SCORE_WEIGHTS
    total = 0.0
    weight_sum = 0.0
    for key, weight in active_weights.items():
        value = components.get(key)
        if value is None:
            continue
        total += value * weight
        weight_sum += weight
    if weight_sum == 0:
        return None
    return round(total / weight_sum, 1)

def grade_for_score(score, framework="valuation"):
    if score is None:
        return {"grade": None, "action": "数据不足"}
    bands = TECH_GRADE_BANDS if framework == "technical" else GRADE_BANDS
    for threshold, grade, action in bands:
        if score >= threshold:
            return {"grade": grade, "action": action}
    return {"grade": "E", "action": bands[-1][2]}

def kdj_state_label(kdj_values):
    if not kdj_values:
        return "数据不足"
    j = kdj_values.get("j")
    if j is None:
        return "数据不足"
    if j < 10:
        return "超卖区间"
    if j > 90:
        return "超买区间"
    return "中性区间"

def rsi_state_label(rsi_value):
    if rsi_value is None:
        return "数据不足"
    if rsi_value < 30:
        return "超卖"
    if rsi_value > 70:
        return "超买"
    return "中性"

def percentile_label(percentile):
    if percentile is None:
        return "数据不足"
    pct = percentile * 100
    if pct >= 85:
        return "历史高位"
    if pct >= 60:
        return "历史偏高"
    if pct >= 40:
        return "历史中位"
    if pct >= 15:
        return "历史偏低"
    return "历史低位"

def build_spread_series(index_rows, dividend_yield, current_pe, treasury_rows):
    """用「当前股息率×当前PE」近似恒定派息水平，回推历史股息率与股债利差。

    dy_t ≈ (dy_now × pe_now) / pe_t，利差 = dy_t - 十年国债（按日期前向填充）。
    该口径用于历史分位与回测，非精确历史股息率。
    """
    if not dividend_yield or not current_pe or not treasury_rows:
        return []
    payout = dividend_yield * 100 * current_pe
    yields = {row["date"]: row["yield10y"] for row in treasury_rows}
    sorted_yield_dates = sorted(yields)
    series = []
    yield_index = 0
    last_yield = None
    for row in index_rows:
        pe = row.get("pe")
        date = row["date"]
        while yield_index < len(sorted_yield_dates) and sorted_yield_dates[yield_index] <= date:
            last_yield = yields[sorted_yield_dates[yield_index]]
            yield_index += 1
        if pe is None or not pe or last_yield is None:
            series.append(None)
            continue
        series.append(payout / pe - last_yield)
    return series

def compute_score_series(index_rows, spread_series, framework="valuation"):
    """逐日复算综合评分（分位只用截至当日的历史），用于回测。"""
    closes = [row["close"] for row in index_rows]
    highs = [row["high"] for row in index_rows]
    lows = [row["low"] for row in index_rows]
    pes = [row.get("pe") for row in index_rows]
    n = len(closes)
    technical_only = framework == "technical"
    weights = TECH_SCORE_WEIGHTS if technical_only else SCORE_WEIGHTS

    ma250 = sma_series(closes, 250)

    # RSI(14) Wilder 序列
    rsi_values = [None] * n
    period = 14
    if n > period:
        gains = losses = 0.0
        for i in range(1, period + 1):
            delta = closes[i] - closes[i - 1]
            gains += max(delta, 0.0)
            losses += max(-delta, 0.0)
        avg_gain = gains / period
        avg_loss = losses / period
        rsi_values[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
        for i in range(period + 1, n):
            delta = closes[i] - closes[i - 1]
            avg_gain = (avg_gain * (period - 1) + max(delta, 0.0)) / period
            avg_loss = (avg_loss * (period - 1) + max(-delta, 0.0)) / period
            rsi_values[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    # KDJ(9,3,3) 序列
    k_values = [None] * n
    k = d = 50.0
    for i in range(8, n):
        window_high = max(highs[i - 8 : i + 1])
        window_low = min(lows[i - 8 : i + 1])
        span = window_high - window_low
        rsv = 50.0 if span == 0 else (closes[i] - window_low) / span * 100
        k = (k * 2 + rsv) / 3
        d = (d * 2 + k) / 3
        k_values[i] = k

    pe_rank = RollingPercentile()
    spread_rank = RollingPercentile()
    scores = [None] * n
    min_rank_samples = 250
    for i in range(n):
        pe = pes[i]
        spread = spread_series[i] if i < len(spread_series) else None
        pe_pct = pe_rank.rank(pe) if len(pe_rank) >= min_rank_samples else None
        spread_pct = spread_rank.rank(spread) if len(spread_rank) >= min_rank_samples else None
        if pe is not None:
            pe_rank.add(pe)
        if spread is not None:
            spread_rank.add(spread)

        bias = None
        if ma250[i]:
            bias = (closes[i] / ma250[i] - 1) * 100
        components = {
            "spread": None
            if technical_only
            else (score_spread(spread, spread_pct) if spread is not None else None),
            "valuation": None if technical_only else score_valuation(pe_pct),
            "trend": score_trend(bias),
            "technical": score_technical(
                rsi_values[i],
                {"k": k_values[i]} if k_values[i] is not None else None,
            ),
        }
        if technical_only:
            if components["trend"] is None and components["technical"] is None:
                continue
        elif components["trend"] is None or (
            components["spread"] is None and components["valuation"] is None
        ):
            # 估值框架：至少要有趋势 + 一个估值维度
            continue
        scores[i] = combine_score(components, weights=weights)
    return scores

def backtest_forward_returns(index_rows, scores, target_score, horizon=BACKTEST_HORIZON_DAYS, band=BACKTEST_SCORE_BAND):
    """历史上评分落在 target±band 区间的日子，往后 horizon 个交易日的收益分布。"""
    closes = [row["close"] for row in index_rows]
    n = len(closes)
    samples = []
    if target_score is None:
        return {"horizon_days": horizon, "band": band, "samples": 0}
    for i in range(n - horizon):
        score = scores[i]
        if score is None or abs(score - target_score) > band:
            continue
        samples.append(closes[i + horizon] / closes[i] - 1)
    if not samples:
        return {"horizon_days": horizon, "band": band, "samples": 0}
    avg = sum(samples) / len(samples)
    wins = sum(1 for value in samples if value > 0)
    return {
        "horizon_days": horizon,
        "band": band,
        "samples": len(samples),
        "avg_return_pct": round(avg * 100, 2),
        "win_rate_pct": round(wins / len(samples) * 100, 1),
        "best_pct": round(max(samples) * 100, 2),
        "worst_pct": round(min(samples) * 100, 2),
    }

def win_rate_label(win_rate_pct):
    if win_rate_pct is None:
        return "样本不足"
    if win_rate_pct >= 80:
        return "正收益概率很高"
    if win_rate_pct >= 65:
        return "正收益概率较高"
    if win_rate_pct >= 50:
        return "胜率一般"
    return "胜率偏低"

def build_commentary(score_block, technicals, spread_block, valuation_block):
    """规则化「今日盘面」：位置 → 支撑压力 → 结论动作。"""
    lines = []
    boll = technicals.get("boll") or {}
    position = boll.get("position")
    bias = technicals.get("bias_pct")
    rsi_value = technicals.get("rsi14")
    grade = score_block.get("grade")

    if position == "below_lower":
        lines.append("指数已跌破布林下轨，短线进入超卖区域，恐慌盘释放中。")
    elif position == "lower_half":
        lines.append("目前的形态属于“上有压力，下有支撑”的震荡磨底阶段：上方是布林中轨压力，下方有下轨托底。")
    elif position == "upper_half":
        lines.append("指数运行在布林中轨上方，短期趋势偏强，中轨转为回踩支撑。")
    elif position == "above_upper":
        lines.append("指数已逼近或突破布林上轨，短线有过热迹象，追高性价比下降。")

    if bias is not None:
        if bias <= -5:
            lines.append(f"当前价格显著低于年线（乖离 {bias:+.2f}%），长期买点信号增强。")
        elif bias < 0:
            lines.append(f"价格回落到年线附近（乖离 {bias:+.2f}%），回调释放了风险，并没有破坏长期上涨逻辑，反而提供了更好的介入性价比。")
        elif bias <= 5:
            lines.append(f"价格站在年线上方（乖离 {bias:+.2f}%），趋势健康但已不算便宜。")
        else:
            lines.append(f"价格大幅偏离年线（乖离 {bias:+.2f}%），注意均值回归风险。")

    if rsi_value is not None and 30 <= rsi_value <= 70:
        lines.append(f"RSI {rsi_value:.0f}、KDJ 处于{technicals.get('kdj_label', '中性区间')}，没有超卖，短期大概率继续震荡，不会立刻大涨。")
    elif rsi_value is not None and rsi_value < 30:
        lines.append(f"RSI 已到 {rsi_value:.0f} 的超卖区，短线随时可能出现修复反弹。")
    elif rsi_value is not None:
        lines.append(f"RSI 高达 {rsi_value:.0f}，短线情绪偏热，谨防冲高回落。")

    spread = spread_block.get("value")
    if spread is not None:
        lines.append(
            f"股息率 {valuation_block.get('dividend_yield_pct', 0):.2f}% 对比十年国债 {spread_block.get('bond_yield', 0):.2f}%，"
            f"股债利差 {spread:.2f} 个百分点，处在{spread_block.get('label', '—')}，红利资产的底仓价值仍在。"
        )

    if grade in ("A", "B") and position in ("upper_half", "above_upper"):
        lines.append("盘面观察：评分偏乐观，但短线并不超卖，更适合等日 K 回落到布林中轨附近再观察。")
    elif grade in ("A", "B"):
        lines.append("盘面观察：评分与位置偏友好，性价比支撑较强。")
    elif grade == "C":
        lines.append("盘面观察：性价比中性，位置不极端。")
    else:
        lines.append("盘面观察：当前位置性价比一般，短线性价比偏弱。")
    return lines

def build_note_text(payload):
    """生成小红书风格笔记文本（可直接复制发布）。"""
    index_block = payload.get("index") or {}
    valuation = payload.get("valuation") or {}
    bond = payload.get("bond") or {}
    spread = payload.get("spread") or {}
    technicals = payload.get("technicals") or {}
    score = payload.get("score") or {}
    backtest = payload.get("backtest") or {}
    etf = payload.get("etf") or {}

    as_of_date = index_block.get("date") or time.strftime("%Y-%m-%d")
    try:
        parsed = datetime.date.fromisoformat(as_of_date)
        weekday = WEEKDAY_ZH[parsed.weekday()]
        date_compact = f"{parsed.year}.{parsed.month}.{parsed.day}"
    except ValueError:
        weekday = ""
        date_compact = as_of_date

    price = etf.get("price") if etf.get("price") is not None else index_block.get("close")
    change = etf.get("change_pct") if etf.get("change_pct") is not None else index_block.get("change_pct")
    price_label = f"{price:.3f}" if etf.get("price") is not None else (f"{price:.2f}" if price is not None else "—")

    lines = [f"{date_compact}{payload.get('name', '红利低波')}日度决策", ""]
    lines.append(f"以下数据截止{date_compact}（{weekday}）")
    lines.append(f"📊 {payload.get('index_full_name', '中证红利低波')}大盘数据")
    if price is not None:
        lines.append(f"-现价{price_label}，单日{change:+.2f}%" if change is not None else f"-现价{price_label}")
    if technicals.get("bias_pct") is not None:
        lines.append(f"-年线乖离{technicals['bias_pct']:+.2f}%")
    if valuation.get("dividend_yield_pct") is not None and bond.get("yield10y") is not None:
        lines.append(
            f"-股息率{valuation['dividend_yield_pct']:.2f}%，十年国债只有{bond['yield10y']:.2f}%，"
            f"股债利差{spread.get('value'):.2f}，处在{spread.get('label', '—')}"
        )
    if valuation.get("pe") is not None:
        pe_pct = valuation.get("pe_percentile_10y")
        pct_text = f"（近10年{pe_pct * 100:.0f}分位）" if pe_pct is not None else ""
        pb_text = f"、PB{valuation['pb']:.2f}" if valuation.get("pb") is not None else ""
        lines.append(f"-PE{valuation['pe']:.2f}{pct_text}{pb_text}")
    if technicals.get("rsi14") is not None:
        lines.append(f"-RSI{technicals['rsi14']:.0f}、KDJ处于{technicals.get('kdj_label', '中性区间')}")
    if score.get("total") is not None:
        bt_text = ""
        if backtest.get("samples"):
            bt_text = (
                f"；历史同评分区间，往后{backtest.get('horizon_days')}天平均收益"
                f"{backtest.get('avg_return_pct'):+.1f}%，{win_rate_label(backtest.get('win_rate_pct'))}"
            )
        lines.append(f"-综合评分{score['total']:.0f}分（{score.get('grade')}档，{score.get('action')}；评分仅作诊断，执行以定投策略为准）{bt_text}")
    lines.append("今日盘面：")
    lines.extend(payload.get("commentary") or [])
    lines.append(
        "⚠️ 免责声明：本图文仅为个人投资笔记，里面的表述只是按当前指标区间映射出的参考动作，"
        "不构成对任何具体产品或买卖时点的建议。市场有风险，操作需结合自身风险偏好与资金安排独立判断。"
    )
    lines.append("#红利低波#红利#高股息#股债性价比#资产配置#A股#投资笔记#中证红利低波")
    return "\n".join(lines)

def analyze_dividend_data(index_rows, valuation=None, treasury_rows=None, etf_quote=None, settings=None, chart_rows=None):
    """把原始数据组装成完整仪表盘 payload（纯函数，离线可测）。"""
    settings = settings or dividend_settings()
    valuation = valuation or {}
    treasury_rows = treasury_rows or []

    closes = [row["close"] for row in index_rows]
    highs = [row["high"] for row in index_rows]
    lows = [row["low"] for row in index_rows]
    latest = index_rows[-1]

    # ---- 技术面 ----
    ma250 = sma(closes, 250)
    bias = bias_pct(closes, 250)
    boll = bollinger(closes, 20, 2.0)
    rsi14 = rsi(closes, 14)
    kdj_values = kdj(highs, lows, closes, 9, 3, 3)
    technicals = {
        "ma250": round(ma250, 2) if ma250 is not None else None,
        "bias_pct": round(bias, 2) if bias is not None else None,
        "boll": {key: (round(value, 2) if isinstance(value, float) else value) for key, value in boll.items()} if boll else None,
        "rsi14": round(rsi14, 1) if rsi14 is not None else None,
        "rsi_label": rsi_state_label(rsi14),
        "kdj": {key: round(value, 1) for key, value in kdj_values.items()} if kdj_values else None,
        "kdj_label": kdj_state_label(kdj_values),
    }

    # ---- 估值 ----
    pes = [row.get("pe") for row in index_rows]
    pe_tail = [pe for pe in pes[-TEN_YEARS_TRADING_DAYS:] if pe is not None]
    current_pe = valuation.get("pe") or latest.get("pe")
    pe_percentile = valuation.get("pe_percentile")
    if pe_percentile is None and current_pe is not None and len(pe_tail) >= 250:
        pe_percentile = percentile_rank(pe_tail, current_pe)
    dividend_yield = valuation.get("dividend_yield")
    valuation_block = {
        "pe": round(current_pe, 2) if current_pe is not None else None,
        "pb": round(valuation["pb"], 2) if valuation.get("pb") is not None else None,
        "pe_percentile_10y": round(pe_percentile, 4) if pe_percentile is not None else None,
        "dividend_yield_pct": round(dividend_yield * 100, 2) if dividend_yield is not None else None,
        "roe_pct": round(valuation["roe"] * 100, 1) if valuation.get("roe") is not None else None,
        "source": valuation.get("source") or "中证指数官网",
    }

    # ---- 股债利差 ----
    bond_yield = treasury_rows[-1]["yield10y"] if treasury_rows else None
    spread_value = None
    spread_percentile = None
    spread_series = []
    if dividend_yield is not None and bond_yield is not None:
        spread_value = dividend_yield * 100 - bond_yield
        spread_series = build_spread_series(index_rows, dividend_yield, current_pe, treasury_rows)
        history = [value for value in spread_series if value is not None]
        if len(history) >= 250:
            spread_percentile = percentile_rank(history, spread_value)
    spread_block = {
        "value": round(spread_value, 2) if spread_value is not None else None,
        "percentile": round(spread_percentile, 4) if spread_percentile is not None else None,
        "label": percentile_label(spread_percentile),
        "bond_yield": round(bond_yield, 2) if bond_yield is not None else None,
        "note": "历史分位按「当前股息率×当前PE」回推派息水平近似计算",
    }
    bond_block = {
        "yield10y": round(bond_yield, 2) if bond_yield is not None else None,
        "date": treasury_rows[-1]["date"] if treasury_rows else None,
        "source": "东方财富数据中心（中债）",
    }

    # ---- 综合评分 ----
    asset_class = settings.get("asset_class") or "equity_core"
    framework = "technical" if not valuation_framework_applicable(asset_class) else "valuation"
    score_weights = TECH_SCORE_WEIGHTS if framework == "technical" else SCORE_WEIGHTS
    components = {
        "spread": None
        if framework == "technical"
        else (score_spread(spread_value, spread_percentile) if spread_value is not None else None),
        "valuation": None
        if framework == "technical"
        else (
            score_valuation(pe_percentile, valuation.get("pb"))
            if pe_percentile is not None
            else None
        ),
        "trend": score_trend(bias),
        "technical": score_technical(rsi14, kdj_values),
    }
    total = combine_score(components, weights=score_weights)
    grade = grade_for_score(total, framework=framework)
    component_labels = {
        "spread": "股债性价比",
        "valuation": "估值水位",
        "trend": "年线乖离",
        "technical": "短线技术",
    }
    score_block = {
        "total": total,
        "grade": grade["grade"],
        "action": grade["action"],
        "framework": framework,
        "components": [
            {
                "key": key,
                "label": component_labels[key],
                "score": round(components[key], 1) if components[key] is not None else None,
                "weight": score_weights[key],
                "applicable": key in score_weights,
            }
            for key in ("spread", "valuation", "trend", "technical")
            if key in score_weights
        ],
    }

    # ---- 历史同评分回测 ----
    scores = compute_score_series(index_rows, spread_series, framework=framework)
    backtest = backtest_forward_returns(index_rows, scores, total)
    backtest["label"] = win_rate_label(backtest.get("win_rate_pct"))

    # ---- 盘面点评（指数口径，与评分/估值同一套 technicals）----
    commentary = build_commentary(score_block, technicals, spread_block, valuation_block)

    # 决策指标仍按跟踪指数计算，走势图单独使用 ETF 实际价格。
    using_etf_chart = bool(chart_rows)
    chart_source_rows = chart_rows or index_rows
    chart_source_rows = chart_source_rows[-3000:] if len(chart_source_rows) > 3000 else chart_source_rows
    chart_closes = [row["close"] for row in chart_source_rows]
    chart_ma250 = sma(chart_closes, 250)
    chart_boll = bollinger(chart_closes, 20, 2.0)
    chart_points = [{"date": row["date"], "close": row["close"]} for row in chart_source_rows]
    chart_markers = {
        "ma250": round(chart_ma250, 3) if chart_ma250 is not None else None,
        "boll_mid": round(chart_boll["mid"], 3) if chart_boll else None,
        "boll_upper": round(chart_boll["upper"], 3) if chart_boll else None,
        "boll_lower": round(chart_boll["lower"], 3) if chart_boll else None,
    }
    price_basis = "etf" if using_etf_chart else "index"
    payload = {
        "name": settings.get("index_name", "红利低波"),
        "index_name": settings.get("index_name", "红利低波"),
        "index_full_name": settings.get("index_full_name", "中证红利低波"),
        "index_code": settings.get("index_code", "H30269"),
        "etf_name": settings.get("etf_name"),
        "asset_class": settings.get("asset_class") or "equity_core",
        "etf": etf_quote or {},
        "index": {
            "close": latest["close"],
            "change_pct": latest.get("change_pct"),
            "date": latest["date"],
            "source": "中证指数官网",
            "source_url": "https://www.csindex.com.cn/",
        },
        "valuation": valuation_block,
        "bond": bond_block,
        "spread": spread_block,
        "technicals": technicals,
        "score": score_block,
        "backtest": backtest,
        "commentary": commentary,
        "chart": {
            "name": settings.get("etf_name"),
            "symbol": settings.get("etf_symbol"),
            "price_basis": price_basis,
            "points": chart_points,
            "available_from": chart_source_rows[0]["date"] if chart_source_rows else None,
            "available_to": chart_source_rows[-1]["date"] if chart_source_rows else None,
            "markers": chart_markers,
        },
        "disclaimer": DISCLAIMER,
        "updated_at": as_of(None),
    }
    payload["note_text"] = build_note_text(payload)
    return payload
