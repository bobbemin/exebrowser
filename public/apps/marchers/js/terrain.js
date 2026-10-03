// Marchers — terrain bitmap. Pure, DOM-free.
export const EMPTY = 0, DIRT = 1, STEEL = 2, ONEWAY_L = 3, ONEWAY_R = 4;
export const MAT = { dirt: DIRT, steel: STEEL, oneway_l: ONEWAY_L, oneway_r: ONEWAY_R };

export class Terrain {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.c = new Uint8Array(w * h);
    // purely visual: 1 = laid by a builder (drawn as masonry). Never read by the rules.
    this.tint = new Uint8Array(w * h);
    this.dirty = null; // {x0,y0,x1,y1} union of changed cells since the renderer last looked
  }
  clone() {
    const t = new Terrain(this.w, this.h);
    t.c.set(this.c); t.tint.set(this.tint); return t;
  }
  // rule 1.2.2 / 1.2.3: outside = EMPTY, except probes above row 0 read row 0
  get(x, y) {
    if (x < 0 || x >= this.w || y >= this.h) return EMPTY;
    if (y < 0) y = 0;
    return this.c[y * this.w + x];
  }
  solid(x, y) { return this.get(x, y) !== EMPTY; }
  set(x, y, v) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.c[y * this.w + x] = v; this.tint[y * this.w + x] = 0; this.mark(x, y);
  }
  mark(x, y) {
    const d = this.dirty;
    if (!d) this.dirty = { x0: x, y0: y, x1: x, y1: y };
    else { if (x < d.x0) d.x0 = x; if (x > d.x1) d.x1 = x; if (y < d.y0) d.y0 = y; if (y > d.y1) d.y1 = y; }
  }
  // rule 1.2.4: only DIRT and one-way cells are ever removed
  remove(x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
    const i = y * this.w + x, v = this.c[i];
    if (v === DIRT || v === ONEWAY_L || v === ONEWAY_R) { this.c[i] = EMPTY; this.tint[i] = 0; this.mark(x, y); return true; }
    return false;
  }
  // removal by a tunnelling marcher: a one-way cell only yields to a marcher facing its way
  removeDir(x, y, dir) {
    const v = this.get(x, y);
    if ((v === ONEWAY_L && dir > 0) || (v === ONEWAY_R && dir < 0)) return false;
    if (y < 0) return false;
    return this.remove(x, y);
  }
  // rule 1.2.5: bricks only fill EMPTY cells
  add(x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
    const i = y * this.w + x;
    if (this.c[i] !== EMPTY) return false;
    this.c[i] = DIRT; this.tint[i] = 1; this.mark(x, y); return true;
  }
  hash() {
    let h = 0x811c9dc5 | 0;
    const c = this.c;
    for (let i = 0; i < c.length; i++) { h ^= c[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  }
}
export function wrongOneWay(v, dir) { return (v === ONEWAY_L && dir > 0) || (v === ONEWAY_R && dir < 0); }
