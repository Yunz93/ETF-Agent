import { MOBILE_SIDEBAR_MAX, PAGE_TITLES, SIDEBAR_COLLAPSE_MIN, SIDEBAR_KEY, THEME_KEY } from "./constants.js";
import { appConfig, els, state } from "./state.js";
import { registerRenderers, renderDividend, renderEtfPool, renderSettings, renderSidebarEtfs, openAnalysis } from "./views/render.js";

export function switchView(view) {
  if (view === "dividend") {
    const symbol = state.analysisSymbol || defaultAnalysisSymbol();
    if (symbol) {
      openAnalysis(symbol);
      return;
    }
    view = "etf";
  }
  if (!PAGE_TITLES[view]) view = "etf";
  state.activeView = view;
  if (view !== "dividend") state.analysisSymbol = null;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  if (els.pageTitle) els.pageTitle.textContent = PAGE_TITLES[view] || "ETF Agent";
  document.querySelector(`#${view}View`)?.scrollIntoView({ block: "start" });
  if (view === "etf") renderEtfPool();
  if (view === "settings") renderSettings();
  renderSidebarEtfs();
  closeMobileSidebar();
}

function defaultAnalysisSymbol() {
  const preferred = appConfig?.dividend?.etf_symbol || "512890";
  if (state.etfs.some((item) => item.symbol === preferred)) return preferred;
  return state.etfs[0]?.symbol || null;
}

export function setSourceStatus(label, statusKey = "connected") {
  if (els.topSourceStatus) els.topSourceStatus.textContent = label;
  document.body.dataset.quoteStatus = statusKey;
}

export function resolveTheme(stored) {
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initSidebar() {
  const stored = localStorage.getItem(SIDEBAR_KEY);
  applySidebar(stored === "collapsed" ? "collapsed" : "expanded", { persist: false });
  applyMobileSidebar(false);
  syncSidebarForViewport();
}

export function toggleSidebar() {
  const next = document.documentElement.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
  applySidebar(next);
}

export function syncSidebarForViewport() {
  if (window.innerWidth > MOBILE_SIDEBAR_MAX) {
    applyMobileSidebar(false);
  }
  if (window.innerWidth <= SIDEBAR_COLLAPSE_MIN - 1) {
    applySidebar("expanded", { persist: false });
  } else {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "collapsed") applySidebar("collapsed", { persist: false });
  }
}

function applyMobileSidebar(open, { restoreFocus = false } = {}) {
  const mobileViewport = window.innerWidth <= MOBILE_SIDEBAR_MAX;
  const nextOpen = open && mobileViewport;
  const sidebar = document.querySelector("#appSidebar");
  if (nextOpen) document.documentElement.dataset.mobileSidebar = "open";
  else delete document.documentElement.dataset.mobileSidebar;
  if (sidebar) {
    sidebar.toggleAttribute("inert", mobileViewport && !nextOpen);
    if (mobileViewport) sidebar.setAttribute("aria-hidden", String(!nextOpen));
    else sidebar.removeAttribute("aria-hidden");
  }
  if (els.mobileSidebarToggle) {
    els.mobileSidebarToggle.setAttribute("aria-expanded", String(nextOpen));
    els.mobileSidebarToggle.setAttribute("aria-label", nextOpen ? "关闭导航" : "打开导航");
  }
  if (els.sidebarBackdrop) {
    els.sidebarBackdrop.setAttribute("aria-hidden", String(!nextOpen));
    els.sidebarBackdrop.tabIndex = nextOpen ? 0 : -1;
  }
  if (nextOpen) els.mobileSidebarClose?.focus();
  if (!nextOpen && restoreFocus) els.mobileSidebarToggle?.focus();
}

export function closeMobileSidebar({ restoreFocus = false } = {}) {
  applyMobileSidebar(false, { restoreFocus });
}

export function toggleMobileSidebar() {
  const open = document.documentElement.dataset.mobileSidebar === "open";
  applyMobileSidebar(!open, { restoreFocus: open });
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
  if (state.activeView === "dividend") renderDividend();
  if (state.activeView === "etf") renderEtfPool();
}

export function themeChartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    grid: styles.getPropertyValue("--chart-grid").trim(),
    line: styles.getPropertyValue("--chart-line").trim(),
    label: styles.getPropertyValue("--chart-label").trim(),
  };
}

registerRenderers({ switchView });
