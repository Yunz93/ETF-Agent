import { QUOTE_BATCH_SIZE, RESEARCH_INDICES } from "./constants.js";
import { appConfig, state } from "./state.js";
import { buildCatalogStockFromApi, buildEventsFromQuote, buildStockFromQuote, enrichStockMetrics, eventStatus, marketDisclosureLinks, sortEvents } from "./analysis.js";
import { sameStock, stockKey } from "./utils.js";
import { loadCustomSymbols, saveCustomSymbols } from "./workspace.js";

export class HybridProvider {
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
