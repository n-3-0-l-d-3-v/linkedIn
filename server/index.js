/**
 * Vouch API.
 *
 * Thin HTTP surface over the Trust Engine. Every endpoint that returns a score
 * also returns the reasoning behind it — that is a product requirement, not a
 * debugging convenience. A trust system users cannot interrogate is one they
 * will learn to click past.
 */

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from './db.js';
import {
  referralPlan, referrerInbox, inbox, assessOne,
  trustDashboard, rankedJobs, jobWithLiveness, credibilityOf,
} from './services.js';
import { computeFit, assessMessage, mintHiringToken, verifyHiringToken, SHIELD_PATTERNS } from './engine/index.js';

const app = express();
const PORT = process.env.PORT ?? 4180;

app.use(cors());
app.use(express.json({ limit: '256kb' }));

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
app.post('/api/telemetry/selector-miss', (req, res) => {
  const { target, pageType, extensionVersion, candidatesTried } = req.body ?? {};
  if (!target) return fail(res, 400, 'target is required');
  db.logEvent('extension.selector_miss', {
    target, pageType: pageType ?? null, extensionVersion: extensionVersion ?? null,
    candidatesTried: Array.isArray(candidatesTried) ? candidatesTried.slice(0, 20) : [],
  });
  ok(res, { recorded: true });
});

app.post('/api/admin/reset', (_req, res) => {
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
app.post('/api/referrals', (req, res) => {
  const { studentId, jobId, referrerId, pitch, artifactIds = [] } = req.body ?? {};
  const student = db.person(studentId);
  const job = db.job(jobId);
  const referrer = db.person(referrerId);

  if (!student || !job || !referrer) return fail(res, 400, 'unknown student, job, or referrer');
  if (!pitch || pitch.trim().length < 40) {
    return fail(res, 422, 'A referral packet needs a pitch of at least 40 characters. Templated one-liners are what made the current feature ignorable.');
  }

  const fit = computeFit(student, job);
  if (fit.blockers.length > 0) {
    return fail(res, 422, `This ask is blocked: ${fit.blockers[0].message} ${fit.blockers[0].fix}`);
  }

  const remaining = (referrer.monthlyReferralCapacity ?? 0) - (referrer.referralsThisMonth ?? 0);
  if (remaining <= 0) {
    return fail(res, 409, `${referrer.name} has no referral capacity left this cycle. Pick another reviewer — rationing is what keeps this channel worth reading.`);
  }

  const record = {
    id: `rr_${Date.now().toString(36)}`,
    studentId, jobId, referrerId,
    pitch: pitch.trim(),
    artifactIds,
    fitScore: fit.score,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  db.insert('referralRequests', record);
  db.update('people', referrerId, { referralsThisMonth: (referrer.referralsThisMonth ?? 0) + 1 });
  db.logEvent('referral.sent', { requestId: record.id, studentId, jobId, referrerId, fitScore: fit.score });

  ok(res, record);
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
app.post('/api/referrals/:id/decision', (req, res) => {
  const { action, note } = req.body ?? {};
  const request = db.referralRequest(req.params.id);
  if (!request) return fail(res, 404, 'referral request not found');
  if (!['refer', 'decline', 'request_info'].includes(action)) return fail(res, 400, 'unknown action');

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
});

/** Referral Office Hours toggle — flips supply from reactive to discoverable. */
app.post('/api/office-hours/:employeeId', (req, res) => {
  const { open, note, capacity } = req.body ?? {};
  const employee = db.person(req.params.employeeId);
  if (!employee) return fail(res, 404, 'employee not found');
  const updated = db.update('people', employee.id, {
    officeHoursOpen: !!open,
    officeHoursNote: note ?? employee.officeHoursNote ?? null,
    ...(Number.isInteger(capacity) ? { monthlyReferralCapacity: capacity } : {}),
  });
  db.logEvent('officehours.updated', { employeeId: employee.id, open: !!open });
  ok(res, updated);
});

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
app.post('/api/shield/assess', (req, res) => {
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
app.post('/api/shield/report', (req, res) => {
  const { messageId, reporterId, reason } = req.body ?? {};
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
});

/**
 * Warning interaction telemetry. Whether students heed or bypass a warning is
 * the metric that tells you if the intervention works — and the one that
 * catches a classifier quietly drifting into false positives.
 */
app.post('/api/shield/interaction', (req, res) => {
  const { messageId, action } = req.body ?? {};
  db.logEvent('shield.interaction', { messageId, action });
  ok(res, { recorded: true });
});

// ---------------------------------------------------------------------------
// Verified Hiring Channel
// ---------------------------------------------------------------------------

app.post('/api/tokens/mint', (req, res) => {
  const { jobId, recruiterId } = req.body ?? {};
  const job = db.job(jobId);
  if (!job) return fail(res, 404, 'job not found');
  const company = db.company(job.companyId);
  const token = mintHiringToken({ jobId: job.id, companyId: company?.name ?? job.companyId, recruiterId: recruiterId ?? job.recruiterId });
  ok(res, { token, jobId: job.id, company: company?.name });
});

app.post('/api/tokens/verify', (req, res) => ok(res, verifyHiringToken(req.body?.token)));

// ---------------------------------------------------------------------------
// Employer dashboard
// ---------------------------------------------------------------------------

app.get('/api/dashboard/:companyId', (req, res) => {
  const data = trustDashboard(req.params.companyId);
  if (!data) return fail(res, 404, 'company not found');
  ok(res, data);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  fail(res, 500, err.message ?? 'internal error');
});

app.listen(PORT, () => {
  console.log(`Vouch API listening on http://localhost:${PORT}`);
});
