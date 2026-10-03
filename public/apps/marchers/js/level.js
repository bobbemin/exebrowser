// Marchers — level loader and validator (spec section 9). Pure, DOM-free.
import { Terrain, EMPTY, DIRT, STEEL, ONEWAY_L, ONEWAY_R, MAT } from './terrain.js';

export const ROLES = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];

export function parseTime(t) {
  if (typeof t === 'number') return t | 0;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '5:00'));
  if (!m) throw new Error('bad time ' + t);
  return (+m[1]) * 60 + (+m[2]);
}

function fillRect(T, x, y, w, h, v) {
  for (let j = Math.max(0, y); j < Math.min(T.h, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(T.w, x + w); i++) T.c[j * T.w + i] = v;
}
function fillEllipse(T, cx, cy, rx, ry, v) {
  for (let j = Math.max(0, Math.floor(cy - ry)); j <= Math.min(T.h - 1, Math.ceil(cy + ry)); j++)
    for (let i = Math.max(0, Math.floor(cx - rx)); i <= Math.min(T.w - 1, Math.ceil(cx + rx)); i++) {
      const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) T.c[j * T.w + i] = v;
    }
}
// even-odd fill, integer vertices, pixel-centre sampling (rule 9.2)
function fillPoly(T, pts, v) {
  const P = pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of P) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let j = Math.max(0, y0); j <= Math.min(T.h - 1, y1); j++) {
    const sy = j + 0.5, xs = [];
    for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      if ((a[1] <= sy) !== (b[1] <= sy)) xs.push(a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let i = Math.max(0, Math.ceil(xs[k] - 0.5)); i <= Math.min(T.w - 1, Math.floor(xs[k + 1] - 0.5)); i++) T.c[j * T.w + i] = v;
  }
}
// 1bpp run-length bitmap: base64 bytes are alternating run lengths, starting with an empty run
function fillBitmap(T, op, v) {
  const bin = typeof atob === 'function' ? atob(op.rle) : Buffer.from(op.rle, 'base64').toString('binary');
  let idx = 0, on = false;
  for (let k = 0; k < bin.length; k++) {
    const n = bin.charCodeAt(k);
    for (let r = 0; r < n; r++, idx++) {
      if (on) { const x = op.x + (idx % op.w), y = op.y + Math.floor(idx / op.w); if (x >= 0 && x < T.w && y >= 0 && y < T.h) T.c[y * T.w + x] = v; }
    }
    on = !on;
  }
}

const GRID_MAT = { '#': DIRT, 'S': STEEL, '<': ONEWAY_L, '>': ONEWAY_R };
const GRID_OBJ = { 'H': 'hatch', 'X': 'exit', '~': 'water', '^': 'fire', 'T': 'trap' };

function gridObjects(grid, scale) {
  const out = [], seen = new Set();
  const H = grid.length;
  for (let r = 0; r < H; r++) for (let c = 0; c < grid[r].length; c++) {
    const ch = grid[r][c];
    if (!GRID_OBJ[ch] || seen.has(r + ',' + c)) continue;
    let x0 = c, x1 = c, y0 = r, y1 = r; const st = [[r, c]]; seen.add(r + ',' + c);
    while (st.length) {
      const [rr, cc] = st.pop();
      x0 = Math.min(x0, cc); x1 = Math.max(x1, cc); y0 = Math.min(y0, rr); y1 = Math.max(y1, rr);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = rr + dr, nc = cc + dc, k = nr + ',' + nc;
        if (nr >= 0 && nr < H && nc >= 0 && grid[nr] && grid[nr][nc] === ch && !seen.has(k)) { seen.add(k); st.push([nr, nc]); }
      }
    }
    out.push({ type: GRID_OBJ[ch], x: x0 * scale, y: y0 * scale, w: (x1 - x0 + 1) * scale, h: (y1 - y0 + 1) * scale });
  }
  return out;
}

// Returns a fresh parsed level: { ...meta, terrain: Terrain, objects, hatches, exits, ... }
export function parseLevel(json) {
  const L = typeof json === 'string' ? JSON.parse(json) : json;
  const scale = L.scale || 4;
  let w = L.size && L.size.w, h = L.size && L.size.h;
  if (L.grid) { w = w || L.grid[0].length * scale; h = h || L.grid.length * scale; }
  w = w || 1600; h = h || 160;
  const fail = (m) => { throw new Error('level ' + (L.id || '?') + ': ' + m); };
  if (w < 16 || w > 3200 || h < 16 || h > 400) fail('size out of range');
  const total = L.total | 0, needed = L.needed | 0, rrMin = L.rrMin == null ? 50 : L.rrMin | 0;
  if (total < 1 || total > 200) fail('total must be 1..200');
  if (needed < 0 || needed > total) fail('needed must be 0..total');
  if (rrMin < 1 || rrMin > 99) fail('rrMin must be 1..99');
  const skills = {};
  for (const r of ROLES) {
    const n = L.skills && L.skills[r] != null ? L.skills[r] | 0 : 0;
    if (n < -1 || n > 99) fail('skill count ' + r);
    skills[r] = n;
  }
  const T = new Terrain(w, h);
  if (L.grid) {
    for (let r = 0; r < L.grid.length; r++) for (let c = 0; c < L.grid[r].length; c++) {
      const v = GRID_MAT[L.grid[r][c]];
      if (v) fillRect(T, c * scale, r * scale, scale, scale, v);
    }
  }
  for (const op of L.terrain || []) {
    const v = op.op === 'erase' ? EMPTY : MAT[op.mat || 'dirt'];
    if (v === undefined) fail('bad material ' + op.mat);
    const shape = op.op === 'erase' ? (op.shape || 'rect') : op.op;
    if (shape === 'rect') fillRect(T, op.x, op.y, op.w, op.h, v);
    else if (shape === 'ellipse') fillEllipse(T, op.cx, op.cy, op.rx, op.ry, v);
    else if (shape === 'poly') fillPoly(T, op.pts, v);
    else if (shape === 'bitmap') fillBitmap(T, op, v);
    else fail('bad op ' + op.op);
  }
  const objects = [...(L.grid ? gridObjects(L.grid, scale) : []), ...(L.objects || [])].map((o, i) => ({ ...o, idx: i }));
  for (const o of objects) {
    if (!['hatch', 'exit', 'water', 'fire', 'trap'].includes(o.type)) fail('bad object ' + o.type);
    if (o.x < 0 || o.y < 0 || o.w < 1 || o.h < 1 || o.x + o.w > w || o.y + o.h > h) fail('object outside level: ' + o.type);
  }
  const hatches = objects.filter(o => o.type === 'hatch');
  const exits = objects.filter(o => o.type === 'exit');
  if (!hatches.length) fail('needs a hatch');
  if (!exits.length) fail('needs an exit');
  const time = parseTime(L.time);
  if (time < 1 || time > 99 * 60 + 59) fail('time out of range');
  return {
    id: L.id, title: L.title || '', author: L.author || '', hint: L.hint || '', theme: L.theme || 'loam',
    w, h, total, needed, rrMin, time, skills, terrain: T, objects, hatches, exits,
    camera: L.camera || { x: 0, y: 0 }, raw: L,
  };
}
