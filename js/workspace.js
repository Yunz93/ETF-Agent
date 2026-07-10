import { ALERTS_KEY, CUSTOM_KEY, HOLDINGS_KEY, NOTES_KEY, PREFS_KEY, WATCHLIST_KEY, WORKSPACE_CACHE_KEY, WORKSPACE_SYNC_DEBOUNCE_MS } from "./constants.js";
import { els, provider, state, workspaceRuntime } from "./state.js";
import { loadJSON, saveJSON } from "./utils.js";
import { refreshStocks, renderHoldings, renderWatchlist, renderWorkbench } from "./views/render.js";

export function migrateWatchlist(raw) {
  const next = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    if (!value || !value.symbol || !value.market) return;
    next[key] = {
      symbol: value.symbol,
      market: value.market,
      group: value.group || "watch",
      buy: value.buy ?? value.targetPrice ?? null,
      add: value.add ?? null,
      takeProfit: value.takeProfit ?? null,
      stopLoss: value.stopLoss ?? null,
      targetPrice: value.targetPrice ?? value.buy ?? null,
      createdAt: value.createdAt || new Date().toISOString(),
    };
  });
  return next;
}

export function normalizePrefs(prefs = {}) {
  return {
    notify: Boolean(prefs?.notify),
    baseCurrency: prefs?.baseCurrency || "CNY",
    compactMode: Boolean(prefs?.compactMode),
    coreOnlyWorkbench: Boolean(prefs?.coreOnlyWorkbench),
    showWatchTargets: Boolean(prefs?.showWatchTargets),
  };
}

export function syncPrefControls() {
  if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
  if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
  if (els.prefCompact) els.prefCompact.checked = Boolean(state.prefs.compactMode);
  if (els.prefCoreOnly) els.prefCoreOnly.checked = Boolean(state.prefs.coreOnlyWorkbench);
  if (els.watchShowTargets) els.watchShowTargets.checked = Boolean(state.prefs.showWatchTargets);
}

export function applyWorkbenchPrefs() {
  document.body.classList.toggle("compact-workbench", Boolean(state.prefs.compactMode));
  document.querySelector("#watchTable")?.classList.toggle("show-targets", Boolean(state.prefs.showWatchTargets));
}

export function emptyWorkspaceBundle() {
  return {
    version: 1,
    updated_at: null,
    watchlist: {},
    holdings: {},
    notes: {},
    alertHistory: [],
    prefs: normalizePrefs(),
    customSymbols: [],
  };
}

export function workspaceHasUserData(bundle) {
  if (!bundle) return false;
  return Boolean(
    Object.keys(bundle.watchlist || {}).length ||
      Object.keys(bundle.holdings || {}).length ||
      Object.keys(bundle.notes || {}).length ||
      (bundle.alertHistory || []).length ||
      (bundle.customSymbols || []).length,
  );
}

export function readLegacyWorkspaceBundle() {
  return {
    version: 1,
    updated_at: null,
    watchlist: migrateWatchlist(loadJSON(WATCHLIST_KEY, {})),
    holdings: loadJSON(HOLDINGS_KEY, {}),
    notes: loadJSON(NOTES_KEY, {}),
    alertHistory: loadJSON(ALERTS_KEY, []),
    prefs: normalizePrefs({
      notify: Boolean(loadJSON(PREFS_KEY, { notify: false }).notify),
      baseCurrency: loadJSON(PREFS_KEY, { baseCurrency: "CNY" }).baseCurrency || "CNY",
      ...loadJSON(PREFS_KEY, {}),
    }),
    customSymbols: loadJSON(CUSTOM_KEY, []),
  };
}

export function readLocalWorkspaceBundle() {
  const cached = loadJSON(WORKSPACE_CACHE_KEY, null);
  if (cached && typeof cached === "object") {
    return {
      ...emptyWorkspaceBundle(),
      ...cached,
      watchlist: migrateWatchlist(cached.watchlist || {}),
      prefs: normalizePrefs(cached.prefs || {}),
      customSymbols: Array.isArray(cached.customSymbols) ? cached.customSymbols : [],
    };
  }
  return readLegacyWorkspaceBundle();
}

