const CURRENCY = {
  CNY: "¥",
  HKD: "HK$",
  USD: "$",
};

const FX_TO_CNY = {
  CNY: 1,
  HKD: 0.92,
  USD: 7.25,
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


const WATCHLIST_KEY = "stockagent.watchlist";
const HOLDINGS_KEY = "stockagent.holdings";
const NOTES_KEY = "stockagent.notes";
const ALERTS_KEY = "stockagent.alertHistory";
const PREFS_KEY = "stockagent.prefs";
const THEME_KEY = "stockagent.theme";
const SIDEBAR_KEY = "stockagent.sidebar";
const SIDEBAR_COLLAPSE_MIN = 1181;
const CUSTOM_KEY = "stockagent.customSymbols";
const WORKSPACE_CACHE_KEY = "stockagent.workspace.cache";
const WORKSPACE_SYNC_DEBOUNCE_MS = 500;

const GROUP_LABELS = {
  core: "核心仓",
  watch: "观察",
  long: "长期",
};

const DECISION_LABELS = {
  watch: "观望",
  buy: "关注买入",
  hold: "持有",
  trim: "减仓",
  exit: "移出",
};

const PAGE_TITLES = {
  workbench: "今日工作台",
  watchlist: "自选跟踪",
  holdings: "持仓",
  research: "研究池",
  detail: "股票详情",
  settings: "设置",
};

class HybridProvider {
  constructor(seeds) {
    this.catalog = seeds.map((seed, index) => buildCatalogStock(seed, index));
    this.customCatalog = loadCustomSymbols().map((item, index) => ({
      ...item,
      listing_status: "listed",
      sortIndex: 1000 + index,
      custom: true,
    }));
    this.stocks = [];
    this.quoteHydrated = false;
    this.quoteHydration = null;
    this.historyCache = new Map();
    this.status = {
      quote: "connecting",
      quoteLabel: "行情连接中",
      filing: "等待 SEC 数据",
    };
  }

  allCatalog() {
    const seen = new Set(this.catalog.map(stockKey));
    return [...this.catalog, ...this.customCatalog.filter((item) => !seen.has(stockKey(item)))];
  }

  async hydrateQuotes() {
    if (this.quoteHydrated) return;
    if (this.quoteHydration) return this.quoteHydration;
    this.quoteHydration = fetch("/api/quotes")
      .then((response) => {
        if (!response.ok) throw new Error(`Quote API ${response.status}`);
        return response.json();
      })
      .then(async (payload) => {
        const quotes = new Map(payload.quotes.map((quote) => [`${quote.market}:${quote.symbol}`, quote]));
        const seedStocks = this.catalog
          .map((entry) => buildStockFromQuote(entry, quotes.get(stockKey(entry))))
          .filter(Boolean);

        const customStocks = [];
        for (const entry of this.customCatalog) {
          if (quotes.has(stockKey(entry))) {
            const stock = buildStockFromQuote(entry, quotes.get(stockKey(entry)));
            if (stock) customStocks.push(stock);
            continue;
          }
          const fetched = await this.fetchCustomQuote(entry.symbol, entry.market);
          if (fetched) customStocks.push(fetched);
        }

        this.stocks = [...seedStocks, ...customStocks];
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

  async fetchCustomQuote(symbol, market) {
    try {
      const response = await fetch(
        `/api/quote?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}`,
      );
      if (!response.ok) return null;
      const payload = await response.json();
      if (!payload.quote) return null;
      const meta = payload.meta || {};
      const entry = {
        symbol: meta.symbol || symbol,
        name: meta.name || symbol,
        englishName: meta.englishName || meta.name || symbol,
        market: meta.market || market,
        exchange: meta.exchange || market,
        currency: meta.currency || ({ A: "CNY", HK: "HKD", US: "USD" }[market] || "CNY"),
        industry: meta.industry || "自定义",
        listing_status: "listed",
        sortIndex: 2000,
        custom: true,
      };
      return buildStockFromQuote(entry, payload.quote);
    } catch (error) {
      console.warn("自定义行情失败", error);
      return null;
    }
  }

  async ensureStock(symbol, market) {
    await this.hydrateQuotes();
    let stock = this.stocks.find((item) => item.symbol === symbol && item.market === market);
    if (stock) return stock;
    const fetched = await this.fetchCustomQuote(symbol, market);
    if (fetched) {
      this.stocks.push(fetched);
      this.rememberCustom(fetched);
    }
    return fetched;
  }

  rememberCustom(stock) {
    const key = stockKey(stock);
    if (this.catalog.some((item) => stockKey(item) === key)) return;
    if (this.customCatalog.some((item) => stockKey(item) === key)) return;
    const entry = {
      symbol: stock.symbol,
      name: stock.name,
      englishName: stock.englishName,
      market: stock.market,
      exchange: stock.exchange,
      currency: stock.currency,
      industry: stock.industry || "自定义",
      custom: true,
    };
    this.customCatalog.push(entry);
    saveCustomSymbols(this.customCatalog);
  }

  async search(filters) {
    await this.hydrateQuotes();
    return this.filterStocks(filters);
  }

  async getStock(symbol, market) {
    await this.hydrateQuotes();
    let stock = this.stocks.find((item) => item.symbol === symbol && item.market === market);
    if (!stock) {
      stock = await this.ensureStock(symbol, market);
    }
    if (!stock) return stock;
    if (!(market === "US" && appConfig?.sec?.enabled === false)) {
      stock = await this.withFinancials(stock);
    }
    return this.withEvents(stock);
  }

  async getHistory(symbol, market, range = "1y") {
    const cacheKey = `${market}:${symbol}:${range}`;
    if (this.historyCache.has(cacheKey)) return this.historyCache.get(cacheKey);
    try {
      const response = await fetch(
        `/api/history?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`,
      );
      const payload = await response.json();
      this.historyCache.set(cacheKey, payload);
      return payload;
    } catch (error) {
      return { points: [], error: String(error) };
    }
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
      const enriched = enrichStockMetrics({
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
      const index = this.stocks.findIndex((item) => sameStock(item, stock));
      if (index >= 0) this.stocks[index] = { ...this.stocks[index], ...enriched, financials: payload.financials };
      return enriched;
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
  watchlist: {},
  holdings: {},
  notes: {},
  alertHistory: [],
  prefs: { notify: false, baseCurrency: "CNY" },
  compare: [],
  activeView: "workbench",
  market: "A",
  priceRange: "1y",
  watchGroupFilter: "all",
  watchAlertFilter: "all",
  workspaceSync: {
    status: "idle",
    updatedAt: null,
    error: null,
    source: "local",
  },
};

let workspaceSaveTimer = null;
let workspaceSaveInFlight = null;

const els = {
  pageTitle: document.querySelector("#pageTitle"),
  searchInput: document.querySelector("#searchInput"),
  industryFilter: document.querySelector("#industryFilter"),
  valuationFilter: document.querySelector("#valuationFilter"),
  stockRows: document.querySelector("#stockRows"),
  stockDetail: document.querySelector("#stockDetail"),
  marketMetrics: document.querySelector("#marketMetrics"),
  upcomingPanel: document.querySelector("#upcomingPanel"),
  template: document.querySelector("#detailTemplate"),
  watchlistRows: document.querySelector("#watchlistRows"),
  watchlistEmpty: document.querySelector("#watchlistEmpty"),
  clearWatchlist: document.querySelector("#clearWatchlist"),
  watchGroupFilter: document.querySelector("#watchGroupFilter"),
  watchAlertFilter: document.querySelector("#watchAlertFilter"),
  addSymbolForm: document.querySelector("#addSymbolForm"),
  addMarket: document.querySelector("#addMarket"),
  addSymbol: document.querySelector("#addSymbol"),
  addSymbolStatus: document.querySelector("#addSymbolStatus"),
  holdingsRows: document.querySelector("#holdingsRows"),
  holdingsEmpty: document.querySelector("#holdingsEmpty"),
  holdingsMetrics: document.querySelector("#holdingsMetrics"),
  addHoldingForm: document.querySelector("#addHoldingForm"),
  holdingMarket: document.querySelector("#holdingMarket"),
  holdingSymbol: document.querySelector("#holdingSymbol"),
  holdingShares: document.querySelector("#holdingShares"),
  holdingCost: document.querySelector("#holdingCost"),
  holdingFormStatus: document.querySelector("#holdingFormStatus"),
  baseCurrency: document.querySelector("#baseCurrency"),
  workbenchMetrics: document.querySelector("#workbenchMetrics"),
  workbenchWatchMoves: document.querySelector("#workbenchWatchMoves"),
  workbenchAlerts: document.querySelector("#workbenchAlerts"),
  workbenchEarnings: document.querySelector("#workbenchEarnings"),
  workbenchHoldings: document.querySelector("#workbenchHoldings"),
  alertHistory: document.querySelector("#alertHistory"),
  clearAlertHistory: document.querySelector("#clearAlertHistory"),
  enableNotify: document.querySelector("#enableNotify"),
  compareBar: document.querySelector("#compareBar"),
  compareTable: document.querySelector("#compareTable"),
  clearCompare: document.querySelector("#clearCompare"),
  exportMarkdown: document.querySelector("#exportMarkdown"),
  printReport: document.querySelector("#printReport"),
  prefNotify: document.querySelector("#prefNotify"),
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
  workspaceStatus: document.querySelector("#workspaceStatus"),
  exportWorkspace: document.querySelector("#exportWorkspace"),
  importWorkspace: document.querySelector("#importWorkspace"),
  importWorkspaceFile: document.querySelector("#importWorkspaceFile"),
  syncWorkspaceNow: document.querySelector("#syncWorkspaceNow"),
};

init();

async function init() {
  initTheme();
  initSidebar();
  applyLocalWorkspace(readLocalWorkspaceBundle(), { source: "local-cache", markDirty: false });
  if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
  if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
  await loadAppConfig();
  await hydrateWorkspace();
  if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
  if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
  fillIndustryFilter();
  bindEvents();
  await refreshStocks();
  await restoreRoute();
  evaluateAlerts({ notify: false });
  renderWorkbench();
  renderWatchlist();
  renderHoldings();
  renderCompare();
  renderWorkspaceStatus();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bindEvents() {
  [els.searchInput, els.industryFilter, els.valuationFilter].forEach((el) => {
    el?.addEventListener("input", refreshStocks);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.querySelectorAll("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.goto));
  });

  els.clearWatchlist?.addEventListener("click", () => {
    state.watchlist = {};
    saveWatchlist();
    renderWatchlist();
    renderWorkbench();
    renderDetail();
  });

  els.watchGroupFilter?.addEventListener("change", () => {
    state.watchGroupFilter = els.watchGroupFilter.value;
    renderWatchlist();
  });
  els.watchAlertFilter?.addEventListener("change", () => {
    state.watchAlertFilter = els.watchAlertFilter.value;
    renderWatchlist();
  });

  els.addSymbolForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addSymbolToWatchlist(els.addMarket.value, els.addSymbol.value.trim());
  });

  els.addHoldingForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await upsertHolding({
      market: els.holdingMarket.value,
      symbol: els.holdingSymbol.value.trim(),
      shares: Number(els.holdingShares.value),
      cost: Number(els.holdingCost.value),
    });
  });

  els.baseCurrency?.addEventListener("change", () => {
    state.prefs.baseCurrency = els.baseCurrency.value;
    savePrefs();
    renderHoldings();
    renderWorkbench();
  });

  els.prefNotify?.addEventListener("change", () => {
    state.prefs.notify = els.prefNotify.checked;
    savePrefs();
  });

  els.enableNotify?.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      els.enableNotify.textContent = "浏览器不支持通知";
      return;
    }
    const permission = await Notification.requestPermission();
    state.prefs.notify = permission === "granted";
    savePrefs();
    if (els.prefNotify) els.prefNotify.checked = state.prefs.notify;
    els.enableNotify.textContent = state.prefs.notify ? "通知已开启" : "通知未授权";
  });

  els.clearAlertHistory?.addEventListener("click", () => {
    state.alertHistory = [];
    persistWorkspace();
    renderWorkbench();
  });

  els.exportWorkspace?.addEventListener("click", exportWorkspaceBackup);
  els.importWorkspace?.addEventListener("click", () => els.importWorkspaceFile?.click());
  els.importWorkspaceFile?.addEventListener("change", importWorkspaceBackup);
  els.syncWorkspaceNow?.addEventListener("click", () => persistWorkspace({ immediate: true }));

  els.clearCompare?.addEventListener("click", () => {
    state.compare = [];
    renderCompare();
    renderRows();
  });

  els.exportMarkdown?.addEventListener("click", exportSelectedMarkdown);
  els.printReport?.addEventListener("click", () => window.print());

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.sidebarToggle?.addEventListener("click", toggleSidebar);
  window.addEventListener("resize", syncSidebarForViewport);
  els.saveConfig?.addEventListener("click", saveAppConfig);
  els.resetConfig?.addEventListener("click", () => loadAppConfig({ rerender: true }));
  els.marketShortcuts.forEach((button) => {
    button.addEventListener("click", () => {
      state.market = button.dataset.marketShortcut;
      syncMarketShortcuts();
      if (state.activeView === "research") refreshStocks();
    });
  });
  els.backToList?.addEventListener("click", () => {
    if (state.activeView === "detail") {
      const fallback = Object.keys(state.watchlist).length ? "watchlist" : "research";
      switchView(fallback);
      history.replaceState(null, "", location.pathname);
    }
  });
  window.addEventListener("hashchange", restoreRoute);
  window.addEventListener("popstate", restoreRoute);
  els.detailTabs.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(link.getAttribute("href"));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  window.addEventListener("beforeunload", () => {
    if (state.workspaceSync.status === "pending" || state.workspaceSync.status === "syncing") {
      try {
        fetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildWorkspacePayload()),
          keepalive: true,
        });
      } catch {
        /* ignore unload failures */
      }
    }
  });
}

