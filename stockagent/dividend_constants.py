"""Shared constants for ETF analysis."""

BACKTEST_HORIZON_DAYS = 60
BACKTEST_SCORE_BAND = 5.0
TEN_YEARS_TRADING_DAYS = 2500

SCORE_WEIGHTS = {
    "spread": 0.35,
    "valuation": 0.20,
    "trend": 0.25,
    "technical": 0.20,
}

# 商品/债券等无股票估值口径：诊断评分只保留趋势与短线技术。
TECH_SCORE_WEIGHTS = {
    "trend": 0.55,
    "technical": 0.45,
}


GRADE_BANDS = [
    (80, "A", "极佳区间"),
    (65, "B", "较好区间"),
    (50, "C", "中性区间"),
    (35, "D", "偏贵区间"),
    (0, "E", "过热区间"),
]

# 技术面框架下的档位语义（不暗示估值贵贱）。
TECH_GRADE_BANDS = [
    (80, "A", "超卖偏多"),
    (65, "B", "偏弱可关注"),
    (50, "C", "中性震荡"),
    (35, "D", "偏强谨慎"),
    (0, "E", "超买偏热"),
]

DISCLAIMER = (
    "本页面仅为个人投资研究笔记，评分与文字只是按当前指标区间映射出的参考动作，"
    "不构成对任何具体产品或买卖时点的建议。市场有风险，操作需结合自身风险偏好与资金安排独立判断。"
)

WEEKDAY_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
