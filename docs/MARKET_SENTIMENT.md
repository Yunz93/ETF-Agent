# 市场情绪融入定投策略

> 状态：**已实现（Phase 1）**  
> 情绪作为有界 overlay 叠加在估值/评分/自定义策略上；数据来自宽基 ETF **真实收盘价**。

## 1. 设计要点（已按评审收敛）

1. **评分诊断，策略执行** — 投多少仍只由 `allocatePoolBudget` 产出。  
2. **逆向 + 极端区** — 默认 `extremes_only`：分数在 (25, 75) 内强制 1×，只在恐慌/狂热两端调节。  
3. **MVP 只保留两分项** — `vol_regime`（55%）+ `drawdown`（45%）；不做池内涨跌比代理，不把北向当默认核心。  
4. **10 日平滑** — 降低日频噪声，适配月度/双周定投。  
5. **可降级** — 历史失败 → `mult = 1`，不影响主流程。  
6. **高估暂停优先** — `base.mult === 0` 时情绪不能救活。  
7. **资产类别** — 商品/债券 `off`；海外成长 `auto`（按指数代码推断 US/HK）。

## 2. 真实数据来源

| 市场 | 锚点 ETF | 跟踪指数 | 拉取方式 |
| --- | --- | --- | --- |
| A | `563360` A500ETF华泰柏瑞 | 中证A500 | `get_price_history(symbol, "A", "5y")` |
| US | `513390` 纳指100ETF博时 | 纳斯达克100 | 同上（A 股上市 QDII） |
| HK | `513010` 恒生科技ETF易方达 | 恒生科技 | 同上 |

行情栈：Yahoo → 腾讯 → 东方财富（与 K 线一致）。缓存 30 分钟。

**不做：** 第三方 Fear&Greed API、池内涨跌比伪广度、默认北向权重。

## 3. API

`GET /api/market/sentiment?markets=A,HK,US&refresh=0`

返回摘要：

```json
{
  "items": {
    "A": {
      "market": "A",
      "anchor_symbol": "563360",
      "score": 42.3,
      "zone": "fear",
      "mult": 1.0,
      "band": "中性死区",
      "components": [
        {"id": "vol_regime", "score": 35.0, "weight": 0.55},
        {"id": "drawdown", "score": 48.0, "weight": 0.45}
      ],
      "degraded": false,
      "provider": "腾讯行情",
      "point_count": 1200
    }
  },
  "degraded": false,
  "history_range": "5y",
  "smooth_days": 10
}
```

Health：`/api/health` → `sentiment_sources`（软探测，失败不拖垮整体 status）。

## 4. 策略接入

```
final_mult = base_mult × sentiment_mult × rebalance_factor
```

- 默认作用于：`valuation` / `grade` / `custom`  
- `fixed` / `rebalance`：默认不叠加  
- 配置：`plan.strategy_config.sentiment`（UI 开关「叠加市场情绪」）

默认情绪网格：

| score | 倍率 | 区 |
| --- | --- | --- |
| ≤20 | 1.30× | 极端恐慌 |
| ≤40 | 1.15× | 偏恐慌 |
| ≤60 | 1.00× | 中性 |
| ≤80 | 0.75× | 偏热 |
| ≤100 | 0.40× | 极端狂热 |

## 5. 代码入口

| 模块 | 职责 |
| --- | --- |
| `stockagent/sentiment_math.py` | 纯函数：波动、回撤、分区、倍率 |
| `stockagent/sentiment.py` | 拉历史、缓存、组装快照 |
| `js/strategy.js` | `normalizeSentimentConfig` / overlay |
| `js/market-sentiment.js` | 前端拉取与注入 |
| `js/period-advice.js` | 本期结论展示情绪行 |

## 6. 后续（未做）

- Phase 2：东财真广度 / 可选北向（失败降权）  
- Phase 3：情绪历史小图、AI 只读字段、评分诊断分项（≤15%，仅展示）
