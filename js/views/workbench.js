import { DECISION_LABELS } from "../constants.js";
import { els, state } from "../state.js";
import { daysUntil, watchAlertLevel, watchAlertText } from "../analysis.js";
import { escapeHtml, findStock, money, signed, stockKey, toBase } from "../utils.js";
import { persistWorkspace } from "../workspace.js";
import { registerRenderers, selectStock } from "./render.js";

export function renderWorkbench() {
  if (!els.workbenchMetrics) return;
  const watchCount = Object.keys(state.watchlist).length;
  const hitCount = Object.values(state.watchlist).filter((saved) => {
    const stock = findStock(saved.symbol, saved.market);
    return stock && watchAlertLevel(stock, saved) === "hit";
  }).length;
  const pendingReviews = collectPendingReviews();
  const base = state.prefs.baseCurrency || "CNY";
  let holdingCostBase = 0;
  let holdingValueBase = 0;
  Object.values(state.holdings).forEach((holding) => {
    const stock = findStock(holding.symbol, holding.market);
    if (!stock) return;
    holdingCostBase += toBase(holding.shares * holding.cost, stock.currency, base);
    holdingValueBase += toBase(holding.shares * stock.quote.price, stock.currency, base);
  });
  const holdingPnlPct = holdingCostBase ? ((holdingValueBase - holdingCostBase) / holdingCostBase) * 100 : 0;
  const todoCount = collectActiveAlerts().length + pendingReviews.length;

  els.workbenchMetrics.innerHTML = [
    ["自选", `${watchCount} 只`],
    ["已触及", `${hitCount} 条`],
    ["持仓盈亏", Object.keys(state.holdings).length ? `${signed(holdingPnlPct)}%` : "—"],
    ["今日待办", `${todoCount} 项`],
  ]
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");

  if (els.workbenchChanged) {
    const changedItems = collectChangedItems().slice(0, 8);
    els.workbenchChanged.innerHTML = changedItems.length
      ? changedItems
          .map(
            (item) => `
              <button class="stack-item" data-open="${item.key}" type="button">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="muted">${escapeHtml(item.detail)}</span>
                </div>
                <span class="tag ${item.level}">${escapeHtml(item.badge)}</span>
              </button>
            `,
          )
          .join("")
      : `<div class="empty-state compact">暂无异动或提醒。去研究池加入自选后，涨跌与触及会汇总在这里。</div>`;
  }

  const holdings = Object.values(state.holdings)
    .map((holding) => {
      const stock = findStock(holding.symbol, holding.market);
      if (!stock) return null;
      const marketValue = holding.shares * stock.quote.price;
      const costValue = holding.shares * holding.cost;
      const pnl = marketValue - costValue;
      const pnlPct = costValue ? (pnl / costValue) * 100 : 0;
      const marketValueBase = toBase(marketValue, stock.currency, base);
      const weight = holdingValueBase ? (marketValueBase / holdingValueBase) * 100 : 0;
      const fairLow = stock.valuation?.fair_zone?.[0];
      const vsFair = fairLow ? ((stock.quote.price - fairLow) / fairLow) * 100 : null;
      return { stock, holding, pnl, pnlPct, weight, vsFair };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pnlPct) - Math.abs(a.pnlPct))
    .slice(0, 6);

  els.workbenchHoldings.innerHTML = holdings.length
    ? holdings
        .map(({ stock, pnl, pnlPct, weight, vsFair }) => {
          const fairText =
            vsFair == null ? "合理价 —" : `相对合理 ${signed(vsFair)}%`;
          return `
            <button class="stack-item" data-open="${stockKey(stock)}" type="button">
              <div>
                <strong>${escapeHtml(stock.name)}</strong>
                <span class="muted">${money(stock.quote.price, stock.currency)} · 仓位 ${weight.toFixed(1)}% · ${fairText}</span>
              </div>
              <strong class="${pnl >= 0 ? "up" : "down"}">${signed(pnlPct)}%</strong>
            </button>
          `;
        })
        .join("")
    : `<div class="empty-state compact">尚未录入持仓。在持仓页添加数量与成本后，这里会汇总浮盈亏。</div>`;

  const earnings = Object.values(state.watchlist)
    .map((saved) => findStock(saved.symbol, saved.market))
    .filter((stock) => stock?.quote.earnings_date && daysUntil(stock.quote.earnings_date) >= 0 && daysUntil(stock.quote.earnings_date) <= 45)
    .sort((a, b) => daysUntil(a.quote.earnings_date) - daysUntil(b.quote.earnings_date))
    .slice(0, 6);

  if (els.workbenchEarnings) {
    els.workbenchEarnings.innerHTML = earnings.length
      ? earnings
          .map((stock) => {
            const days = daysUntil(stock.quote.earnings_date);
            return `
              <button class="stack-item" data-open="${stockKey(stock)}" type="button">
                <div>
                  <strong>${escapeHtml(stock.name)}</strong>
                  <span class="muted">${stock.quote.earnings_date}</span>
                </div>
                <span class="muted">${days === 0 ? "今天" : `${days} 天后`}</span>
              </button>
            `;
          })
          .join("")
      : `<div class="empty-state compact">自选中暂无 45 天内财报。</div>`;
  }

  if (els.workbenchReviews) {
    const reviews = pendingReviews.slice(0, 6);
    els.workbenchReviews.innerHTML = reviews.length
      ? reviews
          .map(
            (item) => `
              <button class="stack-item" data-open="${item.key}" type="button">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="muted">${escapeHtml(item.detail)}</span>
                </div>
                <span class="tag ${item.level}">${escapeHtml(item.badge)}</span>
              </button>
            `,
          )
          .join("")
      : `<div class="empty-state compact">没有待复盘判断。在详情页写判断卡并设复盘日后会出现在这里。</div>`;
  }

  if (els.alertHistory) {
    els.alertHistory.innerHTML = state.alertHistory.length
      ? state.alertHistory
          .slice(0, 12)
          .map(
            (item) => `
              <div class="stack-item static">
                <div>
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="muted">${escapeHtml(item.detail)}</span>
                </div>
                <span class="muted">${new Date(item.at).toLocaleString("zh-CN")}</span>
              </div>
            `,
          )
          .join("")
      : `<div class="empty-state compact">暂无提醒历史。</div>`;
  }

  document.querySelectorAll("#workbenchView [data-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const [market, symbol] = button.dataset.open.split(":");
      const stock = await provider.getStock(symbol, market);
      selectStock(stock, { openDetail: true });
    });
  });
}

