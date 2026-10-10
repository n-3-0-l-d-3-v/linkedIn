# Vouch — MVP hardening backlog

Working tickets to take the prototype from "demonstrates the idea" to "solid MVP":
tested, versioned, hardened against bad input, and packageable. Checked off as
implemented and committed in this session.

| ID | Ticket | Why it matters for an MVP | Status |
|----|--------|---------------------------|--------|
| VOUCH-1 | Initialize git repo, `.gitignore`, baseline commit | Nothing is "shipped" without version history | ☐ |
| VOUCH-2 | Referral packet TTL — capacity returns on expiry, not just decline | ARCHITECTURE.md §6 named this gap explicitly: a packet nobody actions holds a slot forever today | ☐ |
| VOUCH-3 | API input validation on every write endpoint | The engine is only as trustworthy as the API in front of it — malformed input should 400, not 500 or corrupt state | ☐ |
| VOUCH-4 | Basic rate limiting on the public API | An MVP exposed to a reviewer (or the internet) with zero abuse protection is not production-shaped | ☐ |
| VOUCH-5 | Environment config via `.env` — token secret, port | `VOUCH_TOKEN_SECRET` currently defaults to a placeholder in source; an MVP should not ship a real deployment on a hardcoded secret | ☐ |
| VOUCH-6 | CI — GitHub Actions running the full test suite on every push/PR | "Tests pass on my machine" is not a solid MVP claim; a green CI badge is | ☐ |
| VOUCH-7 | Extension packaging script — reproducible `.zip` build | Distribution needs a single command, not "zip the folder by hand and hope" | ☐ |
| VOUCH-8 | Full verification pass — all tests, both servers boot, every endpoint smoke-tested, tagged `v0.1.0-mvp` | The actual "is this done" gate | ☐ |

Each ticket lands as its own commit so the history itself documents the build.
