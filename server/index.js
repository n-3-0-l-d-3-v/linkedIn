/**
 * Vouch API.
 *
 * Thin HTTP surface over the Trust Engine. Every endpoint that returns a score
 * also returns the reasoning behind it — that is a product requirement, not a
 * debugging convenience. A trust system users cannot interrogate is one they
 * will learn to click past.
 */

import './env.js'; // VOUCH-5 — must be the first import; see server/env.js

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from './db.js';
import {
  referralPlan, referrerInbox, inbox, assessOne,
  trustDashboard, rankedJobs, jobWithLiveness, credibilityOf,
  sweepExpiredReferrals, sentReferrals, pilotMetrics, pilotExportCsv,
} from './services.js';
import { computeFit, assessMessage, mintHiringToken, verifyHiringToken, SHIELD_PATTERNS } from './engine/index.js';
import {
  withValidation, requireString, optionalString, requireBoolean,
  optionalBoolean, requireOneOf, optionalStringArray, optionalInt, failWith,
} from './validate.js';
import { createLimiter, rateLimitMiddleware } from './rateLimit.js';

const app = express();
const PORT = process.env.PORT ?? 4180;

app.use(cors());
app.use(express.json({ limit: '256kb' }));

/**
 * VOUCH-4 — rate limiting.
 *
 * Two tiers: a generous global budget on every /api request (defends against
 * a scripted crawl or a runaway client), and a stricter budget on the routes
 * that actually mutate shared state — sending a referral, filing a report,
 * scoring an arbitrary message. Those are the ones worth protecting more
 * tightly, since they're the ones a scripted burst could actually damage
 * (referrer capacity, credibility signals, storage growth).
 */
const globalLimiter = createLimiter({ windowMs: 60_000, max: 120 }); // ~2 req/s sustained
const writeLimiter = createLimiter({ windowMs: 60_000, max: 20 });

app.use('/api', rateLimitMiddleware(globalLimiter, { name: 'global' }));
const strict = rateLimitMiddleware(writeLimiter, { name: 'write' });

/**
 * VOUCH-2 — lazy expiry sweep.
 *
 * ARCHITECTURE.md §6 named this gap explicitly: "capacity returns on decline
 * but not on timeout. A packet that is never actioned holds a slot
 * indefinitely." Rather than run a scheduler process for a prototype, the
 * sweep runs cheaply on every request — the dataset is small, the check is a
 * date comparison, and it guarantees expiry is caught before any request that
 * could be affected by stale capacity (sending, browsing office hours, the
 * dashboard). In production this is the Espresso TTL / a scheduled job
 * mentioned in IMPLEMENTATION.md, not a middleware.
 */
app.use((_req, _res, next) => {
  sweepExpiredReferrals();
  next();
});

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, code, message) => res.status(code).json({ ok: false, error: message });

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => ok(res, { status: 'up', at: new Date().toISOString() }));

/**
 * Selector config for the browser extension (IMPLEMENTATION.md Track A).
 *
 * Read fresh off disk on every request rather than cached in memory — the
 * entire point is that an on-call engineer can hand-edit selectors.json to
 * recover from a LinkedIn markup change without redeploying anything, and a
 * process-level cache would defeat that.
 */
const SELECTORS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'selectors.json');
app.get('/api/config/selectors', (_req, res) => {
  try {
    ok(res, JSON.parse(fs.readFileSync(SELECTORS_PATH, 'utf8')));
  } catch (err) {
    fail(res, 500, `selector config unreadable: ${err.message}`);
  }
});

/**
 * Selector-miss telemetry from the extension. No page content is ever
 * accepted here — only which candidate strategies were tried and failed —
 * because this endpoint's whole job is catching drift, not scraping pages.
 */
app.post('/api/telemetry/selector-miss', strict, (req, res) => {
  const { target, pageType, extensionVersion, candidatesTried } = req.body ?? {};
  if (!target) return fail(res, 400, 'target is required');
  db.logEvent('extension.selector_miss', {
    target, pageType: pageType ?? null, extensionVersion: extensionVersion ?? null,
    candidatesTried: Array.isArray(candidatesTried) ? candidatesTried.slice(0, 20) : [],
  });
  ok(res, { recorded: true });
});

