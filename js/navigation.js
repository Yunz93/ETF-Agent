import { PAGE_TITLES, SIDEBAR_COLLAPSE_MIN, SIDEBAR_KEY, THEME_KEY } from "./constants.js";
import { els, provider, state } from "./state.js";
import { renderSettings } from "./settings.js";
import { registerRenderers, refreshStocks, renderCompare, renderDetail, renderDividend, renderHoldings, renderIndexSegment, renderPager, renderResearchLoadStatus, renderRows, renderWatchlist, renderWorkbench, selectStock } from "./views/render.js";

export function switchView(view) {
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
  if (view === "dividend") renderDividend();
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

export function showDetail(stock, { updateHash = true } = {}) {
  state.activeView = "detail";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === "detailView"));
  if (els.pageTitle) els.pageTitle.textContent = PAGE_TITLES.detail;
  if (updateHash) {
    history.pushState(null, "", `#/stock/${stock.market}/${encodeURIComponent(stock.symbol)}`);
  }
}

export function showDashboard({ clearHash = false } = {}) {
  switchView("workbench");
  if (clearHash) history.pushState(null, "", location.pathname);
}

export async function restoreRoute() {
  const match = location.hash.match(/^#\/stock\/(A|HK|US)\/([^/]+)$/i);
  if (!match) return;
  const market = match[1].toUpperCase();
  const symbol = decodeURIComponent(match[2]).toUpperCase();
  const stock = await provider.getStock(symbol, market);
  if (stock) selectStock(stock, { openDetail: true, updateHash: false });
}

export function syncMarketShortcuts() {
  // Market shortcuts removed from global topbar; index controls live in research view.
}

export function renderSourceStatus() {
  const label = provider.status.quoteLabel || "行情连接中";
  els.topSourceStatus.textContent = label;
  document.body.dataset.quoteStatus = provider.status.quote || "connecting";
}
export function resolveTheme(stored) {
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initSidebar() {
  const stored = localStorage.getItem(SIDEBAR_KEY);
  applySidebar(stored === "collapsed" ? "collapsed" : "expanded", { persist: false });
  syncSidebarForViewport();
}

export function toggleSidebar() {
  const next = document.documentElement.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
  applySidebar(next);
}

export function syncSidebarForViewport() {
  if (window.innerWidth <= SIDEBAR_COLLAPSE_MIN - 1) {
    applySidebar("expanded", { persist: false });
  } else {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "collapsed") applySidebar("collapsed", { persist: false });
  }
}

export function applySidebar(next, { persist = true } = {}) {
  if (next === "collapsed") document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  if (persist) localStorage.setItem(SIDEBAR_KEY, next);
  if (els.sidebarToggle) {
    els.sidebarToggle.setAttribute("aria-expanded", next !== "collapsed" ? "true" : "false");
    els.sidebarToggle.setAttribute("aria-label", next === "collapsed" ? "展开侧边栏" : "收起侧边栏");
  }
}

export function initTheme() {
  applyTheme(document.documentElement.dataset.theme || resolveTheme(localStorage.getItem(THEME_KEY)));
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  if (els.themeToggle) {
    els.themeToggle.setAttribute("aria-label", theme === "dark" ? "切换到明亮模式" : "切换到暗黑模式");
    const icon = els.themeToggle.querySelector(".theme-icon");
    if (icon) icon.textContent = theme === "dark" ? "☀" : "☾";
  }
  if (state.selected) renderDetail();
}

export function themeChartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    grid: styles.getPropertyValue("--chart-grid").trim(),
    line: styles.getPropertyValue("--chart-line").trim(),
    label: styles.getPropertyValue("--chart-label").trim(),
  };
}

registerRenderers({ switchView, showDetail, renderSourceStatus });
