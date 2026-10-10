/**
 * Vouch content script.
 *
 * WHY THIS EXISTS
 * ---------------
 * LinkedIn does not grant third-party API access for reading job posts or
 * messaging — those use cases are structurally declined. So this extension is
 * not a product proposal; it is a *rendering* of one. It puts the Vouch
 * surfaces in their real position on real pages so a reviewer can see exactly
 * what the feature would look like in situ, rather than inferring it from a
 * mock.
 *
 * The DOM selectors below are intentionally defensive and layered, because
 * LinkedIn's markup is generated and changes often. In the native
 * implementation none of this scraping exists — the data arrives from the
 * services that already own it. Any brittleness here is a property of the
 * demo, not of the design.
 */

const VOUCH = {
  studentId: 'stu_neil',
  // Which seeded requisition to score a live job page against. The demo maps
  // any real job page onto this req so the panel has something real to show.
  demoJobId: 'job_nw_storage',
  mounted: new WeakSet(),
  selectorConfig: null, // fetched once at boot; see loadSelectorConfig()
};

const send = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r ?? { ok: false, error: 'no response' })));

/**
 * IMPLEMENTATION.md Track A.3 — selector resolution.
 *
 * Selectors are remote, versioned config (server/selectors.json), fetched via
 * the background worker and cached there for an hour. Resolution here tries
 * each candidate in priority order and reports a miss to telemetry instead of
 * failing silently into a confusing "nothing happened" state for the person
 * debugging it later. Falls back to a small bundled list if the config never
 * loaded (offline first run, API down) — the extension must never go inert
 * just because the config endpoint is unreachable.
 */
const BUNDLED_FALLBACK = {
  targets: {
    jobAnchor: [
      { value: '.jobs-unified-top-card' },
      { value: '.job-details-jobs-unified-top-card__container--two-pane' },
      { value: '.jobs-details__main-content .jobs-box' },
      { value: '.job-view-layout' },
      { value: 'main' },
    ],
    messageThread: [
      { value: '.msg-s-message-list-content' },
      { value: '.msg-s-message-list' },
      { value: '.msg-conversation-card__content--selectable' },
      { value: '.scaffold-layout__detail' },
    ],
    messageBubble: [
      { value: '.msg-s-event-listitem__body' },
      { value: '.msg-s-event__content' },
      { value: '.msg-s-event-listitem' },
    ],
  },
};

async function loadSelectorConfig() {
  const res = await send({ type: 'getSelectorConfig' });
  VOUCH.selectorConfig = res.ok && res.data ? res.data : BUNDLED_FALLBACK;
}

function resolveTarget(name) {
  const candidates = VOUCH.selectorConfig?.targets?.[name] ?? BUNDLED_FALLBACK.targets[name] ?? [];
  const tried = [];
  for (const c of candidates) {
    tried.push(c.value);
    try {
      const node = document.querySelector(c.value);
      if (node) return { element: node, candidatesTried: tried };
    } catch { /* a malformed pushed selector must never throw */ }
  }
  // Report the miss so a real drift is visible in telemetry before anyone
  // has to notice the panel silently isn't there — see server/index.js
  // POST /api/telemetry/selector-miss.
  send({
    type: 'reportSelectorMiss',
    payload: { target: name, pageType: location.pathname, extensionVersion: chrome.runtime.getManifest().version, candidatesTried: tried },
  });
  return { element: null, candidatesTried: tried };
}

const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const bandClass = (band) => `vouch-${band}`;

// ---------------------------------------------------------------------------
// Job pages — the referral bridge
// ---------------------------------------------------------------------------

