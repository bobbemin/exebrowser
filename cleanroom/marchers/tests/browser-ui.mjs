// Marchers browser test: drives the real UI in headless Chrome.
// Needs puppeteer-core installed OUTSIDE the repo, e.g. in a scratch directory:
//   mkdir /tmp/pt && cd /tmp/pt && npm i puppeteer-core && cp <this file> . && \
//   (cd <repo> && python3 -m http.server 8771 --directory public &) && \
//   REPO=<repo> node browser-ui.mjs
// Checks: zero console errors, the canvas draws after starting level 1, assigning a job by
// clicking a marcher, pause freezes the sim and fast-forward speeds it up, the results card,
// level unlock, a 360 px phone layout with touch assignment, and an iframe embed.
// Also writes the 960x600 screenshot (OUT_PNG) from a mid-level moment of a recorded solution.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8771';
const URL0 = BASE + '/apps/marchers/';
const REPO = process.env.REPO || '/Users/nakas/Documents/WineOnline';
const OUT = process.env.OUT || '.';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = []; let failed = 0;
const check = (ok, what, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(tag + ' console: ' + m.text()); });
  page.on('requestfailed', r => errors.push(tag + ' request failed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push(tag + ' HTTP ' + r.status() + ' ' + r.url()); });
};

// ---------------- desktop ----------------
const page = await browser.newPage();
watch(page, 'desktop');
await page.setViewport({ width: 960, height: 600 });
await page.goto(URL0, { waitUntil: 'networkidle0' });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'networkidle0' });
check(!!(await page.$('#cStart')), 'intro card shows on first load', await page.$eval('#introTitle', e => e.textContent));
await page.click('#cStart');
await sleep(1500);
const blank = await page.evaluate(() => {
  const c = document.getElementById('view'), g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); let lit = 0;
  for (let i = 0; i < d.length; i += 4 * 7) { seen.add((d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4)); if (d[i] + d[i + 1] + d[i + 2] > 30) lit++; }
  return { colours: seen.size, lit, w: c.width, h: c.height };
});
check(blank.colours > 40 && blank.lit > 1000, 'canvas is drawn (non-blank) after starting level 1', JSON.stringify(blank));

