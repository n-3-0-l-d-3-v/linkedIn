/**
 * Composition layer — wires the pure engine to stored data.
 *
 * The engine deliberately knows nothing about storage or HTTP; everything that
 * assembles inputs and shapes responses lives here, so the scoring logic stays
 * portable and unit-testable.
 */

import { db } from './db.js';
import {
  computeFit, selectPassportArtifacts,
  buildGraph, findPaths,
  computeCredibility,
  rankReferrers,
  assessMessage,
  verifyHiringToken,
  computeLiveness,
} from './engine/index.js';

// The affiliation graph is rebuilt per request in the prototype. At LinkedIn
// scale this is a served graph index with incremental updates, not a rebuild —
// noted here because it is the single biggest difference between this code and
// a production port.
const graph = () => buildGraph(db.affiliations());

export const credibilityOf = (employeeId) =>
  computeCredibility(db.referralHistoryFor(employeeId), { spamReports: db.spamReportsFor(employeeId) });

export function jobWithLiveness(job) {
  const company = db.company(job.companyId);
  return {
    ...job,
    company: company ? { id: company.id, name: company.name, industry: company.industry, referralBonus: company.referralBonus, atsProvider: company.atsProvider } : null,
    liveness: computeLiveness(job),
  };
}

/** Jobs ranked with the liveness demotion applied — never filtered out. */
export function rankedJobs() {
  return db
    .jobs()
    .map(jobWithLiveness)
    .sort((a, b) => b.liveness.rankingMultiplier * b.liveness.score - a.liveness.rankingMultiplier * a.liveness.score);
}

/**
 * The core read for the student flow: for one (student, job), who should be
 * asked, how strong is the ask, and what proof should ride along.
 */
export function referralPlan(studentId, jobId) {
  const student = db.person(studentId);
  const job = db.job(jobId);
  if (!student || !job) return null;

  const fit = computeFit(student, job);
  const paths = findPaths(graph(), studentId, { maxHops: 3 });
  const employees = db.employeesAt(job.companyId);

  const referrers = rankReferrers(
    { employees, job, paths, credOf: credibilityOf, nameOf: (id) => db.nameOf(id) },
    5,
  );

  const passport = selectPassportArtifacts(student, job, 3);
  const company = db.company(job.companyId);

  return {
    student: { id: student.id, name: student.name, headline: student.headline, school: student.school },
    job: jobWithLiveness(job),
    fit,
    passport,
    referrers,
    referralBonus: job.referralBonusEligible ? company?.referralBonus ?? null : null,
    // What today's product would have done, for the side-by-side in the demo.
    baseline: baselineComparison(studentId, job, employees, referrers),
  };
}

/**
 * Models the current LinkedIn behaviour so the demo can show before/after
 * honestly rather than asserting an improvement.
 *
 * Today: the "Ask for a referral" affordance requires an existing 1st-degree
 * connection at the company, and when it does surface someone it does not
 * reason about which requisition they are near.
 */
function baselineComparison(studentId, job, employees, referrers) {
  const firstDegree = db
    .affiliations()
    .filter((a) => (a.a === studentId || a.b === studentId) && a.type === 'direct_connection')
    .map((a) => (a.a === studentId ? a.b : a.a));

  const availableToday = employees.filter((e) => firstDegree.includes(e.id));

  return {
    buttonAvailable: availableToday.length > 0,
    reachableToday: availableToday.map((e) => ({ id: e.id, name: e.name, title: e.title })),
    reachableWithVouch: referrers.filter((r) => r.warmPath).length,
    note: availableToday.length
      ? 'Today LinkedIn would surface these 1st-degree contacts, without checking whether they are near this requisition.'
      : 'Today the "Ask for a referral" button does not appear at all — no 1st-degree connection at this company.',
  };
}

/** Employee-side view: incoming packets, scored, with the bonus surfaced. */
export function referrerInbox(employeeId) {
  const employee = db.person(employeeId);
  if (!employee) return null;

  const requests = db
    .referralRequests()
    .filter((r) => r.referrerId === employeeId)
    .map((r) => {
      const student = db.person(r.studentId);
      const job = db.job(r.jobId);
      const fit = student && job ? computeFit(student, job) : null;
      const company = job ? db.company(job.companyId) : null;
      return {
        ...r,
        student: student
          ? {
              id: student.id, name: student.name, headline: student.headline,
              school: student.school, gradYear: student.gradYear,
              educationVerified: student.educationVerified, identityVerified: student.identityVerified,
            }
          : null,
        job: job ? { id: job.id, title: job.title, team: job.team, level: job.level } : null,
        fit,
        artifacts: (r.artifactIds ?? [])
          .map((id) => (student?.artifacts ?? []).find((a) => a.id === id))
          .filter(Boolean),
        bonus: job?.referralBonusEligible ? company?.referralBonus ?? null : null,
        warmPath: describeWarmPath(r.studentId, employeeId),
      };
    })
    .sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0));

  const cred = credibilityOf(employeeId);

  return {
    employee: {
      id: employee.id, name: employee.name, title: employee.title, team: employee.team,
      companyId: employee.companyId,
      monthlyReferralCapacity: employee.monthlyReferralCapacity,
      referralsThisMonth: employee.referralsThisMonth,
      officeHoursOpen: employee.officeHoursOpen,
      officeHoursNote: employee.officeHoursNote ?? null,
    },
    credibility: cred,
    requests,
  };
}

