import test from "node:test";
import assert from "node:assert/strict";

import {
  autoRefreshSettings,
  DEFAULT_AUTO_REFRESH_SECONDS,
} from "../js/auto-refresh.js";

test("auto refresh defaults to enabled every five minutes", () => {
  assert.deepEqual(autoRefreshSettings({}), {
    enabled: true,
    seconds: DEFAULT_AUTO_REFRESH_SECONDS,
  });
});

test("auto refresh accepts a configured interval", () => {
  assert.deepEqual(
    autoRefreshSettings({
      quotes: { auto_refresh_enabled: false, refresh_interval_seconds: 60 },
    }),
    { enabled: false, seconds: 60 },
  );
});

test("auto refresh rejects intervals below thirty seconds", () => {
  assert.equal(
    autoRefreshSettings({ quotes: { refresh_interval_seconds: 5 } }).seconds,
    DEFAULT_AUTO_REFRESH_SECONDS,
  );
});
