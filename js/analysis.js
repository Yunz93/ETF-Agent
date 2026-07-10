import { CURRENCY } from "./constants.js";
import { marketSources, quoteSourceMeta } from "./settings.js";
import { average, clamp, escapeHtml, hash, round, valuationLabel } from "./utils.js";

export function buildCatalogStockFromApi(entry, index) {
  return {
    symbol: entry.symbol,
    name: entry.name,
    englishName: entry.englishName || entry.name,
    market: entry.market,
    exchange: entry.exchange,
    currency: entry.currency,
    industry: entry.industry || "未分类",
    indices: entry.indices || [],
    indexCodes: entry.index_codes || [],
    yahooSymbol: entry.yahoo_symbol,
    cik: entry.cik,
    listing_status: "listed",
    sortIndex: index,
  };
}

export function buildStockFromQuote(entry, liveQuote) {
  if (!liveQuote || liveQuote.price == null) return null;

  const quoteMeta = quoteSourceMeta();
  const quote = {
    symbol: entry.symbol,
    price: liveQuote.price,
    change_pct: liveQuote.change_pct ?? null,
    volume: liveQuote.volume ?? null,
    market_cap: liveQuote.market_cap ?? null,
    pe: liveQuote.pe ?? null,
    pb: liveQuote.pb ?? null,
    ps: liveQuote.ps ?? null,
    dividend_yield: liveQuote.dividend_yield ?? null,
    week_52_low: liveQuote.week_52_low ?? null,
    week_52_high: liveQuote.week_52_high ?? null,
    earnings_date: liveQuote.earnings_date ?? null,
    ex_dividend_date: liveQuote.ex_dividend_date ?? null,
    as_of: liveQuote.as_of ?? null,
    source: {
      name: liveQuote.provider || quoteMeta.name,
      url: liveQuote.source_url || quoteMeta.url,
      role: liveQuote.note || quoteMeta.role,
    },
    provider: liveQuote.provider || quoteMeta.name,
    updated_at: new Date().toISOString(),
  };

  return enrichStockMetrics({ ...entry, quote, financials: [] });
}

export function enrichStockMetrics(stock) {
  const eps = stock.quote.pe ? stock.quote.price / stock.quote.pe : null;
  const latest = latestFinancial(stock);
  const valuation = buildValuation({
    price: stock.quote.price,
    pe: stock.quote.pe,
    pb: stock.quote.pb,
    ps: stock.quote.ps,
    eps,
    roe: latest?.roe ?? 0,
    dividendYield: stock.quote.dividend_yield ?? 0,
    industry: stock.industry,
    h: hash(`${stock.symbol}-${stock.market}`),
  });
  const analysis = latest
    ? buildAnalysis({
        name: stock.name,
        industry: stock.industry,
        score: scoreStock({
          revenueGrowth: latest.revenue_growth,
          margin: latest.gross_margin,
          cashQuality: cashQualityFromFinancial(latest),
          debtRatio: latest.debt_ratio,
          roe: latest.roe,
          valuation,
          trend: stock.quote.change_pct > 0 ? 60 : 40,
        }),
        valuation,
        revenueGrowth: latest.revenue_growth,
        margin: latest.gross_margin,
        cashQuality: cashQualityFromFinancial(latest),
        debtRatio: latest.debt_ratio,
        roe: latest.roe,
        pe: stock.quote.pe,
      })
    : buildAnalysisFromQuote(stock, valuation);

  return {
    ...stock,
    valuation,
    analysis,
    sourceMeta: {
      source: marketSources(stock.market)[0]?.name || quoteSourceMeta().name,
      source_url: marketSources(stock.market)[0]?.url || quoteSourceMeta().url,
      as_of_date: stock.quote.as_of?.slice(0, 10) || null,
      currency: stock.currency,
      market: stock.market,
      provider: stock.quote.provider,
      updated_at: stock.quote.updated_at,
    },
  };
}

export function buildAnalysisFromQuote(stock, valuation) {
  const trend = stock.quote.change_pct ?? 0;
  const score = scoreFromQuoteOnly(stock.quote, valuation);
  const label =
    score >= 76
      ? "估值与趋势尚可"
      : score >= 62
        ? "可跟踪，等待财报验证"
        : score >= 48
          ? "信息不足，谨慎观察"
          : "价格或趋势偏弱";

  return {
    score,
    rating_label: label,
    summary: `${stock.name} 当前模型判断为「${valuationLabel(valuation.state)}」。仅基于行情与估值模型，尚未接入财报明细。${stock.quote.as_of ? `行情更新 ${stock.quote.as_of}。` : ""}`,
    positives: [],
    negatives: [],
    risks:
      valuation.state === "risk" || valuation.state === "expensive"
        ? ["价格相对模型区间偏高，需等待下一期财报验证。"]
        : ["缺少财报数据，结论仅基于行情与估值假设。"],
    data_quality: "行情",
    generated_at: new Date().toISOString(),
    breakdown: {
      估值: valuation.state === "undervalued" ? 86 : valuation.state === "fair" ? 70 : 45,
      趋势: clamp(Math.round(50 + trend * 2), 0, 100),
    },
  };
}

