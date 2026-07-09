const CURRENCY = {
  CNY: "¥",
  HKD: "HK$",
  USD: "$",
};

const DEFAULT_SOURCES = {
  A: [
    {
      name: "巨潮资讯网",
      url: "https://www.cninfo.com.cn/new/index",
      role: "公告、财报与监管问询来源",
    },
    {
      name: "上交所",
      url: "https://www.sse.com.cn/",
      role: "沪市公告补充校验",
    },
  ],
  HK: [
    {
      name: "HKEXnews",
      url: "https://www.hkexnews.hk/index.htm",
      role: "港股上市公司公告来源",
    },
  ],
  US: [
    {
      name: "SEC EDGAR",
      url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
      role: "10-K、10-Q、XBRL companyfacts 来源",
    },
  ],
  QUOTE: [
    {
      name: "腾讯行情",
      url: "https://gu.qq.com/",
      role: "实时/延迟行情和基础估值",
    },
  ],
};

let appConfig = null;

const STOCK_SEEDS = [
  ["600519", "贵州茅台", "Kweichow Moutai", "A", "SSE", "CNY", "白酒"],
  ["300750", "宁德时代", "CATL", "A", "SZSE", "CNY", "新能源"],
  ["601318", "中国平安", "Ping An Insurance", "A", "SSE", "CNY", "保险"],
  ["600036", "招商银行", "China Merchants Bank", "A", "SSE", "CNY", "银行"],
  ["000858", "五粮液", "Wuliangye", "A", "SZSE", "CNY", "白酒"],
  ["002594", "比亚迪", "BYD", "A", "SZSE", "CNY", "汽车"],
  ["600276", "恒瑞医药", "Hengrui Pharma", "A", "SSE", "CNY", "医药"],
  ["601899", "紫金矿业", "Zijin Mining", "A", "SSE", "CNY", "有色金属"],
  ["000333", "美的集团", "Midea Group", "A", "SZSE", "CNY", "家电"],
  ["601012", "隆基绿能", "LONGi Green Energy", "A", "SSE", "CNY", "新能源"],
  ["600900", "长江电力", "China Yangtze Power", "A", "SSE", "CNY", "公用事业"],
  ["600309", "万华化学", "Wanhua Chemical", "A", "SSE", "CNY", "化工"],
  ["688111", "金山办公", "Kingsoft Office", "A", "SSE STAR", "CNY", "软件"],
  ["300760", "迈瑞医疗", "Mindray Medical", "A", "SZSE", "CNY", "医疗器械"],
  ["601088", "中国神华", "China Shenhua", "A", "SSE", "CNY", "能源"],
  ["600887", "伊利股份", "Yili Group", "A", "SSE", "CNY", "消费"],
  ["002415", "海康威视", "Hikvision", "A", "SZSE", "CNY", "安防科技"],
  ["000651", "格力电器", "Gree Electric", "A", "SZSE", "CNY", "家电"],
  ["601166", "兴业银行", "Industrial Bank", "A", "SSE", "CNY", "银行"],
  ["688981", "中芯国际", "SMIC", "A", "SSE STAR", "CNY", "半导体"],
  ["0700", "腾讯控股", "Tencent", "HK", "HKEX", "HKD", "互联网"],
  ["9988", "阿里巴巴-SW", "Alibaba", "HK", "HKEX", "HKD", "互联网"],
  ["3690", "美团-W", "Meituan", "HK", "HKEX", "HKD", "本地生活"],
  ["1299", "友邦保险", "AIA", "HK", "HKEX", "HKD", "保险"],
  ["0388", "香港交易所", "HKEX", "HK", "HKEX", "HKD", "金融基础设施"],
  ["0939", "建设银行", "CCB", "HK", "HKEX", "HKD", "银行"],
  ["1398", "工商银行", "ICBC", "HK", "HKEX", "HKD", "银行"],
  ["2318", "中国平安", "Ping An Insurance H", "HK", "HKEX", "HKD", "保险"],
  ["1810", "小米集团-W", "Xiaomi", "HK", "HKEX", "HKD", "硬件"],
  ["1024", "快手-W", "Kuaishou", "HK", "HKEX", "HKD", "互联网"],
  ["9618", "京东集团-SW", "JD.com", "HK", "HKEX", "HKD", "电商"],
  ["9999", "网易-S", "NetEase", "HK", "HKEX", "HKD", "游戏"],
  ["1211", "比亚迪股份", "BYD H", "HK", "HKEX", "HKD", "汽车"],
  ["0883", "中国海洋石油", "CNOOC", "HK", "HKEX", "HKD", "能源"],
  ["0005", "汇丰控股", "HSBC", "HK", "HKEX", "HKD", "银行"],
  ["2020", "安踏体育", "Anta Sports", "HK", "HKEX", "HKD", "运动消费"],
  ["2269", "药明生物", "WuXi Biologics", "HK", "HKEX", "HKD", "医药"],
  ["9868", "小鹏汽车-W", "XPeng", "HK", "HKEX", "HKD", "汽车"],
  ["2015", "理想汽车-W", "Li Auto", "HK", "HKEX", "HKD", "汽车"],
  ["1177", "中国生物制药", "Sino Biopharm", "HK", "HKEX", "HKD", "医药"],
  ["AAPL", "苹果", "Apple", "US", "NASDAQ", "USD", "硬件"],
  ["MSFT", "微软", "Microsoft", "US", "NASDAQ", "USD", "软件"],
  ["NVDA", "英伟达", "NVIDIA", "US", "NASDAQ", "USD", "半导体"],
  ["AMZN", "亚马逊", "Amazon", "US", "NASDAQ", "USD", "电商云计算"],
  ["GOOGL", "谷歌", "Alphabet", "US", "NASDAQ", "USD", "互联网"],
  ["META", "Meta", "Meta Platforms", "US", "NASDAQ", "USD", "互联网"],
  ["TSLA", "特斯拉", "Tesla", "US", "NASDAQ", "USD", "汽车"],
  ["BRK.B", "伯克希尔", "Berkshire Hathaway", "US", "NYSE", "USD", "综合金融"],
  ["JPM", "摩根大通", "JPMorgan Chase", "US", "NYSE", "USD", "银行"],
  ["V", "Visa", "Visa", "US", "NYSE", "USD", "支付"],
  ["LLY", "礼来", "Eli Lilly", "US", "NYSE", "USD", "医药"],
  ["UNH", "联合健康", "UnitedHealth", "US", "NYSE", "USD", "医疗保险"],
  ["XOM", "埃克森美孚", "Exxon Mobil", "US", "NYSE", "USD", "能源"],
  ["COST", "开市客", "Costco", "US", "NASDAQ", "USD", "零售"],
  ["HD", "家得宝", "Home Depot", "US", "NYSE", "USD", "零售"],
  ["NFLX", "奈飞", "Netflix", "US", "NASDAQ", "USD", "流媒体"],
  ["AMD", "AMD", "Advanced Micro Devices", "US", "NASDAQ", "USD", "半导体"],
  ["KO", "可口可乐", "Coca-Cola", "US", "NYSE", "USD", "消费"],
  ["PEP", "百事", "PepsiCo", "US", "NASDAQ", "USD", "消费"],
  ["ADBE", "奥多比", "Adobe", "US", "NASDAQ", "USD", "软件"],
];

