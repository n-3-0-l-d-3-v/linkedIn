/**
 * Seed dataset for the Vouch prototype.
 *
 * All companies here are fictional. That is deliberate: the fraud demo shows
 * brand impersonation (lookalike domains, spoofed recruiters), and doing that
 * against real employers' names in a document you hand to a platform company
 * is a bad idea. The mechanism demonstrates identically against invented
 * brands.
 *
 * The data is shaped to make the *contrast* legible in a live demo:
 *   - one student with a thin network (the person today's product fails)
 *   - referrers who are close to the req, and referrers who are noise
 *   - one obviously-real recruiter message and several graded scam messages
 *   - one healthy posting and one textbook ghost job
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintHiringToken } from './engine/tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iso = (daysAgo, hoursAgo = 0) =>
  new Date(Date.now() - daysAgo * 86_400_000 - hoursAgo * 3_600_000).toISOString();

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const companies = [
  {
    id: 'northwind',
    name: 'Northwind Systems',
    domains: ['northwind.com', 'careers.northwind.com'],
    industry: 'Cloud infrastructure',
    atsProvider: 'Greenhouse',
    referralBonus: { amount: 120000, currency: 'INR', note: 'Paid on 90-day retention' },
    verifiedEmployer: true,
  },
  {
    id: 'meridian',
    name: 'Meridian Analytics',
    domains: ['meridian-analytics.com'],
    industry: 'Data platforms',
    atsProvider: 'Lever',
    referralBonus: { amount: 90000, currency: 'INR', note: 'Paid on offer acceptance' },
    verifiedEmployer: true,
  },
  {
    id: 'kestrel',
    name: 'Kestrel Labs',
    domains: ['kestrellabs.io'],
    industry: 'Applied ML',
    atsProvider: 'Ashby',
    referralBonus: { amount: 150000, currency: 'INR', note: 'Paid on 90-day retention' },
    verifiedEmployer: true,
  },
  {
    id: 'zenithpay',
    name: 'Zenith Payments',
    domains: ['zenithpay.com'],
    industry: 'Fintech',
    atsProvider: 'Greenhouse',
    referralBonus: { amount: 100000, currency: 'INR', note: 'Paid on offer acceptance' },
    verifiedEmployer: true,
  },
];

// ---------------------------------------------------------------------------
// The student the demo is told from
// ---------------------------------------------------------------------------

const students = [
  {
    id: 'stu_neil',
    type: 'student',
    name: 'Neil Mathew',
    headline: 'B.Tech CSE · Backend & distributed systems',
    school: 'Cochin University of Science and Technology',
    gradYear: 2027,
    level: 'intern',
    fieldsOfStudy: ['computer science'],
    location: 'Kochi, India',
    connections: 214,
    identityVerified: true,
    educationVerified: true,
    skills: [
      'python', 'go', 'postgresql', 'docker', 'rest apis',
      'data structures', 'algorithms', 'react', 'distributed systems', 'linux',
    ],
    artifacts: [
      {
        id: 'art_raft',
        title: 'mini-raft — Raft consensus in Go',
        type: 'open_source',
        verified: true,
        date: iso(70),
        url: 'https://github.com/example/mini-raft',
        skills: ['go', 'distributed systems', 'data structures'],
        detail: '1.2k lines, 340 GitHub stars, leader election + log replication with a fuzz-tested harness',
      },
      {
        id: 'art_ledger',
        title: 'Idempotent payments ledger',
        type: 'project',
        verified: false,
        date: iso(140),
        url: 'https://github.com/example/ledger',
        skills: ['go', 'postgresql', 'rest apis', 'docker'],
        detail: 'Double-entry ledger with exactly-once webhook processing under retry storms',
      },
      {
        id: 'art_icpc',
        title: 'ICPC Regionals — Rank 41/1,900',
        type: 'competition_result',
        verified: true,
        date: iso(240),
        skills: ['algorithms', 'data structures', 'cpp'],
        detail: 'Amritapuri regional site, three-person team',
      },
      {
        id: 'art_sysdesign',
        title: 'Distributed Systems — graded assessment',
        type: 'graded_assessment',
        verified: true,
        date: iso(45),
        skills: ['distributed systems', 'system design'],
        detail: 'Proctored, 91st percentile',
      },
      {
        id: 'art_intern',
        title: 'Backend intern — Tessellate (verified)',
        type: 'verified_employment',
        verified: true,
        date: iso(200),
        skills: ['python', 'postgresql', 'rest apis'],
        detail: '3-month internship, shipped the billing reconciliation service',
      },
      {
        id: 'art_react',
        title: 'Campus placement portal',
        type: 'project',
        verified: false,
        date: iso(400),
        url: 'https://github.com/example/portal',
        skills: ['react', 'javascript'],
        detail: 'Used by 600 students across three departments',
      },
    ],
  },
  {
    id: 'stu_priya',
    type: 'student',
    name: 'Priya Nair',
    headline: 'M.Tech Data Science · NLP research',
    school: 'Cochin University of Science and Technology',
    gradYear: 2026,
    level: 'new_grad',
    fieldsOfStudy: ['data science', 'computer science'],
    location: 'Bengaluru, India',
    connections: 480,
    identityVerified: true,
    educationVerified: true,
    skills: ['python', 'machine learning', 'natural language processing', 'pytorch', 'sql'],
    artifacts: [
      {
        id: 'art_nlp', title: 'Low-resource NER for Malayalam', type: 'competition_result',
        verified: true, date: iso(60), skills: ['natural language processing', 'machine learning', 'python'],
        detail: 'Best paper, student track',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Employees — the referral supply side
// ---------------------------------------------------------------------------

const employees = [
  // --- Northwind: the target company for the main demo flow ---------------
  {
    id: 'emp_ananya', name: 'Ananya Rao', companyId: 'northwind',
    title: 'Staff Engineer, Storage', team: 'Storage Engine', teamId: 'nw_storage', orgId: 'nw_infra',
    discipline: 'swe', headline: 'Staff Engineer @ Northwind Systems · Storage Engine',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.72, lastActiveAt: iso(0, 4), monthlyReferralCapacity: 3, referralsThisMonth: 1,
    officeHoursOpen: true, officeHoursNote: 'Reviewing 3 backend referral packets this month — Storage & Compute only.',
    acceptsReferralRequests: true, school: 'Cochin University of Science and Technology', gradYear: 2016,
  },
  {
    id: 'emp_vikram', name: 'Vikram Shah', companyId: 'northwind',
    title: 'Senior Engineer, Compute', team: 'Compute Platform', teamId: 'nw_compute', orgId: 'nw_infra',
    discipline: 'swe', headline: 'Senior Engineer @ Northwind Systems',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.41, lastActiveAt: iso(9), monthlyReferralCapacity: 2, referralsThisMonth: 0,
    officeHoursOpen: false, acceptsReferralRequests: true,
  },
  {
    id: 'emp_sarah', name: 'Sarah Iyer', companyId: 'northwind',
    title: 'Engineering Manager, Storage', team: 'Storage Engine', teamId: 'nw_storage', orgId: 'nw_infra',
    discipline: 'swe', headline: 'EM @ Northwind Systems · hiring for Storage',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.55, lastActiveAt: iso(1), monthlyReferralCapacity: 4, referralsThisMonth: 4, // maxed out
    officeHoursOpen: false, acceptsReferralRequests: true,
  },
  {
    id: 'emp_rahul', name: 'Rahul Menon', companyId: 'northwind',
    title: 'Account Executive', team: 'Enterprise Sales', teamId: 'nw_sales', orgId: 'nw_gtm',
    discipline: 'sales', headline: 'Enterprise Sales @ Northwind Systems',
    workplaceVerified: true, identityVerified: false,
    // The person today's product routes students to: same company, zero
    // connection to the req, and the reason employees mute referral requests.
    replyRate: 0.12, lastActiveAt: iso(24), monthlyReferralCapacity: 2, referralsThisMonth: 0,
    officeHoursOpen: false, acceptsReferralRequests: true,
    school: 'Cochin University of Science and Technology', gradYear: 2018,
  },
  {
    id: 'emp_deepa', name: 'Deepa Krishnan', companyId: 'northwind',
    title: 'Engineer II, Storage', team: 'Storage Engine', teamId: 'nw_storage', orgId: 'nw_infra',
    discipline: 'swe', headline: 'Engineer II @ Northwind Systems',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.83, lastActiveAt: iso(0, 9), monthlyReferralCapacity: 2, referralsThisMonth: 0,
    officeHoursOpen: true, officeHoursNote: 'Happy to review packets from CUSAT juniors.',
    acceptsReferralRequests: true, school: 'Cochin University of Science and Technology', gradYear: 2022,
  },
  // --- Other companies ----------------------------------------------------
  {
    id: 'emp_arjun', name: 'Arjun Pillai', companyId: 'meridian',
    title: 'Senior Data Engineer', team: 'Pipelines', teamId: 'md_pipe', orgId: 'md_data',
    discipline: 'data', headline: 'Senior Data Engineer @ Meridian Analytics',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.6, lastActiveAt: iso(2), monthlyReferralCapacity: 2, referralsThisMonth: 0,
    officeHoursOpen: true, acceptsReferralRequests: true,
  },
  {
    id: 'emp_leena', name: 'Leena Thomas', companyId: 'kestrel',
    title: 'Research Engineer', team: 'Applied NLP', teamId: 'ks_nlp', orgId: 'ks_research',
    discipline: 'ml', headline: 'Research Engineer @ Kestrel Labs',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.5, lastActiveAt: iso(3), monthlyReferralCapacity: 3, referralsThisMonth: 1,
    officeHoursOpen: true, acceptsReferralRequests: true,
  },
  {
    id: 'emp_karthik', name: 'Karthik Suresh', companyId: 'zenithpay',
    title: 'Engineer, Payments Core', team: 'Payments Core', teamId: 'zp_core', orgId: 'zp_eng',
    discipline: 'swe', headline: 'Engineer @ Zenith Payments',
    workplaceVerified: true, identityVerified: true,
    replyRate: 0.66, lastActiveAt: iso(1), monthlyReferralCapacity: 2, referralsThisMonth: 0,
    officeHoursOpen: false, acceptsReferralRequests: true,
  },
].map((e) => ({ ...e, type: 'employee', connections: 500 + Math.floor(Math.random() * 900) }));

// Intermediaries who are not employees — they exist to make warm paths real.
const bridges = [
  {
    id: 'per_josh', type: 'peer', name: 'Josh Varghese',
    headline: 'SDE-1 @ Tessellate · CUSAT 2025',
    school: 'Cochin University of Science and Technology', gradYear: 2025,
  },
  {
    id: 'per_rao', type: 'faculty', name: 'Dr. Meera Rao',
    headline: 'Associate Professor, Systems Lab · CUSAT',
  },
  {
    id: 'per_aditi', type: 'peer', name: 'Aditi Sen',
    headline: 'Backend Engineer @ Tessellate · ICPC teammate',
  },
];

// ---------------------------------------------------------------------------
// Recruiters — legitimate and fraudulent
// ---------------------------------------------------------------------------

const recruiters = [
  {
    id: 'rec_maya', type: 'recruiter', name: 'Maya Fernandes', companyId: 'northwind',
    title: 'Technical Recruiter', headline: 'Technical Recruiter @ Northwind Systems',
    claimedCompany: 'Northwind Systems', verifiedCompany: 'Northwind Systems',
    workplaceVerified: true, identityVerified: true,
    createdAt: iso(1600), connections: 3400, mutualConnections: 6, reportCount: 0, lastActiveAt: iso(0, 2),
  },
  {
    id: 'rec_scam1', type: 'recruiter', name: 'HR Team — Northwind Careers',
    title: 'Senior HR Executive', headline: 'Senior HR Executive | Bulk Hiring | Northwind Careers',
    claimedCompany: 'Northwind Systems', verifiedCompany: null,
    workplaceVerified: false, identityVerified: false,
    createdAt: iso(9), connections: 18, mutualConnections: 0, reportCount: 3, lastActiveAt: iso(0, 1),
  },
  {
    id: 'rec_scam2', type: 'recruiter', name: 'Rohit Sharma', title: 'Talent Acquisition Lead',
    headline: 'Talent Acquisition | Hiring Freshers 2026',
    claimedCompany: 'Meridian Analytics', verifiedCompany: 'Skyline Consultancy Services',
    workplaceVerified: true, identityVerified: true,
    createdAt: iso(420), connections: 610, mutualConnections: 1, reportCount: 0, lastActiveAt: iso(0, 6),
  },
  {
    id: 'rec_scam3', type: 'recruiter', name: 'Placement Cell Official',
    title: 'Internship Coordinator', headline: 'AICTE Approved Internship Program | Placement Assistance',
    claimedCompany: 'Kestrel Labs', verifiedCompany: null,
    workplaceVerified: false, identityVerified: false,
    createdAt: iso(31), connections: 47, mutualConnections: 0, reportCount: 1, lastActiveAt: iso(1),
  },
  {
    id: 'rec_arun', type: 'recruiter', name: 'Arun Balan', companyId: 'zenithpay',
    title: 'Campus Recruiting', headline: 'Campus Recruiting @ Zenith Payments',
    claimedCompany: 'Zenith Payments', verifiedCompany: 'Zenith Payments',
    workplaceVerified: true, identityVerified: true,
    createdAt: iso(900), connections: 1800, mutualConnections: 2, reportCount: 0, lastActiveAt: iso(0, 5),
  },
];

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const jobs = [
  {
    id: 'job_nw_storage', companyId: 'northwind', title: 'Software Engineer Intern — Storage Engine',
    teamId: 'nw_storage', orgId: 'nw_infra', discipline: 'swe', team: 'Storage Engine',
    level: 'intern', domain: 'computer science', location: 'Bengaluru, India (Hybrid)',
    requiredSkills: ['go', 'distributed systems', 'data structures'],
    preferredSkills: ['postgresql', 'docker', 'linux'],
    description: 'Work on the replication layer of Northwind’s distributed object store. You will write Go, reason about consistency, and ship to a system that stores 40PB.',
    recruiterId: 'rec_maya', hiringTeamIds: ['emp_ananya', 'emp_sarah'],
    postedAt: iso(6), recruiterLastActiveAt: iso(0, 2),
    applicantCount: 187, applicantsMovedCount: 41, atsSynced: true, atsReqOpen: true, repostCount: 0,
    referralBonusEligible: true,
  },
  {
    id: 'job_nw_ghost', companyId: 'northwind', title: 'Graduate Engineer Trainee — Platform',
    teamId: 'nw_compute', orgId: 'nw_infra', discipline: 'swe', team: 'Compute Platform',
    level: 'new_grad', domain: 'computer science', location: 'Remote, India',
    requiredSkills: ['python', 'linux'], preferredSkills: ['docker'],
    description: 'Join our platform team. Requirements will be shared with shortlisted candidates.',
    recruiterId: 'rec_maya', hiringTeamIds: [],
    // Textbook ghost job: old, reposted, huge funnel, nothing moves, ATS closed.
    postedAt: iso(118), recruiterLastActiveAt: iso(63),
    applicantCount: 2140, applicantsMovedCount: 7, atsSynced: true, atsReqOpen: false, repostCount: 3,
    referralBonusEligible: false,
  },
  {
    id: 'job_md_data', companyId: 'meridian', title: 'Data Engineering Intern',
    teamId: 'md_pipe', orgId: 'md_data', discipline: 'data', team: 'Pipelines',
    level: 'intern', domain: 'computer science', location: 'Pune, India',
    requiredSkills: ['python', 'sql', 'rest apis'], preferredSkills: ['docker', 'postgresql'],
    description: 'Build ingestion pipelines processing 2B events/day.',
    recruiterId: 'rec_maya', hiringTeamIds: ['emp_arjun'],
    postedAt: iso(14), recruiterLastActiveAt: iso(1),
    applicantCount: 96, applicantsMovedCount: 19, atsSynced: true, atsReqOpen: true, repostCount: 0,
    referralBonusEligible: true,
  },
  {
    id: 'job_ks_ml', companyId: 'kestrel', title: 'ML Research Intern — Applied NLP',
    teamId: 'ks_nlp', orgId: 'ks_research', discipline: 'ml', team: 'Applied NLP',
    level: 'intern', domain: 'data science', location: 'Remote',
    requiredSkills: ['python', 'machine learning', 'natural language processing'],
    preferredSkills: ['pytorch'],
    description: 'Low-resource language modelling for Indic languages.',
    recruiterId: 'rec_maya', hiringTeamIds: ['emp_leena'],
    postedAt: iso(21), recruiterLastActiveAt: iso(2),
    applicantCount: 143, applicantsMovedCount: 25, atsSynced: true, atsReqOpen: true, repostCount: 1,
    referralBonusEligible: true,
  },
  {
    id: 'job_zp_core', companyId: 'zenithpay', title: 'Backend Engineer Intern — Payments Core',
    teamId: 'zp_core', orgId: 'zp_eng', discipline: 'swe', team: 'Payments Core',
    level: 'intern', domain: 'computer science', location: 'Bengaluru, India',
    requiredSkills: ['go', 'postgresql', 'rest apis'], preferredSkills: ['docker', 'distributed systems'],
    description: 'Idempotency, reconciliation, and settlement for a 12M-transaction/day rail.',
    recruiterId: 'rec_arun', hiringTeamIds: ['emp_karthik'],
    postedAt: iso(9), recruiterLastActiveAt: iso(0, 3),
    applicantCount: 210, applicantsMovedCount: 38, atsSynced: true, atsReqOpen: true, repostCount: 0,
    referralBonusEligible: true,
  },
];

// ---------------------------------------------------------------------------
// Affiliation graph — the edges that make warm paths possible
// ---------------------------------------------------------------------------

const affiliations = [
  // Neil's real, verifiable context
  { a: 'stu_neil', b: 'per_rao', type: 'professor_advisor', context: 'CUSAT Systems Lab', verified: true },
  { a: 'per_rao', b: 'emp_ananya', type: 'professor_advisor', context: 'CUSAT Systems Lab', verified: true },
  { a: 'stu_neil', b: 'per_josh', type: 'school_same_year', context: 'CUSAT', verified: true },
  { a: 'per_josh', b: 'emp_deepa', type: 'prior_colleague', context: 'Tessellate', verified: true },
  { a: 'stu_neil', b: 'emp_deepa', type: 'school_alumni', context: 'CUSAT', verified: true },
  { a: 'stu_neil', b: 'per_aditi', type: 'contest_team', context: 'ICPC Amritapuri', verified: true },
  { a: 'per_aditi', b: 'emp_karthik', type: 'open_source_repo', context: 'apache/arrow', verified: true },
  { a: 'stu_neil', b: 'emp_rahul', type: 'school_alumni', context: 'CUSAT', verified: true },
  { a: 'stu_neil', b: 'emp_vikram', type: 'open_source_repo', context: 'etcd-io/etcd', verified: true },
  // Priya
  { a: 'stu_priya', b: 'per_rao', type: 'research_lab', context: 'CUSAT NLP Group', verified: true },
  { a: 'stu_priya', b: 'emp_leena', type: 'program_cohort', context: 'Indic NLP Summer School', verified: true },
];

// ---------------------------------------------------------------------------
// Referral history — feeds the credibility model
// ---------------------------------------------------------------------------

const outcomes = {
  emp_ananya: ['hired', 'interviewed', 'interviewed', 'final_round', 'screened_out', 'interviewed', 'hired', 'interviewed', 'screened_out', 'interviewed'],
  emp_deepa: ['interviewed', 'hired', 'interviewed'],
  emp_vikram: ['screened_out', 'interviewed'],
  emp_sarah: ['hired', 'interviewed', 'final_round', 'interviewed', 'interviewed', 'hired'],
  // The cautionary tale: high volume, poor targeting, flagged by recruiters.
  emp_rahul: ['recruiter_flagged_mismatch', 'screened_out', 'screened_out', 'recruiter_flagged_mismatch', 'screened_out', 'withdrawn', 'screened_out'],
  emp_arjun: ['interviewed', 'hired', 'screened_out', 'interviewed'],
  emp_leena: ['interviewed', 'interviewed', 'final_round'],
  emp_karthik: ['hired', 'interviewed', 'interviewed', 'screened_out'],
};

const referralHistory = Object.entries(outcomes).flatMap(([employeeId, list]) =>
  list.map((outcome, i) => ({
    id: `rh_${employeeId}_${i}`,
    referrerId: employeeId,
    outcome,
    createdAt: iso(500 - i * 45),
    decidedAt: iso(480 - i * 45),
  })),
);

const spamReports = { emp_rahul: 2 };

// ---------------------------------------------------------------------------
// Inbound messages — the Shield demo set
// ---------------------------------------------------------------------------

const legitToken = mintHiringToken({
  jobId: 'job_nw_storage', companyId: 'Northwind Systems', recruiterId: 'rec_maya',
});
const zenithToken = mintHiringToken({
  jobId: 'job_zp_core', companyId: 'Zenith Payments', recruiterId: 'rec_arun',
});

const messages = [
  {
    id: 'msg_1', recipientId: 'stu_neil', senderId: 'rec_maya', receivedAt: iso(0, 3),
    subject: 'Storage Engine internship — your Raft project',
    hiringToken: legitToken,
    body:
      'Hi Neil — I came across mini-raft while looking at candidates for our Storage Engine internship. The fuzz-tested log replication harness is genuinely unusual for an undergrad project.\n\n' +
      'We have an open requisition (SDE Intern, Storage Engine, Bengaluru). Would you be open to a 30-minute conversation with Ananya Rao on the team this week? Nothing to prepare.\n\n' +
      'You can see the role and apply directly at careers.northwind.com — happy to answer anything before that.\n\nMaya',
  },
  {
    id: 'msg_2', recipientId: 'stu_neil', senderId: 'rec_scam1', receivedAt: iso(0, 7),
    subject: 'Congratulations! You are selected — Northwind Systems',
    hiringToken: null,
    body:
      'Dear Candidate, greetings of the day.\n\n' +
      'Congratulations! Your profile has been shortlisted for Northwind Systems and you are selected directly without interview for the post of Software Engineer Trainee.\n\n' +
      'Package: Rs 8,50,000 per annum. Work from home available.\n\n' +
      'To confirm your seat you must pay a refundable security deposit and documentation fee of Rs 4,999 within 24 hours. Limited slots remaining. Payment via UPI to northwindhr@okaxis.\n\n' +
      'Send your Aadhaar card and PAN card copy on WhatsApp +91 90XXXXXX21 for immediate offer letter.\n\n' +
      'Registration link: n0rthwind-careers.com/apply',
  },
  {
    id: 'msg_3', recipientId: 'stu_neil', senderId: 'rec_scam2', receivedAt: iso(1, 2),
    subject: 'Opportunity at Meridian Analytics',
    hiringToken: null,
    body:
      'Hello,\n\nI am hiring for Meridian Analytics for a Data Engineering role. Your profile looks suitable.\n\n' +
      'Please share your updated resume and let me know a good time to connect. You can reach me faster on Telegram: t.me/rohit_hiring\n\n' +
      'Regards,\nRohit Sharma\nrohit.hiring2026@gmail.com',
  },
  {
    id: 'msg_4', recipientId: 'stu_neil', senderId: 'rec_scam3', receivedAt: iso(2),
    subject: 'AICTE Approved Internship — Certificate Guaranteed',
    hiringToken: null,
    body:
      'Dear Student,\n\nWe are offering a 3-month AICTE approved virtual internship at Kestrel Labs with a guaranteed completion certificate and letter of recommendation.\n\n' +
      'Stipend: Rs 15,000 per month. Part time, work from home, daily payout available.\n\n' +
      'One-time registration fee of Rs 1,499 is applicable for training material and certificate processing. Act fast, last 12 seats.\n\n' +
      'Download our candidate portal app to register: kestrel-internships.tk/setup',
  },
  {
    id: 'msg_5', recipientId: 'stu_neil', senderId: 'rec_arun', receivedAt: iso(3),
    subject: 'Zenith Payments — Backend intern, Payments Core',
    hiringToken: zenithToken,
    body:
      'Hi Neil, Arun here from campus recruiting at Zenith Payments.\n\n' +
      'Your idempotent ledger project lines up almost exactly with what our Payments Core team does. We have an internship req open in Bengaluru.\n\n' +
      'If you are interested, apply through zenithpay.com/careers and mention this message — I will make sure Karthik on the team sees it. No rush, the req is open for another six weeks.',
  },
];

// ---------------------------------------------------------------------------
// Existing referral requests — populates the employee inbox + recruiter view
// ---------------------------------------------------------------------------

const referralRequests = [
  {
    id: 'rr_1', studentId: 'stu_priya', jobId: 'job_ks_ml', referrerId: 'emp_leena',
    status: 'pending', createdAt: iso(1),
    pitch: 'I built the Malayalam NER system your team cited in the Indic NLP workshop — I would love to work on the low-resource modelling problem directly.',
    artifactIds: ['art_nlp'], fitScore: 82,
  },
  {
    id: 'rr_2', studentId: 'stu_priya', jobId: 'job_md_data', referrerId: 'emp_arjun',
    status: 'referred', createdAt: iso(12), decidedAt: iso(10), outcome: 'interviewed',
    pitch: 'Pipelines at scale is exactly what my thesis instrumentation did.', artifactIds: ['art_nlp'], fitScore: 71,
  },
];

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

export function buildSeed() {
  return {
    meta: { generatedAt: new Date().toISOString(), version: 1 },
    companies,
    people: [...students, ...employees, ...bridges, ...recruiters],
    jobs,
    affiliations,
    referralHistory,
    spamReports,
    messages,
    referralRequests,
    reports: [],
    events: [],
  };
}

const DB_PATH = path.join(__dirname, 'data', 'db.json');

export function writeSeed() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(buildSeed(), null, 2));
  return DB_PATH;
}

if (process.argv.includes('--write')) {
  console.log(`Seeded → ${writeSeed()}`);
}
