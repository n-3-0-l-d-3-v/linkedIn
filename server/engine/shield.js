/**
 * Vouch Shield — inbound hiring-fraud interception.
 *
 * The gap this closes: LinkedIn's verification work today is profile-level and
 * job-post-level. The scam does not start at a job post. It starts with an
 * unsolicited DM or InMail, which is the one surface with no trust signal
 * attached at all. By the time a student is asked for a "training fee" or
 * "refundable equipment deposit," they are several days into a relationship
 * with someone they believe is a recruiter.
 *
 * Two mechanisms, layered:
 *
 *   1. HARD RULES — non-negotiable, evidence-backed patterns that alone
 *      justify a warning. The most important: no legitimate employer ever asks
 *      a candidate for money. This is not probabilistic and must not be
 *      averaged away by a hundred reassuring signals.
 *
 *   2. WEIGHTED EVIDENCE — a transparent additive risk model over sender
 *      identity, domain authenticity, account provenance, and message content.
 *
 * Everything returns its reasoning. A warning a student cannot understand is a
 * warning they will click past.
 */

import { clamp, daysBetween, deobfuscate, extractDomains, foldHomoglyphs, levenshtein, round, rootDomain } from './util.js';

// ---------------------------------------------------------------------------
// Content patterns
//
// Sourced from the recurring structure of documented recruitment-fraud cases:
// move off-platform early, manufacture urgency, request documents or payment,
// and route money through channels an employer would never use.
// ---------------------------------------------------------------------------

/**
 * Wording that, directly before a fee mention, means the sender is saying
 * the candidate does NOT pay: "we never charge any registration fee",
 * "there is no application fee", "we cover the verification fee".
 *
 * Honest employers write exactly these sentences in anti-fraud notices, and
 * without this guard the money rule — a hard rule — fired on all of them.
 * It is deliberately narrow. It must sit immediately before the fee mention,
 * and it is checked per occurrence, so "we never ask for a registration fee,
 * but a refundable deposit is required" still trips on the second mention.
 * "Refunded" and "reimbursed" are intentionally absent: "pay now, refunded
 * later" is the scam's own script.
 */
const DISCLAIMS_PAYMENT = new RegExp(
  '(?:' + [
    String.raw`\b(?:never|not|don'?t|do not|won'?t|will not|doesn'?t|does not|cannot|can'?t)\s+(?:ever\s+)?(?:ask|charge|request|require|demand|collect|take|need)\b[^.!?\n]{0,40}`,
    String.raw`\b(?:there\s+is\s+)?no\s+`,
    String.raw`\b(?:we|the company|your employer)\s+(?:will\s+)?(?:cover|bear|pay)s?\s+(?:for\s+)?(?:the\s+|all\s+|any\s+|your\s+)?(?:\w+\s+)?`,
  ].join('|') + ')$',
  'i',
);

/** First occurrence of `re` that is not immediately preceded by a disclaimer. */
function firstUndisclaimed(re, text, disclaimedBy) {
  if (!disclaimedBy) return text.match(re);
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(global)) {
    const before = text.slice(Math.max(0, m.index - 90), m.index);
    if (!disclaimedBy.test(before)) return m;
  }
  return null;
}

