// Marchers — procedural pixel art. Everything is drawn in code at 1 canvas px = 1 level px.
import { EMPTY, DIRT, STEEL, ONEWAY_L, ONEWAY_R } from './terrain.js';

// ---------- small deterministic noise ----------
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp = (v) => v < 0 ? 0 : v > 255 ? 255 : v | 0;
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- themes ----------
export const THEMES = {
  loam: {
    name: 'Meadow', sky: ['#7cc4e8', '#cfeaf3'], far: '#7fae9a', near: '#5b8c78',
    dirt: ['#8a5a36', '#6e4426', '#a36d42'], top: ['#6fbf3b', '#93db54'], deep: '#3c2414', vein: '#c08a52',
    oneway: '#e8d27a', backdrop: 'hills',
  },
  quartz: {
    name: 'Crystal hollow', sky: ['#1d1533', '#3c2a5e'], far: '#2d2350', near: '#3b2f66',
    dirt: ['#6c5a9c', '#54467f', '#8471b8'], top: ['#c9b8ff', '#efe6ff'], deep: '#2a2245', vein: '#9ef0ff',
    oneway: '#7cf2d0', backdrop: 'crystals',
  },
  ember: {
    name: 'Cinder works', sky: ['#2a0f12', '#5e2318'], far: '#3d1714', near: '#511d17',
    dirt: ['#7a3b2a', '#5c2a1f', '#94503a'], top: ['#ff9a3c', '#ffd27a'], deep: '#2b1310', vein: '#ff6a2a',
    oneway: '#ffe066', backdrop: 'stacks',
  },
  frost: {
    name: 'Glacier', sky: ['#a9c9e8', '#eaf4fb'], far: '#bcd3e6', near: '#93b4d1',
    dirt: ['#6e8aa8', '#58728f', '#87a3bf'], top: ['#f4fbff', '#ffffff'], deep: '#33465c', vein: '#d5ecff',
    oneway: '#ff8fb1', backdrop: 'peaks',
  },
};

// ---------- terrain texels ----------
// Paints the cells of rect [x0..x1] x [y0..y1] of terrain T into ImageData `img` (level-sized).
export function paintTerrain(img, T, theme, x0, y0, x1, y1) {
  const th = THEMES[theme] || THEMES.loam;
  const D = th.dirt.map(hex), TOP = th.top.map(hex), DEEP = hex(th.deep), VEIN = hex(th.vein), OW = hex(th.oneway);
  const BR = [hex('#c8743c'), hex('#a85a2a'), hex('#e09455')], MORTAR = hex('#5a3420');
  const ST = [hex('#8f99a6'), hex('#6c7684'), hex('#b8c1cc'), hex('#4d5561')];
  const w = T.w, d = img.data, c = T.c, tint = T.tint;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w - 1, x1); y1 = Math.min(T.h - 1, y1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x, v = c[i], o = i * 4;
    if (v === EMPTY) { d[o + 3] = 0; continue; }
    let col;
    const n = hash2(x, y);
    // distance to open air above (0 = surface), capped
    let up = 0; while (up < 6 && y - up - 1 >= 0 && c[(y - up - 1) * w + x] !== EMPTY) up++;
    const below = y + 1 < T.h && c[(y + 1) * w + x] === EMPTY;
    const side = (x > 0 && c[i - 1] === EMPTY) || (x < w - 1 && c[i + 1] === EMPTY);
    if (v === STEEL) {
      const px = x & 7, py = y & 7;
      col = ST[0];
      if (px === 0 || py === 0) col = ST[2];
      else if (px === 7 || py === 7) col = ST[3];
      else if ((px === 2 || px === 5) && (py === 2 || py === 5)) col = ST[2];
      else if (n < 0.15) col = ST[1];
      if (up === 0) col = mix(col, [255, 255, 255], 0.25);
    } else if (tint[i] === 1) {
      const row = y % 3, off = ((y / 3) | 0) % 2 ? 3 : 0;
      col = row === 2 || ((x + off) % 6 === 0) ? MORTAR : BR[n < 0.3 ? 1 : n > 0.85 ? 2 : 0];
      if (up === 0) col = mix(col, [255, 230, 190], 0.3);
    } else {
      // natural rock / soil: layered speckle with occasional veins
      const layer = Math.sin(y * 0.35 + Math.sin(x * 0.05) * 2) * 0.5 + 0.5;
      col = mix(D[0], D[1], layer * 0.6);
      if (n < 0.08) col = D[1]; else if (n > 0.93) col = D[2];
      if (hash2(x >> 1, y) > 0.988) col = mix(col, VEIN, 0.5);
      const depth = Math.min(1, Math.max(0, (up - 2) / 40));
      col = mix(col, DEEP, depth * 0.15);
      if (up === 0) col = TOP[n < 0.5 ? 0 : 1];
      else if (up === 1) col = mix(TOP[0], col, 0.45);
      else if (up === 2 && n < 0.4) col = mix(TOP[0], col, 0.7);
      if (below) col = mix(col, DEEP, 0.45);
      else if (side) col = mix(col, DEEP, 0.2);
      if (v === ONEWAY_L || v === ONEWAY_R) {
        // chevrons pointing the way the wall gives
        // staggered 12 px cells, each holding one 2 px thick chevron
        const row = Math.floor(y / 12), px = (x + (row & 1) * 6) % 12, py = y % 12, a = Math.abs(py - 5);
        const onArrow = py >= 2 && py <= 8 && (v === ONEWAY_R ? (px === 8 - a || px === 7 - a) : (px === 3 + a || px === 4 + a));
        col = mix(col, DEEP, 0.15);
        if (onArrow) col = mix(col, OW, 0.75);
      }
    }
    d[o] = clamp(col[0]); d[o + 1] = clamp(col[1]); d[o + 2] = clamp(col[2]); d[o + 3] = 255;
  }
}

