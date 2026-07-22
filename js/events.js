import { els, state } from "./state.js";
import { buildWorkspacePayload, exportWorkspaceBackup, importWorkspaceBackup, persistWorkspace, savePrefs, saveWatchlist, applyWorkbenchPrefs } from "./workspace.js";
import { loadAppConfig, saveAppConfig } from "./settings.js";
import { exportSelectedMarkdown } from "./markdown.js";
import { restoreRoute, syncSidebarForViewport, toggleSidebar, toggleTheme } from "./navigation.js";
import { addSymbolsToWatchlist } from "./views/watchlist.js";
import { upsertHolding } from "./views/holdings.js";
import { compareIndustryPeers, refreshStocks, renderCompare, renderDetail, renderDividend, renderHoldings, renderRows, renderWatchlist, renderWorkbench, switchView } from "./views/render.js";

export function bindEvents() {
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

  els.dividendRefresh?.addEventListener("click", () => {
    renderDividend({ force: true });
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