const PATTERNS = [
  {
    id: 'payment_request',
    disclaimedBy: DISCLAIMS_PAYMENT,
    label: 'Asks the candidate for money',
    hard: true,
    weight: 55,
    explain:
      'No legitimate employer charges a candidate to be hired, trained, onboarded, or equipped. This is the single clearest fraud indicator.',
    re: /\b(registration|processing|security|training|onboarding|refundable|application|documentation|verification)\s+(fee|charge|deposit|amount)\b|\bpay\s+(?:a\s+)?(?:rs\.?|inr|₹|\$|usd)?\s?\d|\bfee\s+of\s+(?:rs\.?|inr|₹|\$)?\s?\d/i,
  },
  {
    id: 'payment_rail',
    label: 'Names a consumer payment rail',
    hard: true,
    weight: 45,
    explain:
      'Employers pay candidates through payroll. A hiring conversation that mentions UPI, gift cards, crypto, or a personal transfer app is fraud.',
    re: /\b(upi|paytm|phonepe|g[-\s]?pay|google\s?pay|bitcoin|btc|usdt|crypto\s?wallet|western\s?union|gift\s?card|zelle|venmo|cash\s?app)\b/i,
  },
  {
    id: 'offplatform_push',
    label: 'Pushes the conversation off LinkedIn immediately',
    hard: false,
    weight: 22,
    explain:
      'Moving to WhatsApp or Telegram in the first message escapes platform moderation and destroys the evidence trail. Real recruiters use email or an ATS.',
    re: /\b(whatsapp|telegram|signal\s+app|wechat)\b|\bwa\.me\b|\bt\.me\b/i,
  },
  {
    id: 'urgency',
    label: 'Manufactured time pressure',
    hard: false,
    weight: 14,
    explain: 'Artificial deadlines exist to stop you from verifying anything. Real hiring processes survive a 24-hour pause.',
    re: /\b(within\s+\d+\s+(hours?|minutes?)|immediately|urgent(ly)?|today\s+only|limited\s+slots?|expires?\s+(today|tonight|soon)|act\s+(fast|now)|last\s+\d+\s+(seats?|slots?|positions?))\b/i,
  },
  {
    id: 'credential_request',
    label: 'Requests sensitive identity documents early',
    hard: false,
    weight: 26,
    explain:
      'Aadhaar, PAN, SSN, passport scans, and bank details are collected at onboarding by a verified HR system — never over DM before an interview.',
    re: /\b(aadhaar|aadhar|pan\s?card|ssn|social\s+security|passport\s+(copy|scan|number)|bank\s+(account|details)|ifsc|routing\s+number|cvv|otp|one[-\s]?time\s+password)\b/i,
  },
  {
    id: 'no_interview_offer',
    label: 'Offers the job with no real interview',
    hard: false,
    weight: 24,
    explain: 'A selection decision without a technical or behavioural interview is not a hiring process.',
    re: /\b(selected|shortlisted|offer\s+letter|congratulations)\b[\s\S]{0,120}\b(without|no\s+need\s+(?:for|of)|skip(?:ping)?)\s+(an?\s+)?(interview|test|assessment)\b|\bdirect(ly)?\s+(joining|selection|offer)\b/i,
  },
  {
    id: 'too_good_comp',
    label: 'Compensation inconsistent with the role',
    hard: false,
    weight: 12,
    explain: 'Outsized pay for an entry-level or unspecified role is the oldest lure in the category.',
    re: /\b(work\s+from\s+home|part[-\s]?time|daily\s+payout)\b[\s\S]{0,80}\b(₹|rs\.?|inr|\$)\s?\d{3,}|\b(₹|rs\.?|inr)\s?\d{2,},?\d{3}\s*(\/|per\s+)?(day|hour)\b/i,
  },
  {
    id: 'unofficial_contact',
    label: 'Uses a free email provider for official hiring',
    hard: false,
    weight: 20,
    explain: 'A recruiter at a real company sends mail from the company domain, not a personal Gmail or Outlook address.',
    re: /\b[a-z0-9._%+-]+@(gmail|yahoo|outlook|hotmail|proton(mail)?|rediffmail|zoho)\.[a-z.]{2,}\b/i,
  },
  {
    id: 'attachment_lure',
    label: 'Pushes a download or external login',
    hard: false,
    weight: 18,
    explain: 'Fake "assessment tools" and "onboarding portals" are the standard delivery vector for credential theft and malware.',
    re: /\b(download|install|\.apk\b|\.exe\b|setup\s+file|onboarding\s+portal|candidate\s+portal|login\s+here|click\s+(?:the\s+)?link\s+to\s+(?:register|verify|login))\b/i,
  },
  {
    id: 'generic_greeting',
    label: 'Generic, un-personalised opener',
    hard: false,
    weight: 7,
    explain: 'Mass-blasted templates rarely name your work. Weak on its own; meaningful stacked with other signals.',
    re: /^\s*(dear\s+(candidate|sir\/?\s?ma'?am|applicant|job\s+seeker)|hello\s+dear|greetings\s+of\s+the\s+day)\b/i,
  },
];

// ---------------------------------------------------------------------------
// Sender / provenance signals
// ---------------------------------------------------------------------------

/** Detects lookalike domains: arnazon.com vs amazon.com, tcs-careers.co vs tcs.com. */
export function domainRisk(domains, officialDomains = []) {
  const findings = [];
  const officialRoots = officialDomains.map((d) => rootDomain(d.toLowerCase()));

  // Brand tokens: the registrable label minus TLD, homoglyph-folded.
  // "northwind.com" -> "northwind". Short tokens are excluded because a
  // three-letter brand would match half the internet.
  const brandTokens = [...new Set(officialRoots.map((r) => foldHomoglyphs(r.split('.')[0])))].filter(
    (t) => t.length >= 5,
  );

  for (const d of domains) {
    const root = rootDomain(d);
    if (officialRoots.includes(root)) {
      findings.push({ domain: d, verdict: 'official', risk: 0 });
      continue;
    }

    // Brand-in-domain impersonation: the attacker registers a *different*
    // domain that embeds the real brand — n0rthwind-careers.com,
    // meridian-analytics-hr.xyz. Edit distance never catches these because the
    // added words make the strings far apart, but they are the single most
    // common shape in documented recruiter-impersonation campaigns.
    const candidateBrand = foldHomoglyphs(root.split('.')[0]);
    const embedded = brandTokens.find((t) => candidateBrand.includes(t) && candidateBrand !== t);
    if (embedded) {
      findings.push({
        domain: d,
        verdict: 'lookalike',
        risk: 38,
        note: `Embeds the "${embedded}" brand but is not a domain that company owns`,
      });
      continue;
    }

    // Lookalike check against every official domain, after homoglyph folding.
    let closest = null;
    for (const off of officialRoots) {
      const dist = levenshtein(foldHomoglyphs(root), foldHomoglyphs(off));
      if (closest === null || dist < closest.dist) closest = { off, dist };
    }

    // dist === 0 after folding means the raw domains differ but collapse to the
    // same string once homoglyph swaps are undone — arnazon.com vs amazon.com.
    // That is the strongest impersonation case, not a miss, so it must not fall
    // through to the generic buckets below.
    if (closest && closest.dist === 0) {
      findings.push({
        domain: d,
        verdict: 'lookalike',
        risk: 42,
        note: `Homoglyph impersonation of ${closest.off} — visually identical, different domain`,
      });
    } else if (closest && closest.dist <= 2) {
      findings.push({
        domain: d,
        verdict: 'lookalike',
        risk: 34,
        note: `Impersonates ${closest.off} (${closest.dist} character${closest.dist > 1 ? 's' : ''} different)`,
      });
    } else if (/^(gmail|yahoo|outlook|hotmail|protonmail|rediffmail|zoho)\./.test(root)) {
      // Informational only. The risk of a recruiter using a personal mailbox
      // is already counted once by the `unofficial_contact` content pattern;
      // scoring the domain as well counted the same fact twice.
      findings.push({ domain: d, verdict: 'free_provider', risk: 0 });
    } else if (/\.(tk|ml|ga|cf|gq|top|xyz|click|link|zip|mov)$/.test(root)) {
      findings.push({ domain: d, verdict: 'high_risk_tld', risk: 20, note: 'TLD heavily abused for disposable sites' });
    } else {
      findings.push({ domain: d, verdict: 'unrecognised', risk: 12, note: 'Not a known domain for the claimed employer' });
    }
  }
  return findings;
}

/**
 * Account provenance — how much history stands behind this sender.
 * Scam accounts are cheap and therefore almost always new and thin.
 */
export function provenanceRisk(sender) {
  const reasons = [];
  let risk = 0;

  // "Unknown" and "known to be false" are different facts and must score
  // differently. A caller with no sender data (the browser extension, which
  // cannot see verification state) leaves these fields undefined or null, and
  // that is neutral: no risk added, no trust credited. Only an explicit
  // `false` means "we checked, and this account is unverified". Scoring the
  // two the same made every message from an unknown sender read as a
  // warning — measured at 12 of 12 legitimate messages flagged.
  const known = (v) => v !== undefined && v !== null;
  const unknown = [];

  if (known(sender.createdAt)) {
    const ageDays = daysBetween(sender.createdAt);
    if (ageDays < 14) {
      risk += 22;
      reasons.push({ kind: 'bad', text: `Account created ${Math.round(ageDays)} days ago` });
    } else if (ageDays < 90) {
      risk += 11;
      reasons.push({ kind: 'warn', text: `Account is under 3 months old` });
    } else {
      reasons.push({ kind: 'good', text: `Account active for ${Math.round(ageDays / 365)}+ years` });
    }
  } else {
    unknown.push('account age');
  }

  if (!known(sender.identityVerified)) {
    unknown.push('identity verification');
  } else if (!sender.identityVerified) {
    risk += 14;
    reasons.push({ kind: 'warn', text: 'No verified identity on the profile' });
  } else {
    reasons.push({ kind: 'good', text: 'Government-ID verified' });
  }

  if (!known(sender.workplaceVerified)) {
    unknown.push('workplace verification');
  } else if (!sender.workplaceVerified) {
    risk += 20;
    reasons.push({ kind: 'bad', text: `Claims to work at ${sender.claimedCompany ?? 'a company'} but workplace is unverified` });
  } else {
    reasons.push({ kind: 'good', text: `Workplace verified at ${sender.claimedCompany}` });
  }

  if (known(sender.connections) && sender.connections < 30) {
    risk += 12;
    reasons.push({ kind: 'warn', text: `Only ${sender.connections} connections` });
  }

  if (unknown.length) {
    reasons.push({ kind: 'neutral', text: `Not available here: ${unknown.join(', ')}` });
  }

  if ((sender.reportCount ?? 0) > 0) {
    risk += Math.min(30, sender.reportCount * 10);
    reasons.push({ kind: 'bad', text: `Reported by ${sender.reportCount} other members` });
  }

  if (sender.mutualConnections > 0) {
    risk -= 6;
    reasons.push({ kind: 'good', text: `${sender.mutualConnections} mutual connections` });
  }

  return { risk: Math.max(0, risk), reasons };
}

// ---------------------------------------------------------------------------
// Verified Hiring Channel
//
// The structural fix, not just a classifier. Every real requisition mints an
// HMAC-signed hiring token. Outreach about that req carries the token, and the
// recipient's UI can state a fact rather than a guess: "this message is bound
// to requisition #4471 at Company X, verified."
//
// Absence of a token is not itself damning (plenty of legitimate messages are
// informal) — but absence of a token PLUS a money request is dispositive.
// ---------------------------------------------------------------------------

export function evaluateHiringToken(token, verifier) {
  if (!token) {
    return { present: false, valid: false, risk: 10, note: 'Not bound to a verified requisition' };
  }
  const result = verifier(token);
  if (!result.valid) {
    return { present: true, valid: false, risk: 40, note: `Hiring token failed verification (${result.reason})` };
  }
  return {
    present: true,
    valid: true,
    risk: -25, // meaningful trust credit
    note: `Bound to verified requisition ${result.payload.jobId} at ${result.payload.companyId}`,
    payload: result.payload,
  };
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

/**
 * @param {object} message  { body, senderId, hiringToken }
 * @param {object} sender   provenance fields (see provenanceRisk)
 * @param {object} ctx      { officialDomains, verifyToken }
 */
export function assessMessage(message, sender, ctx = {}) {
  const body = message.body ?? '';
  const matched = [];
  let contentRisk = 0;
  let hardTriggered = false;

  // Patterns read a de-obfuscated copy ("r3gistration f-e-e" reads as
  // "registration fee"). Domains are still extracted from the original text
  // further down, where a digit swap is itself the evidence.
  const scanText = deobfuscate(body);

  for (const p of PATTERNS) {
    const m = firstUndisclaimed(p.re, scanText, p.disclaimedBy);
    if (!m) continue;
    matched.push({
      id: p.id,
      label: p.label,
      weight: p.weight,
      hard: p.hard,
      explain: p.explain,
      excerpt: m[0].trim().slice(0, 120),
    });
    contentRisk += p.weight;
    if (p.hard) hardTriggered = true;
  }

  const domains = extractDomains(body);
  const domainFindings = domainRisk(domains, ctx.officialDomains ?? []);
  const domainScore = domainFindings.reduce((s, f) => s + f.risk, 0);
  if (domainFindings.some((f) => f.verdict === 'lookalike')) hardTriggered = true;

  const prov = provenanceRisk(sender ?? {});
  const tokenEval = ctx.verifyToken
    ? evaluateHiringToken(message.hiringToken, ctx.verifyToken)
    : { present: false, valid: false, risk: 10, note: 'Token verification unavailable' };

  // Claimed-employer mismatch: says "Recruiter at Infosys", workplace verified
  // somewhere else entirely. Cheap to check, very high precision.
  let mismatchRisk = 0;
  const mismatchReasons = [];
  if (sender?.workplaceVerified && sender.verifiedCompany && sender.claimedCompany) {
    if (sender.verifiedCompany.toLowerCase() !== sender.claimedCompany.toLowerCase()) {
      mismatchRisk = 30;
      hardTriggered = true;
      mismatchReasons.push({
        kind: 'bad',
        text: `Says they recruit for ${sender.claimedCompany}, but verified workplace is ${sender.verifiedCompany}`,
      });
    }
  }

  const rawRisk = contentRisk + domainScore + prov.risk + tokenEval.risk + mismatchRisk;

  // Squash to 0..100 with a soft knee so stacked weak signals cannot alone
  // reach the top band, while any single hard rule can.
  let risk = Math.round(100 * (1 - Math.exp(-rawRisk / 62)));
  if (hardTriggered) risk = Math.max(risk, 82);
  risk = clamp(risk, 0, 100);

  const band = risk >= 75 ? 'high' : risk >= 45 ? 'caution' : risk >= 20 ? 'low' : 'clear';

  const moneyRule = matched.find((m) => m.id === 'payment_request' || m.id === 'payment_rail');

  return {
    risk,
    band,
    hardTriggered,
    // The one-line verdict shown inline in the message thread.
    verdict: verdictFor(band, moneyRule, tokenEval),
    action: actionFor(band, moneyRule),
    signals: {
      content: matched,
      domains: domainFindings,
      provenance: prov.reasons,
      mismatch: mismatchReasons,
      hiringChannel: tokenEval,
    },
    breakdown: {
      content: contentRisk,
      domains: domainScore,
      provenance: prov.risk,
      hiringChannel: tokenEval.risk,
      employerMismatch: mismatchRisk,
      raw: round(rawRisk, 1),
    },
  };
}

function verdictFor(band, moneyRule, tokenEval) {
  if (moneyRule) return 'This message asks you for money. That is never part of a real hiring process.';
  if (band === 'high') return 'Multiple strong indicators of a fraudulent recruiter.';
  if (band === 'caution') return 'Several patterns here match known recruitment scams. Verify before replying.';
  if (tokenEval?.valid) return `Verified: bound to a real requisition at ${tokenEval.payload?.companyId}.`;
  if (band === 'low') return 'Nothing alarming, but this message is not bound to a verified requisition.';
  return 'Sender and message check out.';
}

function actionFor(band, moneyRule) {
  if (moneyRule)
    return {
      level: 'block_send',
      // Interstitial, not a silent block — students must stay in control, and
      // a hard block would be wrong in the rare false positive.
      primary: 'Report this account',
      secondary: 'I understand the risk, continue',
      guidance: 'Do not pay. Do not share ID or bank details. Report so others are protected.',
    };
  if (band === 'high')
    return {
      level: 'interstitial',
      primary: 'Report this account',
      secondary: 'Continue anyway',
      guidance: 'Verify independently through the company’s official careers page before replying.',
    };
  if (band === 'caution')
    return {
      level: 'inline_warning',
      primary: 'How to verify this recruiter',
      secondary: 'Dismiss',
      guidance: 'Check that the sender’s workplace is verified and that any domain matches the official company site.',
    };
  return { level: 'none', primary: null, secondary: null, guidance: null };
}

export const SHIELD_PATTERNS = PATTERNS;
