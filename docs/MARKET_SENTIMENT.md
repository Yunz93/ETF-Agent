# 市场情绪融入定投策略 · 方案

> 状态：设计提案（未实现）  
> 目标：在现有「估值 / 评分 / 再平衡」定投体系上，增加**市场级情绪**考量，改善恐慌多留现金、过热仍满仓的盲点，同时不破坏定投纪律与本地风控。

## 1. 现状与缺口

当前决策链路：

| 层 | 职责 | 入口 |
| --- | --- | --- |
| 综合评分（诊断） | 股债利差 35% + 估值 20% + 年线乖离 25% + 短线技术 20% → A–E | `dividend_analysis.combine_score` |
| 定投策略（执行） | `dcaMultiplier` → 单只倍率；`allocatePoolBudget` → 全池部署比例与金额 | `js/strategy.js` |
| 本期结论 | 投 / 不投 / 金额唯一来自策略分配 | `js/period-advice.js` |
| AI 复核 | 只校正提案，本地约束倍率上限 | `ai_service.py` |

已有「情绪」相关信号仅限**单标的短线技术**（RSI / KDJ 超买超卖文案）。缺少：

- **市场级**广度、波动、资金面温度
- 情绪对**全池部署比例**与**单只倍率**的显式调节
- 与估值正交的「贵但恐慌 / 便宜但狂热」情景处理

## 2. 设计原则

1. **评分诊断，策略执行**  
   情绪可进入评分展示，但「投多少」仍只由策略链路产出，避免两套指令。
2. **逆向为主、顺势为辅**  
   定投场景默认：极端恐慌加码、极端狂热降仓；非极端区间接近中性（倍率 ≈ 1），避免日常噪声扰动纪律。
3. **市场级叠加，而非取代估值**  
   `final_mult = valuation_or_grade_mult × sentiment_mult × rebalance_factor`  
   估值仍是主轴；情绪只做有界缩放。
4. **数据可降级**  
   情绪源失败时 `sentiment_mult = 1`，策略退化为现状，页面标注「情绪数据不可用」。
5. **不自动下单、不改长期配置**  
   与现有 AI / 执行草稿一致：只影响本期建议金额与文案。
6. **资产类别差异化**  
   商品 / 债券类可忽略 A 股情绪或使用独立口径；海外权益（纳指 / 标普）用对应市场温度，不用 A 股广度硬套。

## 3. 情绪指标定义

### 3.1 输出形态

统一产出一个市场情绪快照（按市场分区：`A` / `HK` / `US`）：

```json
{
  "market": "A",
  "as_of": "2026-07-31",
  "score": 42,
  "zone": "fear",
  "mult": 1.15,
  "components": [
    {"id": "vol_regime", "label": "波动体制", "score": 35, "weight": 0.30, "raw": {}},
    {"id": "drawdown", "label": "回撤深度", "score": 28, "weight": 0.25, "raw": {}},
    {"id": "breadth", "label": "市场广度", "score": 50, "weight": 0.25, "raw": {}},
    {"id": "flow", "label": "资金温度", "score": 55, "weight": 0.20, "raw": {}}
  ],
  "hint": "偏恐慌，定投可小幅加码",
  "degraded": false,
  "source": "derived+eastmoney"
}
```

- `score`：0–100，**越高越乐观/狂热**，越低越恐慌（与 Fear&Greed 同向，便于阅读）。
- `zone`：`panic | fear | neutral | greed | euphoria`。
- `mult`：映射到定投倍率缩放（见 §4）。

### 3.2 分区与默认映射

| zone | score 区间 | 默认 `sentiment_mult` | 含义 |
| --- | --- | --- | --- |
| panic | 0–20 | 1.30 | 极端恐慌，加码 |
| fear | 20–40 | 1.15 | 偏弱，小幅加码 |
| neutral | 40–60 | 1.00 | 不调节 |
| greed | 60–80 | 0.75 | 偏热，减码 |
| euphoria | 80–100 | 0.40 | 极端狂热，明显减仓（不强制归零） |

自定义策略可覆盖该网格（与现有 `pe_bands` / `grade_mult` 同级配置）。

### 3.3 分项（MVP → 增强）

**MVP（优先，尽量不引新外源）** — 用已有指数 / ETF 历史即可算：

