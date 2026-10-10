# Vouch — a verified referral bridge and hiring-fraud interception layer

**Proposal for LinkedIn · Early-Career Trust**
Author: Neil Thomas Mathew · July 2026
Status: working prototype attached (`npm run dev`)

---

## 1. Summary

Two of the most damaging things happening to early-career members on LinkedIn today share one root cause: **the platform verifies profiles, but it does not verify the two moments that actually decide a career outcome — a vouch and an approach.**

- A **referral** is the highest-conversion path into a job, and LinkedIn's referral tooling is gated on a resource students do not have (an existing 1st-degree connection at the company). The demand has not disappeared; it has migrated to anonymous forums and paid grey-market referral marketplaces.
- A **recruiter approach** is where hiring fraud begins. LinkedIn's verification work is real but sits at the profile and job-post level. The unsolicited InMail — the actual entry point for impersonation scams — carries no trust signal at all.

**Vouch** is one signal engine serving three surfaces: a structured referral bridge, an inbound-message shield, and an employer-facing trust dashboard. The same infrastructure that decides *who is worth asking for a referral* also decides *whether an inbound recruiter is real* and *whether a posting is genuinely hiring*.

This document proposes the system. A working implementation of the engine, the member surfaces, and a browser extension that renders those surfaces on live LinkedIn pages is included in this repository.

---

## 2. Problem one — referrals are the market's primary mechanism, and the product does not serve them

### 2.1 The mechanism

Referred candidates are a small share of applicants and a disproportionate share of hires. Across the research and industry literature the pattern is consistent: referrals convert at multiples of any other sourcing channel, referred hires perform better, and they stay longer. Employers know this — the majority run referral bonus programmes precisely because a referred hire is the cheapest and stickiest hire they can make.

For a student, this is the whole game. Everything else — the application, the résumé keyword tuning, the cover letter — is competing in a channel that has structurally collapsed.

### 2.2 Where the current product breaks

Three distinct failures, not one:

| # | Failure | Consequence |
|---|---------|-------------|
| 1 | **"Ask for a referral" requires an existing 1st-degree connection at the company.** | The feature amplifies access for people who already have it and is invisible to everyone else. A student with a thin network sees no button at all. |
| 2 | **When it does surface someone, it surfaces *a person at the company*, not a person near the requisition.** | Employees receive requests for roles in departments they have never touched. One such message is enough to train someone to ignore the channel permanently. |
| 3 | **A referrer is asked to vouch for a stranger with no structured way to evaluate them.** | The rational response to "I cannot assess this person in the 40 seconds I have" is to do nothing. Non-response is the default, and it is a correct decision given the information provided. |

### 2.3 The proof that the demand is real and currently leaking

Engineers run informal "DM me for a referral" threads on anonymous professional forums. An entire category of paid referral marketplaces exists and has processed tens of thousands of transactions, with candidates paying employees directly for a referral. Rooftop Slushie — built by the team behind Blind — facilitated more than 11,000 referral purchases before shutting down; ReferralHub and similar services operate today.

This is not a hypothetical need. It is demand LinkedIn already has and is losing to grey markets, where there is no verification, no capacity control, and money changes hands between candidate and employee — an arrangement most employers' referral policies explicitly forbid.

**Framing note:** referrals are not a shortcut around merit. They are the network doing what a network is for — routing a credible signal to someone who can act on it. LinkedIn's stated purpose *is* that routing. The problem is that the referral, the single highest-value transaction on the network, is the one transaction the product does not actually support.

---

## 3. Problem two — recruitment fraud reaches students through the one unguarded surface

### 3.1 Scale

The 2026 picture is not marginal:

- **95%** of job seekers report having seen a suspicious job offer; **53%** say they have been directly targeted.
- FTC data records **25,000+** business/job-opportunity scam reports in Q4 2025 alone, exceeding **$150M** in losses. Reported losses from job-search fraud rose from **$90M (2020)** to over **$501M (2024)** — a 457% increase in four years.
- Typical demands run **$2,000–$4,000** per victim; average reported loss per victim is around **$8,900**.

India-specific, which matters for the segment where LinkedIn's student growth is concentrated:

- **93%** of Indian professionals report encountering recruitment fraud.
- Cybercrime cells across Mumbai, Bengaluru, Hyderabad and Delhi NCR logged **3,847 complaints specifically involving fake LinkedIn recruiters** between January and March 2026 — a **340% increase** year over year.
- Delhi Cyber Cell's *Operation CleanHire* (March 2026) arrested 14 people running a fake-recruiter syndicate that defrauded 600+ job seekers of **₹2.3 crore**.
- The Ministry of Home Affairs and I4C have issued warnings specifically about fake internship platforms targeting students with certificate and stipend promises followed by a registration fee.

### 3.2 The structural gap