app.post('/api/admin/reset', strict, (_req, res) => {
  db.reset();
  ok(res, { reset: true });
});

/** The pattern list, exposed so the proposal can cite the actual rules. */
app.get('/api/shield/patterns', (_req, res) =>
  ok(res, SHIELD_PATTERNS.map(({ id, label, hard, weight, explain }) => ({ id, label, hard, weight, explain }))),
);

app.get('/api/events', (_req, res) => ok(res, db.events().slice(-100).reverse()));

// ---------------------------------------------------------------------------
// People & jobs
// ---------------------------------------------------------------------------

app.get('/api/people', (_req, res) =>
  ok(res, db.people().map((p) => ({ id: p.id, type: p.type, name: p.name, headline: p.headline, companyId: p.companyId ?? null }))),
);

app.get('/api/people/:id', (req, res) => {
  const person = db.person(req.params.id);
  if (!person) return fail(res, 404, 'person not found');
  const extra = person.type === 'employee' ? { credibility: credibilityOf(person.id) } : {};
  ok(res, { ...person, ...extra });
});

app.get('/api/companies', (_req, res) => ok(res, db.companies()));

app.get('/api/jobs', (_req, res) => ok(res, rankedJobs()));

app.get('/api/jobs/:id', (req, res) => {
  const job = db.job(req.params.id);
  if (!job) return fail(res, 404, 'job not found');
  ok(res, jobWithLiveness(job));
});

// ---------------------------------------------------------------------------
// Referral bridge
// ---------------------------------------------------------------------------

/** The main student read: fit, proof to attach, and who to ask. */
app.get('/api/referral-plan', (req, res) => {
  const { studentId, jobId } = req.query;
  if (!studentId || !jobId) return fail(res, 400, 'studentId and jobId are required');
  const plan = referralPlan(studentId, jobId);
  if (!plan) return fail(res, 404, 'student or job not found');
  ok(res, plan);
});

/**
 * Send a referral packet.
 *
 * Two server-side gates that the UI also enforces, because a client-side-only
 * throttle is not a throttle:
 *   - a fit blocker (e.g. asking two levels up) refuses the send
 *   - a referrer with no capacity left cannot be assigned
 */
app.post('/api/referrals', strict, withValidation((req, res) => {
  const body = req.body ?? {};
  const studentId = requireString(body.studentId, 'studentId');
  const jobId = requireString(body.jobId, 'jobId');
  const referrerId = requireString(body.referrerId, 'referrerId');
  const pitchRaw = requireString(body.pitch, 'pitch', { minLength: 0, maxLength: 4000 });
  if (pitchRaw.length < 40) {
    failWith('A referral packet needs a pitch of at least 40 characters. Templated one-liners are what made the current feature ignorable.');
  }
  const pitch = pitchRaw;
  const artifactIds = optionalStringArray(body.artifactIds, 'artifactIds');

  const student = db.person(studentId);
  const job = db.job(jobId);
  const referrer = db.person(referrerId);
  if (!student || !job || !referrer) return fail(res, 400, 'unknown student, job, or referrer');

  const fit = computeFit(student, job);
  if (fit.blockers.length > 0) {
    return fail(res, 422, `This ask is blocked: ${fit.blockers[0].message} ${fit.blockers[0].fix}`);
  }

  const remaining = (referrer.monthlyReferralCapacity ?? 0) - (referrer.referralsThisMonth ?? 0);
  if (remaining <= 0) {
    return fail(res, 409, `${referrer.name} has no referral capacity left this cycle. Pick another reviewer — rationing is what keeps this channel worth reading.`);
  }

  const PACKET_TTL_DAYS = 14;
  const now = new Date();
  const record = {
    id: `rr_${Date.now().toString(36)}`,
    studentId, jobId, referrerId,
    pitch: pitch.trim(),
    artifactIds,
    fitScore: fit.score,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PACKET_TTL_DAYS * 86_400_000).toISOString(),
  };

  db.insert('referralRequests', record);
  db.update('people', referrerId, { referralsThisMonth: (referrer.referralsThisMonth ?? 0) + 1 });
  db.logEvent('referral.sent', { requestId: record.id, studentId, jobId, referrerId, fitScore: fit.score });

  ok(res, record);
}));