| id | 算法要点 | 数据 |
| --- | --- | --- |
| `vol_regime` | 20 日实现波动 / 250 日波动；分位越高 → 越恐慌（score 越低） | 宽基或跟踪 ETF 收盘价 |
| `drawdown` | 相对 250 日高点回撤；回撤越深 score 越低 | 同上 |
| `breadth_proxy` | MVP 用「池内 / 关注宽基当日涨跌比 + 相对成交额」近似广度 | 腾讯/东财批量行情 |
| `flow_proxy` | MVP 用成交额相对 20 日均量偏离；放量下跌偏恐慌、缩量阴跌次之 | 行情字段 |

**增强（有稳定接口后再开）**：

| id | 候选源 | 备注 |
| --- | --- | --- |
| `breadth` | 东财涨跌家数 / 涨跌停统计 | 真广度，替换 proxy |
| `northbound` | 东财北向净流入（滚动 5/20 日） | 仅 A 股；失败则降权 |
| `margin` | 融资余额变动 | 可选，更新频率低 |
| `hk_flow` / `us_vix_proxy` | 港股通 / 美股波动 ETF 或指数历史 | 按市场分区启用 |

权重在缺失时按剩余项归一（与 `combine_score` 相同模式）。

### 3.4 评分 vs 情绪的边界

- **单标的 technical（RSI/KDJ）**：继续只服务该指数诊断与文案，不升格为市场情绪。
- **市场情绪**：跨标的、按市场一份；全池共享同市场 `mult`。
- 可选后续：把市场情绪作为评分第 5 分项（权重建议 ≤ 15%），且**仅诊断**；执行仍走策略叠加，避免评分策略与估值策略双重计入。

## 4. 策略接入方式

### 4.1 推荐：情绪叠加层（Sentiment Overlay）

不新增第六种「情绪定投」主策略（避免与估值/评分抢主轴），而是：

```
base = dcaMultiplier(...)          # 现有估值 / 评分 / 自定义
sent = sentimentMultiplier(market) // 新
reb  = rebalanceFactor(...)        // 现有
row.mult_effective = base.mult * sent.mult
row.score ∝ target × mult_effective × reb
```

- `fixed` / `rebalance`：默认**不**叠加情绪（保持「打满预算 / 按缺口」语义）；设置项可打开「定额也受情绪调节部署比例」。
- `valuation` / `grade` / `custom`：默认开启叠加。
- `base.mult === 0`（高估暂停）时：情绪**不能**把倍率从 0 救活（防止狂热期假信号外，也防止低估规则被恐慌误开——「暂停」优先于情绪）。
- 全池 `deployFrac` 自然随各行 `mult_effective` 变化；也可另加市场级 cap：`deployFrac *= clamp(sent.mult, 0.5, 1.2)` 仅在狂热侧收紧（可选，默认关）。

### 4.2 配置形状（`plan.strategy_config` 扩展）

```js
{
  pe_bands: [...],
  grade_mult: {...},
  use_rebalance: true,
  sentiment: {
    enabled: true,
    mode: "overlay",          // overlay | off
    apply_to: ["valuation", "grade", "custom"],
    bands: [
      { max_score: 20, mult: 1.30, label: "极端恐慌" },
      { max_score: 40, mult: 1.15, label: "偏恐慌" },
      { max_score: 60, mult: 1.00, label: "中性" },
      { max_score: 80, mult: 0.75, label: "偏热" },
      { max_score: 100, mult: 0.40, label: "极端狂热" }
    ],
    // 商品/债券默认忽略；海外用对应市场
    market_by_asset_class: {
      dividend: "A",
      equity_core: "A",
      equity_growth: "auto",  // 按 ETF 跟踪市场
      commodity: "off",
      bond: "off"
    }
  }
}
```

`normalizeStrategyConfig` 负责缺省与钳制（`mult` 建议硬顶 0–2.0，避免情绪层喧宾夺主）。

### 4.3 文案与 UI

- 分析页 / 本期结论 bullets 增加一行：`市场情绪 偏恐慌 · 倍率 ×1.15`。
- 走势解读可加一句市场温度，但不另开「买入/卖出」指令。
- 设置 → 定投策略：开关 + 只读说明；自定义网格进「自定义」面板。
- Health：情绪源状态并入 `/api/health`。

## 5. 后端与接口

### 5.1 模块划分

```text
stockagent/sentiment.py           # 拉取 + 合成 + 缓存（新）
stockagent/sentiment_math.py      # 纯函数：波动、回撤、分区、倍率（可单测）
js/strategy.js                    # dcaMultiplier / allocatePoolBudget 叠加
js/period-advice.js               # 展示 sent 信息
```

