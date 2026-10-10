/**
 * Regression floor for Shield on the bundled starter set.
 *
 * This is a tripwire, not a benchmark. The rules were tuned while looking at
 * this same set, so the numbers here overstate real-world accuracy; what the
 * test protects is that a future rule change cannot quietly make things
 * worse on cases already understood. Real accuracy has to be measured on
 * messages the rules have never seen (see README, "Measuring Shield").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluate } from '../../scripts/eval-shield.mjs';
import { buildSeed } from '../seed.js';

const set = JSON.parse(fs.readFileSync(new URL('./shield-eval.json', import.meta.url), 'utf8'));
const officialDomains = buildSeed().companies.flatMap((c) => c.domains);
const result = evaluate(set.items, { officialDomains });

test('shield eval: no legitimate message has its content hidden', () => {
  const hidden = result.rows.filter((r) => r.label === 'legit' && r.blocked).map((r) => r.id);
  assert.deepEqual(hidden, [], 'hiding a real recruiter costs someone a real opportunity');
});

test('shield eval: warnings stay precise', () => {
  assert.ok(result.flagged.precision >= 0.9, `flagged precision fell to ${result.flagged.precision}`);
});

test('shield eval: most fraud is still caught', () => {
  assert.ok(result.flagged.recall >= 0.85, `flagged recall fell to ${result.flagged.recall}`);
});

test('shield eval: the set stays balanced enough to mean something', () => {
  const fraud = result.rows.filter((r) => r.label === 'fraud').length;
  const legit = result.rows.length - fraud;
  assert.ok(fraud >= 10 && legit >= 10);
});