LinkedIn's verification is genuinely good and genuinely free — identity via CLEAR (US/CA/MX) or Persona (60+ countries), workplace via work email or Microsoft Entra. Job-post verification badges exist.

**None of it attaches to an unsolicited message.** And the scam does not start at a job post — it starts in the DM. By the time a student is asked for a "refundable security deposit," they are several days into a relationship with someone they believe is a recruiter, and every subsequent request feels like a formality rather than a red flag.

The second gap: **an employer has no idea they are being impersonated.** They find out when a defrauded candidate emails them, which is weeks late and generates support cost for a company that did nothing wrong.

---

## 4. The insight

> Both problems are the same missing primitive: **there is no verified, structured channel for a hiring-intent interaction between two parties who do not already know each other.**

A referral ask and a recruiter approach are the same shape of transaction — a stranger initiating a career-consequential conversation. Today both are unstructured free text with no attached evidence, which is why one gets ignored and the other gets exploited.

Build the primitive once and both problems become tractable:

```
                       ┌──────────────────────────────┐
                       │      VOUCH TRUST ENGINE      │
                       │                              │
  verified education   │  fit · evidence · warm-path  │
  workplace verification  credibility · liveness      │
  identity verification│  fraud-signal ensemble       │
  requisition metadata │  signed hiring tokens        │
  ATS sync             │                              │
                       └───────┬──────────┬───────────┘
                               │          │
              ┌────────────────┘          └────────────────┐
              ▼                                            ▼
   ┌─────────────────────┐                    ┌─────────────────────┐
   │  REFERRAL BRIDGE    │                    │   VOUCH SHIELD      │
   │  student ⇄ employee │                    │  inbound messages   │
   └─────────────────────┘                    └─────────────────────┘
              │                                            │
              └──────────────────┬─────────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │  EMPLOYER TRUST         │
                    │  DASHBOARD (monetisable)│
                    └─────────────────────────┘
```

---

## 5. The system

### 5.1 Referral Bridge

**Stage 1 — Referral Packet.** Replaces the templated DM. The student submits: the role, a written pitch (minimum length enforced server-side), and an auto-selected set of proof artifacts. The referrer evaluates something concrete in under a minute instead of vouching on vibes.

**Stage 2 — Skills Passport.** Proof artifacts are selected *per requisition*, not displayed as a static badge shelf. The engine ranks a member's artifacts (verified employment, graded assessments, competition results, merged open-source work, certifications, projects) by how directly they prove *this* req's required skills, weighted by evidence tier and recency. A self-asserted skill is worth 0.1; a workplace-verified internship doing that skill is worth 1.0. That gap is the entire reason endorsements became meaningless.

**Stage 3 — Multi-hop Warm Path Finder.** *This is the piece that does not exist today.* Instead of stopping at 1st-degree connections, the engine searches a graph whose edges are **verified shared affiliations**: same research lab, same advisor, same programme cohort, same contest team, same prior employer, same open-source repository. Path strength is the decayed product of edge weights, so a 2-hop path through a lab-mate correctly outranks a 1-hop path through someone you connected with once. Every path is rendered as a human sentence — *"via Dr. Meera Rao — both advised by CUSAT Systems Lab"* — not a degree number.

**Stage 4 — Requisition-aware routing.** Candidate referrers are ranked on org proximity to the actual req (on the hiring team > same team > same org > same discipline > same company), warm-path strength, **responsiveness** (historical reply rate × activity recency — a 90% replier who has not logged in for four months is functionally unreachable), remaining capacity, and credibility.

**Stage 5 — Referral Office Hours.** Employees declare capacity: *"I will review 3 backend packets this month."* This inverts supply from reactive to discoverable and rations a finite human resource. A system that does not ration referral attention destroys the resource it runs on.

**Stage 6 — Private vouch into the ATS.** Referring is private to the hiring pipeline, never a public act on a feed. Public vouching is the social risk that makes people decline candidates they would privately support. The packet auto-populates the employer's referral form through existing ATS integrations, which fixes the documented failure where requests die because the referrer had to chase the candidate for a résumé and a job ID.

**Stage 7 — Portable Referrer Credibility.** A private track record using a Wilson lower bound over recency-decayed outcomes. Three design constraints matter:
- A small perfect record must not outrank a large strong one (2/2 does not beat 41/50).
- *Reaching an interview* counts as near-full success — that is the outcome a referrer controls. Punishing them for the interview loop's decision would be wrong.
- Spam reports bite harder than bad outcomes, because indiscriminate referring is the failure mode that destroys the channel.
- The score is **never public**. A visible number becomes a status game and pushes people to refuse anyone risky.

**Stage 8 — Pre-Send Fit Score with hard blockers.** The student sees fit and concrete gaps *before* sending. Below threshold, or against a hard blocker (asking two seniority levels up; missing more than half the required skills), the send is refused — server-side, not just in the UI. This is the throttle that stops the referral channel from degrading into the InMail firehose it would otherwise become.

