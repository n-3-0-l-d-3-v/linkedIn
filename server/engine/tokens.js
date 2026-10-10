/**
 * Verified Hiring Channel — signed requisition tokens.
 *
 * This is the structural half of the anti-fraud design. Pattern matching
 * catches scams that look like scams; tokens make legitimate outreach
 * *provable*, which is the durable fix. Once students learn to look for
 * "bound to a verified requisition," an unbound message asking for money
 * stops being ambiguous.
 *
 * Token = base64url(payload) + "." + HMAC-SHA256(payload, secret)
 *
 * In production this is an asymmetric signature from LinkedIn's requisition
 * service so nothing outside it can mint tokens; HMAC keeps the prototype
 * dependency-free while preserving the exact verification semantics.
 */

import crypto from 'node:crypto';

const PLACEHOLDER_SECRET = 'vouch-prototype-secret-do-not-ship';
const SECRET = process.env.VOUCH_TOKEN_SECRET ?? PLACEHOLDER_SECRET;
const DEFAULT_TTL_DAYS = 45;

// VOUCH-5 — loud, not silent. A hiring token's entire value is that it can't
// be forged; shipping the placeholder secret to a real deployment would mean
// every "verified" badge in Shield is trivially fake. This must never be a
// quiet default.
if (SECRET === PLACEHOLDER_SECRET) {
  console.warn(
    '[vouch] WARNING: VOUCH_TOKEN_SECRET is not set — using the placeholder ' +
    'signing secret. Fine for local development; anyone who reads the source ' +
    'can forge hiring tokens against this instance. Set VOUCH_TOKEN_SECRET ' +
    '(see .env.example) before any shared or public deployment.',
  );
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

/**
 * Mint a token for a requisition. `recruiterId` binds it to a person, so a
 * leaked token cannot be reused by a different account.
 */
export function mintHiringToken({ jobId, companyId, recruiterId, ttlDays = DEFAULT_TTL_DAYS }) {
  const payload = {
    jobId,
    companyId,
    recruiterId,
    iat: Date.now(),
    exp: Date.now() + ttlDays * 86_400_000,
  };
  const encoded = b64u(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyHiringToken(token, { expectedRecruiterId } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'malformed' };
  }
  const [encoded, sig] = token.split('.');

  const expected = sign(encoded);
  // Constant-time compare — a token check that leaks timing is a token check
  // an attacker can brute-force one byte at a time.
  const a = Buffer.from(sig ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad signature' };
  }

  let payload;
  try {
    payload = JSON.parse(unb64u(encoded));
  } catch {
    return { valid: false, reason: 'unreadable payload' };
  }

  if (payload.exp && Date.now() > payload.exp) {
    return { valid: false, reason: 'expired requisition' };
  }
  if (expectedRecruiterId && payload.recruiterId !== expectedRecruiterId) {
    return { valid: false, reason: 'token issued to a different recruiter' };
  }

  return { valid: true, payload };
}
