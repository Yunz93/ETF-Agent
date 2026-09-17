/** Source-attributed fund disclosures; partial coverage never becomes a complete exposure. */
function validDisclosureDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validSource(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && Boolean(url.hostname); } catch { return false; }
}

export function normalizeFundDisclosures(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([symbol, report]) => {
    if (!/^\d{6}$/.test(symbol) || !report || !validSource(report.source_url) || !validDisclosureDate(report.as_of) || !Array.isArray(report.holdings) || report.holdings.length > 1000) return [];
    const seen = new Set();
    const holdings = report.holdings.slice(0, 1000).map((row) => {
      const weight = row?.weight_pct == null || typeof row.weight_pct === "boolean" || row.weight_pct === "" ? NaN : Number(row.weight_pct);
      const id = String(row?.id || "").trim();
      if (!id || seen.has(id) || !Number.isFinite(weight) || weight <= 0 || weight > 100) return null;
      seen.add(id);
      return { id, name: String(row.name || id), weight_pct: weight, sector: String(row.sector || "待识别"), currency: String(row.currency || "待识别") };
    });
    if (!holdings.length || holdings.some((row) => !row) || holdings.reduce((sum, row) => sum + row.weight_pct, 0) > 100.01) return [];
    return [[symbol, { source_url: report.source_url, as_of: report.as_of, holdings }]];
  }));
}

export function lookThroughPortfolio(rows, disclosures, today = new Date()) {
  const reports = normalizeFundDisclosures(disclosures);
  const targetSum = rows.reduce((sum, row) => sum + row.target, 0);
  if (Math.abs(targetSum - 100) >= 0.01) return { known: null, coverage: [], companies: [], sectors: [], currencies: [], status: "invalid_target" };
  const companies = new Map(), sectors = new Map(), currencies = new Map();
  const coverage = [];
  for (const row of rows) {
    const report = reports[row.symbol];
    const age = report ? (Date.parse(today.toLocaleDateString("sv-SE")) - Date.parse(report.as_of)) / 86400000 : null;
    const usable = report && Number.isFinite(age) && age >= 0 && age <= 120;
    coverage.push({ symbol: row.symbol, asOf: report?.as_of || null, source: report?.source_url || null,
      status: !report ? "missing" : usable ? "available" : "stale", percent: usable ? report.holdings.reduce((sum, item) => sum + item.weight_pct, 0) : 0 });
    if (!usable) continue;
    for (const item of report.holdings) {
      const weight = row.target * item.weight_pct / 100;
      const company = companies.get(item.id) || { id: item.id, name: item.name, target: 0, funds: [] };
      company.target += weight;
      company.funds.push(row.symbol);
      companies.set(item.id, company);
      sectors.set(item.sector, (sectors.get(item.sector) || 0) + weight);
      currencies.set(item.currency, (currencies.get(item.currency) || 0) + weight);
    }
  }
  const known = coverage.reduce((sum, entry) => sum + (rows.find((row) => row.symbol === entry.symbol)?.target || 0) * entry.percent / 100, 0);
  const group = (map) => [...map].map(([label, target]) => ({ label, target })).sort((a, b) => b.target - a.target);
  return { coverage, known, companies: [...companies.values()].sort((a, b) => b.target - a.target), sectors: group(sectors), currencies: group(currencies) };
}

export const STRESS_SCENARIOS = Object.freeze([
  { id: "equity_crisis", label: "股票普跌", equity: 45, growth: 45, gold: 10, bond: 5, commodity: 30, fx: 0, premium: 0 },
  { id: "growth_crisis", label: "成长风格回撤", equity: 25, growth: 60, gold: 10, bond: 5, commodity: 20, fx: 0, premium: 0 },
  { id: "currency_premium", label: "人民币升值与跨境溢价回落", equity: 0, growth: 0, gold: 0, bond: 0, commodity: 0, fx: 15, premium: 5 },
  { id: "rates", label: "利率上行情景", equity: 20, growth: 30, gold: 15, bond: 10, commodity: 10, fx: 0, premium: 0 },
]);

export function portfolioStressScenarios(rows, { currentAvailable, targetAvailable, totalValue, goal, initialTargetPct }) {
  const netAssets = goal.account_cash != null && goal.account_debt != null && currentAvailable ? totalValue + goal.account_cash - (goal.account_debt || 0) : null;
  return STRESS_SCENARIOS.map((scenario) => {
    const loss = (row) => {
      if (row.asset === "unknown" || (scenario.fx && row.region === "unknown")) return null;
      const marketLoss = row.style === "growth" ? scenario.growth : (scenario[row.asset] || 0);
      const overseas = ["US", "HK"].includes(row.region);
      return 100 * (1 - (1 - marketLoss / 100) * (1 - (overseas ? scenario.fx : 0) / 100) / (1 + (overseas ? scenario.premium : 0) / 100));
    };
    const complete = rows.every((row) => !(row.target > 0 || row.value > 0) || loss(row) != null);
    const currentAmount = currentAvailable && complete ? rows.reduce((sum, row) => sum + row.value * (loss(row) || 0) / 100, 0) : null;
    const target = targetAvailable && complete ? rows.reduce((sum, row) => sum + row.target * (loss(row) || 0) / 100, 0) : null;
    return { ...scenario, current: currentAmount == null ? null : currentAmount / totalValue * 100, target,
      currentAmount, accountCurrent: netAssets > 0 && currentAmount != null ? currentAmount / netAssets * 100 : null,
      accountTarget: target == null || initialTargetPct == null ? null : target * initialTargetPct / 100 };
  });
}
