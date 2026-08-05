import { appConfig, setAppConfig } from "./state.js";

/** 可导出的设置快照：不含 API Key / credentials。 */
export function settingsSnapshot(config = appConfig) {
  const quotes = config?.quotes || {};
  const ai = config?.ai || {};
  const models = ai.models && typeof ai.models === "object" ? ai.models : {};
  return {
    quotes: {
      auto_refresh_enabled: quotes.auto_refresh_enabled !== false,
      refresh_interval_seconds: Math.max(
        30,
        Number.parseInt(quotes.refresh_interval_seconds, 10) || 300,
      ),
    },
    ai: {
      enabled: ai.enabled === true,
      provider: ai.provider === "openai" ? "openai" : "deepseek",
      models: {
        deepseek: String(models.deepseek || "").trim().slice(0, 80),
        openai: String(models.openai || "").trim().slice(0, 80),
      },
      timeout_seconds: Number(ai.timeout_seconds) || 60,
      max_output_tokens: Number(ai.max_output_tokens) || 1800,
      cache_minutes: Number(ai.cache_minutes) || 30,
      max_increase_multiplier: Number(ai.max_increase_multiplier) || 1.5,
    },
  };
}

export function hasSettingsSnapshot(payload) {
  return Boolean(payload && typeof payload === "object" && payload.settings && typeof payload.settings === "object");
}

/** 将备份中的设置写回服务器配置（忽略密钥字段）。 */
export async function applySettingsSnapshot(settings) {
  if (!settings || typeof settings !== "object") return null;
  const snapshot = settingsSnapshot({
    quotes: settings.quotes,
    ai: settings.ai,
  });
  const base = appConfig && typeof appConfig === "object" ? appConfig : {};
  const payload = {
    ...base,
    quotes: {
      ...(base.quotes || {}),
      ...snapshot.quotes,
    },
    ai: {
      ...(base.ai || {}),
      ...snapshot.ai,
      models: {
        ...(base.ai?.models || {}),
        ...snapshot.ai.models,
      },
    },
  };
  delete payload.ai.credentials;
  delete payload.ai.api_key;
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`config API ${response.status}`);
  const saved = await response.json();
  setAppConfig(saved);
  return saved;
}