// ---------- backdrop ----------
export function makeBackdrop(theme, w, h) {
  const th = THEMES[theme] || THEMES.loam;
  const cv = makeCanvas(w, h), g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, th.sky[0]); grad.addColorStop(1, th.sky[1]);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const layer = (color, base, amp, freq, seed, jag) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) {
      let y = base + Math.sin(x * freq + seed) * amp + Math.sin(x * freq * 2.7 + seed * 3) * amp * 0.4;
      if (jag) y += (hash2(x >> 3, seed) - 0.5) * jag;
      g.lineTo(x, Math.round(y));
    }
    g.lineTo(w, h); g.closePath(); g.fill();
  };
  if (th.backdrop === 'hills') {
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(255,255,255,0.8)'; const cx = hash2(i, 1) * w, cy = 12 + hash2(i, 2) * 30; for (let k = 0; k < 4; k++) g.fillRect(Math.round(cx + k * 5 - 8), Math.round(cy - (k % 2) * 3), 12, 4); }
    layer(th.far, h * 0.55, 10, 0.012, 1, 0); layer(th.near, h * 0.72, 8, 0.02, 4, 0);
  } else if (th.backdrop === 'crystals') {
    for (let i = 0; i < 70; i++) { g.fillStyle = hash2(i, 9) > 0.5 ? '#bba8ff' : '#78e3ff'; g.globalAlpha = 0.35 + hash2(i, 3) * 0.5; g.fillRect((hash2(i, 4) * w) | 0, (hash2(i, 5) * h * 0.7) | 0, 1, 1); }
    g.globalAlpha = 1;
    for (let i = 0; i < w / 18; i++) {
      const x = (hash2(i, 11) * w) | 0, hh = 20 + hash2(i, 12) * 50, ww = 4 + hash2(i, 13) * 6;
      g.fillStyle = i % 2 ? th.far : th.near; g.beginPath(); g.moveTo(x, h); g.lineTo(x + ww / 2, h - hh); g.lineTo(x + ww, h); g.fill();
    }
  } else if (th.backdrop === 'stacks') {
    layer(th.far, h * 0.6, 6, 0.015, 2, 6);
    for (let i = 0; i < w / 90; i++) {
      const x = (hash2(i, 21) * w) | 0, hh = 40 + hash2(i, 22) * 40;
      g.fillStyle = th.near; g.fillRect(x, h - hh, 8, hh); g.fillRect(x - 2, h - hh, 12, 3);
      g.fillStyle = '#ff7a3c'; g.globalAlpha = 0.5; g.fillRect(x + 2, h - hh - 3, 4, 2); g.globalAlpha = 1;
    }
    layer(th.near, h * 0.8, 5, 0.03, 7, 4);
  } else {
    layer(th.far, h * 0.5, 22, 0.01, 3, 10); layer(th.near, h * 0.7, 12, 0.018, 5, 6);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect((hash2(i, 31) * w) | 0, (hash2(i, 32) * h * 0.5) | 0, 1, 1); }
  }
  return cv;
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// ---------- marchers ----------
// Palette: a pointed teal hood with a gold bobble, round face, orange smock, indigo legs.
export const PAL = {
  h: '#25b8a8', H: '#16857a', b: '#ffd23f', f: '#f7d6b4', F: '#e2b48d', e: '#1c1730',
  o: '#ff8c1a', O: '#d0670b', k: '#5a3418', l: '#3c3f7a', d: '#1f1d3a', w: '#ffffff',
};
// 7 x 11 frames facing right; x = column 3, feet on the row under the last line.
const HEAD = ['..b....', '..Hh...', '.Hhhh..', '.Hhhhh.', '.Hhffe.', '..fFff.'];
const BODY = {
  walk: [
    ['.OoooO.', '..ooo..', '..kkk..', '..l.l..', '.dd..d.'],
    ['..ooO..', '.Oooo..', '..kkk..', '...ll..', '...dd..'],
    ['.OoooO.', '..ooo..', '..kkk..', '..l.l..', '..d..dd'],
    ['..Ooo..', '..oooO.', '..kkk..', '..ll...', '..dd...'],
  ],
  stand: ['.OoooO.', '..ooo..', '..kkk..', '..l.l..', '..d.d..'],
  armsUp: ['O.ooo.O', '..ooo..', '..kkk..', '..l.l..', '..d.d..'],
  block: ['OOoooOO', '..ooo..', '..kkk..', '..l.l..', '.dd.dd.'],
  fall: ['O.ooo.O', '..ooo..', '..kkk..', '.l...l.', '.d...d.'],
};

