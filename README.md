# ETF Agent · 指数 ETF 工作台

围绕一个投资组合管理资产类别、场内 ETF、场外基金及多账户持仓。默认目标为标普45%、纳指25%、黄金15%、红利15%，可调整比例和新增类别。

## 功能

- **组合总览**：总资产、现金、待确认资金、投资盈亏，两级资产配置图，类别目标与实际占比，建账以来收益曲线和待办。
- **资产与持仓**：类别与产品管理、类内分配、主要买入产品、多账户期初持仓、价格／净值与来源、产品和类别收益明细。场内研究入口保留指数估值与技术面分析。
- **交易记录**：场内买卖、场外申购／赎回申请与确认、取消、分红、红利再投、入出金及持仓校正。交易更正保留原记录与原因。
- **投资计划**：初期建仓按类别剩余目标金额分配；周期定投与逢低加仓按类别再分到产品。考虑账户现金、费用、交易单位、最低申购和限额。计划只生成待办，实际成交需录入或确认。
- **历史模拟**：按目标配置或当前持仓市值比例，用相同入金比较周期定投与回撤分档买入。仅使用对应产品历史，场外基金需导入自身净值；缺少60个共同日期不输出收益，不足一年不外推年化。
- **设置与恢复**：行情刷新、AI研究设置，完整组合导入／导出，本地备份恢复。恢复前自动另存当前账本，密钥不包含在工作区导出中。

升级时先显示迁移预览；核对归类、份额、成本与账户现金后，点击“备份并启用组合”。旧流水单独归档，不与期初持仓重复入账。未知现金、成本或行情保持“待补全”。详见 [组合使用说明](docs/PORTFOLIO_GUIDE.md)。

收益以人民币记账。首页“投资盈亏”包含持仓盈亏、已实现盈亏和分红；“建账以来收益”以建账日期初市值为起点，扣除资金流。区间收益率使用Modified Dietz近似法，并非年化。持仓校正后暂停期间收益统计，避免把资料修正当成投资收益。

本项目用于研究与记账，不自动下单。历史模拟不构成未来收益承诺。

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
