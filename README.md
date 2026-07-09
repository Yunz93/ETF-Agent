# StockAgent

跨市场个人股票工作台原型，覆盖 A 股、港股和美股。股票池按指数成分股动态加载（上证指数、深证综指、恒生指数、标普 500），并支持按代码添加自定义标的；只展示后端成功获取的真实行情。

## 功能

- **今日工作台**：自选异动、触及提醒、近期财报、持仓摘要、提醒历史
- **自选跟踪**：表格视图、分组（核心仓 / 观察 / 长期）、买入关注 / 加仓 / 止盈 / 止损、触及置顶
- **持仓**：数量与成本、浮盈亏、仓位占比、相对合理价、本位币折算（CNY / HKD / USD）
- **研究池**：按指数切换（上证 / 深证综指 / 恒生 / 标普500）、分批加载行情、搜索与筛选、同业对比（最多 4 只）
- **股票详情**：首屏聚焦现价、安全边际、走势与研究笔记；估值 / 财报 / 事件 / 来源折叠在“更多”
- **导出**：Markdown 下载、浏览器打印 / 保存 PDF
- **提醒**：页面待办 + 可选浏览器 Notification；提醒历史本地保存
- **指数成分股研究池**：A 股上证指数 + 深证综指，港股恒生指数，美股标普 500；研究池分页浏览
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

数据目录：`~/Library/Application Support/StockAgent/`。打包与菜单说明见 [docs/DESKTOP.md](docs/DESKTOP.md)。

## 数据源替换点

当前使用 `app.js` 中的 `HybridProvider`：

- 成分股目录：`GET /api/catalog?market=A|HK|US&index=`（上证指数官方成分、深证综指、恒生指数、标普 500）
- A 股、港股、美股行情：`GET /api/quotes?market=&index=&limit=&offset=`，腾讯公开行情按指数分批代理；东方财富仅作自动兜底
- 单票行情 / 自定义标的：`GET /api/quote?market=&symbol=`
- 历史价格走势：`GET /api/history?market=&symbol=&range=`（Yahoo chart，1m / 3m / 1y / 5y）
- A 股与港股财务指标：东方财富财务数据中心
- 美股财报：SEC EDGAR companyfacts，通过本地 `server.py` 代理
- A 股公告入口：巨潮资讯网、交易所公告入口
- 港股公告入口：HKEXnews

核心字段已经包含 `source`, `source_url`, `as_of_date`, `currency`, `market`, `provider`, `updated_at`。

本地工作区（自选、持仓、笔记、提醒历史、自定义标的、偏好）通过 `GET/PUT /api/workspace` 持久化到项目根目录 `workspace.json`；浏览器 `localStorage` 仅作缓存与离线兜底。设置页支持导出 / 导入 JSON 备份。

可通过 `GET /api/health` 核验三市场返回数量、交易所本地时间、数据年龄，以及 A/HK/US 财报连通状态。`status=live` 表示交易时段内数据延迟不超过阈值，`recent_close` 表示休市期间的最近收盘数据，`stale` 表示数据可能已经过期。
