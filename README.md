# ETF Agent · 指数 ETF 工作台

只研究指数 ETF，不研究单只股票。核心是多指数估值与技术面分析、定投计划和 ETF 池持仓管理；「红利低波」作为默认分析入口。

## 功能

- **指数分析**（红利低波为默认入口）
  - 现价与单日涨跌（跟踪 ETF 实时价 + 指数收盘）
  - 年线乖离（MA250）、布林带位置、RSI(14)、KDJ(9,3,3)
  - 股息率 vs 十年国债：股债利差与历史分位
  - PE / PB 与 PE 近 10 年分位
  - 0-100 综合评分（股债性价比 35% + 估值水位 20% + 年线乖离 25% + 短线技术 20%），映射 A-E 档操作建议
  - 历史同评分区间（±5 分）往后 60 天收益回测：平均收益 / 胜率 / 最好最差（逐日复算历史评分，分位只用截至当日的数据，避免未来函数）
  - 规则化「走势解读」点评（走势本身 + 年线与布林关系）+ 一键复制小红书风格笔记文本
- **定投计划与 ETF 池**
  - 按代码添加 A 股场内指数 ETF（默认种子池：A500、纳指100、标普500、红利低波易方达/华泰、恒生科技、黄金）
  - 资金计划分三层：初期建仓目标、周期定投预算、交易成本（最低佣金 / 费率 / 手续费占比上限 / 整手）
  - 建仓可配置月数（1–36），目标金额按月均分，每期预算为 min(剩余缺口, 月额度)；定投阶段按估值/评分/再平衡策略分配，不足经济性最小订单时累计至下期
  - 仓位口径区分：ETF 池总仓位、池内配置权重、单只总资产仓位；买卖记录含手续费并同步含费成本
  - 定投策略可选：定额定投 / 估值定投 / 评分定投 / 再平衡定投 / 自定义 PE 分位倍率网格
  - 市场情绪 overlay（可选）：A500 / 纳指 / 恒生科技 ETF 真实收盘价衍生波动与回撤温度，仅极端区调节估值/评分/自定义倍率
  - 分析页与全池分配共用同一套策略执行结论（投 / 不投 / 金额），评分仅作诊断
  - 已收录指数使用指数历史与估值分析；其他 ETF 自动降级为自身行情技术面分析
  - 实时行情（腾讯行情主源，东方财富补齐/兜底）
  - 持有份额与成本价内联编辑，自动算市值 / 浮盈亏 / 仓位占比
  - 点名称或「走势」查看历史 K 线（1M / 3M / 6M / 1Y / 5Y，成本线标记）
- **设置**：自动刷新与 AI 分析配置（变更自动保存）；工作区导出 / 导入同时包含定投计划与设置（不含 API Key）
- **AI 分析**
  - 支持 DeepSeek 与 OpenAI，在现有规则建议之上复核估值、技术面、仓位与数据质量
  - 模型只生成校正提案；低置信度、数据降级、仓位超限、总预算与最高 1.5 倍增量由本地代码强制约束
  - 根据每只 ETF 的跟踪标的、估值、趋势、交易质量与仓位生成差异化分析；最终金额仍由本地风控约束
  - 不自动下单，不修改长期定投策略、持仓或交易记录
  - macOS 桌面版把密钥写入系统钥匙串，不写入 `config.json`、工作区备份或日志
- 固定合规声明：仅供研究参考，不构成投资建议

## 本地运行

### 浏览器模式

```bash
python3 server.py
```

然后访问 `http://localhost:5174`。后端仅使用 Python 标准库，无第三方运行时依赖。

### 部署到 Vercel

静态页由 CDN 托管，`/api/*` 走 Python Serverless（`api/index.py`）。可写数据目录为 `/tmp/stockagent`（实例间不持久；浏览器 localStorage 会缓存工作区）。

```bash
npx vercel --prod
```

单元测试（不依赖外网）：

```bash
python3 -m unittest discover -s tests -v
npm run test:js
```

不要直接打开 `index.html`。页面需要通过 `server.py` 调用真实数据接口，后端不可用时会明确显示"行情不可用"，不会用样例价格冒充真实行情。

### 配置 AI 分析

在「设置 → AI 分析」中选择 DeepSeek 或 OpenAI、保存 API Key 并测试连接。macOS
桌面版把密钥写入系统钥匙串，不写入 `config.json`、工作区或日志。

浏览器开发模式也可以在启动前设置环境变量：

