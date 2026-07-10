import { PAGE_SIZE, RESEARCH_INDICES } from "./constants.js";

export let appConfig = null;
export function setAppConfig(nextConfig) {
  appConfig = nextConfig;
}

export let provider = null;
export function setProvider(nextProvider) {
  provider = nextProvider;
}

export const state = {
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

export const workspaceRuntime = {
  saveTimer: null,
  saveInFlight: null,
};

export const els = {};

export function initEls() {
  Object.assign(els, {
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
});
}
