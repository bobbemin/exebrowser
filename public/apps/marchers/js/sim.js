// Marchers — the simulation. Pure, deterministic, integer-only, DOM-free.
// new Sim(level); sim.input(events); sim.step(n); sim.state()
import { STEEL, wrongOneWay } from './terrain.js';
import { parseLevel, ROLES } from './level.js';

export { ROLES };
export const TICKS_PER_SECOND = 17;
export const HATCH_OPEN_TICK = 35;
export const FIRST_RELEASE_DELAY = 20;
export const BOMB_TICKS = 79;
export const PRE_EXPLODE_TICKS = 16;
export const SPLAT_TICKS = 16, DROWN_TICKS = 16, BURN_TICKS = 14, EXIT_TICKS = 8, SHRUG_TICKS = 8;
export const SAFE_FALL = 60;
export const FLOAT_SEQ = [3, 3, 3, 3, -1, 0, 1, 1];

export const S = {
  FALLING: 'FALLING', WALKING: 'WALKING', STEPPING_UP: 'STEPPING_UP', CLIMBING: 'CLIMBING', HOISTING: 'HOISTING',
  FLOATING: 'FLOATING', BLOCKING: 'BLOCKING', BUILDING: 'BUILDING', SHRUGGING: 'SHRUGGING', BASHING: 'BASHING',
  MINING: 'MINING', DIGGING: 'DIGGING', PRE_EXPLODE: 'PRE_EXPLODE', EXPLODING: 'EXPLODING', SPLATTING: 'SPLATTING',
  DROWNING: 'DROWNING', BURNING: 'BURNING', EXITING: 'EXITING',
};
const FATAL = new Set([S.SPLATTING, S.DROWNING, S.BURNING, S.EXITING, S.EXPLODING]);
const DYING = new Set([S.SPLATTING, S.DROWNING, S.BURNING, S.EXITING, S.EXPLODING, S.PRE_EXPLODE]);
export const BUSY = new Set([S.BLOCKING, S.BUILDING, S.SHRUGGING, S.BASHING, S.MINING, S.DIGGING, S.PRE_EXPLODE]);
const JOB_STATE = { blocker: S.BLOCKING, builder: S.BUILDING, basher: S.BASHING, miner: S.MINING, digger: S.DIGGING };
const JOB_FROM = {
  blocker: [S.WALKING, S.SHRUGGING, S.BUILDING, S.BASHING, S.MINING, S.DIGGING],
  builder: [S.WALKING, S.SHRUGGING, S.BASHING, S.MINING, S.DIGGING],
  basher: [S.WALKING, S.SHRUGGING, S.BUILDING, S.MINING, S.DIGGING],
  miner: [S.WALKING, S.SHRUGGING, S.BUILDING, S.BASHING, S.DIGGING],
  digger: [S.WALKING, S.SHRUGGING, S.BUILDING, S.BASHING, S.MINING],
};
const FALLBACK_ROLES = new Set(['builder', 'basher', 'miner', 'digger']);
const NO_TURN_BY_FIELD = new Set([S.BLOCKING, S.CLIMBING, S.HOISTING]);

export function releaseInterval(rr) { return Math.floor((99 - rr) / 2) + 4; }
export function bombDigit(t) { return Math.max(1, Math.min(5, Math.ceil(t / 16))); }
export function hitBox(m) { return { x0: m.x - 6, x1: m.x + 6, y0: m.y - 12, y1: m.y }; }
export function blockerField(m) { return { x0: m.x - 6, x1: m.x + 5, y0: m.y - 8, y1: m.y + 3 }; }
const inR = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
const inObj = (o, x, y) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h;
const overlap = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

