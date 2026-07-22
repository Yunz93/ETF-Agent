export const renderers = {};

export function registerRenderers(partial) {
  Object.assign(renderers, partial);
}

export function callRenderer(name, ...args) {
  const fn = renderers[name];
  if (typeof fn !== "function") return undefined;
  return fn(...args);
}

export const renderSourceStatus = (...args) => callRenderer("renderSourceStatus", ...args);
export const renderIndexSegment = (...args) => callRenderer("renderIndexSegment", ...args);
export const renderResearchLoadStatus = (...args) => callRenderer("renderResearchLoadStatus", ...args);
export const refreshStocks = (...args) => callRenderer("refreshStocks", ...args);
export const renderRows = (...args) => callRenderer("renderRows", ...args);
export const renderPager = (...args) => callRenderer("renderPager", ...args);
export const renderCompare = (...args) => callRenderer("renderCompare", ...args);
export const compareIndustryPeers = (...args) => callRenderer("compareIndustryPeers", ...args);
export const selectStock = (...args) => callRenderer("selectStock", ...args);
export const renderDetail = (...args) => callRenderer("renderDetail", ...args);
export const paintDetail = (...args) => callRenderer("paintDetail", ...args);
export const renderWatchlist = (...args) => callRenderer("renderWatchlist", ...args);
export const toggleWatch = (...args) => callRenderer("toggleWatch", ...args);
export const renderHoldings = (...args) => callRenderer("renderHoldings", ...args);
export const renderWorkbench = (...args) => callRenderer("renderWorkbench", ...args);
export const renderDividend = (...args) => callRenderer("renderDividend", ...args);
export const evaluateAlerts = (...args) => callRenderer("evaluateAlerts", ...args);
export const switchView = (...args) => callRenderer("switchView", ...args);
export const showDetail = (...args) => callRenderer("showDetail", ...args);
