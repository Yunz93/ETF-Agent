import { els, state } from "./state.js";
import { buildWorkspacePayload, exportWorkspaceBackup, importWorkspaceBackup, persistWorkspace } from "./workspace.js";
import { loadAppConfig, saveAppConfig } from "./settings.js";
import { switchView, syncSidebarForViewport, toggleSidebar, toggleTheme } from "./navigation.js";
import { addEtf, addBuyRecord, readPlanFormIntoState, selectEtfChart } from "./views/etf.js";
import { renderDividend, renderEtfPool } from "./views/render.js";

export function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.dividendRefresh?.addEventListener("click", () => {
    renderDividend({ force: true });
  });

  els.etfRefresh?.addEventListener("click", () => {
    renderEtfPool({ refresh: true });
  });

  els.dcaPlanForm?.addEventListener("change", () => {
    readPlanFormIntoState();
    persistWorkspace();
    renderEtfPool();
  });

  els.etfForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addEtf(els.etfSymbol?.value, els.etfShares?.value, els.etfCost?.value, els.etfTargetWeight?.value);
  });

  els.buyForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    addBuyRecord();
  });

  els.buySymbol?.addEventListener("change", () => {
    const symbol = els.buySymbol.value;
    const quote = state.quotesBySymbol[symbol];
    if (quote?.price != null && els.buyPrice && !els.buyPrice.value) {
      els.buyPrice.value = String(quote.price);
    }
  });

  if (els.buyDate && !els.buyDate.value) {
    els.buyDate.value = new Date().toISOString().slice(0, 10);
  }

  document.querySelectorAll("#etfChartPanel .js-range").forEach((button) => {
    button.addEventListener("click", () => {
      state.priceRange = button.dataset.range;
      if (state.selectedEtf) selectEtfChart(state.selectedEtf);
    });
  });

  els.exportWorkspace?.addEventListener("click", exportWorkspaceBackup);
  els.importWorkspace?.addEventListener("click", () => els.importWorkspaceFile?.click());
  els.importWorkspaceFile?.addEventListener("change", importWorkspaceBackup);
  els.syncWorkspaceNow?.addEventListener("click", () => persistWorkspace({ immediate: true }));

  els.saveConfig?.addEventListener("click", saveAppConfig);
  els.resetConfig?.addEventListener("click", () => loadAppConfig({ rerender: true }));

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.sidebarToggle?.addEventListener("click", toggleSidebar);
  window.addEventListener("resize", syncSidebarForViewport);

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