export function scoreFromQuoteOnly(quote, valuation) {
  const value =
    valuation.state === "undervalued" ? 82 : valuation.state === "fair" ? 68 : valuation.state === "expensive" ? 45 : 28;
  const trend = clamp(Math.round(50 + (quote.change_pct ?? 0) * 2), 0, 100);
  return Math.round(value * 0.55 + trend * 0.45);
}

export function buildValuation({ price, pe, pb, ps, eps, roe, dividendYield, industry, h }) {
  let method = "PE/PB blended";
  let base;
  const normalizedEps = Math.max(eps || 0, 0.18);
  if (!pe) {
    method = "PS + PB for loss-making company";
    base = price * (1.05 - Math.min(ps || 0, 8) / 35);
  } else if (industry.includes("银行") || industry.includes("保险")) {
    method = "PB + dividend yield";
    base = price * (1.12 + (roe - pb * 3) / 100 + dividendYield / 80);
  } else if (industry.includes("软件") || industry.includes("互联网") || industry.includes("半导体")) {
    method = "growth-adjusted PE";
    base = normalizedEps * (18 + (h % 28));
  } else {
    method = "PE + cash yield";
    base = normalizedEps * (11 + (h % 20)) * (1 + dividendYield / 100);
  }

  const bear = round(base * 0.78, 2);
  const bull = round(base * 1.28, 2);
  const fairLow = round(base * 0.9, 2);
  const fairHigh = round(base * 1.1, 2);
  const risk = round(bull * 1.12, 2);
  let stateName = "fair";
  if (price <= fairLow) stateName = "undervalued";
  if (price > fairHigh && price <= risk) stateName = "expensive";
  if (price > risk) stateName = "risk";

  return {
    method,
    bear_price: bear,
    base_price: round(base, 2),
    bull_price: bull,
    watch_zone: [bear, fairLow],
    fair_zone: [fairLow, fairHigh],
    expensive_zone: [fairHigh, risk],
    risk_price: risk,
    state: stateName,
    assumptions: [
      `${method} 模型用于当前行业和盈利状态。`,
      `保守情景取基准估值的 78%，乐观情景取 128%。`,
      pe ? `当前 PE 为 ${pe.toFixed(1)}，估值结论会受盈利周期影响。` : "公司当前 EPS 为负或接近亏损，不使用 PE 作为核心估值。",
      "区间用于研究观察，不是确定性买卖指令。",
    ],
  };
}

export function scoreStock({ revenueGrowth, margin, cashQuality, debtRatio, roe, valuation, trend }) {
  const fundamental = clamp(Math.round(roe * 2 + margin * 0.6 + revenueGrowth), 0, 100);
  const value = valuation.state === "undervalued" ? 82 : valuation.state === "fair" ? 68 : valuation.state === "expensive" ? 45 : 28;
  const trendScore = clamp(Math.round(trend), 0, 100);
  const risk = clamp(Math.round(100 - debtRatio + cashQuality / 4), 0, 100);
  const quality = 76;
  return Math.round(fundamental * 0.3 + value * 0.25 + trendScore * 0.18 + risk * 0.17 + quality * 0.1);
}