### 5.2 API

`GET /api/market/sentiment?markets=A,HK,US&refresh=0`

- 缓存：与行情类似，默认 30 分钟；交易时段可随自动刷新。
- 响应：`{ items: { A: {...}, US: {...} }, updated_at, degraded }`。
- 前端在构建 `poolHoldings` / `allocatePoolBudget` 前注入 `sentimentByMarket`。

### 5.3 数据与合规约束

- 继续纯标准库 HTTP；东财/腾讯失败则降级。
- 不引入需 Key 的第三方 Fear&Greed API（可选后置）。
- 页面固定声明：情绪指数为研究辅助，不构成投资建议。

## 6. 落地阶段

### Phase 1 — 可回测的衍生情绪（建议先做）

1. `sentiment_math.py`：vol / drawdown / zone / mult 纯函数 + 单测。  
2. 用宽基（如沪深300 / 中证A500 跟踪 ETF）历史算 A 股 MVP 情绪；美股用纳指/标普跟踪 ETF。  
3. `strategy.js` overlay + `strategy_config.sentiment` 归一化。  
4. UI：本期结论展示情绪倍率；设置开关默认 **开**（valuation/grade/custom）。  
5. 回测脚本（离线）：同一估值网格 ± 情绪叠加，对比部署率与后续 60 日收益分布（复用现有同评分回测思路，避免未来函数）。

### Phase 2 — 真广度 / 资金

1. 东财涨跌家数、北向滚动流入接入 `sentiment.py`。  
2. 替换 `breadth_proxy` / `flow_proxy`；权重可配置。  
3. Health 与降级文案完善。

### Phase 3 — 体验与 AI

1. 分析页情绪条 / 历史情绪小图。  
2. AI prompt 增加只读字段 `market_sentiment.*`（模型不得编造）；本地仲裁仍限制总倍率。  
3. 可选：评分组件增加 `sentiment`（仅诊断）。

## 7. 关键路径（示意）

```text
/api/market/sentiment
        │
        ▼
buildPoolHoldingsForAllocation  +  sentimentByMarket
        │
        ▼
allocatePoolBudget
  └─ dcaMultiplier(base) × sentimentMult(market) × reb
        │
        ▼
getPeriodAdvice / 全池分配 UI / execution drafts
```

伪代码：

```js
export function sentimentMultiplier(snapshot, bands) {
  if (!snapshot || snapshot.degraded || snapshot.score == null) {
    return { mult: 1, zone: "unknown", hint: "情绪数据不可用，按中性" };
  }
  // 与 multiplierFromPeBands 相同的网格扫描
  return multiplierFromScoreBands(snapshot.score, bands);
}

// allocatePoolBudget 内：
const sent = sentimentMultiplier(sentimentByMarket[marketOf(item)], config.sentiment.bands);
const allowedSent =
  config.sentiment.enabled &&
  config.sentiment.apply_to.includes(rowStrategyId);
const mult = grid.mult <= 0 ? 0 : grid.mult * (allowedSent ? sent.mult : 1);
```

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 情绪与技术面双重计分 | 市场情绪不用 RSI；单标的 technical 不进 overlay |
| 恐慌加码加重回撤体验 | mult 上限 1.3；euphoria 不归零以保纪律；可配置 |
| 外源不稳定 | 降级 mult=1；组件缺失归一；health 可见 |
| 海外 ETF 误用 A 股情绪 | `market_by_asset_class` + 跟踪市场推断 |
| 用户以为多了一套买卖信号 | UI 明确「叠加在策略倍率上」；stance 仍唯一来自分配结果 |

## 9. 验收标准

1. 关闭 `sentiment.enabled` 后，分配结果与当前 main **逐金额一致**（回归测试）。  
2. 人为注入 `score=10/90` 时，同估值下部署额分别上升 / 下降，且 `base.mult=0` 仍为 0。  
3. 情绪 API 失败不影响分析页与定投计算。  
4. 商品 / 债券默认不受 A 股情绪影响。  
5. README / 设置文案说明情绪为逆向 overlay，非独立策略。

## 10. 建议默认

- 默认策略 `valuation` + `sentiment.overlay` 开启。  
- 情绪网格用 §3.2。  
- Phase 1 不改 `SCORE_WEIGHTS`（避免诊断与执行语义漂移）。  
- 先合并文档与接口契约，再按 Phase 1 开实现 PR。