export function buildWorkspacePayload() {
  return {
    version: 1,
    updated_at: state.workspaceSync.updatedAt || new Date().toISOString(),
    watchlist: state.watchlist,
    holdings: state.holdings,
    notes: state.notes,
    alertHistory: state.alertHistory.slice(0, 100),
    prefs: normalizePrefs(state.prefs),
    customSymbols: (provider.customCatalog || []).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      englishName: item.englishName,
      market: item.market,
      exchange: item.exchange,
      currency: item.currency,
      industry: item.industry || "自定义",
    })),
  };
}

export function writeLocalWorkspaceCache(bundle = buildWorkspacePayload()) {
  saveJSON(WORKSPACE_CACHE_KEY, bundle);
  // Keep legacy keys in sync for older tabs / rollback.
  saveJSON(WATCHLIST_KEY, bundle.watchlist || {});
  saveJSON(HOLDINGS_KEY, bundle.holdings || {});
  saveJSON(NOTES_KEY, bundle.notes || {});
  saveJSON(ALERTS_KEY, bundle.alertHistory || []);
  saveJSON(PREFS_KEY, bundle.prefs || { notify: false, baseCurrency: "CNY" });
  saveJSON(CUSTOM_KEY, bundle.customSymbols || []);
}

export function applyLocalWorkspace(bundle, { source = "local", markDirty = false } = {}) {
  const normalized = {
    ...emptyWorkspaceBundle(),
    ...(bundle || {}),
    watchlist: migrateWatchlist(bundle?.watchlist || {}),
    holdings: bundle?.holdings || {},
    notes: bundle?.notes || {},
    alertHistory: Array.isArray(bundle?.alertHistory) ? bundle.alertHistory : [],
    prefs: normalizePrefs(bundle?.prefs || {}),
    customSymbols: Array.isArray(bundle?.customSymbols) ? bundle.customSymbols : [],
  };

  state.watchlist = normalized.watchlist;
  state.holdings = normalized.holdings;
  state.notes = normalized.notes;
  state.alertHistory = normalized.alertHistory;
  state.prefs = normalized.prefs;
  state.workspaceSync.updatedAt = normalized.updated_at;
  state.workspaceSync.source = source;
  state.workspaceSync.error = null;
  state.workspaceSync.status = markDirty ? "pending" : "synced";
  syncPrefControls();
  applyWorkbenchPrefs();

  provider.customCatalog = normalized.customSymbols.map((item, index) => ({
    ...item,
    listing_status: "listed",
    sortIndex: 1000 + index,
    custom: true,
  }));

  writeLocalWorkspaceCache(normalized);
  renderWorkspaceStatus();
  return normalized;
}

export async function hydrateWorkspace() {
  state.workspaceSync.status = "loading";
  renderWorkspaceStatus();
  const localBundle = readLocalWorkspaceBundle();

  try {
    const response = await fetch("/api/workspace");
    if (!response.ok) throw new Error(`Workspace API ${response.status}`);
    const remote = await response.json();
    const remoteHasData = workspaceHasUserData(remote);
    const localHasData = workspaceHasUserData(localBundle);

    if (!remoteHasData && localHasData) {
      applyLocalWorkspace(localBundle, { source: "migrated-local", markDirty: false });
      state.workspaceSync.status = "syncing";
      renderWorkspaceStatus();
      await flushWorkspaceToServer();
      return;
    }

    applyLocalWorkspace(remoteHasData ? remote : localBundle, {
      source: remoteHasData ? "server" : "local-empty",
      markDirty: false,
    });
    state.workspaceSync.status = "synced";
    renderWorkspaceStatus();
  } catch (error) {
    console.warn("工作区同步失败，使用本地缓存。", error);
    applyLocalWorkspace(localBundle, { source: "local-offline", markDirty: false });
    state.workspaceSync.status = "offline";
    state.workspaceSync.error = error.message || String(error);
    renderWorkspaceStatus();
  }
}

