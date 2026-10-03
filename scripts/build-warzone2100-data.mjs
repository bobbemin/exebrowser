#!/usr/bin/env node
// Builds /apps/warzone2100/ from the official Warzone 2100 4.7.0 web release.
//
//   node scripts/build-warzone2100-data.mjs
//
// The binaries (~87 MB) are gitignored, like public/64/ and LibreQuake: this
// script is the record of exactly what ships. It downloads the release once into
// assets-too-big-for-pages/, checks its sha256, and writes into
// public/apps/warzone2100/:
//
//   warzone2100.wasm                       (13.5 MB, unchanged)            ignored
//   warzone2100.data.part0 … partN         (64.4 MB bundle, cut <= 20 MiB) ignored
//   warzone2100.parts.json                 (part sizes + sha256 + total)   tracked
//   warzone2100.js                         (upstream glue + one patch)     tracked
//   pkg/music/warzone2100-music.{js,data}  (optional music package)        .data ignored
//   pkg/terrain_overrides/warzone2100-terrain-classic.{js,data}            .data ignored
//   assets/*.png, favicon.ico              (upstream icons)                tracked
//
// index.html, NOTICE.md and COPYING are hand-maintained and not touched here.
//
// Why the data is split: Cloudflare Pages refuses files over 25 MB. The glue
// fetches "warzone2100.data" in one request; the patch below makes that one
// request read the parts listed in warzone2100.parts.json and hand the
// glue a single concatenated stream, so the rest of the loader (progress bar,
// IndexedDB package cache, file unpacking) is untouched.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "4.7.0";
const RELEASE = `https://github.com/Warzone2100/warzone2100/releases/download/${VERSION}/warzone2100_web_wasm32_archive.zip`;
const SHA256 = "f729df690038511e0dee662554475a9a9a7c8a9488a268d647b93e7953820ee3";
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "warzone2100");
const OUT = path.join(ROOT, "public", "apps", "warzone2100");
const PART = 20 * 1024 * 1024; // 20 MiB, comfortably under the 25 MB Pages cap
const LIMIT = 20 * 1024 * 1024;
const LIMIT_EXEMPT = new Set(["warzone2100.wasm"]); // 13.5 MB, under the Pages cap

fs.mkdirSync(CACHE, { recursive: true });
const zip = path.join(CACHE, "warzone2100_web_wasm32_archive.zip");
if (!fs.existsSync(zip)) {
  console.log("downloading", RELEASE);
  execFileSync("curl", ["-sSL", "--fail", "-o", zip, RELEASE], { stdio: "inherit" });
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sum = sha(fs.readFileSync(zip));
if (sum !== SHA256) throw new Error(`release zip sha256 ${sum} != pinned ${SHA256}`);

const src = path.join(CACHE, VERSION);
if (!fs.existsSync(path.join(src, "warzone2100.data"))) {
  fs.mkdirSync(src, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zip, "-d", src]);
}

// Wipe only what this script owns, so index.html / NOTICE.md / COPYING survive.
for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
  if (/^warzone2100\.(wasm|js|data\.part\d+|parts\.json)$/.test(f)) fs.rmSync(path.join(OUT, f));
}
fs.rmSync(path.join(OUT, "pkg"), { recursive: true, force: true });
fs.rmSync(path.join(OUT, "assets"), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copy = (rel, to = rel) => {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.copyFileSync(path.join(src, rel), path.join(OUT, to));
};

// 1. wasm, music and terrain packages, icons: unchanged.
copy("warzone2100.wasm");
for (const f of ["warzone2100-music.js", "warzone2100-music.data"]) copy(`pkg/music/${f}`);
for (const f of ["warzone2100-terrain-classic.js", "warzone2100-terrain-classic.data"]) copy(`pkg/terrain_overrides/${f}`);
for (const f of fs.readdirSync(path.join(src, "assets"))) if (/\.(png|ico)$/.test(f)) copy(`assets/${f}`);

// 2. The data bundle, cut into parts. The ?v= in each part's URL is a content
// hash, so _headers can mark the parts immutable without a rebuild ever being
// served a stale part (the manifest itself is short-cached).
const data = fs.readFileSync(path.join(src, "warzone2100.data"));
const parts = [];
for (let off = 0, i = 0; off < data.length; off += PART, i++) {
  const buf = data.subarray(off, Math.min(off + PART, data.length));
  const name = `warzone2100.data.part${i}`;
  fs.writeFileSync(path.join(OUT, name), buf);
  parts.push({ name, url: `${name}?v=${sha(buf).slice(0, 12)}`, size: buf.length });
}
fs.writeFileSync(
  path.join(OUT, "warzone2100.parts.json"),
  JSON.stringify({ release: VERSION, total: data.length, sha256: sha(data), parts }, null, 2) + "\n",
);

// 3. The glue, with one patch: fetchRemotePackage's fetch(packageName) goes
// through wzFetchPackage, which serves warzone2100.data from the parts and
// leaves every other package (music, terrain) on plain fetch.
const HELPER = `function wzFetchPackage(url){if(!/(^|\\/)warzone2100\\.data$/.test(url))return fetch(url);var abs=new URL(url,location.href);return fetch(new URL("warzone2100.parts.json",abs)).then(function(r){if(!r.ok)throw new Error(r.status+": "+r.url);return r.json()}).then(function(m){var pending=m.parts.map(function(p){return fetch(new URL(p.url,abs)).then(function(r){if(!r.ok)throw new Error(r.status+": "+r.url);return r})});var i=0,reader=null,seen=0;var stream=new ReadableStream({async pull(c){for(;;){if(!reader){if(i>=pending.length){if(seen!==m.total)throw new Error("warzone2100.data: got "+seen+" of "+m.total+" bytes");c.close();return}reader=(await pending[i++]).body.getReader()}var x=await reader.read();if(x.done){reader=null;continue}seen+=x.value.length;c.enqueue(x.value);return}},cancel(){pending.forEach(function(p){p.then(function(r){r.body.cancel()},function(){})})}});return new Response(stream,{headers:{"Content-Length":String(m.total)}})})}`;
let glue = fs.readFileSync(path.join(src, "warzone2100.js"), "utf8");
const SITE = "function fetchRemotePackage(packageName,packageSize,callback,errback){Module[\"dataFileDownloads\"]??={};fetch(packageName)";
const n = glue.split(SITE).length - 1;
if (n !== 1) throw new Error(`glue patch site found ${n} times, expected 1: has the release changed?`);
glue = glue.replace(SITE, HELPER + SITE.replace(/fetch\(packageName\)$/, "wzFetchPackage(packageName)"));
fs.writeFileSync(path.join(OUT, "warzone2100.js"), glue);

// 4. Size check, and a listing of what was written.
let total = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(OUT)) {
  const size = fs.statSync(f).size;
  if (size > LIMIT && !LIMIT_EXEMPT.has(path.basename(f))) throw new Error(`${f} is ${size} bytes, over 20 MiB`);
  if (size > 25 * 1000 * 1000) throw new Error(`${f} is ${size} bytes, over the Pages cap`);
  total += size;
  console.log(path.relative(ROOT, f), size);
}
console.log(`total ${(total / 1e6).toFixed(1)} MB in ${parts.length} data parts`);
