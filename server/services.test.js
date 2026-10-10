/**
 * VOUCH-2 — tests for the packet-expiry sweep.
 *
 * Unlike the engine tests, this exercises the storage-backed composition
 * layer, so each test resets the seeded database first and cleans up after
 * itself to avoid leaking state into other tests or a running dev server.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { db } from './db.js';
import { sweepExpiredReferrals } from './services.js';

/**
 * Regression test for a real bug found while manually verifying the app:
 * buildSeed() in seed.js returned module-level const arrays by reference, so
 * db.insert()/db.update() permanently mutated the seed template itself.
 * db.reset() (and POST /api/admin/reset, and the UI's "Restore seed data"
 * button) appeared to work but silently kept returning already-polluted data
 * for the rest of that process's lifetime. Fixed with structuredClone() in
 * buildSeed(); this test exists so it cannot regress silently.
 */
test('db.reset() genuinely restores seed state after a write, not just superficially', () => {
  db.reset();
  const before = db.referralRequests().length;

  const referrer = db.people().find((p) => p.type === 'employee');
  db.insert('referralRequests', {
    id: 'rr_regression_check', studentId: 'stu_neil', jobId: 'job_nw_storage', referrerId: referrer.id,
    pitch: 'x'.repeat(50), artifactIds: [], fitScore: 80, status: 'pending',
    createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(),
  });
  assert.equal(db.referralRequests().length, before + 1, 'sanity: the insert actually happened');

  db.reset();
  assert.equal(
    db.referralRequests().length, before,
    'a second reset in the same process must return to the exact original seed count, ' +
    'not a count still inflated by a previous write',
  );
  assert.equal(db.referralRequest('rr_regression_check'), null, 'the inserted record must not survive a reset');
});

test('sweepExpiredReferrals expires a stale pending packet and returns the slot', () => {
  db.reset();

  const referrer = db.people().find((p) => p.type === 'employee');
  const before = referrer.referralsThisMonth ?? 0;

  const record = db.insert('referralRequests', {
    id: 'rr_test_expiring',
    studentId: 'stu_neil',
    jobId: 'job_nw_storage',
    referrerId: referrer.id,
    pitch: 'x'.repeat(50),
    artifactIds: [],
    fitScore: 80,
    status: 'pending',
    createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() - 6 * 86_400_000).toISOString(), // 6 days past TTL
  });
  db.update('people', referrer.id, { referralsThisMonth: before + 1 });

  const expiredIds = sweepExpiredReferrals();

  assert.ok(expiredIds.includes(record.id));
  assert.equal(db.referralRequest(record.id).status, 'expired');
  assert.equal(db.person(referrer.id).referralsThisMonth, before);

  db.reset();
});

test('sweepExpiredReferrals leaves non-expired and non-pending packets untouched', () => {
  db.reset();

  const referrer = db.people().find((p) => p.type === 'employee');

  const notYetDue = db.insert('referralRequests', {
    id: 'rr_test_not_due', studentId: 'stu_neil', jobId: 'job_nw_storage', referrerId: referrer.id,
    pitch: 'x'.repeat(50), artifactIds: [], fitScore: 80, status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(), // in the future
  });

  const alreadyDecided = db.insert('referralRequests', {
    id: 'rr_test_decided', studentId: 'stu_neil', jobId: 'job_nw_storage', referrerId: referrer.id,
    pitch: 'x'.repeat(50), artifactIds: [], fitScore: 80, status: 'referred',
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), // in the past, but not pending
  });

  const expiredIds = sweepExpiredReferrals();

  assert.ok(!expiredIds.includes(notYetDue.id));
  assert.ok(!expiredIds.includes(alreadyDecided.id));
  assert.equal(db.referralRequest(notYetDue.id).status, 'pending');
  assert.equal(db.referralRequest(alreadyDecided.id).status, 'referred');

  db.reset();
});

