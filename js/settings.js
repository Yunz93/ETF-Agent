import { appConfig, els, setAppConfig } from "./state.js";
import { autoRefreshSettings, configureAutoRefresh } from "./auto-refresh.js";
import { escapeAttr } from "./utils.js";
import { registerRenderers } from "./views/render.js";

export async function loadAppConfig({ rerender = false } = {}) {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`config API ${response.status}`);
    setAppConfig(await response.json());
    configureAutoRefresh();
    if (rerender) renderSettings();
    if (els.settingsStatus && rerender) els.settingsStatus.textContent = "已重新加载 config.json";
  } catch (error) {
    if (els.settingsStatus) els.settingsStatus.textContent = `配置加载失败：${error}`;
  }
}

export function renderSettings() {
  if (!els.settingsForm) return;
  const autoRefresh = autoRefreshSettings(appConfig);
  const ai = appConfig?.ai || {};
  const provider = ai.provider === "openai" ? "openai" : "deepseek";
  const credentials = ai.credentials || {};
  const credential = credentials[provider] || {};
  els.settingsForm.innerHTML = `
    <div class="settings-control-grid">
      <label class="config-toggle">
        <span>自动刷新</span>
        <span class="config-toggle-control">
          <input type="checkbox" data-quotes-key="auto_refresh_enabled"${autoRefresh.enabled ? " checked" : ""} />
          <strong>自动更新当前页面</strong>
        </span>
      </label>
      <label>
        <span>刷新频率</span>
        <select data-quotes-key="refresh_interval_seconds"${autoRefresh.enabled ? "" : " disabled"}>
          <option value="30"${autoRefresh.seconds === 30 ? " selected" : ""}>每 30 秒</option>
          <option value="60"${autoRefresh.seconds === 60 ? " selected" : ""}>每 1 分钟</option>
          <option value="300"${autoRefresh.seconds === 300 ? " selected" : ""}>每 5 分钟</option>
          <option value="900"${autoRefresh.seconds === 900 ? " selected" : ""}>每 15 分钟</option>
          <option value="1800"${autoRefresh.seconds === 1800 ? " selected" : ""}>每 30 分钟</option>
        </select>
      </label>
    </div>
    <div class="settings-ai">
      <div class="settings-ai-heading">
        <div>
          <strong>AI 分析</strong>
          <p class="muted">模型识别每只 ETF 的关键矛盾，最终金额仍由本地风控约束。</p>
        </div>
        <label class="config-toggle-control">
          <input type="checkbox" data-ai-key="enabled"${ai.enabled ? " checked" : ""} />
          <span>启用</span>
        </label>
      </div>
      <div class="settings-control-grid">
        <label>
          <span>提供商</span>
          <select data-ai-key="provider">
            <option value="deepseek"${provider === "deepseek" ? " selected" : ""}>DeepSeek</option>
            <option value="openai"${provider === "openai" ? " selected" : ""}>OpenAI</option>
          </select>
        </label>
        <label>
          <span>模型</span>
          <input
            type="text"
            data-ai-model="${provider}"
            maxlength="80"
            value="${escapeAttr(ai.models?.[provider] || "")}"
          />
        </label>
      </div>
      <div class="settings-secret-row">
        <label>
          <span>API Key</span>
          <input type="password" data-ai-secret autocomplete="new-password" placeholder="${credential.configured ? "已配置；留空表示不修改" : "输入后保存到 macOS 钥匙串"}" />
        </label>
        <button class="ghost-button compact" data-ai-save-key type="button">保存密钥</button>
        <button class="ghost-button compact" data-ai-test type="button">测试连接</button>
        <button class="ghost-button compact danger" data-ai-delete-key type="button"${credential.configured ? "" : " disabled"}>删除密钥</button>
      </div>
      <p class="muted settings-ai-status" data-ai-status>
        ${credential.configured ? `密钥已配置（${credential.source === "environment" ? "环境变量" : "macOS 钥匙串"}）` : "尚未配置密钥"}
      </p>
    </div>
  `;
  const autoRefreshToggle = els.settingsForm.querySelector('[data-quotes-key="auto_refresh_enabled"]');
  const autoRefreshInterval = els.settingsForm.querySelector('[data-quotes-key="refresh_interval_seconds"]');
  autoRefreshToggle?.addEventListener("change", () => {
    if (autoRefreshInterval) autoRefreshInterval.disabled = !autoRefreshToggle.checked;
  });
  const providerSelect = els.settingsForm.querySelector('[data-ai-key="provider"]');
  providerSelect?.addEventListener("change", async () => {
    await saveAppConfig({ quiet: true });
    renderSettings();
  });
  els.settingsForm.querySelector("[data-ai-save-key]")?.addEventListener("click", saveAIKey);
  els.settingsForm.querySelector("[data-ai-delete-key]")?.addEventListener("click", deleteAIKey);
  els.settingsForm.querySelector("[data-ai-test]")?.addEventListener("click", testAIConnection);
}

