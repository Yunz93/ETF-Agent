# StockAgent

跨市场个人股票工作台原型，覆盖 A 股、港股和美股。股票池按指数成分股动态加载（上证指数、深证综指、恒生指数、标普 500），并支持按代码添加自定义标的；只展示后端成功获取的真实行情。

## 功能

- **今日工作台**：三问结构——变了什么（异动/触及）、仓位怎样（浮盈亏/仓位/相对合理价）、今天看什么（财报 + 待复盘判断卡）；提醒历史折叠存放；可选精简模式 / 仅核心仓
- **自选跟踪**：默认精简列（名称 / 现价 / 涨跌 / 决策 / 提醒）；目标价列可开关；批量粘贴代码加入；分组（核心仓 / 观察 / 长期）
- **持仓**：数量与成本、浮盈亏、仓位占比、相对合理价、本位币折算（CNY / HKD / USD）
- **研究池**：按指数切换、行业筛选、同行业一键对比、分批加载行情；空态引导「指数 → 行业 → 自选 → 判断卡」
- **红利低波日度决策**：参考小红书「复利时光」红利低波笔记的结构——现价与年线乖离、股息率 vs 十年国债（股债利差与历史分位）、PE/PB 近 10 年分位、RSI/KDJ、0-100 综合评分与 A-E 档操作建议、历史同评分区间往后 60 天收益回测、规则化「今日盘面」点评，并一键生成可直接发布的小红书风格笔记文本
- **股票详情**：首屏聚焦现价、安全边际、走势与判断卡（论点 / 失效条件 / 关注价 / 复盘日 / 证据）；可一键调用 DeepSeek 等外部大模型做历史走势与买卖研究建议；估值 / 财报 / 事件 / 来源折叠在“更多”
- **模型 API 配置**：设置页支持主流 Token 服务（DeepSeek / OpenAI / Moonshot / 通义千问 / 智谱 / SiliconFlow / OpenRouter / Groq / Ollama / 自定义），可填 Base URL、模型、API Key，并一键测试连接
- **导出**：Markdown 下载（含完整判断卡）、浏览器打印 / 保存 PDF
- **提醒**：页面待办 + 可选浏览器 Notification；提醒历史本地保存；判断卡关注价接近现价时也会进入待办
- **指数成分股研究池**：A 股上证指数 + 深证综指，港股恒生指数，美股标普 500；目录加载时用东方财富 / GICS 补全行业
- **自定义标的**：按市场与代码加入自选 / 持仓（不限于指数成分）
- 固定合规声明：仅供研究参考，不构成投资建议

## 本地运行

### 浏览器模式

推荐用本地后端运行，这样可以绕过浏览器 CORS，拉取真实行情：

```bash
python3 server.py
```

然后访问 `http://localhost:5174`。

依赖：解析上证指数官方成分股文件需要 `xlrd`（`pip install xlrd`）。

行情字段映射与时效相关的单元测试（不依赖外网）：

```bash
python3 -m unittest discover -s tests -v
```

不要直接打开 `index.html`。页面需要通过 `server.py` 调用真实数据接口，后端不可用时会明确显示“行情不可用”，不会用样例价格冒充真实行情。

也可以只跑静态页面：

```bash
python3 -m http.server 5173
```

然后访问 `http://localhost:5173`。

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

一键安装桌面版（推荐，自动下载最新 Release 并处理未签名 / Gatekeeper 拦截）：

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/StockAgent/main/packaging/install_mac.sh | bash
```

脚本会下载最新 macOS 产物、清除隔离属性、重新 ad-hoc 签名，并安装到 `/Applications`。详见 [docs/DESKTOP.md](docs/DESKTOP.md)。

GitHub Actions 会在改动桌面相关文件或打 `v*` tag 时自动编译 `.app` / zip / dmg。

## 项目结构

```text
server.py                 # 兼容入口（import server / python3 server.py）
stockagent/               # 后端包
  paths.py / defaults.py / state.py
  config_store.py / workspace_store.py / http_client.py
  catalog.py / quotes.py / financials.py / ai.py / health.py
  handler.py / serve.py
