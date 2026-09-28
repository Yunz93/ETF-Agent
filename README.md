# ETF Agent · 指数决策工作台

只做投资决策，不做记账。按跟踪指数构建自定义组合（默认标普 45%、纳指 25%、黄金 15%、红利 15%），每个指数袖子可同时纳入场内 ETF 与场外基金。分析分两层：指数估值与技术面，以及具体品种的溢价、费率与跟踪偏离。

## 功能

- **决策台**：以跟踪指数为配置维度，查看各袖子目标权重、评分档位和已纳入的场内／场外品种。不记录现金、份额、盈亏或交易流水。
- **编辑组合**：增删指数袖子、调整目标权重、指定主品种，并把场内 ETF 或场外基金纳入对应指数。
- **指数研究（两层）**：指数层看估值、技术面、评分与走势；品种层对比场内 ETF 与场外基金的溢价、费率、价格偏离波动（收盘价口径，不是官方净值跟踪误差）。
- **设置与恢复**：行情刷新、AI 研究设置，工作区导入／导出。密钥不包含在导出中。

旧持仓账本若仍在工作区中，会迁移为决策组合（类别→指数袖子，产品→品种），但界面不再提供交易录入或对账。

本项目用于研究参考，不自动下单，不构成投资建议。

## 本地运行

### 浏览器模式

```bash
python3 server.py
```

然后访问 `http://localhost:5174`。后端仅使用 Python 标准库，无第三方运行时依赖。

### 部署到 Vercel

全站（页面与 `/api/*`）经 Python Serverless（`api/index.py`）处理，便于统一鉴权（`vercel.json` 用 `routes` 强制进函数，避免 CDN 直出静态页绕过登录）。本地热缓存仍写 `/tmp/stockagent`；**持久化请绑定 Vercel Blob**，把定投计划与 `config.json` 存到 Blob（`stockagent/workspace.json` / `stockagent/config.json`）。

```bash
# Vercel → Project → Storage → Create Blob（建议 Private）
# 创建时勾选连接到本项目的 Production / Preview
# 新版默认注入 BLOB_STORE_ID，运行时再用 VERCEL_OIDC_TOKEN（OIDC）
# 也可在 Store → 复制 BLOB_READ_WRITE_TOKEN 到环境变量
# 可选：STOCKAGENT_BLOB_ACCESS=private|public（须与 Store 访问模式一致，默认 private）
```

`/api/runtime` 在 Blob 可用时返回 `durable_storage: "blob"`、`ephemeral_storage: false`、`blob_auth: "oidc"|"read_write"`；未配置 Blob 时仍为临时存储。改环境变量后需重新部署。

公网部署请设置访问口令（未设置则站点仍公开）：

```bash
# Vercel → Project → Settings → Environment Variables（Production）
SITE_PASSWORD=你的口令
```

本地 / 桌面不设 `SITE_PASSWORD` 时行为不变。设置后首次打开会进入登录页，口令正确后写入 HttpOnly Cookie（约 30 天）。

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

执行安全、账户情景和披露覆盖口径见 [docs/INVESTMENT_RELIABILITY.md](docs/INVESTMENT_RELIABILITY.md)。完整策略历史包回放见 [docs/STRATEGY_REPLAY.md](docs/STRATEGY_REPLAY.md)。

组合回测的时间加权收益、XIRR、基础对照与数据限制见 [docs/PORTFOLIO_BACKTEST.md](docs/PORTFOLIO_BACKTEST.md)。

投资目标、组合风险诊断和现金流再平衡口径见 [docs/INVESTMENT_GOAL.md](docs/INVESTMENT_GOAL.md)。

历史覆盖、滚动窗口与价格研究限制见 [docs/PORTFOLIO_RESEARCH.md](docs/PORTFOLIO_RESEARCH.md)。

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

- 股债利差历史分位只接受可验证的历史分红、估值和利率数据；当前供应商缺少完整发布时间时明确显示资料不足。
- 综合评分与回测仅为规则化研究参考，不构成投资建议。
