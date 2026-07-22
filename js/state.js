export let appConfig = null;
export function setAppConfig(nextConfig) {
  appConfig = nextConfig;
}

export const state = {
  // ETF 池：[{symbol, name, shares, cost, note}]
  etfs: [],
  quotesBySymbol: {},
  quotesMeta: null,
  quotesFetchedAt: 0,
  selectedEtf: null,
  priceRange: "1y",
  activeView: "dividend",
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

    etfForm: document.querySelector("#etfForm"),
    etfSymbol: document.querySelector("#etfSymbol"),
    etfShares: document.querySelector("#etfShares"),
    etfCost: document.querySelector("#etfCost"),
    etfFormStatus: document.querySelector("#etfFormStatus"),
    etfMetrics: document.querySelector("#etfMetrics"),
    etfRows: document.querySelector("#etfRows"),
    etfEmpty: document.querySelector("#etfEmpty"),
    etfRefresh: document.querySelector("#etfRefresh"),
    etfQuoteStatus: document.querySelector("#etfQuoteStatus"),
    etfChartPanel: document.querySelector("#etfChartPanel"),
    etfChartTitle: document.querySelector("#etfChartTitle"),
    etfChartSummary: document.querySelector("#etfChartSummary"),
    etfChart: document.querySelector("#etfChart"),
    etfChartTooltip: document.querySelector("#etfChartTooltip"),

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
