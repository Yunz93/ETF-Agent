import test from "node:test";
import assert from "node:assert/strict";

import { settingsPersistenceScore } from "../js/settings.js";

test("settingsPersistenceScore treats defaults as weak", () => {
  assert.equal(
    settingsPersistenceScore({
      quotes: { auto_refresh_enabled: true, refresh_interval_seconds: 300 },
      ai: { enabled: false, provider: "deepseek", models: {} },
    }),
    0,
  );
});

test("settingsPersistenceScore rewards customized AI and refresh prefs", () => {
  const score = settingsPersistenceScore({
    quotes: { auto_refresh_enabled: false, refresh_interval_seconds: 60 },
    ai: {
      enabled: true,
      provider: "openai",
      models: { openai: "gpt-4o-mini", deepseek: "" },
      timeout_seconds: 90,
    },
  });
  assert.ok(score >= 5);
});