```bash
export DEEPSEEK_API_KEY="..."
# 或
export OPENAI_API_KEY="..."
python3 server.py
```

默认模型为 DeepSeek `deepseek-v4-flash`、OpenAI `gpt-5.6-luna`，可以在设置页调整。
AI 分析只在用户点击时调用，同一数据快照默认缓存 30 分钟。

### macOS 桌面模式

```bash
pip install -r requirements-desktop.txt
python3 -m desktop
```

数据目录：`~/Library/Application Support/StockAgent/`。

打包：

```bash
./packaging/build_mac.sh
```

一键安装桌面版（自动下载最新 Release 并处理未签名 / Gatekeeper 拦截）：

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/StockAgent/v0.0.3/packaging/install_mac.sh | bash
```

详见 [docs/DESKTOP.md](docs/DESKTOP.md)。

市场情绪 overlay 说明见 [docs/MARKET_SENTIMENT.md](docs/MARKET_SENTIMENT.md)。

## 项目结构

```text
server.py                 # 兼容入口（import server / python3 server.py）
stockagent/               # 后端包（纯标准库）
  paths.py / defaults.py / state.py
  config_store.py / workspace_store.py / http_client.py
  symbols.py / market_time.py
  indicators.py           # SMA / 年线乖离 / 布林 / RSI / KDJ / 分位（纯计算）
  quotes.py               # ETF 批量行情 + 历史 K 线
  sentiment_math.py / sentiment.py  # 市场情绪（波动/回撤 overlay）
  dividend.py             # 兼容入口
  dividend_registry.py / dividend_sources.py
  dividend_analysis.py / dividend_service.py
  health.py / handler.py / serve.py
  ai_service.py / ai_providers.py / secret_store.py
js/                       # 前端 ES modules（index.html → js/main.js）
  main.js / state.js / constants.js / utils.js / chart.js
  navigation.js / events.js / workspace.js / workspace_model.js
  strategy.js / pool-alloc.js / period-advice.js / market-sentiment.js
  settings.js
  views/                  # dividend / etf / render
desktop/ packaging/ tests/
```

## API 与数据源

- `GET /api/dividend/daily?symbol=512890`：指定 ETF 的指数/技术面分析（`refresh=1` 强刷，30 分钟缓存）
  - 中证指数官网 `index-perf`：H30269 十余年日线（收盘 / 高低 / 涨跌幅 / 每日 PE）
  - 蛋卷基金 `index_eva`：当前 PE / PB / 股息率 / PE 近 10 年分位
  - 东方财富数据中心：中国十年期国债收益率历史
  - 腾讯行情：跟踪 ETF 实时价
- `GET /api/etf/quotes?symbols=512890,510300`：ETF 批量行情（腾讯主源，东方财富补齐/兜底；60 秒缓存）
- `GET /api/etf/analysis-map?symbols=512890,513100`：查询 ETF 的指数分析或行情代理模式
- `GET /api/history?symbol=512890&range=1y`：历史收盘价（Yahoo chart 主源，腾讯 / 东方财富 K 线依次兜底；1m / 3m / 6m / 1y / 5y）
- `GET /api/market/sentiment?markets=A,HK,US`：市场情绪快照（宽基 ETF 5y 收盘价衍生；`refresh=1` 强刷）
- `GET/PUT /api/workspace`：ETF 池持久化到项目根目录 `workspace.json`（浏览器 localStorage 仅作缓存与离线兜底）
- `GET/POST /api/config`：数据源配置（`config.json`；`etf.analysis` 可配置指数代码、可选蛋卷代码与历史行情来源）
- `GET /api/ai/status`：AI 提供商、模型与密钥配置状态（不返回密钥）
- `POST /api/ai/credentials`：macOS 钥匙串密钥保存 / 删除
- `POST /api/ai/test`：测试当前提供商连接
- `POST /api/ai/review-recommendation`：生成差异化 ETF 分析并执行本地风控裁决
- `GET /api/health`：ETF 行情新鲜度（含 A 股午休/休市判定）、腾讯 vs 东方财富价格交叉校验、红利低波三个数据源连通性

行情字段包含 `source_url`、`as_of`、`market_timestamp`、`provider`；盘中 `live` 要求延迟 ≤ 15 分钟，休市期间标记 `recent_close`。

## 口径说明

- 股债利差历史分位：历史股息率按「当前股息率 × 当前 PE」回推派息水平近似计算（页面有标注），当前利差用蛋卷实时股息率。
- 综合评分与回测仅为规则化研究参考，不构成投资建议。