function settingsStatus(message) {
  const node = els.settingsForm?.querySelector("[data-ai-status]");
  if (node) node.textContent = message;
}

async function readApiError(response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error || `API ${response.status}`;
}

async function saveAIKey() {
  const provider = els.settingsForm?.querySelector('[data-ai-key="provider"]')?.value || "deepseek";
  const input = els.settingsForm?.querySelector("[data-ai-secret]");
  const apiKey = input?.value.trim();
  if (!apiKey) {
    settingsStatus("请输入 API Key");
    return;
  }
  settingsStatus("正在写入 macOS 钥匙串…");
  const response = await fetch("/api/ai/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!response.ok) {
    settingsStatus(`保存失败：${await readApiError(response)}`);
    return;
  }
  if (input) input.value = "";
  await loadAppConfig();
  renderSettings();
  settingsStatus("密钥已安全保存");
}

async function deleteAIKey() {
  const provider = els.settingsForm?.querySelector('[data-ai-key="provider"]')?.value || "deepseek";
  const response = await fetch("/api/ai/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, delete: true }),
  });
  if (!response.ok) {
    settingsStatus(`删除失败：${await readApiError(response)}`);
    return;
  }
  await loadAppConfig();
  renderSettings();
  settingsStatus("钥匙串中的密钥已删除");
}

async function testAIConnection() {
  await saveAppConfig({ quiet: true });
  const provider = appConfig?.ai?.provider || "deepseek";
  settingsStatus("正在测试连接…");
  const response = await fetch("/api/ai/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  settingsStatus(response.ok ? "连接成功，可以使用 AI 分析" : `连接失败：${await readApiError(response)}`);
}

export async function saveAppConfig({ quiet = false } = {}) {
  if (!els.settingsForm) return;
  const quotes = { ...(appConfig?.quotes || {}) };
  els.settingsForm.querySelectorAll("[data-quotes-key]").forEach((input) => {
    const key = input.dataset.quotesKey;
    quotes[key] = input.type === "checkbox" ? input.checked : Number.parseInt(input.value, 10);
  });
  const ai = {
    ...(appConfig?.ai || {}),
    models: { ...(appConfig?.ai?.models || {}) },
  };
  els.settingsForm.querySelectorAll("[data-ai-key]").forEach((input) => {
    const key = input.dataset.aiKey;
    ai[key] = input.type === "checkbox" ? input.checked : input.value;
  });
  const modelInput = els.settingsForm.querySelector("[data-ai-model]");
  if (modelInput) ai.models[modelInput.dataset.aiModel] = modelInput.value.trim();
  delete ai.credentials;
  const payload = { ...(appConfig || {}), quotes, ai };
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`config API ${response.status}`);
    setAppConfig(await response.json());
    configureAutoRefresh();
    if (!quiet && els.settingsStatus) els.settingsStatus.textContent = "已保存";
    if (!quiet) renderSettings();
  } catch (error) {
    if (els.settingsStatus) els.settingsStatus.textContent = `保存失败：${error}`;
  }
}

registerRenderers({ renderSettings });
