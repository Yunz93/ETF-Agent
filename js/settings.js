import { CONFIG_CACHE_KEY } from "./constants.js";
import { appConfig, els, runtimeInfo, setAppConfig } from "./state.js";
import { autoRefreshSettings, configureAutoRefresh } from "./auto-refresh.js";
import { settingsSnapshot, applySettingsSnapshot } from "./backup.js";
import { escapeAttr, loadJSON, saveJSON } from "./utils.js";
import { registerRenderers } from "./views/render.js";

export function readLocalConfigCache() {
  return loadJSON(CONFIG_CACHE_KEY, null);
}

export function writeLocalConfigCache(config = appConfig) {
  if (!config || typeof config !== "object") return;
  saveJSON(CONFIG_CACHE_KEY, {
    updated_at: new Date().toISOString(),
    settings: settingsSnapshot(config),
  });
}

/** 设置“已填写强度”：用于 ephemeral 宿主上避免默认 config 盖掉浏览器缓存。 */
export function settingsPersistenceScore(settings) {
  if (!settings || typeof settings !== "object") return 0;
  let score = 0;
  const quotes = settings.quotes || {};
  if (quotes.auto_refresh_enabled === false) score += 1;
  const interval = Number(quotes.refresh_interval_seconds);
  if (Number.isFinite(interval) && interval > 0 && interval !== 300) score += 1;
  const ai = settings.ai || {};
  if (ai.enabled === true) score += 2;
  if (ai.provider === "openai") score += 1;
  const models = ai.models || {};
  if (String(models.deepseek || "").trim()) score += 1;
  if (String(models.openai || "").trim()) score += 1;
  if (Number(ai.timeout_seconds) && Number(ai.timeout_seconds) !== 60) score += 1;
  if (Number(ai.max_output_tokens) && Number(ai.max_output_tokens) !== 1800) score += 1;
  return score;
}

async function restoreLocalConfigIfRicher(remoteConfig) {
  if (!runtimeInfo.ephemeralStorage) {
    writeLocalConfigCache(remoteConfig);
    return false;
  }
  const cached = readLocalConfigCache();
  const localSettings = cached?.settings;
  const localScore = settingsPersistenceScore(localSettings);
  const remoteScore = settingsPersistenceScore(settingsSnapshot(remoteConfig));
  if (localScore > remoteScore) {
    try {
      await applySettingsSnapshot(localSettings);
      writeLocalConfigCache(appConfig);
      return true;
    } catch {
      // 服务器写回失败时仍先用本地偏好渲染
      setAppConfig({
        ...(remoteConfig || {}),
        quotes: {
          ...(remoteConfig?.quotes || {}),
          ...(localSettings?.quotes || {}),
        },
        ai: {
          ...(remoteConfig?.ai || {}),
          ...(localSettings?.ai || {}),
          models: {
            ...(remoteConfig?.ai?.models || {}),
            ...(localSettings?.ai?.models || {}),
          },
        },
      });
      writeLocalConfigCache(appConfig);
      return true;
    }
  }
  writeLocalConfigCache(remoteConfig);
  return false;
}

export async function loadAppConfig({ rerender = false } = {}) {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`config API ${response.status}`);
    const remote = await response.json();
    setAppConfig(remote);
    const restored = await restoreLocalConfigIfRicher(remote);
    configureAutoRefresh();
    if (rerender) renderSettings();
    if (els.settingsStatus && rerender) {
      els.settingsStatus.textContent = restored
        ? "已从浏览器缓存恢复设置"
        : "已重新加载 config.json";
    }
  } catch (error) {
    const cached = readLocalConfigCache();
    if (cached?.settings) {
      setAppConfig({
        ...(appConfig || {}),
        quotes: { ...(appConfig?.quotes || {}), ...(cached.settings.quotes || {}) },
        ai: {
          ...(appConfig?.ai || {}),
          ...(cached.settings.ai || {}),
          models: {
            ...(appConfig?.ai?.models || {}),
            ...(cached.settings.ai?.models || {}),
          },
        },
      });
      configureAutoRefresh();
      if (rerender) renderSettings();
      if (els.settingsStatus) els.settingsStatus.textContent = "配置接口不可用，已使用浏览器缓存";
      return;
    }
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
  const ephemeralNote = runtimeInfo.ephemeralStorage
    ? `<p class="muted settings-ephemeral-note">云端存储为临时目录；定投计划与设置以本机浏览器缓存为准，建议定期导出备份。</p>`
    : "";
  els.settingsForm.innerHTML = `
    ${ephemeralNote}
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
          <input type="password" data-ai-secret autocomplete="new-password" placeholder="${credential.configured ? "已配置；留空表示不修改" : "输入后保存到 macOS 钥匙串"}" />
          <button class="ghost-button compact" data-ai-save-key type="button">保存密钥</button>
          <button class="ghost-button compact" data-ai-test type="button">测试连接</button>
          <button class="ghost-button compact danger" data-ai-delete-key type="button"${credential.configured ? "" : " disabled"}>删除密钥</button>
        </div>
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
  // 先落浏览器缓存，避免 serverless 写盘失败或冷启动丢失
  setAppConfig(payload);
  writeLocalConfigCache(payload);
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`config API ${response.status}`);
    setAppConfig(await response.json());
    writeLocalConfigCache(appConfig);
    configureAutoRefresh();
    if (!quiet && els.settingsStatus) els.settingsStatus.textContent = "已保存";
    if (!quiet) renderSettings();
  } catch (error) {
    configureAutoRefresh();
    if (els.settingsStatus) {
      els.settingsStatus.textContent = runtimeInfo.ephemeralStorage
        ? `服务器暂不可写，已保存到浏览器缓存：${error}`
        : `保存失败：${error}`;
    }
  }
}

registerRenderers({ renderSettings });