async function refreshStocks() {
  state.filtered = await provider.search({
    query: els.searchInput?.value || "",
    market: state.market,
    industry: els.industryFilter?.value || "all",
    valuation: els.valuationFilter?.value || "all",
  });
  state.filtered.sort((a, b) => marginOfSafety(b) - marginOfSafety(a));
  renderSourceStatus();
  syncMarketShortcuts();
  renderMetrics();
  renderUpcoming();
  renderRows();
  renderWorkbench();
  renderWatchlist();
  renderHoldings();
  renderCompare();
  evaluateAlerts({ notify: state.prefs.notify });
  if (!state.selected || !provider.stocks.some((stock) => sameStock(stock, state.selected))) {
    selectStock(state.filtered[0] || provider.stocks[0] || null, { openDetail: false });
  }
}

function fillIndustryFilter() {
  if (!els.industryFilter) return;
  const industries = [...new Set(STOCK_SEEDS.map((seed) => seed[6]))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  industries.forEach((industry) => {
    const option = document.createElement("option");
    option.value = industry;
    option.textContent = industry;
    els.industryFilter.append(option);
  });
}

function renderMetrics() {
  if (!els.marketMetrics) return;
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
                <strong>${escapeHtml(stock.name)}</strong>
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
  if (!els.stockRows) return;
  if (!state.filtered.length) {
    els.stockRows.innerHTML = `<tr><td colspan="10"><div class="empty-state">暂无行情数据。请运行 python3 server.py 并确认网络可用。</div></td></tr>`;
    return;
  }
  els.stockRows.innerHTML = state.filtered
    .map((stock) => {
      const selected = state.selected && sameStock(stock, state.selected) ? "active" : "";
      const mos = marginOfSafety(stock);
      const w52 = week52Stats(stock);
      const mosClass = mos >= 0 ? "up" : "down";
      const compared = state.compare.some((item) => sameStock(item, stock));
      return `
        <tr class="stock-row ${selected}" data-symbol="${stock.symbol}" data-market="${stock.market}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <td>
            <input type="checkbox" class="compare-check" data-compare="${stockKey(stock)}" ${compared ? "checked" : ""} aria-label="加入对比" />
          </td>
          <td>
            <div class="stock-id">
              <strong>${escapeHtml(stock.name)}</strong>
              <span>${stock.symbol} · ${escapeHtml(stock.englishName)}</span>
            </div>
          </td>
          <td>${marketLabel(stock.market)}</td>
          <td>${escapeHtml(stock.industry)}</td>
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
    row.addEventListener("click", (event) => {
      if (event.target.closest(".compare-check")) return;
      activate();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });

  document.querySelectorAll(".compare-check").forEach((input) => {
    input.addEventListener("change", () => {
      const [market, symbol] = input.dataset.compare.split(":");
      const stock = provider.stocks.find((item) => item.market === market && item.symbol === symbol);
      if (!stock) return;
      if (input.checked) {
        if (state.compare.length >= 4) {
          input.checked = false;
          return;
        }
        if (!state.compare.some((item) => sameStock(item, stock))) state.compare.push(stock);
      } else {
        state.compare = state.compare.filter((item) => !sameStock(item, stock));
      }
      renderCompare();
    });
  });
}

function selectStock(stock, { openDetail = false, updateHash = true } = {}) {
  if (!stock) {
    state.selected = null;
    if (els.stockDetail) {
      els.stockDetail.innerHTML = `<div class="empty-state">没有匹配的股票。请调整搜索或筛选条件。</div>`;
    }
    return;
  }
  state.selected = stock;
  els.selectedStockSummary.textContent = `${stock.name} · ${formatMarginOfSafety(marginOfSafety(stock))} · ${valuationLabel(stock.valuation.state)}${stock.quote.as_of ? ` · ${stock.quote.as_of}` : ""}`;
  if (els.detailCrumb) {
    els.detailCrumb.textContent = `${stock.name} ${stock.symbol} · ${marketLabel(stock.market)} · ${stock.industry}`;
  }
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
  if (!els.template || !els.stockDetail) return;
  const fragment = els.template.content.cloneNode(true);
  const root = fragment.querySelector(".report-card");
  const latest = latestFinancial(stock);
  const hasFinancials = Boolean(latest);
  const watchKey = stockKey(stock);
  const watched = Boolean(state.watchlist[watchKey]);
  const note = state.notes[watchKey] || {};
  const holding = state.holdings[watchKey];

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

  root.querySelector(".js-positives").innerHTML = (stock.analysis.positives.length ? stock.analysis.positives : ["暂无自动提取的积极因素。"])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  root.querySelector(".js-risks").innerHTML = stock.analysis.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  root.querySelector(".js-assumptions").innerHTML = stock.valuation.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  root.querySelector(".js-sources").innerHTML = sourceItems(stock)
    .map((source) => `<li><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>：${escapeHtml(source.role)}</li>`)
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
    : `<p class="muted">需财报数据后展示评分拆解。</p>`;

  paintEvents(root, stock.events || []);

  const thesis = root.querySelector(".js-thesis");
  const decision = root.querySelector(".js-decision");
  const noteStatus = root.querySelector(".js-note-status");
  thesis.value = note.thesis || "";
  decision.value = note.decision || "watch";
  root.querySelector(".js-save-note").addEventListener("click", () => {
    state.notes[watchKey] = {
      thesis: thesis.value.trim(),
      decision: decision.value,
      updatedAt: new Date().toISOString(),
    };
    persistWorkspace();
    noteStatus.textContent = "已保存";
    pushDecisionLog(stock, decision.value);
  });

  const watchButton = root.querySelector(".js-watch");
  watchButton.textContent = watched ? "已加入自选" : "加入自选";
  watchButton.classList.toggle("active", watched);
  watchButton.addEventListener("click", () => toggleWatch(stock));

  root.querySelectorAll(".js-range").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === state.priceRange);
    button.addEventListener("click", () => {
      state.priceRange = button.dataset.range;
      paintDetail(stock);
    });
  });

  const legend = root.querySelector(".js-price-legend");
  const markers = [];
  const saved = state.watchlist[watchKey];
  if (saved?.buy) markers.push({ label: "买入关注", value: saved.buy, color: "var(--accent-strong)" });
  if (saved?.add) markers.push({ label: "加仓", value: saved.add, color: "var(--blue)" });
  if (saved?.takeProfit) markers.push({ label: "止盈", value: saved.takeProfit, color: "var(--warn)" });
  if (saved?.stopLoss) markers.push({ label: "止损", value: saved.stopLoss, color: "var(--danger)" });
  if (holding?.cost) markers.push({ label: "成本", value: holding.cost, color: "var(--ink)" });
  markers.push({ label: "合理下沿", value: stock.valuation.fair_zone[0], color: "var(--accent-ink)" });
  legend.textContent = markers.map((item) => `${item.label} ${money(item.value, stock.currency)}`).join(" · ");

  els.stockDetail.replaceChildren(fragment);
  if (hasFinancials) {
    els.stockDetail.querySelectorAll(".js-chart").forEach((canvas) => {
      drawMetricChart(canvas, stock.financials, canvas.dataset.metric);
    });
  }
  const priceCanvas = els.stockDetail.querySelector(".js-price-chart");
  loadAndDrawPriceChart(priceCanvas, stock, markers);
  renderWatchlist();
}

async function loadAndDrawPriceChart(canvas, stock, markers) {
  if (!canvas) return;
  const payload = await provider.getHistory(stock.symbol, stock.market, state.priceRange);
  if (state.selected && !sameStock(state.selected, stock)) return;
  drawPriceChart(canvas, payload.points || [], markers, stock.currency, payload.error);
}

function drawPriceChart(canvas, points, markers, currency, error) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const colors = themeChartColors();
  ctx.clearRect(0, 0, width, height);
  if (!points.length) {
    ctx.fillStyle = colors.label;
    ctx.font = "14px system-ui";
    ctx.fillText(error ? `走势暂不可用：${error}` : "暂无历史价格", 24, height / 2);
    return;
  }
  const pad = 28;
  const values = points.map((point) => point.close);
  const min = Math.min(...values, ...markers.map((item) => item.value).filter(Boolean)) * 0.98;
  const max = Math.max(...values, ...markers.map((item) => item.value).filter(Boolean)) * 1.02;
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

  markers.forEach((marker) => {
    if (!marker.value) return;
    const y = height - pad - ((marker.value - min) / range) * (height - pad * 2);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(marker.color.replace("var(", "").replace(")", "")).trim() || colors.label;
    // fallback: use muted dashed
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = colors.label;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = colors.label;
    ctx.font = "11px system-ui";
    ctx.fillText(`${marker.label} ${Number(marker.value).toFixed(2)}`, pad + 4, y - 4);
  });

  const chartPoints = values.map((value, index) => {
    const x = pad + ((width - pad * 2) / Math.max(values.length - 1, 1)) * index;
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return [x, y];
  });

  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  chartPoints.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = colors.label;
  ctx.font = "11px system-ui";
  ctx.fillText(points[0].date, pad, height - 8);
  ctx.fillText(points[points.length - 1].date, width - pad - 70, height - 8);
  ctx.fillText(money(values[values.length - 1], currency), width - pad - 90, pad + 4);
}

function renderWatchlist() {
  if (!els.watchlistRows) return;
  let items = Object.values(state.watchlist)
    .map((saved) => {
      const stock = provider.stocks.find((item) => item.symbol === saved.symbol && item.market === saved.market);
      return stock ? { stock, saved } : null;
    })
    .filter(Boolean);

  if (state.watchGroupFilter !== "all") {
    items = items.filter(({ saved }) => (saved.group || "watch") === state.watchGroupFilter);
  }
  if (state.watchAlertFilter === "hit") {
    items = items.filter(({ stock, saved }) => watchAlertLevel(stock, saved) === "hit");
  } else if (state.watchAlertFilter === "near") {
    items = items.filter(({ stock, saved }) => ["hit", "near"].includes(watchAlertLevel(stock, saved)));
  }

  items.sort((a, b) => {
    const rank = { hit: 0, near: 1, calm: 2 };
    const diff = rank[watchAlertLevel(a.stock, a.saved)] - rank[watchAlertLevel(b.stock, b.saved)];
    if (diff !== 0) return diff;
    return (b.stock.quote.change_pct || 0) - (a.stock.quote.change_pct || 0);
  });

  if (!Object.keys(state.watchlist).length) {
    els.watchlistRows.innerHTML = "";
    if (els.watchlistEmpty) els.watchlistEmpty.hidden = false;
    return;
  }
  if (els.watchlistEmpty) els.watchlistEmpty.hidden = true;
  if (!items.length) {
    els.watchlistRows.innerHTML = `<tr><td colspan="10"><div class="empty-state">当前筛选下没有自选。</div></td></tr>`;
    return;
  }

  els.watchlistRows.innerHTML = items
    .map(({ stock, saved }) => {
      const level = watchAlertLevel(stock, saved);
      const alert = watchAlertText(stock, saved);
      return `
        <tr class="watch-row ${level === "hit" ? "hit" : ""}" data-key="${stockKey(stock)}">
          <td>
            <button class="linkish" data-open="${stockKey(stock)}" type="button">
              <strong>${escapeHtml(stock.name)}</strong>
              <span class="muted">${stock.symbol} · ${marketLabel(stock.market)}</span>
            </button>
          </td>
          <td>
            <select data-group="${stockKey(stock)}">
              ${Object.entries(GROUP_LABELS)
                .map(([value, label]) => `<option value="${value}" ${ (saved.group || "watch") === value ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </td>
          <td class="num">${money(stock.quote.price, stock.currency)}</td>
          <td class="num ${stock.quote.change_pct >= 0 ? "up" : "down"}">${signed(stock.quote.change_pct)}%</td>
          <td class="num"><input data-field="buy" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.buy ?? ""}" /></td>
          <td class="num"><input data-field="add" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.add ?? ""}" /></td>
          <td class="num"><input data-field="takeProfit" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.takeProfit ?? ""}" /></td>
          <td class="num"><input data-field="stopLoss" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.stopLoss ?? ""}" /></td>
          <td><span class="tag ${level}">${escapeHtml(alert)}</span></td>
          <td><button class="ghost-button compact" data-remove="${stockKey(stock)}" type="button">移除</button></td>
        </tr>
      `;
    })
    .join("");

  els.watchlistRows.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
  els.watchlistRows.querySelectorAll("[data-group]").forEach((select) => {
    select.addEventListener("change", () => {
      state.watchlist[select.dataset.group].group = select.value;
      saveWatchlist();
      renderWatchlist();
      renderWorkbench();
    });
  });
  els.watchlistRows.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const field = input.dataset.field;
      const value = input.value === "" ? null : Number(input.value);
      state.watchlist[key][field] = value;
      if (field === "buy") state.watchlist[key].targetPrice = value;
      saveWatchlist();
      renderWatchlist();
      renderWorkbench();
      evaluateAlerts({ notify: state.prefs.notify });
    });
  });
  els.watchlistRows.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.watchlist[button.dataset.remove];
      saveWatchlist();
      renderWatchlist();
      renderWorkbench();
      renderDetail();
    });
  });
}

