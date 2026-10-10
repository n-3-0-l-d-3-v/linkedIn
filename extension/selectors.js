/**
 * SelectorResolver — IMPLEMENTATION.md Track A.3.
 *
 * The reliability problem with any LinkedIn extension: a hardcoded selector
 * breaks the day LinkedIn ships a redesign, and fixing it then costs a new
 * Chrome Web Store review cycle — days, not minutes. This resolver treats
 * selectors as remote, versioned config instead of code, so recovery is a
 * config push with a ~1h propagation delay, not a release.
 *
 * A target is a named list of candidates tried in priority order:
 *   "attr"      data-view-name / aria hooks — LinkedIn's own automated tests
 *               depend on these, so they are the least likely to churn.
 *   "css"       plain selectors — legacy class names, tried last because
 *               they are the most likely to be renamed on a redesign.
 * First live match wins. A miss is never thrown — it is reported and the
 * caller decides what "nothing rendered" means for that surface.
 */

const CACHE_KEY = 'vouch_selector_config';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — long enough to avoid hammering the
                                     // config endpoint, short enough that a
                                     // pushed fix reaches installed extensions
                                     // within the hour, not the next release.

/** Bundled fallback — identical to the current hardcoded lists. Used only if
 * the remote config has never been fetched successfully (e.g. first run
 * offline). Kept intentionally in sync with server/selectors.json by hand;
 * drift between them only matters until the first successful fetch. */
const BUNDLED_DEFAULT = {
  version: 0,
  targets: {
    jobAnchor: [
      { strategy: 'css', value: '.jobs-unified-top-card' },
      { strategy: 'css', value: '.job-details-jobs-unified-top-card__container--two-pane' },
      { strategy: 'css', value: '.jobs-details__main-content .jobs-box' },
      { strategy: 'css', value: '.job-view-layout' },
      { strategy: 'css', value: 'main' },
    ],
    messageThread: [
      { strategy: 'css', value: '.msg-s-message-list-content' },
      { strategy: 'css', value: '.msg-s-message-list' },
      { strategy: 'css', value: '.msg-conversation-card__content--selectable' },
      { strategy: 'css', value: '.scaffold-layout__detail' },
    ],
    messageBubble: [
      { strategy: 'css', value: '.msg-s-event-listitem__body' },
      { strategy: 'css', value: '.msg-s-event__content' },
      { strategy: 'css', value: '.msg-s-event-listitem' },
    ],
  },
};

function matchOne(candidate) {
  // "attr" and "css" both resolve through querySelector — data-view-name and
  // aria hooks are just attribute selectors — but kept as separate strategy
  // names so config authors and telemetry both read intent, not mechanism.
  try {
    return document.querySelector(candidate.value);
  } catch {
    return null; // a malformed selector in pushed config must never throw
  }
}

export class SelectorResolver {
  constructor(config = BUNDLED_DEFAULT) {
    this.config = config;
  }

  static async load(apiBase, fetchFn) {
    const cached = await readCache();
    if (cached) return new SelectorResolver(cached);

    try {
      const res = await fetchFn(`${apiBase}/api/config/selectors`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error ?? 'bad payload');
      await writeCache(payload.data);
      return new SelectorResolver(payload.data);
    } catch {
      // Network down, API unreachable, first run offline — the bundled
      // default keeps the extension functional rather than inert.
      return new SelectorResolver(BUNDLED_DEFAULT);
    }
  }

  /** Resolve a named target against the live DOM. Returns {element, candidatesTried}. */
  resolve(targetName) {
    const candidates = this.config.targets?.[targetName] ?? [];
    const tried = [];
    for (const candidate of candidates) {
      tried.push(candidate.value);
      const el = matchOne(candidate);
      if (el) return { element: el, matched: candidate.value, candidatesTried: tried };
    }
    return { element: null, matched: null, candidatesTried: tried };
  }
}

async function readCache() {
  try {
    const { [CACHE_KEY]: entry } = await chrome.storage.local.get(CACHE_KEY);
    if (!entry || Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry.config;
  } catch {
    return null; // storage unavailable (rare) — fall through to a live fetch
  }
}

async function writeCache(config) {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: { config, fetchedAt: Date.now() } });
  } catch {
    /* non-fatal — resolution still works, just re-fetches next time */
  }
}
