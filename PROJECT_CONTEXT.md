# Project context — handoff

Short state file. Read this first in a new session; update it when a ticket closes.

## State (2026-10-10)

- Repo: `github.com/n-3-0-l-d-3-v/linkedIn`, branch `main`, public. Tag `v0.1.0-mvp` marks the end of batch 1.
- Batch 1 (VOUCH-1 to 8, hardening) and VOUCH-9, 10, 11 of batch 2 are done. Backlog and findings: [TICKETS.md](TICKETS.md).
- 51 tests, all passing. CI runs them plus the web build and extension packaging on every push.

## Next step

**VOUCH-12 — pilot roster import + participant switcher.** The console is hardwired to the seeded student `stu_neil` (constant `STUDENT_ID` in `web/src/views/StudentView.jsx`, `TrackView.jsx`, `ShieldView.jsx`) and to fictional companies in `server/seed.js`. A real pilot needs participants, jobs, and affiliations loaded from a file, and a way to choose who you are. Without this the pilot metrics endpoint only ever measures seed data.

After that: VOUCH-13 (selector resolver fixture tests), VOUCH-14 (extension stale-mount teardown and caching).

## How to work in this repo

- One commit per logical change, pushed straight away. No Co-Authored-By trailers. Author email is the GitHub noreply address in the repo's local git config.
- `npm test` before every commit. `npm run eval:shield` after any change to `server/engine/shield.js`.
- Run servers with API first, then web. Starting both at once makes the page's first request fail with a 500 that looks like a bug and is not.

## Gotchas

- **The API server does not hot-reload.** After editing anything under `server/`, restart it, or you are testing old code. On Windows, `pkill -f "node server/index.js"` misses a server started as `node index.js` from `server/`; use `Get-Process node | Stop-Process -Force`.
- **`server/data/db.json` is gitignored and written by the running server.** Reset with the ↺ button, `POST /api/admin/reset`, or `npm run seed`.
- **Shield scores "unknown" and "false" differently.** A caller with no sender data must omit the fields (or send null), not send `false`. Sending `false` asserts the account is unverified and adds the full penalty.
- **The Shield eval numbers are a regression floor, not an accuracy claim.** The set is synthetic and the rules were tuned against it. Do not quote them outside the repo; quote numbers from real collected messages.
- `archiver` is pinned to v7. v8 has a different API and breaks `scripts/package-extension.mjs`.
- Two dependency advisories are accepted and documented in TICKETS.md (`qs` via express, `esbuild` via vite). `npm audit fix --force` would pull breaking major versions.

## Not built, by design or not yet

- No authentication. Anyone who can reach the API can act as anyone. Fine for a supervised pilot on one machine, not for anything shared.
- The extension maps every real LinkedIn job page onto one seeded requisition; it cannot read the real job. It has never been exercised against live linkedin.com in this repo's history.
- Storage is a JSON file. The warm-path graph is rebuilt on every request.
