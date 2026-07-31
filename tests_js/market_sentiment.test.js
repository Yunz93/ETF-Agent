import test from "node:test";
import assert from "node:assert/strict";

import { ensureMarketSentiment } from "../js/market-sentiment.js";
import { state } from "../js/state.js";

test("ensureMarketSentiment maps HTML 404 into a friendly Chinese error", async () => {
  state.marketSentiment = null;
  state.marketSentimentError = null;
  state.marketSentimentFetchedAt = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<!DOCTYPE html><html><body>404</body></html>", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  try {
    const payload = await ensureMarketSentiment({ refresh: true });
    assert.equal(payload.degraded, true);
    assert.match(state.marketSentimentError || "", /接口不可用|重启后端/);
    assert.doesNotMatch(state.marketSentimentError || "", /Unexpected token|DOCTYPE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ensureMarketSentiment accepts a valid sentiment payload", async () => {
  state.marketSentiment = null;
  state.marketSentimentError = null;
  state.marketSentimentFetchedAt = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        items: { A: { score: 22, zone: "fear", mult: 1.15, degraded: false } },
        degraded: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const payload = await ensureMarketSentiment({ refresh: true });
    assert.equal(payload.items.A.score, 22);
    assert.equal(state.marketSentimentError, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