export class Sim {
  constructor(level, opts = {}) {
    const L = level && level.terrain && level.terrain.c ? level : parseLevel(level);
    this.level = L;
    this.T = L.terrain.clone();
    this.w = L.w; this.h = L.h;
    this.total = L.total; this.needed = L.needed; this.rrMin = L.rrMin;
    this.rr = L.rrMin;
    this.skills = { ...L.skills };
    this.used = Object.fromEntries(ROLES.map(r => [r, 0]));
    this.timeLeft = L.time;
    this.tick = 0;
    this.marchers = [];
    this.released = 0; this.saved = 0; this.dead = 0;
    this.hatchOpen = false; this.countdown = 0;
    this.traps = L.objects.filter(o => o.type === 'trap').map(o => ({ ...o, busy: 0, cooldown: o.cooldown || 20 }));
    this.exits = L.objects.filter(o => o.type === 'exit');
    this.waters = L.objects.filter(o => o.type === 'water');
    this.fires = L.objects.filter(o => o.type === 'fire');
    this.hatches = L.hatches;
    this.nuked = false; this.nukePtr = 0; this.nukeTick = -1;
    this.ended = false; this.endReason = null; this.endTick = -1;
    this.queue = []; this.log = [];
    this.events = [];
    this.recordEvents = opts.events !== false;
  }

