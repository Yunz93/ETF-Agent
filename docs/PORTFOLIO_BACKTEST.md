# 组合回测：收益计量与基础对照（P0）

本阶段修正回测收益计量，提供可独立运行的基础对照。没有修改真实持仓、定投参数、交易拦截规则或首页收益曲线，也没有设置“预期年化 10%”。组合历史数据自动采集、目标配置页面及样本外策略评估不属于本阶段。

## 统一计量约定

Python `stockagent/portfolio_backtest.py` 与 JS `js/portfolio-backtest.js` 使用相同的收益定义。二者的交易模拟规则仍不同，不能仅因指标名称相同就把策略结果当成等价。

每个观测日，先按当日价格计算入金前资产，再追加本金和执行交易：

1. 持有期增长因子 = 本期入金前资产 / 上期交易后资产。
2. 交易成本因子 = 本期交易后资产 / 本期入金后、交易前资产。
3. 将两个因子相乘并逐期连乘，形成初始值为 1 的时间加权净值。

首次入金没有持有期增长，但首次交易费用必须计入净值。计算波动率时，首次费用并入第一个实际观测区间，不添加虚构的零收益月份。

| 指标 | Python 字段 | JS 字段 | 定义 |
| --- | --- | --- | --- |
| 期末资产 | `ending_value` | `endingEquity` | 持仓市值加现金 |
| 累计本金 | `contributed_capital` | `contributedCapital` | 本次模拟实际入金之和 |
| 净盈亏 | `net_profit` | `netProfit` | 期末资产减累计本金，已扣模拟交易费用 |
| 累计策略收益 | `total_return_pct` | `totalReturn` | 时间加权净值减 1 |
| 年化策略收益 | `annualized_return_pct` | `annualReturn` | 时间加权净值按实际天数 ACT/365 年化 |
| 个人年化收益 | `money_weighted_return_pct` | `moneyWeightedReturn` | 实际日期的入金与期末清算价值计算 XIRR，ACT/365 |
| 最大回撤 | `max_drawdown_pct` | `maxDrawdown` | 时间加权净值相对历史高点的跌幅，正数表示损失 |
| 年化波动率 | `annualized_volatility_pct` | `volatility` | 观测区间收益的样本标准差 × 年观测数平方根 |
| 双边成交比率 | `turnover_pct` | `turnoverApprox` | 累计买卖金额 / 观测期平均账户资产；不年化 |
| 平均现金占比 | `average_cash_pct` | `averageCashRatio` | 各观测日交易后现金占比的算术平均 |
| 期末现金占比 | `ending_cash_pct` | `endingCashRatio` | 期末现金 / 期末资产 |

Python `_pct` 字段以百分数返回，JS 收益与比率字段以小数返回。Python 金额保留两位小数、百分数保留四位；JS 保留计算精度。

XIRR 当前支持本回测的定期入金与期末清算，不接入真实账户的任意出入金流水。无足够日期、没有早期投入或求解区间内无解时返回 `null`，不伪造零收益。求解在 `log(1+r)` 的 [-20, 20] 范围内进行。

计量参考：[GIPS 关于外部现金流与时间加权收益的说明](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/)、[Microsoft XIRR 的 365 日年口径](https://support.microsoft.com/en-us/excel/functions/xirr-function)。本项目没有声明通过 GIPS 合规认证。

## Python API

`POST /api/strategy/backtest` 接受 `target_weights`、`monthly_budget`、`trading_cost`、`strategy_config` 以及显式传入的历史数据：

- `price_history`：按 ETF 代码分组的 `{date: "YYYY-MM-DD", close: 正数}` 数组。
- `pe_history`（可选）：按代码分组的 `{date, pe_percentile, as_of?}` 数组；分位沿用现有 0–1 或 0–100 输入约定，1 解释为 100%。
- `as_of` 表示公布日期；没有该字段时，调用方必须确保 `date` 当天已经可获得该数据。
- `trading_cost` 的 `min_commission`、`commission_rate_pct`、`max_fee_ratio_pct` 可显式为 0，0 不再被替换为默认费用。`max_fee_ratio_pct: 0` 表示不设手续费占比限制。

至少需要 36 个对齐月度价格观测，最多使用最近 60 个。窗口内月份须连续，且首个共同观测日每个品种均已有已知价格。该要求是数据可用门槛，不代表足以验证十年收益目标。

固定定投 `fixed` 和年度再平衡 `rebalance` 仅需要价格。`current` 是 PE 倍率实验：每个交易日都须有此前 45 日内、且严格早于交易日的已公布分位数据。45 日是保守的数据新鲜度门槛，不是经过收益优化的参数。同日收盘产生的信号不能按同日收盘价格成交。

有价格、无合格 PE 时仍返回 HTTP 200：

- 顶层 `status: "ready"` 表示至少基础对照可运行。
- `benchmark_id: "fixed"` 标识固定定投对照。
- `comparison_complete: false` 表示未完成全部策略比较。
- `fixed`、`rebalance` 两行分别返回 `status: "ready"` 和实际计算指标。
- `current` 行返回 `status: "insufficient_history"`、`missing_symbols` 和原因，**不包含收益字段**。

调用方必须检查每一行的状态，不能把缺失收益当作 0。价格缺失、不足或不连续时，整体返回 HTTP 422 `insufficient_history`。未传历史数据时仍返回不可验证；此接口不会编造行情或发起自动调仓。

## JS 研究函数

`runPortfolioBacktest` 保留 `series`、`weights`、`budgetPerPeriod`、`feeRate`、`rebalanceEvery` 接口，增加：

- `dates`：与价格逐期对齐、严格递增的 ISO 日期。提供时按 ACT/365 年化，并计算 XIRR。
- `periodsPerYear`：默认 252（日频），月度序列须显式传 12，用于波动率年化。
- 没有日期时，年化策略收益按 `(观测数 - 1) / periodsPerYear` 换算年数，XIRR 返回 `null`。
- `peSeries` 由调用方按交易时已知数据预对齐；函数无法自行验证公布日期。估值策略缺交易点分位时返回不可验证，固定对照仍可计算。

缺少目标品种、序列不对齐、价格无效或日期无效时返回 `status: "insufficient_history"`，收益和风险指标为 `null`。

## 明确限制

- Python 使用月度观测；月末回撤可能遗漏月内深跌。每日净值与日频风险验证属于后续阶段。
- 传入的 `close` 不自动视为含分红总回报。系统不自动补计分红、汇率、税费、基金费率或现金利息；若上游价格已经包含这些因素，也不能重复扣加。
- Python 的 PE 实验不等同于前端工作区的完整评分、情绪叠加与执行约束。JS 仍是简化研究模型。
- 同一 API 响应中的基础与 PE 策略使用相同价格窗口、入金计划、整手与费用参数。
- 本次未迁移持久化数据；回退仅需回退代码。调用方若缓存过旧版回测结果，须重新计算。

## 验证

共享夹具 `tests/fixtures/portfolio_performance.json` 同时由 Python 和 JS 测试读取，覆盖恒定价格、入金掩盖亏损、价格往返与连续增长。另测初次交易成本、XIRR 现金流恒等式、历史不足、未来/同日/过时/延迟公布 PE 和缺失月份。

```bash
python3 -m unittest discover -s tests -p test_portfolio_backtest.py -v
node --test tests_js/portfolio_backtest.test.js
python3 -m unittest discover -s tests -v
npm run test:js
python3 -m desktop.smoke_test
git diff --check
```
