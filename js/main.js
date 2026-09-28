import { hydrateAnalysisCacheFromSession } from "./analysis-cache.js";
import { initEls, setRuntimeInfo } from "./state.js";
import { loadAppConfig } from "./settings.js";
import { bindEvents } from "./portfolio-events.js";
import { hydrateWorkspace } from "./workspace.js";
import { syncDecisionProjection } from "./views/decision.js";
import { initSidebar, initTheme, switchView } from "./navigation.js";
import { renderEtfPool, renderSidebarEtfs } from "./views/render.js";
import { ensureMarketSentiment } from "./market-sentiment.js";
import { ensureGoldMacro } from "./gold-macro.js";
import "./views/dividend.js";
import "./views/decision.js";

async function loadRuntimeInfo() {
  try {
    const response = await fetch("/api/runtime");
    if (!response.ok) throw new Error(`runtime API ${response.status}`);
    setRuntimeInfo(await response.json());
  } catch {
    setRuntimeInfo({ ephemeral_storage: false });
  }
}

export async function init() {
  hydrateAnalysisCacheFromSession();
  initEls();
  initTheme();
  initSidebar();
  bindEvents();
  await loadRuntimeInfo();
  await loadAppConfig();
  try {
    await hydrateWorkspace();
    syncDecisionProjection();
  } catch (error) {
    const root = document.querySelector("#homeView [data-portfolio-root]");
    if (root) root.textContent = `读取组合失败：${error.message}。请刷新页面重试。`;
    return;
  }
  renderSidebarEtfs();
  switchView("home");
  await Promise.all([
    renderEtfPool({ refresh: false }).catch(() => {}),
    ensureMarketSentiment({ refresh: false }).catch(() => {}),
    ensureGoldMacro({ refresh: false }).catch(() => {}),
  ]);
}

init();
