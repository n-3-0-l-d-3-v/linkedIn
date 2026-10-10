# Architecture

How the prototype is built, and — more importantly — **how each prototype shortcut maps to the production system**. The second half is the part worth reviewing.

---

## 1. Shape

```
┌──────────────────────────────────────────────────────────────────────┐
│  SURFACES                                                            │
│                                                                      │
│  web/          React console — student, referrer, office hours,      │
│                Shield, employer dashboard                            │
│  extension/    MV3 content script — renders the same surfaces in     │
│                position on real linkedin.com pages                   │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ HTTP (JSON)
┌────────────────────────────▼─────────────────────────────────────────┐
│  server/index.js      REST API — thin, no logic                      │
│  server/services.js   Composition — assembles engine inputs from      │
│                       storage, shapes responses                      │
│  server/db.js         Repository — narrow accessor surface           │
│  server/seed.js       Deterministic fixture set                      │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ pure function calls
┌────────────────────────────▼─────────────────────────────────────────┐
│  server/engine/       TRUST ENGINE — zero dependencies, zero I/O     │
│                                                                      │
│    util.js         numeric + text primitives (Wilson, decay,         │
│                    Levenshtein, homoglyph folding, skill canon)      │
│    fit.js          fit score, gaps, blockers, Skills Passport        │
│    warmpath.js     affiliation graph + multi-hop best-path search    │
│    credibility.js  Wilson-bound referrer track record                │
│    match.js        requisition-aware referrer routing                │
│    shield.js       fraud-signal ensemble + hard rules                │
│    tokens.js       HMAC-signed hiring tokens                         │
│    liveness.js     posting liveness scoring                          │
└──────────────────────────────────────────────────────────────────────┘
```

**The engine has no imports outside itself and performs no I/O.** That is deliberate: it means the scoring logic can be lifted into a JVM/Go scoring service, tested against production label sets, and versioned independently of any surface. Everything storage- or HTTP-shaped lives in `services.js` and `index.js`.

---

## 2. Scoring models

| Model | Method | Notable design choice |
|-------|--------|----------------------|
| **Fit** | Weighted mean over 5 components + hard blockers | Evidence tier (0.1 self-asserted → 1.0 verified employment) separated from claimed coverage, so proving beats claiming. Blockers cannot be outvoted by a high score. |
| **Skills Passport** | Relevance × evidence tier × recency decay | Selection is per-requisition, not a static badge list. |
| **Warm path** | Frontier search maximising the *product* of edge weights, with a per-hop penalty | Multiplicative, not additive — hop count is a bad proxy for whether someone will vouch. A 2-hop lab connection beats a 1-hop stranger. |
| **Credibility** | Wilson lower bound (95%) over recency-decayed outcome credits | Lower bound, not raw ratio: 2/2 must not beat 41/50, or the reputation system is trivially gameable. Newcomers route at 0.5, not 0, so the system bootstraps. |
| **Routing** | Weighted mean over org proximity, warm path, responsiveness, capacity, credibility | Capacity is a hard gate (×0.35 when exhausted), not a tiebreak. |
| **Shield** | Additive weighted evidence → `1 − e^(−raw/62)` soft knee, floor of 82 on any hard rule | The soft knee prevents many weak signals from reaching the top band; the floor prevents many reassuring signals from diluting a hard rule. Both directions of error are explicitly bounded. |
| **Liveness** | Weighted mean over 5 operational signals | Outputs a *ranking multiplier*, never a removal flag. |

### Why the Shield squash function matters

```
risk = 100 × (1 − e^(−raw / 62))          then, if any hard rule fired:
risk = max(risk, 82)
```

A purely additive score lets ten trivial signals ("generic greeting", "slightly new account") sum into a scam accusation against a real recruiter. A purely multiplicative or averaged score lets a verified, decade-old, well-connected account dilute an explicit demand for ₹4,999. The knee-plus-floor construction bounds both failures, and the floor is what makes "no employer ever asks a candidate for money" an actual invariant rather than a heavy weight.

---

## 3. Prototype → production mapping

Every shortcut, named, with what replaces it.

