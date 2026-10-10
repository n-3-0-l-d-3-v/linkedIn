# Vouch — Implementation Plan

**The actual build pipeline: two tracks, both real.**
Companion to [PROPOSAL.md](PROPOSAL.md) (why), [ENGINEERING.md](ENGINEERING.md) (system design and stack), [ARCHITECTURE.md](ARCHITECTURE.md) (prototype internals).

---

## 0. Why two tracks, stated up front

"Directly attachable to LinkedIn's interface and works perfectly" has two honest answers, and pretending they're one answer is how proposals lose credibility in review.

| | **Track A — Attach now** | **Track B — Build in** |
|---|---|---|
| What it is | A hardened browser extension, shippable today, rendering Vouch on real linkedin.com pages | The native implementation, running inside LinkedIn's own services |
| Who runs it | Anyone who installs it — no LinkedIn cooperation needed | LinkedIn engineering, post-approval |
| Data access | Only what's already rendered to the logged-in user's own screen | Full access to Profile, Jobs, Messaging, Identity |
| Reliability ceiling | Bounded by DOM scraping — good, not perfect | Perfect — it's not scraping, it's the real data path |
| Purpose | **Proof.** Lets your uncle click through the real thing on real LinkedIn today | **Production.** What actually gets built if this gets a green light |

Track A is not a toy and it's not a compromise — it's the correct engineering answer to "prove this works before you have platform access." Track B is not a fantasy — every piece of it is already running in LinkedIn's stack under a different feature, per ENGINEERING.md §4. Neither track pretends to be the other.

---

## TRACK A — Attach to real LinkedIn now

### A.1 The reliability problem, named honestly

A content script that reads `document.querySelector('.some-class')` breaks the day LinkedIn ships a redesign. That is not a hypothetical — it is the single reason most "LinkedIn extension" side projects rot within months. Track A's entire engineering challenge is **surviving markup churn without a new extension release**.

The fix is to treat DOM selectors as **remote, versioned config** — the same principle ENGINEERING.md §8 applies to fraud rules — rather than as code baked into the shipped extension.