class HybridProvider {
  constructor(seeds) {
    this.catalog = seeds.map((seed, index) => buildCatalogStock(seed, index));
    this.stocks = [];
    this.quoteHydrated = false;
    this.quoteHydration = null;
    this.status = {
      quote: "connecting",
      quoteLabel: "行情连接中",
      filing: "等待 SEC 数据",
    };
  }

  async hydrateQuotes() {
    if (this.quoteHydrated) return;
    if (this.quoteHydration) return this.quoteHydration;
    this.quoteHydration = fetch("/api/quotes")
      .then((response) => {
        if (!response.ok) throw new Error(`Quote API ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const quotes = new Map(payload.quotes.map((quote) => [`${quote.market}:${quote.symbol}`, quote]));
        this.stocks = this.catalog
          .map((entry) => buildStockFromQuote(entry, quotes.get(stockKey(entry))))
          .filter(Boolean);
        this.status.quote = this.stocks.length ? "live" : "unavailable";
        this.status.quoteLabel = this.stocks.length
          ? `${payload.provider || "真实行情"} · ${this.stocks.length} 条`
          : payload.error
            ? `行情不可用 · ${payload.error}`
            : "暂无行情数据";
        this.quoteHydrated = true;
      })
      .catch((error) => {
        console.warn("行情获取失败。", error);
        this.stocks = [];
        this.status.quote = "unavailable";
        this.status.quoteLabel = "行情不可用";
        this.quoteHydrated = true;
      });
    return this.quoteHydration;
  }

  async search(filters) {
    await this.hydrateQuotes();
    return this.filterStocks(filters);
  }

  async getStock(symbol, market) {
    await this.hydrateQuotes();
    let stock = this.stocks.find((item) => item.symbol === symbol && item.market === market);
    if (!stock) return stock;
    if (!(market === "US" && appConfig?.sec?.enabled === false)) {
      stock = await this.withFinancials(stock);
    }
    return this.withEvents(stock);
  }

  filterStocks({ query = "", market = "all", industry = "all", valuation = "all" }) {
    const term = query.trim().toLowerCase();
    return this.stocks.filter((stock) => {
      const matchesTerm =
        !term ||
        [stock.symbol, stock.name, stock.englishName, stock.industry]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesMarket = market === "all" || stock.market === market;
      const matchesIndustry = industry === "all" || stock.industry === industry;
      const matchesValuation = valuation === "all" || stock.valuation.state === valuation;
      return matchesTerm && matchesMarket && matchesIndustry && matchesValuation;
    });
  }

  async withFinancials(stock) {
    try {
      const response = await fetch(
        `/api/financials?market=${encodeURIComponent(stock.market)}&symbol=${encodeURIComponent(stock.symbol)}`,
      );
      if (!response.ok) return stock;
      const payload = await response.json();
      if (!payload.financials?.length) return stock;
      this.status.filing = payload.provider || "真实财报";
      return enrichStockMetrics({
        ...stock,
        financials: payload.financials,
        financialSource: {
          name: payload.provider,
          url: payload.source_url,
          role: `财务指标 · 更新 ${payload.updated_at || "时间未知"}`,
        },
        sourceMeta: {
          ...stock.sourceMeta,
          source: payload.provider,
          source_url: payload.source_url,
          provider: payload.provider,
          updated_at: payload.updated_at,
        },
      });
    } catch (error) {
      console.warn("财报获取失败。", error);
      return stock;
    }
  }

  async withEvents(stock) {
    const events = buildEventsFromQuote(stock);
    if (stock.market === "US") {
      try {
        const response = await fetch(`/api/sec-filings?symbol=${encodeURIComponent(stock.symbol)}`);
        if (response.ok) {
          const payload = await response.json();
          payload.filings?.forEach((filing) => {
            events.push({
              date: filing.date,
              kind: "filing",
              title: filing.title,
              url: filing.url,
              status: eventStatus(filing.date),
            });
          });
        }
      } catch (error) {
        console.warn("SEC 公告获取失败。", error);
      }
    }
    events.push(...marketDisclosureLinks(stock));
    return { ...stock, events: sortEvents(events) };
  }
}

const provider = new HybridProvider(STOCK_SEEDS);
const state = {
  selected: null,
  filtered: [],
  watchlist: loadWatchlist(),
  activeView: "dashboard",
  market: "A",
};

const els = {
  searchInput: document.querySelector("#searchInput"),
  industryFilter: document.querySelector("#industryFilter"),
  valuationFilter: document.querySelector("#valuationFilter"),
  stockRows: document.querySelector("#stockRows"),
  stockDetail: document.querySelector("#stockDetail"),
  marketMetrics: document.querySelector("#marketMetrics"),
  upcomingPanel: document.querySelector("#upcomingPanel"),
  template: document.querySelector("#detailTemplate"),
  watchlistContent: document.querySelector("#watchlistContent"),
  clearWatchlist: document.querySelector("#clearWatchlist"),
  marketShortcuts: document.querySelectorAll("[data-market-shortcut]"),
  topSourceStatus: document.querySelector("#topSourceStatus"),
  selectedStockSummary: document.querySelector("#selectedStockSummary"),
  backToList: document.querySelector("#backToList"),
  detailCrumb: document.querySelector("#detailCrumb"),
  detailTabs: document.querySelectorAll(".detail-tabs a"),
  themeToggle: document.querySelector("#themeToggle"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  settingsForm: document.querySelector("#settingsForm"),
  saveConfig: document.querySelector("#saveConfig"),
  resetConfig: document.querySelector("#resetConfig"),
  settingsStatus: document.querySelector("#settingsStatus"),
};

const THEME_KEY = "stockagent.theme";
const SIDEBAR_KEY = "stockagent.sidebar";
const SIDEBAR_COLLAPSE_MIN = 1181;

init();

async function init() {
  initTheme();
  initSidebar();
  await loadAppConfig();
  fillIndustryFilter();
  bindEvents();
  await refreshStocks();
  await restoreRoute();
  if (!state.selected && state.filtered[0]) {
    selectStock(state.filtered[0], { openDetail: false });
  }
}

async function loadAppConfig({ rerender = true } = {}) {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`Config API ${response.status}`);
    appConfig = await response.json();
  } catch (error) {
    console.warn("配置加载失败，使用内置默认值。", error);
    appConfig = {
      quotes: {
        provider_name: "腾讯行情",
        note: DEFAULT_SOURCES.QUOTE[0].role,
        batch_size: 25,
      },
      sec: { enabled: true, user_agent: "StockAgent/0.1 personal-local contact@example.com" },
      sources: structuredClone(DEFAULT_SOURCES),
    };
  }
  if (rerender) {
    renderSettings();
    renderSourceStatus();
  }
}

function marketSources(market) {
  return appConfig?.sources?.[market] || DEFAULT_SOURCES[market] || [];
}

function quoteSourceMeta() {
  const quote = appConfig?.sources?.QUOTE?.[0] || DEFAULT_SOURCES.QUOTE[0];
  const quotes = appConfig?.quotes || {};
  return {
    name: quotes.provider_name || quote.name,
    url: quote.url,
    role: quotes.note || quote.role,
  };
}

function renderSettings() {
  if (!els.settingsForm || !appConfig) return;

  const groups = [
    { key: "QUOTE", label: "行情" },
    { key: "A", label: "A 股公告" },
    { key: "HK", label: "港股公告" },
    { key: "US", label: "美股财报" },
  ];

  els.settingsForm.innerHTML = `
    <section class="config-group">
      <h3>行情接口</h3>
      <div class="config-grid">
        <label>
          <span>提供方名称</span>
          <input data-config="quotes.provider_name" type="text" value="${escapeAttr(appConfig.quotes?.provider_name || "")}" />
        </label>
        <label>
          <span>说明</span>
          <input data-config="quotes.note" type="text" value="${escapeAttr(appConfig.quotes?.note || "")}" />
        </label>
        <label>
          <span>批量大小</span>
          <input data-config="quotes.batch_size" type="number" min="5" max="50" value="${escapeAttr(appConfig.quotes?.batch_size ?? 25)}" />
        </label>
      </div>
    </section>
    <section class="config-group">
      <h3>SEC 财报</h3>
      <div class="config-grid">
        <label class="config-check">
          <input data-config="sec.enabled" type="checkbox" ${appConfig.sec?.enabled !== false ? "checked" : ""} />
          <span>启用 SEC EDGAR 数据</span>
        </label>
        <label class="config-wide">
          <span>User-Agent</span>
          <input data-config="sec.user_agent" type="text" value="${escapeAttr(appConfig.sec?.user_agent || "")}" />
        </label>
      </div>
    </section>
    ${groups
      .map(
        ({ key, label }) => `
          <section class="config-group">
            <h3>${label}</h3>
            ${(appConfig.sources?.[key] || [])
              .map(
                (source, index) => `
                  <div class="source-editor" data-source-group="${key}" data-source-index="${index}">
                    <label>
                      <span>名称</span>
                      <input data-field="name" type="text" value="${escapeAttr(source.name)}" />
                    </label>
                    <label>
                      <span>链接</span>
                      <input data-field="url" type="url" value="${escapeAttr(source.url)}" />
                    </label>
                    <label class="config-wide">
                      <span>用途</span>
                      <input data-field="role" type="text" value="${escapeAttr(source.role)}" />
                    </label>
                  </div>
                `,
              )
              .join("")}
          </section>
        `,
      )
      .join("")}
  `;
}

function readSettingsForm() {
  const nextConfig = structuredClone(appConfig);
  els.settingsForm.querySelectorAll("[data-config]").forEach((input) => {
    const path = input.dataset.config.split(".");
    let target = nextConfig;
    for (let index = 0; index < path.length - 1; index += 1) {
      target[path[index]] = target[path[index]] || {};
      target = target[path[index]];
    }
    const key = path[path.length - 1];
    if (input.type === "checkbox") {
      target[key] = input.checked;
    } else if (input.type === "number") {
      target[key] = Number(input.value);
    } else {
      target[key] = input.value.trim();
    }
  });

  els.settingsForm.querySelectorAll(".source-editor").forEach((block) => {
    const group = block.dataset.sourceGroup;
    const index = Number(block.dataset.sourceIndex);
    nextConfig.sources[group] = nextConfig.sources[group] || [];
    nextConfig.sources[group][index] = {
      name: block.querySelector('[data-field="name"]').value.trim(),
      url: block.querySelector('[data-field="url"]').value.trim(),
      role: block.querySelector('[data-field="role"]').value.trim(),
    };
  });

  return nextConfig;
}

async function saveAppConfig() {
  if (!els.settingsForm) return;
  const payload = readSettingsForm();
  els.settingsStatus.textContent = "保存中…";
  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || `保存失败 ${response.status}`);
    appConfig = saved;
    provider.quoteHydrated = false;
    provider.quoteHydration = null;
    await refreshStocks();
    renderSettings();
    els.settingsStatus.textContent = "已保存到 config.json";
  } catch (error) {
    els.settingsStatus.textContent = error.message;
  }
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function bindEvents() {
  [els.searchInput, els.industryFilter, els.valuationFilter].forEach((el) => {
    el.addEventListener("input", refreshStocks);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.clearWatchlist.addEventListener("click", () => {
    state.watchlist = {};
    saveWatchlist();
    renderWatchlist();
    renderDetail();
  });

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.sidebarToggle?.addEventListener("click", toggleSidebar);
  window.addEventListener("resize", syncSidebarForViewport);
  els.saveConfig?.addEventListener("click", saveAppConfig);
  els.resetConfig?.addEventListener("click", () => loadAppConfig({ rerender: true }));
  els.marketShortcuts.forEach((button) => {
    button.addEventListener("click", () => {
      state.market = button.dataset.marketShortcut;
      syncMarketShortcuts();
      refreshStocks();
    });
  });
  els.backToList.addEventListener("click", () => showDashboard({ clearHash: true }));
  window.addEventListener("hashchange", restoreRoute);
  window.addEventListener("popstate", restoreRoute);
  els.detailTabs.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(link.getAttribute("href"));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function refreshStocks() {
  state.filtered = await provider.search({
    query: els.searchInput.value,
    market: state.market,
    industry: els.industryFilter.value,
    valuation: els.valuationFilter.value,
  });
  state.filtered.sort((a, b) => marginOfSafety(b) - marginOfSafety(a));
  renderSourceStatus();
  syncMarketShortcuts();
  renderMetrics();
  renderUpcoming();
  renderRows();
  if (!state.selected || !state.filtered.some((stock) => sameStock(stock, state.selected))) {
    selectStock(state.filtered[0], { openDetail: false });
  }
}

function fillIndustryFilter() {
  const industries = [...new Set(STOCK_SEEDS.map((seed) => seed[6]))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  industries.forEach((industry) => {
    const option = document.createElement("option");
    option.value = industry;
    option.textContent = industry;
    els.industryFilter.append(option);
  });
}

function renderMetrics() {
  const total = state.filtered.length;
  const avgScore = average(state.filtered.map((stock) => stock.analysis.score));
  const undervalued = state.filtered.filter((stock) => stock.valuation.state === "undervalued").length;
  const highRisk = state.filtered.filter((stock) => stock.valuation.state === "risk" || stock.analysis.risks.length >= 3).length;
  const metrics = [
    ["覆盖股票", `${total} 只`],
    ["平均评分", `${Math.round(avgScore) || 0}`],
    ["低估区间", `${undervalued} 只`],
    ["风险提醒", `${highRisk} 条`],
  ];
  els.marketMetrics.innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderUpcoming() {
  if (!els.upcomingPanel) return;
  const items = state.filtered
    .map((stock) => ({
      stock,
      date: stock.quote.earnings_date,
      days: daysUntil(stock.quote.earnings_date),
    }))
    .filter((item) => item.date && item.days >= 0 && item.days <= 45)
    .sort((a, b) => a.days - b.days)
    .slice(0, 6);

  if (!items.length) {
    els.upcomingPanel.hidden = true;
    els.upcomingPanel.innerHTML = "";
    return;
  }

  els.upcomingPanel.hidden = false;
  els.upcomingPanel.innerHTML = `
    <div class="upcoming-heading">
      <h3>近期财报</h3>
      <span class="muted">45 天内</span>
    </div>
    <ul class="upcoming-list">
      ${items
        .map(
          ({ stock, date, days }) => `
            <li>
              <button class="upcoming-item" data-symbol="${stock.symbol}" data-market="${stock.market}" type="button">
                <strong>${stock.name}</strong>
                <span>${date} · ${days === 0 ? "今天" : `${days} 天后`}</span>
              </button>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;

  els.upcomingPanel.querySelectorAll(".upcoming-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const stock = await provider.getStock(button.dataset.symbol, button.dataset.market);
      selectStock(stock, { openDetail: true });
    });
  });
}

function renderRows() {
  if (!state.filtered.length) {
    els.stockRows.innerHTML = `<tr><td colspan="9"><div class="empty-state">暂无行情数据。请运行 python3 server.py 并确认网络可用。</div></td></tr>`;
    return;
  }
  els.stockRows.innerHTML = state.filtered
    .map((stock) => {
      const selected = state.selected && sameStock(stock, state.selected) ? "active" : "";
      const mos = marginOfSafety(stock);
      const w52 = week52Stats(stock);
      const mosClass = mos >= 0 ? "up" : "down";
      return `
        <tr class="stock-row ${selected}" data-symbol="${stock.symbol}" data-market="${stock.market}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <td>
            <div class="stock-id">
              <strong>${stock.name}</strong>
              <span>${stock.symbol} · ${stock.englishName}</span>
            </div>
          </td>
          <td>${marketLabel(stock.market)}</td>
          <td>${stock.industry}</td>
          <td class="num">${money(stock.quote.price, stock.currency)}</td>
          <td class="num ${stock.quote.change_pct >= 0 ? "up" : "down"}">${signed(stock.quote.change_pct)}%</td>
          <td class="num">${stock.quote.pe ? stock.quote.pe.toFixed(1) : "—"}</td>
          <td class="num ${mosClass}">${formatMarginOfSafety(mos)}</td>
          <td class="num muted">${w52 ? `-${w52.fromHigh}%` : "—"}</td>
          <td><span class="tag">${valuationLabel(stock.valuation.state)}</span></td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll(".stock-row").forEach((row) => {
    const activate = async () => {
      const stock = await provider.getStock(row.dataset.symbol, row.dataset.market);
      selectStock(stock, { openDetail: true });
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
}

function selectStock(stock, { openDetail = false, updateHash = true } = {}) {
  if (!stock) {
    state.selected = null;
    els.stockDetail.innerHTML = `<div class="empty-state">没有匹配的股票。请调整搜索或筛选条件。</div>`;
    return;
  }
  state.selected = stock;
  els.selectedStockSummary.textContent = `${stock.name} · ${formatMarginOfSafety(marginOfSafety(stock))} · ${valuationLabel(stock.valuation.state)}${stock.quote.as_of ? ` · ${stock.quote.as_of}` : ""}`;
  els.detailCrumb.textContent = `${stock.name} ${stock.symbol} · ${marketLabel(stock.market)} · ${stock.industry}`;
  renderSourceStatus();
  renderRows();
  renderDetail();
  if (openDetail) {
    showDetail(stock, { updateHash });
  }
}

function renderDetail() {
  const stock = state.selected;
  if (!stock) return;
  provider.getStock(stock.symbol, stock.market).then((enriched) => {
    if (!enriched || state.selected?.symbol !== enriched.symbol || state.selected?.market !== enriched.market) return;
    state.selected = enriched;
    paintDetail(enriched);
  });
}

function paintDetail(stock) {
  const fragment = els.template.content.cloneNode(true);
  const root = fragment.querySelector(".report-card");
  const latest = latestFinancial(stock);
  const hasFinancials = Boolean(latest);
  const watchKey = stockKey(stock);
  const watched = Boolean(state.watchlist[watchKey]);

  root.querySelector(".js-name").textContent = `${stock.name} ${stock.symbol}`;
  root.querySelector(".js-meta").textContent = `${marketLabel(stock.market)} · ${stock.exchange} · ${stock.industry} · ${stock.englishName} · ${stock.currency}${stock.quote.as_of ? ` · 更新 ${stock.quote.as_of}` : ""}`;
  root.querySelector(".js-price").textContent = money(stock.quote.price, stock.currency);
  root.querySelector(".js-valuation-state").textContent = valuationLabel(stock.valuation.state);
  root.querySelector(".js-margin").textContent = formatMarginOfSafety(marginOfSafety(stock));
  root.querySelector(".js-margin").className = `js-margin ${marginOfSafety(stock) >= 0 ? "up" : "down"}`;
  root.querySelector(".js-score").textContent = hasFinancials ? `${stock.analysis.score}/100` : "—";

  root.querySelector(".js-pe").textContent = stock.quote.pe ? `${stock.quote.pe.toFixed(1)}x` : "—";
  root.querySelector(".js-pb").textContent = stock.quote.pb ? `${stock.quote.pb.toFixed(2)}x` : "—";
  root.querySelector(".js-ps").textContent = stock.quote.ps ? `${stock.quote.ps.toFixed(2)}x` : "—";
  root.querySelector(".js-dividend").textContent =
    stock.quote.dividend_yield != null ? `${stock.quote.dividend_yield.toFixed(2)}%` : "—";
  root.querySelector(".js-market-cap").textContent = formatMarketCap(stock.quote.market_cap, stock.currency);
  const w52 = week52Stats(stock);
  root.querySelector(".js-week52").textContent = w52
    ? `${money(stock.quote.week_52_low, stock.currency)} – ${money(stock.quote.week_52_high, stock.currency)} · ${w52.position}%`
    : "—";

  root.querySelector(".js-valuation-method").textContent = `估值方法：${stock.valuation.method}`;
  root.querySelector(".js-bear").textContent = money(stock.valuation.bear_price, stock.currency);
  root.querySelector(".js-base").textContent = money(stock.valuation.base_price, stock.currency);
  root.querySelector(".js-bull").textContent = money(stock.valuation.bull_price, stock.currency);
  const peer = peerContext(stock, provider.stocks);
  root.querySelector(".js-peer").textContent = peer;
  root.querySelector(".js-peer").hidden = !peer;

  root.querySelector(".js-rating-label").textContent = stock.analysis.rating_label;
  root.querySelector(".js-summary").textContent = stock.analysis.summary;

  const financialSection = root.querySelector("#detail-financials");
  if (hasFinancials) {
    root.querySelector(".js-revenue-growth").textContent = `${signed(latest.revenue_growth)}% YoY`;
    root.querySelector(".js-net-income").textContent = formatFinancialMillions(latest.net_income, stock.currency);
    root.querySelector(".js-gross-margin").textContent = `${latest.gross_margin.toFixed(1)}%`;
    root.querySelector(".js-debt-ratio").textContent = `${latest.debt_ratio.toFixed(1)}%`;
  } else {
    financialSection.innerHTML = `<div class="empty-state">暂无财报数据，数据源未返回可解析的财务指标。</div>`;
  }

  const marker = root.querySelector(".js-marker");
  marker.style.left = `${markerPosition(stock)}%`;

  root.querySelector(".js-band-labels").innerHTML = [
    `关注 ${money(stock.valuation.watch_zone[0], stock.currency)}-${money(stock.valuation.watch_zone[1], stock.currency)}`,
    `合理 ${money(stock.valuation.fair_zone[0], stock.currency)}-${money(stock.valuation.fair_zone[1], stock.currency)}`,
    `偏贵 ${money(stock.valuation.expensive_zone[0], stock.currency)}-${money(stock.valuation.expensive_zone[1], stock.currency)}`,
    `风险 > ${money(stock.valuation.risk_price, stock.currency)}`,
  ]
    .map((label) => `<span>${label}</span>`)
    .join("");

  root.querySelector(".js-positives").innerHTML = stock.analysis.positives.map((item) => `<li>${item}</li>`).join("");
  root.querySelector(".js-risks").innerHTML = stock.analysis.risks.map((item) => `<li>${item}</li>`).join("");
  root.querySelector(".js-assumptions").innerHTML = stock.valuation.assumptions.map((item) => `<li>${item}</li>`).join("");
  root.querySelector(".js-sources").innerHTML = sourceItems(stock)
    .map((source) => `<li><a href="${source.url}" target="_blank" rel="noreferrer">${source.name}</a>：${source.role}</li>`)
    .join("");

  root.querySelector(".js-breakdown").innerHTML = hasFinancials
    ? Object.entries(stock.analysis.breakdown)
        .map(
          ([label, value]) => `
        <div class="score-row">
          <span>${label}</span>
          <div class="score-bar"><span style="width:${value}%"></span></div>
          <strong>${value}</strong>
        </div>
      `,
        )
        .join("")
    : `<p class="muted">需 SEC 财报数据后展示评分拆解。</p>`;

  paintEvents(root, stock.events || []);

  const watchButton = root.querySelector(".js-watch");
  watchButton.textContent = watched ? "已加入自选" : "加入自选";
  watchButton.classList.toggle("active", watched);
  watchButton.addEventListener("click", () => toggleWatch(stock));

  els.stockDetail.replaceChildren(fragment);
  if (hasFinancials) {
    els.stockDetail.querySelectorAll(".js-chart").forEach((canvas) => {
      drawMetricChart(canvas, stock.financials, canvas.dataset.metric);
    });
  }
  renderWatchlist();
}

function renderWatchlist() {
  const watchItems = Object.values(state.watchlist)
    .map((item) => provider.stocks.find((stock) => stock.symbol === item.symbol && stock.market === item.market))
    .filter(Boolean);

  if (!watchItems.length) {
    els.watchlistContent.innerHTML = `<div class="empty-state">还没有自选股。在股票详情页点击“加入自选”开始跟踪关注区间。</div>`;
    return;
  }

  els.watchlistContent.innerHTML = watchItems
    .map((stock) => {
      const saved = state.watchlist[stockKey(stock)];
      const alertText = alertStatus(stock, saved.targetPrice);
      const mos = marginOfSafety(stock);
      return `
        <article class="watch-card">
          <header>
            <div>
              <strong>${stock.name}</strong>
              <p class="muted">${stock.symbol} · ${marketLabel(stock.market)}</p>
            </div>
            <span class="tag">${valuationLabel(stock.valuation.state)}</span>
          </header>
          <div class="watch-price">
            <span class="muted">当前价</span>
            <strong>${money(stock.quote.price, stock.currency)}</strong>
          </div>
          <div class="watch-stats">
            <span>安全边际 <strong class="${mos >= 0 ? "up" : "down"}">${formatMarginOfSafety(mos)}</strong></span>
            <span>距目标价 <strong>${distanceToTarget(stock.quote.price, saved.targetPrice)}</strong></span>
          </div>
          ${formatNextEarnings(stock.quote.earnings_date)}
          <label>
            <span>目标关注价</span>
            <input data-target="${stockKey(stock)}" type="number" step="0.01" value="${saved.targetPrice}" />
          </label>
          <p class="${alertText.type}">${alertText.text}</p>
          <button class="ghost-button" data-remove="${stockKey(stock)}" type="button">移出自选</button>
        </article>
      `;
    })
    .join("");

  els.watchlistContent.querySelectorAll("[data-target]").forEach((input) => {
    input.addEventListener("input", () => {
      state.watchlist[input.dataset.target].targetPrice = Number(input.value);
      saveWatchlist();
      renderWatchlist();
    });
  });

  els.watchlistContent.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.watchlist[button.dataset.remove];
      saveWatchlist();
      renderWatchlist();
      renderDetail();
    });
  });
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  document.querySelector(`#${view}View`)?.scrollIntoView({ block: "start" });
  if (view === "settings") {
    renderSettings();
  }
  if (view !== "detail" && location.hash.startsWith("#/stock/")) {
    history.replaceState(null, "", location.pathname);
  }
}

function showDetail(stock, { updateHash = true } = {}) {
  state.activeView = "detail";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === "detailView"));
  document.querySelector("#detailView")?.scrollIntoView({ block: "start" });
  if (updateHash) {
    history.pushState(null, "", `#/stock/${stock.market}/${encodeURIComponent(stock.symbol)}`);
  }
}

function showDashboard({ clearHash = false } = {}) {
  switchView("dashboard");
  if (clearHash) {
    history.pushState(null, "", location.pathname);
  }
}

async function restoreRoute() {
  const match = location.hash.match(/^#\/stock\/([^/]+)\/(.+)$/);
  if (!match) {
    if (state.activeView === "detail") {
      showDashboard({ clearHash: false });
    }
    return;
  }
  const [, market, encodedSymbol] = match;
  const symbol = decodeURIComponent(encodedSymbol);
  const stock = await provider.getStock(symbol, market);
  if (stock) {
    selectStock(stock, { openDetail: true, updateHash: false });
  }
}

function syncMarketShortcuts() {
  els.marketShortcuts.forEach((button) => {
    button.classList.toggle("active", button.dataset.marketShortcut === state.market);
  });
}

function renderSourceStatus() {
  if (!els.topSourceStatus) return;
  els.topSourceStatus.textContent = provider.status.quoteLabel;
  document.body.dataset.quoteStatus = provider.status.quote;
}

function toggleWatch(stock) {
  const key = stockKey(stock);
  if (state.watchlist[key]) {
    delete state.watchlist[key];
  } else {
    state.watchlist[key] = {
      symbol: stock.symbol,
      market: stock.market,
      targetPrice: stock.valuation.watch_zone[1],
      createdAt: new Date().toISOString(),
    };
  }
  saveWatchlist();
  renderDetail();
}

function buildCatalogStock(seed, index) {
  const [symbol, name, englishName, market, exchange, currency, industry] = seed;
  return { symbol, name, englishName, market, exchange, currency, industry, listing_status: "listed", sortIndex: index };
}

function buildStockFromQuote(entry, liveQuote) {
  if (!liveQuote || liveQuote.price == null) return null;

  const quoteMeta = quoteSourceMeta();
  const quote = {
    symbol: entry.symbol,
    price: liveQuote.price,
    change_pct: liveQuote.change_pct ?? null,
    volume: liveQuote.volume ?? null,
    market_cap: liveQuote.market_cap ?? null,
    pe: liveQuote.pe ?? null,
    pb: liveQuote.pb ?? null,
    ps: liveQuote.ps ?? null,
    dividend_yield: liveQuote.dividend_yield ?? null,
    week_52_low: liveQuote.week_52_low ?? null,
    week_52_high: liveQuote.week_52_high ?? null,
    earnings_date: liveQuote.earnings_date ?? null,
    ex_dividend_date: liveQuote.ex_dividend_date ?? null,
    as_of: liveQuote.as_of ?? null,
    source: {
      name: liveQuote.provider || quoteMeta.name,
      url: liveQuote.source_url || quoteMeta.url,
      role: liveQuote.note || quoteMeta.role,
    },
    provider: liveQuote.provider || quoteMeta.name,
    updated_at: new Date().toISOString(),
  };

  return enrichStockMetrics({ ...entry, quote, financials: [] });
}

function enrichStockMetrics(stock) {
  const eps = stock.quote.pe ? stock.quote.price / stock.quote.pe : null;
  const latest = latestFinancial(stock);
  const valuation = buildValuation({
    price: stock.quote.price,
    pe: stock.quote.pe,
    pb: stock.quote.pb,
    ps: stock.quote.ps,
    eps,
    roe: latest?.roe ?? 0,
    dividendYield: stock.quote.dividend_yield ?? 0,
    industry: stock.industry,
    h: hash(`${stock.symbol}-${stock.market}`),
  });
  const analysis = latest
    ? buildAnalysis({
        name: stock.name,
        industry: stock.industry,
        score: scoreStock({
          revenueGrowth: latest.revenue_growth,
          margin: latest.gross_margin,
          cashQuality: cashQualityFromFinancial(latest),
          debtRatio: latest.debt_ratio,
          roe: latest.roe,
          valuation,
          trend: stock.quote.change_pct > 0 ? 60 : 40,
        }),
        valuation,
        revenueGrowth: latest.revenue_growth,
        margin: latest.gross_margin,
        cashQuality: cashQualityFromFinancial(latest),
        debtRatio: latest.debt_ratio,
        roe: latest.roe,
        pe: stock.quote.pe,
      })
    : buildAnalysisFromQuote(stock, valuation);

  return {
    ...stock,
    valuation,
    analysis,
    sourceMeta: {
      source: marketSources(stock.market)[0]?.name || quoteSourceMeta().name,
      source_url: marketSources(stock.market)[0]?.url || quoteSourceMeta().url,
      as_of_date: stock.quote.as_of?.slice(0, 10) || null,
      currency: stock.currency,
      market: stock.market,
      provider: stock.quote.provider,
      updated_at: stock.quote.updated_at,
    },
  };
}

function buildAnalysisFromQuote(stock, valuation) {
  const trend = stock.quote.change_pct ?? 0;
  const score = scoreFromQuoteOnly(stock.quote, valuation);
  const label =
    score >= 76
      ? "估值与趋势尚可"
      : score >= 62
        ? "可跟踪，等待财报验证"
        : score >= 48
          ? "信息不足，谨慎观察"
          : "价格或趋势偏弱";

  return {
    score,
    rating_label: label,
    summary: `${stock.name} 当前模型判断为「${valuationLabel(valuation.state)}」。仅基于 Yahoo 行情与估值模型，尚未接入财报明细。${stock.quote.as_of ? `行情更新 ${stock.quote.as_of}。` : ""}`,
    positives: [],
    negatives: [],
    risks:
      valuation.state === "risk" || valuation.state === "expensive"
        ? ["价格相对模型区间偏高，需等待下一期财报验证。"]
        : ["缺少财报数据，结论仅基于行情与估值假设。"],
    data_quality: "行情",
    generated_at: new Date().toISOString(),
    breakdown: {
      估值: valuation.state === "undervalued" ? 86 : valuation.state === "fair" ? 70 : 45,
      趋势: clamp(Math.round(50 + trend * 2), 0, 100),
    },
  };
}

function scoreFromQuoteOnly(quote, valuation) {
  const value =
    valuation.state === "undervalued" ? 82 : valuation.state === "fair" ? 68 : valuation.state === "expensive" ? 45 : 28;
  const trend = clamp(Math.round(50 + (quote.change_pct ?? 0) * 2), 0, 100);
  return Math.round(value * 0.55 + trend * 0.45);
}

function buildValuation({ price, pe, pb, ps, eps, roe, dividendYield, industry, h }) {
  let method = "PE/PB blended";
  let base;
  const normalizedEps = Math.max(eps, 0.18);
  if (!pe) {
    method = "PS + PB for loss-making company";
    base = price * (1.05 - Math.min(ps || 0, 8) / 35);
  } else if (industry.includes("银行") || industry.includes("保险")) {
    method = "PB + dividend yield";
    base = price * (1.12 + (roe - pb * 3) / 100 + dividendYield / 80);
  } else if (industry.includes("软件") || industry.includes("互联网") || industry.includes("半导体")) {
    method = "growth-adjusted PE";
    base = normalizedEps * (18 + (h % 28));
  } else {
    method = "PE + cash yield";
    base = normalizedEps * (11 + (h % 20)) * (1 + dividendYield / 100);
  }

  const bear = round(base * 0.78, 2);
  const bull = round(base * 1.28, 2);
  const fairLow = round(base * 0.9, 2);
  const fairHigh = round(base * 1.1, 2);
  const risk = round(bull * 1.12, 2);
  let state = "fair";
  if (price <= fairLow) state = "undervalued";
  if (price > fairHigh && price <= risk) state = "expensive";
  if (price > risk) state = "risk";

  return {
    method,
    bear_price: bear,
    base_price: round(base, 2),
    bull_price: bull,
    watch_zone: [bear, fairLow],
    fair_zone: [fairLow, fairHigh],
    expensive_zone: [fairHigh, risk],
    risk_price: risk,
    state,
    assumptions: [
      `${method} 模型用于当前行业和盈利状态。`,
      `保守情景取基准估值的 78%，乐观情景取 128%。`,
      pe ? `当前 PE 为 ${pe.toFixed(1)}，估值结论会受盈利周期影响。` : "公司当前 EPS 为负或接近亏损，不使用 PE 作为核心估值。",
      "区间用于研究观察，不是确定性买卖指令。",
    ],
  };
}

function scoreStock({ revenueGrowth, margin, cashQuality, debtRatio, roe, valuation, trend }) {
  const fundamental = clamp(Math.round(roe * 2 + margin * 0.6 + revenueGrowth), 0, 100);
  const value = valuation.state === "undervalued" ? 82 : valuation.state === "fair" ? 68 : valuation.state === "expensive" ? 45 : 28;
  const trendScore = clamp(Math.round(trend), 0, 100);
  const risk = clamp(Math.round(100 - debtRatio + cashQuality / 4), 0, 100);
  const quality = 76;
  return Math.round(fundamental * 0.3 + value * 0.25 + trendScore * 0.18 + risk * 0.17 + quality * 0.1);
}

function buildAnalysis({ name, industry, score, valuation, revenueGrowth, margin, cashQuality, debtRatio, roe, pe }) {
  const positives = [];
  const risks = [];
  if (revenueGrowth > 12) positives.push(`收入同比增长 ${revenueGrowth.toFixed(1)}%，增长动能仍然明显。`);
  if (margin > 38) positives.push(`毛利率 ${margin.toFixed(1)}%，行业内具备较强定价能力。`);
  if (cashQuality > 82) positives.push(`经营现金流质量 ${cashQuality.toFixed(1)}%，利润含金量较好。`);
  if (roe > 16) positives.push(`ROE ${roe.toFixed(1)}%，资本回报水平较强。`);
  if (!positives.length) positives.push("财报数据已接入，可继续跟踪下一期披露。");

  if (valuation.state === "risk") risks.push("当前价格高于模型风险触发位，安全边际不足。");
  if (valuation.state === "expensive") risks.push("价格进入偏贵区间，后续收益更依赖业绩继续超预期。");
  if (revenueGrowth < 3) risks.push(`收入增长仅 ${revenueGrowth.toFixed(1)}%，需要警惕增长放缓。`);
  if (cashQuality < 70) risks.push("经营现金流弱于利润表现，需检查应收、存货或资本开支压力。");
  if (debtRatio > 58) risks.push(`负债率 ${debtRatio.toFixed(1)}%，利率和再融资环境变化会放大波动。`);
  if (!pe) risks.push("公司当前亏损或 EPS 不可用，传统 PE 估值不可用。");
  if (!risks.length) risks.push("主要风险来自市场估值波动、行业景气度变化和数据延迟。");

  const label =
    score >= 76
      ? "高质量但仍需看价格区间"
      : score >= 62
        ? "基本面可跟踪，等待更好安全边际"
        : score >= 48
          ? "分歧较大，需要等待财报验证"
          : "风险较高，暂不适合激进配置";

  const summary = `${name} 所处 ${industry} 行业，当前模型判断为“${valuationLabel(valuation.state)}”。综合评分 ${score}/100，核心依据来自收入增速、盈利质量、现金流、杠杆和估值区间。该结论用于研究辅助，重点是观察价格是否进入关注区间，以及下一期财报能否验证增长和现金流。`;

  return {
    score,
    rating_label: label,
    summary,
    positives: positives.slice(0, 3),
    negatives: [],
    risks: risks.slice(0, 4),
    data_quality: "B+",
    generated_at: new Date().toISOString(),
    breakdown: {
      基本面: clamp(Math.round(roe * 2 + margin * 0.5), 0, 100),
      估值: valuation.state === "undervalued" ? 86 : valuation.state === "fair" ? 70 : valuation.state === "expensive" ? 48 : 30,
      趋势: clamp(Math.round(50 + revenueGrowth * 1.2), 0, 100),
      风险: clamp(Math.round(105 - debtRatio), 0, 100),
      可信度: 76,
    },
  };
}

function resolveTheme(stored) {
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initSidebar() {
  const stored = localStorage.getItem(SIDEBAR_KEY);
  const collapsed = stored === "collapsed" && window.innerWidth >= SIDEBAR_COLLAPSE_MIN;
  applySidebar(collapsed ? "collapsed" : "expanded", { persist: false });
}

function toggleSidebar() {
  const collapsed = document.documentElement.dataset.sidebar === "collapsed";
  applySidebar(collapsed ? "expanded" : "collapsed");
}

function syncSidebarForViewport() {
  if (window.innerWidth < SIDEBAR_COLLAPSE_MIN) {
    document.documentElement.dataset.sidebar = "expanded";
    return;
  }
  const stored = localStorage.getItem(SIDEBAR_KEY);
  applySidebar(stored === "collapsed" ? "collapsed" : "expanded", { persist: false });
}

function applySidebar(state, { persist = true } = {}) {
  const collapsed = state === "collapsed" && window.innerWidth >= SIDEBAR_COLLAPSE_MIN;
  const next = collapsed ? "collapsed" : "expanded";
  document.documentElement.dataset.sidebar = next;
  if (persist) {
    localStorage.setItem(SIDEBAR_KEY, next);
  }
  if (els.sidebarToggle) {
    els.sidebarToggle.setAttribute("aria-label", collapsed ? "展开侧边栏" : "收起侧边栏");
    els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  }
}

function initTheme() {
  applyTheme(document.documentElement.dataset.theme || resolveTheme(localStorage.getItem(THEME_KEY)));
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);

  if (els.themeToggle) {
    const dark = theme === "dark";
    els.themeToggle.setAttribute("aria-label", dark ? "切换到明亮模式" : "切换到暗黑模式");
    els.themeToggle.querySelector(".theme-icon").textContent = dark ? "☀" : "☾";
  }

  const canvas = els.stockDetail?.querySelector(".js-chart[data-metric='revenue']");
  if (canvas && state.selected) {
    els.stockDetail.querySelectorAll(".js-chart").forEach((node) => {
      drawMetricChart(node, state.selected.financials, node.dataset.metric);
    });
  }
}

function themeChartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    grid: styles.getPropertyValue("--chart-grid").trim(),
    line: styles.getPropertyValue("--chart-line").trim(),
    label: styles.getPropertyValue("--chart-label").trim(),
  };
}

function drawMetricChart(canvas, financials, metric) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = themeChartColors();
  const values = financials.map((item) => item[metric]);
  const isPercent = metric === "gross_margin" || metric === "debt_ratio";
  ctx.clearRect(0, 0, width, height);
  const pad = 24;
  const min = Math.min(...values) * (isPercent ? 0.92 : 0.94);
  const max = Math.max(...values) * (isPercent ? 1.08 : 1.06);
  const range = max - min || 1;

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad + ((height - pad * 2) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const points = values.map((value, index) => {
    const x = pad + ((width - pad * 2) / (values.length - 1)) * index;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y];
  });

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = colors.line;
  ctx.font = "11px system-ui";
  points.forEach(([x, y], index) => {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.label;
    ctx.fillText(financials[index].period.replace("202", "'2"), x - 16, height - 6);
    ctx.fillStyle = colors.line;
  });
}

function sourceItems(stock) {
  const sources = [stock.quote.source];
  if (stock.financialSource) sources.push(stock.financialSource);
  return [...sources, ...marketSources(stock.market)].filter(
    (source, index, items) => items.findIndex((item) => item.name === source.name && item.url === source.url) === index,
  );
}

function cashQualityFromFinancial(financial) {
  if (!financial.net_income) return 68;
  return clamp(round((financial.operating_cashflow / Math.abs(financial.net_income)) * 100, 1), 15, 140);
}

function latestFinancial(stock) {
  if (!stock.financials?.length) return null;
  return stock.financials[stock.financials.length - 1];
}

function buildEventsFromQuote(stock) {
  const events = [];
  if (stock.quote.earnings_date) {
    events.push({
      date: stock.quote.earnings_date,
      kind: "earnings",
      title: "预计财报披露",
      status: eventStatus(stock.quote.earnings_date),
    });
  }
  if (stock.quote.ex_dividend_date) {
    events.push({
      date: stock.quote.ex_dividend_date,
      kind: "dividend",
      title: "除息日",
      status: eventStatus(stock.quote.ex_dividend_date),
    });
  }
  return events;
}

function marketDisclosureLinks(stock) {
  if (stock.market === "A") {
    return [
      {
        kind: "link",
        title: "巨潮资讯网 · 公司公告",
        url: "https://www.cninfo.com.cn/new/disclosure/stock",
        status: "link",
      },
    ];
  }
  if (stock.market === "HK") {
    return [
      {
        kind: "link",
        title: "HKEXnews · 上市公司公告",
        url: "https://www.hkexnews.hk/index.htm",
        status: "link",
      },
    ];
  }
  return [];
}

function sortEvents(events) {
  const dated = events.filter((event) => event.date);
  const links = events.filter((event) => !event.date);
  const upcoming = dated.filter((event) => daysUntil(event.date) >= 0).sort((a, b) => daysUntil(a.date) - daysUntil(b.date));
  const past = dated.filter((event) => daysUntil(event.date) < 0).sort((a, b) => daysUntil(b.date) - daysUntil(a.date));
  return [...upcoming, ...past, ...links];
}

function paintEvents(root, events) {
  const upcoming = events.filter((event) => event.date && daysUntil(event.date) >= 0);
  const past = events.filter((event) => (event.date && daysUntil(event.date) < 0) || event.status === "past");
  const links = events.filter((event) => event.status === "link");

  root.querySelector(".js-events-upcoming").innerHTML = [...upcoming, ...links].length
    ? [...upcoming, ...links].map(renderEventItem).join("")
    : `<li class="event-empty muted">暂无即将到来的事件</li>`;
  root.querySelector(".js-events-past").innerHTML = past.length
    ? past.map(renderEventItem).join("")
    : `<li class="event-empty muted">暂无近期披露记录</li>`;
}

function renderEventItem(event) {
  const badge = eventKindLabel(event.kind);
  const title = event.url
    ? `<a href="${event.url}" target="_blank" rel="noreferrer">${event.title}</a>`
    : event.title;
  const when = event.date ? `<span class="muted">${event.date}${formatDaysLabel(event.date)}</span>` : "";
  return `
    <li class="event-item">
      <span class="event-badge">${badge}</span>
      <div class="event-copy">
        <strong>${title}</strong>
        ${when}
      </div>
    </li>
  `;
}

function formatNextEarnings(date) {
  if (!date) return "";
  const days = daysUntil(date);
  if (days < 0 || days > 60) return "";
  const label = days === 0 ? "今天财报" : `${days} 天后财报`;
  return `<p class="watch-earnings muted">下一事件：${date} · ${label}</p>`;
}

function eventKindLabel(kind) {
  return {
    earnings: "财报",
    dividend: "分红",
    filing: "披露",
    link: "查阅",
  }[kind] || "事件";
}

function eventStatus(date) {
  return daysUntil(date) >= 0 ? "upcoming" : "past";
}

function formatDaysLabel(date) {
  const days = daysUntil(date);
  if (days > 0) return ` · ${days} 天后`;
  if (days === 0) return " · 今天";
  return ` · ${Math.abs(days)} 天前`;
}

function daysUntil(date) {
  if (!date) return NaN;
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function formatISODate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
}

function marginOfSafety(stock) {
  const fairLow = stock.valuation.fair_zone[0];
  if (!fairLow) return 0;
  return round(((fairLow - stock.quote.price) / fairLow) * 100, 1);
}

function formatMarginOfSafety(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function week52Stats(stock) {
  const { price, week_52_high, week_52_low } = stock.quote;
  if (!week_52_high || !week_52_low || week_52_high <= week_52_low) return null;
  return {
    fromHigh: round(((week_52_high - price) / week_52_high) * 100, 1),
    position: round(((price - week_52_low) / (week_52_high - week_52_low)) * 100, 0),
  };
}

function formatMarketCap(value, currency) {
  if (!value) return "—";
  const sym = CURRENCY[currency] || "";
  if (value >= 1e12) return `${sym}${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e8) return `${sym}${(value / 1e8).toFixed(1)} 亿`;
  if (value >= 1e6) return `${sym}${(value / 1e6).toFixed(1)}M`;
  return `${sym}${Number(value).toLocaleString("zh-CN")}`;
}

function formatCompactNumber(value, currency) {
  if (value == null) return "—";
  const sym = CURRENCY[currency] || "";
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${sym}${(value / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${sym}${(value / 1e4).toFixed(1)} 万`;
  return `${sym}${Number(value).toLocaleString("zh-CN")}`;
}

function formatFinancialMillions(value, currency) {
  if (value == null) return "—";
  return formatCompactNumber(value * 1_000_000, currency);
}

function peerContext(stock, pool) {
  const peers = pool.filter((item) => item.industry === stock.industry && item.market === stock.market);
  if (peers.length <= 1) return "";
  const peValues = peers.map((item) => item.quote.pe).filter(Boolean);
  if (!stock.quote.pe) {
    return `同业 ${peers.length} 只：当前亏损，PE 不可比。`;
  }
  if (!peValues.length) return `同业 ${peers.length} 只：多数亏损，PE 可比性有限。`;
  const sorted = [...peValues].sort((a, b) => a - b);
  const rank = sorted.filter((pe) => pe < stock.quote.pe).length + 1;
  const avg = average(sorted);
  return `同业 ${peers.length} 只：PE 排名 ${rank}/${sorted.length}，行业均值 ${avg.toFixed(1)}x，当前 ${stock.quote.pe.toFixed(1)}x。`;
}

function distanceToTarget(price, targetPrice) {
  if (!targetPrice) return "—";
  const gap = ((price - targetPrice) / targetPrice) * 100;
  if (gap <= 0) return `${Math.abs(gap).toFixed(1)}% 以内`;
  return `+${gap.toFixed(1)}%`;
}

function markerPosition(stock) {
  const min = stock.valuation.bear_price;
  const max = stock.valuation.risk_price;
  return clamp(((stock.quote.price - min) / (max - min)) * 100, 1, 99);
}

function alertStatus(stock, targetPrice) {
  const mos = marginOfSafety(stock);
  if (stock.quote.price <= targetPrice) {
    return { type: "up", text: "已进入关注区间，可复核财报和估值假设。" };
  }
  if (mos >= 5) {
    return { type: "up", text: `安全边际 ${formatMarginOfSafety(mos)}，价格低于合理区间下沿。` };
  }
  const gap = ((stock.quote.price - targetPrice) / targetPrice) * 100;
  return { type: "muted", text: `距关注价仍高 ${gap.toFixed(1)}%，安全边际 ${formatMarginOfSafety(mos)}。` };
}

function stockKey(stock) {
  return `${stock.market}:${stock.symbol}`;
}

function sameStock(a, b) {
  return a.symbol === b.symbol && a.market === b.market;
}

function marketLabel(market) {
  return { A: "A 股", HK: "港股", US: "美股" }[market] || market;
}

function valuationLabel(stateName) {
  return {
    undervalued: "低估区间",
    fair: "合理区间",
    expensive: "偏贵区间",
    risk: "风险区间",
  }[stateName];
}

function money(value, currency) {
  return `${CURRENCY[currency] || ""}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signed(value) {
  return `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}`;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function loadWatchlist() {
  try {
    return JSON.parse(localStorage.getItem("stockagent.watchlist") || "{}");
  } catch {
    return {};
  }
}

function saveWatchlist() {
  localStorage.setItem("stockagent.watchlist", JSON.stringify(state.watchlist));
}