export function collectChangedItems() {
  const items = [];
  const seen = new Set();

  collectActiveAlerts().forEach((alert) => {
    seen.add(`${alert.key}:${alert.detail}`);
    items.push({
      key: alert.key,
      title: alert.title,
      detail: alert.detail,
      level: alert.level,
      badge: alert.level === "hit" ? "触及" : "临近",
      rank: alert.level === "hit" ? 0 : 1,
      sortValue: alert.date != null ? daysUntil(alert.date) ?? 99 : 0,
    });
  });

  Object.values(state.watchlist)
    .map((saved) => {
      const stock = findStock(saved.symbol, saved.market);
      return stock ? { stock, saved } : null;
    })
    .filter(Boolean)
    .filter(({ saved }) => !state.prefs.coreOnlyWorkbench || (saved.group || "watch") === "core")
    .sort((a, b) => Math.abs(b.stock.quote.change_pct || 0) - Math.abs(a.stock.quote.change_pct || 0))
    .slice(0, 6)
    .forEach(({ stock }) => {
      const key = stockKey(stock);
      const detail = `涨跌 ${signed(stock.quote.change_pct)}%`;
      if (seen.has(`${key}:${detail}`)) return;
      const absMove = Math.abs(stock.quote.change_pct || 0);
      if (absMove < 1.5 && items.length >= 4) return;
      items.push({
        key,
        title: stock.name,
        detail,
        level: absMove >= 3 ? "hit" : "near",
        badge: absMove >= 3 ? "异动" : "波动",
        rank: 2,
        sortValue: -absMove,
      });
    });

  return items.sort((a, b) => a.rank - b.rank || a.sortValue - b.sortValue);
}

