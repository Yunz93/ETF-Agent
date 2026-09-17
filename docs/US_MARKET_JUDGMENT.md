# 标普与纳指市场判断

`GET /api/market/us-judgment` 返回 `SPX`、`NDX` 的只读判断，分析页对应 ETF 展示摘要。它不改动周期定投金额、不生成订单，也不能覆盖 `execution-policy.js` 的交易拦截。

## 证据顺序

1. 指数近 250 个交易日收盘高点及回撤；美债 10Y、2Y 当前值与近 20 个观测的变化（基点）。10Y 20 个观测上涨至少 30bp 视为快速上行；下行至少 20bp 视为回落。阈值为待回测的启发式。
2. Fed 政策与市场预期、盈利预期、MA120/MA250 是复核因素。当前自动数据源没有可验证的 Fed 预期和盈利预期，接口明确返回 `unknown`，不凭收益率猜测。
3. 市场状态可为 `rate_drawdown`、`economic_liquidity_crisis`、`policy_shock`、`drawdown_unclassified`、`normal_or_watch`、`insufficient_data`。经济/流动性危机或政策冲击只在有独立、已核实的信号时分类；现阶段实时接口通常会保留为“原因待核实”。降息和加息都不是单独的买卖条件。

## 分档与强度

| 指数 | 近高点回撤触发档 |
| --- | --- |
| 标普500 | 10%、15%、20%、30% |
| 纳指100 | 12%、20%、30%、40% |

档位只表示当前回撤所处位置。未建立独立预留资金账本和档位消费记录时，不展示加仓百分比或建议转出黄金/红利；`suggested_intensity` 为 null，实际预算以今日执行为准。档距是未验证的研究参数。

指数、10Y、2Y 的最新日期必须一致、不晚于评估日且距离评估日不超过5个日历日，否则降级为资料不足。5天只是没有交易日历时的保守资料检查，不等同于实时行情有效期；交易时仍使用执行政策的分钟级报价核验。

## 跨境 ETF

行情使用指数本身计算回撤，避免场内 ETF 折溢价扭曲触发档。场内买入仍需核对实时折溢价、价差和报价时效：缺溢价数据时为 `blocked_missing_premium`，溢价 2% 起提示比较场外 QDII 或等待，5% 起为 `blocked_high_premium`。纳指的 `513100` 和 `513390` 各自使用本 ETF 的折溢价，不共享一个报价。这是观察层提示，最终以项目现有交易执行规则为准。场外 QDII 需另核对申购额度、费用、净值时点及可用性。

数据来自项目现有的腾讯/新浪指数历史行情栈、东方财富美债收益率、场内 ETF 报价。失败时输出 `insufficient_data` 或 `unknown`，不伪造市场结论。分档和强度未经过含费用、无未来信息泄露的组合回测，不能视为已验证最优参数。

设计依据：[FRED 的 10Y/2Y 国债收益率序列](https://fred.stlouisfed.org/graph/?id=DGS10%2CDGS2)、[美联储关于政策冲击、收益率与盈利预期如何共同影响股价的研究](https://www.federalreserve.gov/econres/feds/the-effect-of-the-federal-reserve-on-the-stock-market-magnitudes-channels-and-shocks.htm)、[美国 SEC 关于 ETF 折溢价风险的投资者公告](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-24)。这些材料支持观察维度，不验证本项目分档参数。
