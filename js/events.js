import { els, state, workspaceRuntime } from "./state.js";
import {
  buildWorkspacePayload,
  exportWorkspaceBackup,
  importWorkspaceBackup,
  persistWorkspace,
  writeLocalWorkspaceCache,
} from "./workspace.js";
import { saveAppConfig } from "./settings.js";
import {
  closeMobileSidebar,
  switchView,
  syncSidebarForViewport,
  toggleMobileSidebar,
  toggleSidebar,
  toggleTheme,
} from "./navigation.js";
import {
  addEtf,
  addBuyRecord,
  cancelBuyEdit,
  importSeedPool,
  readPlanFormIntoState,
  renderBuys,
  selectEtfChart,
} from "./views/etf.js";
import { renderDividend, renderEtfPool } from "./views/render.js";

export function bindEvents() {
  const etfTabs = [...document.querySelectorAll("[data-etf-tab]")];
  const etfPanels = [...document.querySelectorAll("[data-etf-panel]")];
  const activateEtfTab = (tab, { focus = false } = {}) => {
    const name = tab?.dataset.etfTab;
    if (!name) return;
    etfTabs.forEach((button) => {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    etfPanels.forEach((panel) => {
      panel.hidden = panel.dataset.etfPanel !== name;
    });
    if (focus) tab.focus();
  };

  etfTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateEtfTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % etfTabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + etfTabs.length) % etfTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = etfTabs.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      activateEtfTab(etfTabs[nextIndex], { focus: true });
    });
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  els.sidebarEtfList?.addEventListener("click", (event) => {
    if (event.target.closest("[data-analyze]")) closeMobileSidebar();
  });

  els.importSeedPool?.addEventListener("click", () => importSeedPool());
  document.addEventListener("click", (event) => {
    const seed = event.target.closest?.("[data-import-seed-pool]");
    if (seed) importSeedPool();
  });
  els.dividendRefresh?.addEventListener("click", () => {
    renderDividend({ force: true });
  });

  els.etfRefresh?.addEventListener("click", () => {
    renderEtfPool({ refresh: true });
  });

  const persistPlan = ({ rerender = true } = {}) => {
    readPlanFormIntoState();
    persistWorkspace();
    // input 过程不要整页重绘，否则 syncPlanForm 会打乱正在输入的光标
    if (rerender) renderEtfPool();
  };

  // change：失焦提交并刷新概览；input：仅写入 state/磁盘（debounce PUT）
  els.dcaPlanForm?.addEventListener("change", () => persistPlan({ rerender: true }));
  els.dcaPlanForm?.addEventListener("input", () => persistPlan({ rerender: false }));
  els.dcaPlanForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    persistPlan({ rerender: true });
  });
  els.planStrategyCustom?.addEventListener("change", () => persistPlan({ rerender: true }));
  els.planStrategyCustom?.addEventListener("input", () => persistPlan({ rerender: false }));
  els.planAddPlan?.addEventListener("change", () => persistPlan({ rerender: true }));

  els.etfForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addEtf(els.etfSymbol?.value, els.etfShares?.value, els.etfCost?.value, els.etfTargetWeight?.value);
  });

  els.buyForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    addBuyRecord();
  });
  els.buyCancelEdit?.addEventListener("click", cancelBuyEdit);
  els.buyFilterSymbol?.addEventListener("change", renderBuys);
  els.buyFilterType?.addEventListener("change", renderBuys);
  els.tradeType?.addEventListener("change", () => {
    if (els.buyCancelEdit?.hidden && els.buySubmit) {
      els.buySubmit.textContent = els.tradeType.value === "sell" ? "添加卖出" : "添加买入";
    }
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
  els.syncWorkspaceNow?.addEventListener("click", () => {
    try {
      if (workspaceRuntime.planFormReady) readPlanFormIntoState();
    } catch {
      /* form may be unavailable */
    }
    persistWorkspace({ immediate: true, announce: true });
  });

  els.saveConfig?.addEventListener("click", saveAppConfig);

  els.themeToggle?.addEventListener("click", toggleTheme);
  els.sidebarToggle?.addEventListener("click", toggleSidebar);
  els.mobileSidebarToggle?.addEventListener("click", toggleMobileSidebar);
  els.mobileSidebarClose?.addEventListener("click", () => closeMobileSidebar({ restoreFocus: true }));
  els.sidebarBackdrop?.addEventListener("click", () => closeMobileSidebar({ restoreFocus: true }));
  document.addEventListener("keydown", (event) => {
    const mobileSidebarOpen = document.documentElement.dataset.mobileSidebar === "open";
    if (event.key === "Escape" && mobileSidebarOpen) {
      closeMobileSidebar({ restoreFocus: true });
      return;
    }
    if (event.key !== "Tab" || !mobileSidebarOpen) return;
    const focusable = [...document.querySelectorAll(
      "#appSidebar button:not([disabled]), #appSidebar a[href], #appSidebar input:not([disabled]), #appSidebar select:not([disabled])",
    )].filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("resize", syncSidebarForViewport);

  window.addEventListener("beforeunload", () => {
    try {
      // 表单尚未从 state 回填前禁止回读，否则空表单会冲掉刚 hydrate 的计划并污染 localStorage
      if (workspaceRuntime.planFormReady) readPlanFormIntoState();
    } catch {
      /* form may be unavailable during teardown */
    }
    try {
      writeLocalWorkspaceCache({
        updatedAt:
          state.workspaceSync.status === "synced" ? state.workspaceSync.updatedAt : null,
      });
    } catch {
      /* ignore cache failures */
    }
    if (
      state.workspaceSync.status === "pending" ||
      state.workspaceSync.status === "syncing" ||
      state.workspaceSync.status === "offline"
    ) {
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
