#!/usr/bin/env node
// Builds the game data for /apps/librequake/ from the pinned LibreQuake release.
//
//   node scripts/build-librequake-data.mjs
//
// The data (~78 MB) is gitignored, like public/64/: this script is the record of
// exactly what ships. It downloads the release once into assets-too-big-for-pages/,
// checks its sha256, and writes:
//   public/apps/librequake/id1/pak0.pak.bin … pakN.pak.bin   (re-split under the 25 MB Pages cap)
//   public/apps/librequake/id1/media/quake02.ogg …   (music, renamed to CD-track names)
//
// Re-splitting is safe: Quake reads pak0..pakN in order and later paks override
// earlier ones, so each source pak is cut into consecutive chunks without
// reordering, and chunks never mix two source paks.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = "https://github.com/lavenderdotpet/LibreQuake/releases/download/v0.09-beta/lite.zip";
const SHA256 = "428e736b2f01d953e09a08c60bee975bdc4a0ac2219e97fa095c8af41754da83";
const CACHE = path.join(ROOT, "assets-too-big-for-pages", "librequake");
const OUT = path.join(ROOT, "public", "apps", "librequake", "id1");
const LIMIT = 24 * 1000 * 1000; // under Cloudflare Pages' 25 MB per-file cap, decimal reading

fs.mkdirSync(CACHE, { recursive: true });
const zip = path.join(CACHE, "lite.zip");
if (!fs.existsSync(zip)) {
  console.log("downloading", RELEASE);
  execFileSync("curl", ["-sSL", "--fail", "-o", zip, RELEASE], { stdio: "inherit" });
}
const sum = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
if (sum !== SHA256) throw new Error(`lite.zip sha256 ${sum} != pinned ${SHA256}`);

const src = path.join(CACHE, "lite");
if (!fs.existsSync(path.join(src, "id1", "pak0.pak"))) execFileSync("unzip", ["-o", "-q", zip, "-d", CACHE]);

function readPak(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "PACK") throw new Error(file + " is not a pak");
  const ofs = buf.readUInt32LE(4), len = buf.readUInt32LE(8), out = [];
  for (let i = 0; i < len / 64; i++) {
    const e = ofs + i * 64;
    const name = buf.subarray(e, e + 56);
    const pos = buf.readUInt32LE(e + 56), size = buf.readUInt32LE(e + 60);
    out.push({ name, data: buf.subarray(pos, pos + size) });
  }
  return out;
}

function writePak(file, entries) {
  const dirSize = entries.length * 64;
  let pos = 12;
  const dir = Buffer.alloc(dirSize);
  entries.forEach((e, i) => {
    e.name.copy(dir, i * 64);
    dir.writeUInt32LE(pos, i * 64 + 56);
    dir.writeUInt32LE(e.data.length, i * 64 + 60);
    pos += e.data.length;
  });
  const head = Buffer.alloc(12);
  head.write("PACK", 0, "latin1");
  head.writeUInt32LE(pos, 4);
  head.writeUInt32LE(dirSize, 8);
  fs.writeFileSync(file, Buffer.concat([head, ...entries.map((e) => e.data), dir]));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "media"), { recursive: true });

const chunks = [];
for (const name of ["pak0.pak", "pak1.pak"]) {
  let cur = [], size = 0;
  for (const e of readPak(path.join(src, "id1", name))) {
    const n = e.data.length + 64;
    if (cur.length && size + n > LIMIT - 12) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += n;
  }
  if (cur.length) chunks.push(cur);
}
// Served as pakN.pak.bin: Cloudflare edge-caches .bin (and only cached
// responses honour the Range requests the engine reads paks with); .pak is
// served uncached and whole. launcher.js sets the matching pakSuffix.
chunks.forEach((c, i) => writePak(path.join(OUT, `pak${i}.pak.bin`), c));
const launcher = fs.readFileSync(path.join(ROOT, "public", "apps", "librequake", "launcher.js"), "utf8");
if (!launcher.includes(`pakCount: ${chunks.length},`)) throw new Error(`wrote ${chunks.length} paks: update pakCount in launcher.js`);

// Loose config files the release keeps beside the paks (its default.cfg execs
// them). autoexec.cfg is ours and empty: it stops a 404 on every boot.
for (const f of fs.readdirSync(path.join(src, "id1"))) {
  if (/\.cfg$/i.test(f)) fs.copyFileSync(path.join(src, "id1", f), path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, "autoexec.cfg"), "");
// config.cfg too: the engine reads the visitor's saved settings from
// localStorage first, so this empty file only answers the very first boot.
fs.writeFileSync(path.join(OUT, "config.cfg"), "");

// The v0.09-beta game code precaches sound/player/slimbrn2.wav, which the
// release doesn't contain. A silent 0.1 s WAV stops a 404 on every map load.
{
  const rate = 11025, n = 1102, wav = Buffer.alloc(44 + n, 0x80);
  wav.write("RIFF", 0, "latin1");
  wav.writeUInt32LE(36 + n, 4);
  wav.write("WAVEfmt ", 8, "latin1");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "latin1");
  wav.writeUInt32LE(n, 40);
  fs.mkdirSync(path.join(OUT, "sound", "player"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "sound", "player", "slimbrn2.wav"), wav);
}

const music = path.join(src, "id1", "music");
for (const f of fs.readdirSync(music).sort()) {
  const m = /^track(\d\d)\.ogg$/.exec(f);
  if (m) fs.copyFileSync(path.join(music, f), path.join(OUT, "media", `quake${m[1]}.ogg`));
}

let total = 0;
for (const f of [...fs.readdirSync(OUT).map((f) => path.join(OUT, f)), ...fs.readdirSync(path.join(OUT, "media")).map((f) => path.join(OUT, "media", f))]) {
  const st = fs.statSync(f);
  if (!st.isFile()) continue;
  if (st.size > LIMIT) throw new Error(`${f} is ${st.size} bytes, over the cap`);
  total += st.size;
  console.log(path.relative(ROOT, f), st.size);
}
console.log(`total ${(total / 1e6).toFixed(1)} MB`);