  // ---------- public API ----------
  input(events) {
    for (const e of [].concat(events)) this.queue.push({ ...e });
    this.queue.sort((a, b) => a.tick - b.tick); // stable
  }
  // apply an input right now (UI path). It is stamped with the current tick, which is exactly
  // what a replay does: inputs stamped n run before tick n+1's handlers.
  now(ev) { return this._apply({ ...ev, tick: this.tick }); }
  step(n = 1) { for (let i = 0; i < n; i++) this._tick(); return this; }
  get out() { return this.released - this.saved - this.dead; }
  get removed() { return this.saved + this.dead; }
  get percent() { return Math.floor(this.saved * 100 / this.total); }
  get neededPercent() { return Math.floor(this.needed * 100 / this.total); }
  get won() { return this.saved >= this.needed; }
  clock() { const t = Math.max(0, this.timeLeft); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  alive() { return this.marchers.filter(m => !m.removed); }
  state() {
    return {
      tick: this.tick, timeLeft: this.timeLeft, clock: this.clock(), rr: this.rr, released: this.released, out: this.out,
      saved: this.saved, dead: this.dead, removed: this.removed, percent: this.percent, ended: this.ended,
      endReason: this.endReason, won: this.won, skills: { ...this.skills }, used: { ...this.used },
      terrainHash: this.T.hash(),
      marchers: this.marchers.filter(m => !m.removed).map(m => ({ id: m.id, x: m.x, y: m.y, dir: m.dir, state: m.state, climber: m.climber, floater: m.floater, bomb: m.bomb })),
    };
  }
  // test helper (spec 10): place a marcher directly. It counts as released.
  spawnAt(x, y, dir = 1, state = S.WALKING) {
    const m = this._new(x, y, dir, state);
    return m;
  }
  setRR(v) { this.rr = Math.max(this.rrMin, Math.min(99, v | 0)); return this.rr; }

  // ---------- picking (4.2) ----------
  under(x, y) { return this.marchers.filter(m => !m.removed && inR(hitBox(m), x, y)); }
  candidates(x, y, preferFree = false) {
    const all = this.under(x, y);
    const busy = all.filter(m => BUSY.has(m.state)), free = all.filter(m => !BUSY.has(m.state));
    const lastBusy = busy[busy.length - 1] || null, lastFree = free[free.length - 1] || null;
    const primary = preferFree ? (lastFree || lastBusy) : (lastBusy || lastFree);
    return { primary, secondary: lastFree, count: all.length };
  }
  canAssign(m, role) {
    if (!m || m.removed) return false;
    const st = m.state;
    switch (role) {
      case 'climber': case 'floater':
        if (st === S.BLOCKING || DYING.has(st)) return false;
        return role === 'climber' ? !m.climber : !m.floater;
      case 'bomber':
        if (st === S.PRE_EXPLODE || st === S.EXPLODING || st === S.BURNING || st === S.SPLATTING || st === S.EXITING) return false;
        return m.bomb === 0;
    }
    if (!JOB_FROM[role] || !JOB_FROM[role].includes(st)) return false;
    const T = this.T, ahead = T.get(m.x + 8 * m.dir, m.y - 8), under = T.get(m.x, m.y);
    switch (role) {
      case 'blocker': {
        const f = blockerField(m);
        return !this.marchers.some(o => o !== m && this._hasField(o) && overlap(blockerField(o), f));
      }
      case 'builder': return m.y - 10 >= -5;
      case 'basher': return !(ahead === STEEL || wrongOneWay(ahead, m.dir));
      case 'miner': return !(ahead === STEEL || under === STEEL || wrongOneWay(ahead, m.dir));
      case 'digger': return under !== STEEL;
    }
    return false;
  }
  // returns the marcher that got the role, or null (no inventory spent)
  // which marcher a click at (x, y) would give `role` to (4.2.3 - 4.2.5), without giving it
  pickFor(x, y, role, preferFree = false) {
    if (!ROLES.includes(role) || this.skills[role] === 0) return null;
    const { primary, secondary } = this.candidates(x, y, preferFree);
    if (this.canAssign(primary, role)) return primary;
    if (FALLBACK_ROLES.has(role) && secondary && secondary !== primary && this.canAssign(secondary, role)) return secondary;
    return null;
  }
  assignAt(x, y, role, preferFree = false) {
    const target = this.pickFor(x, y, role, preferFree);
    if (!target) return null;
    this._give(target, role);
    return target;
  }
  _give(m, role) {
    if (this.skills[role] > 0) this.skills[role]--;
    this.used[role]++;
    if (role === 'climber') m.climber = true;
    else if (role === 'floater') m.floater = true;
    else if (role === 'bomber') m.bomb = BOMB_TICKS;
    else {
      this._set(m, JOB_STATE[role]);
      if (role === 'builder') m.bricks = 12;
    }
    this._emit('assign', m, role);
  }

  // ---------- internals ----------
  _emit(type, m, extra) { if (this.recordEvents) this.events.push({ type, x: m ? m.x : 0, y: m ? m.y : 0, id: m ? m.id : -1, extra }); }
  _new(x, y, dir, state) {
    const m = { id: this.marchers.length, x, y, dir, state, climber: false, floater: false, bomb: 0, fallen: 0, bricks: 0, c: 0, first: true, removed: false, field: false, born: this.tick };
    this.marchers.push(m); this.released++;
    return m;
  }
  _set(m, st) { m.state = st; m.c = 0; m.fallen = 0; m.bricks = 0; m.first = true; m.field = false; }
  _hasField(m) { return !m.removed && (m.state === S.BLOCKING || (m.state === S.PRE_EXPLODE && m.field)); }
  _die(m, how) { if (m.removed) return; m.removed = true; m.fate = how; this.dead++; this._emit('die', m, how); }
  _turn(m) { m.dir = -m.dir; }
  _walkOn(m, turn) { if (turn) this._turn(m); this._set(m, S.WALKING); }
  _apply(ev) {
    this.log.push(ev);
    if (ev.rr != null) this.setRR(ev.rr);
    if (ev.nuke && !this.nuked) { this.nuked = true; this.nukePtr = 0; this.nukeTick = this.tick; this._emit('nuke', null); }
    if (ev.skill) return this.assignAt(ev.x | 0, ev.y | 0, ev.skill, !!ev.free);
    return null;
  }

  _tick() {
    if (this.ended) return;
    while (this.queue.length && this.queue[0].tick <= this.tick) this._apply(this.queue.shift());
    this.tick++;
    if (this.tick % TICKS_PER_SECOND === 0 && this.timeLeft > 0) this.timeLeft--;
    this._release();
    const ms = this.marchers;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (m.removed) continue;
      if (m.bomb > 0) {
        m.bomb--;
        if (m.bomb > 0 && m.bomb % 16 === 0) this._emit('fuse', m, bombDigit(m.bomb));
        if (m.bomb === 0) {
          if (m.state === S.FALLING || m.state === S.FLOATING || m.state === S.DROWNING || m.state === S.BURNING || m.state === S.SPLATTING) this._explode(m);
          else { const f = m.state === S.BLOCKING; this._set(m, S.PRE_EXPLODE); m.field = f; }
          continue;
        }
      }
      const before = m.state;
      this._handle(m);
      if (!m.removed && !FATAL.has(m.state)) this._triggers(m, before);
    }
    this._nukeStep();
    for (const t of this.traps) if (t.busy > 0) t.busy--;
    this._checkEnd();
  }

