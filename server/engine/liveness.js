/**
 * Posting Liveness — "is anyone actually hiring for this?"
 *
 * Ghost jobs are the demand-side twin of the referral problem: students spend
 * their limited effort on requisitions nobody intends to fill, then conclude
 * the whole channel is rigged. Note the deliberate design choice — a low score
 * NEVER removes a posting. It labels and demotes it, because the false
 * positive (a real but slow employer) has a real cost to that employer, and
 * silently deleting their post would be the wrong trade.
 *
 * Every input here is something the platform already knows internally.
 */

import { clamp, daysBetween, decay, pct, round, weightedMean } from './util.js';

const WEIGHTS = {
  recruiterActivity: 0.30,
  applicantMovement: 0.26,
  atsSync: 0.20,
  postAge: 0.14,
  repostBehaviour: 0.10,
};

export function computeLiveness(job) {
  const now = Date.now();

  // Has the owning recruiter touched the platform lately?
  const recruiterIdle = daysBetween(job.recruiterLastActiveAt ?? now);
  const recruiterActivity = decay(recruiterIdle, 10);

  // Are applicants moving through stages, or landing in a void? This is the
  // strongest single signal — it measures outcomes, not intentions.
  const total = job.applicantCount ?? 0;
  const moved = job.applicantsMovedCount ?? 0;
  const applicantMovement = total < 10 ? 0.55 : clamp(moved / Math.max(1, total) / 0.12);

  // Does the post map to a live req in the employer's ATS?
  const atsSync = job.atsSynced ? (job.atsReqOpen ? 1 : 0.15) : 0.4;

  const age = daysBetween(job.postedAt ?? now);
  const postAge = age <= 30 ? 1 : age <= 45 ? 0.7 : age <= 60 ? 0.4 : 0.15;

  const reposts = job.repostCount ?? 0;
  const repostBehaviour = reposts === 0 ? 1 : reposts === 1 ? 0.8 : reposts === 2 ? 0.5 : 0.2;

  const components = [
    { key: 'recruiterActivity', label: 'Recruiter recently active', value: recruiterActivity, weight: WEIGHTS.recruiterActivity },
    { key: 'applicantMovement', label: 'Applicants moving through stages', value: applicantMovement, weight: WEIGHTS.applicantMovement },
    { key: 'atsSync', label: 'Requisition open in employer ATS', value: atsSync, weight: WEIGHTS.atsSync },
    { key: 'postAge', label: 'Posting freshness', value: postAge, weight: WEIGHTS.postAge },
    { key: 'repostBehaviour', label: 'Repost behaviour', value: repostBehaviour, weight: WEIGHTS.repostBehaviour },
  ];

  const score = pct(weightedMean(components));
  const band = score >= 70 ? 'active' : score >= 45 ? 'slow' : 'stale';

  const notes = [];
  if (recruiterIdle > 21) notes.push(`Recruiter has not been active for ${Math.round(recruiterIdle)} days.`);
  if (total >= 50 && applicantMovement < 0.25) notes.push(`${total} applicants, only ${moved} advanced to any stage.`);
  if (job.atsSynced && !job.atsReqOpen) notes.push('Linked requisition is closed in the employer’s ATS.');
  if (age > 45) notes.push(`Posted ${Math.round(age)} days ago and still open.`);
  if (reposts >= 2) notes.push(`Reposted ${reposts} times without a recorded hire.`);

  return {
    score,
    band,
    label:
      band === 'active'
        ? 'Actively hiring'
        : band === 'slow'
          ? 'Low hiring activity'
          : 'Little sign of active hiring',
    // Demotion multiplier applied at ranking time; never a removal.
    rankingMultiplier: band === 'active' ? 1 : band === 'slow' ? 0.7 : 0.35,
    components: components.map((c) => ({ ...c, value: round(c.value) })),
    notes,
  };
}