export function buildAnalysis({ name, industry, score, valuation, revenueGrowth, margin, cashQuality, debtRatio, roe, pe }) {
  const positives = [];
  const risks = [];
  if (revenueGrowth > 12) positives.push(`收入同比增长 ${revenueGrowth.toFixed(1)}%，增长动能仍然明显。`);
  if (margin > 38) positives.push(`毛利率 ${margin.toFixed(1)}%，行业内具备较强定价能力。`);
  if (cashQuality > 82) positives.push(`经营现金流质量 ${cashQuality.toFixed(1)}%，利润含金量较好。`);
  if (roe > 16) positives.push(`ROE ${roe.toFixed(1)}%，资本回报水平较强。`);
  if (!positives.length) positives.push("财报数据已接入，可继续跟踪下一期披露。");
  if (valuation.state === "risk") risks.push("当前价格高于模型风险触发位，安全边际不足。");
  if (valuation.state === "expensive") risks.push("价格进入偏贵区间，后续收益更依赖业绩继续超预期。");
  if (revenueGrowth < 3) risks.push(`收入增长仅 ${revenueGrowth.toFixed(1)}%，需要警惕增长放缓。`);
  if (cashQuality < 70) risks.push("经营现金流弱于利润表现，需检查应收、存货或资本开支压力。");
  if (debtRatio > 58) risks.push(`负债率 ${debtRatio.toFixed(1)}%，利率和再融资环境变化会放大波动。`);
  if (!pe) risks.push("公司当前亏损或 EPS 不可用，传统 PE 估值不可用。");
  if (!risks.length) risks.push("主要风险来自市场估值波动、行业景气度变化和数据延迟。");

  const label =
    score >= 78 ? "基本面与估值较有吸引力" : score >= 64 ? "可跟踪，等待更好买点" : score >= 50 ? "中性观察" : "风险偏高，谨慎";

  return {
    score,
    rating_label: label,
    summary: `${name}（${industry}）综合评分 ${score}。模型判断为「${valuationLabel(valuation.state)}」。`,
    positives,
    negatives: [],
    risks,
    data_quality: "财报+行情",
    generated_at: new Date().toISOString(),
    breakdown: {
      基本面: clamp(Math.round(roe * 2 + margin * 0.6 + revenueGrowth), 0, 100),
      估值: valuation.state === "undervalued" ? 82 : valuation.state === "fair" ? 68 : valuation.state === "expensive" ? 45 : 28,
      质量: clamp(Math.round(cashQuality), 0, 100),
      风险: clamp(Math.round(100 - debtRatio), 0, 100),
    },
  };
}
export function sourceItems(stock) {
  const sources = [stock.quote.source];
  if (stock.financialSource) sources.push(stock.financialSource);
  return [...sources, ...marketSources(stock.market)].filter(
    (source, index, items) => items.findIndex((item) => item.name === source.name && item.url === source.url) === index,
  );
}

export function cashQualityFromFinancial(financial) {
  if (!financial.net_income) return 68;
  return clamp(round((financial.operating_cashflow / Math.abs(financial.net_income)) * 100, 1), 15, 140);
}

export function latestFinancial(stock) {
  if (!stock.financials?.length) return null;
  return stock.financials[stock.financials.length - 1];
}

export function buildEventsFromQuote(stock) {
  const events = [];
  if (stock.quote.earnings_date) {
    events.push({
      date: stock.quote.earnings_date,
      kind: "earnings",
      title: "预计财报",
      url: null,
      status: eventStatus(stock.quote.earnings_date),
    });
  }
  if (stock.quote.ex_dividend_date) {
    events.push({
      date: stock.quote.ex_dividend_date,
      kind: "dividend",
      title: "除息日",
      url: null,
      status: eventStatus(stock.quote.ex_dividend_date),
    });
  }
  return events;
}

export function marketDisclosureLinks(stock) {
  return marketSources(stock.market).map((source) => ({
    date: null,
    kind: "source",
    title: source.name,
    url: source.url,
    status: "link",
  }));
}

export function sortEvents(events) {
  const dated = events.filter((event) => event.date);
  const links = events.filter((event) => !event.date);
  const upcoming = dated.filter((event) => daysUntil(event.date) >= 0).sort((a, b) => daysUntil(a.date) - daysUntil(b.date));
  const past = dated.filter((event) => daysUntil(event.date) < 0).sort((a, b) => daysUntil(b.date) - daysUntil(a.date));
  return { upcoming: [...upcoming, ...links], past };
}

export function paintEvents(root, events) {
  const bucket = events && !Array.isArray(events) ? events : sortEvents(events || []);
  const upcoming = bucket.upcoming || [];
  const past = bucket.past || [];
  const upcomingList = root.querySelector(".js-events-upcoming");
  const pastList = root.querySelector(".js-events-past");
  upcomingList.innerHTML = upcoming.length ? upcoming.map(renderEventItem).join("") : `<li class="event-empty muted">暂无即将到来的事件。</li>`;
  pastList.innerHTML = past.length ? past.map(renderEventItem).join("") : `<li class="event-empty muted">暂无近期披露。</li>`;
}

export function renderEventItem(event) {
  const badge = eventKindLabel(event.kind);
  const body = event.url
    ? `<a href="${event.url}" target="_blank" rel="noreferrer">${escapeHtml(event.title)}</a>`
    : `<strong>${escapeHtml(event.title)}</strong>`;
  return `
    <li class="event-item">
      <span class="event-badge">${badge}</span>
      <div class="event-copy">
        ${body}
        <span class="muted">${event.date || "外部入口"} ${event.date ? `· ${formatDaysLabel(event.date)}` : ""}</span>
      </div>
    </li>
  `;
}