/** A student's own sent packets and where each one stands. */
app.get('/api/referrals/sent/:studentId', (req, res) => {
  const data = sentReferrals(req.params.studentId);
  if (!data) return fail(res, 404, 'student not found');
  ok(res, data);
});

app.get('/api/referrals/inbox/:employeeId', (req, res) => {
  const data = referrerInbox(req.params.employeeId);
  if (!data) return fail(res, 404, 'employee not found');
  ok(res, data);
});

/**
 * Referrer decision. `refer` is private by design — it writes into the hiring
 * pipeline, never onto the referrer's feed. Public vouching is the social risk
 * that makes employees decline people they would privately support.
 */
app.post('/api/referrals/:id/decision', strict, withValidation((req, res) => {
  const body = req.body ?? {};
  const action = requireOneOf(body.action, ['refer', 'decline', 'request_info'], 'action');
  const note = optionalString(body.note, 'note', { maxLength: 2000 });

  const request = db.referralRequest(req.params.id);
  if (!request) return fail(res, 404, 'referral request not found');
  if (request.status !== 'pending') {
    return fail(res, 409, `This packet is already ${request.status} — a decision can only be made once.`);
  }

  const statusMap = { refer: 'referred', decline: 'declined', request_info: 'info_requested' };
  const patch = {
    status: statusMap[action],
    decidedAt: new Date().toISOString(),
    referrerNote: note ?? null,
    ...(action === 'refer'
      ? { atsSubmission: { submittedAt: new Date().toISOString(), provider: db.company(db.job(request.jobId)?.companyId)?.atsProvider ?? 'ATS', visibility: 'private_to_hiring_team' } }
      : {}),
  };

  const updated = db.update('referralRequests', request.id, patch);

  // Declining returns the slot — capacity should measure attention actually
  // spent, and a decline costs a minute, not a referral.
  if (action === 'decline') {
    const referrer = db.person(request.referrerId);
    db.update('people', request.referrerId, {
      referralsThisMonth: Math.max(0, (referrer?.referralsThisMonth ?? 1) - 1),
    });
  }

  db.logEvent('referral.decision', { requestId: request.id, action });
  ok(res, updated);
}));

/**
 * Referral Office Hours toggle — flips supply from reactive to discoverable.
 *
 * Every field is optional (a caller may update just the note, or just
 * capacity), but a field that IS present must be the right type — and
 * critically, `open` is only written when explicitly provided. The previous
 * `officeHoursOpen: !!open` both accepted truthy strings like "no" as true,
 * and silently closed office hours on any partial update that omitted `open`
 * entirely. Neither is acceptable for a field other clients (the extension,
 * a future mobile client) will eventually call with partial bodies.
 */
app.post('/api/office-hours/:employeeId', strict, withValidation((req, res) => {
  const body = req.body ?? {};
  const open = optionalBoolean(body.open, 'open');
  const note = optionalString(body.note, 'note', { maxLength: 500 });
  const capacity = optionalInt(body.capacity, 'capacity', { min: 0, max: 50 });

  const employee = db.person(req.params.employeeId);
  if (!employee) return fail(res, 404, 'employee not found');

  const updated = db.update('people', employee.id, {
    ...(open !== undefined ? { officeHoursOpen: open } : {}),
    ...(note !== null ? { officeHoursNote: note } : {}),
    ...(capacity !== undefined ? { monthlyReferralCapacity: capacity } : {}),
  });
  db.logEvent('officehours.updated', { employeeId: employee.id, open: open ?? employee.officeHoursOpen });
  ok(res, updated);
}));

app.get('/api/office-hours', (_req, res) => {
  const open = db
    .people()
    .filter((p) => p.type === 'employee' && p.officeHoursOpen)
    .map((e) => ({
      id: e.id, name: e.name, title: e.title, team: e.team, headline: e.headline,
      companyId: e.companyId, company: db.company(e.companyId)?.name,
      note: e.officeHoursNote,
      slotsLeft: Math.max(0, (e.monthlyReferralCapacity ?? 0) - (e.referralsThisMonth ?? 0)),
      credibility: credibilityOf(e.id),
    }));
  ok(res, open);
});

// ---------------------------------------------------------------------------
// Shield
// ---------------------------------------------------------------------------

