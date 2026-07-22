# StockAgent · 指数 ETF 工作台

只研究指数 ETF，不研究单只股票。核心是「红利低波」日度决策仪表盘（参考小红书「复利时光」笔记的结构），配一个轻量 ETF 池管理行情与持仓。

## 功能

- **红利低波 · 日度决策**（默认首页）
  - 现价与单日涨跌（跟踪 ETF 实时价 + 指数收盘）
  - 年线乖离（MA250）、布林带位置、RSI(14)、KDJ(9,3,3)
  - 股息率 vs 十年国债：股债利差与历史分位
  - PE / PB 与 PE 近 10 年分位
  - 0-100 综合评分（股债性价比 35% + 估值水位 20% + 年线乖离 25% + 短线技术 20%），映射 A-E 档操作建议
  - 历史同评分区间（±5 分）往后 60 天收益回测：平均收益 / 胜率 / 最好最差（逐日复算历史评分，分位只用截至当日的数据，避免未来函数）
  - 规则化「今日盘面」点评 + 一键复制小红书风格笔记文本
- **ETF 池**
  - 按代码添加 A 股场内指数 ETF（默认种子池：红利低波、沪深300、中证500、创业板、纳指、黄金）
  - 实时行情（腾讯行情主源，东方财富补齐/兜底）
  - 持有份额与成本价内联编辑，自动算市值 / 浮盈亏 / 仓位占比
  - 点名称或「走势」查看历史 K 线（1M / 3M / 6M / 1Y / 5Y，成本线标记）
- **设置**：红利低波指数可替换（中证指数代码 + 蛋卷估值代码 + 跟踪 ETF）；工作区导出 / 导入备份
- 固定合规声明：仅供研究参考，不构成投资建议

## 本地运行

### 浏览器模式

```bash
python3 server.py
```

然后访问 `http://localhost:5174`。后端仅使用 Python 标准库，无第三方运行时依赖。

单元测试（不依赖外网）：

```bash
python3 -m unittest discover -s tests -v
```

不要直接打开 `index.html`。页面需要通过 `server.py` 调用真实数据接口，后端不可用时会明确显示"行情不可用"，不会用样例价格冒充真实行情。

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
curl -fsSL https://raw.githubusercontent.com/Yunz93/StockAgent/main/packaging/install_mac.sh | bash
```

详见 [docs/DESKTOP.md](docs/DESKTOP.md)。

## 项目结构

```text
server.py                 # 兼容入口（import server / python3 server.py）
stockagent/               # 后端包（纯标准库）
  paths.py / defaults.py / state.py
  config_store.py / workspace_store.py / http_client.py
  symbols.py / market_time.py
  indicators.py           # SMA / 年线乖离 / 布林 / RSI / KDJ / 分位（纯计算）
  quotes.py               # ETF 批量行情 + 历史 K 线
  dividend.py             # 红利低波日度决策：数据组装 / 评分 / 回测 / 笔记文本
  health.py / handler.py / serve.py
js/                       # 前端 ES modules（index.html → js/main.js）
  main.js / state.js / constants.js / utils.js / chart.js
  navigation.js / events.js / workspace.js / settings.js
  views/                  # dividend / etf / render
desktop/ packaging/ tests/
```

## API 与数据源

- `GET /api/dividend/daily`：红利低波日度决策（`?refresh=1` 强刷，30 分钟缓存）
  - 中证指数官网 `index-perf`：H30269 十余年日线（收盘 / 高低 / 涨跌幅 / 每日 PE）
  - 蛋卷基金 `index_eva`：当前 PE / PB / 股息率 / PE 近 10 年分位
  - 东方财富数据中心：中国十年期国债收益率历史
  - 腾讯行情：跟踪 ETF 实时价
- `GET /api/etf/quotes?symbols=512890,510300`：ETF 批量行情（腾讯主源，东方财富补齐/兜底；60 秒缓存）
- `GET /api/history?symbol=512890&range=1y`：历史收盘价（Yahoo chart 主源，腾讯 / 东方财富 K 线依次兜底；1m / 3m / 6m / 1y / 5y）
- `GET/PUT /api/workspace`：ETF 池持久化到项目根目录 `workspace.json`（浏览器 localStorage 仅作缓存与离线兜底）
- `GET/POST /api/config`：数据源配置（`config.json`；`dividend` 块可替换指数，`etf.pool` 是默认种子池）
- `GET /api/health`：ETF 行情新鲜度（含 A 股午休/休市判定）、腾讯 vs 东方财富价格交叉校验、红利低波三个数据源连通性

行情字段包含 `source_url`、`as_of`、`market_timestamp`、`provider`；盘中 `live` 要求延迟 ≤ 15 分钟，休市期间标记 `recent_close`。

## 口径说明

- 股债利差历史分位：历史股息率按「当前股息率 × 当前 PE」回推派息水平近似计算（页面有标注），当前利差用蛋卷实时股息率。
- 综合评分与回测仅为规则化研究参考，不构成投资建议。
