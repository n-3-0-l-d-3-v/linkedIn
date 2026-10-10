/**
 * Vouch Trust Engine — public surface.
 *
 * One engine, three products. The same signal store that scores a referral
 * ask also scores an inbound recruiter DM and a job posting's liveness, which
 * is what makes this a platform layer rather than three disconnected features.
 */

export { computeFit, selectPassportArtifacts } from './fit.js';
export { buildGraph, findPaths, describePath, pathHeadline, AFFINITY_WEIGHTS } from './warmpath.js';
export { computeCredibility, credibilityRoutingWeight } from './credibility.js';
export { rankReferrers, orgProximity, responsiveness, capacity } from './match.js';
export { assessMessage, domainRisk, provenanceRisk, SHIELD_PATTERNS } from './shield.js';
export { mintHiringToken, verifyHiringToken } from './tokens.js';
export { computeLiveness } from './liveness.js';