function px(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }
function drawRows(g, rows, ox, oy, dir, pal, override) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < 7; c++) {
      const ch = row[c]; if (ch === '.') continue;
      const col = (override && override[ch]) || pal[ch];
      const cx = dir > 0 ? c - 3 : 3 - c;
      px(g, ox + cx, oy + r, col);
    }
  }
}

// digits 3x5 for bomb countdowns
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111'];
export function drawDigit(g, n, x, y) {
  const s = DIG[n] || DIG[0];
  g.fillStyle = '#1b1020';
  for (let i = 0; i < 15; i++) if (s[i] === '1') g.fillRect(x + (i % 3) - 1, y + ((i / 3) | 0), 3, 1), g.fillRect(x + (i % 3), y + ((i / 3) | 0) - 1, 1, 3);
  g.fillStyle = '#fff3b0';
  for (let i = 0; i < 15; i++) if (s[i] === '1') g.fillRect(x + (i % 3), y + ((i / 3) | 0), 1, 1);
}

export function bobbleColor(m) {
  if (m.climber && m.floater) return '#ff4fd8';
  if (m.climber) return '#8dff4f';
  if (m.floater) return '#ffffff';
  return PAL.b;
}

// Draw marcher m with its feet at screen (sx, sy) where sy is the ground row. t = global tick.
export function drawMarcher(g, m, sx, sy, t) {
  const dir = m.dir, st = m.state, c = m.c || 0;
  const pal = PAL, ov = { b: bobbleColor(m) };
  const top = sy - 11;
  const head = (dy = 0, dx = 0) => drawRows(g, HEAD, sx + dx, top + dy, dir, pal, ov);
  const body = (rows, dy = 0, dx = 0, o2) => drawRows(g, rows, sx + dx, top + 6 + dy, dir, pal, o2 ? { ...ov, ...o2 } : ov);
  const F = (dx, dy, col) => px(g, sx + dx * dir, sy + dy, col);
  switch (st) {
    case 'WALKING': case 'STEPPING_UP': {
      const f = ((t + m.id * 3) >> 1) & 3;
      const bob = f === 1 || f === 3 ? 0 : -1;
      head(bob + 1); body(BODY.walk[f], bob + 1);
      break;
    }
    case 'FALLING': {
      const flap = (t >> 1) & 1;
      head(); body(BODY.fall); if (flap) { F(-3, -6, pal.O); F(3, -6, pal.O); }
      break;
    }
    case 'FLOATING': {
      head(); body(BODY.armsUp);
      // leaf canopy with striped panels and two cords
      const cy = top - 6 + (((t >> 2) & 1) ? 0 : 1);
      const cols = ['#ffffff', '#ff5d73'];
      for (let i = -5; i <= 5; i++) {
        const hgt = i === -5 || i === 5 ? 1 : (Math.abs(i) >= 4 ? 2 : 3);
        g.fillStyle = cols[((i + 5) >> 1) & 1];
        g.fillRect(sx + i, cy + 3 - hgt, 1, hgt);
      }
      g.fillStyle = 'rgba(40,30,60,0.8)';
      for (let k = 0; k < 4; k++) { g.fillRect(sx - 4 + Math.round(k * 0.75), cy + 3 + k, 1, 1); g.fillRect(sx + 4 - Math.round(k * 0.75), cy + 3 + k, 1, 1); }
      break;
    }
    case 'CLIMBING': case 'HOISTING': {
      const f = (c >> 1) & 1;
      // drawn hugging the wall: shifted one column back from the wall face
      head(0, -dir); body(f ? BODY.armsUp : BODY.stand, 0, -dir);
      F(1, -10 + f, pal.F); F(1, -8 - f, pal.F);
      break;
    }
    case 'BLOCKING': {
      head(); body(BODY.block);
      // little red-and-white sash so stoppers read at a glance
      F(-1, -4, '#ff3b3b'); F(0, -4, '#ffffff'); F(1, -4, '#ff3b3b');
      break;
    }
    case 'BUILDING': {
      const lift = c >= 6 && c <= 9;
      head(); body(BODY.stand);
      g.fillStyle = '#d27a3e'; g.fillRect(sx + (dir > 0 ? 2 : -4), sy - (lift ? 7 : 5), 3, 2);
      g.fillStyle = '#f0a868'; g.fillRect(sx + (dir > 0 ? 2 : -4), sy - (lift ? 7 : 5), 3, 1);
      break;
    }
    case 'SHRUGGING': {
      head(c < 4 ? -1 : 0); body(BODY.armsUp);
      break;
    }
    case 'BASHING': {
      const s = c % 16, punch = s >= 2 && s <= 5;
      head(); body(BODY.stand);
      if (punch) { g.fillStyle = pal.F; g.fillRect(sx + (dir > 0 ? 3 : -5), sy - 6, 3, 2); g.fillStyle = '#ffffff'; g.fillRect(sx + (dir > 0 ? 6 : -6), sy - 7 + (s & 1), 1, 1); }
      else F(3, -5, pal.O);
      break;
    }
    case 'MINING': {
      const raised = c < 2 || c > 18;
      head(); body(BODY.stand);
      g.fillStyle = '#8a5a2b';
      if (raised) { g.fillRect(sx + dir * 1, sy - 13, 1, 6); g.fillStyle = '#c9d1db'; g.fillRect(sx + dir * 1 - 2, sy - 14, 5, 1); }
      else { for (let k = 0; k < 5; k++) px(g, sx + dir * (2 + k), sy - 7 + k, '#8a5a2b'); g.fillStyle = '#c9d1db'; g.fillRect(sx + dir * 6, sy - 4, 1, 4); }
      break;
    }
    case 'DIGGING': {
      const down = (c >> 2) & 1;
      head(down); body(BODY.stand, down);
      g.fillStyle = '#8a5a2b'; g.fillRect(sx + dir * 2, sy - 9 + down * 2, 1, 6);
      g.fillStyle = '#c9d1db'; g.fillRect(sx + dir * 2 - 1, sy - 3 + down * 2, 3, 2);
      if (down) { px(g, sx - 3, sy - 2 - ((t >> 1) & 1), '#a07040'); px(g, sx + 3, sy - 3, '#a07040'); }
      break;
    }
    case 'PRE_EXPLODE': {
      const flash = (t >> 1) & 1;
      const shake = (t & 1) ? 1 : 0;
      head(0, shake); body(BODY.armsUp, 0, shake, flash ? { o: '#ffffff', O: '#ff3030' } : { o: '#ff3030', O: '#ffffff' });
      break;
    }
    case 'SPLATTING': {
      const k = Math.min(3, c >> 2);
      g.fillStyle = pal.o; g.fillRect(sx - 2 - k, sy - 1, 5 + 2 * k, 1);
      g.fillStyle = pal.h; g.fillRect(sx - 1 - k, sy - 2, 3 + k, 1);
      g.fillStyle = PAL.b; g.fillRect(sx + k + 1, sy - 2 - (k ? 0 : 1), 1, 1);
      break;
    }
    case 'DROWNING': {
      const sink = Math.min(9, c >> 1);
      g.save(); g.beginPath(); g.rect(sx - 8, top - 10, 16, 11 + 10 - sink); g.clip();
      head(sink); body(BODY.armsUp, sink); g.restore();
      if (t & 2) px(g, sx + ((t >> 2) & 1 ? 1 : -2), top + sink - 2 - ((t >> 1) % 4), '#cdeeff');
      break;
    }
    case 'BURNING': {
      head(0, 0); body(BODY.armsUp, 0, 0, { o: '#3a2a2a', O: '#201818', h: '#3d4040', H: '#262828', f: '#5a4a40', F: '#4a3a30' });
      for (let k = 0; k < 6; k++) px(g, sx - 3 + ((k * 5 + t) % 7), top + 2 + ((k * 3 + t) % 8), k & 1 ? '#ffd23f' : '#ff5a1f');
      break;
    }
    case 'EXITING': {
      const k = c; // 0..7: shrink and fade into the door
      g.globalAlpha = Math.max(0.15, 1 - k / 8);
      head(k >> 1); body(BODY.stand, k >> 1);
      g.globalAlpha = 1;
      if (k & 1) { px(g, sx - 4, top + 2, '#fff7c2'); px(g, sx + 4, top + 5, '#fff7c2'); }
      break;
    }
    default: head(); body(BODY.stand);
  }
}

