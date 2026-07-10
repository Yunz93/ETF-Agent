import { AI_PROVIDER_PRESETS, DEFAULT_SOURCES } from "./constants.js";
import { appConfig, els, provider, setAppConfig } from "./state.js";
import { escapeAttr, escapeHtml } from "./utils.js";
import { refreshStocks, renderSourceStatus } from "./views/render.js";

export async function loadAppConfig({ rerender = true } = {}) {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`Config API ${response.status}`);
    setAppConfig(await response.json());
  } catch (error) {
    console.warn("配置加载失败，使用内置默认值。", error);
    setAppConfig({
      quotes: {
        provider_name: "腾讯行情",
        note: DEFAULT_SOURCES.QUOTE[0].role,
        batch_size: 80,
      },
      sec: { enabled: true, user_agent: "StockAgent/0.1 personal-local contact@example.com" },
      ai: {
        enabled: true,
        provider: "deepseek",
        provider_name: "DeepSeek",
        base_url: "https://api.deepseek.com",
        model: "deepseek-chat",
        api_key: "",
        has_api_key: false,
        temperature: 0.3,
        max_tokens: 2800,
        timeout_seconds: 90,
        note: "支持 DeepSeek / OpenAI / Moonshot / 通义 / 智谱 / SiliconFlow / OpenRouter / Groq / Ollama 等 Token 服务；API Key 仅保存在本地 config.json",
      },
      sources: structuredClone(DEFAULT_SOURCES),
    });
  }
  if (rerender) {
    renderSettings();
    renderSourceStatus();
  }
}

export function marketSources(market) {
  return appConfig?.sources?.[market] || DEFAULT_SOURCES[market] || [];
}

