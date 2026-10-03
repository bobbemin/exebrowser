// Marchers — renderer. Draws the latest sim state into a low-resolution canvas (1 canvas px =
// 1 level px) that CSS scales up by an integer factor with pixelated sampling.
import { THEMES, paintTerrain, makeBackdrop, makeCanvas, drawMarcher, drawDigit, hash2 } from './art.js';
import { bombDigit, blockerField } from './sim.js';

export class Renderer {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d', { alpha: false });
    this.vw = 320; this.vh = 160; this.zoom = 2;
    this.cam = { x: 0, y: 0 };
    this.particles = [];
    this.hover = null; // {x, y} level coords
    this.highlight = null;
  }
  // stage size in CSS px -> pick an integer zoom and the canvas resolution
  resize(cssW, cssH, levelH = 160) {
    let z = Math.max(1, Math.floor(cssH / levelH));
    // a slightly bigger zoom is worth a little vertical scrolling
    if (cssH / ((z + 1) * levelH) >= 0.86) z++;
    if (cssW / z < 160) z = Math.max(1, Math.floor(cssW / 160));
    if (cssW / z < 160 && z > 1) z--;
    z = Math.min(z, 6);
    this.zoom = z;
    this.vw = Math.ceil(cssW / z); this.vh = Math.ceil(cssH / z);
    this.cv.width = this.vw; this.cv.height = this.vh;
    this.cv.style.width = this.vw * z + 'px'; this.cv.style.height = this.vh * z + 'px';
    this.g.imageSmoothingEnabled = false;
    if (this.sim) this.clampCam();
  }
  attach(sim) {
    this.sim = sim;
    const L = sim.level;
    this.theme = THEMES[L.theme] ? L.theme : 'loam';
    this.terr = makeCanvas(sim.w, sim.h);
    this.tg = this.terr.getContext('2d');
    this.img = this.tg.createImageData(sim.w, sim.h);
    paintTerrain(this.img, sim.T, this.theme, 0, 0, sim.w - 1, sim.h - 1);
    this.tg.putImageData(this.img, 0, 0);
    sim.T.dirty = null;
    this.bg = makeBackdrop(this.theme, Math.ceil(sim.w * 0.5) + 2000, sim.h);
    this.particles = [];
    this.hatchOpenAt = -1; this.flashes = [];
    this.miniDirty = true;
  }
  clampCam() {
    const s = this.sim;
    const maxX = Math.max(0, s.w - this.vw);
    this.cam.x = Math.max(0, Math.min(maxX, Math.round(this.cam.x)));
    if (s.w < this.vw) this.cam.x = -Math.floor((this.vw - s.w) / 2);
    if (this.vh >= s.h) this.cam.y = -Math.floor((this.vh - s.h) / 2);
    else this.cam.y = Math.max(0, Math.min(s.h - this.vh, Math.round(this.cam.y)));
  }
  centerOn(x, y) { this.cam.x = Math.round(x - this.vw / 2); this.cam.y = Math.round(y - this.vh / 2); this.clampCam(); }
  toLevel(cssX, cssY) { return { x: Math.floor(cssX / this.zoom) + this.cam.x, y: Math.floor(cssY / this.zoom) + this.cam.y }; }

  syncTerrain() {
    const d = this.sim.T.dirty;
    if (!d) return;
    // edges look at neighbours, so repaint a margin around what changed
    const x0 = Math.max(0, d.x0 - 2), y0 = Math.max(0, d.y0 - 2), x1 = Math.min(this.sim.w - 1, d.x1 + 2), y1 = Math.min(this.sim.h - 1, d.y1 + 8);
    paintTerrain(this.img, this.sim.T, this.theme, x0, y0, x1, y1);
    this.tg.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.sim.T.dirty = null; this.miniDirty = true;
  }

  // ---------- effects fed by sim events ----------
  onEvent(e) {
    const th = THEMES[this.theme];
    switch (e.type) {
      case 'hatch': this.hatchOpenAt = this.sim.tick; break;
      case 'boom': {
        for (let i = 0; i < 46; i++) {
          const a = hash2(i, e.id + this.sim.tick) * Math.PI * 2, v = 0.6 + hash2(e.id, i) * 2.2;
          this.particles.push({ x: e.x, y: e.y - 5, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.2, life: 52, col: i % 3 === 0 ? '#ffd23f' : i % 3 === 1 ? th.dirt[0] : '#ff6a2a', grav: 0.12 });
        }
        this.flashes.push({ x: e.x, y: e.y - 5, life: 6 });
        break;
      }
      case 'splat': for (let i = 0; i < 8; i++) this.particles.push({ x: e.x, y: e.y - 1, vx: (hash2(i, e.id) - 0.5) * 2, vy: -hash2(e.id, i) * 1.5, life: 18, col: i & 1 ? '#ff8c1a' : '#25b8a8', grav: 0.15 }); break;
      case 'saved': for (let i = 0; i < 6; i++) this.particles.push({ x: e.x + (hash2(i, e.id) - 0.5) * 8, y: e.y - 6, vx: 0, vy: -0.4 - hash2(e.id, i) * 0.6, life: 20, col: '#fff7c2', grav: 0 }); break;
      case 'drown': for (let i = 0; i < 5; i++) this.particles.push({ x: e.x + (hash2(i, e.id) - 0.5) * 6, y: e.y - 2, vx: 0, vy: -0.5, life: 16, col: '#cdeeff', grav: 0 }); break;
      case 'clank': for (let i = 0; i < 4; i++) this.particles.push({ x: e.x + e.extra * 0 + 6 * (hash2(i, 3) > 0.5 ? 1 : -1), y: e.y - 6, vx: (hash2(i, e.id) - 0.5) * 2, vy: -1, life: 8, col: '#ffffff', grav: 0.2 }); break;
      case 'trap': break;
    }
  }
  tickEffects() {
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.life--; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const f of this.flashes) f.life--;
    this.flashes = this.flashes.filter(f => f.life > 0);
  }

  // ---------- frame ----------
  draw(frame, ui = {}) {
    const g = this.g, s = this.sim, cx = this.cam.x, cy = this.cam.y, t = s.tick;
    this.syncTerrain();
    // backdrop with parallax
    g.fillStyle = THEMES[this.theme].deep; g.fillRect(0, 0, this.vw, this.vh);
    const bx = Math.round(Math.max(0, cx) * 0.5);
    g.drawImage(this.bg, bx, 0, this.vw, s.h, 0, -cy, this.vw, s.h);
    // below/above the level when the view is taller than the level
    if (cy < 0) {
      g.fillStyle = THEMES[this.theme].sky[0]; g.fillRect(0, 0, this.vw, -cy);
      g.fillStyle = THEMES[this.theme].deep; g.fillRect(0, s.h - cy, this.vw, this.vh);
    }
    // objects behind terrain: exits and hatches
    for (const o of s.level.objects) if (o.type === 'exit') this.drawExit(g, o, cx, cy, frame);
    g.drawImage(this.terr, -cx, -cy);
    if (cx < 0) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, -cx, this.vh); g.fillRect(s.w - cx, 0, this.vw, this.vh); }
    for (const o of s.level.objects) {
      if (o.type === 'hatch') this.drawHatch(g, o, cx, cy, t);
      else if (o.type === 'trap') this.drawTrap(g, o, cx, cy, t);
    }
    // blocker fields (subtle)
    if (ui.showFields !== false) for (const m of s.marchers) if (!m.removed && (m.state === 'BLOCKING' || (m.state === 'PRE_EXPLODE' && m.field))) {
      const f = blockerField(m);
      g.fillStyle = 'rgba(255,80,80,0.10)'; g.fillRect(f.x0 - cx, f.y0 - cy, f.x1 - f.x0 + 1, f.y1 - f.y0 + 1);
    }
    // marchers
    for (const m of s.marchers) {
      if (m.removed) continue;
      const sx = m.x - cx, sy = m.y - cy;
      if (sx < -12 || sx > this.vw + 12) continue;
      drawMarcher(g, m, sx, sy, t);
      if (m.bomb > 0) drawDigit(g, bombDigit(m.bomb), sx - 1, sy - 18);
    }
    // hazards in front (water and fire overlap what falls into them)
    for (const o of s.level.objects) {
      if (o.type === 'water') this.drawWater(g, o, cx, cy, frame);
      else if (o.type === 'fire') this.drawFire(g, o, cx, cy, frame);
    }
    for (const p of this.particles) { g.fillStyle = p.col; g.fillRect(Math.round(p.x - cx), Math.round(p.y - cy), 1, 1); }
    for (const f of this.flashes) { g.fillStyle = `rgba(255,240,180,${f.life / 8})`; g.beginPath(); g.arc(f.x - cx, f.y - cy, 12 - f.life, 0, Math.PI * 2); g.fill(); }
    // cursor
    if (this.highlight && !this.highlight.removed) {
      const m = this.highlight, x0 = m.x - 6 - cx, y0 = m.y - 13 - cy;
      g.strokeStyle = ui.valid ? '#ffffff' : 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, y0 + 0.5, 12, 13);
    }
    if (this.hover) {
      const hx = this.hover.x - cx, hy = this.hover.y - cy;
      g.fillStyle = this.highlight ? '#ffffff' : 'rgba(255,255,255,0.7)';
      g.fillRect(hx - 4, hy, 3, 1); g.fillRect(hx + 2, hy, 3, 1); g.fillRect(hx, hy - 4, 1, 3); g.fillRect(hx, hy + 2, 1, 3);
    }
  }

  drawHatch(g, o, cx, cy, t) {
    // an iron hopper: striped lid, riveted body narrowing to a mouth with two flaps underneath
    const x = o.x - cx, y = o.y - cy, w = o.w, h = o.h, b = y + h - 2;
    g.fillStyle = '#2a2d40'; g.fillRect(x - 3, y - 5, w + 6, 5);
    for (let k = 0; k < w + 6; k++) if (((k + 40) >> 1) % 3 === 0) { g.fillStyle = '#ffd23f'; g.fillRect(x - 3 + k, y - 4, 1, 3); }
    g.fillStyle = '#5b6180'; g.fillRect(x - 3, y - 5, w + 6, 1);
    for (let r = 0; r < h - 2; r++) {
      const inset = Math.floor(r / 4);
      g.fillStyle = '#4a5070'; g.fillRect(x - 1 + inset, y + r, w + 2 - inset * 2, 1);
      g.fillStyle = '#6a7194'; g.fillRect(x - 1 + inset, y + r, 1, 1);
      g.fillStyle = '#2a2d40'; g.fillRect(x + w - inset, y + r, 1, 1);
    }
    g.fillStyle = '#9aa3c4'; for (let k = 2; k < w; k += 5) g.fillRect(x + k, y + 1, 1, 1);
    const inset = Math.floor((h - 3) / 4), mx = x - 1 + inset, mw = w + 2 - inset * 2;
    const open = this.hatchOpenAt >= 0 ? Math.min(1, (t - this.hatchOpenAt) / 10) : 0;
    g.fillStyle = '#12131f'; g.fillRect(mx + 2, b - 3, mw - 4, 3);
    const half = (mw >> 1);
    g.fillStyle = '#8b92b3';
    if (open <= 0) g.fillRect(mx, b, mw, 2);
    else {
      // two flaps swung down on their hinges
      const len = Math.max(2, Math.round(half * (1 - open))), drop = Math.round(5 * open);
      g.fillRect(mx, b, len, 2); g.fillRect(mx + mw - len, b, len, 2);
      g.fillStyle = '#6a7194';
      for (let k = 0; k < drop; k++) { g.fillRect(mx - (k >> 1), b + k, 2, 1); g.fillRect(mx + mw - 2 + (k >> 1), b + k, 2, 1); }
    }
  }
  drawExit(g, o, cx, cy, frame) {
    // a stone arch with a glowing doorway and two flickering lanterns
    const midx = o.x + (o.w >> 1) - cx, base = o.y + o.h - 2 - cy;
    const W = 16, H = 20, x = midx - (W >> 1), y = base - H + 1;
    g.fillStyle = '#4a4a5c';
    g.fillRect(x - 2, y + 4, 3, H - 4); g.fillRect(x + W - 1, y + 4, 3, H - 4);
    g.beginPath(); g.arc(midx + 0.5, y + 8, W / 2 + 2, Math.PI, 0); g.fill();
    g.fillStyle = '#6a6a80'; for (let k = 0; k < H - 4; k += 3) { g.fillRect(x - 2, y + 4 + k, 3, 1); g.fillRect(x + W - 1, y + 5 + k, 3, 1); }
    const glow = 0.75 + 0.25 * Math.sin(frame * 0.15);
    const grad = g.createLinearGradient(0, y, 0, base);
    grad.addColorStop(0, `rgba(255,214,120,${glow})`); grad.addColorStop(1, `rgba(255,150,60,${glow})`);
    g.fillStyle = grad; g.beginPath(); g.arc(midx + 0.5, y + 8, W / 2, Math.PI, 0); g.rect(x + 0.5, y + 8, W, H - 8); g.fill();
    g.fillStyle = '#fff3c4'; g.fillRect(midx - 1, base - 6, 3, 6);
    for (const lx of [x - 4, x + W + 3]) {
      const fl = (frame >> 2) & 1;
      g.fillStyle = '#2b2b38'; g.fillRect(lx, y + 6, 1, 6);
      g.fillStyle = fl ? '#ffd23f' : '#ff9f1c'; g.fillRect(lx - 1, y + 4 - fl, 3, 2);
      g.fillStyle = '#fff7c2'; g.fillRect(lx, y + 4, 1, 1);
    }
  }
  drawWater(g, o, cx, cy, frame) {
    const x = o.x - cx, y = o.y - cy;
    g.fillStyle = 'rgba(40,110,200,0.72)'; g.fillRect(x, y + 1, o.w, o.h - 1);
    g.fillStyle = 'rgba(20,60,140,0.6)'; g.fillRect(x, y + 5, o.w, o.h - 5);
    for (let i = 0; i < o.w; i++) {
      const wy = Math.round(Math.sin((i + frame * 0.6) * 0.35) * 1.2);
      g.fillStyle = 'rgba(200,235,255,0.9)'; g.fillRect(x + i, y + 1 + wy, 1, 1);
      if (hash2(i + o.x, (frame >> 3)) > 0.9) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x + i, y + 4 + ((i * 7 + frame) % (o.h - 4)), 1, 1); }
    }
  }
  drawFire(g, o, cx, cy, frame) {
    const x = o.x - cx, y = o.y - cy;
    g.fillStyle = 'rgba(120,20,0,0.6)'; g.fillRect(x, y + o.h - 3, o.w, 3);
    for (let i = 0; i < o.w; i++) {
      const hgt = 3 + Math.floor(hash2(i + o.x, frame >> 1) * (o.h + 2));
      for (let k = 0; k < hgt; k++) {
        const t = k / hgt;
        g.fillStyle = t < 0.3 ? '#ffef9a' : t < 0.6 ? '#ffb02e' : t < 0.85 ? '#ff5a1f' : 'rgba(180,30,10,0.7)';
        g.fillRect(x + i, y + o.h - 1 - k, 1, 1);
      }
    }
  }
  drawTrap(g, o, cx, cy, t) {
    const trap = this.sim.traps.find(q => q.idx === o.idx);
    const x = o.x - cx, base = o.y + o.h - 1 - cy;
    const shut = trap && trap.busy > 0;
    const open = shut ? Math.max(0, 6 - (trap.cooldown - trap.busy) * 2) : 6;
    // a spring jaw: a base plate with two toothed arms
    g.fillStyle = '#4d5561'; g.fillRect(x - 1, base, o.w + 2, 1);
    g.fillStyle = '#9aa3ad';
    const lh = shut ? 6 - Math.min(6, open) : 1;
    for (let i = 0; i < 4; i++) {
      g.fillRect(x + i, base - 1 - (shut ? Math.min(5, lh + i) : i % 2), 1, 1);
      g.fillRect(x + o.w - 1 - i, base - 1 - (shut ? Math.min(5, lh + i) : i % 2), 1, 1);
    }
    g.fillStyle = shut ? '#ff3b3b' : '#ffd23f'; g.fillRect(x + (o.w >> 1) - 1, base - 1, 2, 1);
  }

  // ---------- minimap ----------
  drawMini(mc, frame) {
    const s = this.sim, mg = mc.getContext('2d');
    const W = mc.width, H = mc.height;
    if (this.miniDirty || !this.miniBase || this.miniBase.width !== W) {
      this.miniBase = makeCanvas(W, H);
      const bg = this.miniBase.getContext('2d');
      bg.fillStyle = '#0d1020'; bg.fillRect(0, 0, W, H);
      bg.imageSmoothingEnabled = true;
      bg.drawImage(this.terr, 0, 0, s.w, s.h, 0, 0, W, H);
      this.miniDirty = false;
    }
    mg.drawImage(this.miniBase, 0, 0);
    const kx = W / s.w, ky = H / s.h;
    for (const o of s.level.objects) {
      mg.fillStyle = o.type === 'exit' ? '#ffd23f' : o.type === 'hatch' ? '#c9a36a' : o.type === 'water' ? '#3d8bff' : o.type === 'fire' ? '#ff5a1f' : '#ff3b3b';
      mg.fillRect(Math.floor(o.x * kx), Math.floor(o.y * ky), Math.max(2, Math.ceil(o.w * kx)), Math.max(2, Math.ceil(o.h * ky)));
    }
    mg.fillStyle = '#7dfff0';
    for (const m of s.marchers) if (!m.removed) mg.fillRect(Math.floor(m.x * kx), Math.floor((m.y - 5) * ky), 1, 2);
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 1;
    const vx = Math.max(0, this.cam.x) * kx, vwid = Math.min(s.w, this.vw) * kx;
    mg.strokeRect(Math.floor(vx) + 0.5, 0.5, Math.max(3, Math.floor(vwid) - 1), H - 1);
  }
}