function renderHoldings() {
  if (!els.holdingsRows) return;
  const base = state.prefs.baseCurrency || "CNY";
  const rows = Object.values(state.holdings)
    .map((holding) => {
      const stock = provider.stocks.find((item) => item.symbol === holding.symbol && item.market === holding.market);
      if (!stock) return null;
      const marketValue = holding.shares * stock.quote.price;
      const costValue = holding.shares * holding.cost;
      const pnl = marketValue - costValue;
      const pnlPct = costValue ? (pnl / costValue) * 100 : 0;
      const marketValueBase = toBase(marketValue, stock.currency, base);
      const fair = stock.valuation.base_price;
      const vsFair = fair ? ((stock.quote.price - fair) / fair) * 100 : null;
      return { stock, holding, marketValue, costValue, pnl, pnlPct, marketValueBase, vsFair };
    })
    .filter(Boolean);

  const totalBase = rows.reduce((sum, row) => sum + row.marketValueBase, 0);
  const totalPnlBase = rows.reduce((sum, row) => sum + toBase(row.pnl, row.stock.currency, base), 0);

  if (els.holdingsMetrics) {
    els.holdingsMetrics.innerHTML = [
      ["持仓市值", money(totalBase, base)],
      ["浮盈亏", `${money(totalPnlBase, base)}`],
      ["持仓只数", `${rows.length}`],
      ["本位币", base],
    ]
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

  if (!Object.keys(state.holdings).length) {
    els.holdingsRows.innerHTML = "";
    if (els.holdingsEmpty) els.holdingsEmpty.hidden = false;
    return;
  }
  if (els.holdingsEmpty) els.holdingsEmpty.hidden = true;
  if (!rows.length) {
    els.holdingsRows.innerHTML = `<tr><td colspan="9"><div class="empty-state">持仓标的暂无行情，请确认代码或网络。</div></td></tr>`;
    return;
  }

  els.holdingsRows.innerHTML = rows
    .map(({ stock, holding, marketValue, pnl, pnlPct, marketValueBase, vsFair }) => {
      const weight = totalBase ? (marketValueBase / totalBase) * 100 : 0;
      return `
        <tr>
          <td>
            <button class="linkish" data-open="${stockKey(stock)}" type="button">
              <strong>${escapeHtml(stock.name)}</strong>
              <span class="muted">${stock.symbol} · ${marketLabel(stock.market)}</span>
            </button>
          </td>
          <td class="num"><input data-holding-field="shares" data-key="${stockKey(stock)}" type="number" step="any" value="${holding.shares}" /></td>
          <td class="num"><input data-holding-field="cost" data-key="${stockKey(stock)}" type="number" step="any" value="${holding.cost}" /></td>
          <td class="num">${money(stock.quote.price, stock.currency)}</td>
          <td class="num">${money(marketValue, stock.currency)}</td>
          <td class="num ${pnl >= 0 ? "up" : "down"}">${money(pnl, stock.currency)} (${signed(pnlPct)}%)</td>
          <td class="num">${weight.toFixed(1)}%</td>
          <td class="num ${vsFair == null ? "" : vsFair <= 0 ? "up" : "down"}">${vsFair == null ? "—" : `${signed(vsFair)}%`}</td>
          <td><button class="ghost-button compact" data-remove-holding="${stockKey(stock)}" type="button">删除</button></td>
        </tr>
      `;
    })
    .join("");

  els.holdingsRows.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
  els.holdingsRows.querySelectorAll("[data-holding-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      const field = input.dataset.holdingField;
      state.holdings[key][field] = Number(input.value);
      persistWorkspace();
      renderHoldings();
      renderWorkbench();
    });
  });
  els.holdingsRows.querySelectorAll("[data-remove-holding]").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.holdings[button.dataset.removeHolding];
      persistWorkspace();
      renderHoldings();
      renderWorkbench();
    });
  });
}

