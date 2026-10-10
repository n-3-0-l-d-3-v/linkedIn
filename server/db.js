/**
 * Storage.
 *
 * A JSON-file repository behind a narrow accessor surface. The point of the
 * narrow surface is that swapping this for the real thing is a file change,
 * not a refactor: in production every read here is a call into an existing
 * LinkedIn service (Profile, Jobs, Messaging, Identity) and every write is an
 * event onto the trust-signal topic. See ARCHITECTURE.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    state = buildSeed();
    persist();
  }
  return state;
}

function persist() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

export const db = {
  all: () => load(),
  reset() {
    state = buildSeed();
    persist();
    return state;
  },

  people: () => load().people,
  person: (id) => load().people.find((p) => p.id === id) ?? null,
  employeesAt: (companyId) => load().people.filter((p) => p.type === 'employee' && p.companyId === companyId),
  nameOf(id) {
    return this.person(id)?.name ?? id;
  },

  companies: () => load().companies,
  company: (id) => load().companies.find((c) => c.id === id) ?? null,

  jobs: () => load().jobs,
  job: (id) => load().jobs.find((j) => j.id === id) ?? null,

  affiliations: () => load().affiliations,

  referralHistoryFor: (employeeId) => load().referralHistory.filter((r) => r.referrerId === employeeId),
  spamReportsFor: (employeeId) => load().spamReports[employeeId] ?? 0,

  messages: () => load().messages,
  message: (id) => load().messages.find((m) => m.id === id) ?? null,
  messagesFor: (recipientId) => load().messages.filter((m) => m.recipientId === recipientId),

  referralRequests: () => load().referralRequests,
  referralRequest: (id) => load().referralRequests.find((r) => r.id === id) ?? null,

  insert(collection, record) {
    load()[collection].push(record);
    persist();
    return record;
  },

  update(collection, id, patch) {
    const list = load()[collection];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    persist();
    return list[idx];
  },

  /**
   * Append-only audit trail. Every scoring decision and every user action on a
   * warning is logged — this is what makes the model reviewable after the fact
   * and what a trust & safety team would actually require before shipping.
   */
  logEvent(type, payload) {
    const event = { id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, type, at: new Date().toISOString(), ...payload };
    load().events.push(event);
    persist();
    return event;
  },

  events: () => load().events,
};
