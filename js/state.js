export let appConfig = null;
export function setAppConfig(nextConfig) {
  appConfig = nextConfig;
}

export const state = {
  // 定投计划内 ETF：[{symbol, name, shares, cost, target_weight, note}]
  etfs: [],
  // 买入记录：[{id, symbol, date, price, shares, note}]
  buys: [],
  plan: {
    name: "默认定投计划",
    amount: 2000,
    cadence: "monthly",
    day: 1,
    note: "",
  },
  quotesBySymbol: {},
  quotesMeta: null,
  quotesFetchedAt: 0,
  selectedEtf: null,
  priceRange: "1y",
  indexChartRange: "1y",
  activeView: "etf",
  // 分析页当前 ETF 代码；由侧栏池条目打开
  analysisSymbol: null,
  analysisCache: {}, // symbolKey -> payload
  workspaceSync: {
    status: "idle",
    updatedAt: null,
    error: null,
    source: "local",
  },
};

export const workspaceRuntime = {
  saveTimer: null,
  saveInFlight: null,
};

export const els = {};

export function initEls() {
  Object.assign(els, {
    pageTitle: document.querySelector("#pageTitle"),
    topSourceStatus: document.querySelector("#topSourceStatus"),
    themeToggle: document.querySelector("#themeToggle"),
    sidebarToggle: document.querySelector("#sidebarToggle"),

    dividendStatus: document.querySelector("#dividendStatus"),
    dividendContent: document.querySelector("#dividendContent"),
    dividendRefresh: document.querySelector("#dividendRefresh"),
    dividendEyebrow: document.querySelector("#dividendEyebrow"),
    dividendSectionTitle: document.querySelector("#dividendSectionTitle"),
    dividendLede: document.querySelector("#dividendLede"),

    dcaPlanForm: document.querySelector("#dcaPlanForm"),
    planName: document.querySelector("#planName"),
    planAmount: document.querySelector("#planAmount"),
    planCadence: document.querySelector("#planCadence"),
    planDay: document.querySelector("#planDay"),
    planNote: document.querySelector("#planNote"),
    planDayHint: document.querySelector("#planDayHint"),
    etfForm: document.querySelector("#etfForm"),
    etfSymbol: document.querySelector("#etfSymbol"),
    etfShares: document.querySelector("#etfShares"),
    etfCost: document.querySelector("#etfCost"),
    etfTargetWeight: document.querySelector("#etfTargetWeight"),
    etfFormStatus: document.querySelector("#etfFormStatus"),
    etfMetrics: document.querySelector("#etfMetrics"),
    poolAllocPanel: document.querySelector("#poolAllocPanel"),
    etfRows: document.querySelector("#etfRows"),
    etfEmpty: document.querySelector("#etfEmpty"),
    buyForm: document.querySelector("#buyForm"),
    buySymbol: document.querySelector("#buySymbol"),
    buyDate: document.querySelector("#buyDate"),
    buyPrice: document.querySelector("#buyPrice"),
    buyShares: document.querySelector("#buyShares"),
    buyNote: document.querySelector("#buyNote"),
    buyFormStatus: document.querySelector("#buyFormStatus"),
    buyRows: document.querySelector("#buyRows"),
    buyEmpty: document.querySelector("#buyEmpty"),
    etfRefresh: document.querySelector("#etfRefresh"),
    etfQuoteStatus: document.querySelector("#etfQuoteStatus"),
    etfChartPanel: document.querySelector("#etfChartPanel"),
    etfChartTitle: document.querySelector("#etfChartTitle"),
    etfChartSummary: document.querySelector("#etfChartSummary"),
    etfChart: document.querySelector("#etfChart"),
    etfChartTooltip: document.querySelector("#etfChartTooltip"),
    sidebarEtfList: document.querySelector("#sidebarEtfList"),
    sidebarPoolCount: document.querySelector("#sidebarPoolCount"),

    settingsForm: document.querySelector("#settingsForm"),
    saveConfig: document.querySelector("#saveConfig"),
    resetConfig: document.querySelector("#resetConfig"),
    settingsStatus: document.querySelector("#settingsStatus"),
    workspaceStatus: document.querySelector("#workspaceStatus"),
    exportWorkspace: document.querySelector("#exportWorkspace"),
    importWorkspace: document.querySelector("#importWorkspace"),
    importWorkspaceFile: document.querySelector("#importWorkspaceFile"),
    syncWorkspaceNow: document.querySelector("#syncWorkspaceNow"),
  });
}
