/**
 * 同指数敞口：费率择优 + 组目标权重合并（纯函数）。
 */

/**
 * @param {Array<{symbol, targetWeight, name?}>} holdings
 * @param {{ analysisRegistry?: object, products?: object }} opts
 * @returns {{ holdings: Array, skipped: Array<{symbol, name, band, reason}> }}
 */
export function applyIndexExposureGroups(holdings = [], { analysisRegistry = {}, products = {} } = {}) {
  const rows = (Array.isArray(holdings) ? holdings : []).map((item) => ({ ...item }));
  const byIndex = new Map();
  for (const row of rows) {
    const code = String(analysisRegistry[row.symbol]?.index_code || row.indexCode || "").trim();
    if (!code) continue;
    row.indexCode = code;
    if (!byIndex.has(code)) byIndex.set(code, []);
    byIndex.get(code).push(row);
  }

  const skipped = [];
  for (const group of byIndex.values()) {
    if (group.length < 2) continue;
    const withMeta = group.map((row) => {
      const product = products[row.symbol] || {};
      const fee = Number(product.annual_fee_pct);
      const size = Number(product.fund_size_yi);
      return {
        row,
        fee: Number.isFinite(fee) && fee >= 0 ? fee : null,
        size: Number.isFinite(size) && size >= 0 ? size : null,
      };
    });
    const feeRows = withMeta.filter((item) => item.fee != null);
    if (feeRows.length >= 2) {
      feeRows.sort((a, b) => a.fee - b.fee || (b.size ?? 0) - (a.size ?? 0));
      const best = feeRows[0].row;
      let mergedWeight = 0;
      for (const item of group) {
        mergedWeight += Math.max(0, Number(item.targetWeight) || 0);
      }
      for (const item of group) {
        if (item.symbol === best.symbol) {
          item.targetWeight = mergedWeight;
          continue;
        }
        item.targetWeight = 0;
        item.indexGroupSkipped = true;
        item.indexGroupSkipReason = "同指数已选更优品种";
        skipped.push({
          symbol: item.symbol,
          name: item.name || item.symbol,
          band: "同指数择优",
          reason: "同指数已选更优品种",
        });
      }
      continue;
    }

    // 无费率数据：保留各目标权重，标记组标识供分配时组缺口硬顶
    const mergedWeight = group.reduce(
      (sum, row) => sum + Math.max(0, Number(row.targetWeight) || 0),
      0,
    );
    for (const row of group) {
      row.indexGroupWeight = mergedWeight;
    }
  }

  return { holdings: rows, skipped };
}
