# Vouch — Engineering Plan

**System architecture, tech stack, feature inventory, and phased delivery.**
Companion to [PROPOSAL.md](PROPOSAL.md) (the *why*) and [ARCHITECTURE.md](ARCHITECTURE.md) (the prototype's internals).

This document answers one question: **what would it actually take to ship this inside LinkedIn, without disrupting anything that already works?**

---

## 0. The governing constraint

Everything below is subordinate to one rule:

> **Vouch adds no new destination, no new app, and no new step in any existing funnel. It adds intelligence to steps members already take.**

That is not a nice-to-have. A trust layer that asks members to learn a new place to go will not be adopted, and a feature that inserts itself into the job-application path will not be approved. So the design target is:

| Goal | How it is enforced |
|------|-------------------|
| **Blends in** | Zero new top-level navigation. Every surface is an upgrade of an existing component. |
| **Smooth** | No new member setup, no new profile to fill, no onboarding flow. The system runs on data members already have. |
| **Not too much** | 6 UI touch points total. Only 2 are visible to a member by default; the rest are progressive disclosure or opt-in. |
| **Easiest to operate** | Zero new technologies. 7 pieces of net-new infrastructure, every one a standard pattern on infra LinkedIn already runs. |
| **Cannot break anything** | Every call is asynchronous, timeout-bounded, and **fail-open**. If Vouch is completely down, LinkedIn behaves exactly as it does today. |

---

## 1. Surface integration map

Where every feature physically lands. This is the "blends into the funnel" answer.

| # | Existing LinkedIn surface | What changes | Visible by default? |
|---|--------------------------|--------------|---------------------|
| 1 | **Job post page** — the existing *Ask for a referral* button | Same button, upgraded destination. Today it renders only with a 1st-degree contact; now it always renders and opens the packet flow. | Yes — but it is an **existing** button |
| 2 | **Job post page** — the metadata row (`Posted 3 weeks ago · 200 applicants`) | One additional chip: `Actively hiring` / `Low hiring activity`. | Yes — one chip |
| 3 | **Message thread** — above the composer | A trust strip. Silent when clear; a checkmark when token-bound; a warning band when risk crosses threshold. | Only when it has something to say |
| 4 | **My Jobs** — alongside Saved / Applied | A third tab: *Referrals*, tracking packet status. | Only if you have sent one |
| 5 | **Settings → Communications** | One toggle: *Referral office hours*, with a capacity number and an optional note. | Opt-in, employee-side only |
| 6 | **Recruiter / Talent Hub** | A *Hiring Trust* tab — posting liveness, brand impersonation, referral funnel. | Customer-side only |

**Net member-facing footprint: one upgraded button, one chip, one conditional strip.** Everything else is opt-in or lives in a customer product.

### What this deliberately does *not* do

- No new tab in the global nav.
- No new notification type in phase 1 (reuses existing message and job-alert channels).
- No new profile section. The Skills Passport is a **view over existing profile data** — projects, certifications, assessments, verified positions — not a new thing to fill in.
- No feed integration at all. Referrals are private; putting them in the feed would be the single fastest way to kill the feature.

---

## 2. Feature inventory

Everything the system does, with an explicit cut line. The cut line is the point — a 19-feature launch is how this dies.

### Shield (fraud interception) — **ships first, ships complete**

| Feature | Description | Phase |
|---------|-------------|-------|
| Message risk scoring | Hard rules + weighted evidence over content, sender provenance, domains | P0 |
| Domain impersonation | Homoglyph folding + brand-token embedding detection | P0 |
| Sender provenance | Account age, verification state, connections, prior reports, claimed-vs-verified employer | P0 |
| Graduated response | Inline warning → interstitial → block-with-bypass, all instrumented | P1 |
| Report flow | One tap, feeds provenance risk for every future recipient | P1 |
| **Verified Hiring Channel** | Signed requisition tokens; recruiter outreach provably bound to a real req | P2 |

### Referral Bridge — **second, because it depends on Shield's signal store**

| Feature | Description | Phase |
|---------|-------------|-------|
| Warm path finder | Multi-hop over verified shared affiliations | P3 |
| Referral packet | Structured ask replacing the templated DM | P3 |
| Skills Passport | Per-requisition evidence selection from existing profile data | P3 |
| Fit score + hard blockers | Pre-send self-filtering; server-enforced refusal | P3 |
| Referrer routing | Requisition proximity, warm path, responsiveness, capacity, credibility | P3 |
| Office hours / capacity | Declarable, rationed referral bandwidth | P3 |
| Private vouch → ATS | Auto-populates the employer referral form; never public | P3 |
| Referrer credibility | Private Wilson-bound track record | P3 |
| Outcome feedback loop | Both sides rate privately; closes the loop | P4 |

### Jobs & Employer

| Feature | Description | Phase |
|---------|-------------|-------|
| Posting liveness | Scores hiring intent; labels and demotes, never removes | P1 |
| Trust dashboard | Liveness compliance, brand protection, funnel health | P4 |

### Explicitly out of scope for v1

Paid referrals or any money movement (creates the exact conflict of interest the grey markets have). Public credibility scores. Feed surfaces. Auto-generated pitches — the pitch is the one part that must be the member's own words, and generating it destroys the signal it exists to carry.

---

## 3. System architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  EXISTING CLIENTS — no new app                                           │
│  Web · iOS · Android · Recruiter                                         │
│  Job post page │ Message thread │ My Jobs │ Settings │ Talent Hub        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  gRPC · async · timeout-bounded · FAIL-OPEN
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  vouch-scoring-service            STATELESS · horizontally scalable      │
│                                                                          │
│  fit · passport selection · referrer routing · warm-path ranking         │
│  shield verdicts (read-through) · liveness · credibility read            │
│                                                                          │
│  Rules loaded from versioned config — new patterns ship without a build  │
└───┬────────────────┬─────────────────┬──────────────────┬────────────────┘
    │ read           │ read            │ read/write       │ read
    ▼                ▼                 ▼                  ▼
┌─────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────────┐
│ Venice  │   │   LIquid     │   │  Espresso  │   │ Jobs /       │
│ derived │   │  graph       │   │  vouch_    │   │ Identity /   │
│ read-   │   │  affiliation │   │  packets   │   │ Profile      │
│ heavy   │   │  + connection│   │  (new tbl) │   │ (existing    │
│         │   │  edges       │   │            │   │  services)   │
│ • affil │   │              │   │ OLTP state │   │              │
│   sets  │   │ new predicate│   │ for the    │   │ verification,│
│ • cred  │   │ types only   │   │ referral   │   │ req metadata,│
│ • live  │   │              │   │ workflow   │   │ ATS sync     │
└────▲────┘   └──────▲───────┘   └─────┬──────┘   └──────────────┘
     │               │                 │
     │ bulk load     │ edge writes     │ CDC via Brooklin
     │               │                 ▼
┌────┴───────────────┴──────────────────────────────────────────────────────┐
│  NEARLINE — Samza                    OFFLINE — Spark on Azkaban           │
│                                                                           │
│  • message scoring AT DELIVERY       • affiliation set materialization    │
│    (not at read time)                • credibility recompute (daily)      │
│  • provenance updates on report      • liveness recompute (hourly)        │
│  • liveness signal freshening        • model training sets                │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ trust events
                               ▼
                    Kafka  `vouch-trust-events`
                               │
                               ├──▶ Pinot  (dashboard + ops analytics)
                               └──▶ HDFS   (training data, audit trail)
```

### The three architectural decisions that matter

**1. Shield scores at delivery, not at read.**
A message is scored once, in the nearline pipeline, when it is delivered. The verdict is persisted next to the message. The read path is a single lookup.

> **Consequence: opening a message thread gets no slower.** Scoring cost is paid asynchronously, off the critical path, once per message instead of once per view. This is the single most important choice in the design for both performance and operability.

**2. Warm paths are retrieval, not traversal.**
Detailed in §5. A live multi-hop graph walk per job-page view is not viable at 2M QPS. It is restructured into two key-value reads and a set intersection.

**3. Everything fails open.**

| If this is down… | Member sees |
|------------------|-------------|
| vouch-scoring-service | Today's LinkedIn, exactly. Referral button reverts to 1st-degree behaviour; no trust strip; no liveness chip. |
| Venice derived store | Warm paths unavailable; routing falls back to org proximity only. Packet flow still works. |
| Shield nearline job | Messages deliver normally, unscored. Backfill on recovery. |

No Vouch failure can block a job application, a message send, or a page render. Every integration point is a timeout-bounded async call whose failure path is "render what we render today."

---

## 4. Tech stack

**The stack is LinkedIn's stack.** Nothing new is introduced — the operability argument rests entirely on this.

| Layer | Choice | Why |
|-------|--------|-----|
| **Service framework** | **gRPC** (Java) | LinkedIn is mid-migration from Rest.li to gRPC across ~8,000 services. A new service should be born on the target, not the deprecated framework. |
| **Scoring core** | Plain Java library, zero I/O | Already true in the prototype — the engine is pure functions. Makes it unit-testable against production label sets and embeddable in both the online service and offline Spark jobs, so **online and offline scoring cannot drift**. |
| **OLTP state** | **Espresso** — one new table, `vouch_packets` | The referral workflow is the only genuinely new mutable state. Everything else is derived. |
| **Derived / read-heavy** | **Venice** — affiliation sets, credibility, liveness | Exactly Venice's purpose: bulk-loaded and nearline-updated derived data with high read throughput. |
| **Graph** | **LIquid** — new predicate types only | LIquid stores edges as `(subject, predicate, object)` triples and supports compounds for n-ary relationships with attributes. Affiliation edges (`member — studiedUnder → advisor`, with attributes for verification and era) are a natural fit. **No new graph system.** |
| **Streaming** | **Kafka** + **Samza** | Message scoring is a canonical nearline consumer. LinkedIn already processes trillions of events daily on this path. |
| **CDC** | **Brooklin** | Espresso → Kafka for packet lifecycle events feeding analytics. |
| **Offline** | **Spark**, orchestrated by **Azkaban** | Affiliation materialization, credibility recompute, training sets. |
| **Analytics** | **Pinot** | Powers the employer dashboard and the drift/ops metrics. Real-time OLAP is precisely this workload. |
| **ML features** | **Feathr** | Feature store already battle-tested in production for years; the phase-2+ classifier consumes the same features the rules do, preventing training/serving skew. |
| **Blob** | **Ambry** | Packet attachments, if any. Likely unnecessary — artifacts are links to existing profile entities. |
| **Config** | Versioned rule config, hot-reloadable | Hard rules and thresholds ship as config, not code. **A new scam pattern is a config push with a shadow-eval gate, not a release train.** |
| **Clients** | Existing web + native iOS/Android components | New components inside existing pages. No new client application. |
| **Experimentation** | LinkedIn's existing A/B platform | Every surface behind a ramp; guardrail metrics wired before launch. |

### Net-new infrastructure: 7 items

1. One gRPC service (stateless)
2. One Espresso table
3. One Venice store
4. One Samza nearline job
5. One Spark/Azkaban flow group
6. One Kafka topic
7. One Pinot table

Plus new **predicate types** in LIquid — not a new store.

That is the entire operational surface area. There is no new database, no new language, no new deployment model, and no new on-call technology.

---

## 5. The hard problem: warm paths at scale

This is the one component that does not survive a naive implementation, so it gets its own section.

**The naive version:** on every job-page view, walk the graph up to 3 hops from the member, filter to employees at that company, rank. At 2M graph QPS and 270B edges, this is not viable as a synchronous per-view operation.

**The restructure — two-stage retrieval:**

**Stage A · Offline (Spark, nightly).** Materialize each member's **affiliation set** — the verified groups they belong to:

```
member_id → [
  (lab:cusat_systems, verified, 2023-2026),
  (advisor:m_rao,      verified, 2024-2026),
  (cohort:icpc_amritapuri_2025, verified),
  (employer:tessellate, verified, 2025-2025),
  (repo:etcd-io/etcd,   verified)
]
```

Tens of entries per member, not thousands. Written to Venice.

Also materialize the **inverted index**: `affiliation_id → member_ids`.

**Stage B · Online (per request).**
1. Read the student's affiliation set — **one Venice read**.
2. Read employees at the target company sharing ≥1 affiliation — **one indexed read**, bounded by company size.
3. Rank the resulting ~50–200 candidates with the scoring function.

**A graph traversal becomes two key-value reads plus a set intersection.**

**Two-hop paths** use a precomputed **bridge set** — the affiliations of the member's strongest N (≈50) 1st-degree contacts, refreshed nightly. Bounded by construction.

### The cardinality rule that solves scale and quality together

`studiedAt: Anna University` has millions of members. Retrieving on it is both expensive *and* useless — it is a weak signal (weight `0.34` in the engine) that would flood results.

So: **affiliations above a size threshold are excluded from retrieval and used only as a ranking tiebreak.** One rule, two problems solved. High-signal affiliations — a specific lab, a specific advisor, a specific contest team — are naturally small, which is exactly *why* they are high-signal.

---

## 6. Scale and latency budgets

| Path | Budget | Notes |
|------|--------|-------|
| Job page — referral module | **p99 < 150 ms, non-blocking** | Loads after first paint. Never in the render critical path. |
| Message read — trust verdict | **p99 < 10 ms** | Precomputed at delivery; single lookup. |
| Message delivery — scoring | **p99 < 200 ms**, async | Off the delivery critical path. Failure ⇒ unscored, backfilled. |
| Warm-path candidate generation | **p99 < 80 ms** | Two Venice reads + intersection. |
| Packet submit | **p99 < 400 ms** | Write path, user-initiated, tolerant. |
| Liveness recompute | Hourly batch | No online cost; served from Venice. |
| Credibility recompute | Daily batch | Deliberately not real-time — it is a reputation signal, not a live one. |

**Capacity note:** Shield scoring is bounded by *message volume*, not page views — orders of magnitude smaller than feed or search traffic. The referral path is bounded by *job-page views by early-career members with an intent signal*, a thin slice of jobs traffic. Neither is a platform-scale workload.

---

## 7. Data model

**One new OLTP table.** Everything else is derived or already exists.

```
vouch_packets                          (Espresso)
  packet_id            PK
  student_urn, job_urn, referrer_urn
  pitch                text
  artifact_urns        list             -- pointers to EXISTING profile entities
  fit_score, fit_components
  status               enum(pending, referred, declined, info_requested, expired)
  created_at, decided_at, expires_at    -- TTL returns referrer capacity
  ats_submission       struct(provider, submitted_at, visibility)
```

```
Derived — Venice                        Derived — LIquid (new predicates)
  member → affiliation_set                member --studiedUnder--> advisor
  member → bridge_set                     member --memberOfLab--> lab
  employee → credibility                  member --cohortOf--> programme
  job → liveness                          member --contributesTo--> repo
                                          member --teammateIn--> contest_team
```

```
message_trust_verdict                  (alongside message storage)
  message_urn, risk, band, signals, model_version, scored_at
```

`model_version` is not optional. Every verdict must be attributable to the exact rule set and model that produced it, or the drift analysis in §8 is impossible.

---

## 8. Rules → models, without losing the invariants

**Phase 0–2 is rules-only.** Deliberately.

Rules are inspectable, instantly deployable, explainable to a member, and cheap. They also produce the labelled data the model needs. Shipping a classifier first would mean shipping something nobody can debug against a problem nobody has labelled yet.

**Phase 3+ adds a classifier** over the same feature space (via Feathr, so training and serving share definitions). LinkedIn's anti-abuse work already uses deep learning and isolation forests; this slots into that practice.

**The hard rules stay rules. Permanently.**

> "No employer ever charges a candidate money" is an economic invariant, not a pattern to be learned. A model that can be argued out of it — by an unusual phrasing, a distribution shift, a well-crafted adversarial message — is a worse system than a regex. The model *adds* recall on the fuzzy middle. It never gets a vote on the floor.

**Drift detection** is the metric that decides whether Shield stays honest: `bypass → positive outcome` rate, tracked per model version in Pinot. A member who bypasses a warning and then has a normal hiring conversation is a false positive that told us so. When that rate climbs, thresholds are wrong.

---

## 9. Operational model

The "easiest to operate" requirement, made concrete.

**Stateless by construction.** The scoring service holds no state. Restart-safe, trivially autoscaled, no corruption class of bug, no failover choreography.

**Online and offline share one library.** The scoring core is the same Java artifact in the gRPC service and in the Spark job. Scores cannot diverge between what a member saw and what analysis reports.

**Config over code.** Rules, weights, and thresholds are versioned config with a shadow-eval gate. A new scam campaign is answered in minutes, by an on-call engineer, without a build.

**Degradation is the default path, not an incident.** Because everything fails open, most failures are *not pageable* — they are a silent reversion to today's product. A dashboard shows Vouch coverage; a coverage drop is a ticket, not a 3 a.m. page. Pageable events are narrow: scoring service hard-down (member-visible only as absence), and packet-write failures (real data loss risk).

**Audit trail is a product requirement.** Every verdict and every warning interaction lands in Kafka → HDFS with its model version. Trust & Safety needs this before any classifier affecting member reach can ship, and it is what makes a post-incident review possible.

**Runbook surface is small** precisely because the infrastructure is standard: a Samza job, a Venice push, a Spark flow, a gRPC service. Every one of these already has an established runbook pattern.

---

## 10. Phased delivery

Twelve months, peak team ~8, steady ~6. Each phase ships something defensible on its own.

### P0 · Foundations + Shield in shadow — 10 weeks
**Team: 2 backend, 1 ML, 0.5 SRE, 0.5 PM**
Scoring service, rule config, Kafka topic, nearline scoring job, verdict storage. **Zero UI.**
Score every inbound recruiter message; show nothing; measure against labelled fraud and known-good sets.
> **Gate:** precision ≥ 0.90 on hard rules. False-positive rate on verified recruiters below threshold.

### P1 · Shield visible + liveness — 8 weeks
**Team: +1 web, +1 mobile, +0.5 design**
Trust strip in message threads. Report flow. Liveness chip and ranking demotion on job posts.
Ramp: India, early-career members, warnings only — **no blocking**.
> **Gate:** bypass rate stable. No rise in false reports. Job-page latency unmoved.

### P2 · Verified Hiring Channel — 8 weeks
**Team: +1 backend (Jobs integration)**
Token minting in the requisition service. Recruiter-side tooling. Full response ladder including interstitials.
3–5 design-partner employers.
> **Gate:** token coverage > 60% of partner outreach. Member comprehension validated in research.

### P3 · Referral Bridge — 14 weeks *(the big one)*
**Team: 3 backend, 1 data/infra, 2 frontend, 1 ML, 1 design**
Affiliation materialization (Spark + LIquid predicates). Warm-path retrieval. Packet flow. Skills Passport. Routing. Office hours. Credibility. ATS write path.
Same cohort and partners as P2.
> **Gate — the one that matters:** **employee referral-request burden flat or down.** If employees report more noise, the throttle is mis-tuned and the feature is consuming its own supply. Do not proceed on volume metrics alone.

### P4 · Employer Trust Dashboard + feedback loop — 8 weeks
**Team: 2 fullstack, 0.5 design**
Pinot-backed dashboard. Two-way outcome feedback.
> **Gate:** design-partner willingness to pay.

### P5 · Expansion — ongoing
Geographic, then language (the rule set is currently English/Hinglish-oriented — this is where the classifier earns its place), then seniority beyond early career.

### Critical path

```
P0 scoring service ──┬──▶ P1 Shield UI ──▶ P2 tokens ──┐
                     │                                  ├──▶ P4 dashboard
                     └──▶ liveness ─────────────────────┤
                                                        │
        affiliation materialization ──▶ P3 referral ────┘
                     ▲
                     └── can start during P1 — it is independent of Shield
```

Affiliation materialization is the long pole in P3 and has no dependency on Shield. **Start it during P1** with a single data engineer; otherwise P3 stretches by a quarter.

---

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| **Referral spam moves into the new channel** | Server-side fit blockers, per-employee capacity caps, credibility penalties weighted harder for spam than for bad outcomes. Burden is a launch gate, not a post-launch metric. |
| **False-positive fraud warning costs a real opportunity** | Nothing silently blocked. Every warning bypassable and instrumented. Bypass-then-good-outcome tracked per model version. |
| **Latency regression on the jobs funnel** | Async, non-blocking, timeout-bounded, fail-open. Job-page latency is a P1 gate. |
| **Affiliation data is sparse or wrong** | Retrieval is verified-affiliation-only; unverified edges are discounted, not trusted. Sparse coverage degrades to today's behaviour rather than to bad recommendations. |
| **LIquid write volume from new predicates** | Affiliation edges are low-churn — they change on profile edits, not continuously. Bulk-load initially, nearline updates after. |
| **Employers object to liveness labelling** | Demotion not removal; employer sees their own signals first, in their dashboard, with a one-click remedy before any public label. |
| **Scammers adapt wording** | Hard rules target the *economics* — money must move from candidate to scammer — not vocabulary. The payment rail is the part the fraud cannot remove. |
| **Scope creep into a "referral marketplace"** | Money movement is explicitly out of scope. The moment a referral has a price, it is the grey market with better branding. |

---

## 12. What already exists in this repo

The prototype is the reference implementation of §3's scoring core:

- **`server/engine/`** — the scoring library, dependency-free and I/O-free, exactly as §4 requires it to be for the online/offline shared-artifact property. **22 tests**, including the adversarial cases.
- **`server/`** — the API shape the gRPC service would expose.
- **`web/`** — all six surfaces from §1, rendered.
- **`extension/`** — those surfaces rendered in position on real linkedin.com, because third-party API access to jobs and messaging does not exist.

The port from prototype to production is: JS → Java for the engine, JSON file → Espresso/Venice for storage, per-request graph rebuild → the two-stage retrieval in §5. The scoring logic itself transfers unchanged, which is why it was written with no dependencies and no I/O.