### 5.2 Vouch Shield

**Verified Hiring Channel (the structural fix).** Every real requisition mints a cryptographically signed hiring token bound to the req, the company, and the recruiter. Outreach about that req carries it. The recipient's UI then states a *fact* rather than a guess: *"Bound to verified requisition job_nw_storage at Northwind Systems."*

Absence of a token is not itself damning — plenty of legitimate outreach is informal. **Absence of a token plus a money request is dispositive.** Once members learn to look for the bound-requisition marker, an unbound message asking for money stops being ambiguous. This is the durable fix; pattern matching alone only catches scams that look like scams.

**Layered detection.** Two mechanisms:

*Hard rules* — evidence-backed patterns that alone justify a warning and **cannot be averaged away** by reassuring signals:
- **Any request for money from a candidate.** No legitimate employer charges to hire, train, onboard, or equip. Non-negotiable.
- **Consumer payment rails** in a hiring context (UPI, gift cards, crypto, personal transfer apps). Employers pay through payroll.
- **Lookalike or brand-embedding domains.**
- **Claimed employer ≠ verified workplace.**

*Weighted evidence* — transparent additive scoring over off-platform pushes (WhatsApp/Telegram in the first message), manufactured urgency, early requests for Aadhaar/PAN/SSN/bank details, selection without an interview, free-email-provider "official" contact, download/portal lures, and account provenance (age, connections, verification status, prior reports).

**Domain impersonation gets its own detector**, because it is the highest-precision signal available and the naive implementation misses the common case:
- *Homoglyph folding* — `rn→m`, `0→o`, `1→l`, `vv→w` — so `arnazon.com` collapses onto `amazon.com` at edit distance 0 rather than looking unrelated.
- *Brand-token embedding* — `n0rthwind-careers.com` embeds a brand it does not own. Edit distance never catches these because the extra words push the strings far apart, yet this is the single most common shape in documented impersonation campaigns.

**Graduated response, never a silent block.** `inline_warning` → `interstitial` → `block_send`, each with an explicit bypass. Members stay in control, because the cost of a false positive on a real recruiter is a lost opportunity for someone who can least afford it. Every score ships with its full reasoning — a warning a member cannot interrogate is a warning they learn to click past.

### 5.3 Posting Liveness

Scores every requisition on recruiter activity recency, applicant stage movement, ATS req status, posting age, and repost behaviour.

**A low score labels and demotes. It never removes.** A slow employer is not a fraudulent one, and silently delisting a real requisition is the worse error.

### 5.4 Employer Trust Dashboard *(the commercial surface)*

One view for Talent Solutions customers:
- **Posting compliance risk** — which of your reqs read as ghost jobs, and exactly why, surfaced *before* a candidate complains. Several jurisdictions now regulate whether postings reflect genuine hiring intent; this converts a UX complaint into a compliance product.
- **Brand protection** — who is impersonating you to candidates, with risk scores and triggering signals. Today an employer learns this from a defrauded candidate's email. This inverts that.
- **Referral funnel health** — capacity, utilisation, open office hours, and aggregate referrer track records (individual scores stay private).

---

## 6. Why this is a platform feature and not a startup

LinkedIn does not grant third-party API access for reading job listings or messaging; those use cases are structurally declined, and data extraction and job-search automation are explicitly rejected categories.

That is not an obstacle to this proposal — **it is the argument for it.** Every input the engine needs is already inside LinkedIn and available nowhere else:

| Signal | Already owned by |
|--------|------------------|
| Verified education, employment history | Profile |
| Workplace + identity verification (Entra, CLEAR, Persona) | Identity |
| Requisition metadata, hiring team, ATS sync | Jobs / Talent Solutions |
| Recruiter activity, applicant stage movement | Recruiter |
| Message content and delivery | Messaging |
| Affiliation edges (labs, cohorts, employers, schools) | Profile graph |

No external party can build this correctly. Anyone who tries must scrape, which violates the terms and produces a worse, more brittle product. **This is a defensible moat in exactly the segment — early career — where competitors push hardest.**

---

## 7. Success metrics

**Primary**
- Referral-ask → response rate (baseline: cold InMail response is close to noise)
- Referral-ask → interview conversion
- Share of student referrals originating from **zero** prior 1st-degree connections *(this is the access metric — it is 0% today by construction)*
- Confirmed fraud reports per 1,000 student-recruiter conversations

**Guardrails — the ones that decide whether this ships**
- **Employee-reported referral-request burden must not rise.** If it does, the throttle is mis-tuned and the feature is destroying its own supply.
- **Shield false-positive rate on verified recruiters**, measured by bypass-then-positive-outcome. A rising bypass rate means the model is drifting into crying wolf and members are learning to ignore it.
- Referral-decline rate stays stable (a spike means credibility scoring is making people risk-averse).

