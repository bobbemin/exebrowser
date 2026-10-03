// Shared helpers for the Marchers headless tests.
import { Sim, S } from '../../../public/apps/marchers/js/sim.js';
import { parseLevel } from '../../../public/apps/marchers/js/level.js';
export { Sim, S, parseLevel };

// The standard spec-10 test level: 320 x 160, dirt slab with its top at y = 120, one hatch,
// an exit parked out of reach in the top-right corner (a level must have one).
export function mkLevel(extra = {}) {
  const base = {
    format: 'marchers-level/1', id: 'test', title: 'test', size: { w: 320, h: 160 },
    total: 1, needed: 0, rrMin: 50, time: '5:00',
    skills: { climber: 9, floater: 9, bomber: 9, blocker: 9, builder: 9, basher: 9, miner: 9, digger: 9 },
    terrain: [{ op: 'rect', x: 0, y: 120, w: 320, h: 40, mat: 'dirt' }],
    objects: [{ type: 'hatch', x: 20, y: 60, w: 20, h: 10 }, { type: 'exit', x: 316, y: 0, w: 4, h: 4 }],
  };
  const L = { ...base, ...extra };
  if (extra.addTerrain) L.terrain = [...base.terrain, ...extra.addTerrain];
  if (extra.addObjects) L.objects = [...base.objects, ...extra.addObjects];
  return L;
}
export function mkSim(extra) { return new Sim(mkLevel(extra)); }
// assign a role to a specific marcher through the positional input path (cursor at its feet - 4)
export function give(sim, m, skill, free = false) { return sim.now({ x: m.x, y: m.y - 4, skill, free }); }
export function stepUntil(sim, pred, max = 5000) {
  for (let i = 0; i < max; i++) { if (pred()) return i; sim.step(); }
  if (pred()) return max;
  throw new Error('condition not reached in ' + max + ' ticks');
}
