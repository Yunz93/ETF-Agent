import { DEFAULT_TARGET_WEIGHTS } from "./constants.js";

export function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(100, Math.round(number * 100) / 100);
}

export function normalizePlan(plan) {
  const base = {
    name: "默认定投计划",
    amount: 2000,
    cadence: "monthly",
    day: 1,
    note: "",
  };
  if (!plan || typeof plan !== "object") return { ...base };
  let cadence = String(plan.cadence || base.cadence).toLowerCase();
  if (!["weekly", "biweekly", "monthly"].includes(cadence)) cadence = base.cadence;
  let day = Number.parseInt(plan.day, 10);
  if (!Number.isFinite(day)) day = base.day;
  if (cadence === "monthly") day = Math.min(28, Math.max(1, day));
  else day = Math.min(7, Math.max(1, day));
  const amount = Number(plan.amount);
  return {
    name: String(plan.name || base.name).trim() || base.name,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    cadence,
    day,
    note: String(plan.note || "").trim(),
  };
}

export function normalizeWorkspaceEntries(items = []) {
  const hadTarget = items.some(
    (item) => item && (item.target_weight != null || item.targetWeight != null),
  );
  const etfs = items
    .filter((item) => item && item.symbol)
    .map((item) => {
      const symbol = String(item.symbol || "");
      const targetRaw = item.target_weight ?? item.targetWeight;
      return {
        symbol,
        name: String(item.name || ""),
        shares: Number(item.shares) > 0 ? Number(item.shares) : 0,
        cost: Number(item.cost) > 0 ? Number(item.cost) : 0,
        target_weight: clampWeight(targetRaw),
        note: String(item.note || ""),
      };
    });
  if (!hadTarget) {
    etfs.forEach((entry) => {
      entry.target_weight = clampWeight(DEFAULT_TARGET_WEIGHTS[entry.symbol] || 0);
    });
  }
  return etfs;
}

export function normalizeBuys(items = []) {
  const seen = new Set();
  const buys = [];
  for (const item of items) {
    if (!item || !item.symbol || !item.date) continue;
    const digits = String(item.symbol).replace(/\D/g, "");
    if (digits.length < 1 || digits.length > 6) continue;
    const symbol = digits.padStart(6, "0");
    const date = String(item.date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const [year, month, day] = date.split("-").map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      year < 1990 ||
      year > 2100 ||
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      continue;
    }
    const shares = Number(item.shares);
    const price = Number(item.price);
    if (!(shares > 0) || !(price > 0)) continue;
    const id = String(item.id || "").trim() || `buy_${symbol}_${date}_${Math.round(shares)}_${Math.round(price * 10000)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    buys.push({
      id,
      symbol,
      date,
      price: Math.round(price * 1e6) / 1e6,
      shares: Math.round(shares * 1e4) / 1e4,
      note: String(item.note || "").trim(),
    });
  }
  buys.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
  return buys;
}

export function chooseWorkspaceSource(remote, local) {
  if (Array.isArray(remote?.etfs) && remote.etfs.length) {
    return { source: "server", payload: remote, migrate: false };
  }
  if (Array.isArray(local?.etfs) && local.etfs.length) {
    return { source: "local-cache", payload: local, migrate: true };
  }
  return { source: "default-pool", payload: null, migrate: true };
}
