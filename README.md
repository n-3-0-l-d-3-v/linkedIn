# Vouch

**A verified referral bridge and hiring-fraud interception layer for LinkedIn.**

One trust engine, three surfaces: get students a real path to a referral without a pre-existing network, stop fraudulent recruiters at the message where the scam actually starts, and give employers a dashboard for both.

- 📄 **[PROPOSAL.md](PROPOSAL.md)** — the proposal. Problem, evidence, system design, metrics, rollout, risks.
- 🏗 **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it is built, and how every prototype shortcut maps to production.

---

## Run it

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

That starts both processes:

| | |
|---|---|
| Console | http://localhost:5180 |
| API | http://localhost:4180 |

Run the engine test suite (22 tests, no framework):

```bash
npm test
```

Restore seed data at any time with the **↺** button in the console, or:

```bash
npm run seed
```

---

## The 6-minute demo

Follow this order. It builds an argument rather than showing features.

### 1 · The access problem — *Student* tab

Select **Software Engineer Intern — Storage Engine**. Look at the **What changes** panel.

> **LinkedIn today: 0.** The "Ask for a referral" button does not appear at all — Neil has no 1st-degree connection at Northwind.
> **With Vouch: 4 verified warm paths.**

Scroll to **Who to ask**. Note what the ranking got right:

- **Ananya Rao** — on the requisition's hiring team, reached via *"Dr. Meera Rao — both advised by CUSAT Systems Lab"*.
- **Rahul Menon** — CUSAT alumnus, same company, ranks near the **bottom**: enterprise sales, unrelated to the req, rarely active. *This is the person today's product would surface, and the reason employees mute referral requests.*
- **Sarah Iyer** — on the hiring team but **out of capacity**, so she is shown unavailable rather than spammed.

### 2 · The evidence problem — same tab

**Skills Passport** attached three artifacts *selected for this requisition* — the Raft implementation, the proctored distributed-systems assessment, the ICPC result — each labelled with which required skill it proves. Not a badge shelf.

Now write a pitch and send. Then switch to the **Storage Engine** job at Zenith and try to send a weak ask — the server refuses it, with a reason.

### 3 · The other side — *Referrer* tab

Reviewer defaults to **Ananya Rao**. The packet you just sent is here with its fit score, the evidence, the warm path, and — crucially — **the referral bonus this employee probably did not know they were eligible for**.

Her private track record reads **reliable**. Switch the reviewer to **Rahul Menon**: same system, 7 completed referrals, **0% reached interview**, 2 spam reports, tier **low**. That divergence is the entire point of credibility scoring.

Referring is **private**. It goes into Greenhouse against the req — never onto a feed.

### 4 · Fraud — *Shield* tab

Five inbound messages, scored before you open them.

- **Maya Fernandes → risk 0, "Verified".** Her message carries a signed hiring token bound to a real requisition.
- **"HR Team — Northwind Careers" → risk 99, content hidden.** Open **Why this score**: the money request and the UPI rail are *hard rules*; `n0rthwind-careers.com` is flagged as **brand impersonation** — a domain embedding a brand it does not own, which edit-distance detection alone would miss.
- **Rohit Sharma → risk 84.** No money request at all. Caught because his *claimed* employer does not match his *verified* workplace.

Nothing is silently blocked — every warning has a bypass, and the bypass is instrumented.

Then scroll to **Score any message** and paste a real scam message someone has actually received. This is the most convincing thirty seconds of the demo.

### 5 · The business case — *Employer* tab

Northwind's own trust dashboard: one posting flagged at **ghost-job risk** with the specific reasons (recruiter idle 63 days, 2,140 applicants and 7 advanced, ATS req closed, reposted 3×), one **impersonation of their brand** they would otherwise learn about from a defrauded candidate's email, and referral funnel health.

This is the surface that makes the proposal a Talent Solutions product rather than a goodwill feature.

---

## On real LinkedIn — the extension

The console proves the system. The extension proves it **belongs in the product**.

1. Start the API (`npm run dev`).
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.
3. Open any LinkedIn **job page** → the referral bridge panel renders at the top of the posting.
4. Open any LinkedIn **message thread** → Shield analyses the real conversation text in place.

> **Why an extension and not an app:** LinkedIn does not grant third-party API access for reading job listings or messaging — those use cases are structurally declined. The extension is not a product proposal; it is a *rendering* of one, so the design can be evaluated in position on real pages. Every signal the engine actually needs already lives inside LinkedIn and nowhere else, which is the argument for building it natively. See [PROPOSAL.md §6](PROPOSAL.md).

---

## Layout

```
server/engine/   Trust Engine — zero dependencies, zero I/O, 22 tests
server/          REST API, composition layer, repository, seed fixtures
web/             React console — five surfaces
extension/       MV3 extension rendering on live linkedin.com
```

---

*All companies, members, and messages in the prototype are fictional. The fraud demo shows brand impersonation, and doing that against real employers' names would be inappropriate — the mechanism demonstrates identically against invented brands.*