  _release() {
    if (!this.hatchOpen) {
      if (this.tick === HATCH_OPEN_TICK) { this.hatchOpen = true; this.countdown = FIRST_RELEASE_DELAY; this._emit('hatch', null); }
      return;
    }
    if (this.nuked || this.released >= this.total) return;
    this.countdown--;
    if (this.countdown <= 0) {
      const hz = this.hatches[this.released % this.hatches.length];
      const m = this._new(hz.x + Math.floor(hz.w / 2), hz.y + hz.h - 2, 1, S.FALLING);
      this._emit('spawn', m);
      this.countdown = releaseInterval(this.rr);
    }
  }

  _nukeStep() {
    if (!this.nuked) return;
    while (this.nukePtr < this.marchers.length) {
      const m = this.marchers[this.nukePtr++];
      if (!m.removed && m.bomb === 0 && !DYING.has(m.state)) { m.bomb = BOMB_TICKS; break; }
    }
  }

  _checkEnd() {
    let reason = null;
    if (this.timeLeft <= 0) reason = 'time';
    else if (this.saved >= this.total || this.removed >= this.total) reason = 'done';
    else if (this.nuked && this.out === 0) reason = 'nuked';
    if (reason) { this.ended = true; this.endReason = reason; this.endTick = this.tick; this._emit('end', null, reason); }
  }

  _triggers(m) {
    const x = m.x, y = m.y, st = m.state;
    for (const o of this.waters) if (inObj(o, x, y)) { this._set(m, S.DROWNING); this._emit('drown', m); return; }
    for (const o of this.fires) if (inObj(o, x, y)) { this._set(m, S.BURNING); this._emit('burn', m); return; }
    for (const t of this.traps) if (inObj(t, x, y) && t.busy === 0) { t.busy = t.cooldown; t.fired = this.tick; this._die(m, 'trap'); return; }
    if (st !== S.FALLING && st !== S.FLOATING) {
      for (const o of this.exits) if (inObj(o, x, y)) { this._set(m, S.EXITING); m.bomb = 0; this._emit('exit', m); return; }
    }
    if (NO_TURN_BY_FIELD.has(m.state) || (m.state === S.PRE_EXPLODE && m.field)) return;
    for (const b of this.marchers) {
      if (b === m || !this._hasField(b)) continue;
      const f = blockerField(b);
      if (y < f.y0 || y > f.y1) continue;
      if (m.dir > 0 && x >= b.x - 6 && x <= b.x - 3) { m.dir = -1; this._emit('bounce', m); }
      else if (m.dir < 0 && x >= b.x + 2 && x <= b.x + 5) { m.dir = 1; this._emit('bounce', m); }
    }
  }

  _explode(m) {
    const cx = m.x, cy = m.y - 4, T = this.T;
    for (let dy = -11; dy < 11; dy++) for (let dx = -8; dx < 8; dx++) {
      const a = (dx + 0.5) / 8, b = (dy + 0.5) / 11;
      if (a * a + b * b <= 1) T.remove(cx + dx, cy + dy);
    }
    m.state = S.EXPLODING;
    this._emit('boom', m);
    this._die(m, 'boom');
  }

  _offBottom(m) { if (m.y > this.h + 3) { this._die(m, 'fell'); return true; } return false; }

