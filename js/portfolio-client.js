import { state } from "./state.js";

export async function loadPortfolio({ refresh = false } = {}) {
  const response = await fetch(`/api/portfolio${refresh ? "?refresh=1" : ""}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "无法读取组合");
  acceptPortfolio(result);
  return result;
}

export function acceptPortfolio(result) {
  state.portfolioEnvelope = result;
  // Research consumes a projection, and never writes this back into the ledger.
  state.etfs = result.portfolio.products.filter(p => p.kind === "exchange").map(p => {
    const row = result.summary.products.find(r => r.id === p.id);
    return { symbol: p.symbol, name: p.name, shares: row?.shares || 0,
      cost: row?.shares && row?.cost != null ? row.cost / row.shares : 0, target_weight: 0 };
  });
  state.quotesBySymbol = Object.fromEntries(result.portfolio.products.filter(p => p.quote).map(p => [p.symbol, p.quote]));
}

export async function portfolioCommand(action, data = {}) {
  const current = state.portfolioEnvelope;
  const response = await fetch("/api/portfolio", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data, revision: current.portfolio.revision,
      draft: current.active ? undefined : current.portfolio,
      workspace_updated_at: current.workspace_updated_at }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存失败");
  acceptPortfolio(result);
  return result;
}