export function quoteSourceMeta() {
  const quote = appConfig?.sources?.QUOTE?.[0] || DEFAULT_SOURCES.QUOTE[0];
  const quotes = appConfig?.quotes || {};
  return {
    name: quotes.provider_name || quote.name,
    url: quote.url,
    role: quotes.note || quote.role,
  };
}
export function renderSettings() {
  if (!els.settingsForm || !appConfig) return;

  const groups = [
    { key: "QUOTE", label: "行情" },
    { key: "A", label: "A 股公告" },
    { key: "HK", label: "港股公告" },
    { key: "US", label: "美股财报" },
  ];

  const ai = appConfig.ai || {};
  const aiProvider = ai.provider || "deepseek";
  const preset = AI_PROVIDER_PRESETS[aiProvider] || AI_PROVIDER_PRESETS.custom;
  const modelOptions = uniqueStrings([...(preset.models || []), ai.model].filter(Boolean));
  els.settingsForm.innerHTML = `
    <section class="config-group ai-console">
      <div class="ai-console-heading">
        <div>
          <h3>模型 API 接口配置</h3>
          <p class="muted settings-hint">支持 DeepSeek 等主流 Token 服务（OpenAI 兼容）。密钥仅保存在本地 config.json，页面只显示掩码。</p>
        </div>
        <div class="ai-console-actions">
          <button class="ghost-button compact js-ai-test" type="button">测试连接</button>
          ${preset.docs_url ? `<a class="ghost-button compact" href="${escapeAttr(preset.docs_url)}" target="_blank" rel="noreferrer">获取 Key</a>` : ""}
        </div>
      </div>
      <div class="ai-provider-grid" role="radiogroup" aria-label="Token 服务">
        ${Object.entries(AI_PROVIDER_PRESETS)
          .map(
            ([id, item]) => `
              <button type="button" class="ai-provider-chip ${aiProvider === id ? "active" : ""}" data-ai-provider="${id}">
                <strong>${escapeHtml(item.provider_name)}</strong>
                <span>${escapeHtml(item.note || "")}</span>
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="config-grid">
        <label class="config-check">
          <input data-config="ai.enabled" type="checkbox" ${ai.enabled !== false ? "checked" : ""} />
          <span>启用 AI 分析</span>
        </label>
        <label>
          <span>提供方</span>
          <select data-config="ai.provider" class="js-ai-provider">
            ${Object.entries(AI_PROVIDER_PRESETS)
              .map(
                ([id, item]) =>
                  `<option value="${id}" ${aiProvider === id ? "selected" : ""}>${escapeHtml(item.provider_name)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          <span>显示名称</span>
          <input data-config="ai.provider_name" type="text" value="${escapeAttr(ai.provider_name || preset.provider_name || "")}" />
        </label>
        <label class="config-wide">
          <span>API Base URL</span>
          <input data-config="ai.base_url" type="url" value="${escapeAttr(ai.base_url || "")}" placeholder="${escapeAttr(preset.base_url || "https://api.deepseek.com")}" />
        </label>
        <label>
          <span>模型</span>
          <input data-config="ai.model" class="js-ai-model" list="ai-model-options" type="text" value="${escapeAttr(ai.model || "")}" placeholder="${escapeAttr(preset.model || "deepseek-chat")}" />
          <datalist id="ai-model-options">
            ${modelOptions.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("")}
          </datalist>
        </label>
        <label>
          <span>API Key / Token ${ai.has_api_key ? "（已配置）" : preset.needs_api_key === false ? "（可选）" : ""}</span>
          <input data-config="ai.api_key" type="password" value="${escapeAttr(ai.api_key || "")}" placeholder="${ai.has_api_key ? "留空则保持已保存密钥" : "sk-..."}" autocomplete="off" />
        </label>
        <label>
          <span>温度</span>
          <input data-config="ai.temperature" type="number" min="0" max="2" step="0.1" value="${escapeAttr(ai.temperature ?? 0.3)}" />
        </label>
        <label>
          <span>最大 tokens</span>
          <input data-config="ai.max_tokens" type="number" min="256" max="8192" step="1" value="${escapeAttr(ai.max_tokens ?? 2800)}" />
        </label>
        <label>
          <span>超时（秒）</span>
          <input data-config="ai.timeout_seconds" type="number" min="15" max="180" step="1" value="${escapeAttr(ai.timeout_seconds ?? 90)}" />
        </label>
        <p class="muted ai-endpoint-hint js-ai-endpoint-hint config-wide"></p>
      </div>
      <p class="settings-status muted js-ai-test-status" role="status"></p>
    </section>
    <section class="config-group">
      <h3>行情接口</h3>
      <div class="config-grid">
        <label>
          <span>提供方名称</span>
          <input data-config="quotes.provider_name" type="text" value="${escapeAttr(appConfig.quotes?.provider_name || "")}" />
        </label>
        <label>
          <span>说明</span>
          <input data-config="quotes.note" type="text" value="${escapeAttr(appConfig.quotes?.note || "")}" />
        </label>
        <label>
          <span>批量大小</span>
          <input data-config="quotes.batch_size" type="number" min="5" max="120" value="${escapeAttr(appConfig.quotes?.batch_size ?? 80)}" />
        </label>
      </div>
    </section>
    <section class="config-group">
      <h3>SEC 财报</h3>
      <div class="config-grid">
        <label class="config-check">
          <input data-config="sec.enabled" type="checkbox" ${appConfig.sec?.enabled !== false ? "checked" : ""} />
          <span>启用 SEC EDGAR 数据</span>
        </label>
        <label class="config-wide">
          <span>User-Agent</span>
          <input data-config="sec.user_agent" type="text" value="${escapeAttr(appConfig.sec?.user_agent || "")}" />
        </label>
      </div>
    </section>
    ${groups
      .map(
        ({ key, label }) => `
          <section class="config-group">
            <h3>${label}</h3>
            ${(appConfig.sources?.[key] || [])
              .map(
                (source, index) => `
                  <div class="source-editor" data-source-group="${key}" data-source-index="${index}">
                    <label>
                      <span>名称</span>
                      <input data-field="name" type="text" value="${escapeAttr(source.name)}" />
                    </label>
                    <label>
                      <span>链接</span>
                      <input data-field="url" type="url" value="${escapeAttr(source.url)}" />
                    </label>
                    <label class="config-wide">
                      <span>用途</span>
                      <input data-field="role" type="text" value="${escapeAttr(source.role)}" />
                    </label>
                  </div>
                `,
              )
              .join("")}
          </section>
        `,
      )
      .join("")}
  `;

  bindAiConsoleControls();
}

export function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function chatCompletionsEndpoint(baseUrl, provider) {
  const root = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!root) return "";
  if (root.endsWith("/chat/completions")) return root;
  if (provider === "zhipu") return `${root}/v4/chat/completions`;
  if (root.endsWith("/v1")) return `${root}/chat/completions`;
  return `${root}/v1/chat/completions`;
}

export function bindAiConsoleControls() {
  if (!els.settingsForm) return;
  const providerSelect = els.settingsForm.querySelector(".js-ai-provider");
  const baseUrlInput = els.settingsForm.querySelector('[data-config="ai.base_url"]');
  const modelInput = els.settingsForm.querySelector(".js-ai-model");
  const nameInput = els.settingsForm.querySelector('[data-config="ai.provider_name"]');
  const modelList = els.settingsForm.querySelector("#ai-model-options");
  const hint = els.settingsForm.querySelector(".js-ai-endpoint-hint");
  const testStatus = els.settingsForm.querySelector(".js-ai-test-status");
  const docsLink = els.settingsForm.querySelector(".ai-console-actions a");

  const applyProvider = (providerId, { fillFields = true } = {}) => {
    const preset = AI_PROVIDER_PRESETS[providerId] || AI_PROVIDER_PRESETS.custom;
    if (providerSelect) providerSelect.value = providerId;
    els.settingsForm.querySelectorAll("[data-ai-provider]").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.aiProvider === providerId);
    });
    if (fillFields) {
      if (nameInput) nameInput.value = preset.provider_name || "";
      if (baseUrlInput && preset.base_url) baseUrlInput.value = preset.base_url;
      if (modelInput && preset.model) modelInput.value = preset.model;
    }
    if (modelList) {
      const models = uniqueStrings([...(preset.models || []), modelInput?.value].filter(Boolean));
      modelList.innerHTML = models.map((model) => `<option value="${escapeAttr(model)}"></option>`).join("");
    }
    if (docsLink) {
      if (preset.docs_url) {
        docsLink.hidden = false;
        docsLink.href = preset.docs_url;
      } else {
        docsLink.hidden = true;
      }
    }
    updateEndpointHint();
  };

  const updateEndpointHint = () => {
    if (!hint) return;
    const provider = providerSelect?.value || "deepseek";
    const endpoint = chatCompletionsEndpoint(baseUrlInput?.value || "", provider);
    const preset = AI_PROVIDER_PRESETS[provider] || AI_PROVIDER_PRESETS.custom;
    hint.textContent = endpoint
      ? `实际请求：POST ${endpoint}${preset.needs_api_key === false ? " · API Key 可选" : ""}`
      : "请填写 API Base URL（例如 https://api.deepseek.com）";
  };

  providerSelect?.addEventListener("change", () => applyProvider(providerSelect.value, { fillFields: true }));
  baseUrlInput?.addEventListener("input", updateEndpointHint);
  els.settingsForm.querySelectorAll("[data-ai-provider]").forEach((chip) => {
    chip.addEventListener("click", () => applyProvider(chip.dataset.aiProvider, { fillFields: true }));
  });
  els.settingsForm.querySelector(".js-ai-test")?.addEventListener("click", () => testAiConnection(testStatus));
  applyProvider(providerSelect?.value || "deepseek", { fillFields: false });
}