export function collectPendingReviews() {
  const STALE_DAYS = 14;
  const items = [];
  const keys = new Set([
    ...Object.keys(state.watchlist),
    ...Object.keys(state.holdings),
    ...Object.keys(state.notes),
  ]);

  keys.forEach((key) => {
    const note = state.notes[key];
    if (!note) return;
    const hasJudgment = Boolean(
      note.thesis ||
        note.invalidation ||
        note.watchPrice != null ||
        note.reviewDate ||
        (Array.isArray(note.evidence) && note.evidence.length) ||
        (note.decision && note.decision !== "watch"),
    );
    if (!hasJudgment) return;

    const [market, symbol] = key.split(":");
    const stock = findStock(symbol, market);
    const title = stock?.name || symbol || key;
    const decisionLabel = DECISION_LABELS[note.decision] || "观望";

    if (note.reviewDate) {
      const days = daysUntil(note.reviewDate);
      if (days <= 0) {
        items.push({
          key,
          title,
          detail: days === 0 ? `复盘日今天 · ${decisionLabel}` : `复盘已过 ${Math.abs(days)} 天 · ${decisionLabel}`,
          level: "hit",
          badge: days === 0 ? "今日复盘" : "逾期",
          rank: days === 0 ? 0 : 1,
          sortValue: days,
        });
        return;
      }
      if (days <= 7) {
        items.push({
          key,
          title,
          detail: `${days} 天后复盘 · ${decisionLabel}`,
          level: "near",
          badge: "临近",
          rank: 2,
          sortValue: days,
        });
        return;
      }
    }

    const updatedAt = note.updatedAt ? new Date(note.updatedAt) : null;
    if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
      const ageDays = Math.floor((Date.now() - updatedAt.getTime()) / 86400000);
      if (ageDays >= STALE_DAYS) {
        items.push({
          key,
          title,
          detail: `判断卡 ${ageDays} 天未更新 · ${decisionLabel}`,
          level: "near",
          badge: "久未更新",
          rank: 3,
          sortValue: -ageDays,
        });
      }
    }
  });

  return items.sort((a, b) => a.rank - b.rank || a.sortValue - b.sortValue);
}

export function parseEvidenceLinks(raw) {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function formatEvidenceLinks(evidence) {
  if (Array.isArray(evidence)) return evidence.join("\n");
  if (typeof evidence === "string") return evidence;
  return "";
}
export function collectActiveAlerts() {
  const alerts = [];
  Object.values(state.watchlist).forEach((saved) => {
    const stock = findStock(saved.symbol, saved.market);
    if (!stock) return;
    const level = watchAlertLevel(stock, saved);
    if (level === "hit" || level === "near") {
      alerts.push({
        key: stockKey(stock),
        title: stock.name,
        detail: watchAlertText(stock, saved),
        level,
      });
    }
    if (stock.quote.earnings_date) {
      const days = daysUntil(stock.quote.earnings_date);
      if (days >= 0 && days <= 7) {
        alerts.push({
          key: stockKey(stock),
          title: `${stock.name} 财报`,
          detail: days === 0 ? "今天披露" : `${days} 天后披露`,
          level: days <= 2 ? "hit" : "near",
          date: stock.quote.earnings_date,
        });
      }
    }
  });

  Object.entries(state.notes).forEach(([key, note]) => {
    if (note?.watchPrice == null || !Number.isFinite(Number(note.watchPrice))) return;
    const [market, symbol] = key.split(":");
    const stock = findStock(symbol, market);
    if (!stock?.quote?.price) return;
    const target = Number(note.watchPrice);
    const price = stock.quote.price;
    const distance = Math.abs(price - target) / target;
    if (distance > 0.03) return;
    alerts.push({
      key,
      title: stock.name,
      detail: `判断卡关注价 ${money(target, stock.currency)} · 现价 ${money(price, stock.currency)}`,
      level: distance <= 0.01 ? "hit" : "near",
    });
  });

  return alerts;
}

export function evaluateAlerts({ notify = false } = {}) {
  const active = collectActiveAlerts();
  active.forEach((alert) => {
    const signature = `${alert.key}:${alert.detail}`;
    const exists = state.alertHistory.some((item) => item.signature === signature && Date.now() - new Date(item.at).getTime() < 12 * 3600 * 1000);
    if (exists) return;
    state.alertHistory.unshift({
      ...alert,
      signature,
      at: new Date().toISOString(),
    });
    if (notify && state.prefs.notify && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(alert.title, { body: alert.detail });
      } catch {
        /* ignore */
      }
    }
  });
  state.alertHistory = state.alertHistory.slice(0, 50);
  persistWorkspace();
}

export function pushDecisionLog(stock, decision) {
  state.alertHistory.unshift({
    key: stockKey(stock),
    title: `${stock.name} 决策`,
    detail: DECISION_LABELS[decision] || decision,
    level: "near",
    signature: `decision:${stockKey(stock)}:${decision}:${Date.now()}`,
    at: new Date().toISOString(),
  });
  state.alertHistory = state.alertHistory.slice(0, 50);
  persistWorkspace();
  renderWorkbench();
}

registerRenderers({ renderWorkbench, evaluateAlerts });
