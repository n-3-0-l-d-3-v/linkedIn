/**
 * VOUCH-7 — reproducible extension packaging.
 *
 * IMPLEMENTATION.md's distribution pipeline (Track A.6) needs a single
 * command producing a versioned, deterministic .zip — not "zip the folder by
 * hand and hope you didn't include node_modules or forget content.css."
 *
 * The version comes from extension/manifest.json (the single source of
 * truth Chrome itself reads), so the output filename and the installed
 * extension's reported version can never drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// archiver ships as CommonJS with no ESM default-export interop under
// Node's strict ESM loader; createRequire is the standard bridge rather than
// pulling in an extra interop dependency for one import.
const archiver = createRequire(import.meta.url)('archiver');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(rootDir, 'extension');
const distDir = path.join(rootDir, 'dist');

// Everything Chrome actually needs to load the extension. Listed explicitly
// rather than "everything in extension/" so a stray editor swap file or a
// future test fixture dropped in that folder can never accidentally ship.
const MANIFEST_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'selectors.js',
  'popup.html',
  'popup.js',
];

function readManifest() {
  const raw = fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

function verifyManifestFilesExist() {
  const missing = MANIFEST_FILES.filter((f) => !fs.existsSync(path.join(extensionDir, f)));
  if (missing.length) {
    throw new Error(`Cannot package: missing expected file(s): ${missing.join(', ')}`);
  }
}

async function main() {
  const manifest = readManifest();
  if (!manifest.version) throw new Error('extension/manifest.json has no "version" field');

  verifyManifestFilesExist();
  fs.mkdirSync(distDir, { recursive: true });

  const outPath = path.join(distDir, `vouch-extension-v${manifest.version}.zip`);
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') reject(err); });
    archive.on('error', reject);
  });

  archive.pipe(output);
  for (const file of MANIFEST_FILES) {
    archive.file(path.join(extensionDir, file), { name: file });
  }
  await archive.finalize();
  await done;

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`Packaged extension/ → ${path.relative(rootDir, outPath)} (${sizeKb} KB, manifest v${manifest.version})`);
}

main().catch((err) => {
  console.error(`[package-extension] ${err.message}`);
  process.exit(1);
});
