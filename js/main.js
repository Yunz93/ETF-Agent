import { HybridProvider } from "./provider.js";
import { initEls, setProvider, state } from "./state.js";
import { loadAppConfig } from "./settings.js";
import { bindEvents } from "./events.js";
import { applyLocalWorkspace, applyWorkbenchPrefs, hydrateWorkspace, readLocalWorkspaceBundle, renderWorkspaceStatus, syncPrefControls } from "./workspace.js";
import { initSidebar, initTheme, restoreRoute } from "./navigation.js";
import { renderCompare, renderIndexSegment, refreshStocks } from "./views/research.js";
import { renderWatchlist } from "./views/watchlist.js";
import { renderHoldings } from "./views/holdings.js";
import { renderWorkbench, evaluateAlerts } from "./views/workbench.js";
import { selectStock } from "./views/detail.js";

export async function init() {
  initEls();
  setProvider(new HybridProvider());
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

init();