export async function testAiConnection(statusEl) {
  if (!els.settingsForm) return;
  const payload = readSettingsForm().ai || {};
  if (statusEl) statusEl.textContent = "正在测试模型接口…";
  try {
    const response = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `测试失败 ${response.status}`);
    }
    if (statusEl) {
      statusEl.textContent = `${data.message || "连接成功"} · ${data.provider_name || data.provider || ""} / ${data.model || ""}`;
    }
    if (els.settingsStatus) {
      els.settingsStatus.textContent = "模型接口测试通过（记得保存配置）";
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || "测试失败";
    if (els.settingsStatus) els.settingsStatus.textContent = error.message || "测试失败";
  }
}

export function readSettingsForm() {
  const nextConfig = structuredClone(appConfig);
  els.settingsForm.querySelectorAll("[data-config]").forEach((input) => {
    const path = input.dataset.config.split(".");
    let target = nextConfig;
    for (let index = 0; index < path.length - 1; index += 1) {
      target[path[index]] = target[path[index]] || {};
      target = target[path[index]];
    }
    const key = path[path.length - 1];
    if (input.type === "checkbox") {
      target[key] = input.checked;
    } else if (input.type === "number") {
      target[key] = Number(input.value);
    } else {
      target[key] = input.value.trim();
    }
  });

  els.settingsForm.querySelectorAll(".source-editor").forEach((block) => {
    const group = block.dataset.sourceGroup;
    const index = Number(block.dataset.sourceIndex);
    nextConfig.sources[group] = nextConfig.sources[group] || [];
    nextConfig.sources[group][index] = {
      name: block.querySelector('[data-field="name"]').value.trim(),
      url: block.querySelector('[data-field="url"]').value.trim(),
      role: block.querySelector('[data-field="role"]').value.trim(),
    };
  });

  return nextConfig;
}

export async function saveAppConfig() {
  if (!els.settingsForm) return;
  const payload = readSettingsForm();
  els.settingsStatus.textContent = "保存中…";
  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || `保存失败 ${response.status}`);
    setAppConfig(saved);
    provider.invalidateAll();
    await refreshStocks({ resetQuotes: true });
    renderSettings();
    els.settingsStatus.textContent = "已保存到 config.json";
  } catch (error) {
    els.settingsStatus.textContent = error.message;
  }
}
