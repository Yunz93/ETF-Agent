/** Read-only US index market judgment. The trade plan remains authoritative. */

let cached = null;
let fetchedAt = 0;
let inFlight = null;

export async function getUSMarketJudgment() {
  if (cached && Date.now() - fetchedAt < 15 * 60 * 1000) return cached;
  if (inFlight) return inFlight;
  inFlight = fetch("/api/market/us-judgment")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      cached = payload;
      fetchedAt = Date.now();
      return payload;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}
