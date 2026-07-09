# StockAgent

跨市场股票研究辅助 Web 应用原型，覆盖 A 股、港股和美股。当前版本内置 60 只代表性股票，并只展示后端成功获取的真实行情。

## 功能

- 股票搜索、市场筛选、行业筛选、估值状态筛选
- A 股、港股、美股各 20 只代表性股票
- 股票详情页：腾讯行情、SEC 美股财报摘要、估值区间、评分拆解、收入趋势、数据来源
- 自选股、目标关注价和本地提醒状态
- Markdown 导出和浏览器打印 / 保存 PDF
- 固定合规声明：仅供研究参考，不构成投资建议

## 本地运行

推荐用本地后端运行，这样可以绕过浏览器 CORS，拉取真实行情：

```bash
python3 server.py
```

然后访问 `http://localhost:5174`。

不要直接打开 `index.html`。页面需要通过 `server.py` 调用真实数据接口，后端不可用时会明确显示“行情不可用”，不会用样例价格冒充真实行情。

也可以只跑静态页面：

```bash
python3 -m http.server 5173
```

然后访问 `http://localhost:5173`。

## 数据源替换点

当前使用 `app.js` 中的 `HybridProvider`：

- A 股、港股、美股行情：腾讯公开行情接口，通过本地 `server.py` 代理；东方财富仅作自动兜底
- A 股与港股财务指标：东方财富财务数据中心
- 美股财报：SEC EDGAR companyfacts，通过本地 `server.py` 代理
- A 股公告入口：巨潮资讯网、交易所公告入口
- 港股公告入口：HKEXnews

核心字段已经包含 `source`, `source_url`, `as_of_date`, `currency`, `market`, `provider`, `updated_at`。

可通过 `GET /api/health` 核验三市场返回数量、交易所本地时间、数据年龄，以及 A/HK/US 财报连通状态。`status=live` 表示交易时段内数据延迟不超过阈值，`recent_close` 表示休市期间的最近收盘数据，`stale` 表示数据可能已经过期。
