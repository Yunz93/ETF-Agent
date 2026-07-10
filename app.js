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

const PAGE_SIZE = 50;
const QUOTE_BATCH_SIZE = 200;
const RESEARCH_INDICES = [
  { code: "000001", name: "上证指数", market: "A" },
  { code: "399106", name: "深证综指", market: "A" },
  { code: "HSI", name: "恒生指数", market: "HK" },
  { code: "SPX", name: "标普500", market: "US" },
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
  constructor() {
    this.catalogByIndex = {};
    this.stocksByIndex = {};
    this.catalogLoaded = {};
    this.quoteProgress = {};
    this.catalogHydration = {};
    this.quoteHydration = {};
    this.catalogMeta = {};
    this.customCatalog = loadCustomSymbols().map((item, index) => ({
      ...item,
      listing_status: "listed",
      sortIndex: 1000 + index,
      custom: true,
    }));
    this.stocks = [];
    this.historyCache = new Map();
    this.status = {
      quote: "connecting",
      quoteLabel: "行情连接中",
      filing: "等待 SEC 数据",
    };
  }

  indexKey(indexCode) {
    return String(indexCode || "").toUpperCase();
  }

  indexMeta(indexCode) {
    const code = this.indexKey(indexCode);
    return RESEARCH_INDICES.find((item) => item.code === code) || null;
  }

  allCatalog() {
    const base = Object.values(this.catalogByIndex).flat();
    const seen = new Set(base.map(stockKey));
    return [...base, ...this.customCatalog.filter((item) => !seen.has(stockKey(item)))];
  }

  rebuildStocks() {
    const byKey = new Map();
    for (const stocks of Object.values(this.stocksByIndex)) {
      for (const stock of stocks || []) {
        byKey.set(stockKey(stock), stock);
      }
    }
    for (const stock of this.stocks) {
      if (stock.custom) byKey.set(stockKey(stock), stock);
    }
    this.stocks = [...byKey.values()];
  }

  async hydrateCatalog(indexCode) {
    const key = this.indexKey(indexCode);
    const meta = this.indexMeta(key);
    if (!meta) return [];
    if (this.catalogLoaded[key]) return this.catalogByIndex[key] || [];
    if (this.catalogHydration[key]) return this.catalogHydration[key];
    this.catalogHydration[key] = fetch(
      `/api/catalog?market=${encodeURIComponent(meta.market)}&index=${encodeURIComponent(key)}`,
    )
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog API ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const stocks = (payload.stocks || []).map((entry, index) => buildCatalogStockFromApi(entry, index));
        this.catalogByIndex[key] = stocks;
        this.catalogMeta[key] = {
          count: payload.count || stocks.length,
          market: meta.market,
          index: key,
          index_name: payload.index_name || meta.name,
          indices: payload.indices || [],
          errors: payload.errors || [],
          updated_at: payload.updated_at,
          note: payload.note,
        };
        this.catalogLoaded[key] = true;
        return stocks;
      })
      .catch((error) => {
        console.warn("成分股目录获取失败。", error);
        this.catalogByIndex[key] = [];
        this.catalogMeta[key] = {
          count: 0,
          market: meta.market,
          index: key,
          index_name: meta.name,
          indices: [],
          errors: [String(error.message || error)],
        };
        this.catalogLoaded[key] = true;
        return [];
      })
      .finally(() => {
        this.catalogHydration[key] = null;
      });
    return this.catalogHydration[key];
  }

  quoteState(indexCode) {
    const key = this.indexKey(indexCode);
    return (
      this.quoteProgress[key] || {
        loaded: 0,
        total: 0,
        hasMore: false,
        nextOffset: 0,
        loading: false,
        error: null,
        provider: null,
      }
    );
  }

  async hydrateQuotes(indexCode, { reset = false, more = false } = {}) {
    const key = this.indexKey(indexCode);
    const meta = this.indexMeta(key);
    if (!meta) return [];
    await this.hydrateCatalog(key);
    const catalog = this.catalogByIndex[key] || [];
    const progress = this.quoteState(key);

    if (!reset && !more && (this.stocksByIndex[key] || []).length) {
      this.rebuildStocks();
      return this.stocksByIndex[key];
    }
    if (this.quoteHydration[key]) return this.quoteHydration[key];

    const offset = reset ? 0 : more ? progress.nextOffset || (this.stocksByIndex[key] || []).length : 0;
    if (!reset && more && progress.hasMore === false && (this.stocksByIndex[key] || []).length) {
      return this.stocksByIndex[key];
    }

    this.status.quote = "connecting";
    this.status.quoteLabel = `${meta.name}行情加载中`;
    this.quoteProgress[key] = {
      ...progress,
      loading: true,
      error: null,
      total: catalog.length,
    };

    this.quoteHydration[key] = fetch(
      `/api/quotes?market=${encodeURIComponent(meta.market)}&index=${encodeURIComponent(key)}&limit=${QUOTE_BATCH_SIZE}&offset=${offset}`,
    )
      .then((response) => {
        if (!response.ok) throw new Error(`Quote API ${response.status}`);
        return response.json();
      })
      .then(async (payload) => {
        const quotes = new Map((payload.quotes || []).map((quote) => [`${quote.market}:${quote.symbol}`, quote]));
        const batchEntries = catalog.slice(offset, offset + QUOTE_BATCH_SIZE);
        const batchStocks = batchEntries
          .map((entry) => buildStockFromQuote(entry, quotes.get(stockKey(entry))))
          .filter(Boolean);

        const existing = reset ? [] : [...(this.stocksByIndex[key] || [])];
        const byKey = new Map(existing.map((stock) => [stockKey(stock), stock]));
        for (const stock of batchStocks) byKey.set(stockKey(stock), stock);

        // Ensure custom symbols for this market are present once.
        for (const entry of this.customCatalog.filter((item) => item.market === meta.market)) {
          if (byKey.has(stockKey(entry))) continue;
          if (quotes.has(stockKey(entry))) {
            const stock = buildStockFromQuote(entry, quotes.get(stockKey(entry)));
            if (stock) byKey.set(stockKey(stock), stock);
            continue;
          }
          if (reset || offset === 0) {
            const fetched = await this.fetchCustomQuote(entry.symbol, entry.market);
            if (fetched) byKey.set(stockKey(fetched), fetched);
          }
        }

        this.stocksByIndex[key] = [...byKey.values()];
        this.rebuildStocks();
        const loaded = this.stocksByIndex[key].length;
        const total = payload.total ?? catalog.length;
        const nextOffset = payload.next_offset;
        this.quoteProgress[key] = {
          loaded,
          total,
          hasMore: Boolean(payload.has_more),
          nextOffset: nextOffset == null ? loaded : nextOffset,
          loading: false,
          error: payload.error || null,
          provider: payload.provider || null,
        };
        this.status.quote = loaded ? "live" : "unavailable";
        this.status.quoteLabel = loaded
          ? `${payload.provider || "真实行情"} · ${loaded}/${total} · ${meta.name}`
          : payload.error
            ? `行情不可用 · ${payload.error}`
            : "暂无行情数据";
        return this.stocksByIndex[key];
      })
      .catch((error) => {
        console.warn("行情获取失败。", error);
        if (reset) this.stocksByIndex[key] = [];
        this.rebuildStocks();
        this.quoteProgress[key] = {
          loaded: (this.stocksByIndex[key] || []).length,
          total: catalog.length,
          hasMore: false,
          nextOffset: (this.stocksByIndex[key] || []).length,
          loading: false,
          error: String(error.message || error),
          provider: null,
        };
        this.status.quote = "unavailable";
        this.status.quoteLabel = "行情不可用";
        return this.stocksByIndex[key] || [];
      })
      .finally(() => {
        this.quoteHydration[key] = null;
      });
    return this.quoteHydration[key];
  }

  invalidateQuotes() {
    this.quoteProgress = {};
    this.quoteHydration = {};
    this.stocksByIndex = {};
    this.stocks = this.stocks.filter((stock) => stock.custom);
  }

  invalidateAll() {
    this.catalogLoaded = {};
    this.catalogHydration = {};
    this.catalogByIndex = {};
    this.catalogMeta = {};
    this.invalidateQuotes();
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
    // Prefer single-quote path for detail/watchlist; avoid forcing full index hydrate.
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
    if (this.allCatalog().some((item) => stockKey(item) === key && !item.custom)) return;
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
    const indexCode = filters.index || state.index || RESEARCH_INDICES[0].code;
    await this.hydrateQuotes(indexCode, { reset: false });
    return this.filterStocks(filters, indexCode);
  }

  async getStock(symbol, market) {
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

  filterStocks({ query = "", industry = "all", valuation = "all", index = null } = {}, activeIndex = null) {
    const term = query.trim().toLowerCase();
    const indexCode = this.indexKey(index || activeIndex || state.index || RESEARCH_INDICES[0].code);
    const pool = this.stocksByIndex[indexCode] || [];
    return pool.filter((stock) => {
      const matchesTerm =
        !term ||
        [stock.symbol, stock.name, stock.englishName, stock.industry, ...(stock.indices || [])]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesIndustry = industry === "all" || stock.industry === industry;
      const matchesValuation = valuation === "all" || stock.valuation.state === valuation;
      return matchesTerm && matchesIndustry && matchesValuation;
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
      for (const pool of Object.values(this.stocksByIndex)) {
        const marketIndex = (pool || []).findIndex((item) => sameStock(item, stock));
        if (marketIndex >= 0) {
          pool[marketIndex] = { ...pool[marketIndex], ...enriched, financials: payload.financials };
        }
      }
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

const provider = new HybridProvider();
const state = {
  selected: null,
  filtered: [],
  page: 1,
  pageSize: PAGE_SIZE,
  watchlist: {},
  holdings: {},
  notes: {},
  alertHistory: [],
  prefs: {
    notify: false,
    baseCurrency: "CNY",
    compactMode: false,
    coreOnlyWorkbench: false,
    showWatchTargets: false,
  },
  compare: [],
  activeView: "workbench",
  market: "A",
  index: RESEARCH_INDICES[0].code,
  priceRange: "1y",
  aiRange: "1y",
  aiReports: {},
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
  listPager: document.querySelector("#listPager"),
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
  workbenchChanged: document.querySelector("#workbenchChanged"),
  workbenchEarnings: document.querySelector("#workbenchEarnings"),
  workbenchReviews: document.querySelector("#workbenchReviews"),
  workbenchHoldings: document.querySelector("#workbenchHoldings"),
  alertHistory: document.querySelector("#alertHistory"),
  clearAlertHistory: document.querySelector("#clearAlertHistory"),
  enableNotify: document.querySelector("#enableNotify"),
  compareBar: document.querySelector("#compareBar"),
  compareTable: document.querySelector("#compareTable"),
  clearCompare: document.querySelector("#clearCompare"),
  comparePeers: document.querySelector("#comparePeers"),
  watchShowTargets: document.querySelector("#watchShowTargets"),
  prefCompact: document.querySelector("#prefCompact"),
  prefCoreOnly: document.querySelector("#prefCoreOnly"),
  researchEmptyHint: document.querySelector("#researchEmptyHint"),
  exportMarkdown: document.querySelector("#exportMarkdown"),
  printReport: document.querySelector("#printReport"),
  prefNotify: document.querySelector("#prefNotify"),
  indexSegment: document.querySelector("#indexSegment"),
  researchLoadStatus: document.querySelector("#researchLoadStatus"),
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
  syncPrefControls();
  await loadAppConfig();
  await hydrateWorkspace();
  syncPrefControls();
  applyWorkbenchPrefs();
  bindEvents();
  renderIndexSegment();
  await refreshStocks({ resetQuotes: true });
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
        batch_size: 80,
      },
      sec: { enabled: true, user_agent: "StockAgent/0.1 personal-local contact@example.com" },
      ai: {
        enabled: true,
        provider: "deepseek",
        provider_name: "DeepSeek",
        base_url: "https://api.deepseek.com",
        model: "deepseek-chat",
        api_key: "",
        has_api_key: false,
        temperature: 0.3,
        max_tokens: 2800,
        timeout_seconds: 90,
        note: "支持 DeepSeek / OpenAI 兼容接口；API Key 仅保存在本地 config.json",
      },
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

const AI_PROVIDER_PRESETS = {
  deepseek: {
    provider_name: "DeepSeek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    docs_url: "https://platform.deepseek.com/api_keys",
    note: "官方 OpenAI 兼容接口，推荐默认",
    needs_api_key: true,
  },
  openai: {
    provider_name: "OpenAI",
    base_url: "https://api.openai.com",
    model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
    docs_url: "https://platform.openai.com/api-keys",
    note: "官方 Chat Completions",
    needs_api_key: true,
  },
  moonshot: {
    provider_name: "Moonshot / Kimi",
    base_url: "https://api.moonshot.cn",
    model: "moonshot-v1-auto",
    models: ["moonshot-v1-auto", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
    docs_url: "https://platform.moonshot.cn/console/api-keys",
    note: "月之暗面 Kimi，OpenAI 兼容",
    needs_api_key: true,
  },
  qwen: {
    provider_name: "通义千问 / DashScope",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long"],
    docs_url: "https://bailian.console.aliyun.com/",
    note: "阿里云百炼兼容模式",
    needs_api_key: true,
  },
  zhipu: {
    provider_name: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas",
    model: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4.5-flash"],
    docs_url: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "BigModel OpenAI 兼容（/v4）",
    needs_api_key: true,
  },
  siliconflow: {
    provider_name: "SiliconFlow 硅基流动",
    base_url: "https://api.siliconflow.cn",
    model: "deepseek-ai/DeepSeek-V3",
    models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct", "THUDM/glm-4-9b-chat"],
    docs_url: "https://cloud.siliconflow.cn/account/ak",
    note: "聚合多家开源模型的 Token 服务",
    needs_api_key: true,
  },
  openrouter: {
    provider_name: "OpenRouter",
    base_url: "https://openrouter.ai/api",
    model: "deepseek/deepseek-chat",
    models: ["deepseek/deepseek-chat", "deepseek/deepseek-r1", "openai/gpt-4o-mini", "google/gemini-2.0-flash-001", "anthropic/claude-3.5-sonnet"],
    docs_url: "https://openrouter.ai/keys",
    note: "统一路由多家模型",
    needs_api_key: true,
  },
  groq: {
    provider_name: "Groq",
    base_url: "https://api.groq.com/openai",
    model: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
    docs_url: "https://console.groq.com/keys",
    note: "高速推理，OpenAI 兼容",
    needs_api_key: true,
  },
  ollama: {
    provider_name: "Ollama 本地",
    base_url: "http://127.0.0.1:11434",
    model: "llama3.1",
    models: ["llama3.1", "qwen2.5", "deepseek-r1", "mistral"],
    docs_url: "https://ollama.com/",
    note: "本机 Ollama，通常无需 API Key",
    needs_api_key: false,
  },
  custom: {
    provider_name: "自定义 OpenAI 兼容",
    base_url: "",
    model: "",
    models: [],
    docs_url: "",
    note: "任意兼容 /v1/chat/completions 的 Token 服务",
    needs_api_key: true,
  },
};

function renderSettings() {
  if (!els.settingsForm || !appConfig) return;

  const groups = [
    { key: "QUOTE", label: "行情" },
    { key: "A", label: "A 股公告" },
    { key: "HK", label: "港股公告" },
    { key: "US", label: "美股财报" },
  ];

  const ai = appConfig.ai || {};
  const aiProvider = ai.provider || "deepseek";
  const preset = AI_PROVIDER_PRESETS[aiProvider] || AI_PROVIDER_PRESETS.custom;
  const modelOptions = uniqueStrings([...(preset.models || []), ai.model].filter(Boolean));
  els.settingsForm.innerHTML = `
    <section class="config-group ai-console">
      <div class="ai-console-heading">
        <div>
          <h3>模型 API 接口配置</h3>
          <p class="muted settings-hint">支持 DeepSeek 等主流 Token 服务（OpenAI 兼容）。密钥仅保存在本地 config.json，页面只显示掩码。</p>
        </div>
        <div class="ai-console-actions">
          <button class="ghost-button compact js-ai-test" type="button">测试连接</button>
          ${preset.docs_url ? `<a class="ghost-button compact" href="${escapeAttr(preset.docs_url)}" target="_blank" rel="noreferrer">获取 Key</a>` : ""}
        </div>
      </div>
      <div class="ai-provider-grid" role="radiogroup" aria-label="Token 服务">
        ${Object.entries(AI_PROVIDER_PRESETS)
          .map(
            ([id, item]) => `
              <button type="button" class="ai-provider-chip ${aiProvider === id ? "active" : ""}" data-ai-provider="${id}">
                <strong>${escapeHtml(item.provider_name)}</strong>
                <span>${escapeHtml(item.note || "")}</span>
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="config-grid">
        <label class="config-check">
          <input data-config="ai.enabled" type="checkbox" ${ai.enabled !== false ? "checked" : ""} />
          <span>启用 AI 分析</span>
        </label>
        <label>
          <span>提供方</span>
          <select data-config="ai.provider" class="js-ai-provider">
            ${Object.entries(AI_PROVIDER_PRESETS)
              .map(
                ([id, item]) =>
                  `<option value="${id}" ${aiProvider === id ? "selected" : ""}>${escapeHtml(item.provider_name)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          <span>显示名称</span>
          <input data-config="ai.provider_name" type="text" value="${escapeAttr(ai.provider_name || preset.provider_name || "")}" />
        </label>
        <label class="config-wide">
          <span>API Base URL</span>
          <input data-config="ai.base_url" type="url" value="${escapeAttr(ai.base_url || "")}" placeholder="${escapeAttr(preset.base_url || "https://api.deepseek.com")}" />
        </label>
        <label>
          <span>模型</span>
          <input data-config="ai.model" class="js-ai-model" list="ai-model-options" type="text" value="${escapeAttr(ai.model || "")}" placeholder="${escapeAttr(preset.model || "deepseek-chat")}" />
          <datalist id="ai-model-options">
            ${modelOptions.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}
          </datalist>
        </label>
        <label>
          <span>API Key / Token ${ai.has_api_key ? "（已配置）" : preset.needs_api_key === false ? "（可选）" : ""}</span>
          <input data-config="ai.api_key" type="password" value="${escapeAttr(ai.api_key || "")}" placeholder="${ai.has_api_key ? "留空则保持已保存密钥" : "sk-..."}" autocomplete="off" />
        </label>
        <label>
          <span>温度</span>
          <input data-config="ai.temperature" type="number" min="0" max="2" step="0.1" value="${escapeAttr(ai.temperature ?? 0.3)}" />
        </label>
        <label>
          <span>最大 tokens</span>
          <input data-config="ai.max_tokens" type="number" min="256" max="8192" step="1" value="${escapeAttr(ai.max_tokens ?? 2800)}" />
        </label>
        <label>
          <span>超时（秒）</span>
          <input data-config="ai.timeout_seconds" type="number" min="15" max="180" step="1" value="${escapeAttr(ai.timeout_seconds ?? 90)}" />
        </label>
        <p class="muted ai-endpoint-hint js-ai-endpoint-hint config-wide"></p>
      </div>
      <p class="settings-status muted js-ai-test-status" role="status"></p>
    </section>
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
          <input data-config="quotes.batch_size" type="number" min="5" max="120" value="${escapeAttr(appConfig.quotes?.batch_size ?? 80)}" />
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

  bindAiConsoleControls();
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function chatCompletionsEndpoint(baseUrl, provider) {
  const root = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!root) return "";
  if (root.endsWith("/chat/completions")) return root;
  if (provider === "zhipu") return `${root}/v4/chat/completions`;
  if (root.endsWith("/v1")) return `${root}/chat/completions`;
  return `${root}/v1/chat/completions`;
}

function bindAiConsoleControls() {
  if (!els.settingsForm) return;
  const providerSelect = els.settingsForm.querySelector(".js-ai-provider");
  const baseUrlInput = els.settingsForm.querySelector('[data-config="ai.base_url"]');
  const modelInput = els.settingsForm.querySelector(".js-ai-model");
  const nameInput = els.settingsForm.querySelector('[data-config="ai.provider_name"]');
  const modelList = els.settingsForm.querySelector("#ai-model-options");
  const hint = els.settingsForm.querySelector(".js-ai-endpoint-hint");
  const testStatus = els.settingsForm.querySelector(".js-ai-test-status");
  const docsLink = els.settingsForm.querySelector(".ai-console-actions a");

  const applyProvider = (providerId, { fillFields = true } = {}) => {
    const preset = AI_PROVIDER_PRESETS[providerId] || AI_PROVIDER_PRESETS.custom;
    if (providerSelect) providerSelect.value = providerId;
    els.settingsForm.querySelectorAll("[data-ai-provider]").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.aiProvider === providerId);
    });
    if (fillFields) {
      if (nameInput) nameInput.value = preset.provider_name || "";
      if (baseUrlInput && preset.base_url) baseUrlInput.value = preset.base_url;
      if (modelInput && preset.model) modelInput.value = preset.model;
    }
    if (modelList) {
      const models = uniqueStrings([...(preset.models || []), modelInput?.value].filter(Boolean));
      modelList.innerHTML = models.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("");
    }
    if (docsLink) {
      if (preset.docs_url) {
        docsLink.hidden = false;
        docsLink.href = preset.docs_url;
      } else {
        docsLink.hidden = true;
      }
    }
    updateEndpointHint();
  };

  const updateEndpointHint = () => {
    if (!hint) return;
    const provider = providerSelect?.value || "deepseek";
    const endpoint = chatCompletionsEndpoint(baseUrlInput?.value || "", provider);
    const preset = AI_PROVIDER_PRESETS[provider] || AI_PROVIDER_PRESETS.custom;
    hint.textContent = endpoint
      ? `实际请求：POST ${endpoint}${preset.needs_api_key === false ? " · API Key 可选" : ""}`
      : "请填写 API Base URL（例如 https://api.deepseek.com）";
  };

  providerSelect?.addEventListener("change", () => applyProvider(providerSelect.value, { fillFields: true }));
  baseUrlInput?.addEventListener("input", updateEndpointHint);
  els.settingsForm.querySelectorAll("[data-ai-provider]").forEach((chip) => {
    chip.addEventListener("click", () => applyProvider(chip.dataset.aiProvider, { fillFields: true }));
  });
  els.settingsForm.querySelector(".js-ai-test")?.addEventListener("click", () => testAiConnection(testStatus));
  applyProvider(providerSelect?.value || "deepseek", { fillFields: false });
}

async function testAiConnection(statusEl) {
  if (!els.settingsForm) return;
  const payload = readSettingsForm().ai || {};
  if (statusEl) statusEl.textContent = "正在测试模型接口…";
  try {
    const response = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `测试失败 ${response.status}`);
    }
    if (statusEl) {
      statusEl.textContent = `${data.message || "连接成功"} · ${data.provider_name || data.provider || ""} / ${data.model || ""}`;
    }
    if (els.settingsStatus) {
      els.settingsStatus.textContent = "模型接口测试通过（记得保存配置）";
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || "测试失败";
    if (els.settingsStatus) els.settingsStatus.textContent = error.message || "测试失败";
  }
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
    provider.invalidateAll();
    await refreshStocks({ resetQuotes: true });
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
    el?.addEventListener("input", () => {
      state.page = 1;
      refreshStocks();
    });
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
    await addSymbolsToWatchlist(els.addMarket.value, els.addSymbol.value);
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

  els.prefCompact?.addEventListener("change", () => {
    state.prefs.compactMode = els.prefCompact.checked;
    savePrefs();
    applyWorkbenchPrefs();
    renderWorkbench();
  });

  els.prefCoreOnly?.addEventListener("change", () => {
    state.prefs.coreOnlyWorkbench = els.prefCoreOnly.checked;
    savePrefs();
    renderWorkbench();
  });

  els.watchShowTargets?.addEventListener("change", () => {
    state.prefs.showWatchTargets = els.watchShowTargets.checked;
    savePrefs();
    renderWatchlist();
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

  els.clearAlertHistory?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
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

  els.comparePeers?.addEventListener("click", () => {
    compareIndustryPeers();
  });

  els.exportMarkdown?.addEventListener("click", exportSelectedMarkdown);
  els.printReport?.addEventListener("click", () => window.print());

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.sidebarToggle?.addEventListener("click", toggleSidebar);
  window.addEventListener("resize", syncSidebarForViewport);
  els.saveConfig?.addEventListener("click", saveAppConfig);
  els.resetConfig?.addEventListener("click", () => loadAppConfig({ rerender: true }));
  // Index controls are bound in renderIndexSegment().
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
      const href = link.getAttribute("href");
      const target = document.querySelector(href);
      if (href === "#detail-more") {
        const details = document.querySelector("#detail-more");
        if (details) details.open = true;
      }
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

function renderIndexSegment() {
  if (!els.indexSegment) return;
  els.indexSegment.innerHTML = RESEARCH_INDICES.map(
    (item) => `
      <button class="segment-button ${state.index === item.code ? "active" : ""}" data-index="${item.code}" type="button">
        ${item.name}
      </button>
    `,
  ).join("");
  els.indexSegment.querySelectorAll("[data-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.index === button.dataset.index) return;
      state.index = button.dataset.index;
      state.market = provider.indexMeta(state.index)?.market || state.market;
      state.page = 1;
      renderIndexSegment();
      await refreshStocks({ resetQuotes: true });
    });
  });
}

function renderResearchLoadStatus() {
  if (!els.researchLoadStatus) return;
  const progress = provider.quoteState(state.index);
  const meta = provider.catalogMeta[state.index] || provider.indexMeta(state.index) || {};
  const name = meta.index_name || meta.name || state.index;
  const loaded = progress.loaded || 0;
  const total = progress.total || meta.count || 0;
  els.researchLoadStatus.classList.toggle("is-loading", Boolean(progress.loading));
  if (progress.loading) {
    els.researchLoadStatus.innerHTML = `${name}加载中… 已获取 ${loaded}/${total || "?"} 只行情`;
    return;
  }
  if (progress.error && !loaded) {
    els.researchLoadStatus.textContent = `${name}行情不可用：${progress.error}`;
    return;
  }
  const moreButton = progress.hasMore
    ? `<span class="research-load-actions"><button class="ghost-button compact" id="loadMoreQuotes" type="button">继续加载下一批</button></span>`
    : "";
  els.researchLoadStatus.innerHTML = `${name} · 行情 ${loaded}/${total}${progress.provider ? ` · ${progress.provider}` : ""}${moreButton}`;
  els.researchLoadStatus.querySelector("#loadMoreQuotes")?.addEventListener("click", async () => {
    await refreshStocks({ loadMore: true });
  });
}

async function refreshStocks({ resetQuotes = false, loadMore = false } = {}) {
  renderIndexSegment();
  if (resetQuotes) {
    await provider.hydrateQuotes(state.index, { reset: true });
  } else if (loadMore) {
    await provider.hydrateQuotes(state.index, { more: true });
  }
  state.filtered = await provider.search({
    query: els.searchInput?.value || "",
    index: state.index,
    industry: els.industryFilter?.value || "all",
    valuation: els.valuationFilter?.value || "all",
  });
  state.filtered.sort((a, b) => marginOfSafety(b) - marginOfSafety(a));
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize) || 1);
  if (state.page > totalPages) state.page = totalPages;
  fillIndustryFilter();
  renderSourceStatus();
  renderMetrics();
  renderResearchLoadStatus();
  renderUpcoming();
  renderRows();
  renderPager();
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
  const current = els.industryFilter.value || "all";
  const pool = provider.stocksByIndex[state.index] || [];
  const industries = [...new Set(pool.map((stock) => stock.industry).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN"),
  );
  els.industryFilter.innerHTML = `<option value="all">全部行业</option>`;
  industries.forEach((industry) => {
    const option = document.createElement("option");
    option.value = industry;
    option.textContent = industry;
    els.industryFilter.append(option);
  });
  els.industryFilter.value = industries.includes(current) ? current : "all";
}

function renderMetrics() {
  if (!els.marketMetrics) return;
  const total = state.filtered.length;
  const undervalued = state.filtered.filter((stock) => stock.valuation.state === "undervalued").length;
  const highRisk = state.filtered.filter((stock) => stock.valuation.state === "risk" || stock.analysis.risks.length >= 3).length;
  const progress = provider.quoteState(state.index);
  const catalogCount = provider.catalogMeta[state.index]?.count || progress.total || total;
  const metrics = [
    ["指数成分", `${catalogCount} 只`],
    ["已加载行情", `${progress.loaded || 0} 只`],
    ["当前筛选", `${total} 只`],
    ["低估 / 风险", `${undervalued} / ${highRisk}`],
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

function pagedStocks() {
  const start = (state.page - 1) * state.pageSize;
  return state.filtered.slice(start, start + state.pageSize);
}

function renderPager() {
  if (!els.listPager) return;
  const total = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize) || 1);
  if (!total) {
    els.listPager.hidden = true;
    els.listPager.innerHTML = "";
    return;
  }
  els.listPager.hidden = false;
  const startIdx = (state.page - 1) * state.pageSize + 1;
  const endIdx = Math.min(total, state.page * state.pageSize);
  els.listPager.innerHTML = `
    <button type="button" class="ghost-button compact" data-page-action="prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
    <span class="pager-status">第 ${state.page}/${totalPages} 页 · 显示 ${startIdx}-${endIdx} / ${total}</span>
    <button type="button" class="ghost-button compact" data-page-action="next" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>
  `;
  els.listPager.querySelectorAll("[data-page-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.pageAction === "prev" && state.page > 1) state.page -= 1;
      if (button.dataset.pageAction === "next" && state.page < totalPages) state.page += 1;
      renderRows();
      renderPager();
    });
  });
}

function renderRows() {
  if (!els.stockRows) return;
  if (els.researchEmptyHint) {
    els.researchEmptyHint.hidden = Boolean(state.filtered.length || state.compare.length);
  }
  if (!state.filtered.length) {
    els.stockRows.innerHTML = `<tr><td colspan="10"><div class="empty-state">暂无行情数据。请运行 python3 server.py 并确认网络可用。</div></td></tr>`;
    renderPager();
    return;
  }
  const rows = pagedStocks();
  els.stockRows.innerHTML = rows
    .map((stock) => {
      const selected = state.selected && sameStock(stock, state.selected) ? "active" : "";
      const mos = marginOfSafety(stock);
      const w52 = week52Stats(stock);
      const mosClass = mos >= 0 ? "up" : "down";
      const compared = state.compare.some((item) => sameStock(item, stock));
      const indexText = (stock.indices || []).join(" / ");
      return `
        <tr class="stock-row ${selected}" data-symbol="${stock.symbol}" data-market="${stock.market}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
          <td>
            <input type="checkbox" class="compare-check" data-compare="${stockKey(stock)}" ${compared ? "checked" : ""} aria-label="加入对比" />
          </td>
          <td>
            <div class="stock-id">
              <strong>${escapeHtml(stock.name)}</strong>
              <span>${stock.symbol} · ${escapeHtml(stock.englishName)}${indexText ? ` · ${escapeHtml(indexText)}` : ""}</span>
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
  const peerEl = root.querySelector(".js-peer");
  peerEl.innerHTML = "";
  if (peer) {
    peerEl.hidden = false;
    peerEl.append(document.createTextNode(peer + " "));
    const peerBtn = document.createElement("button");
    peerBtn.type = "button";
    peerBtn.className = "ghost-button compact js-compare-peers";
    peerBtn.textContent = "同行业对比";
    peerBtn.addEventListener("click", () => {
      state.selected = stock;
      compareIndustryPeers();
      switchView("research");
    });
    peerEl.append(peerBtn);
  } else {
    peerEl.hidden = true;
  }

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
  const invalidation = root.querySelector(".js-invalidation");
  const decision = root.querySelector(".js-decision");
  const watchPrice = root.querySelector(".js-watch-price");
  const reviewDate = root.querySelector(".js-review-date");
  const evidence = root.querySelector(".js-evidence");
  const noteStatus = root.querySelector(".js-note-status");
  thesis.value = note.thesis || "";
  if (invalidation) invalidation.value = note.invalidation || "";
  decision.value = note.decision || "watch";
  if (watchPrice) watchPrice.value = note.watchPrice != null && note.watchPrice !== "" ? note.watchPrice : "";
  if (reviewDate) reviewDate.value = note.reviewDate || "";
  if (evidence) evidence.value = formatEvidenceLinks(note.evidence);
  root.querySelector(".js-save-note").addEventListener("click", () => {
    const parsedWatchPrice = watchPrice?.value.trim() ? Number(watchPrice.value) : null;
    state.notes[watchKey] = {
      thesis: thesis.value.trim(),
      invalidation: invalidation?.value.trim() || "",
      decision: decision.value,
      watchPrice: Number.isFinite(parsedWatchPrice) ? parsedWatchPrice : null,
      reviewDate: reviewDate?.value || "",
      evidence: parseEvidenceLinks(evidence?.value || ""),
      updatedAt: new Date().toISOString(),
    };
    persistWorkspace();
    noteStatus.textContent = "已保存";
    pushDecisionLog(stock, decision.value);
    renderWorkbench();
  });

  bindAiAnalysisSection(root, stock, {
    thesis,
    noteStatus,
    watchKey,
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
  const summary = root.querySelector(".js-price-summary");
  const markers = [];
  const saved = state.watchlist[watchKey];
  if (saved?.buy) markers.push({ key: "buy", label: "买入关注", value: saved.buy, color: "--accent-strong" });
  if (saved?.add) markers.push({ key: "add", label: "加仓", value: saved.add, color: "--blue" });
  if (saved?.takeProfit) markers.push({ key: "tp", label: "止盈", value: saved.takeProfit, color: "--warn" });
  if (saved?.stopLoss) markers.push({ key: "sl", label: "止损", value: saved.stopLoss, color: "--danger" });
  if (holding?.cost) markers.push({ key: "cost", label: "成本", value: holding.cost, color: "--ink" });
  markers.push({ key: "fair", label: "合理下沿", value: stock.valuation.fair_zone[0], color: "--accent-ink" });
  if (summary) summary.textContent = "加载走势中…";
  if (legend) {
    legend.innerHTML = [
      `<span class="price-legend-chip line" style="color:var(--chart-line)"><i></i>收盘价</span>`,
      `<span class="price-legend-chip line" style="color:var(--blue)"><i></i>均线</span>`,
      ...markers.map(
        (item) =>
          `<span class="price-legend-chip" style="color:var(${item.color})"><i></i>${escapeHtml(item.label)} ${money(item.value, stock.currency)}</span>`,
      ),
    ].join("");
  }

  els.stockDetail.replaceChildren(fragment);
  if (hasFinancials) {
    els.stockDetail.querySelectorAll(".js-chart").forEach((canvas) => {
      drawMetricChart(canvas, stock.financials, canvas.dataset.metric);
    });
  }
  const priceCanvas = els.stockDetail.querySelector(".js-price-chart");
  const priceTooltip = els.stockDetail.querySelector(".js-price-tooltip");
  const priceSummary = els.stockDetail.querySelector(".js-price-summary");
  loadAndDrawPriceChart(priceCanvas, priceTooltip, priceSummary, stock, markers);
  renderWatchlist();
}

async function loadAndDrawPriceChart(canvas, tooltip, summary, stock, markers) {
  if (!canvas) return;
  const payload = await provider.getHistory(stock.symbol, stock.market, state.priceRange);
  if (state.selected && !sameStock(state.selected, stock)) return;
  const points = payload.points || [];
  if (summary) {
    if (!points.length) {
      summary.textContent = payload.error ? `走势暂不可用：${payload.error}` : "暂无历史价格";
    } else {
      const first = points[0].close;
      const last = points[points.length - 1].close;
      const changePct = first ? ((last - first) / first) * 100 : 0;
      const high = Math.max(...points.map((point) => point.close));
      const low = Math.min(...points.map((point) => point.close));
      summary.textContent = `${points[0].date} → ${points[points.length - 1].date} · 区间 ${signed(changePct)}% · 高 ${money(high, stock.currency)} · 低 ${money(low, stock.currency)}${payload.provider ? ` · ${payload.provider}` : ""}`;
    }
  }
  drawPriceChart(canvas, tooltip, points, markers, stock.currency, payload.error);
}

function resolveCssColor(token, fallback) {
  if (!token) return fallback;
  if (token.startsWith("#") || token.startsWith("rgb") || token.startsWith("oklch") || token.startsWith("hsl")) {
    return token;
  }
  const key = token.replace(/^var\(/, "").replace(/\)$/, "").trim();
  const value = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  return value || fallback;
}

function movingAverage(values, windowSize) {
  return values.map((_, index) => {
    if (index + 1 < windowSize) return null;
    return average(values.slice(index + 1 - windowSize, index + 1));
  });
}

function niceScale(min, max, tickCount = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = niceNumber(span / Math.max(tickCount - 1, 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    ticks.push(round(value, step >= 1 ? 2 : 4));
  }
  return { min: niceMin, max: niceMax, ticks };
}

function niceNumber(range, roundTo) {
  const exponent = Math.floor(Math.log10(Math.max(range, Number.EPSILON)));
  const fraction = range / 10 ** exponent;
  let niceFraction;
  if (roundTo) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * 10 ** exponent;
}

function formatAxisPrice(value, currency) {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return `${CURRENCY[currency] || ""}${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatChartDate(date, compact = false) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  if (compact) return `${Number(month)}/${Number(day)}`;
  return `${year}-${month}`;
}

function pickDateTicks(points, count = 5) {
  if (!points.length) return [];
  if (points.length <= count) return points.map((point, index) => ({ index, date: point.date }));
  const ticks = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (points.length - 1)) / (count - 1));
    ticks.push({ index, date: points[index].date });
  }
  return ticks;
}

function setupHiDpiCanvas(canvas, cssHeight = 360) {
  const parentWidth = canvas.parentElement?.clientWidth || canvas.clientWidth || 960;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.floor(parentWidth));
  const height = cssHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

function drawPriceChart(canvas, tooltip, points, markers, currency, error) {
  const { ctx, width, height } = setupHiDpiCanvas(canvas, 360);
  const colors = themeChartColors();
  const lineColor = resolveCssColor("--chart-line", colors.line);
  const maColor = resolveCssColor("--blue", colors.label);
  const labelColor = resolveCssColor("--chart-label", colors.label);
  const gridColor = resolveCssColor("--chart-grid", colors.grid);
  const inkColor = resolveCssColor("--ink", "#222");
  const surfaceColor = resolveCssColor("--surface-2", "#fff");

  canvas.onmousemove = null;
  canvas.onmouseleave = null;
  canvas.ontouchstart = null;
  canvas.ontouchmove = null;
  canvas.ontouchend = null;
  if (canvas._priceChartResize) {
    window.removeEventListener("resize", canvas._priceChartResize);
    canvas._priceChartResize = null;
  }

  if (!points.length) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = labelColor;
    ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(error ? `走势暂不可用：${error}` : "暂无历史价格", 24, height / 2);
    if (tooltip) tooltip.hidden = true;
    return;
  }

  const values = points.map((point) => point.close);
  const markerValues = markers.map((item) => item.value).filter((value) => value != null && !Number.isNaN(Number(value)));
  const dataMin = Math.min(...values, ...markerValues);
  const dataMax = Math.max(...values, ...markerValues);
  const padX = { left: 64, right: 18 };
  const padY = { top: 24, bottom: 38 };
  const plotWidth = width - padX.left - padX.right;
  const plotHeight = height - padY.top - padY.bottom;
  const scale = niceScale(dataMin * 0.997, dataMax * 1.003, 5);
  const maWindow = values.length >= 40 ? 20 : values.length >= 15 ? 10 : 5;
  const ma = movingAverage(values, maWindow);
  const dateTicks = pickDateTicks(points, width < 520 ? 3 : 5);
  const markerPalette = {
    buy: resolveCssColor("--accent-strong", lineColor),
    add: resolveCssColor("--blue", maColor),
    tp: resolveCssColor("--warn", "#c48a1a"),
    sl: resolveCssColor("--danger", "#c44"),
    cost: inkColor,
    fair: resolveCssColor("--accent-ink", lineColor),
  };

  const xAt = (index) => padX.left + (plotWidth / Math.max(values.length - 1, 1)) * index;
  const yAt = (value) => padY.top + ((scale.max - value) / (scale.max - scale.min || 1)) * plotHeight;
  const chartPoints = values.map((value, index) => [xAt(index), yAt(value)]);

  const render = (hoverIndex = null) => {
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = surfaceColor;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(padX.left, padY.top, plotWidth, plotHeight);
    ctx.globalAlpha = 1;

    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    scale.ticks.forEach((tick) => {
      const y = yAt(tick);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX.left, y);
      ctx.lineTo(width - padX.right, y);
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatAxisPrice(tick, currency), padX.left - 8, y);
    });

    dateTicks.forEach(({ index, date }) => {
      const x = xAt(index);
      ctx.strokeStyle = gridColor;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, padY.top);
      ctx.lineTo(x, height - padY.bottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        formatChartDate(date, state.priceRange === "1m" || state.priceRange === "3m"),
        x,
        height - padY.bottom + 10,
      );
    });

    const labelSlots = [];
    markers.forEach((marker) => {
      if (marker.value == null || Number.isNaN(Number(marker.value))) return;
      const y = yAt(marker.value);
      const color = markerPalette[marker.key] || labelColor;
      ctx.save();
      ctx.setLineDash(marker.key === "cost" ? [2, 4] : [6, 4]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(padX.left, y);
      ctx.lineTo(width - padX.right, y);
      ctx.stroke();
      ctx.restore();

      let labelY = clamp(y - 6, padY.top + 12, height - padY.bottom - 4);
      labelSlots.forEach((used) => {
        if (Math.abs(used - labelY) < 14) labelY = used - 14;
      });
      labelSlots.push(labelY);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${marker.label} ${formatAxisPrice(marker.value, currency)}`, padX.left + 6, labelY);
    });

    const gradient = ctx.createLinearGradient(0, padY.top, 0, height - padY.bottom);
    gradient.addColorStop(0, lineColor);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    chartPoints.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(chartPoints[chartPoints.length - 1][0], height - padY.bottom);
    ctx.lineTo(chartPoints[0][0], height - padY.bottom);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    let maStarted = false;
    ma.forEach((value, index) => {
      if (value == null) return;
      const x = xAt(index);
      const y = yAt(value);
      if (!maStarted) {
        ctx.moveTo(x, y);
        maStarted = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (maStarted) {
      ctx.strokeStyle = maColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.92;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    chartPoints.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const [lastX, lastY] = chartPoints[chartPoints.length - 1];
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = labelColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(formatAxisPrice(values[values.length - 1], currency), width - padX.right, padY.top - 6);

    if (hoverIndex == null) return;

    const point = points[hoverIndex];
    const [hx, hy] = chartPoints[hoverIndex];
    ctx.save();
    ctx.strokeStyle = labelColor;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, padY.top);
    ctx.lineTo(hx, height - padY.bottom);
    ctx.moveTo(padX.left, hy);
    ctx.lineTo(width - padX.right, hy);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = surfaceColor;
    ctx.stroke();

    if (tooltip) {
      const change = ((point.close - points[0].close) / points[0].close) * 100;
      tooltip.hidden = false;
      tooltip.innerHTML = `<strong>${money(point.close, currency)}</strong><span>${point.date}</span><span>区间 ${signed(change)}%</span>${
        ma[hoverIndex] != null ? `<span>MA${maWindow} ${money(ma[hoverIndex], currency)}</span>` : ""
      }`;
      const rect = canvas.getBoundingClientRect();
      const tipX = (hx / width) * rect.width;
      const tipY = (hy / height) * rect.height;
      tooltip.style.left = `${Math.min(Math.max(tipX, 18), rect.width - 18)}px`;
      tooltip.style.top = `${Math.max(tipY, 28)}px`;
    }
  };

  const hoverFromEvent = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const ratio = (x - padX.left) / plotWidth;
    return clamp(Math.round(ratio * (values.length - 1)), 0, values.length - 1);
  };

  render(null);

  canvas.onmousemove = (event) => render(hoverFromEvent(event.clientX));
  canvas.onmouseleave = () => {
    if (tooltip) tooltip.hidden = true;
    render(null);
  };
  canvas.ontouchstart = (event) => {
    const touch = event.touches[0];
    if (touch) render(hoverFromEvent(touch.clientX));
  };
  canvas.ontouchmove = (event) => {
    const touch = event.touches[0];
    if (touch) {
      event.preventDefault();
      render(hoverFromEvent(touch.clientX));
    }
  };
  canvas.ontouchend = () => {
    if (tooltip) tooltip.hidden = true;
    render(null);
  };

  canvas._priceChartResize = () => {
    if (!document.body.contains(canvas)) {
      window.removeEventListener("resize", canvas._priceChartResize);
      return;
    }
    drawPriceChart(canvas, tooltip, points, markers, currency, error);
  };
  window.addEventListener("resize", canvas._priceChartResize);
}


function renderWatchlist() {
  if (!els.watchlistRows) return;
  const showTargets = Boolean(state.prefs.showWatchTargets);
  document.querySelector("#watchTable")?.classList.toggle("show-targets", showTargets);
  if (els.watchShowTargets) els.watchShowTargets.checked = showTargets;

  let items = Object.values(state.watchlist)
    .map((saved) => {
      const stock = findStock(saved.symbol, saved.market);
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
    els.watchlistRows.innerHTML = `<tr><td colspan="11"><div class="empty-state">当前筛选下没有自选。</div></td></tr>`;
    return;
  }

  els.watchlistRows.innerHTML = items
    .map(({ stock, saved }) => {
      const level = watchAlertLevel(stock, saved);
      const alert = watchAlertText(stock, saved);
      const note = state.notes[stockKey(stock)] || {};
      const decision = DECISION_LABELS[note.decision] || "观望";
      return `
        <tr class="watch-row ${level === "hit" ? "hit" : ""}" data-key="${stockKey(stock)}">
          <td>
            <button class="linkish" data-open="${stockKey(stock)}" type="button">
              <strong>${escapeHtml(stock.name)}</strong>
              <span class="muted">${stock.symbol} · ${marketLabel(stock.market)}${stock.industry ? ` · ${escapeHtml(stock.industry)}` : ""}</span>
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
          <td><span class="tag calm">${escapeHtml(decision)}</span></td>
          <td><span class="tag ${level}">${escapeHtml(alert)}</span></td>
          <td class="num watch-extra"><input data-field="buy" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.buy ?? ""}" /></td>
          <td class="num watch-extra"><input data-field="add" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.add ?? ""}" /></td>
          <td class="num watch-extra"><input data-field="takeProfit" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.takeProfit ?? ""}" /></td>
          <td class="num watch-extra"><input data-field="stopLoss" data-key="${stockKey(stock)}" type="number" step="0.01" value="${saved.stopLoss ?? ""}" /></td>
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
  const pendingReviews = collectPendingReviews();
  const base = state.prefs.baseCurrency || "CNY";
  let holdingCostBase = 0;
  let holdingValueBase = 0;
  Object.values(state.holdings).forEach((holding) => {
    const stock = findStock(holding.symbol, holding.market);
    if (!stock) return;
    holdingCostBase += toBase(holding.shares * holding.cost, stock.currency, base);
    holdingValueBase += toBase(holding.shares * stock.quote.price, stock.currency, base);
  });
  const holdingPnlPct = holdingCostBase ? ((holdingValueBase - holdingCostBase) / holdingCostBase) * 100 : 0;
  const todoCount = collectActiveAlerts().length + pendingReviews.length;

  els.workbenchMetrics.innerHTML = [
    ["自选", `${watchCount} 只`],
    ["已触及", `${hitCount} 条`],
    ["持仓盈亏", Object.keys(state.holdings).length ? `${signed(holdingPnlPct)}%` : "—"],
    ["今日待办", `${todoCount} 项`],
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

  if (els.workbenchChanged) {
    const changedItems = collectChangedItems().slice(0, 8);
    els.workbenchChanged.innerHTML = changedItems.length
      ? changedItems
          .map(
            (item) => `
              <button class="stack-item" data-open="${item.key}" type="button">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="muted">${escapeHtml(item.detail)}</span>
                </div>
                <span class="tag ${item.level}">${escapeHtml(item.badge)}</span>
              </button>
            `,
          )
          .join("")
      : `<div class="empty-state compact">暂无异动或提醒。去研究池加入自选后，涨跌与触及会汇总在这里。</div>`;
  }

  const holdings = Object.values(state.holdings)
    .map((holding) => {
      const stock = findStock(holding.symbol, holding.market);
      if (!stock) return null;
      const marketValue = holding.shares * stock.quote.price;
      const costValue = holding.shares * holding.cost;
      const pnl = marketValue - costValue;
      const pnlPct = costValue ? (pnl / costValue) * 100 : 0;
      const marketValueBase = toBase(marketValue, stock.currency, base);
      const weight = holdingValueBase ? (marketValueBase / holdingValueBase) * 100 : 0;
      const fairLow = stock.valuation?.fair_zone?.[0];
      const vsFair = fairLow ? ((stock.quote.price - fairLow) / fairLow) * 100 : null;
      return { stock, holding, pnl, pnlPct, weight, vsFair };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pnlPct) - Math.abs(a.pnlPct))
    .slice(0, 6);

  els.workbenchHoldings.innerHTML = holdings.length
    ? holdings
        .map(({ stock, pnl, pnlPct, weight, vsFair }) => {
          const fairText =
            vsFair == null ? "合理价 —" : `相对合理 ${signed(vsFair)}%`;
          return `
            <button class="stack-item" data-open="${stockKey(stock)}" type="button">
              <div>
                <strong>${escapeHtml(stock.name)}</strong>
                <span class="muted">${money(stock.quote.price, stock.currency)} · 仓位 ${weight.toFixed(1)}% · ${fairText}</span>
              </div>
              <strong class="${pnl >= 0 ? "up" : "down"}">${signed(pnlPct)}%</strong>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state compact">尚未录入持仓。在持仓页添加数量与成本后，这里会汇总浮盈亏。</div>`;

  const earnings = Object.values(state.watchlist)
    .map((saved) => findStock(saved.symbol, saved.market))
    .filter((stock) => stock?.quote.earnings_date && daysUntil(stock.quote.earnings_date) >= 0 && daysUntil(stock.quote.earnings_date) <= 45)
    .sort((a, b) => daysUntil(a.quote.earnings_date) - daysUntil(b.quote.earnings_date))
    .slice(0, 6);

  if (els.workbenchEarnings) {
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
      : `<div class="empty-state compact">自选中暂无 45 天内财报。</div>`;
  }

  if (els.workbenchReviews) {
    const reviews = pendingReviews.slice(0, 6);
    els.workbenchReviews.innerHTML = reviews.length
      ? reviews
          .map(
            (item) => `
              <button class="stack-item" data-open="${item.key}" type="button">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="muted">${escapeHtml(item.detail)}</span>
                </div>
                <span class="tag ${item.level}">${escapeHtml(item.badge)}</span>
              </button>
            `,
          )
          .join("")
      : `<div class="empty-state compact">没有待复盘判断。在详情页写判断卡并设复盘日后会出现在这里。</div>`;
  }

  if (els.alertHistory) {
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
  }

  document.querySelectorAll("#workbenchView [data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
}

function collectChangedItems() {
  const items = [];
  const seen = new Set();

  collectActiveAlerts().forEach((alert) => {
    seen.add(`${alert.key}:${alert.detail}`);
    items.push({
      key: alert.key,
      title: alert.title,
      detail: alert.detail,
      level: alert.level,
      badge: alert.level === "hit" ? "触及" : "临近",
      rank: alert.level === "hit" ? 0 : 1,
      sortValue: alert.date != null ? daysUntil(alert.date) ?? 99 : 0,
    });
  });

  Object.values(state.watchlist)
    .map((saved) => {
      const stock = findStock(saved.symbol, saved.market);
      return stock ? { stock, saved } : null;
    })
    .filter(Boolean)
    .filter(({ saved }) => !state.prefs.coreOnlyWorkbench || (saved.group || "watch") === "core")
    .sort((a, b) => Math.abs(b.stock.quote.change_pct || 0) - Math.abs(a.stock.quote.change_pct || 0))
    .slice(0, 6)
    .forEach(({ stock }) => {
      const key = stockKey(stock);
      const detail = `涨跌 ${signed(stock.quote.change_pct)}%`;
      if (seen.has(`${key}:${detail}`)) return;
      const absMove = Math.abs(stock.quote.change_pct || 0);
      if (absMove < 1.5 && items.length >= 4) return;
      items.push({
        key,
        title: stock.name,
        detail,
        level: absMove >= 3 ? "hit" : "near",
        badge: absMove >= 3 ? "异动" : "波动",
        rank: 2,
        sortValue: -absMove,
      });
    });

  return items.sort((a, b) => a.rank - b.rank || a.sortValue - b.sortValue);
}

function collectPendingReviews() {
  const STALE_DAYS = 14;
  const items = [];
  const keys = new Set([
    ...Object.keys(state.watchlist),
    ...Object.keys(state.holdings),
    ...Object.keys(state.notes),
  ]);

  keys.forEach((key) => {
    const note = state.notes[key];
    if (!note) return;
    const hasJudgment = Boolean(
      note.thesis ||
        note.invalidation ||
        note.watchPrice != null ||
        note.reviewDate ||
        (Array.isArray(note.evidence) && note.evidence.length) ||
        (note.decision && note.decision !== "watch"),
    );
    if (!hasJudgment) return;

    const [market, symbol] = key.split(":");
    const stock = findStock(symbol, market);
    const title = stock?.name || symbol || key;
    const decisionLabel = DECISION_LABELS[note.decision] || "观望";

    if (note.reviewDate) {
      const days = daysUntil(note.reviewDate);
      if (days <= 0) {
        items.push({
          key,
          title,
          detail: days === 0 ? `复盘日今天 · ${decisionLabel}` : `复盘已过 ${Math.abs(days)} 天 · ${decisionLabel}`,
          level: "hit",
          badge: days === 0 ? "今日复盘" : "逾期",
          rank: days === 0 ? 0 : 1,
          sortValue: days,
        });
        return;
      }
      if (days <= 7) {
        items.push({
          key,
          title,
          detail: `${days} 天后复盘 · ${decisionLabel}`,
          level: "near",
          badge: "临近",
          rank: 2,
          sortValue: days,
        });
        return;
      }
    }

    const updatedAt = note.updatedAt ? new Date(note.updatedAt) : null;
    if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
      const ageDays = Math.floor((Date.now() - updatedAt.getTime()) / 86400000);
      if (ageDays >= STALE_DAYS) {
        items.push({
          key,
          title,
          detail: `判断卡 ${ageDays} 天未更新 · ${decisionLabel}`,
          level: "near",
          badge: "久未更新",
          rank: 3,
          sortValue: -ageDays,
        });
      }
    }
  });

  return items.sort((a, b) => a.rank - b.rank || a.sortValue - b.sortValue);
}

function parseEvidenceLinks(raw) {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function formatEvidenceLinks(evidence) {
  if (Array.isArray(evidence)) return evidence.join("\n");
  if (typeof evidence === "string") return evidence;
  return "";
}

function renderCompare() {
  if (!els.compareBar || !els.compareTable) return;
  if (els.researchEmptyHint) {
    els.researchEmptyHint.hidden = Boolean(state.filtered.length || state.compare.length);
  }
  if (!state.compare.length) {
    els.compareBar.textContent = "勾选研究池中的股票，或用「同行业一键对比」（最多 4 只）。";
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

function compareIndustryPeers() {
  const seed =
    state.selected ||
    state.compare[0] ||
    state.filtered.find((stock) => stock.industry && !["未分类", "恒生成分", "标普500", "自定义"].includes(stock.industry));
  if (!seed) {
    if (els.compareBar) els.compareBar.textContent = "请先在研究池选择一只股票，或筛选到具体行业。";
    return;
  }
  const industry = seed.industry;
  if (!industry || ["未分类", "恒生成分", "标普500", "自定义"].includes(industry)) {
    if (els.compareBar) els.compareBar.textContent = `${seed.name} 行业信息不足，无法一键同业对比。`;
    return;
  }
  const peers = (provider.stocks || [])
    .filter((item) => item.market === seed.market && item.industry === industry)
    .sort((a, b) => marginOfSafety(b) - marginOfSafety(a));
  const selected = [];
  const seedMatch = peers.find((item) => sameStock(item, seed));
  if (seedMatch) selected.push(seedMatch);
  for (const peer of peers) {
    if (selected.length >= 4) break;
    if (!selected.some((item) => sameStock(item, peer))) selected.push(peer);
  }
  if (selected.length < 2) {
    if (els.compareBar) els.compareBar.textContent = `${industry} 在当前已加载行情中不足 2 只，可先加载更多成分股。`;
    return;
  }
  state.compare = selected.slice(0, 4);
  if (els.industryFilter && [...els.industryFilter.options].some((option) => option.value === industry)) {
    els.industryFilter.value = industry;
    state.page = 1;
    refreshStocks();
  }
  renderCompare();
  renderRows();
  if (els.compareBar) {
    els.compareBar.insertAdjacentHTML(
      "afterbegin",
      `<span class="tag">同业 · ${escapeHtml(industry)}</span> `,
    );
  }
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
    renderIndexSegment();
    renderResearchLoadStatus();
    if (!(provider.stocksByIndex[state.index] || []).length) {
      refreshStocks({ resetQuotes: true });
    } else {
      renderRows();
      renderPager();
      renderCompare();
    }
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
  // Market shortcuts removed from global topbar; index controls live in research view.
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
    state.watchlist[key] = createWatchlistEntry(stock);
  }
  saveWatchlist();
  renderDetail();
  renderWatchlist();
  renderWorkbench();
}

function parseWatchlistTokens(raw, defaultMarket) {
  return String(raw || "")
    .split(/[\s,;，；\n\r\t]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const prefixed = token.match(/^(A|HK|US)[:：\-/]?(.+)$/i);
      if (prefixed) {
        return {
          market: prefixed[1].toUpperCase(),
          symbol: normalizeClientSymbol(prefixed[2], prefixed[1].toUpperCase()),
        };
      }
      return {
        market: defaultMarket,
        symbol: normalizeClientSymbol(token, defaultMarket),
      };
    })
    .filter((item) => item.symbol)
    .slice(0, 40);
}

function createWatchlistEntry(stock, group = "watch") {
  return {
    symbol: stock.symbol,
    market: stock.market,
    group,
    buy: stock.valuation.watch_zone[1],
    add: stock.valuation.watch_zone[0],
    takeProfit: stock.valuation.bull_price,
    stopLoss: stock.valuation.bear_price,
    targetPrice: stock.valuation.watch_zone[1],
    createdAt: new Date().toISOString(),
  };
}

async function addSymbolToWatchlist(market, rawSymbol) {
  return addSymbolsToWatchlist(market, rawSymbol);
}

async function addSymbolsToWatchlist(market, rawInput) {
  if (!els.addSymbolStatus) return;
  const tokens = parseWatchlistTokens(rawInput, market);
  if (!tokens.length) {
    els.addSymbolStatus.textContent = "请输入至少一个代码。";
    return;
  }
  els.addSymbolStatus.textContent = tokens.length > 1 ? `批量查询 ${tokens.length} 只…` : "查询中…";
  const added = [];
  const existed = [];
  const failed = [];
  for (const token of tokens) {
    try {
      const stock = await provider.ensureStock(token.symbol, token.market);
      if (!stock) {
        failed.push(`${token.market}:${token.symbol}`);
        continue;
      }
      const key = stockKey(stock);
      if (state.watchlist[key]) {
        existed.push(stock.name);
        continue;
      }
      state.watchlist[key] = createWatchlistEntry(stock);
      added.push(stock.name);
    } catch {
      failed.push(`${token.market}:${token.symbol}`);
    }
  }
  if (added.length) saveWatchlist();
  if (els.addSymbol) els.addSymbol.value = "";
  const parts = [];
  if (added.length) parts.push(`新加入 ${added.length} 只`);
  if (existed.length) parts.push(`已在自选 ${existed.length} 只`);
  if (failed.length) parts.push(`失败 ${failed.length} 只`);
  els.addSymbolStatus.textContent = parts.join(" · ") || "未加入任何标的";
  if (failed.length && failed.length <= 5) {
    els.addSymbolStatus.textContent += `（${failed.join(", ")}）`;
  }
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
    state.watchlist[key] = createWatchlistEntry(stock, "core");
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
          date: stock.quote.earnings_date,
        });
      }
    }
  });

  Object.entries(state.notes).forEach(([key, note]) => {
    if (note?.watchPrice == null || !Number.isFinite(Number(note.watchPrice))) return;
    const [market, symbol] = key.split(":");
    const stock = findStock(symbol, market);
    if (!stock?.quote?.price) return;
    const target = Number(note.watchPrice);
    const price = stock.quote.price;
    const distance = Math.abs(price - target) / target;
    if (distance > 0.03) return;
    alerts.push({
      key,
      title: stock.name,
      detail: `判断卡关注价 ${money(target, stock.currency)} · 现价 ${money(price, stock.currency)}`,
      level: distance <= 0.01 ? "hit" : "near",
    });
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
    "## 判断卡",
    note.thesis || "（空）",
    "",
    `- 决策：${DECISION_LABELS[note.decision] || "观望"}`,
    `- 失效条件：${note.invalidation || "（空）"}`,
    `- 关注价：${note.watchPrice != null ? money(note.watchPrice, stock.currency) : "—"}`,
    `- 下次复盘：${note.reviewDate || "—"}`,
    `- 更新于：${note.updatedAt ? new Date(note.updatedAt).toLocaleString("zh-CN") : "—"}`,
  ];
  const evidence = Array.isArray(note.evidence) ? note.evidence : [];
  if (evidence.length) {
    lines.push("", "### 证据链接", ...evidence.map((url) => `- ${url}`));
  }
  if (holding) {
    lines.push("", "## 持仓", `- 数量：${holding.shares}`, `- 成本：${money(holding.cost, stock.currency)}`);
  }
  const aiReport = state.aiReports[stockKey(stock)];
  if (aiReport?.content) {
    lines.push(
      "",
      "## AI 深度分析",
      `- 模型：${aiReport.provider_name || aiReport.provider || "—"} / ${aiReport.model || "—"}`,
      `- 历史区间：${aiReport.history_range || "—"}`,
      `- 生成时间：${aiReport.generated_at ? new Date(aiReport.generated_at).toLocaleString("zh-CN") : "—"}`,
      "",
      aiReport.content,
    );
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

function bindAiAnalysisSection(root, stock, { thesis, noteStatus, watchKey }) {
  const section = root.querySelector("#detail-ai");
  if (!section) return;
  const rangeSelect = root.querySelector(".js-ai-range");
  const focusInput = root.querySelector(".js-ai-focus");
  const analyzeButton = root.querySelector(".js-ai-analyze");
  const statusEl = root.querySelector(".js-ai-status");
  const resultEl = root.querySelector(".js-ai-result");
  const toThesisButton = root.querySelector(".js-ai-to-thesis");
  const cached = state.aiReports[watchKey];

  if (rangeSelect) {
    rangeSelect.value = state.aiRange || "1y";
    rangeSelect.addEventListener("change", () => {
      state.aiRange = rangeSelect.value;
    });
  }
  if (cached?.focus && focusInput) focusInput.value = cached.focus;
  renderAiReport(resultEl, statusEl, toThesisButton, cached);

  const ai = appConfig?.ai || {};
  if (ai.enabled === false) {
    if (statusEl) statusEl.textContent = "AI 分析已在设置中关闭。";
    if (analyzeButton) analyzeButton.disabled = true;
  } else if (!ai.has_api_key) {
    if (statusEl) statusEl.textContent = "请先到设置页配置 DeepSeek / OpenAI 兼容 API Key。";
  } else if (statusEl && !cached) {
    statusEl.textContent = `将使用 ${ai.provider_name || ai.provider || "外部模型"} · ${ai.model || ""}`.trim();
  }

  analyzeButton?.addEventListener("click", async () => {
    if (!analyzeButton || analyzeButton.disabled) return;
    analyzeButton.disabled = true;
    if (statusEl) statusEl.textContent = "正在汇总行情、历史走势与财报，请求大模型…";
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p class="muted">分析中，通常需要数秒到数十秒…</p>`;
    }
    if (toThesisButton) toThesisButton.hidden = true;
    try {
      const report = await requestAiAnalysis(stock, {
        historyRange: rangeSelect?.value || state.aiRange || "1y",
        focus: focusInput?.value.trim() || "",
      });
      state.aiReports[watchKey] = report;
      renderAiReport(resultEl, statusEl, toThesisButton, report);
    } catch (error) {
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.innerHTML = `<p class="ai-error">${escapeHtml(error.message || "分析失败")}</p>`;
      }
      if (statusEl) statusEl.textContent = "分析失败";
    } finally {
      analyzeButton.disabled = false;
    }
  });

  toThesisButton?.addEventListener("click", () => {
    const report = state.aiReports[watchKey];
    if (!report?.content || !thesis) return;
    const snippet = extractAiThesisSnippet(report.content);
    thesis.value = thesis.value.trim() ? `${thesis.value.trim()}\n\n${snippet}` : snippet;
    if (noteStatus) noteStatus.textContent = "已填入论点，记得保存判断卡";
  });
}

async function requestAiAnalysis(stock, { historyRange = "1y", focus = "" } = {}) {
  const key = stockKey(stock);
  const payload = {
    history_range: historyRange,
    focus,
    note: state.notes[key] || {},
    holding: state.holdings[key] || null,
    stock: {
      symbol: stock.symbol,
      name: stock.name,
      englishName: stock.englishName,
      market: stock.market,
      exchange: stock.exchange,
      currency: stock.currency,
      industry: stock.industry,
      quote: stock.quote,
      valuation: stock.valuation,
      analysis: stock.analysis,
      financials: stock.financials || [],
      events: stock.events || null,
    },
  };
  const response = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `AI 分析失败 ${response.status}`);
    err.code = data.code;
    throw err;
  }
  return {
    ...data,
    focus,
    content: data.content || "",
  };
}

function renderAiReport(resultEl, statusEl, toThesisButton, report) {
  if (!resultEl) return;
  if (!report?.content) {
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    if (toThesisButton) toThesisButton.hidden = true;
    return;
  }
  resultEl.hidden = false;
  resultEl.innerHTML = renderMarkdownLite(report.content);
  if (toThesisButton) toThesisButton.hidden = false;
  if (statusEl) {
    const when = report.generated_at ? new Date(report.generated_at).toLocaleString("zh-CN") : "";
    statusEl.textContent = [
      report.provider_name || report.provider,
      report.model,
      report.history_range ? `历史 ${report.history_range}` : "",
      when,
    ]
      .filter(Boolean)
      .join(" · ");
  }
}

function extractAiThesisSnippet(content) {
  const text = String(content || "").trim();
  if (!text) return "";
  const sections = text.split(/\n(?=##\s+)/);
  const preferred = sections.find((block) => /操作建议|投资建议|结论|综合判断/.test(block)) || sections[0] || text;
  const cleaned = preferred
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .trim();
  return cleaned.length > 600 ? `${cleaned.slice(0, 600)}…` : cleaned;
}

function renderMarkdownLite(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inUl = false;
  let inOl = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) html.push(`<p>${formatInlineMarkdown(text)}</p>`);
    paragraph = [];
  };
  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeLists();
      const level = Math.min(heading[1].length + 2, 5);
      html.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${formatInlineMarkdown(ul[1])}</li>`);
      continue;
    }
    const ol = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${formatInlineMarkdown(ol[1])}</li>`);
      continue;
    }
    closeLists();
    paragraph.push(trimmed);
  }
  flushParagraph();
  closeLists();
  return html.join("") || `<p class="muted">（空）</p>`;
}

function formatInlineMarkdown(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  return value;
}

function buildCatalogStockFromApi(entry, index) {
  return {
    symbol: entry.symbol,
    name: entry.name,
    englishName: entry.englishName || entry.name,
    market: entry.market,
    exchange: entry.exchange,
    currency: entry.currency,
    industry: entry.industry || "未分类",
    indices: entry.indices || [],
    indexCodes: entry.index_codes || [],
    yahooSymbol: entry.yahoo_symbol,
    cik: entry.cik,
    listing_status: "listed",
    sortIndex: index,
  };
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

function normalizePrefs(prefs = {}) {
  return {
    notify: Boolean(prefs?.notify),
    baseCurrency: prefs?.baseCurrency || "CNY",
    compactMode: Boolean(prefs?.compactMode),
    coreOnlyWorkbench: Boolean(prefs?.coreOnlyWorkbench),
    showWatchTargets: Boolean(prefs?.showWatchTargets),
  };
}

function syncPrefControls() {
  if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
  if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
  if (els.prefCompact) els.prefCompact.checked = Boolean(state.prefs.compactMode);
  if (els.prefCoreOnly) els.prefCoreOnly.checked = Boolean(state.prefs.coreOnlyWorkbench);
  if (els.watchShowTargets) els.watchShowTargets.checked = Boolean(state.prefs.showWatchTargets);
}

function applyWorkbenchPrefs() {
  document.body.classList.toggle("compact-workbench", Boolean(state.prefs.compactMode));
  document.querySelector("#watchTable")?.classList.toggle("show-targets", Boolean(state.prefs.showWatchTargets));
}

function emptyWorkspaceBundle() {
  return {
    version: 1,
    updated_at: null,
    watchlist: {},
    holdings: {},
    notes: {},
    alertHistory: [],
    prefs: normalizePrefs(),
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
    prefs: normalizePrefs({
      notify: Boolean(loadJSON(PREFS_KEY, { notify: false }).notify),
      baseCurrency: loadJSON(PREFS_KEY, { baseCurrency: "CNY" }).baseCurrency || "CNY",
      ...loadJSON(PREFS_KEY, {}),
    }),
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
      prefs: normalizePrefs(cached.prefs || {}),
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
    prefs: normalizePrefs(state.prefs),
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
    prefs: normalizePrefs(bundle?.prefs || {}),
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
  syncPrefControls();
  applyWorkbenchPrefs();

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
    provider.invalidateAll();
    await refreshStocks({ resetQuotes: true });
    renderWorkbench();
    renderWatchlist();
    renderHoldings();
    if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
    if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
    syncPrefControls();
    applyWorkbenchPrefs();
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