export function persistWorkspace({ immediate = false } = {}) {
  writeLocalWorkspaceCache();
  state.workspaceSync.status = "pending";
  state.workspaceSync.error = null;
  renderWorkspaceStatus();

  if (immediate) {
    if (workspaceRuntime.saveTimer) {
      clearTimeout(workspaceRuntime.saveTimer);
      workspaceRuntime.saveTimer = null;
    }
    return flushWorkspaceToServer();
  }

  if (workspaceRuntime.saveTimer) clearTimeout(workspaceRuntime.saveTimer);
  workspaceRuntime.saveTimer = setTimeout(() => {
    workspaceRuntime.saveTimer = null;
    flushWorkspaceToServer();
  }, WORKSPACE_SYNC_DEBOUNCE_MS);
}

export async function flushWorkspaceToServer() {
  if (workspaceRuntime.saveInFlight) return workspaceRuntime.saveInFlight;

  const payload = buildWorkspacePayload();
  state.workspaceSync.status = "syncing";
  renderWorkspaceStatus();

  workspaceRuntime.saveInFlight = (async () => {
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || `保存失败 ${response.status}`);
      state.workspaceSync.updatedAt = saved.updated_at || new Date().toISOString();
      state.workspaceSync.status = "synced";
      state.workspaceSync.source = "server";
      state.workspaceSync.error = null;
      writeLocalWorkspaceCache({
        ...payload,
        updated_at: state.workspaceSync.updatedAt,
      });
    } catch (error) {
      console.warn("工作区写入服务器失败。", error);
      state.workspaceSync.status = "error";
      state.workspaceSync.error = error.message || String(error);
    } finally {
      workspaceRuntime.saveInFlight = null;
      renderWorkspaceStatus();
    }
  })();

  return workspaceRuntime.saveInFlight;
}

export function renderWorkspaceStatus() {
  if (!els.workspaceStatus) return;
  const { status, updatedAt, error, source } = state.workspaceSync;
  const timeLabel = updatedAt ? ` · ${updatedAt}` : "";
  const labels = {
    idle: "尚未同步",
    loading: "正在加载工作区…",
    pending: "有未同步更改，稍后写入服务器",
    syncing: "正在写入 workspace.json…",
    synced: `已同步到服务器${timeLabel}`,
    offline: `离线模式，使用本地缓存${timeLabel}`,
    error: `同步失败：${error || "未知错误"}（本地已保存）`,
  };
  els.workspaceStatus.textContent = `${labels[status] || labels.idle}${source ? ` · 来源 ${source}` : ""}`;
  els.workspaceStatus.dataset.status = status;
}

export function exportWorkspaceBackup() {
  const payload = buildWorkspacePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stockagent-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importWorkspaceBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    applyLocalWorkspace(payload, { source: "import", markDirty: false });
    await persistWorkspace({ immediate: true });
    provider.invalidateAll();
    await refreshStocks({ resetQuotes: true });
    renderWorkbench();
    renderWatchlist();
    renderHoldings();
    if (els.baseCurrency) els.baseCurrency.value = state.prefs.baseCurrency || "CNY";
    if (els.prefNotify) els.prefNotify.checked = Boolean(state.prefs.notify);
    syncPrefControls();
    applyWorkbenchPrefs();
    renderWorkspaceStatus();
  } catch (error) {
    state.workspaceSync.status = "error";
    state.workspaceSync.error = error.message || String(error);
    renderWorkspaceStatus();
  } finally {
    event.target.value = "";
  }
}

export function saveWatchlist() {
  persistWorkspace();
}

export function savePrefs() {
  persistWorkspace();
}

export function loadCustomSymbols() {
  const cached = readLocalWorkspaceBundle();
  return Array.isArray(cached.customSymbols) ? cached.customSymbols : [];
}

export function saveCustomSymbols(list) {
  provider.customCatalog = list.map((item, index) => ({
    ...item,
    listing_status: "listed",
    sortIndex: 1000 + index,
    custom: true,
  }));
  persistWorkspace();
}
