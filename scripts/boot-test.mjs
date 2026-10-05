#!/usr/bin/env node
// Does a DOS game actually draw something, headless?
//
//   node scripts/boot-test.mjs <slug> [<slug>…]          # every slug's bundle
//   node scripts/boot-test.mjs --all-dos                  # every hosted DOS title
//   ... --wait 25 --keys Enter,Space --shot --headed
//
// A page may say "play" only after this passes. It serves public/ itself (no
// wrangler needed), opens a bare page holding the DOS embed for
// /apps/<slug>/<slug>.zip — so a bundle can be tested before its /run/ page
// exists — clicks Play, waits, then judges the emulator's own canvas buffer.
//
// Why the canvas buffer and not a screenshot: a page screenshot of a dead
// emulator still shows the page around it. A canvas that is still 300x150 never
// received a frame; one with fewer than --colours distinct colours is a black
// screen or a bare DOS prompt. The DOS prompt case matters: a missing entry exe
// leaves a perfectly healthy emulator sitting at C:\>.
//
// --keys sends key presses (comma-separated Playwright key names) after the
// wait, then waits again: for titles that sit on a "press any key" screen with
// little colour. --shot writes the final canvas to public/run/<slug>/screenshot.png
// at 2x, the same image the page then shows, so it cannot drift from what
// the test saw.
//
// Per-title settings live with the title's source in scripts/dos-sources.json:
// `bootColours` for CGA and text-mode games, whose real title screen has 2–4
// colours (eyeball the shot once, then record it), and `bootKeys` for titles
// that wait on a "press any key" screen. Command-line flags override them.
//
// Playwright is resolved from this machine rather than declared: the site has
// no package.json and should keep it that way. Set PLAYWRIGHT_CORE to a
// playwright-core directory if it isn't found.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const WAIT = parseFloat(flag("wait", "25")) * 1000;
const KEYS_FLAG = flag("keys", null);
const COLOURS_FLAG = flag("colours", null);
const SOURCES = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "dos-sources.json"), "utf8")); } catch { return {}; } })();
const valued = new Set(["wait", "colours", "keys"]);
const slugs = has("all-dos")
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "app-pages.json"), "utf8"))
      .filter((p) => p.dosRuntime && p.appUrl).map((p) => p.slug)
  : argv.filter((a, i) => !a.startsWith("--") && !valued.has((argv[i - 1] || "").replace(/^--/, "")));
if (!slugs.length) {
  console.error("usage: node scripts/boot-test.mjs <slug>… | --all-dos [--wait s] [--keys a,b] [--shot] [--headed]");
  process.exit(2);
}

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, "playwright-core",
    path.join(homedir(), "Downloads/DarwinWeb/node_modules/playwright-core")].filter(Boolean);
  for (const t of tries) {
    try {
      const spec = t.includes("/") ? pathToFileURL(createRequire(path.join(t, "x.js")).resolve(t)).href : t;
      return (await import(spec)).default ?? (await import(spec));
    } catch {}
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core");
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
  ".css": "text/css", ".json": "application/json", ".zip": "application/zip", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const m = url.pathname.match(/^\/_boot\/([a-z0-9-]+)\/$/);
    if (m) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><meta charset="utf-8"><title>boot ${m[1]}</title>
<div id="dos-embed" data-app-url="/apps/${m[1]}/${m[1]}.zip" data-app-name="${m[1]}" data-slug="boot-test-${m[1]}"></div>
<script src="/dos-embed.js"></script>`);
      return;
    }
    let file = path.join(PUB, decodeURIComponent(url.pathname));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const { chromium } = await loadPlaywright();
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: !has("headed"), args: ["--autoplay-policy=no-user-gesture-required"] });

let failed = 0;
for (const slug of slugs) {
  const zip = path.join(PUB, "apps", slug, `${slug}.zip`);
  if (!fs.existsSync(zip)) { console.log(`✗ ${slug}: no bundle at public/apps/${slug}/${slug}.zip`); failed++; continue; }
  const KEYS = (KEYS_FLAG ?? (SOURCES[slug]?.bootKeys || []).join(",")).split(",").filter(Boolean);
  const MIN_COLOURS = parseInt(COLOURS_FLAG ?? SOURCES[slug]?.bootColours ?? 6, 10);
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  try {
    await page.goto(`${base}/_boot/${slug}/`, { waitUntil: "domcontentloaded" });
    await page.click("#dos-play", { timeout: 10000 });
    await page.waitForTimeout(WAIT);
    if (KEYS.length) {
      await page.click("#dos-canvas").catch(() => {});
      for (const k of KEYS) { await page.keyboard.press(k); await page.waitForTimeout(1500); }
      await page.waitForTimeout(Math.min(WAIT, 10000));
    }
    const r = await page.evaluate(() => {
      const c = document.getElementById("dos-canvas");
      if (!c) return { err: "no #dos-canvas" };
      const { width: w, height: h } = c;
      if (w === 300 && h === 150) return { w, h, colours: 0 };
      const d = c.getContext("2d").getImageData(0, 0, w, h).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return { w, h, colours: seen.size };
    });
    const ok = !r.err && r.colours >= MIN_COLOURS;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${slug}: ${r.err || `${r.w}x${r.h}, ${r.colours} colours`}${errors.length ? ` — page errors: ${errors.slice(0, 2).join(" | ")}` : ""}`);
    const shotDir = has("shot") && ok ? path.join(PUB, "run", slug) : path.join(ROOT, "assets-too-big-for-pages", "boot-shots");
    fs.mkdirSync(shotDir, { recursive: true });
    const png = await page.evaluate(() => {
      const c = document.getElementById("dos-canvas");
      const out = document.createElement("canvas");
      out.width = c.width * 2; out.height = c.height * 2;
      const ctx = out.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, 0, 0, out.width, out.height);
      return out.toDataURL("image/png").split(",")[1];
    }).catch(() => null);
    if (png) fs.writeFileSync(path.join(shotDir, has("shot") && ok ? "screenshot.png" : `${slug}.png`), Buffer.from(png, "base64"));
  } catch (e) {
    failed++;
    console.log(`✗ ${slug}: ${e.message.split("\n")[0]}`);
  }
  await page.close();
}
await browser.close();
server.close();
console.log(failed ? `${failed} of ${slugs.length} failed` : `all ${slugs.length} drew a picture`);
process.exit(failed ? 1 : 0);
