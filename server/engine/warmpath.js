/**
 * Multi-hop Warm Path Finder.
 *
 * LinkedIn's existing referral affordance is gated on 1st-degree connections:
 * the "Ask for a referral" button only appears if you ALREADY know someone at
 * the company. For a student that is precisely the resource they lack, so the
 * feature amplifies existing access instead of creating it.
 *
 * This module builds a second graph on top of the connection graph — edges
 * derived from *verified shared affiliations* (same lab, same professor, same
 * cohort, same contest team, same prior employer, same open-source repo) — and
 * searches it. Those edges are things LinkedIn can already verify from
 * education entries, workplace verification, and profile history; they simply
 * are not currently traversable as a path.
 *
 * Output is a ranked set of explainable paths: not just "you are 3rd degree"
 * but "you and Ananya were both in Dr. Rao's systems lab."
 */

import { clamp, round } from './util.js';

/**
 * Edge strength by affiliation type. These are the priors that decide whether
 * a path is worth showing at all — a shared university alone is weak enough
 * that we only surface it when nothing better exists.
 */
export const AFFINITY_WEIGHTS = {
  direct_connection: 0.90,
  prior_colleague: 0.86,
  research_lab: 0.82,
  professor_advisor: 0.80,
  open_source_repo: 0.68,
  contest_team: 0.70,
  program_cohort: 0.72,
  student_club: 0.58,
  school_same_year: 0.52,
  school_alumni: 0.34,
};

const HUMAN_LABEL = {
  direct_connection: 'connected directly',
  prior_colleague: 'worked together at',
  research_lab: 'both in',
  professor_advisor: 'both advised by',
  open_source_repo: 'both contribute to',
  contest_team: 'teammates at',
  program_cohort: 'same cohort in',
  student_club: 'both members of',
  school_same_year: 'same year at',
  school_alumni: 'both studied at',
};

/**
 * Build an undirected adjacency map from an affiliation edge list.
 * @param {Array<{a:string,b:string,type:string,context?:string,verified?:boolean}>} edges
 */
export function buildGraph(edges = []) {
  const adj = new Map();
  const push = (from, to, edge) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, ...edge });
  };

  for (const e of edges) {
    const base = AFFINITY_WEIGHTS[e.type] ?? 0.3;
    // Unverified affiliations still count, but at a discount — this is the
    // hook that makes verification worth doing rather than decorative.
    const weight = clamp(base * (e.verified === false ? 0.6 : 1));
    const edge = { type: e.type, context: e.context ?? null, verified: e.verified !== false, weight };
    push(e.a, e.b, edge);
    push(e.b, e.a, edge);
  }
  return adj;
}

/**
 * Dijkstra-style best-path search where "distance" is multiplicative path
 * strength (maximise product of edge weights) rather than additive hops.
 *
 * A 2-hop path through a lab-mate beats a 1-hop path through a stranger you
 * happened to connect with once, which is the whole point — hop count is a bad
 * proxy for whether someone will actually vouch for you.
 *
 * @returns {Map<string, {strength:number, path:Array}>} keyed by person id
 */
export function findPaths(adj, sourceId, { maxHops = 3, minStrength = 0.12 } = {}) {
  const best = new Map();
  best.set(sourceId, { strength: 1, path: [] });

  // Frontier expansion, keeping only the strongest route to each node.
  let frontier = [{ id: sourceId, strength: 1, path: [] }];

  for (let hop = 0; hop < maxHops; hop++) {
    const next = [];
    for (const node of frontier) {
      for (const edge of adj.get(node.id) ?? []) {
        // Decay per additional hop: a friend-of-a-friend-of-a-friend is a real
        // but much weaker claim, and without this the search over-rewards
        // long chains through high-weight edges.
        const hopPenalty = hop === 0 ? 1 : 0.82;
        const strength = node.strength * edge.weight * hopPenalty;
        if (strength < minStrength) continue;
        if (edge.to === sourceId) continue;

        const existing = best.get(edge.to);
        if (existing && existing.strength >= strength) continue;

        const path = [
          ...node.path,
          { from: node.id, to: edge.to, type: edge.type, context: edge.context, verified: edge.verified, weight: round(edge.weight) },
        ];
        best.set(edge.to, { strength, path });
        next.push({ id: edge.to, strength, path });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  best.delete(sourceId);
  return best;
}

/** Render a path as the one-line explanation a student actually reads. */
export function describePath(path, nameOf) {
  if (!path?.length) return 'No shared context found.';
  return path
    .map((step) => {
      const verb = HUMAN_LABEL[step.type] ?? 'connected via';
      const ctx = step.context ? ` ${step.context}` : '';
      return `${nameOf(step.from)} → ${nameOf(step.to)} (${verb}${ctx})`;
    })
    .join('  ·  ');
}

/** Shortest human summary of the strongest shared thing on the path. */
export function pathHeadline(path, nameOf) {
  if (!path?.length) return 'No shared context';
  const strongest = [...path].sort((a, b) => b.weight - a.weight)[0];
  const verb = HUMAN_LABEL[strongest.type] ?? 'connected via';
  const ctx = strongest.context ? ` ${strongest.context}` : '';
  if (path.length === 1) return `You ${verb}${ctx}`;
  return `via ${nameOf(path[0].to)} — ${verb}${ctx}`;
}