function renderWorkbench() {
  if (!els.workbenchMetrics) return;
  const watchCount = Object.keys(state.watchlist).length;
  const hitCount = Object.values(state.watchlist).filter((saved) => {
    const stock = findStock(saved.symbol, saved.market);
    return stock && watchAlertLevel(stock, saved) === "hit";
  }).length;
  const earningsSoon = Object.values(state.watchlist)
    .map((saved) => findStock(saved.symbol, saved.market))
    .filter((stock) => stock?.quote.earnings_date && daysUntil(stock.quote.earnings_date) >= 0 && daysUntil(stock.quote.earnings_date) <= 14)
    .length;
  const holdingCount = Object.keys(state.holdings).length;
  const base = state.prefs.baseCurrency || "CNY";
  const holdingValue = Object.values(state.holdings).reduce((sum, holding) => {
    const stock = findStock(holding.symbol, holding.market);
    if (!stock) return sum;
    return sum + toBase(holding.shares * stock.quote.price, stock.currency, base);
  }, 0);

  els.workbenchMetrics.innerHTML = [
    ["自选", `${watchCount} 只`],
    ["已触及", `${hitCount} 条`],
    ["近两周财报", `${earningsSoon} 只`],
    ["持仓市值", money(holdingValue, base)],
  ]
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");

  const moves = Object.values(state.watchlist)
    .map((saved) => {
      const stock = findStock(saved.symbol, saved.market);
      return stock ? { stock, saved } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.stock.quote.change_pct || 0) - Math.abs(a.stock.quote.change_pct || 0))
    .slice(0, 6);

  els.workbenchWatchMoves.innerHTML = moves.length
    ? moves
        .map(
          ({ stock }) => `
            <button class="stack-item" data-open="${stockKey(stock)}" type="button">
              <div>
                <strong>${escapeHtml(stock.name)}</strong>
                <span class="muted">${stock.symbol}</span>
              </div>
              <strong class="${stock.quote.change_pct >= 0 ? "up" : "down"}">${signed(stock.quote.change_pct)}%</strong>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state compact">自选为空。去研究池或自选页添加标的。</div>`;

  const alerts = collectActiveAlerts().slice(0, 8);
  els.workbenchAlerts.innerHTML = alerts.length
    ? alerts
        .map(
          (alert) => `
            <button class="stack-item" data-open="${alert.key}" type="button">
              <div>
                <strong>${escapeHtml(alert.title)}</strong>
                <span class="muted">${escapeHtml(alert.detail)}</span>
              </div>
              <span class="tag ${alert.level}">${alert.level === "hit" ? "触及" : "临近"}</span>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state compact">暂无待办提醒。</div>`;

  const earnings = Object.values(state.watchlist)
    .map((saved) => findStock(saved.symbol, saved.market))
    .filter((stock) => stock?.quote.earnings_date && daysUntil(stock.quote.earnings_date) >= 0 && daysUntil(stock.quote.earnings_date) <= 45)
    .sort((a, b) => daysUntil(a.quote.earnings_date) - daysUntil(b.quote.earnings_date))
    .slice(0, 6);

  els.workbenchEarnings.innerHTML = earnings.length
    ? earnings
        .map((stock) => {
          const days = daysUntil(stock.quote.earnings_date);
          return `
            <button class="stack-item" data-open="${stockKey(stock)}" type="button">
              <div>
                <strong>${escapeHtml(stock.name)}</strong>
                <span class="muted">${stock.quote.earnings_date}</span>
              </div>
              <span class="muted">${days === 0 ? "今天" : `${days} 天后`}</span>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state compact">自选中暂无近期财报。</div>`;

  const holdings = Object.values(state.holdings)
    .map((holding) => {
      const stock = findStock(holding.symbol, holding.market);
      if (!stock) return null;
      const pnl = holding.shares * (stock.quote.price - holding.cost);
      return { stock, holding, pnl };
    })
    .filter(Boolean)
    .slice(0, 6);

  els.workbenchHoldings.innerHTML = holdings.length
    ? holdings
        .map(
          ({ stock, pnl }) => `
            <button class="stack-item" data-open="${stockKey(stock)}" type="button">
              <div>
                <strong>${escapeHtml(stock.name)}</strong>
                <span class="muted">${money(stock.quote.price, stock.currency)}</span>
              </div>
              <strong class="${pnl >= 0 ? "up" : "down"}">${money(pnl, stock.currency)}</strong>
            </button>
          `,
        )
        .join("")
    : `<div class="empty-state compact">尚未录入持仓。</div>`;

  els.alertHistory.innerHTML = state.alertHistory.length
    ? state.alertHistory
        .slice(0, 12)
        .map(
          (item) => `
            <div class="stack-item static">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span class="muted">${escapeHtml(item.detail)}</span>
              </div>
              <span class="muted">${new Date(item.at).toLocaleString("zh-CN")}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state compact">暂无提醒历史。</div>`;

  document.querySelectorAll("#workbenchView [data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
}

function renderCompare() {
  if (!els.compareBar || !els.compareTable) return;
  if (!state.compare.length) {
    els.compareBar.textContent = "勾选研究池中的股票加入对比（最多 4 只）。";
    els.compareTable.innerHTML = "";
    return;
  }
  els.compareBar.innerHTML = state.compare
    .map((stock) => `<span class="tag">${escapeHtml(stock.name)} ${stock.symbol}</span>`)
    .join(" ");
  const rows = [
    ["价格", (s) => money(s.quote.price, s.currency)],
    ["涨跌", (s) => `${signed(s.quote.change_pct)}%`],
    ["PE", (s) => (s.quote.pe ? s.quote.pe.toFixed(1) : "—")],
    ["PB", (s) => (s.quote.pb ? s.quote.pb.toFixed(2) : "—")],
    ["安全边际", (s) => formatMarginOfSafety(marginOfSafety(s))],
    ["估值", (s) => valuationLabel(s.valuation.state)],
    ["评分", (s) => `${s.analysis.score}`],
    ["行业", (s) => s.industry],
  ];
  els.compareTable.innerHTML = `
    <table class="stock-table compare-table">
      <thead>
        <tr>
          <th>指标</th>
          ${state.compare.map((stock) => `<th>${escapeHtml(stock.name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            ([label, getter]) => `
              <tr>
                <td>${label}</td>
                ${state.compare.map((stock) => `<td>${escapeHtml(String(getter(stock)))}</td>`).join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function switchView(view) {
  if (view === "dashboard") view = "workbench";
  state.activeView = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  if (els.pageTitle) els.pageTitle.textContent = PAGE_TITLES[view] || "StockAgent";
  document.querySelector(`#${view}View`)?.scrollIntoView({ block: "start" });
  if (view === "settings") renderSettings();
  if (view === "workbench") renderWorkbench();
  if (view === "watchlist") renderWatchlist();
  if (view === "holdings") renderHoldings();
  if (view === "research") {
    renderRows();
    renderCompare();
  }
  if (view !== "detail" && location.hash.startsWith("#/stock/")) {
    history.replaceState(null, "", location.pathname);
  }
}

function showDetail(stock, { updateHash = true } = {}) {
  state.activeView = "detail";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === "detailView"));
  if (els.pageTitle) els.pageTitle.textContent = PAGE_TITLES.detail;
  if (updateHash) {
    history.pushState(null, "", `#/stock/${stock.market}/${encodeURIComponent(stock.symbol)}`);
  }
}

function showDashboard({ clearHash = false } = {}) {
  switchView("workbench");
  if (clearHash) history.pushState(null, "", location.pathname);
}

async function restoreRoute() {
  const match = location.hash.match(/^#\/stock\/(A|HK|US)\/([^/]+)$/i);
  if (!match) return;
  const market = match[1].toUpperCase();
  const symbol = decodeURIComponent(match[2]).toUpperCase();
  const stock = await provider.getStock(symbol, market);
  if (stock) selectStock(stock, { openDetail: true, updateHash: false });
}

function syncMarketShortcuts() {
  els.marketShortcuts.forEach((button) => {
    button.classList.toggle("active", button.dataset.marketShortcut === state.market);
  });
}

function renderSourceStatus() {
  const label = provider.status.quoteLabel || "行情连接中";
  els.topSourceStatus.textContent = label;
  document.body.dataset.quoteStatus = provider.status.quote || "connecting";
}

function toggleWatch(stock) {
  const key = stockKey(stock);
  if (state.watchlist[key]) {
    delete state.watchlist[key];
  } else {
    state.watchlist[key] = {
      symbol: stock.symbol,
      market: stock.market,
      group: "watch",
      buy: stock.valuation.watch_zone[1],
      add: stock.valuation.watch_zone[0],
      takeProfit: stock.valuation.bull_price,
      stopLoss: stock.valuation.bear_price,
      targetPrice: stock.valuation.watch_zone[1],
      createdAt: new Date().toISOString(),
    };
  }
  saveWatchlist();
  renderDetail();
  renderWatchlist();
  renderWorkbench();
}

async function addSymbolToWatchlist(market, rawSymbol) {
  if (!els.addSymbolStatus) return;
  els.addSymbolStatus.textContent = "查询中…";
  const symbol = normalizeClientSymbol(rawSymbol, market);
  const stock = await provider.ensureStock(symbol, market);
  if (!stock) {
    els.addSymbolStatus.textContent = "未找到行情，请检查代码与市场。";
    return;
  }
  const key = stockKey(stock);
  if (!state.watchlist[key]) {
    state.watchlist[key] = {
      symbol: stock.symbol,
      market: stock.market,
      group: "watch",
      buy: stock.valuation.watch_zone[1],
      add: stock.valuation.watch_zone[0],
      takeProfit: stock.valuation.bull_price,
      stopLoss: stock.valuation.bear_price,
      targetPrice: stock.valuation.watch_zone[1],
      createdAt: new Date().toISOString(),
    };
    saveWatchlist();
  }
  els.addSymbol.value = "";
  els.addSymbolStatus.textContent = `已加入 ${stock.name}`;
  renderWatchlist();
  renderWorkbench();
  evaluateAlerts({ notify: false });
}

async function upsertHolding({ market, symbol, shares, cost }) {
  if (!els.holdingFormStatus) return;
  els.holdingFormStatus.textContent = "保存中…";
  const normalized = normalizeClientSymbol(symbol, market);
  const stock = await provider.ensureStock(normalized, market);
  if (!stock) {
    els.holdingFormStatus.textContent = "未找到行情，无法保存持仓。";
    return;
  }
  const key = stockKey(stock);
  state.holdings[key] = {
    symbol: stock.symbol,
    market: stock.market,
    shares,
    cost,
    updatedAt: new Date().toISOString(),
  };
  if (!state.watchlist[key]) {
    state.watchlist[key] = {
      symbol: stock.symbol,
      market: stock.market,
      group: "core",
      buy: stock.valuation.watch_zone[1],
      add: stock.valuation.watch_zone[0],
      takeProfit: stock.valuation.bull_price,
      stopLoss: stock.valuation.bear_price,
      targetPrice: stock.valuation.watch_zone[1],
      createdAt: new Date().toISOString(),
    };
  }
  persistWorkspace();
  els.holdingSymbol.value = "";
  els.holdingShares.value = "";
  els.holdingCost.value = "";
  els.holdingFormStatus.textContent = `已保存 ${stock.name}`;
  renderHoldings();
  renderWatchlist();
  renderWorkbench();
}

function collectActiveAlerts() {
  const alerts = [];
  Object.values(state.watchlist).forEach((saved) => {
    const stock = findStock(saved.symbol, saved.market);
    if (!stock) return;
    const level = watchAlertLevel(stock, saved);
    if (level === "hit" || level === "near") {
      alerts.push({
        key: stockKey(stock),
        title: stock.name,
        detail: watchAlertText(stock, saved),
        level,
      });
    }
    if (stock.quote.earnings_date) {
      const days = daysUntil(stock.quote.earnings_date);
      if (days >= 0 && days <= 7) {
        alerts.push({
          key: stockKey(stock),
          title: `${stock.name} 财报`,
          detail: days === 0 ? "今天披露" : `${days} 天后披露`,
          level: days <= 2 ? "hit" : "near",
        });
      }
    }
  });
  return alerts;
}

function evaluateAlerts({ notify = false } = {}) {
  const active = collectActiveAlerts();
  active.forEach((alert) => {
    const signature = `${alert.key}:${alert.detail}`;
    const exists = state.alertHistory.some((item) => item.signature === signature && Date.now() - new Date(item.at).getTime() < 12 * 3600 * 1000);
    if (exists) return;
    state.alertHistory.unshift({
      ...alert,
      signature,
      at: new Date().toISOString(),
    });
    if (notify && state.prefs.notify && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(alert.title, { body: alert.detail });
      } catch {
        /* ignore */
      }
    }
  });
  state.alertHistory = state.alertHistory.slice(0, 50);
  persistWorkspace();
}

function pushDecisionLog(stock, decision) {
  state.alertHistory.unshift({
    key: stockKey(stock),
    title: `${stock.name} 决策`,
    detail: DECISION_LABELS[decision] || decision,
    level: "near",
    signature: `decision:${stockKey(stock)}:${decision}:${Date.now()}`,
    at: new Date().toISOString(),
  });
  state.alertHistory = state.alertHistory.slice(0, 50);
  persistWorkspace();
  renderWorkbench();
}

function exportSelectedMarkdown() {
  const stock = state.selected;
  if (!stock) return;
  const note = state.notes[stockKey(stock)] || {};
  const holding = state.holdings[stockKey(stock)];
  const lines = [
    `# ${stock.name} (${stock.symbol})`,
    "",
    `- 市场：${marketLabel(stock.market)}`,
    `- 行业：${stock.industry}`,
    `- 现价：${money(stock.quote.price, stock.currency)}`,
    `- 估值：${valuationLabel(stock.valuation.state)}`,
    `- 安全边际：${formatMarginOfSafety(marginOfSafety(stock))}`,
    `- 评分：${stock.analysis.score}/100`,
    "",
    "## 摘要",
    stock.analysis.summary,
    "",
    "## 积极因素",
    ...(stock.analysis.positives.map((item) => `- ${item}`) || ["- 无"]),
    "",
    "## 风险因素",
    ...stock.analysis.risks.map((item) => `- ${item}`),
    "",
    "## 估值区间",
    `- 保守：${money(stock.valuation.bear_price, stock.currency)}`,
    `- 基准：${money(stock.valuation.base_price, stock.currency)}`,
    `- 乐观：${money(stock.valuation.bull_price, stock.currency)}`,
    "",
    "## 笔记",
    note.thesis || "（空）",
    "",
    `- 决策：${DECISION_LABELS[note.decision] || "观望"}`,
  ];
  if (holding) {
    lines.push("", "## 持仓", `- 数量：${holding.shares}`, `- 成本：${money(holding.cost, stock.currency)}`);
  }
  lines.push("", "> 仅供研究参考，不构成投资建议。");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${stock.market}-${stock.symbol}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
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
    summary: `${stock.name} 当前模型判断为「${valuationLabel(valuation.state)}」。仅基于行情与估值模型，尚未接入财报明细。${stock.quote.as_of ? `行情更新 ${stock.quote.as_of}。` : ""}`,
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
  const normalizedEps = Math.max(eps || 0, 0.18);
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
  let stateName = "fair";
  if (price <= fairLow) stateName = "undervalued";
  if (price > fairHigh && price <= risk) stateName = "expensive";
  if (price > risk) stateName = "risk";

  return {
    method,
    bear_price: bear,
    base_price: round(base, 2),
    bull_price: bull,
    watch_zone: [bear, fairLow],
    fair_zone: [fairLow, fairHigh],
    expensive_zone: [fairHigh, risk],
    risk_price: risk,
    state: stateName,
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
    score >= 78 ? "基本面与估值较有吸引力" : score >= 64 ? "可跟踪，等待更好买点" : score >= 50 ? "中性观察" : "风险偏高，谨慎";

  return {
    score,
    rating_label: label,
    summary: `${name}（${industry}）综合评分 ${score}。模型判断为「${valuationLabel(valuation.state)}」。`,
    positives,
    negatives: [],
    risks,
    data_quality: "财报+行情",
    generated_at: new Date().toISOString(),
    breakdown: {
      基本面: clamp(Math.round(roe * 2 + margin * 0.6 + revenueGrowth), 0, 100),
      估值: valuation.state === "undervalued" ? 82 : valuation.state === "fair" ? 68 : valuation.state === "expensive" ? 45 : 28,
      质量: clamp(Math.round(cashQuality), 0, 100),
      风险: clamp(Math.round(100 - debtRatio), 0, 100),
    },
  };
}

function resolveTheme(stored) {
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initSidebar() {
  const stored = localStorage.getItem(SIDEBAR_KEY);
  applySidebar(stored === "collapsed" ? "collapsed" : "expanded", { persist: false });
  syncSidebarForViewport();
}

function toggleSidebar() {
  const next = document.documentElement.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
  applySidebar(next);
}

function syncSidebarForViewport() {
  if (window.innerWidth <= SIDEBAR_COLLAPSE_MIN - 1) {
    applySidebar("expanded", { persist: false });
  } else {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "collapsed") applySidebar("collapsed", { persist: false });
  }
}

function applySidebar(next, { persist = true } = {}) {
  if (next === "collapsed") document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  if (persist) localStorage.setItem(SIDEBAR_KEY, next);
  if (els.sidebarToggle) {
    els.sidebarToggle.setAttribute("aria-expanded", next !== "collapsed" ? "true" : "false");
    els.sidebarToggle.setAttribute("aria-label", next === "collapsed" ? "展开侧边栏" : "收起侧边栏");
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
    els.themeToggle.setAttribute("aria-label", theme === "dark" ? "切换到明亮模式" : "切换到暗黑模式");
    const icon = els.themeToggle.querySelector(".theme-icon");
    if (icon) icon.textContent = theme === "dark" ? "☀" : "☾";
  }
  if (state.selected) renderDetail();
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
    const x = pad + ((width - pad * 2) / Math.max(values.length - 1, 1)) * index;
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
    ctx.fillText(String(financials[index].period).replace("202", "'2"), x - 16, height - 6);
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
      title: "预计财报",
      url: null,
      status: eventStatus(stock.quote.earnings_date),
    });
  }
  if (stock.quote.ex_dividend_date) {
    events.push({
      date: stock.quote.ex_dividend_date,
      kind: "dividend",
      title: "除息日",
      url: null,
      status: eventStatus(stock.quote.ex_dividend_date),
    });
  }
  return events;
}

function marketDisclosureLinks(stock) {
  return marketSources(stock.market).map((source) => ({
    date: null,
    kind: "source",
    title: source.name,
    url: source.url,
    status: "link",
  }));
}

function sortEvents(events) {
  const dated = events.filter((event) => event.date);
  const links = events.filter((event) => !event.date);
  const upcoming = dated.filter((event) => daysUntil(event.date) >= 0).sort((a, b) => daysUntil(a.date) - daysUntil(b.date));
  const past = dated.filter((event) => daysUntil(event.date) < 0).sort((a, b) => daysUntil(b.date) - daysUntil(a.date));
  return { upcoming: [...upcoming, ...links], past };
}

function paintEvents(root, events) {
  const bucket = events && !Array.isArray(events) ? events : sortEvents(events || []);
  const upcoming = bucket.upcoming || [];
  const past = bucket.past || [];
  const upcomingList = root.querySelector(".js-events-upcoming");
  const pastList = root.querySelector(".js-events-past");
  upcomingList.innerHTML = upcoming.length ? upcoming.map(renderEventItem).join("") : `<li class="event-empty muted">暂无即将到来的事件。</li>`;
  pastList.innerHTML = past.length ? past.map(renderEventItem).join("") : `<li class="event-empty muted">暂无近期披露。</li>`;
}

function renderEventItem(event) {
  const badge = eventKindLabel(event.kind);
  const body = event.url
    ? `<a href="${event.url}" target="_blank" rel="noreferrer">${escapeHtml(event.title)}</a>`
    : `<strong>${escapeHtml(event.title)}</strong>`;
  return `
    <li class="event-item">
      <span class="event-badge">${badge}</span>
      <div class="event-copy">
        ${body}
        <span class="muted">${event.date || "外部入口"} ${event.date ? `· ${formatDaysLabel(event.date)}` : ""}</span>
      </div>
    </li>
  `;
}

function formatNextEarnings(date) {
  if (!date) return "";
  const days = daysUntil(date);
  if (days == null) return "";
  return `<p class="watch-earnings muted">财报 ${date} · ${days === 0 ? "今天" : days > 0 ? `${days} 天后` : `${Math.abs(days)} 天前`}</p>`;
}

function eventKindLabel(kind) {
  return { earnings: "财报", dividend: "分红", filing: "披露", source: "来源" }[kind] || "事件";
}

function eventStatus(date) {
  const days = daysUntil(date);
  if (days == null) return "unknown";
  return days >= 0 ? "upcoming" : "past";
}

function formatDaysLabel(date) {
  const days = daysUntil(date);
  if (days == null) return "";
  if (days === 0) return "今天";
  if (days > 0) return `${days} 天后`;
  return `${Math.abs(days)} 天前`;
}

function daysUntil(date) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
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

function markerPosition(stock) {
  const min = stock.valuation.bear_price;
  const max = stock.valuation.risk_price;
  return clamp(((stock.quote.price - min) / (max - min)) * 100, 1, 99);
}

function watchAlertLevel(stock, saved) {
  const price = stock.quote.price;
  if (saved.stopLoss && price <= saved.stopLoss) return "hit";
  if (saved.buy && price <= saved.buy) return "hit";
  if (saved.takeProfit && price >= saved.takeProfit) return "hit";
  if (saved.buy && price <= saved.buy * 1.03) return "near";
  if (saved.takeProfit && price >= saved.takeProfit * 0.97) return "near";
  if (saved.stopLoss && price <= saved.stopLoss * 1.03) return "near";
  return "calm";
}

function watchAlertText(stock, saved) {
  const price = stock.quote.price;
  if (saved.stopLoss && price <= saved.stopLoss) return "触及止损";
  if (saved.buy && price <= saved.buy) return "触及买入关注";
  if (saved.takeProfit && price >= saved.takeProfit) return "触及止盈";
  if (saved.buy && price <= saved.buy * 1.03) return `接近买入 ${distanceToTarget(price, saved.buy)}`;
  if (saved.takeProfit && price >= saved.takeProfit * 0.97) return "接近止盈";
  return "跟踪中";
}

function distanceToTarget(price, targetPrice) {
  if (!targetPrice) return "—";
  const gap = ((price - targetPrice) / targetPrice) * 100;
  if (gap <= 0) return `${Math.abs(gap).toFixed(1)}% 以内`;
  return `+${gap.toFixed(1)}%`;
}

function stockKey(stock) {
  return `${stock.market}:${stock.symbol}`;
}

function sameStock(a, b) {
  return a.symbol === b.symbol && a.market === b.market;
}

function findStock(symbol, market) {
  return provider.stocks.find((item) => item.symbol === symbol && item.market === market);
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
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${CURRENCY[currency] || ""}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signed(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
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

function toBase(amount, fromCurrency, baseCurrency) {
  const from = FX_TO_CNY[fromCurrency] || 1;
  const to = FX_TO_CNY[baseCurrency] || 1;
  return (amount * from) / to;
}

function normalizeClientSymbol(symbol, market) {
  const raw = String(symbol || "").trim().toUpperCase();
  if (market === "HK") {
    const digits = raw.replace(/\D/g, "");
    return digits.padStart(4, "0");
  }
  if (market === "A") {
    const digits = raw.replace(/\D/g, "");
    return digits.padStart(6, "0");
  }
  return raw.replace("/", ".");
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function migrateWatchlist(raw) {
  const next = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    if (!value || !value.symbol || !value.market) return;
    next[key] = {
      symbol: value.symbol,
      market: value.market,
      group: value.group || "watch",
      buy: value.buy ?? value.targetPrice ?? null,
      add: value.add ?? null,
      takeProfit: value.takeProfit ?? null,
      stopLoss: value.stopLoss ?? null,
      targetPrice: value.targetPrice ?? value.buy ?? null,
      createdAt: value.createdAt || new Date().toISOString(),
    };
  });
  return next;
}

function emptyWorkspaceBundle() {
  return {
    version: 1,
    updated_at: null,
    watchlist: {},
    holdings: {},
    notes: {},
    alertHistory: [],
    prefs: { notify: false, baseCurrency: "CNY" },
    customSymbols: [],
  };
}

function workspaceHasUserData(bundle) {
  if (!bundle) return false;
  return Boolean(
    Object.keys(bundle.watchlist || {}).length ||
      Object.keys(bundle.holdings || {}).length ||
      Object.keys(bundle.notes || {}).length ||
      (bundle.alertHistory || []).length ||
      (bundle.customSymbols || []).length,
  );
}

function readLegacyWorkspaceBundle() {
  return {
    version: 1,
    updated_at: null,
    watchlist: migrateWatchlist(loadJSON(WATCHLIST_KEY, {})),
    holdings: loadJSON(HOLDINGS_KEY, {}),
    notes: loadJSON(NOTES_KEY, {}),
    alertHistory: loadJSON(ALERTS_KEY, []),
    prefs: {
      notify: Boolean(loadJSON(PREFS_KEY, { notify: false }).notify),
      baseCurrency: loadJSON(PREFS_KEY, { baseCurrency: "CNY" }).baseCurrency || "CNY",
    },
    customSymbols: loadJSON(CUSTOM_KEY, []),
  };
}

function readLocalWorkspaceBundle() {
  const cached = loadJSON(WORKSPACE_CACHE_KEY, null);
  if (cached && typeof cached === "object") {
    return {
      ...emptyWorkspaceBundle(),
      ...cached,
      watchlist: migrateWatchlist(cached.watchlist || {}),
      prefs: {
        notify: Boolean(cached.prefs?.notify),
        baseCurrency: cached.prefs?.baseCurrency || "CNY",
      },
      customSymbols: Array.isArray(cached.customSymbols) ? cached.customSymbols : [],
    };
  }
  return readLegacyWorkspaceBundle();
}

function buildWorkspacePayload() {
  return {
    version: 1,
    updated_at: state.workspaceSync.updatedAt || new Date().toISOString(),
    watchlist: state.watchlist,
    holdings: state.holdings,
    notes: state.notes,
    alertHistory: state.alertHistory.slice(0, 100),
    prefs: {
      notify: Boolean(state.prefs.notify),
      baseCurrency: state.prefs.baseCurrency || "CNY",
    },
    customSymbols: (provider.customCatalog || []).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      englishName: item.englishName,
      market: item.market,
      exchange: item.exchange,
      currency: item.currency,
      industry: item.industry || "自定义",
    })),
  };
}

function writeLocalWorkspaceCache(bundle = buildWorkspacePayload()) {
  saveJSON(WORKSPACE_CACHE_KEY, bundle);
  // Keep legacy keys in sync for older tabs / rollback.
  saveJSON(WATCHLIST_KEY, bundle.watchlist || {});
  saveJSON(HOLDINGS_KEY, bundle.holdings || {});
  saveJSON(NOTES_KEY, bundle.notes || {});
  saveJSON(ALERTS_KEY, bundle.alertHistory || []);
  saveJSON(PREFS_KEY, bundle.prefs || { notify: false, baseCurrency: "CNY" });
  saveJSON(CUSTOM_KEY, bundle.customSymbols || []);
}

function applyLocalWorkspace(bundle, { source = "local", markDirty = false } = {}) {
  const normalized = {
    ...emptyWorkspaceBundle(),
    ...(bundle || {}),
    watchlist: migrateWatchlist(bundle?.watchlist || {}),
    holdings: bundle?.holdings || {},
    notes: bundle?.notes || {},
    alertHistory: Array.isArray(bundle?.alertHistory) ? bundle.alertHistory : [],
    prefs: {
      notify: Boolean(bundle?.prefs?.notify),
      baseCurrency: bundle?.prefs?.baseCurrency || "CNY",
    },
    customSymbols: Array.isArray(bundle?.customSymbols) ? bundle.customSymbols : [],
  };

  state.watchlist = normalized.watchlist;
  state.holdings = normalized.holdings;
  state.notes = normalized.notes;
  state.alertHistory = normalized.alertHistory;
  state.prefs = normalized.prefs;
  state.workspaceSync.updatedAt = normalized.updated_at;
  state.workspaceSync.source = source;
  state.workspaceSync.error = null;
  state.workspaceSync.status = markDirty ? "pending" : "synced";

  provider.customCatalog = normalized.customSymbols.map((item, index) => ({
    ...item,
    listing_status: "listed",
    sortIndex: 1000 + index,
    custom: true,
  }));

  writeLocalWorkspaceCache(normalized);
  renderWorkspaceStatus();
  return normalized;
}

async function hydrateWorkspace() {
  state.workspaceSync.status = "loading";
  renderWorkspaceStatus();
  const localBundle = readLocalWorkspaceBundle();

  try {
    const response = await fetch("/api/workspace");
    if (!response.ok) throw new Error(`Workspace API ${response.status}`);
    const remote = await response.json();
    const remoteHasData = workspaceHasUserData(remote);
    const localHasData = workspaceHasUserData(localBundle);

    if (!remoteHasData && localHasData) {
      applyLocalWorkspace(localBundle, { source: "migrated-local", markDirty: false });
      state.workspaceSync.status = "syncing";
      renderWorkspaceStatus();
      await flushWorkspaceToServer();
      return;
    }

    applyLocalWorkspace(remoteHasData ? remote : localBundle, {
      source: remoteHasData ? "server" : "local-empty",
      markDirty: false,
    });
    state.workspaceSync.status = "synced";
    renderWorkspaceStatus();
  } catch (error) {
    console.warn("工作区同步失败，使用本地缓存。", error);
    applyLocalWorkspace(localBundle, { source: "local-offline", markDirty: false });
    state.workspaceSync.status = "offline";
    state.workspaceSync.error = error.message || String(error);
    renderWorkspaceStatus();
  }
}

function persistWorkspace({ immediate = false } = {}) {
  writeLocalWorkspaceCache();
  state.workspaceSync.status = "pending";
  state.workspaceSync.error = null;
  renderWorkspaceStatus();

  if (immediate) {
    if (workspaceSaveTimer) {
      clearTimeout(workspaceSaveTimer);
      workspaceSaveTimer = null;
    }
    return flushWorkspaceToServer();
  }

  if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = setTimeout(() => {
    workspaceSaveTimer = null;
    flushWorkspaceToServer();
  }, WORKSPACE_SYNC_DEBOUNCE_MS);
}

async function flushWorkspaceToServer() {
  if (workspaceSaveInFlight) return workspaceSaveInFlight;

  const payload = buildWorkspacePayload();
  state.workspaceSync.status = "syncing";
  renderWorkspaceStatus();

  workspaceSaveInFlight = (async () => {
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || `保存失败 ${response.status}`);
      state.workspaceSync.updatedAt = saved.updated_at || new Date().toISOString();
      state.workspaceSync.status = "synced";
      state.workspaceSync.source = "server";
      state.workspaceSync.error = null;
      writeLocalWorkspaceCache({
        ...payload,
        updated_at: state.workspaceSync.updatedAt,
      });
    } catch (error) {
      console.warn("工作区写入服务器失败。", error);
      state.workspaceSync.status = "error";
      state.workspaceSync.error = error.message || String(error);
    } finally {
      workspaceSaveInFlight = null;
      renderWorkspaceStatus();
    }
  })();

  return workspaceSaveInFlight;
}

