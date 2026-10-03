// Marchers — hand-written solution directives, one list per level.
// A directive fires once, at the first tick where all its conditions hold:
//   id      which marcher (creation order)        x / y / dir / state  exact match on that marcher
//   after   index of a directive that must have fired first
//   tick    earliest tick                           when(m, sim)         extra predicate
//   any     oldest live marcher meeting the conditions (exclude: [ids]);  same: k  the marcher directive k picked
//   skill   role to give it;  rr: set the release rate;  nuke: true
// record-solutions.mjs turns these into plain positional click logs (solutions.json),
// and solver.test.mjs replays only those logs.
const each = (ids, f) => ids.flatMap(f);
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

export const SOLUTIONS = {
  L01: [{ id: 0, x: 300, skill: 'digger' }],
  L02: each(range(0, 10), k => [{ id: k, x: 150, skill: 'floater' }]),
  L03: [{ id: 0, x: 576, dir: 1, skill: 'builder' }],
  L04: [{ id: 0, x: 312, dir: 1, skill: 'basher' }],
  L05: each(range(0, 10), k => [{ id: k, x: 200, skill: 'climber' }]),
  L06: [{ id: 0, x: 380, skill: 'blocker' }, { id: 1, x: 200, skill: 'digger' }],
  L07: [{ id: 0, x: 220, skill: 'miner' }],
  L08: [{ id: 0, x: 221, dir: 1, skill: 'bomber' }],
};
Object.assign(SOLUTIONS, {
  L09: [
    { id: 0, x: 296, dir: 1, skill: 'builder' },
    { id: 1, x: 270, dir: 1, skill: 'blocker' },
    { id: 0, after: 0, state: 'SHRUGGING', skill: 'builder' },
    { id: 0, after: 2, state: 'SHRUGGING', skill: 'builder' },
    { id: 1, after: 3, when: (m, s) => s.marchers[0].x > 390, skill: 'bomber' },
  ],
  L10: each(range(0, 10), k => [{ id: k, x: 200, skill: 'climber' }, { id: k, x: 210, skill: 'floater' }]),
  L11: [{ id: 0, x: 248, dir: -1, skill: 'basher' }, { id: 0, after: 0, x: 174, dir: -1, skill: 'builder' }],
  L12: [
    { id: 0, x: 250, dir: 1, skill: 'builder' },
    { id: 0, after: 0, state: 'SHRUGGING', skill: 'builder' },
    { id: 0, after: 1, state: 'SHRUGGING', skill: 'basher' },
  ],
  L13: [
    { id: 0, x: 246, dir: 1, skill: 'builder' },
    { id: 1, x: 220, dir: 1, skill: 'blocker' },
    { id: 0, after: 0, x: 466, dir: 1, skill: 'builder' },
    { id: 1, after: 2, when: (m, s) => s.marchers[0].x > 500, skill: 'bomber' },
  ],
  L14: [
    { id: 0, x: 286, dir: 1, skill: 'builder' },
    { id: 1, x: 255, dir: 1, skill: 'blocker' },
    { id: 2, x: 229, dir: 1, skill: 'builder' },
    { id: 0, after: 0, x: 560, dir: 1, skill: 'digger' },
  ],
  L15: [
    { id: 0, x: 330, dir: 1, skill: 'builder' },
    { id: 1, x: 770, dir: 1, skill: 'blocker' },
    { id: 0, after: 0, state: 'SHRUGGING', skill: 'builder' },
    { id: 3, x: 509, dir: -1, skill: 'builder' },
    { id: 3, after: 3, state: 'SHRUGGING', skill: 'builder' },
  ],
  L16: [
    { id: 0, x: 216, dir: 1, skill: 'builder' },
    { id: 1, x: 190, dir: 1, skill: 'blocker' },
    { id: 0, after: 0, state: 'SHRUGGING', skill: 'builder' },
    { id: 0, after: 2, x: 300, skill: 'floater' },
    { id: 1, after: 3, skill: 'bomber' },
    ...each(range(2, 10), k => [{ id: k, x: 300, skill: 'floater' }]),
  ],
  L17: [{ id: 0, x: 230, dir: 1, skill: 'miner' }, { id: 0, after: 0, x: 592, dir: 1, skill: 'basher' }],
  L18: [
    { id: 0, x: 172, dir: 1, skill: 'builder' },
    { id: 0, after: 0, state: 'SHRUGGING', skill: 'builder' },
    { id: 0, after: 1, state: 'WALKING', dir: -1, skill: 'builder' },
    { id: 0, after: 2, state: 'SHRUGGING', skill: 'builder' },
  ],
});
Object.assign(SOLUTIONS, {
  L19: [
    { id: 0, x: 292, dir: 1, skill: 'basher' },
    { id: 0, after: 0, x: 480, dir: 1, skill: 'digger' },
    { any: true, after: 1, x: 950, dir: 1, y: 150, skill: 'builder' },
    { same: 2, after: 2, state: 'SHRUGGING', skill: 'builder' },
    { any: true, after: 3, x: 1392, dir: 1, y: 150, skill: 'basher' },
  ],
  L20: [
    { id: 0, x: 140, dir: 1, skill: 'miner' },
    { id: 1, x: 240, dir: 1, skill: 'blocker' },
    { id: 0, after: 0, x: 472, dir: 1, skill: 'basher' },
    { id: 0, after: 2, x: 616, dir: 1, skill: 'builder' },
    { any: true, after: 2, exclude: [0, 1], x: 590, dir: 1, y: 130, skill: 'blocker' },
    { id: 0, after: 3, state: 'SHRUGGING', skill: 'builder' },
    { any: true, after: 5, state: 'BLOCKING', exclude: [1], when: (m, s) => s.marchers[0].x > 680, skill: 'bomber' },
  ],
});