// wait for the first marcher to land and walk on the shelf
await page.waitForFunction(() => { const s = window.marchers.sim; return s.marchers[0] && s.marchers[0].state === 'WALKING' && s.marchers[0].x > 130; }, { timeout: 20000 });
await page.click('#pause'); await sleep(100);
const screenOf = async (id) => page.evaluate((id) => {
  const a = window.marchers, R = a.renderer, m = a.sim.marchers[id], r = document.getElementById('view').getBoundingClientRect();
  if (m.x - R.cam.x < 20 || m.x - R.cam.x > R.vw - 20) { R.centerOn(m.x, a.sim.h / 2); }
  return { x: r.left + (m.x - R.cam.x) * R.zoom + R.zoom / 2, y: r.top + (m.y - 5 - R.cam.y) * R.zoom };
}, id);
// pause freezes everything
const t1 = await page.evaluate(() => window.marchers.sim.tick);
await sleep(700);
const t2 = await page.evaluate(() => window.marchers.sim.tick);
check(t1 === t2, 'pause freezes the simulation', `tick ${t1} -> ${t2}`);
check(await page.$eval('#pausedTag', e => !e.classList.contains('hidden')), 'paused tag visible');
// assign the Driller by clicking the marcher (allowed while paused)
const before = await page.evaluate(() => ({ n: window.marchers.sim.skills.digger, role: window.marchers.role }));
const p0 = await screenOf(0);
await page.mouse.move(p0.x, p0.y); await sleep(80);
await page.mouse.click(p0.x, p0.y); await sleep(120);
const after = await page.evaluate(() => ({ n: window.marchers.sim.skills.digger, st: window.marchers.sim.marchers[0].state }));
check(before.role === 'digger' && after.n === before.n - 1 && after.st === 'DIGGING', 'clicking a marcher assigns the selected job', JSON.stringify({ before, after }));
check(await page.$eval('#roles .role.on .n', e => e.textContent) === String(after.n), 'toolbar count updates');
// selecting a role via the toolbar and keyboard
await page.click('#roles .role[data-role="builder"]');
check(await page.evaluate(() => window.marchers.role) === 'builder', 'toolbar click selects a role');
await page.keyboard.press('8');
check(await page.evaluate(() => window.marchers.role) === 'digger', 'number key selects a role');
// release rate buttons
const rr0 = await page.evaluate(() => window.marchers.sim.rr);
await page.click('#rrUp'); await page.click('#rrUp'); await page.click('#rrDown');
check(await page.evaluate(() => window.marchers.sim.rr) === rr0 + 1, 'release-rate + and − work', `${rr0} -> ${await page.evaluate(() => window.marchers.sim.rr)}`);
await page.click('#rrDown'); await page.click('#rrDown');
check(await page.evaluate(() => window.marchers.sim.rr) === rr0, 'release rate never goes below the minimum');
// unpause: normal speed, then fast-forward
await page.click('#pause'); await sleep(200);
let a = await page.evaluate(() => window.marchers.sim.tick); await sleep(1000);
let b = await page.evaluate(() => window.marchers.sim.tick);
const normal = b - a;
await page.click('#ff'); await sleep(200);
a = await page.evaluate(() => window.marchers.sim.tick); await sleep(1000);
b = await page.evaluate(() => window.marchers.sim.tick);
const fast = b - a;
check(normal >= 12 && normal <= 22, 'normal speed is about 17 ticks per second', `${normal}/s`);
check(fast >= normal * 3.5, 'fast-forward runs several times faster', `${fast}/s`);
await page.screenshot({ path: OUT + '/ui-playing.png' });
// results card
await page.waitForSelector('#verdict', { timeout: 60000 });
const verdict = await page.$eval('#verdict', e => e.textContent);
const st = await page.evaluate(() => ({ saved: window.marchers.sim.saved, needed: window.marchers.sim.needed, won: window.marchers.sim.won }));
check(st.won && /home/i.test(verdict), 'results card appears with a win', `${verdict} ${JSON.stringify(st)}`);
await page.screenshot({ path: OUT + '/ui-results.png' });
const prog = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('marchers.progress.v1')); } catch (e) { return null; } });
check(prog && prog.won && prog.won.L01 === true, 'progress saved to localStorage', JSON.stringify(prog));
await page.click('#cLevels'); await sleep(150);
const lv = await page.evaluate(() => [...document.querySelectorAll('#lvGrid button')].slice(0, 3).map(b => b.className + '|' + b.textContent));
check(!lv[1].includes('locked') && lv[2].includes('locked'), 'level 2 unlocked, level 3 still locked', JSON.stringify(lv));
await page.click('#lvGrid button[data-i="1"]'); await sleep(150);
check((await page.$eval('#introTitle', e => e.textContent)) === 'Glide Path', 'level select opens level 2');
// nuke needs a second press
await page.click('#cStart'); await page.click('#ff');
await page.waitForFunction(() => window.marchers.sim.released >= 2, { timeout: 20000 });
await page.click('#nuke'); await sleep(50);
const armed = await page.evaluate(() => ({ armed: document.getElementById('nuke').classList.contains('armed'), nuked: window.marchers.sim.nuked }));
await page.click('#nuke'); await sleep(50);
const fired = await page.evaluate(() => window.marchers.sim.nuked);
check(armed.armed && !armed.nuked && fired, 'nuke asks for a second press, then fires', JSON.stringify({ armed, fired }));
await page.waitForSelector('#verdict', { timeout: 30000 });
check(/not enough|time/i.test(await page.$eval('#verdict', e => e.textContent)), 'a lost level shows the losing card');

// ---------------- mid-level screenshot from a recorded solution ----------------
const logs = JSON.parse(readFileSync(REPO + '/cleanroom/marchers/tests/solutions.json', 'utf8'));
const SHOT = { level: +(process.env.SHOT_LEVEL || 20), tick: +(process.env.SHOT_TICK || 1390), camx: process.env.SHOT_CAMX != null ? +process.env.SHOT_CAMX : null };
await page.evaluate(async (lvl, log, tick, camx) => {
  const a = window.marchers; a.closeCard(); a.load(lvl - 1); a.start(); a.paused = true; a.syncButtons();
  a.sim.input(log);
  for (let i = 0; i < tick; i++) { a.sim.step(); a.renderer.tickEffects(); a.drainEvents(); }
  a.syncRoles(); a.role = 'builder'; a.syncRoles();
  if (camx != null) { a.renderer.cam.x = camx; a.renderer.clampCam(); }
  document.getElementById('pausedTag').classList.add('hidden');
}, SHOT.level, logs['L' + String(SHOT.level).padStart(2, '0')], SHOT.tick, SHOT.camx);
await sleep(300);
await page.screenshot({ path: OUT + '/screenshot-raw.png' });