**Commercial**
- Talent Solutions attach rate for the trust dashboard
- Support-ticket volume for recruitment-fraud and ghost-job complaints
- Referral-sourced hires per customer

---

## 8. Rollout

| Phase | Scope | Duration | Gate to proceed |
|-------|-------|----------|-----------------|
| 0 | Shadow mode. Score everything, show nothing. Calibrate thresholds against known-fraud and known-good labelled sets. | 6 weeks | Precision ≥ 0.9 on hard rules |
| 1 | Shield only, one market (India), students + recent grads. Inline warnings only, no blocks. | 8 weeks | Bypass rate stable; no rise in false reports |
| 2 | Shield full response ladder + Verified Hiring Channel with 3–5 design-partner employers. | 8 weeks | Token coverage > 60% of outreach at partners |
| 3 | Referral Bridge, same cohort, same partners. Office hours opt-in. | 12 weeks | **Employee burden flat or down** |
| 4 | Employer Trust Dashboard to Talent Solutions. | 8 weeks | Design-partner willingness to pay |
| 5 | Geographic expansion, then seniority expansion beyond early career. | — | — |

Start with Shield. It is the lower-risk half (it only adds information), it builds the signal store the Referral Bridge depends on, and it produces a defensible trust-and-safety win independent of whether the referral work ships.

---

## 9. Risks and how the design already answers them

| Risk | Response built into the design |
|------|-------------------------------|
| **Referral spam simply moves into the new channel.** | Fit-score hard blockers refuse weak asks server-side; per-employee capacity caps; credibility scoring penalises indiscriminate referring more than bad outcomes. |
| **False-positive fraud warning costs a student a real opportunity.** | Nothing is silently blocked. Every warning is bypassable, fully explained, and instrumented — bypass-then-good-outcome is a tracked drift metric. |
| **Credibility scores make employees risk-averse.** | Private, never public; interview-reached counts as success so referrers are not punished for interview-loop outcomes; decline-rate is a monitored guardrail. |
| **Employers object to ghost-job labelling.** | Demotion not removal; the employer sees the same signals first, in their own dashboard, with a one-click remedy before any label appears. |
| **Warm paths feel invasive.** | Only affiliations already visible on both profiles are traversable; every path is rendered explicitly so members see exactly what was used; opt-out at the affiliation level. |
| **Token system gets forged or leaked.** | Signatures verified in constant time; tokens bound to req *and* recruiter so a leaked token cannot be reused by another account; TTL enforced. |
| **Scammers adapt their wording.** | Hard rules target the *economics* (money must change hands from candidate to scammer), not vocabulary. The payment rail is the part the fraud cannot remove. |

---

## 10. What is built

This repository contains a working implementation, not a mock.

**Trust Engine** (`server/engine/`) — dependency-free, unit-tested scoring: fit + Skills Passport selection, multi-hop warm-path search, Wilson-bound credibility, requisition-aware routing, the fraud-signal ensemble, HMAC hiring tokens, posting liveness. **22 tests**, including the adversarial ones that matter: a money request stays high-risk even from an otherwise perfect sender; homoglyph and brand-embedding domains are caught; weak signals stacked together cannot alone reach the top band; a small perfect referral record does not outrank a large strong one; token tampering and expiry are rejected.

**API + member console** (`server/`, `web/`) — five surfaces (student, referrer, office hours, Shield, employer dashboard), all scored live against seeded data. Includes a **before/after panel** that renders what today's product does with the same student and the same requisition, and a **live scorer** where anyone can paste a real scam message they have received and watch the engine reason about it.

**Browser extension** (`extension/`) — renders the Vouch surfaces in position on real linkedin.com job and messaging pages, so the design can be evaluated in situ rather than inferred from a mock.

Run instructions: [`README.md`](README.md). System design and the production mapping for every prototype shortcut: [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 11. Open questions worth deciding early

1. **Should referral capacity be employer-configurable?** A company may want to cap or fund referral attention differently by org. Argues for capacity as a Talent Solutions setting rather than a purely personal one.
2. **Does the Verified Hiring Channel extend to agency recruiters?** They are legitimate and numerous, but they do not own a requisition. Probably needs a delegated-token model with the client employer as issuer.
3. **How much of the warm-path graph should be visible to the student before they send?** Full transparency helps them write a better pitch; it also exposes an employee's affiliations more legibly than their profile does today.
4. **Where does the money-request hard rule sit legally across markets?** Some jurisdictions permit certain candidate-paid placement models. The rule may need per-market configuration rather than a global constant.

---

*Companies, members, and messages in the prototype are fictional. The fraud demo shows brand impersonation, and doing that against real employers' names would be inappropriate; the mechanism demonstrates identically against invented brands.*