app.get('/api/shield/inbox/:recipientId', (req, res) => ok(res, inbox(req.params.recipientId)));

app.get('/api/shield/message/:id', (req, res) => {
  const message = db.message(req.params.id);
  if (!message) return fail(res, 404, 'message not found');
  ok(res, assessOne(message));
});

/**
 * Ad-hoc assessment. This is the endpoint the browser extension calls with
 * text scraped from a live LinkedIn thread, and the one to use when demoing
 * "paste any suspicious message and watch it get scored."
 */
app.post('/api/shield/assess', strict, (req, res) => {
  const { body, senderId, hiringToken, sender: senderOverride } = req.body ?? {};
  if (typeof body !== 'string' || !body.trim()) return fail(res, 400, 'body is required');

  const stored = senderId ? db.person(senderId) : null;
  const sender = { ...(stored ?? {}), ...(senderOverride ?? {}) };

  const assessment = assessMessage(
    { body, hiringToken },
    sender,
    {
      officialDomains: db.companies().flatMap((c) => c.domains),
      verifyToken: (t) => verifyHiringToken(t),
    },
  );

  db.logEvent('shield.assessed', { risk: assessment.risk, band: assessment.band, source: senderOverride ? 'extension' : 'app' });
  ok(res, assessment);
});

/** Report an account. Reports feed provenance risk for every future recipient. */
app.post('/api/shield/report', strict, withValidation((req, res) => {
  const body = req.body ?? {};
  const messageId = requireString(body.messageId, 'messageId');
  const reporterId = optionalString(body.reporterId, 'reporterId');
  const reason = optionalString(body.reason, 'reason', { maxLength: 500 });

  const message = db.message(messageId);
  if (!message) return fail(res, 404, 'message not found');

  const sender = db.person(message.senderId);
  if (sender) db.update('people', sender.id, { reportCount: (sender.reportCount ?? 0) + 1 });

  const report = {
    id: `rep_${Date.now().toString(36)}`,
    messageId, reporterId: reporterId ?? null, senderId: message.senderId,
    reason: reason ?? 'suspected_recruitment_fraud',
    createdAt: new Date().toISOString(),
  };
  db.insert('reports', report);
  db.logEvent('shield.reported', { messageId, senderId: message.senderId, reason: report.reason });
  ok(res, report);
}));

/**
 * Warning interaction telemetry. Whether students heed or bypass a warning is
 * the metric that tells you if the intervention works — and the one that
 * catches a classifier quietly drifting into false positives.
 */
app.post('/api/shield/interaction', strict, (req, res) => {
  const { messageId, action } = req.body ?? {};
  db.logEvent('shield.interaction', { messageId, action });
  ok(res, { recorded: true });
});

// ---------------------------------------------------------------------------
// Verified Hiring Channel
// ---------------------------------------------------------------------------

app.post('/api/tokens/mint', strict, (req, res) => {
  const { jobId, recruiterId } = req.body ?? {};
  const job = db.job(jobId);
  if (!job) return fail(res, 404, 'job not found');
  const company = db.company(job.companyId);
  const token = mintHiringToken({ jobId: job.id, companyId: company?.name ?? job.companyId, recruiterId: recruiterId ?? job.recruiterId });
  ok(res, { token, jobId: job.id, company: company?.name });
});

app.post('/api/tokens/verify', strict, (req, res) => ok(res, verifyHiringToken(req.body?.token)));

// ---------------------------------------------------------------------------
// Employer dashboard
// ---------------------------------------------------------------------------

app.get('/api/dashboard/:companyId', (req, res) => {
  const data = trustDashboard(req.params.companyId);
  if (!data) return fail(res, 404, 'company not found');
  ok(res, data);
});

// ---------------------------------------------------------------------------
// Pilot metrics
// ---------------------------------------------------------------------------

app.get('/api/pilot/metrics', (_req, res) => ok(res, pilotMetrics()));

app.get('/api/pilot/export.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="vouch-pilot.csv"');
  res.send(pilotExportCsv());
});

app.use((err, _req, res, _next) => {
  console.error(err);
  fail(res, 500, err.message ?? 'internal error');
});

app.listen(PORT, () => {
  console.log(`Vouch API listening on http://localhost:${PORT}`);
});