// ---------- role icons for the toolbar (small canvases) ----------
export function drawRoleIcon(g, role, w, h) {
  g.clearRect(0, 0, w, h);
  const m = { dir: 1, state: 'WALKING', c: 0, id: 0, climber: false, floater: false };
  const sx = (w >> 1), sy = h - 1;
  switch (role) {
    case 'climber': m.state = 'CLIMBING'; m.c = 2; m.climber = true; drawMarcher(g, m, sx - 1, sy, 0); g.fillStyle = '#9aa0b0'; g.fillRect(sx + 1, 1, 3, h - 1); break;
    case 'floater': m.state = 'FLOATING'; m.floater = true; drawMarcher(g, m, sx, sy, 0); break;
    case 'bomber': m.state = 'WALKING'; drawMarcher(g, m, sx, sy, 0); drawDigit(g, 5, sx - 1, 1); break;
    case 'blocker': m.state = 'BLOCKING'; drawMarcher(g, m, sx, sy, 0); break;
    case 'builder': m.state = 'BUILDING'; m.c = 7; drawMarcher(g, m, sx - 2, sy, 0); g.fillStyle = '#d27a3e'; g.fillRect(sx + 1, sy - 1, 6, 1); g.fillRect(sx + 3, sy - 2, 5, 1); break;
    case 'basher': m.state = 'BASHING'; m.c = 3; drawMarcher(g, m, sx - 3, sy, 0); g.fillStyle = '#a36d42'; g.fillRect(sx + 4, sy - 11, 4, 11); break;
    case 'miner': m.state = 'MINING'; m.c = 8; drawMarcher(g, m, sx - 2, sy, 0); break;
    case 'digger': m.state = 'DIGGING'; m.c = 4; drawMarcher(g, m, sx, sy - 1, 0); g.fillStyle = '#a36d42'; g.fillRect(sx - 6, sy, 13, 1); break;
  }
}
