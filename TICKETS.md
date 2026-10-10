# Vouch — MVP hardening backlog

Working tickets to take the prototype from "demonstrates the idea" to "solid MVP":
tested, versioned, hardened against bad input, and packageable. Checked off as
implemented and committed in this session.

| ID | Ticket | Why it matters for an MVP | Status |
|----|--------|---------------------------|--------|
| VOUCH-1 | Initialize git repo, `.gitignore`, baseline commit | Nothing is "shipped" without version history | ✅ |
| VOUCH-2 | Referral packet TTL — capacity returns on expiry, not just decline | ARCHITECTURE.md §6 named this gap explicitly: a packet nobody actions holds a slot forever today | ✅ |
| VOUCH-3 | API input validation on every write endpoint | The engine is only as trustworthy as the API in front of it — malformed input should 400, not 500 or corrupt state | ✅ |
| VOUCH-4 | Basic rate limiting on the public API | An MVP exposed to a reviewer (or the internet) with zero abuse protection is not production-shaped | ✅ |
| VOUCH-5 | Environment config via `.env` — token secret, port | `VOUCH_TOKEN_SECRET` currently defaults to a placeholder in source; an MVP should not ship a real deployment on a hardcoded secret | ✅ |
| VOUCH-6 | CI — GitHub Actions running the full test suite on every push/PR | "Tests pass on my machine" is not a solid MVP claim; a green CI badge is | ✅ |
| VOUCH-7 | Extension packaging script — reproducible `.zip` build | Distribution needs a single command, not "zip the folder by hand and hope" | ✅ |
| VOUCH-8 | Full verification pass — all tests, both servers boot, every endpoint smoke-tested, tagged `v0.1.0-mvp` | The actual "is this done" gate | ✅ |

Each ticket landed as its own commit so the history itself documents the build.
See `git log --oneline` for the full sequence.

## The bug the verification pass actually found

VOUCH-8 was supposed to be a confirmation step. It found a real, significant
bug instead: `buildSeed()` in `seed.js` returned several collections
(`referralRequests` chief among them) as **references to module-level const
arrays**, not copies. `db.insert()`/`db.update()` mutate whatever object
`buildSeed()` hands back — so those mutations were landing on the shared
template itself. The result: `db.reset()` (and `POST /api/admin/reset`, and
the console's own "↺ Restore seed data" button) appeared to work but, within
a single running process, kept returning the *same already-polluted* data on
every subsequent call. It took a from-scratch process restart to actually
see clean seed data — which is exactly why it hid successfully through six
prior tickets' worth of `npm run seed && npm test` cycles: the seed script
runs as a fresh process every time, so the file on disk looked clean even
though the bug was real.

Found by literally reloading the running app in a browser and reading what
came back — not by unit tests, because every existing test happened to
`db.reset()` in a way that coincidentally looked correct in isolation. Fixed
with one `structuredClone()` in `buildSeed()`, which closes the entire class
of bug (every current and future collection) rather than patching the one
array that got caught. A regression test (`db.reset() genuinely restores
seed state after a write...`) now guards it specifically.

This is the reason a "full verification pass" ticket earns its place in a
real backlog: it is not a checkbox, it is where bugs that hide inside
"tests pass" actually surface.

## Accepted risks (tracked, not silently ignored)

- **`qs` moderate/high advisories** (via `express` → `body-parser` → `qs`): no
  fixed version exists yet in the 6.x line express currently depends on;
  `npm audit fix` cannot close this without forcing an `express` 5.x major
  bump, which is out of scope for this hardening pass. Re-check with
  `npm audit` periodically; take the fix once one lands in express 4.x.
- **`esbuild`/`vite` dev-server advisory**: affects only `vite`'s local dev
  server (a malicious website could read dev-server responses); does not
  ship in the production build. Fixing requires a breaking `vite` 8.x bump.
  Deferred — not a risk to the built artifact or the running API.

---

# Batch 2 — make it measurable

Batch 1 made the prototype solid. Batch 2 is about evidence: the pieces a
real pilot needs, and an honest way to measure Shield.

| ID | Ticket | Why | Status |
|----|--------|-----|--------|
| VOUCH-9 | Student-side tracking — "My referrals" | ENGINEERING.md §1 lists it as a surface; it was never built. A student who sends a packet and sees nothing afterwards is back to shouting into a void. | ✅ |
| VOUCH-10 | Shield evaluation harness + fixes it surfaced | No accuracy claim was measurable before this. | ✅ |
| VOUCH-11 | Pilot metrics and CSV export | Response rate, referral rate, and time to decision are the numbers a pilot exists to produce. | ✅ |
| VOUCH-12 | Pilot roster import + participant switcher | The app is hardwired to one seeded student. A real pilot needs real participants loaded from a file. | ☐ next |
| VOUCH-13 | Selector resolver fixture tests | IMPLEMENTATION.md Track A.5 — the extension's resilience claim is currently untested. | ☐ |
| VOUCH-14 | Extension: stale-mount teardown and per-tab response cache | IMPLEMENTATION.md Track A.4. | ☐ |

## What VOUCH-10 found

The first run of the harness, scoring on message content alone, flagged
**all 12 legitimate messages**. Four separate causes, each fixed in its own
commit with the measured effect:

| Fix | Flagged precision | Flagged recall |
|-----|-------------------|----------------|
| Baseline | 50% | 100% |
| Unknown sender data scored as neutral instead of as "unverified" | 71% | 83% |
| Email local part no longer read as a domain; personal mailbox counted once | 77% | 83% |
| Money rule ignores "we never charge a fee" style disclaimers | 100% | 83% |
| Obfuscated wording ("r3gistration f-e-e", "G-Pay") is read | 100% | 92% |

The first cause mattered most: it meant the browser extension, which can
never see verification state, showed a warning on every conversation.

Recall fell from 100% to 92% along the way, and that is the honest
direction: the baseline "caught" all fraud only because it flagged
everything. One fraud message is still missed on purpose (see README,
"Measuring Shield").

These numbers come from a synthetic set the rules were tuned against. They
are a regression floor, not a claim about real-world accuracy.
