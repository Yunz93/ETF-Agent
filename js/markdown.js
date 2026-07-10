import { DECISION_LABELS } from "./constants.js";
import { state } from "./state.js";
import { formatMarginOfSafety, marginOfSafety } from "./analysis.js";
import { escapeHtml, marketLabel, money, stockKey, valuationLabel } from "./utils.js";

export function exportSelectedMarkdown() {
  const stock = state.selected;
  if (!stock) return;
  const note = state.notes[stockKey(stock)] || {};
  const holding = state.holdings[stockKey(stock)];
  const lines = [
    `# ${stock.name} (${stock.symbol})`,
    "",
    `- 市场：${marketLabel(stock.market)}`,
    `- 行业：${stock.industry}`,
    `- 现价：${money(stock.quote.price, stock.currency)}`,
    `- 估值：${valuationLabel(stock.valuation.state)}`,
    `- 安全边际：${formatMarginOfSafety(marginOfSafety(stock))}`,
    `- 评分：${stock.analysis.score}/100`,
    "",
    "## 摘要",
    stock.analysis.summary,
    "",
    "## 积极因素",
    ...(stock.analysis.positives.map((item) => `- ${item}`) || ["- 无"]),
    "",
    "## 风险因素",
    ...stock.analysis.risks.map((item) => `- ${item}`),
    "",
    "## 估值区间",
    `- 保守：${money(stock.valuation.bear_price, stock.currency)}`,
    `- 基准：${money(stock.valuation.base_price, stock.currency)}`,
    `- 乐观：${money(stock.valuation.bull_price, stock.currency)}`,
    "",
    "## 判断卡",
    note.thesis || "（空）",
    "",
    `- 决策：${DECISION_LABELS[note.decision] || "观望"}`,
    `- 失效条件：${note.invalidation || "（空）"}`,
    `- 关注价：${note.watchPrice != null ? money(note.watchPrice, stock.currency) : "—"}`,
    `- 下次复盘：${note.reviewDate || "—"}`,
    `- 更新于：${note.updatedAt ? new Date(note.updatedAt).toLocaleString("zh-CN") : "—"}`,
  ];
  const evidence = Array.isArray(note.evidence) ? note.evidence : [];
  if (evidence.length) {
    lines.push("", "### 证据链接", ...evidence.map((url) => `- ${url}`));
  }
  if (holding) {
    lines.push("", "## 持仓", `- 数量：${holding.shares}`, `- 成本：${money(holding.cost, stock.currency)}`);
  }
  const aiReport = state.aiReports[stockKey(stock)];
  if (aiReport?.content) {
    lines.push(
      "",
      "## AI 深度分析",
      `- 模型：${aiReport.provider_name || aiReport.provider || "—"} / ${aiReport.model || "—"}`,
      `- 历史区间：${aiReport.history_range || "—"}`,
      `- 生成时间：${aiReport.generated_at ? new Date(aiReport.generated_at).toLocaleString("zh-CN") : "—"}`,
      "",
      aiReport.content,
    );
  }
  lines.push("", "> 仅供研究参考，不构成投资建议。");
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${stock.market}-${stock.symbol}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}
export async function requestAiAnalysis(stock, { historyRange = "1y", focus = "" } = {}) {
  const key = stockKey(stock);
  const payload = {
    history_range: historyRange,
    focus,
    note: state.notes[key] || {},
    holding: state.holdings[key] || null,
    stock: {
      symbol: stock.symbol,
      name: stock.name,
      englishName: stock.englishName,
      market: stock.market,
      exchange: stock.exchange,
      currency: stock.currency,
      industry: stock.industry,
      quote: stock.quote,
      valuation: stock.valuation,
      analysis: stock.analysis,
      financials: stock.financials || [],
      events: stock.events || null,
    },
  };
  const response = await fetch("/api/ai/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `AI 分析失败 ${response.status}`);
    err.code = data.code;
    throw err;
  }
  return {
    ...data,
    focus,
    content: data.content || "",
  };
}

export function renderAiReport(resultEl, statusEl, toThesisButton, report) {
  if (!resultEl) return;
  if (!report?.content) {
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    if (toThesisButton) toThesisButton.hidden = true;
    return;
  }
  resultEl.hidden = false;
  resultEl.innerHTML = renderMarkdownLite(report.content);
  if (toThesisButton) toThesisButton.hidden = false;
  if (statusEl) {
    const when = report.generated_at ? new Date(report.generated_at).toLocaleString("zh-CN") : "";
    statusEl.textContent = [
      report.provider_name || report.provider,
      report.model,
      report.history_range ? `历史 ${report.history_range}` : "",
      when,
    ]
      .filter(Boolean)
      .join(" · ");
  }
}

export function extractAiThesisSnippet(content) {
  const text = String(content || "").trim();
  if (!text) return "";
  const sections = text.split(/\n(?=##\s+)/);
  const preferred = sections.find((block) => /操作建议|投资建议|结论|综合判断/.test(block)) || sections[0] || text;
  const cleaned = preferred
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .trim();
  return cleaned.length > 600 ? `${cleaned.slice(0, 600)}…` : cleaned;
}

export function renderMarkdownLite(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inUl = false;
  let inOl = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) html.push(`<p>${formatInlineMarkdown(text)}</p>`);
    paragraph = [];
  };
  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeLists();
      const level = Math.min(heading[1].length + 2, 5);
      html.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${formatInlineMarkdown(ul[1])}</li>`);
      continue;
    }
    const ol = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${formatInlineMarkdown(ol[1])}</li>`);
      continue;
    }
    closeLists();
    paragraph.push(trimmed);
  }
  flushParagraph();
  closeLists();
  return html.join("") || `<p class="muted">（空）</p>`;
}

export function formatInlineMarkdown(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/(^|[^\*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  return value;
}