function describeWarmPath(studentId, employeeId) {
  const paths = findPaths(graph(), studentId, { maxHops: 3 });
  const entry = paths.get(employeeId);
  if (!entry) return null;
  return {
    strength: entry.strength,
    steps: entry.path.map((s) => ({
      from: db.nameOf(s.from), to: db.nameOf(s.to),
      type: s.type, context: s.context, verified: s.verified,
    })),
  };
}

// ---------------------------------------------------------------------------
// Shield
// ---------------------------------------------------------------------------

/** Every domain we consider "official" for impersonation checks. */
const officialDomains = () => db.companies().flatMap((c) => c.domains);

export function assessOne(message) {
  const sender = db.person(message.senderId) ?? {};
  const assessment = assessMessage(message, sender, {
    officialDomains: officialDomains(),
    verifyToken: (t) => verifyHiringToken(t),
  });
  return {
    ...message,
    sender: {
      id: sender.id, name: sender.name, headline: sender.headline, title: sender.title,
      claimedCompany: sender.claimedCompany, verifiedCompany: sender.verifiedCompany,
      workplaceVerified: !!sender.workplaceVerified, identityVerified: !!sender.identityVerified,
      connections: sender.connections, createdAt: sender.createdAt, reportCount: sender.reportCount ?? 0,
    },
    assessment,
  };
}

export function inbox(recipientId) {
  return db
    .messagesFor(recipientId)
    .map(assessOne)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

// ---------------------------------------------------------------------------
// Employer-side analytics (the part that makes this sellable, not just nice)
// ---------------------------------------------------------------------------

export function trustDashboard(companyId) {
  const company = db.company(companyId);
  if (!company) return null;

  const jobs = db.jobs().filter((j) => j.companyId === companyId).map(jobWithLiveness);
  const employees = db.employeesAt(companyId);

  // Impersonation attempts: inbound messages claiming this company from
  // senders who cannot prove they work here.
  const impersonation = db
    .messages()
    .map(assessOne)
    .filter((m) => m.sender.claimedCompany === company.name && m.assessment.band !== 'clear');

  const requests = db.referralRequests().filter((r) => {
    const job = db.job(r.jobId);
    return job?.companyId === companyId;
  });

  const capacity = employees.reduce((s, e) => s + (e.monthlyReferralCapacity ?? 0), 0);
  const used = employees.reduce((s, e) => s + (e.referralsThisMonth ?? 0), 0);

  return {
    company: { id: company.id, name: company.name, atsProvider: company.atsProvider, referralBonus: company.referralBonus },
    postings: {
      total: jobs.length,
      active: jobs.filter((j) => j.liveness.band === 'active').length,
      slow: jobs.filter((j) => j.liveness.band === 'slow').length,
      stale: jobs.filter((j) => j.liveness.band === 'stale').length,
      // Regulatory exposure is the framing that gets this funded: several
      // jurisdictions now require postings to reflect genuine hiring intent.
      atRisk: jobs.filter((j) => j.liveness.band === 'stale').map((j) => ({
        id: j.id, title: j.title, score: j.liveness.score, notes: j.liveness.notes,
      })),
      detail: jobs.map((j) => ({ id: j.id, title: j.title, liveness: j.liveness, applicantCount: j.applicantCount })),
    },
    brandProtection: {
      flaggedImpersonations: impersonation.length,
      highRisk: impersonation.filter((m) => m.assessment.band === 'high').length,
      incidents: impersonation.map((m) => ({
        messageId: m.id, senderName: m.sender.name, risk: m.assessment.risk, band: m.assessment.band,
        topSignals: m.assessment.signals.content.slice(0, 3).map((s) => s.label),
      })),
    },
    referralFunnel: {
      capacity, used, utilisation: capacity ? Math.round((used / capacity) * 100) : 0,
      openOfficeHours: employees.filter((e) => e.officeHoursOpen).length,
      requests: requests.length,
      pending: requests.filter((r) => r.status === 'pending').length,
      referred: requests.filter((r) => r.status === 'referred').length,
      declined: requests.filter((r) => r.status === 'declined').length,
      topReferrers: employees
        .map((e) => ({ id: e.id, name: e.name, team: e.team, credibility: credibilityOf(e.id) }))
        .sort((a, b) => b.credibility.score - a.credibility.score)
        .slice(0, 5),
    },
  };
}