function renderWorkspaceStatus() {
  if (!els.workspaceStatus) return;
  const { status, updatedAt, error, source } = state.workspaceSync;
  const timeLabel = updatedAt ? ` · ${updatedAt}` : "";
  const labels = {
    idle: "尚未同步",
    loading: "正在加载工作区…",
    pending: "有未同步更改，稍后写入服务器",
    syncing: "正在写入 workspace.json…",
    synced: `已同步到服务器${timeLabel}`,
    offline: `离线模式，使用本地缓存${timeLabel}`,
    error: `同步失败：${error || "未知错误"}（本地已保存）`,
  };
  els.workspaceStatus.textContent = `${labels[status] || labels.idle}${source ? ` · 来源 ${source}` : ""}`;
  els.workspaceStatus.dataset.status = status;
}

function exportWorkspaceBackup() {
  const payload = buildWorkspacePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stockagent-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importWorkspaceBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    applyLocalWorkspace(payload, { source: "import", markDirty: false });
    await persistWorkspace({ immediate: true });
    provider.quoteHydrated = false;
    provider.quoteHydration = null;
    await refreshStocks();
    renderWorkbench();
    renderWatchlist();
    renderHoldings();
    if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
    if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
    renderWorkspaceStatus();
  } catch (error) {
    state.workspaceSync.status = "error";
    state.workspaceSync.error = error.message || String(error);
    renderWorkspaceStatus();
  } finally {
    event.target.value = "";
  }
}

function saveWatchlist() {
  persistWorkspace();
}

function savePrefs() {
  persistWorkspace();
}

function loadCustomSymbols() {
  const cached = readLocalWorkspaceBundle();
  return Array.isArray(cached.customSymbols) ? cached.customSymbols : [];
}

function saveCustomSymbols(list) {
  provider.customCatalog = list.map((item, index) => ({
    ...item,
    listing_status: "listed",
    sortIndex: 1000 + index,
    custom: true,
  }));
  persistWorkspace();
}
