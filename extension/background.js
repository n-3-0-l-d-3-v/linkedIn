/**
 * Service worker.
 *
 * All network calls are proxied through here rather than made from the content
 * script. Two reasons: LinkedIn's page CSP would block a direct fetch to
 * localhost, and keeping the API surface in one place means the content script
 * never needs host permissions of its own.
 */

const DEFAULT_API = 'http://localhost:4180';
const SELECTOR_CACHE_KEY = 'vouch_selector_config';
const SELECTOR_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — see extension/selectors.js and IMPLEMENTATION.md Track A

async function apiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return apiBase || DEFAULT_API;
}

/**
 * Selector config, fetched and cached here (not in the content script) so it
 * survives without any host-page CSP concerns and is shared across every tab.
 * On any failure — network down, bad JSON, API offline — resolves to `null`
 * and the content script falls back to its own bundled selector list, per
 * the fail-open principle applied throughout this project.
 */
async function selectorConfig() {
  const { [SELECTOR_CACHE_KEY]: cached } = await chrome.storage.local.get(SELECTOR_CACHE_KEY);
  if (cached && Date.now() - cached.fetchedAt < SELECTOR_CACHE_TTL_MS) return cached.config;

  try {
    const config = await call('/api/config/selectors');
    await chrome.storage.local.set({ [SELECTOR_CACHE_KEY]: { config, fetchedAt: Date.now() } });
    return config;
  } catch {
    return cached?.config ?? null; // serve stale config over none, if we have it
  }
}

async function call(path, options) {
  const base = await apiBase();
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.error ?? 'request failed');
  return payload.data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'ping':
          sendResponse({ ok: true, data: await call('/api/health') });
          break;

        case 'assess':
          sendResponse({
            ok: true,
            data: await call('/api/shield/assess', {
              method: 'POST',
              body: JSON.stringify({ body: msg.body, sender: msg.sender, hiringToken: msg.hiringToken }),
            }),
          });
          break;

        case 'referralPlan':
          sendResponse({
            ok: true,
            data: await call(`/api/referral-plan?studentId=${msg.studentId}&jobId=${msg.jobId}`),
          });
          break;

        case 'jobs':
          sendResponse({ ok: true, data: await call('/api/jobs') });
          break;

        case 'getSelectorConfig':
          sendResponse({ ok: true, data: await selectorConfig() });
          break;

        case 'reportSelectorMiss':
          // Fire-and-forget in spirit, but still awaited so failures don't
          // throw unhandled — telemetry must never be able to break the page.
          try {
            await call('/api/telemetry/selector-miss', { method: 'POST', body: JSON.stringify(msg.payload) });
          } catch { /* telemetry is best-effort */ }
          sendResponse({ ok: true, data: { recorded: true } });
          break;

        default:
          sendResponse({ ok: false, error: `unknown message: ${msg.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  // Keep the message channel open for the async response above.
  return true;
});
