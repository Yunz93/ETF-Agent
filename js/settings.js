import { appConfig, els, setAppConfig } from "./state.js";
import { escapeAttr, escapeHtml } from "./utils.js";
import { registerRenderers, renderDividend } from "./views/render.js";

export async function loadAppConfig({ rerender = false } = {}) {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`config API ${response.status}`);
    setAppConfig(await response.json());
    if (rerender) renderSettings();
    if (els.settingsStatus && rerender) els.settingsStatus.textContent = "已重新加载 config.json";
  } catch (error) {
    if (els.settingsStatus) els.settingsStatus.textContent = `配置加载失败：${error}`;
  }
}

export function renderSettings() {
  if (!els.settingsForm) return;
  const dividend = appConfig?.dividend || {};
  const quotes = appConfig?.quotes || {};
  const cacheSeconds = dividend.cache_seconds ?? 1800;
  els.settingsForm.innerHTML = `
    <div class="config-group">
      <h3>启动默认</h3>
      <p class="muted">需已在定投计划中</p>
      <label>
        <span>默认分析 ETF 代码</span>
        <input type="text" data-dividend-key="etf_symbol" value="${escapeAttr(dividend.etf_symbol ?? "")}" placeholder="512890" />
      </label>
      <label>
        <span>默认 ETF 名称（可选）</span>
        <input type="text" data-dividend-key="etf_name" value="${escapeAttr(dividend.etf_name ?? "")}" placeholder="红利低波ETF" />
      </label>
      <label>
        <span>分析缓存（秒）</span>
        <input type="number" min="60" step="60" data-dividend-key="cache_seconds" value="${escapeAttr(String(cacheSeconds))}" placeholder="1800" />
      </label>
    </div>
    <div class="config-group">
      <h3>行情与数据</h3>
      <p class="muted">${escapeHtml(quotes.provider_name || "腾讯行情")}</p>
    </div>
    <div class="config-group config-group-advanced">
      <h3>高级 · 默认指数映射</h3>
      <p class="muted">仅影响未进池时的默认口径</p>
      <label>
        <span>中证指数代码</span>
        <input type="text" data-dividend-key="index_code" value="${escapeAttr(dividend.index_code ?? "")}" placeholder="H30269" />
      </label>
      <label>
        <span>蛋卷估值代码</span>
        <input type="text" data-dividend-key="danjuan_code" value="${escapeAttr(dividend.danjuan_code ?? "")}" placeholder="CSIH30269" />
      </label>
      <label>
        <span>指数短名</span>
        <input type="text" data-dividend-key="index_name" value="${escapeAttr(dividend.index_name ?? "")}" placeholder="红利低波" />
      </label>
      <label>
        <span>指数全名</span>
        <input type="text" data-dividend-key="index_full_name" value="${escapeAttr(dividend.index_full_name ?? "")}" placeholder="中证红利低波" />
      </label>
    </div>
  `;
}

export async function saveAppConfig() {
  if (!els.settingsForm) return;
  const dividend = { ...(appConfig?.dividend || {}) };
  els.settingsForm.querySelectorAll("[data-dividend-key]").forEach((input) => {
    const key = input.dataset.dividendKey;
    if (key === "cache_seconds") {
      const n = Number.parseInt(input.value, 10);
      dividend[key] = Number.isFinite(n) && n >= 60 ? n : 1800;
    } else {
      dividend[key] = input.value.trim();
    }
  });
  const payload = { ...(appConfig || {}), dividend };
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`config API ${response.status}`);
    setAppConfig(await response.json());
    if (els.settingsStatus) els.settingsStatus.textContent = "已保存到 config.json";
    renderSettings();
    renderDividend({ force: true });
  } catch (error) {
    if (els.settingsStatus) els.settingsStatus.textContent = `保存失败：${error}`;
  }
}

registerRenderers({ renderSettings });
