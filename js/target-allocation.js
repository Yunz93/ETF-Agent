export function validateTargetAllocation(rows) {
  const weights = [];
  for (const row of rows) {
    const raw = String(row.value ?? "").trim();
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(raw)) {
      return { ok: false, message: `${row.symbol}：请输入 0–100 之间、最多两位小数的目标仓位。` };
    }
    const basisPoints = Math.round(Number(raw) * 100);
    if (basisPoints > 10_000) {
      return { ok: false, message: `${row.symbol}：目标仓位不能超过 100%。` };
    }
    weights.push({ symbol: row.symbol, basisPoints });
  }
  const total = weights.reduce((sum, row) => sum + row.basisPoints, 0);
  if (total !== 10_000) {
    return { ok: false, total: total / 100, message: `当前合计 ${(total / 100).toFixed(2)}%，需调整为 100% 后保存。` };
  }
  return { ok: true, total: 100, weights: weights.map((row) => ({ symbol: row.symbol, value: row.basisPoints / 100 })) };
}