### A.2 Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│  BUILD TIME                                                         │
│  extension/ source → esbuild bundle → manifest v3 package           │
│  → signed, versioned, uploaded to Chrome Web Store                  │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  ships once, rarely changes
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RUNTIME — every page load                                          │
│                                                                     │
│  1. content.js boots, requests selector config from                 │
│     vouch-api.example.com/config/selectors?v=<extension_version>    │
│     (cached in chrome.storage.local, 1h TTL, falls back to a        │
│     bundled default set if the fetch fails)                         │
│                                                                     │
│  2. SelectorResolver tries each candidate in priority order:        │
│       a) data-test-id / aria attributes (most stable — LinkedIn's   │
│          own automated tests depend on these, so they churn least)  │
│       b) structural role heuristics (e.g. "the h1 inside the        │
│          element following .job-details-jobs-unified-top-card")     │
│       c) legacy class-name list (most brittle, tried last)          │
│     First match wins; failure is silent, not thrown.                │
│                                                                     │
│  3. MutationObserver (debounced 150ms) re-runs resolution on SPA     │
│     navigation — LinkedIn is a client-routed app, so a plain         │
│     page-load listener would miss most navigations entirely.        │
│                                                                     │
│  4. On successful anchor: mount the Vouch panel, call the            │
│     background service worker, render.                              │
│                                                                     │
│  5. On resolution failure: log a structured "selector miss" event    │
│     to the Vouch telemetry endpoint (page type, extension version,   │
│     which candidates were tried) — NOT the page content. This is     │
│     the signal that tells you a selector needs updating, and it      │
│     arrives before a user has to report anything.                    │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  selector break detected
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RECOVERY — no extension release needed                             │
│  Update selectors.json in the config service → push →               │
│  every installed extension picks it up within the 1h cache TTL.      │
│  Mean time to recovery: under an hour, not the days a Chrome Web      │
│  Store review cycle would otherwise cost.                            │
└─────────────────────────────────────────────────────────────────────┘
```

### A.3 What changes in the codebase to get here

The current `extension/content.js` has selector arrays baked in as constants (`JOB_ANCHORS`, `BUBBLE_SELECTORS`). That's correct for a prototype and wrong for something that has to "work perfectly" against a site you don't control. Concretely:

| File | Change |
|------|--------|
| `extension/selectors.js` *(new)* | `SelectorResolver` class: takes a list of `{strategy, value}` candidates, tries each, returns the first live match. Ships with the current hardcoded lists as the **bundled fallback**. |
| `server/index.js` | New route `GET /api/config/selectors` serving versioned selector config from a JSON file, hot-editable without a redeploy. |
| `extension/background.js` | Fetch-and-cache the selector config on install and every 1h; fall back to bundled defaults on network failure. |
| `extension/content.js` | Replace the constant arrays with `SelectorResolver.resolve('jobAnchor')` calls. |
| `extension/telemetry.js` *(new)* | Fire-and-forget POST on a resolution miss. No page content, no PII — just `{pageType, extensionVersion, candidatesTried, timestamp}`. |

### A.4 Robustness beyond selectors

**Page-type detection, not URL matching alone.** `location.pathname` regexes are a start but LinkedIn reuses layouts across surfaces (a job can render inside a search-results modal, a saved-jobs list, or its own page). Detect page type by **anchor presence**, not URL shape — if the job-card anchor resolves, treat it as a job page regardless of which route produced it.

**Idempotent mounting.** The current `WeakSet` guard against double-mounting is correct; extend it to also guard against *stale* mounts — if the anchor element is detached from the DOM (SPA navigated away and back), the panel must be torn down and remounted, not left orphaned holding a reference to a dead node.

**Rate-limited API calls.** The extension calls the Vouch API on every qualifying page view. Add a per-tab in-memory cache keyed on `(pageType, entityId)` so navigating back to a job you already viewed this session doesn't re-fetch.

**Graceful degradation ladder**, matching ENGINEERING.md's fail-open principle exactly:

```
API reachable, full data       → full panel
API reachable, partial data    → panel renders what it has, labels the rest "unavailable"
API unreachable                → small "Vouch offline" chip, no broken UI, no console errors
Selector resolution fails      → nothing renders; telemetry fires; page is untouched
```

At no point can the extension leave the host page in a worse state than before it ran. That is the actual bar for "works perfectly" on a site you don't own.

### A.5 Testing pipeline for Track A

| Stage | What it catches | How |
|-------|-----------------|-----|
| **Unit** | Selector resolver logic, message-passing contracts | `node --test extension/*.test.js` against saved HTML fixtures |
| **Fixture regression** | A markup change breaking a specific selector | A library of saved DOM snapshots (`fixtures/linkedin-job-2026-07.html`, etc.), refreshed monthly, run through the resolver in a headless DOM (`jsdom` or `linkedom`) — no live LinkedIn access needed for CI |
| **Live smoke test** | Real-world drift the fixtures haven't caught yet | A scheduled (weekly) headless-browser run against a real, logged-in test LinkedIn account, checking that each anchor resolves — alerts on failure, doesn't block anything |
| **Manual QA checklist** | Visual regressions, interaction bugs | Run before every Chrome Web Store submission: job page (desktop + narrow viewport), messaging thread, Easy Apply modal, dark mode, a freshly-created LinkedIn account with a sparse profile |
| **Security review** | Scope creep in permissions | Before every submission: diff `manifest.json` permissions against the previous version; any new permission needs a written justification, since `host_permissions` growth is the #1 reason browser-store reviewers reject updates |

### A.6 Distribution pipeline

```
git tag v0.x.x
  → CI builds extension/ into a signed .zip
  → uploaded to Chrome Web Store (unlisted, "trusted testers" list initially —
    your uncle and anyone else vetting this, not the public store)
  → staged rollout: 10% → 50% → 100% of the trusted-tester list over 3 days,
    using the Web Store's own staged-rollout percentage field
  → selectors.json and API stay independently deployable — most fixes never
    require a new Store submission at all
```

Track A never needs to touch the public Chrome Web Store. An unlisted / trusted-testers listing is the correct distribution model for a proof-of-concept aimed at one internal reviewer and a demo audience — publishing it publicly would also imply a support commitment (bug reports from strangers) this project doesn't need to carry.

---

## TRACK B — Build inside LinkedIn

This is the execution detail behind ENGINEERING.md §9's phase table — turning "P0, 10 weeks" into an actual sprint plan, CI/CD pipeline, and API contract.

### B.1 Repository and branching

```
vouch-engine/            (Java) — the scoring library, ENGINEERING.md §4
vouch-service/           (gRPC service, depends on vouch-engine)
vouch-nearline/          (Samza jobs, depends on vouch-engine)
vouch-offline/           (Spark flows, depends on vouch-engine)
vouch-web/               (client components — Ember/React per LinkedIn's
                           current web stack, embedded into existing pages)
```

`vouch-engine` is the one artifact every other module depends on and never the reverse — this is what guarantees online scoring and offline batch scoring can never silently diverge, per ENGINEERING.md §8. Trunk-based development, feature-flagged behind LinkedIn's experimentation platform rather than long-lived feature branches — the same convention as the rest of LinkedIn's monorepo-adjacent services.

### B.2 CI/CD pipeline

```
PR opened
  │
  ├─▶ unit tests (vouch-engine — the 22+ adversarial cases, run on every PR,
  │     zero tolerance for a regression on any of them)
  ├─▶ static analysis / lint
  ├─▶ integration tests (vouch-service against a staging Espresso/Venice
  │     instance seeded with synthetic data)
  └─▶ shadow-eval (only for changes touching scoring logic — replay the last
        7 days of production traffic through the new code path, diff verdicts
        against production, flag any hard-rule verdict that flipped)
       │
       ▼
merge to trunk
  │
  ▼
deploy to staging  →  automated smoke suite  →  canary (1% of traffic, one
  geo)  →  automated guardrail check (latency, error rate, fail-open rate)
  →  ramp 10% → 50% → 100% over 3–5 days, each step gated on the same
     guardrails, auto-rollback on breach
```

The **shadow-eval step is the one that matters most** and has no equivalent in ordinary web development — it exists specifically because a scoring-logic regression doesn't throw an exception, it just quietly starts flagging (or failing to flag) fraud differently, and that has to be caught before it reaches a single real user.

### B.3 API contract (the concrete interface Track B exposes to LinkedIn's clients)

```protobuf
service VouchScoring {
  // Called from the job-post page component. Non-blocking, loaded after
  // first paint per ENGINEERING.md §6's latency budget.
  rpc GetReferralPlan(ReferralPlanRequest) returns (ReferralPlan);

  // Called by the nearline message-scoring job at delivery time, not by
  // any client directly — clients only ever read the precomputed verdict.
  rpc ScoreMessage(ScoreMessageRequest) returns (TrustVerdict);

  // Read-only lookup used by the message-thread component.
  rpc GetVerdict(MessageId) returns (TrustVerdict);

  rpc SubmitReferralPacket(ReferralPacket) returns (PacketReceipt);
  rpc DecideReferral(ReferralDecision) returns (PacketReceipt);
  rpc SetOfficeHours(OfficeHoursUpdate) returns (Empty);

  // Talent Hub / Recruiter surface.
  rpc GetTrustDashboard(CompanyId) returns (TrustDashboard);
}
```

Every RPC carries a deadline the caller sets (per ENGINEERING.md §6's budgets) — the service must respect a shorter deadline than its own internal timeout so a slow dependency inside Vouch can never cascade into a slow page for the member. This one contract detail is what makes "fail open" enforceable rather than aspirational.

### B.4 Event schemas (the two Kafka topics)

```
vouch-trust-events           (Avro/PDL schema, versioned)
  event_type: enum(message_scored, packet_sent, packet_decided,
                    warning_shown, warning_bypassed, account_reported)
  entity_urn, model_version, timestamp, payload (event-specific)

vouch-packet-lifecycle        (CDC from Espresso via Brooklin)
  packet_id, from_status, to_status, actor_urn, timestamp
```

`model_version` on every scored event is non-negotiable per ENGINEERING.md §7 — it's what makes the bypass-then-good-outcome drift metric computable per rule version instead of as one undifferentiated blob.

### B.5 Monitoring and SLOs

| Metric | SLO | Alerts on |
|--------|-----|-----------|
| `vouch-scoring-service` p99 latency | < 150ms (job), < 10ms (verdict read) | 3 consecutive minutes over budget |
| Fail-open rate | Tracked, no target — informational | Sudden spike (signals an upstream dependency issue, not a Vouch bug) |
| Shield precision on hard rules | ≥ 0.90, reviewed weekly against a hand-labelled sample | Drop below 0.90 |
| Bypass → good-outcome rate | Tracked per model_version | Upward trend over 2 weeks — the classifier is crying wolf |
| Referral-request burden (survey + volume) | Flat or down vs. pre-launch baseline | Any measured increase — this is a **launch gate**, not just a dashboard number |

On-call is scoped narrowly per ENGINEERING.md §9: the service being hard-down, and packet-write failures. Everything else degrades silently by design and shows up as a coverage metric, not a page.

### B.6 Rollback

Every deploy is a config-and-binary pair behind the experimentation platform's kill switch. A bad scoring release is disabled in seconds by flipping the flag to route all traffic to fail-open behavior — not by rolling back a binary, which is slower and riskier. Rule and threshold changes (the common case, per ENGINEERING.md §8) roll back even faster, since they're pure config with their own version history independent of any code deploy.

---

## 1. The 90-day execution plan (what actually happens first)

Two parallel workstreams from day one, because Track A's job is proving the concept works while Track B's foundation (which has zero UI and therefore zero dependency on Track A) is being built.

```
Week   1───2───3───4───5───6───7───8───9──10──11──12──13
Track A  [selector-config service]─[fixture tests]─[trusted-tester release]
Track B  [vouch-engine port to Java]─[shadow scoring, P0]───────────────▶
```

**Weeks 1–4 — Track A hardening + Track B engine port kickoff**
- Build `SelectorResolver`, the config service endpoint, and the fixture-test harness (A.3, A.5).
- Begin porting `server/engine/` to Java as a standalone library with the same test suite ported alongside it — this is P0's actual first deliverable and has no UI dependency.

**Weeks 5–8 — Track A release + Track B shadow mode**
- Ship the extension to a trusted-testers list; run the weekly live-smoke-test job.
- Stand up the gRPC service skeleton and the Samza shadow-scoring job (P0, ENGINEERING.md §10) against synthetic/replayed traffic.

**Weeks 9–13 — Demo-ready + shadow-mode metrics**
- Track A: extension is stable enough to be the centerpiece of the pitch demo, with telemetry proving it survives at least one real LinkedIn markup change without a re-release.
- Track B: enough shadow-mode data to report real precision/recall numbers against a hand-labelled fraud sample — turning ENGINEERING.md's P0 gate (precision ≥ 0.90) from a target into a measured result.

That last point is what separates a strong pitch from a plan someone else has to take on faith: by day 90, the deck can show an actual precision number instead of proposing one.

---

## 2. Definition of done, per track

**Track A ships when:** the extension survives a LinkedIn markup change with zero re-release (proven by the weekly live-smoke test catching a real drift and the config-push recovering it within the 1h TTL); the manual QA checklist passes on desktop + narrow viewport + dark mode; permissions are minimal and justified.

**Track B's P0 ships when:** `vouch-engine` (Java) passes the same adversarial test suite as the prototype; shadow-mode precision on hard rules is ≥ 0.90 against a real labelled sample; the shadow pipeline has run for at least 2 full weeks with no manual intervention.

Neither track is "done" on a calendar date. Both are done when their own gate — a measured number, not a shipped feature — is met.
