/**
 * 场外 ETF 定投：按计划日程自动物化买入记录，避免每日手填。
 * 单笔场外买入仍走交易记录表单（channel=otc）。
 */

const DAY_MS = 86_400_000;

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return startOfDay(date);
}

function startOfWeek(date) {
  const value = startOfDay(date);
  const weekday = value.getDay() || 7;
  value.setDate(value.getDate() - weekday + 1);
  return value;
}

function nonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function otcDcaTradeId(scheduleId, date) {
  return `otc_dca_${String(scheduleId || "").trim()}_${String(date || "").trim()}`;
}

export function normalizeOtcDcaSchedule(item) {
  if (!item || typeof item !== "object") return null;
  const digits = String(item.symbol || "").replace(/\D/g, "");
  if (digits.length < 1 || digits.length > 6) return null;
  const symbol = digits.padStart(6, "0");
  let cadence = String(item.cadence || "monthly").toLowerCase();
  if (!["weekly", "biweekly", "monthly"].includes(cadence)) cadence = "monthly";
  let day = Number.parseInt(item.day, 10);
  if (!Number.isFinite(day)) day = 1;
  if (cadence === "monthly") day = Math.min(28, Math.max(1, day));
  else day = Math.min(7, Math.max(1, day));
  const startDate = String(item.start_date || item.startDate || "").trim();
  if (!parseLocalDate(startDate)) return null;
  const endRaw = String(item.end_date || item.endDate || "").trim();
  const endDate = endRaw && parseLocalDate(endRaw) ? endRaw : null;
  if (endDate && endDate < startDate) return null;
  const amount = positive(item.amount);
  if (!(amount > 0)) return null;
  const unitPrice = positive(item.unit_price ?? item.unitPrice);
  if (!(unitPrice > 0)) return null;
  const id = String(item.id || "").trim() || `otc_${symbol}_${startDate.replace(/-/g, "")}`;
  const lastSynced = String(item.last_synced_date || item.lastSyncedDate || "").trim();
  return {
    id,
    symbol,
    amount: Math.round(amount * 100) / 100,
    cadence,
    day,
    start_date: startDate,
    end_date: endDate,
    unit_price: Math.round(unitPrice * 1e6) / 1e6,
    fee_rate_pct: Math.min(10, nonnegative(item.fee_rate_pct ?? item.feeRatePct, 0)),
    enabled: item.enabled == null ? true : Boolean(item.enabled),
    last_synced_date: lastSynced && parseLocalDate(lastSynced) ? lastSynced : null,
    note: String(item.note || "").trim().slice(0, 80),
  };
}

export function normalizeOtcDcaSchedules(items = []) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    const row = normalizeOtcDcaSchedule(item);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  rows.sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return rows;
}

/**
 * 枚举日程在 [start_date, min(asOf, end_date)] 内应记账的执行日。
 */
export function enumerateOtcScheduleDates(schedule, asOf = new Date()) {
  const normalized = normalizeOtcDcaSchedule(schedule);
  if (!normalized) return [];
  const start = parseLocalDate(normalized.start_date);
  const asOfDay = startOfDay(asOf);
  const endCap = normalized.end_date ? parseLocalDate(normalized.end_date) : asOfDay;
  if (!start || !endCap) return [];
  const last = endCap < asOfDay ? endCap : asOfDay;
  if (last < start) return [];

  const dates = [];
  const day = normalized.day;
  const cadence = normalized.cadence;

  if (cadence === "monthly") {
    let year = start.getFullYear();
    let month = start.getMonth();
    for (let guard = 0; guard < 600; guard += 1) {
      const scheduled = new Date(year, month, Math.min(28, day));
      if (scheduled > last && new Date(year, month, 1) > last) break;
      if (scheduled >= start && scheduled <= last) {
        dates.push(localDateKey(scheduled));
      }
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return dates;
  }

  let cursor = startOfWeek(start);
  if (cadence === "biweekly") {
    const anchor = new Date(1970, 0, 5);
    const weeks = Math.floor((cursor - anchor) / (7 * DAY_MS));
    if (Math.abs(weeks % 2) === 1) cursor.setDate(cursor.getDate() - 7);
  }
  const stepDays = cadence === "biweekly" ? 14 : 7;
  for (let guard = 0; guard < 1200; guard += 1) {
    const scheduled = new Date(cursor);
    scheduled.setDate(scheduled.getDate() + Math.min(7, day) - 1);
    if (cursor > last && scheduled > last) break;
    if (scheduled >= start && scheduled <= last) {
      dates.push(localDateKey(scheduled));
    }
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + stepDays);
  }
  return dates;
}

export function buildOtcDcaBuy({ schedule, date, existingId = null }) {
  const normalized = normalizeOtcDcaSchedule(schedule);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const amount = normalized.amount;
  const price = normalized.unit_price;
  const fee = Math.round(amount * (normalized.fee_rate_pct / 100) * 100) / 100;
  const net = Math.max(0, amount - fee);
  if (!(net > 0) || !(price > 0)) return null;
  const shares = Math.round((net / price) * 1e4) / 1e4;
  if (!(shares > 0)) return null;
  const noteParts = ["场外定投自动记账"];
  if (normalized.note) noteParts.push(normalized.note);
  return {
    id: existingId || otcDcaTradeId(normalized.id, date),
    symbol: normalized.symbol,
    date: String(date),
    price,
    shares,
    fee,
    note: noteParts.join(" · ").slice(0, 80),
    channel: "otc",
    otc_schedule_id: normalized.id,
  };
}

/**
 * 将到期未写入的场外定投补齐到 buys。
 * - 仅生成 date > last_synced_date（首次为全部应记日期）
 * - 已存在同 id 的买入则跳过（不覆盖用户手改）
 * - 返回 { buys, schedules, created }
 */
export function materializeOtcDcaBuys({
  schedules = [],
  buys = [],
  asOf = new Date(),
} = {}) {
  const nextSchedules = normalizeOtcDcaSchedules(schedules).map((row) => ({ ...row }));
  const byId = new Map((buys || []).filter((row) => row?.id).map((row) => [row.id, row]));
  let created = 0;
  const asOfKey = localDateKey(startOfDay(asOf));

  for (const schedule of nextSchedules) {
    if (!schedule.enabled) continue;
    const dates = enumerateOtcScheduleDates(schedule, asOf);
    const synced = schedule.last_synced_date;
    const pending = dates.filter((date) => !synced || date > synced);
    for (const date of pending) {
      const id = otcDcaTradeId(schedule.id, date);
      if (byId.has(id)) continue;
      const trade = buildOtcDcaBuy({ schedule, date, existingId: id });
      if (!trade) continue;
      byId.set(id, trade);
      created += 1;
    }
    if (dates.length) {
      const lastDate = dates[dates.length - 1];
      schedule.last_synced_date =
        !synced || lastDate > synced ? lastDate : synced;
    } else if (!synced) {
      schedule.last_synced_date = asOfKey < schedule.start_date ? null : asOfKey;
    }
  }

  const nextBuys = [...byId.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id),
  );
  return { buys: nextBuys, schedules: nextSchedules, created };
}

export const OTC_CADENCE_LABELS = Object.freeze({
  weekly: "每周",
  biweekly: "每两周",
  monthly: "每月",
});
