import { appConfig, els, runtimeInfo, setAppConfig } from "./state.js";
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
  const canUseKeychain = runtimeInfo.platform === "darwin";
  const envKeyName = provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
  const storageNote = runtimeInfo.ephemeralStorage
    ? `<p class="settings-ephemeral-note settings-ephemeral-note-warn" role="status">⚠ 服务端仍是临时目录（/tmp），重新部署或冷启动会丢失定投计划与设置。请先在 Vercel → Storage 创建 Blob，并确认环境变量 <code>BLOB_READ_WRITE_TOKEN</code> 已注入 Production；在此之前请勿把云端当作唯一账本，定期导出备份。</p>`
    : runtimeInfo.durableStorage === "blob"
      ? `<p class="muted settings-ephemeral-note">定投计划与设置已持久化到 Vercel Blob（服务端权威存储）。</p>`
      : "";
  const keyPlaceholder = credential.configured
    ? "已配置；留空表示不修改"
    : canUseKeychain
      ? "输入后保存到 macOS 钥匙串"
      : `请在部署环境设置 ${envKeyName}`;
  const keyHelp = canUseKeychain
    ? "桌面版：密钥写入 macOS 钥匙串，不进 config / 备份。"
    : `云端 / Linux：页面无法安全写入密钥，请在 Vercel/主机环境变量配置 <code>${envKeyName}</code> 后重启；「保存密钥」仅桌面 macOS 可用。`;
  const keyStatus = credential.configured
    ? `密钥已配置（${credential.source === "environment" ? "环境变量" : "macOS 钥匙串"}）`
    : canUseKeychain
      ? "尚未配置密钥"
      : `尚未检测到密钥（可设置环境变量 ${envKeyName}）`;
  els.settingsForm.innerHTML = `
    ${storageNote}
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
        <strong>AI 分析</strong>
        <label class="config-toggle-control">
          <input type="checkbox" data-ai-key="enabled"${ai.enabled ? " checked" : ""} />
          <span>启用</span>
        </label>
      </div>
      <p class="muted settings-ai-help">${keyHelp}</p>
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
        <span class="settings-secret-label">API Key</span>
        <div class="settings-secret-controls">
          <input type="password" data-ai-secret autocomplete="new-password" placeholder="${escapeAttr(keyPlaceholder)}"${canUseKeychain ? "" : " disabled"} />
          <button class="ghost-button compact" data-ai-save-key type="button"${canUseKeychain ? "" : " disabled"} title="${canUseKeychain ? "写入 macOS 钥匙串" : "仅 macOS 桌面版支持"}">保存密钥</button>
          <button class="ghost-button compact" data-ai-test type="button">测试连接</button>
          <button class="ghost-button compact danger" data-ai-delete-key type="button"${canUseKeychain && credential.configured ? "" : " disabled"}>删除密钥</button>
        </div>
      </div>
      <p class="muted settings-ai-status" data-ai-status>${keyStatus}</p>
    </div>
  `;
  const autoRefreshToggle = els.settingsForm.querySelector('[data-quotes-key="auto_refresh_enabled"]');
  const autoRefreshInterval = els.settingsForm.querySelector('[data-quotes-key="refresh_interval_seconds"]');
  autoRefreshToggle?.addEventListener("change", () => {
    if (autoRefreshInterval) autoRefreshInterval.disabled = !autoRefreshToggle.checked;
  });
  els.settingsForm.querySelector("[data-ai-save-key]")?.addEventListener("click", saveAIKey);
  els.settingsForm.querySelector("[data-ai-delete-key]")?.addEventListener("click", deleteAIKey);
  els.settingsForm.querySelector("[data-ai-test]")?.addEventListener("click", testAIConnection);

  els.settingsForm.querySelectorAll("[data-quotes-key], [data-ai-key], [data-ai-model]").forEach((input) => {
    input.addEventListener("change", async () => {
      await saveAppConfig({ quiet: true });
      if (els.settingsStatus) els.settingsStatus.textContent = "设置已自动保存";
      if (input.dataset.aiKey === "provider") renderSettings();
    });
  });
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
  if (runtimeInfo.platform !== "darwin") {
    const provider = els.settingsForm?.querySelector('[data-ai-key="provider"]')?.value || "deepseek";
    const envName = provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
    settingsStatus(`当前环境请设置环境变量 ${envName}，不支持网页写入密钥`);
    return;
  }
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
