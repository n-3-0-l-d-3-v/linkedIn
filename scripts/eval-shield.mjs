/**
 * VOUCH-10 — Shield evaluation harness.
 *
 * Runs every labelled message in an evaluation set through the Shield engine
 * and reports precision and recall, plus every message it got wrong and why.
 *
 *   npm run eval:shield                     the bundled starter set
 *   npm run eval:shield -- path/to/set.json your own (e.g. real pilot data)
 *
 * Messages are scored on content alone, with no sender information. That is
 * the hardest setting and the one the browser extension actually runs in; the
 * native version, which knows who the sender is, can only do better.
 *
 * Two thresholds are reported because they mean different things to a user:
 *   flagged  = any warning shown        (band "caution" or "high")
 *   blocked  = content hidden by default (band "high")
 * A wrong "blocked" on a real recruiter costs far more than a wrong "flagged".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessMessage } from '../server/engine/shield.js';
import { buildSeed } from '../server/seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SET = path.join(root, 'server', 'eval', 'shield-eval.json');

export function evaluate(items, { officialDomains }) {
  const rows = items.map((item) => {
    const a = assessMessage({ body: item.body }, item.sender ?? {}, {
      officialDomains,
      verifyToken: () => ({ valid: false, reason: 'none' }),
    });
    return {
      ...item,
      risk: a.risk,
      band: a.band,
      flagged: a.band === 'caution' || a.band === 'high',
      blocked: a.band === 'high',
      signals: [...a.signals.content.map((s) => s.id), ...a.signals.domains.filter((d) => d.risk > 0).map((d) => d.verdict)],
    };
  });

  const score = (key) => {
    const tp = rows.filter((r) => r.label === 'fraud' && r[key]).length;
    const fp = rows.filter((r) => r.label === 'legit' && r[key]).length;
    const fn = rows.filter((r) => r.label === 'fraud' && !r[key]).length;
    return {
      tp, fp, fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    };
  };

  return { rows, flagged: score('flagged'), blocked: score('blocked') };
}

const pctText = (v) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SET;
  const set = JSON.parse(fs.readFileSync(file, 'utf8'));
  const officialDomains = buildSeed().companies.flatMap((c) => c.domains);
  const { rows, flagged, blocked } = evaluate(set.items, { officialDomains });

  const fraud = rows.filter((r) => r.label === 'fraud').length;
  console.log(`Shield evaluation — ${path.relative(root, file)}`);
  console.log(`${rows.length} messages: ${fraud} fraud, ${rows.length - fraud} legit. Scored on content only.\n`);

  for (const [name, s] of [['flagged (any warning)', flagged], ['blocked (hidden)', blocked]]) {
    console.log(`${name.padEnd(24)} precision ${pctText(s.precision).padStart(4)}   recall ${pctText(s.recall).padStart(4)}   (caught ${s.tp}, false alarms ${s.fp}, missed ${s.fn})`);
  }

  const wrong = rows.filter((r) => (r.label === 'fraud') !== r.flagged);
  console.log(`\n${wrong.length} wrong at the "flagged" threshold:`);
  for (const r of wrong) {
    const kind = r.label === 'fraud' ? 'MISSED     ' : 'FALSE ALARM';
    console.log(`  ${kind} ${r.id}  risk ${String(r.risk).padStart(3)} ${r.band.padEnd(7)} — ${r.note}  [${r.signals.join(', ') || 'no signals'}]`);
  }
  if (set.about) console.log(`\nNote: ${set.about}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