  _handle(m) {
    const T = this.T;
    switch (m.state) {
      case S.WALKING: return this._walk(m);
      case S.STEPPING_UP: {
        let r = 0;
        while (r < 2 && T.solid(m.x, m.y - 1)) { m.y--; r++; }
        if (r < 2) this._set(m, S.WALKING);
        return;
      }
      case S.FALLING: return this._fall(m);
      case S.FLOATING: return this._float(m);
      case S.CLIMBING: return this._climb(m);
      case S.HOISTING:
        if (m.c < 5) m.y -= 2;
        m.c++;
        if (m.c >= 8) this._set(m, S.WALKING);
        return;
      case S.BLOCKING:
        if (!T.solid(m.x, m.y)) { this._set(m, S.WALKING); this._emit('unblock', m); }
        return;
      case S.BUILDING: return this._build(m);
      case S.SHRUGGING:
        if (++m.c >= SHRUG_TICKS) this._set(m, S.WALKING);
        return;
      case S.BASHING: return this._bash(m);
      case S.MINING: return this._mine(m);
      case S.DIGGING: return this._dig(m);
      case S.PRE_EXPLODE:
        if (!T.solid(m.x, m.y)) {
          for (let i = 0; i < 3 && !T.solid(m.x, m.y); i++) m.y++;
          if (this._offBottom(m)) return;
        }
        if (++m.c >= PRE_EXPLODE_TICKS) this._explode(m);
        return;
      case S.SPLATTING: if (++m.c >= SPLAT_TICKS) this._die(m, 'splat'); return;
      case S.BURNING: if (++m.c >= BURN_TICKS) this._die(m, 'burn'); return;
      case S.DROWNING:
        if (!T.solid(m.x + 8 * m.dir, m.y) && m.x + m.dir >= 0 && m.x + m.dir < this.w) m.x += m.dir;
        if (++m.c >= DROWN_TICKS) this._die(m, 'drown');
        return;
      case S.EXITING:
        if (++m.c >= EXIT_TICKS) { m.removed = true; m.fate = 'saved'; this.saved++; this._emit('saved', m); }
        return;
    }
  }

  _walk(m) {
    const T = this.T;
    const ox = m.x, oy = m.y;
    const nx = m.x + m.dir;
    if (nx < 0 || nx >= this.w) { this._turn(m); return; }
    m.x = nx;
    if (T.solid(m.x, m.y)) {
      let h = 0;
      while (h < 7 && T.solid(m.x, m.y - 1 - h)) h++;
      if (h >= 7) {
        if (m.climber) { this._set(m, S.CLIMBING); return; }
        m.x = ox; this._turn(m); return;
      }
      if (h >= 3) { m.y -= 2; this._set(m, S.STEPPING_UP); }
      else m.y -= h;
      if (m.y - 10 < -5) { m.x = ox; m.y = oy; this._set(m, S.WALKING); this._turn(m); }
      return;
    }
    let k = 0;
    while (k < 3 && !T.solid(m.x, m.y)) { m.y++; k++; }
    if (!T.solid(m.x, m.y)) { m.y++; this._set(m, S.FALLING); }
    this._offBottom(m);
  }

  _fall(m) {
    const T = this.T;
    if (m.floater && m.fallen > 16) { this._set(m, S.FLOATING); this._emit('open', m); return; }
    for (let i = 0; i < 3; i++) {
      if (T.solid(m.x, m.y)) {
        if (m.fallen > SAFE_FALL) { this._set(m, S.SPLATTING); this._emit('splat', m); }
        else this._set(m, S.WALKING);
        return;
      }
      m.y++;
    }
    m.fallen += 3;
    this._offBottom(m);
  }

  _float(m) {
    const T = this.T;
    const dy = m.c < FLOAT_SEQ.length ? FLOAT_SEQ[m.c] : 2;
    m.c++;
    if (dy < 0) m.y += dy;
    else for (let i = 0; i < dy; i++) {
      if (T.solid(m.x, m.y)) { this._set(m, S.WALKING); return; }
      m.y++;
    }
    this._offBottom(m);
  }

  _climb(m) {
    const T = this.T, c = m.c;
    if (c < 4) {
      if (!T.solid(m.x, m.y - 7 - c)) { m.y = m.y - c + 2; this._set(m, S.HOISTING); return; }
    } else {
      m.y--;
      if (m.y - 10 < -5 || T.solid(m.x - m.dir, m.y - 8)) {
        this._turn(m); m.x += 2 * m.dir; this._set(m, S.FALLING); this._emit('slip', m); return;
      }
    }
    m.c = (c + 1) % 8;
  }

