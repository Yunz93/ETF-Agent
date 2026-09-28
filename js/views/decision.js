import { els, state } from "../state.js";
import { escapeAttr, escapeHtml } from "../utils.js";
import { persistWorkspace } from "../workspace.js";
import {
  INDEX_PRESETS,
  kindLabel,
  normalizeDecision,
  normalizeEtfCode,
  normalizeInstrument,
  normalizeSleeve,
  primaryInstrument,
  projectDecisionEtfs,
  removeInstrument,
  sleeveById,
  upsertInstrument,
} from "../decision-model.js";
import {
  ensurePoolAnalysisPrefetch,
  getCachedAnalysis,
  isAnalysisUsable,
  prioritizeAnalysis,
  refreshStalePoolAnalysis,
} from "../analysis-cache.js";
import { callRenderer, openAnalysis, registerRenderers } from "./render.js";

let catalogCache = null;
let notice = "";

function moneyPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function signedPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${number.toFixed(1)}%`;
}

export function syncDecisionProjection() {
  state.decision = normalizeDecision(state.decision, {
    portfolio: state.portfolioEnvelope?.portfolio || null,
  });
  state.etfs = projectDecisionEtfs(state.decision);
}

function saveDecision() {
  syncDecisionProjection();
  persistWorkspace({ immediate: true });
  renderDecision();
}

function analysisFor(symbol) {
  return getCachedAnalysis(symbol);
}

function sleeveSnapshot(sleeve) {
  const primary = primaryInstrument(sleeve);
  const payload = primary ? analysisFor(primary.symbol) : null;
  const grade = payload?.score?.grade || "—";
  const pe = payload?.valuation?.pe_percentile_10y;
  const tracking = payload?.etf?.product_quality?.price_deviation_volatility_pct;
  const premium = payload?.etf?.product_quality?.premium_discount_pct;
  return { primary, payload, grade, pe, tracking, premium, usable: isAnalysisUsable(payload) };
}

function instrumentCounts(sleeve) {
  const exchange = (sleeve.instruments || []).filter((row) => row.kind === "exchange").length;
  const fund = (sleeve.instruments || []).filter((row) => row.kind === "fund").length;
  return { exchange, fund };
}

export function renderDecisionSidebar() {
  if (!els.sidebarEtfList) return;
  const sleeves = state.decision?.sleeves || [];
  if (els.sidebarPoolCount) els.sidebarPoolCount.textContent = String(sleeves.length);
  if (!sleeves.length) {
    els.sidebarEtfList.innerHTML = `<p class="sidebar-etf-empty muted">尚未设置指数组合</p>`;
    return;
  }
  els.sidebarEtfList.innerHTML = sleeves
    .map((sleeve) => {
      const snap = sleeveSnapshot(sleeve);
      const active = state.analysisSleeveId === sleeve.id && state.activeView === "dividend";
      return `<button type="button" class="sidebar-etf-item${active ? " is-active" : ""}" data-open-sleeve="${escapeAttr(sleeve.id)}" title="${escapeAttr(sleeve.name)}">
        <span class="sidebar-etf-mark">${escapeHtml(sleeve.name.slice(0, 1))}</span>
        <span class="sidebar-etf-name"><strong>${escapeHtml(sleeve.name)}</strong><span class="muted">${escapeHtml(sleeve.index_code)}</span></span>
        <span class="sidebar-etf-meta">${snap.grade} · ${moneyPct(sleeve.target_pct)}</span>
      </button>`;
    })
    .join("");
}

function sleeveCard(sleeve) {
  const snap = sleeveSnapshot(sleeve);
  const counts = instrumentCounts(sleeve);
  const peText = snap.pe == null ? "PE 分位 —" : `PE 分位 ${Math.round(Number(snap.pe) * 100)}%`;
  const status = snap.usable ? peText : "指数数据加载中或暂不可用";
  return `
    <article class="decision-sleeve-card">
      <header>
        <div>
          <h3>${escapeHtml(sleeve.name)}</h3>
          <p class="muted">跟踪 ${escapeHtml(sleeve.index_code)} · 目标 ${moneyPct(sleeve.target_pct)}</p>
        </div>
        <strong class="decision-grade">${escapeHtml(snap.grade)}</strong>
      </header>
      <p class="decision-sleeve-status">${escapeHtml(status)}</p>
      <ul class="decision-instrument-chips">
        ${(sleeve.instruments || [])
          .map(
            (row) => `<li>
              <button type="button" class="link-button" data-open-instrument="${escapeAttr(row.symbol)}" data-sleeve="${escapeAttr(sleeve.id)}">${escapeHtml(row.name)}</button>
              <span class="muted">${escapeHtml(kindLabel(row.kind))}${row.role === "primary" ? " · 主品种" : ""}</span>
            </li>`,
          )
          .join("")}
      </ul>
      <p class="muted">场内 ${counts.exchange} · 场外 ${counts.fund}</p>
      <div class="decision-sleeve-actions">
        <button class="primary-button compact" type="button" data-open-sleeve="${escapeAttr(sleeve.id)}">指数分析</button>
        <button class="ghost-button compact" type="button" data-open-instruments="${escapeAttr(sleeve.id)}">品种跟踪</button>
      </div>
    </article>
  `;
}

function editorHtml() {
  const decision = state.decision;
  const sleeves = decision.sleeves || [];
  return `
    <section class="portfolio-section decision-editor">
      <div class="portfolio-heading">
        <h2>自定义组合</h2>
        <p class="muted">按跟踪指数设目标权重；每个指数可同时纳入场内 ETF 与场外基金。跟踪误差在品种详情中查看。</p>
      </div>
      <form data-decision-form="meta" class="portfolio-form">
        <label>组合名称<input name="name" value="${escapeAttr(decision.name)}" maxlength="40" required /></label>
        <label class="grow">备注<input name="note" value="${escapeAttr(decision.note)}" maxlength="120" /></label>
        <button class="ghost-button" type="submit">保存名称</button>
      </form>
      <form data-decision-form="weights" class="portfolio-form decision-weight-form">
        ${sleeves
          .map(
            (sleeve) => `<label>${escapeHtml(sleeve.name)}
              <input name="${escapeAttr(sleeve.id)}" type="number" min="0" max="100" step="0.1" value="${sleeve.target_pct}" required />
            </label>`,
          )
          .join("")}
        <button class="primary-button" type="submit">保存权重（合计 100%）</button>
      </form>
      <details class="decision-add-sleeve">
        <summary>新增指数袖子</summary>
        <form data-decision-form="add-sleeve" class="portfolio-form">
          <label>预设指数
            <select name="preset">
              <option value="">自定义</option>
              ${INDEX_PRESETS.map((row) => `<option value="${escapeAttr(row.id)}">${escapeHtml(row.name)}</option>`).join("")}
            </select>
          </label>
          <label>名称<input name="name" placeholder="例如 纳指" maxlength="40" /></label>
          <label>指数代码<input name="index_code" placeholder="NDX / SPX / H30269" maxlength="16" /></label>
          <label>主品种代码<input name="primary_symbol" placeholder="513390" maxlength="6" /></label>
          <label>主品种名称<input name="primary_name" placeholder="纳指100ETF" maxlength="40" /></label>
          <button class="primary-button" type="submit">加入组合</button>
        </form>
      </details>
      ${sleeves
        .map((sleeve) => {
          return `<article class="decision-sleeve-edit">
            <div class="portfolio-heading">
              <h3>${escapeHtml(sleeve.name)}</h3>
              <button class="ghost-button compact danger" type="button" data-remove-sleeve="${escapeAttr(sleeve.id)}" ${sleeves.length < 2 ? "disabled" : ""}>移除指数</button>
            </div>
            <table class="portfolio-table">
              <thead><tr><th>品种</th><th>渠道</th><th>角色</th><th></th></tr></thead>
              <tbody>
                ${(sleeve.instruments || [])
                  .map(
                    (row) => `<tr>
                      <td><button class="link-button" type="button" data-open-instrument="${escapeAttr(row.symbol)}" data-sleeve="${escapeAttr(sleeve.id)}">${escapeHtml(row.name)}</button><small>${escapeHtml(row.symbol)}</small></td>
                      <td>${escapeHtml(kindLabel(row.kind))}</td>
                      <td>${row.role === "primary" ? "主品种" : "备选"}</td>
                      <td><button class="ghost-button compact" type="button" data-primary="${escapeAttr(row.id)}" data-sleeve="${escapeAttr(sleeve.id)}">设为主品种</button>
                          <button class="ghost-button compact danger" type="button" data-remove-instrument="${escapeAttr(row.id)}" data-sleeve="${escapeAttr(sleeve.id)}" ${(sleeve.instruments || []).length < 2 ? "disabled" : ""}>移除</button></td>
                    </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
            <form data-decision-form="add-instrument" data-sleeve="${escapeAttr(sleeve.id)}" class="portfolio-form">
              <label>代码<input name="symbol" required maxlength="6" placeholder="513100 或场外基金代码" /></label>
              <label>名称<input name="name" maxlength="40" placeholder="可选" /></label>
              <label>渠道<select name="kind"><option value="exchange">场内 ETF</option><option value="fund">场外基金</option></select></label>
              <button class="ghost-button" type="submit">加入该指数</button>
            </form>
          </article>`;
        })
        .join("")}
    </section>
  `;
}

export function renderDecision({ refresh = false } = {}) {
  syncDecisionProjection();
  const root = document.querySelector(`#${state.activeView}View [data-portfolio-root]`)
    || document.querySelector("#homeView [data-portfolio-root]");
  renderDecisionSidebar();
  ensurePoolAnalysisPrefetch({
    onUpdate: () => {
      if (state.activeView === "home" || state.activeView === "assets") renderDecision();
      renderDecisionSidebar();
    },
  });
  if (refresh) {
    refreshStalePoolAnalysis({
      onUpdate: () => {
        if (state.activeView === "home" || state.activeView === "assets") renderDecision();
        renderDecisionSidebar();
      },
    });
  }
  if (!root) return;
  if (state.activeView === "assets") {
    root.innerHTML = `<p class="portfolio-status" role="status">${escapeHtml(notice)}</p>${editorHtml()}`;
    bindDecisionRoot(root);
    return;
  }
  const sleeves = state.decision?.sleeves || [];
  root.innerHTML = `
    <p class="portfolio-status" role="status">${escapeHtml(notice)}</p>
    <section class="portfolio-section">
      <div class="portfolio-heading">
        <div>
          <h2>${escapeHtml(state.decision.name || "核心指数组合")}</h2>
          <p class="muted">只做指数配置与品种选择，不做记账。分析分两层：指数判断、场内/场外跟踪质量。</p>
        </div>
        <button class="ghost-button" type="button" data-go="assets">编辑组合</button>
      </div>
      <div class="decision-sleeve-grid">
        ${sleeves.map(sleeveCard).join("")}
      </div>
    </section>
  `;
  bindDecisionRoot(root);
}

function bindDecisionRoot(root) {
  root.onclick = (event) => {
    const go = event.target.closest?.("[data-go]");
    if (go) {
      callRenderer("switchView", go.dataset.go);
      return;
    }
    const sleeveBtn = event.target.closest?.("[data-open-sleeve]");
    if (sleeveBtn) {
      openSleeve(sleeveBtn.dataset.openSleeve, "index");
      return;
    }
    const instrumentsBtn = event.target.closest?.("[data-open-instruments]");
    if (instrumentsBtn) {
      openSleeve(instrumentsBtn.dataset.openInstruments, "instrument");
      return;
    }
    const instrumentBtn = event.target.closest?.("[data-open-instrument]");
    if (instrumentBtn) {
      openSleeve(instrumentBtn.dataset.sleeve, "instrument", instrumentBtn.dataset.openInstrument);
      return;
    }
    const removeSleeve = event.target.closest?.("[data-remove-sleeve]");
    if (removeSleeve) {
      state.decision.sleeves = state.decision.sleeves.filter((row) => row.id !== removeSleeve.dataset.removeSleeve);
      notice = "已移除指数";
      saveDecision();
      return;
    }
    const removeInst = event.target.closest?.("[data-remove-instrument]");
    if (removeInst) {
      const sleeve = sleeveById(state.decision, removeInst.dataset.sleeve);
      if (!sleeve) return;
      const next = removeInstrument(sleeve, removeInst.dataset.removeInstrument);
      state.decision.sleeves = state.decision.sleeves.map((row) => (row.id === sleeve.id ? next : row));
      notice = "已移除品种";
      saveDecision();
      return;
    }
    const primaryBtn = event.target.closest?.("[data-primary]");
    if (primaryBtn) {
      const sleeve = sleeveById(state.decision, primaryBtn.dataset.sleeve);
      if (!sleeve) return;
      const instruments = (sleeve.instruments || []).map((row) => ({
        ...row,
        role: row.id === primaryBtn.dataset.primary ? "primary" : "alternate",
      }));
      state.decision.sleeves = state.decision.sleeves.map((row) =>
        row.id === sleeve.id ? { ...sleeve, instruments } : row,
      );
      notice = "已更新主品种";
      saveDecision();
    }
  };
  root.onsubmit = async (event) => {
    const form = event.target.closest?.("[data-decision-form]");
    if (!form) return;
    event.preventDefault();
    const type = form.dataset.decisionForm;
    const data = Object.fromEntries(new FormData(form).entries());
    if (type === "meta") {
      state.decision.name = String(data.name || "").trim() || "核心指数组合";
      state.decision.note = String(data.note || "").trim();
      notice = "已保存组合名称";
      saveDecision();
      return;
    }
    if (type === "weights") {
      state.decision.sleeves = state.decision.sleeves.map((sleeve) => ({
        ...sleeve,
        target_pct: Number(data[sleeve.id]),
      }));
      state.decision = normalizeDecision(state.decision);
      notice = "已按 100% 归一化目标权重";
      saveDecision();
      return;
    }
    if (type === "add-sleeve") {
      const preset = INDEX_PRESETS.find((row) => row.id === data.preset);
      const indexCode = String(data.index_code || preset?.index_code || "").trim().toUpperCase();
      const name = String(data.name || preset?.name || "").trim();
      const symbol = normalizeEtfCode(data.primary_symbol || preset?.primary_symbol);
      if (!indexCode || !name || !symbol) {
        notice = "请填写指数名称、代码与主品种";
        renderDecision();
        return;
      }
      if (state.decision.sleeves.some((row) => row.index_code === indexCode || row.id === (preset?.id || indexCode.toLowerCase()))) {
        notice = "该指数已在组合中";
        renderDecision();
        return;
      }
      const sleeve = normalizeSleeve({
        id: preset?.id || indexCode.toLowerCase(),
        name,
        index_code: indexCode,
        target_pct: 0,
        instruments: [
          {
            symbol,
            name: String(data.primary_name || "").trim() || symbol,
            kind: "exchange",
            role: "primary",
          },
        ],
      });
      if (!sleeve) {
        notice = "无法添加该指数";
        renderDecision();
        return;
      }
      state.decision.sleeves = [...state.decision.sleeves, sleeve];
      state.decision = normalizeDecision(state.decision);
      notice = `已加入 ${sleeve.name}`;
      saveDecision();
      return;
    }
    if (type === "add-instrument") {
      const sleeve = sleeveById(state.decision, form.dataset.sleeve);
      if (!sleeve) return;
      const symbol = normalizeEtfCode(data.symbol);
      const kind = data.kind === "fund" ? "fund" : "exchange";
      if (!symbol) {
        notice = "请输入 6 位代码";
        renderDecision();
        return;
      }
      let name = String(data.name || "").trim();
      if (kind === "exchange" && !name) {
        try {
          const response = await fetch(`/api/etf/quotes?symbols=${encodeURIComponent(symbol)}`);
          const payload = await response.json();
          name = payload.quotes?.[0]?.name || "";
        } catch {
          name = "";
        }
      }
      const instrument = normalizeInstrument(
        { symbol, name: name || (kind === "fund" ? `场外 ${symbol}` : symbol), kind, role: "alternate" },
        sleeve.index_code,
      );
      const next = upsertInstrument(sleeve, instrument);
      state.decision.sleeves = state.decision.sleeves.map((row) => (row.id === sleeve.id ? next : row));
      notice = `已将 ${instrument.symbol} 纳入 ${sleeve.name}`;
      saveDecision();
    }
  };
}

export function openSleeve(sleeveId, layer = "index", symbol = null) {
  const sleeve = sleeveById(state.decision, sleeveId);
  if (!sleeve) return;
  const primary = primaryInstrument(sleeve);
  const target = normalizeEtfCode(symbol) || primary?.symbol;
  if (!target) return;
  state.analysisSleeveId = sleeve.id;
  state.analysisLayer = layer === "instrument" ? "instrument" : "index";
  state.analysisInstrument = layer === "instrument" ? target : primary?.symbol;
  prioritizeAnalysis(target);
  openAnalysis(layer === "instrument" ? target : primary.symbol);
}

export async function loadIndexCatalog() {
  if (catalogCache) return catalogCache;
  try {
    const response = await fetch("/api/index/catalog");
    catalogCache = await response.json();
  } catch {
    catalogCache = { presets: INDEX_PRESETS, indexes: [] };
  }
  return catalogCache;
}

registerRenderers({
  renderPortfolio: renderDecision,
  renderEtfPool: renderDecision,
  renderSidebarEtfs: renderDecisionSidebar,
  refreshPortfolio: () => renderDecision({ refresh: true }),
});
