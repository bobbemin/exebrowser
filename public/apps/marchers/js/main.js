// Marchers — boot, main loop, input, cards and saved progress. All DOM lives here.
import { Sim, ROLES, S, TICKS_PER_SECOND } from './sim.js';
import { parseLevel } from './level.js';
import { LEVELS } from './levels.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { drawRoleIcon } from './art.js';

const TICK_MS = 1000 / TICKS_PER_SECOND;
const FF_TICKS = 6;
const END_LINGER = 40;
const KEY = 'marchers.progress.v1';

export const ROLE_NAME = { climber: 'Scaler', floater: 'Glider', bomber: 'Fuse', blocker: 'Stopper', builder: 'Mason', basher: 'Borer', miner: 'Delver', digger: 'Driller' };
const ROLE_TIP = {
  climber: 'climbs any tall wall it walks into', floater: 'opens a canopy on long drops', bomber: 'counts to five, then blasts a hole',
  blocker: 'stands still and turns others around', builder: 'lays a staircase of twelve bricks', basher: 'bores a level tunnel',
  miner: 'cuts a tunnel slanting downward', digger: 'drills straight down',
};
const STATE_NAME = {
  WALKING: 'Walker', FALLING: 'Falling', STEPPING_UP: 'Walker', CLIMBING: 'Scaling', HOISTING: 'Scaling', FLOATING: 'Gliding',
  BLOCKING: 'Stopper', BUILDING: 'Mason', SHRUGGING: 'Out of bricks', BASHING: 'Borer', MINING: 'Delver', DIGGING: 'Driller',
  PRE_EXPLODE: 'About to pop', EXPLODING: 'Pop', SPLATTING: 'Flattened', DROWNING: 'Sinking', BURNING: 'Scorched', EXITING: 'Home',
};

