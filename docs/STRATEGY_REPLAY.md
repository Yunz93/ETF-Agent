# 策略回放历史包 v1

研究页分开提供“月度价格基准”和“导入历史包的实际规则回放”。在线价格接口缺少原时点估值、情绪和交易条件，因此不能自动生成可信的完整策略回放。不要把当前评分回填到历史，不要拼接上市前指数价格冒充基金历史。

## 如何使用

在定投计划的“长期研究”页展开“完整策略回放与时间留出验证”，导入最多 20 MB 的 JSON。导入包中的计划独立于当前工作区；运行和导出均不写入持仓、配置或交易记录。“导出可重放历史”保存可原样再导入的紧凑历史 JSON；“导出回放报告”另存每日权益、模拟交易、被拦截理由和分段指标。报告不作为历史包导入，结果体不会占用历史包的 20 MB 配额。导入会同时检查原始文件及规范化后历史内容的字节大小。

此工具校验结构和因果时间，不能证明提供者的声明真实。由数据提供者核实 source、point_in_time、calendar_complete、dividends_complete 和 corporate_actions_complete；没有可靠证据时保留“历史不足”。至少 252 个共同交易日且跨度一年，最多 5200 个交易日。短历史不代表长期策略有效。

## 数据结构

以下为结构示意，只有一个交易日，故不能通过完整历史门槛。金额为人民币，份额为基金份额，PE/利差分位为 0–1，价差和溢折价为百分数。全部时间戳必须带时区。每个正权重 ETF 每日均须有明确报价、分析、现金分红和份额因子，无分红写 0，无拆并份写 1。

```json
{
  "schema": "stockagent-strategy-replay-v1",
  "source": "提供者、可核验档案标识或版本",
  "parameters_fixed_at": "2020-01-01T08:00:00+08:00",
  "target_weights": { "510300": 100 },
  "price_basis": "raw_with_cash_dividends",
  "dividends_complete": true,
  "corporate_actions_complete": true,
  "calendar_complete": true,
  "slippage_bps": 10,
  "initial": {
    "as_of": "2020-01-01T15:00:00+08:00",
    "cash": 20000,
    "holdings": { "510300": 0 },
    "prices": { "510300": 4 }
  },
  "plan": {
    "amount": 2000,
    "cadence": "monthly",
    "day": 1,
    "capital_base": 20000,
    "initial_target_pct": 60,
    "initial_months": 6,
    "strategy": "valuation",
    "strategy_config": { "sentiment": { "enabled": false } },
    "trading_cost": {
      "lot_size": 100,
      "min_commission": 5,
      "commission_rate_pct": 0.01,
      "max_fee_ratio_pct": 0.25
    }
  },
  "days": [{
    "date": "2020-01-02",
    "trade_at": "2020-01-02T14:50:00+08:00",
    "contribution": 0,
    "assets": {
      "510300": {
        "source": "原始行情和分红档案标识",
        "close": 4,
        "cash_dividend": 0,
        "share_factor": 1,
        "quote": {
          "price": 4,
          "market_timestamp": "2020-01-02T14:49:00+08:00",
          "product_quality": { "premium_discount_pct": 0, "bid_ask_spread_pct": 0.01 }
        },
        "analysis": {
          "source": "当时已发布的分析输入及方法档案",
          "observed_at": "2020-01-01T15:00:00+08:00",
          "available_at": "2020-01-02T08:00:00+08:00",
          "point_in_time": true,
          "analyzed": true,
          "assetClass": "equity_core",
          "indexCode": "000300",
          "pePct": 0.4,
          "spreadPct": 0.5,
          "biasPct": 0,
          "grade": "C"
        }
      }
    }
  }]
}
```

`plan` 可以使用完整工作区计划结构，包含策略档位、覆盖策略及执行约束，但不要附带个人备注或不必要记录。输入参数通过与应用相同的 normalizePlan 规范化。参数固定时刻及初始估值时刻必须早于首日交易；初始估值距首日最多 15 天，避免把未观察的多年间隔纳入年化。初始资产和实际入金合计为零时不输出收益率。当前版本对非定额/再平衡的商品、债券策略返回历史不足，尚未定义其完整原时点宏观输入契约。

多个 ETF 跟踪同一指数时，analysis 还须包含原时点 `annual_fee_pct` 和 `fund_size_yi`，用于复用同指数费率/规模择优；缺少时拒绝完整回放。

开启情绪时，每日另提供 `sentiment: { "source": "...", "observed_at": "...", "available_at": "...", "point_in_time": true, "by_market": { "A": { "score": 50, "degraded": false } } }`。只需提供实际涉及的 A、US、HK 市场，分数须为 0–100，观察时刻不得晚于发布时间，发布时间严格早于交易时刻。不得用今天的情绪解释过去。

## 模拟和比较边界

- 直接调用 `buildSignalSnapshot` 和 `buildTradePlan`，复用建仓绝对缺口、估值/评分倍率、情绪、跨期 PE 滞回、现金释放、溢折价/价差、行情时效、整手、佣金、卖出与冲突约束。
- 每期计划日或其后第一个共同交易日评估一次。拒绝周末交易记录；节假日完整性仍由提供者核验。被拦截资金留在现金中，下期是否释放由同源规则决定。不模拟人工放行、盘中重试、单独分档加仓的人工操作或 AI 调整。
- 初始现金与每日 contribution 决定真实可用资金；计划预算不会自动变成现金，买入不会透支。初始持仓必须明确，即使为零。初始持仓和价格不得包含目标集合之外的资产；不支持的资产不能静默从净值中丢弃。建仓开始/完成状态须在初始快照时已知，拒绝未来日期。
- 同源“固定倍率基准”关闭买入倍率、个股覆盖和情绪叠加，保留相同建仓逻辑、卖出纪律和执行约束。因此它不是纯粹的买入持有基准；月度价格基准仍独立提供。
- 报价为交易时可观测原始价格，成交按买入上浮/卖出下浮 slippage_bps。日终 close 只用于估值，不能用前复权价成交。share_factor 在开盘前调整份额，cash_dividend 按调整后份额入账。税款、零碎份额现金补偿等无法用这些字段表达的事项不在当前契约内，应拒绝将此类历史用于完整验证。
- 每日外部入金视为期初流入：日收益因子 = 日终权益 /（前日权益 + 当日外部入金）。现金分红属于收益，不能从分母扣除。手续费和滑点实际减少权益。每日连乘净值用于年化和最大回撤，现金不计利息。
- 参数不搜索、不重估。前 70% 与后 30% 按顺序分段，后段继承各策略自己的持仓现金状态。公布参数指纹、分段区间、费用、滑点、现金比例和逐日曲线。历史选择参数可能已看过后段，故标记 chronological_holdout，而非真正前瞻 out_of_sample；不得将其解释为未来达标概率。