js/                       # 前端 ES modules（index.html → js/main.js）
  main.js / provider.js / state.js / constants.js
  views/                  # workbench / watchlist / holdings / research / detail
  settings.js / workspace.js / chart.js / analysis.js ...
desktop/ packaging/ tests/
```

## 数据源替换点

当前使用 `js/provider.js` 中的 `HybridProvider`：

- 成分股目录：`GET /api/catalog?market=A|HK|US&index=`（上证指数官方成分、深证综指、恒生指数、标普 500）
- A 股、港股、美股行情：`GET /api/quotes?market=&index=&limit=&offset=`，腾讯公开行情按指数分批代理；单票缺失时东方财富补齐，整批失败时东方财富兜底
- 单票行情 / 自定义标的：`GET /api/quote?market=&symbol=`
- 历史价格走势：`GET /api/history?market=&symbol=&range=`（Yahoo chart，1m / 3m / 1y / 5y；失败时东方财富 K 线兜底）
- 红利低波日度决策：`GET /api/dividend/daily`（中证指数官网 H30269 日线与每日 PE + 蛋卷基金估值分位 + 东方财富十年国债收益率 + 腾讯 512890 ETF 实时价；`?refresh=1` 强制刷新，`config.json` 的 `dividend` 块可替换指数 / ETF）
- AI 深度分析：`POST /api/ai/analyze`（服务端代理 DeepSeek / OpenAI 兼容 Chat Completions；需在设置页或 `STOCKAGENT_AI_API_KEY` 配置密钥）
- 模型接口配置：设置页「模型 API 接口配置」支持 DeepSeek、OpenAI、Moonshot、通义千问、智谱、SiliconFlow、OpenRouter、Groq、Ollama 与自定义兼容端点；`GET /api/ai/providers` 列出预设，`POST /api/ai/test` 可测试连通性
- A 股与港股财务指标：东方财富财务数据中心
- 美股财报：SEC EDGAR companyfacts，通过本地 `server.py` 代理
- A 股公告入口：巨潮资讯网、交易所公告入口
- 港股公告入口：HKEXnews

### 行情准确性与时效

- 腾讯字段按市场分别映射：A 股 PB=`[46]`；港股 PE/PB=`[57]/[58]`；美股 PB=`[51]`。港美 `[46]` 是名称/代码文本，不能当 PB。
- 市值按腾讯「亿元」换算为元；不再把总市值误当作 PE 回退值。
- 东方财富兜底使用 `ulist` 的 `f2/f3/f9/f20/f23`（价格/涨跌幅/PE/总市值/PB），不是 `stock/get` 的 `f43/f170` 字段。
- 交易时段判定会跳过 A/HK 午休；盘中 `live` 要求延迟 ≤ 15 分钟（免费源常见延迟；`max_age_seconds` 仍用于配置与休市判定）。
- `/api/health` 额外返回 `accuracy`（腾讯 vs 东方财富交叉校验，价格/PB 硬校验，PE 因口径差异仅告警）与 `valuation_coverage`。

核心字段已经包含 `source`, `source_url`, `as_of_date`, `currency`, `market`, `provider`, `updated_at`。

本地工作区（自选、持仓、笔记、提醒历史、自定义标的、偏好）通过 `GET/PUT /api/workspace` 持久化到项目根目录 `workspace.json`；浏览器 `localStorage` 仅作缓存与离线兜底。设置页支持导出 / 导入 JSON 备份。

可通过 `GET /api/health` 核验三市场返回数量、交易所本地时间、数据年龄、估值字段覆盖，以及 A/HK/US 财报连通状态。`status=live` 表示交易时段内数据延迟不超过 15 分钟，`recent_close` 表示休市期间的最近收盘数据，`stale` 表示数据可能已经过期。
