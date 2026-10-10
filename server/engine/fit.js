/**
 * Fit Score — "should this referral ask even be sent?"
 *
 * Two jobs, one number:
 *   1. Student-facing: show gaps BEFORE sending, so weak asks self-filter out
 *      instead of burning an employee's goodwill. This is the throttle that
 *      keeps the referral channel from degrading into the InMail firehose.
 *   2. Referrer-facing: give the employee a defensible reason to spend their
 *      name on a stranger, in under a minute.
 *
 * Deliberately NOT a black box. Every component is separately reported with
 * its own evidence, because a referrer who cannot see why the number is 78
 * will not trust the number at all.
 */

import { canonicalSet, canonicalSkill, clamp, pct, round, weightedMean, decay, daysBetween } from './util.js';

/** How much each component moves the final score. */
const WEIGHTS = {
  requiredSkills: 0.34,
  evidence: 0.28,
  preferredSkills: 0.14,
  level: 0.14,
  domain: 0.10,
};

/**
 * Evidence tiers — the Skills Passport premise. A self-asserted skill is worth
 * far less than a graded artifact, and the gap between them is the entire
 * reason "endorsements" became meaningless on LinkedIn.
 */
const EVIDENCE_WEIGHT = {
  verified_employment: 1.0, // workplace-verified internship doing that skill
  graded_assessment: 0.9, // proctored / scored, not a self-quiz
  competition_result: 0.85, // ranked finish, externally checkable
  open_source: 0.8, // merged PRs in a public repo
  certification: 0.65, // issuer-verified course certificate
  project: 0.5, // self-published, code or demo link present
  coursework: 0.35, // transcript-level only
  self_asserted: 0.1, // the profile checkbox everyone clicks
};

const EVIDENCE_HALF_LIFE_DAYS = 730; // two years — skills go stale, slowly

const LEVEL_ORDER = ['intern', 'new_grad', 'junior', 'mid', 'senior', 'staff'];

/** Distance between candidate seniority and what the req asks for. */
function levelScore(candidateLevel, roleLevel) {
  const c = LEVEL_ORDER.indexOf(candidateLevel);
  const r = LEVEL_ORDER.indexOf(roleLevel);
  if (c < 0 || r < 0) return 0.5;
  const gap = c - r;
  if (gap === 0) return 1;
  if (gap === 1) return 0.85; // slightly over-qualified, still fine
  if (gap === -1) return 0.55; // one rung short — a stretch, not a no
  if (gap > 1) return 0.5;
  return 0.15; // two-plus rungs short: this is the ask that wastes everyone
}

/**
 * Score one skill against the candidate's evidence portfolio.
 * Returns the best supporting artifact so the UI can cite it by name.
 */
function evidenceForSkill(skill, artifacts = []) {
  const target = canonicalSkill(skill);
  let best = { strength: 0, artifact: null };

  for (const a of artifacts) {
    const covers = canonicalSet(a.skills ?? []);
    if (!covers.has(target)) continue;

    const base = EVIDENCE_WEIGHT[a.type] ?? 0.3;
    // Recency matters, but never zeroes a strong artifact out entirely.
    const freshness = 0.55 + 0.45 * decay(daysBetween(a.date ?? Date.now()), EVIDENCE_HALF_LIFE_DAYS);
    const verifiedBoost = a.verified ? 1 : 0.6;
    const strength = clamp(base * freshness * verifiedBoost);

    if (strength > best.strength) best = { strength, artifact: a };
  }
  return best;
}

/**
 * @param {object} candidate  { skills[], level, artifacts[], fieldsOfStudy[] }
 * @param {object} role       { requiredSkills[], preferredSkills[], level, domain }
 */