export function formatNextEarnings(date) {
  if (!date) return "";
  const days = daysUntil(date);
  if (days == null) return "";
  return `<p class="watch-earnings muted">财报 ${date} · ${days === 0 ? "今天" : days > 0 ? `${days} 天后` : `${Math.abs(days)} 天前`}</p>`;
}

export function eventKindLabel(kind) {
  return { earnings: "财报", dividend: "分红", filing: "披露", source: "来源" }[kind] || "事件";
}

export function eventStatus(date) {
  const days = daysUntil(date);
  if (days == null) return "unknown";
  return days >= 0 ? "upcoming" : "past";
}

export function formatDaysLabel(date) {
  const days = daysUntil(date);
  if (days == null) return "";
  if (days === 0) return "今天";
  if (days > 0) return `${days} 天后`;
  return `${Math.abs(days)} 天前`;
}

export function daysUntil(date) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function marginOfSafety(stock) {
  const fairLow = stock.valuation.fair_zone[0];
  if (!fairLow) return 0;
  return round(((fairLow - stock.quote.price) / fairLow) * 100, 1);
}

export function formatMarginOfSafety(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function week52Stats(stock) {
  const { price, week_52_high, week_52_low } = stock.quote;
  if (!week_52_high || !week_52_low || week_52_high <= week_52_low) return null;
  return {
    fromHigh: round(((week_52_high - price) / week_52_high) * 100, 1),
    position: round(((price - week_52_low) / (week_52_high - week_52_low)) * 100, 0),
  };
}

export function formatMarketCap(value, currency) {
  if (!value) return "—";
  const sym = CURRENCY[currency] || "";
  if (value >= 1e12) return `${sym}${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e8) return `${sym}${(value / 1e8).toFixed(1)} 亿`;
  if (value >= 1e6) return `${sym}${(value / 1e6).toFixed(1)}M`;
  return `${sym}${Number(value).toLocaleString("zh-CN")}`;
}

export function formatCompactNumber(value, currency) {
  if (value == null) return "—";
  const sym = CURRENCY[currency] || "";
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${sym}${(value / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${sym}${(value / 1e4).toFixed(1)} 万`;
  return `${sym}${Number(value).toLocaleString("zh-CN")}`;
}

export function formatFinancialMillions(value, currency) {
  if (value == null) return "—";
  return formatCompactNumber(value * 1_000_000, currency);
}

export function peerContext(stock, pool) {
  const peers = pool.filter((item) => item.industry === stock.industry && item.market === stock.market);
  if (peers.length <= 1) return "";
  const peValues = peers.map((item) => item.quote.pe).filter(Boolean);
  if (!stock.quote.pe) {
    return `同业 ${peers.length} 只：当前亏损，PE 不可比。`;
  }
  if (!peValues.length) return `同业 ${peers.length} 只：多数亏损，PE 可比性有限。`;
  const sorted = [...peValues].sort((a, b) => a - b);
  const rank = sorted.filter((pe) => pe < stock.quote.pe).length + 1;
  const avg = average(sorted);
  return `同业 ${peers.length} 只：PE 排名 ${rank}/${sorted.length}，行业均值 ${avg.toFixed(1)}x，当前 ${stock.quote.pe.toFixed(1)}x。`;
}

export function markerPosition(stock) {
  const min = stock.valuation.bear_price;
  const max = stock.valuation.risk_price;
  return clamp(((stock.quote.price - min) / (max - min)) * 100, 1, 99);
}

export function watchAlertLevel(stock, saved) {
  const price = stock.quote.price;
  if (saved.stopLoss && price <= saved.stopLoss) return "hit";
  if (saved.buy && price <= saved.buy) return "hit";
  if (saved.takeProfit && price >= saved.takeProfit) return "hit";
  if (saved.buy && price <= saved.buy * 1.03) return "near";
  if (saved.takeProfit && price >= saved.takeProfit * 0.97) return "near";
  if (saved.stopLoss && price <= saved.stopLoss * 1.03) return "near";
  return "calm";
}

export function watchAlertText(stock, saved) {
  const price = stock.quote.price;
  if (saved.stopLoss && price <= saved.stopLoss) return "触及止损";
  if (saved.buy && price <= saved.buy) return "触及买入关注";
  if (saved.takeProfit && price >= saved.takeProfit) return "触及止盈";
  if (saved.buy && price <= saved.buy * 1.03) return `接近买入 ${distanceToTarget(price, saved.buy)}`;
  if (saved.takeProfit && price >= saved.takeProfit * 0.97) return "接近止盈";
  return "跟踪中";
}

export function distanceToTarget(price, targetPrice) {
  if (!targetPrice) return "—";
  const gap = ((price - targetPrice) / targetPrice) * 100;
  if (gap <= 0) return `${Math.abs(gap).toFixed(1)}% 以内`;
  return `+${gap.toFixed(1)}%`;
}
