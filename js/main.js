import { initEls } from "./state.js";
import { loadAppConfig } from "./settings.js";
import { bindEvents } from "./events.js";
import { hydrateWorkspace, renderWorkspaceStatus } from "./workspace.js";
import { initSidebar, initTheme, switchView } from "./navigation.js";
import "./views/dividend.js";
import "./views/etf.js";

export async function init() {
  initEls();
  initTheme();
  initSidebar();
  bindEvents();
  await loadAppConfig();
  await hydrateWorkspace();
  renderWorkspaceStatus();
  switchView("dividend");
}

init();
