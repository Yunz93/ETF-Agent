import { WORKSPACE_CACHE_KEY, WORKSPACE_SYNC_DEBOUNCE_MS } from "./constants.js";
import { appConfig, els, state, workspaceRuntime } from "./state.js";
import { loadJSON, saveJSON } from "./utils.js";

export function buildWorkspacePayload() {
  return {
    version: 2,
    etfs: state.etfs,
    prefs: {},
  };
}

export function readLocalWorkspaceCache() {
  return loadJSON(WORKSPACE_CACHE_KEY, null);
}

export function writeLocalWorkspaceCache() {
  saveJSON(WORKSPACE_CACHE_KEY, buildWorkspacePayload());
}

function applyWorkspace(payload, source) {
  if (!payload || !Array.isArray(payload.etfs)) return false;
  state.etfs = payload.etfs
    .filter((item) => item && item.symbol)
    .map((item) => ({
      symbol: String(item.symbol),
      name: String(item.name || ""),
      shares: Number(item.shares) > 0 ? Number(item.shares) : 0,
      cost: Number(item.cost) > 0 ? Number(item.cost) : 0,
      note: String(item.note || ""),
    }));
  state.workspaceSync.source = source;
  return true;
}

function seedDefaultPool() {
  const pool = appConfig?.etf?.pool || [];
  state.etfs = pool.map((item) => ({
    symbol: String(item.symbol),
    name: String(item.name || ""),
    shares: 0,
    cost: 0,
    note: "",
  }));
  state.workspaceSync.source = "default-pool";
}

export async function hydrateWorkspace() {
  const local = readLocalWorkspaceCache();
  try {
    const response = await fetch("/api/workspace");
    if (!response.ok) throw new Error(`workspace API ${response.status}`);
    const remote = await response.json();
    if (Array.isArray(remote.etfs) && remote.etfs.length) {
      applyWorkspace(remote, "server");
      state.workspaceSync.status = "synced";
      state.workspaceSync.updatedAt = remote.updated_at || null;
    } else if (local && Array.isArray(local.etfs) && local.etfs.length) {
      // 服务器为空时迁移浏览器缓存
      applyWorkspace(local, "local-cache");
      await persistWorkspace({ immediate: true });
    } else {
      seedDefaultPool();
      await persistWorkspace({ immediate: true });
    }
  } catch (error) {
    if (local && Array.isArray(local.etfs) && local.etfs.length) {
      applyWorkspace(local, "local-cache");
    } else {
      seedDefaultPool();
    }
    state.workspaceSync.status = "offline";
    state.workspaceSync.error = String(error);
  }
  writeLocalWorkspaceCache();
  renderWorkspaceStatus();
}

export function persistWorkspace({ immediate = false } = {}) {
  writeLocalWorkspaceCache();
  state.workspaceSync.status = "pending";
  renderWorkspaceStatus();
  if (workspaceRuntime.saveTimer) {
    clearTimeout(workspaceRuntime.saveTimer);
    workspaceRuntime.saveTimer = null;
  }
  const run = async () => {
    state.workspaceSync.status = "syncing";
    renderWorkspaceStatus();
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildWorkspacePayload()),
      });
      if (!response.ok) throw new Error(`workspace API ${response.status}`);
      const saved = await response.json();
      state.workspaceSync.status = "synced";
      state.workspaceSync.updatedAt = saved.updated_at || null;
      state.workspaceSync.error = null;
    } catch (error) {
      state.workspaceSync.status = "offline";
      state.workspaceSync.error = String(error);
    }
    renderWorkspaceStatus();
  };
  if (immediate) return run();
  workspaceRuntime.saveTimer = setTimeout(run, WORKSPACE_SYNC_DEBOUNCE_MS);
  return undefined;
}

export function renderWorkspaceStatus() {
  if (!els.workspaceStatus) return;
  const { status, updatedAt, error } = state.workspaceSync;
  const labels = {
    idle: "尚未同步",
    pending: "待同步…",
    syncing: "同步中…",
    synced: `已同步到 workspace.json${updatedAt ? ` · ${updatedAt}` : ""}`,
    offline: `离线（仅浏览器缓存）${error ? ` · ${error}` : ""}`,
  };
  els.workspaceStatus.textContent = labels[status] || status;
}

export function exportWorkspaceBackup() {
  const payload = JSON.stringify(buildWorkspacePayload(), null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stockagent-etf-workspace-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importWorkspaceBackup(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!Array.isArray(payload.etfs)) throw new Error("备份文件缺少 etfs 字段");
    applyWorkspace(payload, "import");
    await persistWorkspace({ immediate: true });
    const { renderEtfPool } = await import("./views/render.js");
    renderEtfPool({ refresh: true });
  } catch (error) {
    if (els.workspaceStatus) els.workspaceStatus.textContent = `导入失败：${error}`;
  } finally {
    event.target.value = "";
  }
}