  _build(m) {
    const T = this.T, c = m.c;
    if (c === 0 && !m.first) {
      const out = (x) => x < 0 || x >= this.w;
      m.x += m.dir; m.y -= 1;
      if (out(m.x)) { m.x -= m.dir; return this._walkOn(m, true); }
      if (T.solid(m.x, m.y - 1)) return this._walkOn(m, true);
      m.x += m.dir;
      if (out(m.x)) { m.x -= m.dir; return this._walkOn(m, true); }
      if (T.solid(m.x, m.y - 1)) return this._walkOn(m, true);
      m.bricks--;
      if (m.bricks <= 0) { this._set(m, S.SHRUGGING); this._emit('shrug', m); return; }
      if (T.solid(m.x + 2 * m.dir, m.y - 9) || m.x <= 0 || m.x >= this.w - 1) return this._walkOn(m, true);
      if (m.y - 10 < -5) return this._walkOn(m, false);
    }
    if (c === 9) {
      for (let k = 0; k < 6; k++) T.add(m.x + k * m.dir, m.y - 1);
      this._emit('brick', m, 12 - m.bricks + 1);
    }
    if (c === 10 && m.bricks <= 3) this._emit('warn', m, 12 - m.bricks + 1);
    m.first = false;
    m.c = (c + 1) % 16;
  }

  _bash(m) {
    const T = this.T, c = m.c, s = c % 16;
    if (s >= 2 && s <= 5) {
      const cols = [[0, 1, 2], [3, 4], [5, 6], [7, 8]][s - 2];
      let any = false;
      for (const d of cols) for (let yy = m.y - 9; yy <= m.y - 1; yy++) if (T.removeDir(m.x + d * m.dir, yy, m.dir)) any = true;
      if (any) this._emit('bash', m);
    }
    if (c === 5) {
      let more = false;
      for (let k = 0; k < 4; k++) if (T.solid(m.x + 8 * m.dir + k * m.dir, m.y - 6)) more = true;
      if (!more) return this._walkOn(m, false);
    }
    if (s >= 11) {
      const nx = m.x + m.dir;
      if (nx < 0 || nx >= this.w) return this._walkOn(m, true);
      m.x = nx;
      if (!T.solid(m.x, m.y)) {
        for (let k = 0; k < 3 && !T.solid(m.x, m.y); k++) m.y++;
        if (!T.solid(m.x, m.y)) { m.y++; this._set(m, S.FALLING); return; }
      }
      const p = T.get(m.x + 8 * m.dir, m.y - 8);
      if (p === STEEL || wrongOneWay(p, m.dir)) { this._emit('clank', m); return this._walkOn(m, true); }
    }
    m.c = (c + 1) % 32;
  }

  _mineCarve(m, d0, d1) {
    const T = this.T;
    let any = false;
    for (let d = d0; d <= d1; d++) {
      const bottom = d <= 1 ? m.y - 1 : m.y;
      for (let yy = m.y - 10; yy <= bottom; yy++) if (T.removeDir(m.x + d * m.dir, yy, m.dir)) any = true;
    }
    if (any) this._emit('mine', m);
  }
  _mine(m) {
    const T = this.T, c = m.c;
    if (c === 0 && !m.first) m.y += 1;
    if (c === 1) this._mineCarve(m, -1, 3);
    if (c === 2) this._mineCarve(m, 4, 7);
    if (c === 3 || c === 15) {
      for (let k = 0; k < 2; k++) {
        const nx = m.x + m.dir;
        if (nx < 0 || nx >= this.w) return this._walkOn(m, true);
        m.x = nx;
      }
      if (c === 3) m.y += 1;
      if (!T.solid(m.x, m.y)) { this._set(m, S.FALLING); return; }
      const v = T.get(m.x, m.y);
      if (v === STEEL || wrongOneWay(v, m.dir)) { this._emit('clank', m); return this._walkOn(m, true); }
    }
    m.first = false;
    m.c = (c + 1) % 24;
  }

  _dig(m) {
    const T = this.T;
    if (m.first) {
      for (const yy of [m.y - 2, m.y - 1]) for (let dx = -4; dx <= 4; dx++) T.remove(m.x + dx, yy);
      m.first = false;
    }
    if (m.c === 0 || m.c === 8) {
      const r = m.y;
      m.y++;
      if (this._offBottom(m)) return;
      let any = false;
      for (let dx = -4; dx <= 4; dx++) if (T.remove(m.x + dx, r)) any = true;
      if (!any) { this._set(m, S.FALLING); return; }
      this._emit('dig', m);
      if (T.get(m.x, m.y) === STEEL) { this._emit('clank', m); return this._walkOn(m, false); }
    }
    m.c = (m.c + 1) % 16;
  }
}
