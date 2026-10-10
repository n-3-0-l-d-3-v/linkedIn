/**
 * Referrer Routing — "who at this company should actually see this ask?"
 *
 * The documented failure of today's flow is that LinkedIn surfaces whoever
 * happens to work at the company, producing messages like "please refer me
 * for a role in a department I have nothing to do with." That single
 * experience is what trains employees to ignore referral requests forever.
 *
 * Routing here optimises four things at once:
 *   - org proximity to the actual requisition (not just the company)
 *   - a warm path the referrer will recognise as real
 *   - the referrer's likelihood of RESPONDING (dead accounts are worthless)
 *   - remaining capacity, so we never dump 40 asks on one helpful person
 *
 * Capacity is the part that makes this survivable at scale. Referral supply is
 * finite and human; a system that does not ration it destroys the resource it
 * depends on.
 */

import { clamp, daysBetween, decay, pct, round, weightedMean } from './util.js';
import { credibilityRoutingWeight } from './credibility.js';
import { pathHeadline } from './warmpath.js';

const WEIGHTS = {
  orgProximity: 0.32,
  warmPath: 0.24,
  responsiveness: 0.22,
  capacity: 0.14,
  credibility: 0.08,
};

/**
 * How close is this employee to the requisition?
 * Uses the org metadata already attached to a job req.
 */
export function orgProximity(employee, job) {
  if (employee.companyId !== job.companyId) return 0;
  if (job.hiringTeamIds?.includes(employee.id)) return 1.0; // on the req
  if (employee.teamId && employee.teamId === job.teamId) return 0.92; // same team
  if (employee.orgId && employee.orgId === job.orgId) return 0.72; // same org/pillar
  if (employee.discipline && employee.discipline === job.discipline) return 0.5; // same craft
  return 0.18; // same company, unrelated function — today's default, now the floor
}

/**
 * Responsiveness: will this person actually reply? Blends historical reply
 * rate with how recently they were active, because a 90% replier who has not
 * logged in for four months is functionally unreachable — the exact reason
 * cold outreach to alumni converts near zero.
 */
export function responsiveness(employee) {
  const rate = clamp(employee.replyRate ?? 0.35);
  const activity = decay(daysBetween(employee.lastActiveAt ?? Date.now()), 21);
  return clamp(0.35 * rate + 0.65 * (rate * activity + 0.15 * activity));
}

/** Remaining referral bandwidth this cycle (Referral Office Hours). */
export function capacity(employee) {
  const cap = employee.monthlyReferralCapacity ?? 0;
  if (cap <= 0) return 0;
  const used = employee.referralsThisMonth ?? 0;
  return clamp((cap - used) / cap);
}

/**
 * Rank candidate referrers for one (student, job) pair.
 *
 * @param {object} ctx
 *   employees   — all employees at the target company
 *   job         — the requisition
 *   paths       — Map<personId, {strength, path}> from warmpath.findPaths
 *   credOf      — (employeeId) => credibility object
 *   nameOf      — (personId) => display name
 */
export function rankReferrers({ employees, job, paths, credOf, nameOf }, limit = 5) {
  const scored = employees
    .filter((e) => e.companyId === job.companyId && e.acceptsReferralRequests !== false)
    .map((e) => {
      const prox = orgProximity(e, job);
      const pathEntry = paths?.get(e.id);
      const warm = clamp(pathEntry?.strength ?? 0);
      const resp = responsiveness(e);
      const cap = capacity(e);
      const cred = credOf ? credOf(e.id) : null;
      const credW = credibilityRoutingWeight(cred);

      const components = [
        { key: 'orgProximity', label: 'Closeness to this req', value: prox, weight: WEIGHTS.orgProximity },
        { key: 'warmPath', label: 'Shared context with you', value: warm, weight: WEIGHTS.warmPath },
        { key: 'responsiveness', label: 'Likely to reply', value: resp, weight: WEIGHTS.responsiveness },
        { key: 'capacity', label: 'Has bandwidth', value: cap, weight: WEIGHTS.capacity },
        { key: 'credibility', label: 'Referral track record', value: credW, weight: WEIGHTS.credibility },
      ];

      let unit = weightedMean(components);

      // Hard gate: someone with zero remaining capacity is not a match, they
      // are a person about to be spammed. Rank them but mark unavailable.
      const available = cap > 0;
      if (!available) unit *= 0.35;

      return {
        employeeId: e.id,
        name: e.name,
        headline: e.headline,
        title: e.title,
        team: e.team,
        verified: !!e.workplaceVerified,
        available,
        score: pct(unit),
        onHiringTeam: !!job.hiringTeamIds?.includes(e.id),
        warmPath: pathEntry
          ? {
              strength: round(pathEntry.strength),
              hops: pathEntry.path.length,
              headline: pathHeadline(pathEntry.path, nameOf),
              steps: pathEntry.path.map((s) => ({
                from: nameOf(s.from),
                to: nameOf(s.to),
                type: s.type,
                context: s.context,
                verified: s.verified,
              })),
            }
          : null,
        capacityRemaining: Math.max(0, (e.monthlyReferralCapacity ?? 0) - (e.referralsThisMonth ?? 0)),
        officeHoursOpen: !!e.officeHoursOpen,
        credibility: cred ? { tier: cred.tier, sampleSize: cred.sampleSize } : null,
        components: components.map((c) => ({ ...c, value: round(c.value) })),
        reasons: buildReasons({ prox, warm, resp, cap, e, job, pathEntry, nameOf }),
      };
    });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildReasons({ prox, warm, resp, cap, e, job, pathEntry, nameOf }) {
  const out = [];
  if (job.hiringTeamIds?.includes(e.id)) out.push({ kind: 'strong', text: 'Listed on this requisition’s hiring team' });
  else if (prox >= 0.9) out.push({ kind: 'strong', text: `Same team as this role (${e.team})` });
  else if (prox >= 0.7) out.push({ kind: 'good', text: `Same org as this role` });
  else if (prox <= 0.2) out.push({ kind: 'weak', text: 'Different function — would be a cold ask' });

  if (pathEntry) {
    out.push({
      kind: pathEntry.strength > 0.5 ? 'strong' : 'good',
      text: pathHeadline(pathEntry.path, nameOf),
    });
  } else {
    out.push({ kind: 'weak', text: 'No shared background found' });
  }

  if (resp >= 0.6) out.push({ kind: 'good', text: `Replies to most requests · active recently` });
  else if (resp < 0.25) out.push({ kind: 'weak', text: 'Rarely active — low chance of a reply' });

  if (cap === 0) out.push({ kind: 'weak', text: 'Referral slots full this month' });
  else if (e.officeHoursOpen) out.push({ kind: 'strong', text: 'Referral office hours open now' });

  return out;
}
