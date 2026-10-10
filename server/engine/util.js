/**
 * Shared numeric + text primitives for the Vouch Trust Engine.
 *
 * Everything here is deterministic and dependency-free so the engine can be
 * unit-tested in isolation and, in a production port, lifted into a JVM/Go
 * scoring service without dragging along a web framework.
 */

export const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Round to `places` decimals without float dust (0.1 + 0.2 problems). */
export const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Map a 0..1 unit score onto the 0..100 scale the UI speaks. */
export const pct = (unit) => Math.round(clamp(unit) * 100);

/**
 * Exponential recency decay. `halfLifeDays` is the age at which a signal is
 * worth half of a fresh one. Used everywhere we care "is this still true?".
 */
export const decay = (ageDays, halfLifeDays) =>
  halfLifeDays <= 0 ? 0 : Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);

export const daysBetween = (a, b = Date.now()) =>
  Math.max(0, (new Date(b) - new Date(a)) / 86_400_000);

/**
 * Wilson score lower bound at 95% confidence.
 *
 * This is the reason a referrer with 2/2 successes does NOT outrank one with
 * 41/50: a raw success ratio rewards tiny samples, which is exactly how you
 * build a reputation system people can game with a handful of self-referrals.
 */
export const wilsonLowerBound = (successes, trials, z = 1.96) => {
  if (trials <= 0) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return clamp((centre - margin) / denom);
};

/** Weighted mean over {value, weight} parts; ignores zero-weight parts. */
export const weightedMean = (parts) => {
  const live = parts.filter((p) => p.weight > 0);
  const total = live.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return 0;
  return live.reduce((s, p) => s + p.value * p.weight, 0) / total;
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export const normalizeSkill = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Skill aliases. A real deployment reads this off LinkedIn's existing skills
 * taxonomy (which already has canonical IDs + synonym edges); the demo carries
 * just enough to make matching feel honest rather than string-equality naive.
 */
const SKILL_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  'node js': 'node.js',
  nodejs: 'node.js',
  node: 'node.js',
  reactjs: 'react',
  'react js': 'react',
  py: 'python',
  golang: 'go',
  'postgres sql': 'postgresql',
  postgres: 'postgresql',
  psql: 'postgresql',
  k8s: 'kubernetes',
  ml: 'machine learning',
  dl: 'deep learning',
  nlp: 'natural language processing',
  'c++': 'cpp',
  cplusplus: 'cpp',
  'rest api': 'rest apis',
  api: 'rest apis',
  aws: 'amazon web services',
  gcp: 'google cloud',
  ds: 'data structures',
  'dsa': 'data structures',
  algo: 'algorithms',
  sysdesign: 'system design',
  'distributed system': 'distributed systems',
};

export const canonicalSkill = (s) => {
  const n = normalizeSkill(s);
  return SKILL_ALIASES[n] ?? n;
};

export const canonicalSet = (skills = []) =>
  new Set(skills.map(canonicalSkill).filter(Boolean));

export const tokenize = (text = '') =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9@.\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Levenshtein distance, used for lookalike-domain detection in Shield. */
export const levenshtein = (a = '', b = '') => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
};

/**
 * Homoglyph fold — collapses the characters scammers swap to register
 * lookalike domains (rn→m, 0→o, 1→l, vv→w) so `arnazon.com` and `amazon.com`
 * land one edit apart instead of looking unrelated.
 */
export const foldHomoglyphs = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/5/g, 's')
    .replace(/3/g, 'e')
    .replace(/-/g, '');

/** Pull bare domains out of free text (URLs and email addresses alike). */
export const extractDomains = (text = '') => {
  const out = new Set();

  // Email addresses first: only the part after "@" is a domain. Without this,
  // "priya.recruits@gmail.com" yielded a bogus domain "priya.recruits" that
  // was then scored as an unrecognised site.
  const emailRe = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
  let rest = String(text);
  for (const [, host] of rest.matchAll(emailRe)) out.add(host.toLowerCase().replace(/\.$/, ''));
  rest = rest.replace(emailRe, ' ');

  const re = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
  for (const [, host] of rest.matchAll(re)) {
    const clean = host.toLowerCase().replace(/\.$/, '');
    if (clean.split('.').length >= 2) out.add(clean);
  }
  return [...out];
};

/** Registrable-ish root: last two labels. Good enough outside the PSL. */
export const rootDomain = (host = '') => host.split('.').slice(-2).join('.');