test('sweepExpiredReferrals is idempotent — a second sweep is a no-op', () => {
  db.reset();
  const referrer = db.people().find((p) => p.type === 'employee');
  db.update('people', referrer.id, { referralsThisMonth: 2 }); // explicit, so the sanity check below can't be seed-order-fragile

  db.insert('referralRequests', {
    id: 'rr_test_idempotent', studentId: 'stu_neil', jobId: 'job_nw_storage', referrerId: referrer.id,
    pitch: 'x'.repeat(50), artifactIds: [], fitScore: 80, status: 'pending',
    createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  });
  const before = db.person(referrer.id).referralsThisMonth ?? 0;

  const first = sweepExpiredReferrals();
  const capacityAfterFirst = db.person(referrer.id).referralsThisMonth ?? 0;
  const second = sweepExpiredReferrals();

  assert.equal(first.length, 1);
  assert.equal(second.length, 0, 'an already-expired packet must not be swept twice');
  assert.equal(db.person(referrer.id).referralsThisMonth, capacityAfterFirst, 'capacity must not be returned a second time');
  assert.notEqual(capacityAfterFirst, before, 'sanity: the first sweep did change capacity');

  db.reset();
});

test('sentReferrals shows a student their own packets without the referrer’s private note', async () => {
  const { sentReferrals } = await import('./services.js');
  db.reset();
  const referrer = db.people().find((p) => p.type === 'employee');

  db.insert('referralRequests', {
    id: 'rr_track_1', studentId: 'stu_neil', jobId: 'job_nw_storage', referrerId: referrer.id,
    pitch: 'x'.repeat(50), artifactIds: [], fitScore: 91, status: 'referred',
    createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(),
    referrerNote: 'PRIVATE — for the hiring team only',
    atsSubmission: { provider: 'Greenhouse', submittedAt: new Date().toISOString(), visibility: 'private_to_hiring_team' },
  });

  const mine = sentReferrals('stu_neil');
  const row = mine.find((r) => r.id === 'rr_track_1');

  assert.ok(row, 'the student sees their own packet');
  assert.equal(row.status, 'referred');
  assert.equal(row.job.company, 'Northwind Systems');
  assert.equal(row.submittedToAts.provider, 'Greenhouse');
  assert.ok(!JSON.stringify(mine).includes('PRIVATE'), 'the referrer note must never reach the student');
  assert.ok(mine.every((r) => r.id !== 'rr_1'), 'another student’s packets are not included');
  assert.equal(sentReferrals('nobody'), null);

  db.reset();
});

test('pilotMetrics measures response rate only over packets whose window has closed', async () => {
  const { pilotMetrics, pilotExportCsv } = await import('./services.js');
  db.reset();
  for (const r of [...db.referralRequests()]) db.update('referralRequests', r.id, { status: 'archived_for_test' });

  const referrer = db.people().find((p) => p.type === 'employee');
  const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const add = (id, status, createdH, decidedH) => db.insert('referralRequests', {
    id, studentId: 'stu_neil', jobId: 'job_nw_storage', referrerId: referrer.id,
    pitch: 'SECRET PITCH TEXT '.repeat(4), artifactIds: [], fitScore: 80, status,
    createdAt: at(createdH), ...(decidedH != null ? { decidedAt: at(decidedH) } : {}),
  });

  add('m1', 'referred', 30, 20);  // 10h to decide
  add('m2', 'declined', 30, 26);  //  4h
  add('m3', 'referred', 30, 28);  //  2h
  add('m4', 'expired', 400, 60);
  add('m5', 'pending', 1, null);

  const m = pilotMetrics();
  assert.equal(m.answered, 3);
  assert.equal(m.expired, 1);
  assert.equal(m.pending, 1);
  assert.equal(m.responseRate, 0.75, '3 answered of 4 closed; the pending packet is not counted against it');
  assert.equal(m.referralRate, 0.667);
  assert.equal(m.medianHoursToDecision, 4);

  const csv = pilotExportCsv();
  assert.ok(csv.startsWith('packet_id,job_id,status'));
  assert.ok(csv.includes('m1,job_nw_storage,referred,80'));
  assert.ok(!csv.includes('SECRET PITCH'), 'the export must not carry pitch text');

  db.reset();
});
