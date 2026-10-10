import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './rateLimit.js';

test('allows requests under the limit and blocks over it', () => {
  let now = 0;
  const limiter = createLimiter({ windowMs: 1000, max: 3, clock: () => now });

  assert.equal(limiter.allow('a').allowed, true);
  assert.equal(limiter.allow('a').allowed, true);
  assert.equal(limiter.allow('a').allowed, true);
  assert.equal(limiter.allow('a').allowed, false, '4th request in the window must be blocked');
});

test('keys are independent — one client cannot exhaust another’s budget', () => {
  let now = 0;
  const limiter = createLimiter({ windowMs: 1000, max: 1, clock: () => now });

  assert.equal(limiter.allow('a').allowed, true);
  assert.equal(limiter.allow('a').allowed, false);
  assert.equal(limiter.allow('b').allowed, true, 'a different key must have its own budget');
});

test('the window resets after it elapses', () => {
  let now = 0;
  const limiter = createLimiter({ windowMs: 1000, max: 1, clock: () => now });

  assert.equal(limiter.allow('a').allowed, true);
  assert.equal(limiter.allow('a').allowed, false);

  now = 1001; // past the window
  assert.equal(limiter.allow('a').allowed, true, 'a new window must grant a fresh budget');
});

test('remaining count decrements correctly and never goes negative', () => {
  let now = 0;
  const limiter = createLimiter({ windowMs: 1000, max: 2, clock: () => now });

  assert.equal(limiter.allow('a').remaining, 1);
  assert.equal(limiter.allow('a').remaining, 0);
  assert.equal(limiter.allow('a').remaining, 0, 'remaining must floor at 0, not go negative');
});

test('sweep bounds memory — expired entries are eventually reclaimed', () => {
  let now = 0;
  const limiter = createLimiter({ windowMs: 10, max: 1, clock: () => now });

  for (let i = 0; i < 10_001; i++) limiter.allow(`client-${i}`);
  assert.ok(limiter.size() > 10_000, 'sanity: many distinct keys were recorded');

  now = 10_000; // well past every entry's window
  limiter.allow('trigger-sweep'); // size() > 10_000 triggers the sweep on this call
  assert.ok(limiter.size() < 10_001, 'expired entries must be reclaimed rather than growing forever');
});