async function mountJobPanel() {
  if (!/\/jobs\//.test(location.pathname)) return;
  const { element: anchor } = resolveTarget('jobAnchor');
  if (!anchor || VOUCH.mounted.has(anchor)) return;
  if (document.querySelector('.vouch-job-panel')) return;

  VOUCH.mounted.add(anchor);

  const panel = el('div', 'vouch-card vouch-job-panel');
  panel.innerHTML = `
    <div class="vouch-head">
      <span class="vouch-mark">V</span>
      <strong>Vouch</strong>
      <span class="vouch-sub">Referral bridge</span>
      <span class="vouch-spacer"></span>
      <span class="vouch-pill vouch-loading">Analysing…</span>
    </div>
    <div class="vouch-body">Finding verified warm paths to this requisition…</div>`;
  anchor.prepend(panel);

  const res = await send({ type: 'referralPlan', studentId: VOUCH.studentId, jobId: VOUCH.demoJobId });
  if (!res.ok) {
    panel.querySelector('.vouch-body').innerHTML =
      `<div class="vouch-alert vouch-amber">Vouch API unreachable (${esc(res.error)}). Start it with <code>npm run dev</code>.</div>`;
    panel.querySelector('.vouch-loading').textContent = 'Offline';
    return;
  }

  renderJobPanel(panel, res.data);
}

function renderJobPanel(panel, plan) {
  const { fit, referrers, baseline, job, passport } = plan;
  const usable = referrers.filter((r) => r.available);

  panel.querySelector('.vouch-head .vouch-pill').outerHTML =
    `<span class="vouch-pill ${bandClass(job.liveness.band)}">${esc(job.liveness.label)} · ${job.liveness.score}</span>`;

  panel.querySelector('.vouch-body').innerHTML = `
    <div class="vouch-split">
      <div class="vouch-now">
        <div class="vouch-eyebrow">Today</div>
        <div class="vouch-big vouch-grey">${baseline.buttonAvailable ? baseline.reachableToday.length : 0}</div>
        <div class="vouch-note">${esc(baseline.note)}</div>
      </div>
      <div class="vouch-then">
        <div class="vouch-eyebrow">With Vouch</div>
        <div class="vouch-big vouch-blue">${baseline.reachableWithVouch}</div>
        <div class="vouch-note">verified warm paths, ranked by closeness to this requisition</div>
      </div>
    </div>

    <div class="vouch-row vouch-fitrow">
      <div class="vouch-score ${bandClass(fit.band)}">${fit.score}</div>
      <div>
        <strong>Your fit for this role: ${esc(fit.band)}</strong>
        <div class="vouch-note">
          ${fit.gaps.length === 0
            ? 'Every required skill is claimed and backed by a verified artifact.'
            : esc(fit.gaps[0].message)}
        </div>
      </div>
    </div>

    <div class="vouch-eyebrow vouch-mt">Proof attached automatically</div>
    <div class="vouch-chips">
      ${passport.map((a) => `<span class="vouch-chip">${esc(a.title)}${a.verified ? ' ✓' : ''}</span>`).join('')}
    </div>

    <div class="vouch-eyebrow vouch-mt">Who to ask · ${usable.length} available</div>
    <div class="vouch-people">
      ${usable
        .slice(0, 3)
        .map(
          (r) => `
        <div class="vouch-person">
          <div class="vouch-avatar">${esc((r.name.match(/\b\w/g) || []).slice(0, 2).join(''))}</div>
          <div class="vouch-person-main">
            <div class="vouch-person-name">
              ${esc(r.name)}
              ${r.onHiringTeam ? '<span class="vouch-pill vouch-blue-pill">On this req</span>' : ''}
              ${r.officeHoursOpen ? '<span class="vouch-pill vouch-green-pill">Office hours</span>' : ''}
            </div>
            <div class="vouch-note">${esc(r.title)} · ${esc(r.team ?? '')}</div>
            ${r.warmPath ? `<div class="vouch-path">${esc(r.warmPath.headline)}</div>` : ''}
            <div class="vouch-note">${r.capacityRemaining} slot${r.capacityRemaining === 1 ? '' : 's'} left</div>
          </div>
          <div class="vouch-mini ${r.score >= 65 ? 'vouch-clear' : ''}">${r.score}</div>
        </div>`,
        )
        .join('')}
    </div>
    <div class="vouch-foot">
      Rendered by the Vouch prototype engine. In production these panels are native surfaces fed by
      LinkedIn's own Jobs, Profile and Identity services.
    </div>`;
}

// ---------------------------------------------------------------------------
// Messaging — Shield
// ---------------------------------------------------------------------------

/**
 * The bubble selector uses querySelectorAll — a thread has many bubbles —
 * so it resolves directly against the live config rather than through
 * resolveTarget(), which is built for single-anchor lookups. A miss here
 * degrades to an empty thread read, which mountShield() already treats as
 * "nothing to score" rather than an error.
 */
function readThreadText() {
  const candidates = VOUCH.selectorConfig?.targets?.messageBubble ?? BUNDLED_FALLBACK.targets.messageBubble;
  for (const c of candidates) {
    let nodes;
    try {
      nodes = [...document.querySelectorAll(c.value)];
    } catch {
      continue;
    }
    if (nodes.length) {
      return nodes.map((n) => n.innerText.trim()).filter(Boolean).join('\n\n').slice(0, 6000);
    }
  }
  return '';
}

let lastAssessed = '';

async function mountShield() {
  if (!/\/messaging\//.test(location.pathname)) return;
  const { element: anchor } = resolveTarget('messageThread');
  if (!anchor) return;

  const text = readThreadText();
  if (!text || text === lastAssessed) return;
  lastAssessed = text;

  document.querySelector('.vouch-shield')?.remove();

  const panel = el('div', 'vouch-card vouch-shield');
  panel.innerHTML = `
    <div class="vouch-head">
      <span class="vouch-mark">V</span><strong>Vouch Shield</strong>
      <span class="vouch-spacer"></span>
      <span class="vouch-pill vouch-loading">Scanning…</span>
    </div>
    <div class="vouch-body">Checking this conversation against hiring-fraud patterns…</div>`;
  anchor.prepend(panel);

  // The live page gives us no verified sender metadata (that is exactly the
  // signal the native version would have), so we tell the engine what we do
  // not know rather than inventing values that would flatter the score.
  const res = await send({
    type: 'assess',
    body: text,
    sender: {}, // unknown, not "unverified" — the engine scores the two differently
  });

  if (!res.ok) {
    panel.querySelector('.vouch-body').innerHTML =
      `<div class="vouch-alert vouch-amber">Vouch API unreachable (${esc(res.error)}).</div>`;
    panel.querySelector('.vouch-loading').textContent = 'Offline';
    return;
  }

  renderShield(panel, res.data);
}

function renderShield(panel, a) {
  const toneClass = { high: 'vouch-red', caution: 'vouch-amber', low: 'vouch-blue', clear: 'vouch-green' }[a.band];

  panel.querySelector('.vouch-head .vouch-pill').outerHTML =
    `<span class="vouch-pill ${bandClass(a.band)}">Risk ${a.risk} · ${esc(a.band)}</span>`;

  const signals = a.signals.content
    .map(
      (s) => `
      <li>
        <strong>${esc(s.label)}</strong>${s.hard ? ' <span class="vouch-pill vouch-red-pill">hard rule</span>' : ''}
        <div class="vouch-note">${esc(s.explain)}</div>
        <code class="vouch-excerpt">${esc(s.excerpt)}</code>
      </li>`,
    )
    .join('');

  const domains = a.signals.domains
    .map((d) => `<li><code>${esc(d.domain)}</code> — ${esc(d.note ?? d.verdict)}</li>`)
    .join('');

  panel.querySelector('.vouch-body').innerHTML = `
    <div class="vouch-alert ${toneClass}">
      <strong>${esc(a.verdict)}</strong>
      ${a.action.guidance ? `<div class="vouch-note">${esc(a.action.guidance)}</div>` : ''}
    </div>
    ${signals ? `<div class="vouch-eyebrow vouch-mt">What triggered this</div><ul class="vouch-list">${signals}</ul>` : ''}
    ${domains ? `<div class="vouch-eyebrow vouch-mt">Domains in this thread</div><ul class="vouch-list">${domains}</ul>` : ''}
    ${
      a.action.level === 'block_send' || a.action.level === 'interstitial'
        ? `<div class="vouch-actions">
             <button class="vouch-btn vouch-btn-danger">${esc(a.action.primary)}</button>
             <button class="vouch-btn vouch-btn-quiet">${esc(a.action.secondary)}</button>
           </div>`
        : ''
    }
    <div class="vouch-foot">
      Scored locally by the Vouch engine. Sender identity and workplace verification are unavailable to an
      extension — the native version has both, which makes it strictly more accurate than what you see here.
    </div>`;

  panel.querySelector('.vouch-btn-danger')?.addEventListener('click', (e) => {
    e.target.textContent = 'Reported ✓';
    e.target.disabled = true;
  });
  panel.querySelector('.vouch-btn-quiet')?.addEventListener('click', () => panel.remove());
}

// ---------------------------------------------------------------------------
// Boot — LinkedIn is a SPA, so watch for navigation and re-render
// ---------------------------------------------------------------------------

function tick() {
  mountJobPanel().catch(() => {});
  mountShield().catch(() => {});
}

let lastPath = location.pathname;
const observer = new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    lastAssessed = '';
    document.querySelectorAll('.vouch-card').forEach((n) => n.remove());
  }
  tick();
});

observer.observe(document.body, { childList: true, subtree: true });
setInterval(tick, 2500);

// Config must be in hand before the first resolution attempt, or every
// early tick reports false selector misses while the fetch is in flight.
loadSelectorConfig().then(tick);
