// scripts/stamp-sw-version.mjs
//
// The service worker (client/public/sw.js) caches static assets cache-first
// under a fixed CACHE_NAME. That cache is only ever cleared when CACHE_NAME
// itself changes (see the 'activate' handler in sw.js) — previously that was
// a hardcoded string ('lenory-cache-v6') that had to be bumped BY HAND in
// every commit that changed client code, or users' browsers/PWA installs
// would keep serving old cached assets forever after a deploy, which is a
// real, concrete way to get exactly a "blank page after we shipped changes"
// symptom: the SW's own install/activate lifecycle still runs, but any
// static asset it already had cached under the old (unchanged) CACHE_NAME is
// never invalidated, so a client can end up running a mix of new and stale
// JS chunks.
//
// This script runs after `vite build` and stamps a fresh, always-unique
// version (current UTC timestamp) into dist/public/sw.js, replacing the
// __BUILD_VERSION__ placeholder in the source file. Every deploy now
// automatically gets its own CACHE_NAME with zero manual steps — the
// service worker's own 'activate' handler already deletes any cache whose
// name doesn't match the new one.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.join(__dirname, "..", "dist", "public", "sw.js");

if (!existsSync(swPath)) {
  console.warn(`[stamp-sw-version] ${swPath} not found — skipping (nothing to stamp)`);
  process.exit(0);
}

const version = new Date().toISOString().replace(/[:.]/g, "-");
const content = readFileSync(swPath, "utf8");

if (!content.includes("__BUILD_VERSION__")) {
  console.warn("[stamp-sw-version] __BUILD_VERSION__ placeholder not found in sw.js — is client/public/sw.js still using it?");
  process.exit(0);
}

writeFileSync(swPath, content.replaceAll("__BUILD_VERSION__", version));
console.log(`[stamp-sw-version] Stamped service worker cache as lenory-cache-${version}`);
