/**
 * Engine tests — run with `npm test` (node:test, no framework needed).
 *
 * These are the assertions worth defending in a design review: that the
 * scoring cannot be gamed in the obvious ways, and that the anti-fraud hard
 * rules cannot be diluted by piling on reassuring signals.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFit, selectPassportArtifacts } from './fit.js';
import { computeCredibility } from './credibility.js';
import { buildGraph, findPaths } from './warmpath.js';
import { rankReferrers } from './match.js';
import { assessMessage } from './shield.js';
import { mintHiringToken, verifyHiringToken } from './tokens.js';
import { computeLiveness } from './liveness.js';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

test('fit: proven skills beat merely claimed skills', () => {
  const role = { requiredSkills: ['react', 'typescript'], preferredSkills: [], level: 'intern', domain: 'computer science' };
  const claimer = { skills: ['react', 'typescript'], level: 'intern', fieldsOfStudy: ['computer science'], artifacts: [] };
  const prover = {
    ...claimer,
    artifacts: [
      { id: 'a1', title: 'Course scheduler', type: 'open_source', verified: true, date: daysAgo(90), skills: ['react', 'typescript'] },
    ],
  };

  const weak = computeFit(claimer, role);
  const strong = computeFit(prover, role);

  assert.ok(strong.score > weak.score, 'evidence must raise the score');
  assert.ok(weak.gaps.length > 0, 'unproven claims must surface as gaps');
});

test('fit: a two-level-up ask is discouraged', () => {
  const role = { requiredSkills: ['go'], preferredSkills: [], level: 'senior', domain: 'computer science' };
  const student = { skills: ['go'], level: 'intern', fieldsOfStudy: ['computer science'], artifacts: [] };
  const result = computeFit(student, role);
  assert.equal(result.sendRecommended, false);
  assert.ok(result.gaps.some((g) => g.severity === 'high'));
});

test('passport: attaches only artifacts relevant to this role', () => {
  const student = {
    artifacts: [
      { id: 'a1', title: 'ML paper', type: 'competition_result', verified: true, date: daysAgo(30), skills: ['machine learning'] },
      { id: 'a2', title: 'Payments API', type: 'open_source', verified: true, date: daysAgo(30), skills: ['go', 'postgresql'] },
    ],
  };
  const picked = selectPassportArtifacts(student, { requiredSkills: ['go'], preferredSkills: ['postgresql'] });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].id, 'a2');
});

// ---------------------------------------------------------------------------
// Credibility
// ---------------------------------------------------------------------------

test('credibility: a small perfect record does not outrank a large strong one', () => {
  const tiny = computeCredibility([
    { outcome: 'hired', createdAt: daysAgo(30), decidedAt: daysAgo(20) },
    { outcome: 'hired', createdAt: daysAgo(40), decidedAt: daysAgo(30) },
  ]);
  const big = computeCredibility(
    Array.from({ length: 40 }, (_, i) => ({
      outcome: i < 33 ? 'interviewed' : 'screened_out',
      createdAt: daysAgo(200 - i),
      decidedAt: daysAgo(190 - i),
    })),
  );
  assert.ok(big.score > tiny.score, 'Wilson bound must reward sample size');
  assert.equal(tiny.tier, 'establishing');
});

test('credibility: spam reports outweigh good outcomes', () => {
  const history = Array.from({ length: 20 }, () => ({ outcome: 'interviewed', createdAt: daysAgo(60), decidedAt: daysAgo(50) }));
  const clean = computeCredibility(history);
  const spammy = computeCredibility(history, { spamReports: 4 });
  assert.ok(spammy.score < clean.score - 20);
});

// ---------------------------------------------------------------------------
// Warm paths + routing
// ---------------------------------------------------------------------------

test('warmpath: finds a 2-hop route through a shared lab', () => {
  const adj = buildGraph([
    { a: 'student', b: 'peer', type: 'research_lab', context: 'Systems Lab', verified: true },
    { a: 'peer', b: 'engineer', type: 'prior_colleague', context: 'Zoho', verified: true },
  ]);
  const paths = findPaths(adj, 'student');
  assert.ok(paths.has('engineer'));
  assert.equal(paths.get('engineer').path.length, 2);
});

test('match: an on-req engineer with capacity outranks a random employee', () => {
  const job = { companyId: 'c1', teamId: 't1', orgId: 'o1', discipline: 'swe', hiringTeamIds: ['e1'] };
  const employees = [
    {
      id: 'e1', name: 'On Req', companyId: 'c1', teamId: 't1', orgId: 'o1', discipline: 'swe',
      replyRate: 0.7, lastActiveAt: daysAgo(1), monthlyReferralCapacity: 3, referralsThisMonth: 0,
    },
    {
      id: 'e2', name: 'Unrelated', companyId: 'c1', teamId: 't9', orgId: 'o9', discipline: 'sales',
      replyRate: 0.9, lastActiveAt: daysAgo(1), monthlyReferralCapacity: 3, referralsThisMonth: 0,
    },
  ];
  const ranked = rankReferrers({ employees, job, paths: new Map(), credOf: () => null, nameOf: (id) => id });
  assert.equal(ranked[0].employeeId, 'e1');
});

test('match: an employee at full capacity is marked unavailable', () => {
  const job = { companyId: 'c1', teamId: 't1', hiringTeamIds: [] };
  const employees = [{
    id: 'e1', name: 'Maxed', companyId: 'c1', teamId: 't1',
    replyRate: 0.9, lastActiveAt: daysAgo(1), monthlyReferralCapacity: 2, referralsThisMonth: 2,
  }];
  const [top] = rankReferrers({ employees, job, paths: new Map(), credOf: () => null, nameOf: (id) => id });
  assert.equal(top.available, false);
});

// ---------------------------------------------------------------------------
// Shield — the assertions that matter most
// ---------------------------------------------------------------------------

const trustedSender = {
  createdAt: daysAgo(2000), identityVerified: true, workplaceVerified: true,
  claimedCompany: 'Infosys', verifiedCompany: 'Infosys', connections: 900, mutualConnections: 12, reportCount: 0,
};

test('shield: a money request is high risk even from an otherwise perfect sender', () => {
  const res = assessMessage(
    { body: 'Congratulations! Please pay a refundable security deposit of Rs 4,500 to confirm your onboarding.' },
    trustedSender,
    { officialDomains: ['infosys.com'], verifyToken: () => ({ valid: false, reason: 'none' }) },
  );
  assert.equal(res.band, 'high');
  assert.equal(res.action.level, 'block_send');
  assert.ok(res.hardTriggered);
});

test('shield: lookalike domain is caught after homoglyph folding', () => {
  const res = assessMessage(
    { body: 'Apply at careers.arnazon.com today' },
    trustedSender,
    { officialDomains: ['amazon.com'], verifyToken: () => ({ valid: false, reason: 'none' }) },
  );
  assert.ok(res.signals.domains.some((d) => d.verdict === 'lookalike'));
  assert.equal(res.band, 'high');
});

test('shield: a legitimate token-bound message stays clear', () => {
  const token = mintHiringToken({ jobId: 'j1', companyId: 'Infosys', recruiterId: 'r1' });
  const res = assessMessage(
    {
      body: 'Hi Neil — I saw your distributed systems project. We have an SDE intern requisition open; would you be open to a 30-minute chat this week?',
      hiringToken: token,
    },
    trustedSender,
    { officialDomains: ['infosys.com'], verifyToken: (t) => verifyHiringToken(t) },
  );
  assert.ok(res.risk < 20, `expected low risk, got ${res.risk}`);
  assert.equal(res.action.level, 'none');
});

test('shield: claimed employer vs verified workplace mismatch is caught', () => {
  const res = assessMessage(
    { body: 'Hello, we are hiring for a role at our firm.' },
    { ...trustedSender, claimedCompany: 'Google', verifiedCompany: 'A Small Agency' },
    { officialDomains: ['google.com'], verifyToken: () => ({ valid: false, reason: 'none' }) },
  );
  assert.ok(res.signals.mismatch.length > 0);
  assert.equal(res.band, 'high');
});

test('shield: weak signals alone cannot reach the top band', () => {
  const res = assessMessage(
    { body: 'Dear Candidate, greetings of the day.' },
    trustedSender,
    { officialDomains: ['infosys.com'], verifyToken: () => ({ valid: false, reason: 'none' }) },
  );
  assert.ok(res.band !== 'high');
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test('tokens: tampering invalidates the signature', () => {
  const token = mintHiringToken({ jobId: 'j1', companyId: 'c1', recruiterId: 'r1' });
  const [payload, sig] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ jobId: 'evil', exp: Date.now() + 1e6 })).toString('base64url')}.${sig}`;
  assert.equal(verifyHiringToken(forged).valid, false);
  assert.equal(verifyHiringToken(token).valid, true);
});

test('tokens: expiry is enforced', () => {
  const token = mintHiringToken({ jobId: 'j1', companyId: 'c1', recruiterId: 'r1', ttlDays: -1 });
  const res = verifyHiringToken(token);
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'expired requisition');
});

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

test('liveness: a stale ghost job is demoted but never removed', () => {
  const res = computeLiveness({
    postedAt: daysAgo(120), recruiterLastActiveAt: daysAgo(70),
    applicantCount: 400, applicantsMovedCount: 2, atsSynced: true, atsReqOpen: false, repostCount: 3,
  });
  assert.equal(res.band, 'stale');
  assert.ok(res.rankingMultiplier > 0, 'demotion, not deletion');
  assert.ok(res.notes.length >= 3);
});

test('liveness: a healthy posting scores active', () => {
  const res = computeLiveness({
    postedAt: daysAgo(6), recruiterLastActiveAt: daysAgo(1),
    applicantCount: 80, applicantsMovedCount: 22, atsSynced: true, atsReqOpen: true, repostCount: 0,
  });
  assert.equal(res.band, 'active');
});

// ---------------------------------------------------------------------------
// Shield — unknown sender data (found by the VOUCH-10 evaluation harness)
// ---------------------------------------------------------------------------

test('shield: an ordinary message from a sender we know nothing about is not flagged', () => {
  const res = assessMessage(
    { body: 'Hi Neil, we have an intern opening on our storage team. Would you be open to a 30 minute call this week?' },
    {}, // no sender data at all — the browser extension's situation
    { officialDomains: ['northwind.com'], verifyToken: () => ({ valid: false, reason: 'none' }) },
  );
  assert.ok(res.band === 'clear' || res.band === 'low', `expected no warning, got ${res.band} (${res.risk})`);
  assert.equal(res.breakdown.provenance, 0, 'unknown provenance must add no risk');
});

test('shield: an explicitly unverified sender still scores as risky', () => {
  const res = assessMessage(
    { body: 'Hi, we have an opening. Are you interested?' },
    { identityVerified: false, workplaceVerified: false, connections: 4, createdAt: daysAgo(3) },
    { officialDomains: ['northwind.com'], verifyToken: () => ({ valid: false, reason: 'none' }) },
  );
  assert.ok(res.breakdown.provenance >= 60, 'known-bad provenance must keep its full weight');
});

// ---------------------------------------------------------------------------
// Shield — the money rule and disclaimers
// ---------------------------------------------------------------------------

const noToken = { officialDomains: ['northwind.com'], verifyToken: () => ({ valid: false, reason: 'none' }) };
const firedMoneyRule = (body) =>
  assessMessage({ body }, {}, noToken).signals.content.some((s) => s.id === 'payment_request');

test('shield: an employer saying candidates never pay does not trip the money rule', () => {
  assert.equal(firedMoneyRule('We never charge candidates any registration fee, at any stage.'), false);
  assert.equal(firedMoneyRule('There is no application fee and you do not need an agent.'), false);
  assert.equal(firedMoneyRule('We cover the background verification fee, so there is nothing for you to pay.'), false);
});

test('shield: a disclaimer cannot be used to smuggle a real fee demand past the money rule', () => {
  assert.equal(
    firedMoneyRule('We never ask for a registration fee. However a refundable deposit of Rs 2,000 is required to confirm.'),
    true,
    'the second, undisclaimed mention must still fire',
  );
  assert.equal(firedMoneyRule('No interview is needed. The registration fee is Rs 999.'), true);
  assert.equal(firedMoneyRule('Pay the training fee now, it will be refunded after joining.'), true);
});
