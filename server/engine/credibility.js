/**
 * Referrer Credibility — a private, portable track record.
 *
 * Today one thoughtful referral and one spray-and-pray referral carry
 * identical weight: zero. That is why referral quality has no floor. This
 * module gives referring *well* a compounding payoff, without ever exposing a
 * public score (a public number would instantly become a status game and
 * push people to refuse risky-but-deserving candidates).
 *
 * Design constraints that matter:
 *   - Never punish a referrer for an outcome the candidate controls. A
 *     candidate who bombs the interview is weak evidence; a candidate the
 *     recruiter flags as wildly mismatched is strong evidence.
 *   - Small samples must not outrank large ones (Wilson lower bound).
 *   - Old behaviour must fade (recency decay), so one bad year is survivable.
 */

import { clamp, daysBetween, decay, pct, round, wilsonLowerBound } from './util.js';

/**
 * Outcome credit. `value` is how much this outcome counts toward "was this a
 * good referral"; `weight` is how much evidence it carries at all.
 */
const OUTCOME_CREDIT = {
  hired: { value: 1.0, weight: 1.0 },
  offer_declined: { value: 0.95, weight: 0.9 }, // candidate was good enough
  final_round: { value: 0.92, weight: 0.9 },
  // "Reached an interview" is the outcome a referrer actually controls — they
  // vouch for someone worth a conversation. Whether that person then gets
  // hired depends on the interview loop, the team's bar, and competing
  // candidates. Scoring `interviewed` as a partial failure would punish good
  // referrers for other people's decisions, so it counts as near-full credit.
  interviewed: { value: 0.88, weight: 1.0 },
  screened_out: { value: 0.2, weight: 0.7 },
  recruiter_flagged_mismatch: { value: 0.0, weight: 1.3 }, // referrer's fault
  withdrawn: { value: 0.5, weight: 0.25 }, // mostly noise
  pending: { value: 0, weight: 0 }, // not yet evidence
};

const HALF_LIFE_DAYS = 400;

/**
 * @param {Array<{outcome:string, decidedAt?:string, createdAt:string}>} history
 * @param {object} opts { spamReports }
 */
export function computeCredibility(history = [], { spamReports = 0 } = {}) {
  let successes = 0;
  let trials = 0;

  for (const r of history) {
    const credit = OUTCOME_CREDIT[r.outcome] ?? OUTCOME_CREDIT.pending;
    if (credit.weight === 0) continue;

    // Recency: a referral from three years ago says little about today.
    const age = daysBetween(r.decidedAt ?? r.createdAt);
    const w = credit.weight * (0.35 + 0.65 * decay(age, HALF_LIFE_DAYS));

    trials += w;
    successes += w * credit.value;
  }

  const base = wilsonLowerBound(successes, trials);

  // Spam pressure: referring indiscriminately is the failure mode that killed
  // the existing feature's credibility, so it bites harder than a bad outcome.
  const spamPenalty = clamp(spamReports * 0.12, 0, 0.6);
  const raw = clamp(base - spamPenalty);

  const decided = history.filter((r) => (OUTCOME_CREDIT[r.outcome]?.weight ?? 0) > 0).length;
  const interviewPlus = history.filter((r) =>
    ['interviewed', 'final_round', 'offer_declined', 'hired'].includes(r.outcome),
  ).length;

  // Below ~4 decided referrals we say so rather than pretending to know.
  const confidence = clamp(decided / 8);
  // Thresholds are set against the Wilson *lower* bound, which is conservative
  // by construction — a referrer with a genuinely good record and a modest
  // sample lands around 0.5, not 0.9. Calibrated so that a clean 6-referral
  // history reads "trusted" and a 10-referral history with two screen-outs
  // reads "reliable".
  const tier =
    decided < 3 ? 'establishing' : raw >= 0.55 ? 'trusted' : raw >= 0.35 ? 'reliable' : raw >= 0.18 ? 'mixed' : 'low';

  return {
    score: pct(raw),
    tier,
    confidence: round(confidence),
    sampleSize: decided,
    interviewRate: decided ? round(interviewPlus / decided) : 0,
    spamReports,
    // Shown only to the referrer themselves.
    privateSummary:
      decided === 0
        ? 'No completed referrals yet. Your first few build your track record.'
        : `${decided} completed referrals · ${Math.round((interviewPlus / decided) * 100)}% reached interview.`,
  };
}

/**
 * Routing weight derived from credibility. Deliberately gentle: a newcomer
 * with no history sits at 0.5, not 0, or the system would freeze out every
 * employee who has not referred before and never bootstrap.
 */
export function credibilityRoutingWeight(cred) {
  if (!cred || cred.sampleSize === 0) return 0.5;
  const raw = cred.score / 100;
  return clamp(0.5 + (raw - 0.5) * cred.confidence);
}