// ---------- storage (every access guarded: private windows, blocked storage, iframes) ----------
function loadProgress() {
  try { const raw = window.localStorage.getItem(KEY); const p = raw ? JSON.parse(raw) : null; if (p && typeof p === 'object') return { best: p.best || {}, won: p.won || {}, muted: !!p.muted, last: p.last | 0 }; } catch (e) { /* storage unavailable */ }
  return { best: {}, won: {}, muted: false, last: 0 };
}
function saveProgress(p) { try { window.localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch (e) { return false; } }

const $ = (id) => document.getElementById(id);
const clock = (s) => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const pct = (n, d) => Math.floor(n * 100 / d);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const app = {
  progress: loadProgress(), sound: new Sound(), renderer: null, sim: null, levelIndex: 0,
  role: 'digger', paused: false, ff: false, mode: 'menu', endCount: 0, frame: 0, nukeArmed: 0,
  pointer: null, hoverCss: null, keys: new Set(), rrHold: 0, rrHoldT: 0, lastHud: '',

  unlocked(i) { return i === 0 || !!this.progress.won[LEVELS[i - 1].id] || !!this.progress.won[LEVELS[i].id]; },

  load(i) {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    const L = LEVELS[this.levelIndex];
    this.parsed = parseLevel(L);
    this.sim = new Sim(this.parsed);
    this.renderer.attach(this.sim);
    this.layout();
    const h = this.parsed.hatches[0];
    if (L.camera && (L.camera.x || L.camera.y)) { this.renderer.cam.x = L.camera.x; this.renderer.cam.y = L.camera.y; this.renderer.clampCam(); }
    else this.renderer.centerOn(h.x + h.w / 2 + this.renderer.vw * 0.2, this.sim.h / 2);
    this.paused = false; this.ff = false; this.endCount = 0; this.nukeArmed = 0;
    const first = ROLES.find(r => this.sim.skills[r] !== 0) || 'digger';
    this.role = first;
    this.buildRoles();
    this.syncButtons();
    this.progress.last = this.levelIndex; saveProgress(this.progress);
    this.lastHud = '';
  },
  start() { this.mode = 'play'; this.closeCard(); this.paused = false; this.syncButtons(); reportPlay(); },
  restart() { this.load(this.levelIndex); this.start(); },

  // ---------- toolbar ----------
  buildRoles() {
    const box = $('roles'); box.innerHTML = '';
    ROLES.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'role'; b.dataset.role = r; b.title = `${ROLE_NAME[r]} (${i + 1}): ${ROLE_TIP[r]}`;
      b.innerHTML = `<span class="k">${i + 1}</span><canvas width="16" height="20"></canvas><span class="n"></span><span class="nm">${ROLE_NAME[r]}</span>`;
      drawRoleIcon(b.querySelector('canvas').getContext('2d'), r, 16, 20);
      b.addEventListener('click', () => this.selectRole(r));
      box.appendChild(b);
    });
    this.syncRoles();
  },
  syncRoles() {
    for (const b of $('roles').children) {
      const r = b.dataset.role, n = this.sim.skills[r];
      b.querySelector('.n').textContent = n < 0 ? '∞' : String(n);
      b.classList.toggle('on', r === this.role);
      b.classList.toggle('empty', n === 0);
      b.setAttribute('aria-pressed', r === this.role ? 'true' : 'false');
    }
  },
  selectRole(r) { this.sound.unlock(); this.role = r; this.syncRoles(); this.sound.play('select'); if (this.sim.skills[r] === 0) this.toast(`No ${ROLE_NAME[r]}s left on this level`); },
  syncButtons() {
    $('pause').classList.toggle('on', this.paused); $('ff').classList.toggle('on', this.ff);
    $('pausedTag').classList.toggle('hidden', !(this.paused && this.mode === 'play'));
    $('mute').classList.toggle('off', this.progress.muted);
    $('nuke').classList.toggle('armed', !!this.nukeArmed); $('nuke').classList.toggle('used', !!(this.sim && this.sim.nuked));
    if (this.sim) { $('rrVal').textContent = this.sim.rr; $('rrMin').textContent = 'min ' + this.sim.rrMin; }
  },
  togglePause() { if (this.mode !== 'play') return; this.paused = !this.paused; this.syncButtons(); },
  toggleFF() { if (this.mode !== 'play') return; this.ff = !this.ff; if (this.ff) this.paused = false; this.syncButtons(); },
  changeRR(d) { if (!this.sim || this.sim.ended) return; const before = this.sim.rr; this.sim.now({ rr: before + d }); if (this.sim.rr !== before) this.syncButtons(); },
  nuke() {
    if (this.mode !== 'play' || this.sim.nuked || this.sim.ended) return;
    if (!this.nukeArmed) { this.nukeArmed = performance.now(); this.syncButtons(); return; }
    this.nukeArmed = 0; this.sim.now({ nuke: true }); this.syncButtons();
  },
  toggleMute() { this.sound.unlock(); this.progress.muted = !this.progress.muted; this.sound.setMuted(this.progress.muted); saveProgress(this.progress); this.syncButtons(); },

  toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.add('hidden'), 1800);
  },

  // ---------- assignment ----------
  assignAtCss(cssX, cssY, free) {
    if (this.mode !== 'play' || this.sim.ended) return false;
    const p = this.renderer.toLevel(cssX, cssY), role = this.role;
    const target = this.sim.pickFor(p.x, p.y, role, free);
    if (target) {
      this.sim.now({ x: p.x, y: p.y, skill: role, free: !!free });
      this.drainEvents(); this.syncRoles();
      this.renderer.highlight = target;
      return true;
    }
    const under = this.sim.under(p.x, p.y).length;
    if (under) {
      this.sound.play('deny');
      if (this.sim.skills[role] === 0) this.toast(`No ${ROLE_NAME[role]}s left`);
      else this.toast(`${ROLE_NAME[role]} can't start there`);
    }
    return false;
  },
  updateHover() {
    const r = this.renderer;
    if (!this.hoverCss || this.mode !== 'play') { r.hover = null; r.highlight = null; this.info(''); return; }
    const p = r.toLevel(this.hoverCss.x, this.hoverCss.y);
    r.hover = p;
    const c = this.sim.candidates(p.x, p.y, this.keys.has('Shift'));
    r.highlight = c.primary;
    this.validHover = !!this.sim.pickFor(p.x, p.y, this.role, this.keys.has('Shift'));
    if (c.primary) {
      const m = c.primary;
      let name = STATE_NAME[m.state] || m.state;
      const flag = m.climber && m.floater ? 'Ace' : m.climber ? 'Scaler' : m.floater ? 'Glider' : '';
      if (flag && (m.state === 'WALKING' || m.state === 'FALLING' || m.state === 'STEPPING_UP')) name = flag;
      else if (flag) name += ' · ' + flag;
      this.info(`${name} ${c.count > 1 ? '(' + c.count + ' here)' : ''}`);
    } else this.info('');
  },
  info(s) { const el = $('info'); if (el.textContent !== s) el.textContent = s; },

  // ---------- sim events -> sound + effects ----------
  drainEvents() {
    const ev = this.sim.events;
    for (const e of ev) {
      this.renderer.onEvent(e);
      switch (e.type) {
        case 'spawn': this.sound.play('release'); break;
        case 'hatch': this.sound.play('hatch'); break;
        case 'assign': this.sound.play('assign'); break;
        case 'dig': case 'bash': case 'mine': this.sound.play('dig'); break;
        case 'brick': this.sound.play('brick'); break;
        case 'warn': this.sound.play('warn'); break;
        case 'splat': this.sound.play('splat'); break;
        case 'saved': this.sound.play('exit', this.sim.saved); break;
        case 'fuse': this.sound.play('fuse'); break;
        case 'boom': this.sound.play('boom'); break;
        case 'drown': this.sound.play('drown'); break;
        case 'burn': this.sound.play('burn'); break;
        case 'die': if (e.extra === 'trap') this.sound.play('trap'); break;
        case 'clank': this.sound.play('clank'); break;
        case 'open': this.sound.play('open'); break;
        case 'nuke': this.sound.play('nuke'); break;
      }
    }
    ev.length = 0;
  },
  tickOnce() {
    const k = this.ff ? FF_TICKS : 1;
    for (let i = 0; i < k; i++) {
      if (!this.sim.ended) this.sim.step();
      this.renderer.tickEffects();
      this.drainEvents();
      if (this.sim.ended) this.endCount++;
    }
    if (this.sim.ended && this.endCount >= END_LINGER && this.mode === 'play') this.finish();
    this.syncRoles();
  },

  finish() {
    this.mode = 'results';
    const s = this.sim, L = LEVELS[this.levelIndex], won = s.won, p = s.percent;
    const best = this.progress.best[L.id];
    if (best == null || p > best) this.progress.best[L.id] = p;
    if (won) this.progress.won[L.id] = true;
    saveProgress(this.progress);
    this.sound.play(won ? 'win' : 'lose');
    const usedN = Object.values(s.used).reduce((a, b) => a + b, 0);
    const last = this.levelIndex === LEVELS.length - 1;
    const verdict = won ? (s.saved === s.total ? 'Everyone home!' : 'Home safe.') : (s.endReason === 'time' ? 'Out of time.' : 'Not enough made it.');
    const line = won ? (last ? 'That was the last level. Every one of them is yours to replay.' : 'The next level is open.') : `You needed ${s.needed} of ${s.total}. Try a different plan.`;
    this.card(`
      <div class="num">Level ${this.levelIndex + 1} · ${esc(L.title)}</div>
      <div class="verdict ${won ? 'win' : 'lose'}" id="verdict">${verdict}</div>
      <div class="facts">
        <div><b>${p}%</b><small>Home</small></div><div><b>${s.neededPercent}%</b><small>Needed</small></div>
        <div><b>${s.saved}/${s.total}</b><small>Marchers</small></div><div><b>${clock(s.timeLeft)}</b><small>Time left</small></div>
      </div>
      <p>${line} Jobs handed out: ${usedN}. Best here: ${this.progress.best[L.id]}%.</p>
      <div class="actions">
        <button id="cLevels">All levels</button><button id="cRetry"${won ? '' : ' class="primary"'}>Retry</button>
        ${won && !last ? '<button id="cNext" class="primary">Next level</button>' : ''}
      </div>`);
    $('cLevels').onclick = () => this.showLevels();
    $('cRetry').onclick = () => { this.load(this.levelIndex); this.showIntro(); };
    if ($('cNext')) $('cNext').onclick = () => { this.load(this.levelIndex + 1); this.showIntro(); };
    ($('cNext') || $('cRetry')).focus();
  },

  // ---------- cards ----------
  card(html) { $('card').innerHTML = html; $('modal').classList.remove('hidden'); },
  closeCard() { $('modal').classList.add('hidden'); },
  showIntro() {
    this.mode = 'intro'; this.syncButtons();
    const L = LEVELS[this.levelIndex], s = this.sim;
    const kit = ROLES.filter(r => s.skills[r] !== 0).map(r => `<span title="${ROLE_TIP[r]}"><canvas width="16" height="20" data-icon="${r}"></canvas>${ROLE_NAME[r]} ×${s.skills[r] < 0 ? '∞' : s.skills[r]}</span>`).join('');
    this.card(`
      <div class="num">Level ${this.levelIndex + 1} of ${LEVELS.length}</div>
      <h2 id="introTitle">${esc(L.title)}</h2>
      <p>${esc(L.hint || '')}</p>
      <div class="facts">
        <div><b>${s.total}</b><small>Marchers</small></div><div><b>${s.needed}</b><small>Bring home (${s.neededPercent}%)</small></div>
        <div><b>${clock(s.timeLeft)}</b><small>Time</small></div><div><b>${s.rrMin}</b><small>Release rate</small></div>
      </div>
      <div class="kit">${kit}</div>
      <div class="actions"><button id="cLevels">All levels</button><button id="cStart" class="primary">Let them out</button></div>
      <div class="foot">Pick a job below, then click or tap a marcher. Drag the view to look around.</div>`);
    for (const c of $('card').querySelectorAll('canvas[data-icon]')) drawRoleIcon(c.getContext('2d'), c.dataset.icon, 16, 20);
    $('cStart').onclick = () => { this.sound.unlock(); this.start(); };
    $('cLevels').onclick = () => this.showLevels();
    $('cStart').focus();
  },
  showLevels() {
    const prevMode = this.mode;
    this.mode = 'menu'; this.syncButtons();
    const items = LEVELS.map((L, i) => {
      const open = this.unlocked(i), won = !!this.progress.won[L.id], best = this.progress.best[L.id];
      const sub = !open ? 'Locked' : won ? `Passed · best ${best}%` : best != null ? `Best ${best}%` : 'Not tried yet';
      return `<button data-i="${i}" class="${open ? '' : 'locked'} ${won ? 'won' : ''} ${i === this.levelIndex ? 'current' : ''}" ${open ? '' : 'aria-disabled="true"'}><span class="t">${i + 1}. ${esc(L.title)}</span><span class="s">${sub}</span></button>`;
    }).join('');
    const done = LEVELS.filter(L => this.progress.won[L.id]).length;
    this.card(`<h2>Levels</h2><div class="sub foot" style="margin-top:0">${done} of ${LEVELS.length} passed. Pass a level to open the next.</div><div class="grid" id="lvGrid">${items}</div>
      <div class="actions">${prevMode === 'paused-menu' || prevMode === 'play' ? '<button id="cBack">Back</button>' : ''}</div>`);
    for (const b of $('lvGrid').children) b.onclick = () => {
      const i = +b.dataset.i;
      if (!this.unlocked(i)) { this.toast('Pass the level before it first'); return; }
      this.load(i); this.showIntro();
    };
    if ($('cBack')) $('cBack').onclick = () => { this.closeCard(); this.mode = 'play'; this.syncButtons(); };
  },
  showMenu() {
    if (this.mode !== 'play') return;
    const was = this.paused; this.paused = true; this.mode = 'paused-menu'; this.syncButtons();
    this.card(`<h2>Paused</h2><div class="num">Level ${this.levelIndex + 1} · ${esc(LEVELS[this.levelIndex].title)}</div>
      <div class="menu-list">
        <button id="mResume">Resume</button><button id="mRestart">Restart this level</button>
        <button id="mGiveUp">Give up and see the result</button><button id="mLevels">All levels</button>
        <button id="mHelp">How to play</button>
      </div>`);
    const back = () => { this.closeCard(); this.mode = 'play'; this.paused = was; this.syncButtons(); };
    $('mResume').onclick = back;
    $('mRestart').onclick = () => this.restart();
    $('mGiveUp').onclick = () => { this.closeCard(); this.mode = 'play'; this.paused = false; this.sim.ended = true; this.sim.endReason = 'gave up'; this.endCount = END_LINGER; this.finish(); };
    $('mLevels').onclick = () => { this.mode = 'play'; this.showLevels(); };
    $('mHelp').onclick = () => this.showHelp(back);
    $('mResume').focus();
  },
  showHelp(back) {
    this.card(`<h2>How to play</h2>
      <p>Marchers drop from the hatch and walk straight ahead. They turn at walls, walk down small drops and fall from big ones. Get enough of them into the glowing doorway before the clock runs out.</p>
      <p>You can't steer them. Instead, pick a job from the bar and click or tap a marcher to hand it over. Each level gives a fixed number of each job.</p>
      <p>${ROLES.map(r => `<b>${ROLE_NAME[r]}</b>: ${ROLE_TIP[r]}.`).join(' ')}</p>
      <p>Keys: 1–8 pick a job, P or Space pauses, F fast-forwards, − and + change the release rate, arrows scroll, R restarts. Hold Shift (or long-press) to pick the marcher who is not busy.</p>
      <div class="actions"><button id="hBack" class="primary">Back</button></div>`);
    $('hBack').onclick = back;
  },

  // ---------- HUD ----------
  hud() {
    const s = this.sim;
    const txt = [s.out, pct(s.saved, s.total), s.neededPercent, s.timeLeft, s.rr].join('|');
    if (txt === this.lastHud) return;
    this.lastHud = txt;
    $('lvl').textContent = `${this.levelIndex + 1}. ${LEVELS[this.levelIndex].title}`;
    $('out').textContent = s.out;
    $('in').textContent = pct(s.saved, s.total) + '%';
    $('in').parentElement.classList.toggle('ok', s.saved >= s.needed);
    $('need').textContent = s.neededPercent + '%';
    $('time').textContent = clock(s.timeLeft);
    $('rrVal').textContent = s.rr;
  },

  layout() {
    const st = $('stage').getBoundingClientRect();
    this.renderer.resize(Math.max(40, st.width), Math.max(40, st.height), this.sim ? this.sim.h : 160);
    const mini = $('mini'), r = mini.getBoundingClientRect();
    const w = Math.max(60, Math.round(r.width)), h = Math.max(12, Math.round(r.height));
    if (mini.width !== w || mini.height !== h) { mini.width = w; mini.height = h; }
  },
};

