import { appConfig, els, setAppConfig } from "./state.js";
import { escapeAttr, escapeHtml } from "./utils.js";
import { registerRenderers, renderDividend } from "./views/render.js";

const DIVIDEND_FIELDS = [
  ["index_code", "中证指数代码", "H30269"],
  ["index_name", "短名（笔记标题用）", "红利低波"],
  ["index_full_name", "指数全名", "中证红利低波"],
  ["danjuan_code", "蛋卷估值代码", "CSIH30269"],
  ["etf_symbol", "跟踪 ETF 代码", "512890"],
  ["etf_name", "跟踪 ETF 名称", "红利低波ETF"],
];

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
  els.settingsForm.innerHTML = `
    <div class="config-group">
      <h3>红利低波日度决策</h3>
      <p class="muted">默认跟踪中证红利低波（H30269）。可换成其他指数：需要同时提供中证指数代码、蛋卷估值代码与跟踪 ETF。</p>
      ${DIVIDEND_FIELDS.map(
        ([key, label, placeholder]) => `
          <label>
            <span>${escapeHtml(label)}</span>
            <input type="text" data-dividend-key="${escapeAttr(key)}" value="${escapeAttr(dividend[key] ?? "")}" placeholder="${escapeAttr(placeholder)}" />
          </label>
        `,
      ).join("")}
    </div>
    <div class="config-group">
      <h3>行情源</h3>
      <p class="muted">${escapeHtml(quotes.provider_name || "腾讯行情")} · ${escapeHtml(quotes.note || "")}</p>
      <p class="muted">ETF 池的自选与持仓保存在项目根目录 workspace.json，默认池种子在 config.json 的 etf.pool。</p>
    </div>
  `;
}

export async function saveAppConfig() {
  if (!els.settingsForm) return;
  const dividend = { ...(appConfig?.dividend || {}) };
  els.settingsForm.querySelectorAll("input[data-dividend-key]").forEach((input) => {
    dividend[input.dataset.dividendKey] = input.value.trim();
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
    if (els.settingsStatus) els.settingsStatus.textContent = "已保存到 config.json，红利低波数据将按新配置刷新";
    renderSettings();
    renderDividend({ force: true });
  } catch (error) {
    if (els.settingsStatus) els.settingsStatus.textContent = `保存失败：${error}`;
  }
}

registerRenderers({ renderSettings });
