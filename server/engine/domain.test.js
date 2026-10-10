/**
 * Domain-impersonation cases, kept separate because this is the detector most
 * likely to be argued about in a review — both directions of error are costly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { domainRisk } from './shield.js';

const OFFICIAL = ['northwind.com', 'careers.northwind.com', 'meridian-analytics.com', 'kestrellabs.io'];
const verdictFor = (d) => domainRisk([d], OFFICIAL)[0].verdict;

test('official domains and their subdomains are clean', () => {
  assert.equal(verdictFor('northwind.com'), 'official');
  assert.equal(verdictFor('careers.northwind.com'), 'official');
  assert.equal(verdictFor('jobs.meridian-analytics.com'), 'official');
});

test('homoglyph swaps are caught', () => {
  assert.equal(verdictFor('n0rthwind.com'), 'lookalike');
});

test('brand embedded in an unowned domain is caught', () => {
  assert.equal(verdictFor('n0rthwind-careers.com'), 'lookalike');
  assert.equal(verdictFor('northwind-hr.net'), 'lookalike');
  assert.equal(verdictFor('meridian-analytics-recruitment.co'), 'lookalike');
});

test('unrelated domains are not flagged as impersonation', () => {
  assert.equal(verdictFor('github.com'), 'unrecognised');
  assert.equal(verdictFor('linkedin.com'), 'unrecognised');
  assert.equal(verdictFor('gmail.com'), 'free_provider');
});

test('disposable TLDs are flagged even without a brand match', () => {
  assert.equal(verdictFor('kestrel-internships.tk'), 'high_risk_tld');
});

test('an email address yields its domain, never its local part', async () => {
  const { extractDomains } = await import('./util.js');
  assert.deepEqual(extractDomains('write to priya.recruits@gmail.com today'), ['gmail.com']);
  assert.deepEqual(
    extractDomains('mail hr@northwind.com or see careers.northwind.com/apply').sort(),
    ['careers.northwind.com', 'northwind.com'],
  );
});

test('a free mail provider is reported but adds no domain risk of its own', () => {
  const [finding] = domainRisk(['gmail.com'], OFFICIAL);
  assert.equal(finding.verdict, 'free_provider');
  assert.equal(finding.risk, 0);
});