// ---------- input ----------
function bindInput() {
  const view = $('view'), stage = $('stage');
  const local = (e) => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    app.sound.unlock();
    view.setPointerCapture && view.setPointerCapture(e.pointerId);
    const p = local(e);
    app.pointer = { id: e.pointerId, x0: p.x, y0: p.y, cam0: app.renderer.cam.x, camY0: app.renderer.cam.y, drag: false, done: false, free: e.button === 2 || e.shiftKey, type: e.pointerType };
    if (e.pointerType !== 'mouse') {
      app.hoverCss = p; app.updateHover();
      clearTimeout(app.longT);
      app.longT = setTimeout(() => { const q = app.pointer; if (q && !q.drag && !q.done) { q.done = true; app.assignAtCss(q.x0, q.y0, true); } }, 450);
    }
    e.preventDefault();
  });
  view.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (e.pointerType === 'mouse') app.hoverCss = p;
    const q = app.pointer;
    if (q && q.id === e.pointerId) {
      const dx = p.x - q.x0, dy = p.y - q.y0;
      if (!q.drag && Math.hypot(dx, dy) > 7) { q.drag = true; clearTimeout(app.longT); }
      if (q.drag) {
        const R = app.renderer;
        R.cam.x = q.cam0 - Math.round(dx / R.zoom); R.cam.y = q.camY0 - Math.round(dy / R.zoom); R.clampCam();
        if (e.pointerType !== 'mouse') app.hoverCss = null;
      }
    }
  });
  const up = (e) => {
    const q = app.pointer;
    if (!q || q.id !== e.pointerId) return;
    clearTimeout(app.longT);
    if (!q.drag && !q.done && e.type === 'pointerup') app.assignAtCss(q.x0, q.y0, q.free || app.keys.has('Shift'));
    app.pointer = null;
    if (e.pointerType !== 'mouse') setTimeout(() => { if (!app.pointer) { app.hoverCss = null; } }, 350);
  };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  view.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !app.pointer) app.hoverCss = null; });
  stage.addEventListener('wheel', (e) => { const R = app.renderer; R.cam.x += Math.round((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / R.zoom); R.clampCam(); e.preventDefault(); }, { passive: false });

  // minimap: tap or drag to move the view
  const mini = $('mini');
  const miniTo = (e) => { const r = mini.getBoundingClientRect(), R = app.renderer; R.cam.x = Math.round((e.clientX - r.left) / r.width * app.sim.w - R.vw / 2); R.clampCam(); };
  mini.addEventListener('pointerdown', (e) => { mini.setPointerCapture && mini.setPointerCapture(e.pointerId); app.miniDrag = true; miniTo(e); e.preventDefault(); });
  mini.addEventListener('pointermove', (e) => { if (app.miniDrag) miniTo(e); });
  mini.addEventListener('pointerup', () => { app.miniDrag = false; });
  mini.addEventListener('pointercancel', () => { app.miniDrag = false; });

  // controls
  const hold = (el, d) => {
    el.addEventListener('pointerdown', (e) => { app.sound.unlock(); app.changeRR(d); app.rrHold = d; app.rrHoldT = performance.now() + 300; el.setPointerCapture && el.setPointerCapture(e.pointerId); e.preventDefault(); });
    const stop = () => { app.rrHold = 0; };
    el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('lostpointercapture', stop);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { app.changeRR(d); e.preventDefault(); } });
  };
  hold($('rrDown'), -1); hold($('rrUp'), +1);
  $('pause').onclick = () => app.togglePause();
  $('ff').onclick = () => app.toggleFF();
  $('nuke').onclick = () => app.nuke();
  $('restart').onclick = () => { if (app.mode === 'play') app.restart(); };
  $('menu').onclick = () => { if (app.mode === 'play') app.showMenu(); };
  $('mute').onclick = () => app.toggleMute();

  window.addEventListener('keydown', (e) => {
    app.sound.unlock();
    if (e.key === 'Shift') app.keys.add('Shift');
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    if (app.mode !== 'play') { if (k === 'Escape' && app.mode === 'paused-menu') $('mResume').click(); return; }
    if (k >= '1' && k <= '8') { app.selectRole(ROLES[+k - 1]); e.preventDefault(); }
    else if (k === 'p' || k === 'P' || k === ' ') { app.togglePause(); e.preventDefault(); }
    else if (k === 'f' || k === 'F') app.toggleFF();
    else if (k === '-' || k === '_' || k === 'F1') { app.changeRR(-1); e.preventDefault(); }
    else if (k === '+' || k === '=' || k === 'F2') { app.changeRR(+1); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') { app.keys.add(k); e.preventDefault(); }
    else if (k === 'r' || k === 'R') app.restart();
    else if (k === 'm' || k === 'M') app.toggleMute();
    else if (k === 'Escape') app.showMenu();
  });
  window.addEventListener('keyup', (e) => { app.keys.delete(e.key); });
  window.addEventListener('blur', () => { app.keys.clear(); app.rrHold = 0; });
  window.addEventListener('resize', () => app.layout());
  if (window.ResizeObserver) new ResizeObserver(() => app.layout()).observe($('stage'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.mode === 'play' && !app.paused) app.togglePause(); });
}