export function computeFit(candidate, role) {
  const required = (role.requiredSkills ?? []).map(canonicalSkill);
  const preferred = (role.preferredSkills ?? []).map(canonicalSkill);
  const claimed = canonicalSet(candidate.skills ?? []);
  const artifacts = candidate.artifacts ?? [];

  // --- Required skills: claimed coverage -----------------------------------
  const requiredHits = required.filter((s) => claimed.has(s));
  const requiredCoverage = required.length ? requiredHits.length / required.length : 0.6;

  // --- Evidence: how much of the requirement is actually PROVEN ------------
  const evidenceDetail = required.map((skill) => {
    const { strength, artifact } = evidenceForSkill(skill, artifacts);
    return {
      skill,
      claimed: claimed.has(skill),
      strength: round(strength),
      proof: artifact
        ? { id: artifact.id, title: artifact.title, type: artifact.type, verified: !!artifact.verified }
        : null,
    };
  });
  const evidenceScore = required.length
    ? evidenceDetail.reduce((s, d) => s + d.strength, 0) / required.length
    : 0.4;

  // --- Preferred skills: upside, never a gate ------------------------------
  const preferredHits = preferred.filter((s) => claimed.has(s));
  const preferredCoverage = preferred.length ? preferredHits.length / preferred.length : 0.5;

  // --- Level + domain ------------------------------------------------------
  const level = levelScore(candidate.level, role.level);

  // Guard the empty-domain case explicitly: `''.includes('')` is true, so a
  // req with no stated domain would otherwise award every candidate full marks.
  const roleDomain = canonicalSkill(role.domain ?? '');
  const domainOverlap =
    roleDomain.length > 0 &&
    (candidate.fieldsOfStudy ?? []).some((f) => {
      const field = canonicalSkill(f);
      return field.length > 0 && (field.includes(roleDomain) || roleDomain.includes(field));
    });
  const domain = roleDomain.length === 0 ? 0.6 : domainOverlap ? 1 : 0.45;

  const components = [
    { key: 'requiredSkills', label: 'Required skills claimed', value: requiredCoverage, weight: WEIGHTS.requiredSkills },
    { key: 'evidence', label: 'Verified proof of those skills', value: evidenceScore, weight: WEIGHTS.evidence },
    { key: 'preferredSkills', label: 'Preferred skills', value: preferredCoverage, weight: WEIGHTS.preferredSkills },
    { key: 'level', label: 'Seniority match', value: level, weight: WEIGHTS.level },
    { key: 'domain', label: 'Field of study relevance', value: domain, weight: WEIGHTS.domain },
  ];

  const score = pct(weightedMean(components));

  // --- Gaps: the actionable half of the output -----------------------------
  const missing = required.filter((s) => !claimed.has(s));
  const unproven = evidenceDetail
    .filter((d) => d.claimed && d.strength < 0.5)
    .map((d) => d.skill);

  // Blockers are gaps that no amount of skill overlap should outvote. Without
  // them a candidate can clear the send threshold on paper while being an ask
  // that damages the referrer's credibility — the exact dynamic that made
  // employees stop reading referral requests in the first place.
  const blockers = [];
  const gaps = [];
  for (const skill of missing) {
    gaps.push({
      severity: 'high',
      skill,
      message: `"${skill}" is required and missing from your profile.`,
      fix: `Add it only if it is genuinely true — then attach a project or assessment as proof.`,
    });
  }
  for (const skill of unproven) {
    gaps.push({
      severity: 'medium',
      skill,
      message: `You claim "${skill}" but have no strong artifact backing it.`,
      fix: `Link a project, merged PR, or graded assessment. Unbacked claims are the #1 reason referrers pass.`,
    });
  }
  if (level < 0.4) {
    const blocker = {
      severity: 'high',
      skill: null,
      message: `This role targets ${role.level ?? 'a more senior'} candidates and you are ${candidate.level ?? 'earlier'}.`,
      fix: `Referrals for roles two levels up almost never convert. Spend the ask on a closer role.`,
    };
    gaps.push(blocker);
    blockers.push(blocker);
  }
  // Missing more than half the required skills is the other hard stop.
  if (required.length >= 2 && missing.length / required.length > 0.5) {
    const blocker = {
      severity: 'high',
      skill: null,
      message: `You are missing ${missing.length} of ${required.length} required skills.`,
      fix: `Close at least one gap, or pick a role that matches what you can already prove.`,
    };
    gaps.push(blocker);
    blockers.push(blocker);
  }

  // Band drives UI treatment: below 45 we actively discourage sending.
  const band = score >= 75 ? 'strong' : score >= 55 ? 'viable' : score >= 40 ? 'stretch' : 'weak';

  return {
    score,
    band,
    sendRecommended: score >= 45 && blockers.length === 0,
    blockers,
    components: components.map((c) => ({ ...c, value: round(c.value), contribution: round(c.value * c.weight) })),
    evidence: evidenceDetail,
    matchedRequired: requiredHits,
    missingRequired: missing,
    gaps,
  };
}

/**
 * Skills Passport packet: pick the artifacts that best prove THIS role's
 * requirements. The point is that the attachment set is per-request, not a
 * static badge shelf — a referrer sees only evidence relevant to their req.
 */
export function selectPassportArtifacts(candidate, role, limit = 3) {
  const required = (role.requiredSkills ?? []).map(canonicalSkill);
  const preferred = (role.preferredSkills ?? []).map(canonicalSkill);

  const scored = (candidate.artifacts ?? []).map((a) => {
    const covers = canonicalSet(a.skills ?? []);
    const reqHits = required.filter((s) => covers.has(s));
    const prefHits = preferred.filter((s) => covers.has(s));
    const base = EVIDENCE_WEIGHT[a.type] ?? 0.3;
    const freshness = 0.55 + 0.45 * decay(daysBetween(a.date ?? Date.now()), EVIDENCE_HALF_LIFE_DAYS);

    const relevance = reqHits.length * 1.0 + prefHits.length * 0.4;
    return {
      artifact: a,
      relevance,
      rank: relevance * base * freshness * (a.verified ? 1.15 : 1),
      provesRequired: reqHits,
      provesPreferred: prefHits,
    };
  });

  return scored
    .filter((s) => s.relevance > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((s) => ({
      ...s.artifact,
      whyAttached:
        s.provesRequired.length > 0
          ? `Proves required: ${s.provesRequired.join(', ')}`
          : `Supports preferred: ${s.provesPreferred.join(', ')}`,
      rank: round(s.rank),
    }));
}