| Prototype | Production |
|-----------|------------|
| `db.json` file store | Existing services. Every read is a call into Profile, Jobs, Messaging, Identity, or Recruiter; every write is an event onto a trust-signal topic. The repository surface in `db.js` is narrow specifically so this is a file swap, not a refactor. |
| Affiliation graph rebuilt per request | A served graph index with incremental updates. **This is the largest single gap between this code and a production port** — `buildGraph()` is O(edges) per call and would not survive contact with the real graph. |
| HMAC hiring tokens with a shared secret | Asymmetric signatures issued by the requisition service, so nothing outside it can mint a token. Verification semantics are already identical. |
| Regex pattern ensemble | Same rules as the interpretable floor, plus a trained classifier over the same feature space. **The hard rules stay as rules** — an economics-based invariant should not be learned, and a model that can be talked out of "employers do not charge candidates" is a worse system. |
| Skill alias table | The existing skills taxonomy with canonical IDs and synonym edges. |
| Extension DOM scraping | Nothing. These are native surfaces fed by the services that own the data. The scraping exists only so the design can be evaluated in situ. |
| Seeded fixtures | Real data, with the shadow-mode calibration phase in the rollout plan as the bridge. |
| In-process scoring | A scoring service. The engine's zero-I/O design is what makes that move mechanical. |

---

## 4. Privacy and safety properties

These are properties of the design, not policies bolted on:

- **Credibility scores are never public.** Not exposed on any surface, at any aggregation level below employer-wide.
- **Referrals are private to the hiring pipeline.** No feed artifact, no notification to third parties.
- **Only mutually-visible affiliations are traversable.** The warm-path finder cannot surface an edge that is not already on both profiles, and every path used is rendered explicitly to the member.
- **No silent blocking.** Every Shield response level has an explicit, instrumented bypass.
- **Every decision is auditable.** `db.logEvent` appends scoring decisions and warning interactions. In production this is the trail a trust-and-safety team needs before shipping any classifier that affects member reach.
- **Full reasoning ships with every score.** Not a debugging affordance — an interpretability requirement. Warnings that cannot be interrogated get trained past.

---

## 5. API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/jobs` | Jobs ranked with liveness demotion applied |
| `GET` | `/api/referral-plan?studentId&jobId` | Fit, Passport, ranked referrers, warm paths, today-vs-Vouch baseline |
| `POST` | `/api/referrals` | Send a packet. Enforces pitch length, fit blockers, referrer capacity **server-side** |
| `GET` | `/api/referrals/inbox/:employeeId` | Referrer queue with fit, evidence, bonus, warm path |
| `POST` | `/api/referrals/:id/decision` | `refer` \| `decline` \| `request_info` (declining returns the slot) |
| `GET/POST` | `/api/office-hours[/:employeeId]` | Declare and discover referral capacity |
| `GET` | `/api/shield/inbox/:recipientId` | Scored inbound messages |
| `POST` | `/api/shield/assess` | Ad-hoc scoring — used by the extension and the live scorer |
| `POST` | `/api/shield/report` | Report an account; feeds provenance risk for all future recipients |
| `POST` | `/api/shield/interaction` | Warning-interaction telemetry (the drift metric) |
| `GET` | `/api/shield/patterns` | The rule set, exposed so the proposal can cite actual rules |
| `POST` | `/api/tokens/mint` · `/api/tokens/verify` | Verified Hiring Channel |
| `GET` | `/api/dashboard/:companyId` | Employer trust dashboard |
| `POST` | `/api/admin/reset` | Restore seed state |

Responses are `{ ok: true, data }` or `{ ok: false, error }`. Any endpoint returning a score also returns its component breakdown.

---

## 6. Known limitations

Stated plainly, because a review will find them anyway:

1. **Graph rebuild cost** — as above, the one thing that would not survive production traffic unchanged.
2. **Regex brittleness across languages.** The pattern set is English/Hinglish-oriented. Multilingual coverage needs either translated rule sets or the trained classifier layer.
3. **No adversarial evaluation.** The tests cover the failure modes I could anticipate; they are not a red-team exercise. Shadow mode exists in the rollout plan precisely to catch what I did not think of.
4. **Responsiveness modelling uses a single decay constant** (21-day half-life) chosen by judgement, not fit to data. It should be learned per-segment.
5. **The demo extension maps every real job page onto one seeded requisition.** It has no way to read the actual req — that is the API restriction the proposal is built around.
6. **Capacity returns on decline but not on timeout.** A packet that is never actioned holds a slot indefinitely. Needs a TTL.
