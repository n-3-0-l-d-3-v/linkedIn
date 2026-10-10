/**
 * VOUCH-5 — minimal `.env` loader.
 *
 * No dependency on `dotenv`: the format needed here is tiny (KEY=VALUE lines,
 * `#` comments, blank lines ignored) and Node's own `--env-file` flag isn't
 * used because it would tie the run command to a specific Node version and
 * complicate `npm --workspace server run dev`'s existing invocation. This
 * file must be the FIRST import in server/index.js — ES module evaluation
 * order guarantees it finishes setting process.env before any other module
 * (notably engine/tokens.js, which reads VOUCH_TOKEN_SECRET at import time)
 * gets evaluated.
 *
 * Real environment variables always win over `.env` contents — this loader
 * only fills in what isn't already set, so a deployment's actual secrets
 * manager is never shadowed by a stray `.env` file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Checked in order: the process's own working directory (how `npm run dev`
// actually launches this file, via the `server` workspace), then this file's
// own directory, then the repo root — covers running `node server/index.js`
// from the repo root too.
const candidates = [
  path.join(process.cwd(), '.env'),
  path.join(here, '.env'),
  path.join(here, '..', '.env'),
];

// Exported for unit testing — the parsing logic is what's worth verifying in
// isolation. The file-discovery-and-apply loop below it is a thin, mostly
// untestable side effect run once at import time.
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) continue;
  const parsed = parseEnvFile(fs.readFileSync(candidate, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  break; // first match wins — do not merge multiple .env files
}
