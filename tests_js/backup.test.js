import test from "node:test";
import assert from "node:assert/strict";

import { hasSettingsSnapshot, settingsSnapshot } from "../js/backup.js";

test("settings snapshot keeps refresh and AI options without credentials", () => {
  const snapshot = settingsSnapshot({
    quotes: {
      auto_refresh_enabled: false,
      refresh_interval_seconds: 60,
      provider: "tencent",
    },
    ai: {
      enabled: true,
      provider: "openai",
      models: { deepseek: "deepseek-v4-flash", openai: "gpt-test" },
      credentials: { openai: { configured: true, api_key: "secret" } },
      api_key: "secret",
    },
  });
  assert.equal(snapshot.quotes.auto_refresh_enabled, false);
  assert.equal(snapshot.quotes.refresh_interval_seconds, 60);
  assert.equal(snapshot.ai.enabled, true);
  assert.equal(snapshot.ai.provider, "openai");
  assert.equal(snapshot.ai.models.openai, "gpt-test");
  assert.equal(snapshot.ai.credentials, undefined);
  assert.equal(snapshot.ai.api_key, undefined);
});

test("backup payload detection accepts settings section", () => {
  assert.equal(hasSettingsSnapshot({ settings: { quotes: {} } }), true);
  assert.equal(hasSettingsSnapshot({ etfs: [] }), false);
});