// ---------- loop ----------
function loop() {
  let last = performance.now(), acc = 0, rrAcc = 0;
  const frame = (now) => {
    const dt = Math.min(250, now - last); last = now; app.frame++;
    const R = app.renderer;
    if (app.mode === 'play' && !app.paused) {
      acc += dt; let n = 0;
      while (acc >= TICK_MS && n < 4) { acc -= TICK_MS; n++; app.tickOnce(); }
      if (n === 4) acc = 0;
    } else acc = 0;
    // held release-rate buttons change it once per tick, paused or not
    if (app.rrHold && now > app.rrHoldT) { rrAcc += dt; while (rrAcc >= TICK_MS) { rrAcc -= TICK_MS; app.changeRR(app.rrHold); } } else rrAcc = 0;
    if (app.nukeArmed && now - app.nukeArmed > 2500) { app.nukeArmed = 0; app.syncButtons(); }
    // scrolling: arrow keys and pushing the mouse against a side edge
    let sx = 0, sy = 0;
    if (app.keys.has('ArrowLeft')) sx -= 1; if (app.keys.has('ArrowRight')) sx += 1;
    if (app.keys.has('ArrowUp')) sy -= 1; if (app.keys.has('ArrowDown')) sy += 1;
    const hc = app.hoverCss;
    if (hc && !app.pointer && app.mode === 'play') {
      const w = R.vw * R.zoom;
      if (hc.x < 18) sx -= 1; else if (hc.x > w - 18) sx += 1;
    }
    if (sx || sy) { const sp = Math.max(1, Math.round(dt * 0.25)); R.cam.x += sx * sp; R.cam.y += sy * sp; R.clampCam(); }
    app.updateHover();
    R.draw(app.frame, { valid: app.validHover });
    R.drawMini($('mini'), app.frame);
    app.hud();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// The /run/marchers/ page's play-events.js can't see a boot by itself: the canvas
// is a small pixel-art buffer scaled up by CSS, under the 300x150 size it treats
// as a live engine. So tell it directly when a level starts. Cross-origin embeds
// throw on window.parent access; that's fine, they aren't ours to count.
function reportPlay() {
  try {
    const ep = window.parent !== window && window.parent.ExePlay;
    if (ep) { ep.click(); ep.booted(); }
  } catch (e) {}
}

function boot() {
  app.renderer = new Renderer($('view'));
  app.sound.setMuted(app.progress.muted);
  bindInput();
  // optional deep link: #level=N (1-based)
  let start = app.progress.last || 0;
  const m = /level=(\d+)/.exec(location.hash || '');
  if (m) start = Math.max(0, Math.min(LEVELS.length - 1, +m[1] - 1));
  else { const firstOpen = LEVELS.findIndex((L, i) => app.unlocked(i) && !app.progress.won[L.id]); if (firstOpen >= 0 && !app.unlocked(start)) start = firstOpen; }
  if (!m && !app.unlocked(start)) start = 0;
  app.load(start);
  app.showIntro();
  loop();
  window.marchers = app; // handy for debugging and the headless UI check
}

boot();