// ---------------- phone (360 x 640, touch) ----------------
const phone = await browser.newPage();
watch(phone, 'phone');
await phone.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phone.goto(URL0 + '#level=1', { waitUntil: 'networkidle0' });
await phone.tap('#cStart');
const lay = await phone.evaluate(() => {
  const bar = document.getElementById('bar'), roles = document.getElementById('roles'), ctrls = document.getElementById('ctrls');
  const btns = [...document.querySelectorAll('#bar button')].map(b => b.getBoundingClientRect());
  return { docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, barOverflow: bar.scrollWidth - bar.clientWidth,
    rolesOverflow: roles.scrollWidth - roles.clientWidth, ctrlsOverflow: ctrls.scrollWidth - ctrls.clientWidth,
    offscreen: btns.filter(r => r.right > 360.5 || r.left < -0.5 || r.bottom > 640.5).length, minBtn: Math.min(...btns.map(r => Math.min(r.width, r.height))) };
});
check(lay.docW <= 360 && lay.docH <= 640 && lay.barOverflow <= 0 && lay.rolesOverflow <= 0 && lay.ctrlsOverflow <= 0 && lay.offscreen === 0, 'toolbar fits a 360 px phone with no page scroll', JSON.stringify(lay));
check(lay.minBtn >= 30, 'touch targets are at least 30 px', String(lay.minBtn));
await phone.waitForFunction(() => { const s = window.marchers.sim; return s.marchers[0] && s.marchers[0].state === 'WALKING' && s.marchers[0].x > 130; }, { timeout: 20000 });
await phone.evaluate(() => window.marchers.togglePause());
const pp = await phone.evaluate(() => {
  const a = window.marchers, R = a.renderer, m = a.sim.marchers[0];
  R.centerOn(m.x, a.sim.h / 2);
  const r = document.getElementById('view').getBoundingClientRect();
  return { x: r.left + (m.x - R.cam.x) * R.zoom + R.zoom / 2, y: r.top + (m.y - 5 - R.cam.y) * R.zoom };
});
await phone.touchscreen.tap(pp.x, pp.y); await sleep(150);
check(await phone.evaluate(() => window.marchers.sim.marchers[0].state) === 'DIGGING', 'tapping a marcher assigns on touch');
// drag scrolls the view
const cam0 = await phone.evaluate(() => window.marchers.renderer.cam.x);
await phone.touchscreen.touchStart(200, 300); for (let i = 1; i <= 6; i++) await phone.touchscreen.touchMove(200 - i * 20, 300); await phone.touchscreen.touchEnd();
await sleep(100);
const cam1 = await phone.evaluate(() => window.marchers.renderer.cam.x);
check(cam1 > cam0, 'dragging scrolls the view', `${cam0} -> ${cam1}`);
check(await phone.evaluate(() => window.scrollY === 0 && document.documentElement.scrollTop === 0), 'page does not scroll');
await phone.screenshot({ path: OUT + '/ui-phone.png' });

// ---------------- iframe embed ----------------
const host = await browser.newPage();
watch(host, 'iframe');
await host.setViewport({ width: 800, height: 520 });
await host.setContent(`<html><body style="margin:0;background:#222"><iframe id="f" src="${URL0}#level=1" style="width:720px;height:440px;border:0" sandbox="allow-scripts allow-same-origin"></iframe></body></html>`);
await sleep(1500);
const frame = host.frames().find(f => f.url().includes('/apps/marchers/'));
check(!!frame, 'loads inside an iframe');
if (frame) {
  await frame.click('#cStart'); await sleep(1500);
  const ft = await frame.evaluate(() => window.marchers.sim.tick);
  check(ft > 10, 'runs inside an iframe', 'tick ' + ft);
}

check(errors.length === 0, 'zero console errors', errors.join(' | '));
console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed ? 1 : 0);
