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
