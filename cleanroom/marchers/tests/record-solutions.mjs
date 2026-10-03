// Marchers — turns the hand-written solution directives in solutions-src.mjs into plain
// positional input logs (tick -> click at x,y with a role; release-rate changes), checks each
// one reaches the quota, and writes solutions.json. The solver test replays only that JSON.
// Run: node cleanroom/marchers/tests/record-solutions.mjs [levelId ...] [--verbose]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sim, hitBox } from '../../../public/apps/marchers/js/sim.js';
import { LEVELS } from '../../../public/apps/marchers/js/levels.js';
import { SOLUTIONS } from './solutions-src.mjs';

const OUT = fileURLToPath(new URL('./solutions.json', import.meta.url));

export function record(level, directives, { verbose = false, maxTicks = 40000 } = {}) {
  const sim = new Sim(level, { events: false });
  const fired = new Array(directives.length).fill(false);
  const notes = [];
  for (const d of directives) delete d._got;
  while (!sim.ended && sim.tick < maxTicks) {
    for (let i = 0; i < directives.length; i++) {
      if (fired[i]) continue;
      const d = directives[i];
      if (d.after != null && !fired[d.after]) continue;
      if (d.tick != null && sim.tick < d.tick) continue;
      if (d.rr != null) { sim.now({ rr: d.rr }); fired[i] = true; continue; }
      if (d.nuke) { sim.now({ nuke: true }); fired[i] = true; continue; }
      let m = null;
      if (d.any) {
        // the oldest live marcher matching every condition (and not excluded)
        m = sim.marchers.find(c => !c.removed && !(d.exclude || []).includes(c.id) && (d.x == null || c.x === d.x) && (d.dir == null || c.dir === d.dir) &&
          (d.y == null || c.y === d.y) && (d.state == null || c.state === d.state) && (!d.when || d.when(c, sim)) && sim.canAssign(c, d.skill)) || null;
      } else if (d.same != null) m = sim.marchers[directives[d.same]._got];
      else m = sim.marchers[d.id];
      if (!m || m.removed) continue;
      if (d.x != null && m.x !== d.x) continue;
      if (d.dir != null && m.dir !== d.dir) continue;
      if (d.y != null && m.y !== d.y) continue;
      if (d.state != null && m.state !== d.state) continue;
      if (d.when && !d.when(m, sim)) continue;
      if (!sim.canAssign(m, d.skill)) continue;
      // find a cursor point inside the marcher's hit box that a click would resolve to this marcher
      const b = hitBox(m), pts = [];
      for (let yy = b.y1 - 4; yy >= b.y0; yy--) for (let xx = b.x0; xx <= b.x1; xx++) pts.push([xx, yy]);
      pts.sort((p, q) => (Math.abs(p[0] - m.x) + Math.abs(p[1] - (m.y - 5))) - (Math.abs(q[0] - m.x) + Math.abs(q[1] - (m.y - 5))));
      let hit = null;
      for (const free of [false, true]) {
        for (const [xx, yy] of pts) if (sim.pickFor(xx, yy, d.skill, free) === m) { hit = { x: xx, y: yy, free }; break; }
        if (hit) break;
      }
      if (!hit) continue;
      const ev = { x: hit.x, y: hit.y, skill: d.skill }; if (hit.free) ev.free = true;
      const got = sim.now(ev);
      if (got !== m) throw new Error('recorder: click resolved to the wrong marcher');
      fired[i] = true; d._got = m.id;
      notes.push(`t${sim.tick} #${m.id} ${d.skill} @${m.x},${m.y}`);
    }
    sim.step();
  }
  const missed = directives.map((d, i) => fired[i] ? null : i).filter(i => i !== null);
  const fates = {};
  for (const m of sim.marchers) fates[m.fate || m.state] = (fates[m.fate || m.state] || 0) + 1;
  if (verbose) console.log(notes.join('\n'));
  return { log: sim.log.map(e => ({ ...e })), saved: sim.saved, needed: sim.needed, total: sim.total, tick: sim.tick, endReason: sim.endReason, missed, fates, timeLeft: sim.timeLeft, sim };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), verbose = args.includes('--verbose');
  const only = args.filter(a => !a.startsWith('--'));
  const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  let bad = 0;
  for (const L of LEVELS) {
    if (only.length && !only.includes(L.id)) continue;
    const dirs = SOLUTIONS[L.id];
    if (!dirs) { console.log(`${L.id}: NO SOLUTION`); bad++; continue; }
    const r = record(L, dirs, { verbose });
    const ok = r.saved >= r.needed && !r.missed.length;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${L.id} ${L.title.padEnd(24)} saved ${r.saved}/${r.total} need ${r.needed}  end ${r.endReason}@${r.tick} time left ${r.timeLeft}s  missed ${JSON.stringify(r.missed)} ${JSON.stringify(r.fates)}`);
    if (ok) out[L.id] = r.log; else bad++;
  }
  writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"') + '\n');
  if (bad) process.exitCode = 1;
}
