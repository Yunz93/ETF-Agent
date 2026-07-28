export const renderers = {};

export function registerRenderers(partial) {
  Object.assign(renderers, partial);
}

export function callRenderer(name, ...args) {
  const fn = renderers[name];
  if (typeof fn !== "function") return undefined;
  return fn(...args);
}

export const renderDividend = (...args) => callRenderer("renderDividend", ...args);
export const renderEtfPool = (...args) => callRenderer("renderEtfPool", ...args);
export const renderSidebarEtfs = (...args) => callRenderer("renderSidebarEtfs", ...args);
export const renderSettings = (...args) => callRenderer("renderSettings", ...args);
export const openAnalysis = (...args) => callRenderer("openAnalysis", ...args);
export const switchView = (...args) => callRenderer("switchView", ...args);
