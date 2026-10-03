// Marchers — headless acceptance tests for SPEC.md section 10.
// Run: node --test cleanroom/marchers/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, S, mkLevel, mkSim, give, stepUntil, parseLevel } from './helpers.mjs';
import { releaseInterval, bombDigit, BOMB_TICKS, PRE_EXPLODE_TICKS } from '../../../public/apps/marchers/js/sim.js';
import { DIRT, STEEL, EMPTY, ONEWAY_L } from '../../../public/apps/marchers/js/terrain.js';

const rect = (x, y, w, h, mat = 'dirt') => ({ op: 'rect', x, y, w, h, mat });
const erase = (x, y, w, h) => ({ op: 'erase', shape: 'rect', x, y, w, h });

// ---------------- Timing and release ----------------
test('T01 hatch opens at tick 35, first marcher at tick 55', () => {
  const sim = mkSim();
  stepUntil(sim, () => sim.hatchOpen);
  assert.equal(sim.tick, 35);
  stepUntil(sim, () => sim.marchers.length > 0);
  assert.equal(sim.tick, 55);
  assert.equal(sim.marchers[0].state === S.FALLING || sim.marchers[0].state === S.WALKING, true);
  assert.equal(sim.marchers[0].dir, 1);
});

test('T02 release intervals: RR99=4, RR1=53, RR50=28, RR98=RR99', () => {
  assert.equal(releaseInterval(99), 4); assert.equal(releaseInterval(1), 53);
  assert.equal(releaseInterval(50), 28); assert.equal(releaseInterval(98), releaseInterval(99));
  for (const [rr, gap] of [[99, 4], [1, 53], [50, 28], [98, 4]]) {
    const sim = mkSim({ total: 4, rrMin: rr });
    sim.step(55 + gap * 3 + 1);
    const born = sim.marchers.map(m => m.born + 1);
    assert.deepEqual(born.slice(1).map((b, i) => b - born[i]), [gap, gap, gap], 'rr ' + rr);
  }
});

test('T03 release rate is clamped to rrMin..99', () => {
  const sim = mkSim({ rrMin: 50 });
  sim.input([{ tick: 0, rr: 10 }]); sim.step();
  assert.equal(sim.rr, 50);
  sim.input([{ tick: 1, rr: 200 }]); sim.step();
  assert.equal(sim.rr, 99);
  sim.now({ rr: 70 }); assert.equal(sim.rr, 70);
});

test('T04 no more than total marchers are released', () => {
  const sim = mkSim({ total: 3, rrMin: 99 });
  sim.step(600);
  assert.equal(sim.released, 3); assert.equal(sim.marchers.length, 3);
});

test('T05 a 5:00 clock reads 4:00 after 17 x 60 ticks', () => {
  const sim = mkSim();
  sim.spawnAt(100, 120, 1, S.BLOCKING);
  sim.step(17 * 60);
  assert.equal(sim.clock(), '4:00');
});

test('T06 two hatches alternate', () => {
  const sim = mkSim({ total: 6, rrMin: 99, objects: [{ type: 'hatch', x: 20, y: 60, w: 20, h: 10 }, { type: 'hatch', x: 200, y: 60, w: 20, h: 10 }, { type: 'exit', x: 316, y: 0, w: 4, h: 4 }] });
  sim.step(55 + 4 * 5 + 1);
  assert.equal(sim.marchers.length, 6);
  // spawn x: hatch 0 centre 30, hatch 1 centre 210 (they have walked since, so compare by birth order)
  const firstX = (m) => m.born; // ensure creation order
  assert.deepEqual(sim.marchers.map(firstX), [...sim.marchers.map(firstX)].sort((a, b) => a - b));
  const sides = sim.marchers.map(m => m.x < 120 ? 0 : 1);
  assert.deepEqual(sides, [0, 1, 0, 1, 0, 1]);
});

// ---------------- Walking ----------------
test('T10 walker moves +1 px per tick on flat ground', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 120, 1);
  for (let i = 1; i <= 20; i++) { sim.step(); assert.equal(m.x, 100 + i); assert.equal(m.y, 120); }
  const sim2 = mkSim(); const m2 = sim2.spawnAt(100, 120, -1);
  sim2.step(10); assert.equal(m2.x, 90);
});

test('T11 steps of 1 and 2 px are climbed in the same tick', () => {
  const sim = mkSim({ addTerrain: [rect(110, 119, 50, 1), rect(130, 117, 30, 2)] });
  const m = sim.spawnAt(100, 120, 1);
  sim.step(10); assert.deepEqual([m.x, m.y, m.state], [110, 119, S.WALKING]);
  sim.step(20); assert.deepEqual([m.x, m.y, m.state], [130, 117, S.WALKING]);
});

test('T12 steps of 3-6 px go through STEPPING_UP and end on top', () => {
  for (const hgt of [3, 4, 5, 6]) {
    const sim = mkSim({ addTerrain: [rect(110, 120 - hgt, 60, hgt)] });
    const m = sim.spawnAt(100, 120, 1);
    const seen = new Set();
    for (let i = 0; i < 30; i++) { sim.step(); seen.add(m.state); }
    assert.ok(seen.has(S.STEPPING_UP), 'stepping up for ' + hgt);
    assert.equal(m.y, 120 - hgt); assert.equal(m.state, S.WALKING); assert.equal(m.dir, 1);
  }
});

test('T13 a 7 px wall turns a walker; a 6 px step does not', () => {
  const s7 = mkSim({ addTerrain: [rect(110, 113, 20, 7)] }); const a = s7.spawnAt(100, 120, 1);
  s7.step(10); assert.equal(a.dir, -1); assert.equal(a.x, 109); assert.equal(a.y, 120);
  const s6 = mkSim({ addTerrain: [rect(110, 114, 20, 6)] }); const b = s6.spawnAt(100, 120, 1);
  s6.step(20); assert.equal(b.dir, 1); assert.equal(b.y, 114);
});

test('T14 a 3 px drop is walked down; a 4 px drop causes FALLING', () => {
  const s3 = mkSim({ addTerrain: [rect(0, 117, 110, 3)] }); const a = s3.spawnAt(100, 117, 1);
  const st3 = new Set(); for (let i = 0; i < 20; i++) { s3.step(); st3.add(a.state); }
  assert.ok(!st3.has(S.FALLING)); assert.equal(a.y, 120);
  const s4 = mkSim({ addTerrain: [rect(0, 116, 110, 4)] }); const b = s4.spawnAt(100, 116, 1);
  const st4 = new Set(); for (let i = 0; i < 20; i++) { s4.step(); st4.add(b.state); }
  assert.ok(st4.has(S.FALLING)); assert.equal(b.y, 120); assert.equal(b.state, S.WALKING);
});

test('T15 walker at x = 0 or width-1 turns around', () => {
  const sim = mkSim(); const m = sim.spawnAt(315, 120, 1);
  stepUntil(sim, () => m.dir === -1, 20); assert.equal(m.x, 319);
  const sim2 = mkSim(); const b = sim2.spawnAt(4, 120, -1);
  stepUntil(sim2, () => b.dir === 1, 20); assert.equal(b.x, 0);
});

// ---------------- Falling ----------------
test('T20 falling speed is 3 px per tick', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 10, 1, S.FALLING);
  for (let i = 1; i <= 10; i++) { sim.step(); assert.equal(m.y, 10 + 3 * i); }
});

function fallFrom(D, start = 'ledge') {
  // floor top at 150; for 'ledge' a platform ends at x = 100 with its top D px above the floor
  const L = mkLevel({ terrain: [rect(0, 150, 320, 10), ...(start === 'ledge' ? [rect(0, 150 - D, 101, D)] : [])] });
  const sim = new Sim(L);
  const m = start === 'ledge' ? sim.spawnAt(98, 150 - D, 1) : sim.spawnAt(150, 150 - D, 1, S.FALLING);
  stepUntil(sim, () => m.removed || m.state === S.SPLATTING || (m.state === S.WALKING && m.y === 150), 400);
  return m.state === S.SPLATTING || m.removed ? 'splat' : 'safe';
}
test('T21 fall damage: 60 safe, 66 fatal; walk-off golden threshold is 67 px', () => {
  assert.equal(fallFrom(60, 'air'), 'safe');
  assert.equal(fallFrom(62, 'air'), 'safe');
  assert.equal(fallFrom(63, 'air'), 'splat');
  assert.equal(fallFrom(66, 'air'), 'splat');
  assert.equal(fallFrom(60, 'ledge'), 'safe');
  // golden value: a walker stepping off a ledge survives a 66 px drop and splats from 67 px
  let threshold = 0;
  for (let D = 40; D < 90; D++) if (fallFrom(D, 'ledge') === 'splat') { threshold = D; break; }
  assert.equal(threshold, 67);
  for (let D = threshold; D < threshold + 20; D++) assert.equal(fallFrom(D, 'ledge'), 'splat');
});

test('T22 floater survives 150 px, opens after fallen > 16, then 2 px/tick', () => {
  const L = mkLevel({ terrain: [rect(0, 155, 320, 5)] });
  const sim = new Sim(L); const m = sim.spawnAt(150, 5, 1, S.FALLING);
  give(sim, m, 'floater'); assert.equal(m.floater, true);
  let opened = -1;
  for (let i = 1; i < 200 && opened < 0; i++) { sim.step(); if (m.state === S.FLOATING) opened = i; }
  assert.equal(opened, 7); // 6 full falling ticks (fallen 18 > 16), opens on the 7th
  sim.step(8); // the opening sequence
  const y0 = m.y; sim.step(5); assert.equal(m.y - y0, 10);
  stepUntil(sim, () => m.state === S.WALKING, 200);
  assert.equal(m.y, 155); assert.equal(m.removed, false);
});

test('T23 falling below height + 3 is removed and counted dead', () => {
  const sim = mkSim({ terrain: [rect(0, 120, 100, 40)] });
  const m = sim.spawnAt(150, 100, 1, S.FALLING);
  stepUntil(sim, () => m.removed, 100);
  assert.equal(sim.dead, 1); assert.equal(m.fate, 'fell'); assert.ok(m.y > 163);
});

test('T24 a fatal fall onto an exit is a death', () => {
  const sim = mkSim({ objects: [{ type: 'hatch', x: 20, y: 60, w: 20, h: 10 }, { type: 'exit', x: 140, y: 110, w: 20, h: 12 }] });
  const m = sim.spawnAt(150, 30, 1, S.FALLING);
  stepUntil(sim, () => m.removed, 200);
  assert.equal(sim.saved, 0); assert.equal(m.fate, 'splat');
});

// ---------------- Climber ----------------
test('T30 climber climbs a 40 px wall at 0.5 px/tick, hoists and walks on', () => {
  const sim = mkSim({ addTerrain: [rect(150, 80, 30, 40)] });
  const m = sim.spawnAt(140, 120, 1); give(sim, m, 'climber');
  stepUntil(sim, () => m.state === S.CLIMBING, 30);
  const y0 = m.y; sim.step(16); assert.equal(y0 - m.y, 8);
  stepUntil(sim, () => m.state === S.HOISTING, 200);
  stepUntil(sim, () => m.state === S.WALKING, 20);
  sim.step(5);
  assert.equal(m.y, 80); assert.equal(m.dir, 1); assert.ok(m.x > 150);
});

test('T31 climber under an overhang falls off, facing away, 2 px off the wall', () => {
  const sim = mkSim({ addTerrain: [rect(150, 60, 30, 60), rect(140, 90, 10, 6)] });
  const m = sim.spawnAt(130, 120, 1); give(sim, m, 'climber');
  stepUntil(sim, () => m.state === S.CLIMBING, 40);
  stepUntil(sim, () => m.state === S.FALLING, 200);
  assert.equal(m.dir, -1); assert.equal(m.x, 148);
  stepUntil(sim, () => m.state === S.WALKING, 100); assert.equal(m.climber, true);
});

test('T32 climber assigned while falling climbs the next wall', () => {
  const sim = mkSim({ addTerrain: [rect(150, 80, 30, 40)] });
  const m = sim.spawnAt(120, 80, 1, S.FALLING);
  assert.ok(give(sim, m, 'climber'));
  stepUntil(sim, () => m.state === S.CLIMBING, 100);
  stepUntil(sim, () => m.state === S.WALKING && m.y === 80, 300);
});

test('T33 climber cannot be assigned twice', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 120, 1);
  assert.ok(give(sim, m, 'climber')); const n = sim.skills.climber;
  assert.equal(give(sim, m, 'climber'), null); assert.equal(sim.skills.climber, n);
});

// ---------------- Bomber ----------------
test('T40 bomber: walking explodes 79 + 16 ticks after assignment; falling exactly 79', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 120, 1); give(sim, m, 'bomber');
  const t0 = sim.tick; stepUntil(sim, () => m.removed, 200);
  assert.equal(sim.tick - t0, BOMB_TICKS + PRE_EXPLODE_TICKS); assert.equal(m.fate, 'boom');
  const L = mkLevel({ size: { w: 320, h: 400 }, terrain: [rect(0, 390, 100, 10)] });
  const s2 = new Sim(L); const f = s2.spawnAt(200, 5, 1, S.FALLING); give(s2, f, 'bomber');
  const t1 = s2.tick; stepUntil(s2, () => f.removed, 200);
  assert.equal(s2.tick - t1, BOMB_TICKS); assert.equal(f.fate, 'boom');
});

test('T41 crater removes dirt inside the ellipse and leaves steel', () => {
  const sim = mkSim({ addTerrain: [rect(150, 100, 4, 4, 'steel')] });
  const m = sim.spawnAt(150, 120, 1, S.BLOCKING); give(sim, m, 'bomber');
  stepUntil(sim, () => m.removed, 200);
  const T = sim.T, cx = 150, cy = 116;
  for (let y = 95; y < 140; y++) for (let x = 135; x < 165; x++) {
    const a = (x - cx + 0.5) / 8, b = (y - cy + 0.5) / 11, inside = a * a + b * b <= 1 && x - cx >= -8 && x - cx < 8 && y - cy >= -11 && y - cy < 11;
    const orig = (x >= 150 && x < 154 && y >= 100 && y < 104) ? STEEL : (y >= 120 ? DIRT : EMPTY);
    const want = orig === STEEL ? STEEL : (inside ? EMPTY : orig);
    assert.equal(T.get(x, y), want, `cell ${x},${y}`);
  }
});

test('T42 an explosion does not kill a marcher 3 px away', () => {
  const sim = mkSim({ total: 2 });
  const a = sim.spawnAt(150, 120, 1, S.BLOCKING); const b = sim.spawnAt(153, 120, 1, S.SHRUGGING);
  b.c = -1000; // keep it standing still for the test
  assert.equal(sim.assignAt(145, 116, 'bomber'), a); stepUntil(sim, () => a.removed, 200);
  assert.equal(b.removed, false); assert.equal(sim.dead, 1);
});

test('T43 countdown digit buckets', () => {
  for (let t = 65; t <= 79; t++) assert.equal(bombDigit(t), 5);
  for (let t = 49; t <= 64; t++) assert.equal(bombDigit(t), 4);
  for (let t = 33; t <= 48; t++) assert.equal(bombDigit(t), 3);
  for (let t = 17; t <= 32; t++) assert.equal(bombDigit(t), 2);
  for (let t = 1; t <= 16; t++) assert.equal(bombDigit(t), 1);
});

// ---------------- Blocker ----------------
test('T50 walkers turn at the blocker field edge from either side', () => {
  const sim = mkSim({ total: 3 });
  const b = sim.spawnAt(150, 120, 1); give(sim, b, 'blocker');
  const l = sim.spawnAt(130, 120, 1), r = sim.spawnAt(170, 120, -1);
  stepUntil(sim, () => l.dir === -1, 30); assert.equal(l.x, 144);
  stepUntil(sim, () => r.dir === 1, 30); assert.equal(r.x, 155);
  sim.step(40); assert.ok(l.x < 144 && r.x > 155);
});

test('T51 blocker over a dug floor becomes a walker, falls, and its field goes', () => {
  const sim = mkSim({ total: 3, terrain: [rect(0, 120, 320, 12), rect(0, 150, 320, 10), rect(136, 100, 8, 20), rect(158, 100, 8, 20)] });
  const b = sim.spawnAt(150, 120, 1); give(sim, b, 'blocker');
  const d = sim.spawnAt(152, 120, 1); assert.ok(give(sim, d, 'digger')); assert.equal(d.state, S.DIGGING);
  stepUntil(sim, () => b.state !== S.BLOCKING, 300);
  assert.equal(b.state, S.WALKING); assert.equal(sim._hasField(b), false);
  stepUntil(sim, () => b.state === S.FALLING, 300);
  const w = sim.spawnAt(130, 150, 1); sim.step(30); assert.equal(w.dir, 1); // no field any more
});

test('T52 a second blocker cannot be placed inside the first field', () => {
  const sim = mkSim({ total: 2 });
  const a = sim.spawnAt(150, 120, 1); give(sim, a, 'blocker');
  const b = sim.spawnAt(140, 120, 1); b.state = S.WALKING;
  const n = sim.skills.blocker;
  assert.equal(sim.canAssign(b, 'blocker'), false);
  assert.equal(sim.assignAt(b.x - 5, b.y - 4, 'blocker'), null);
  assert.equal(sim.skills.blocker, n);
  b.x = 120; assert.equal(sim.canAssign(b, 'blocker'), true);
});

test('T53 a builder walking into a field keeps building but reverses', () => {
  const sim = mkSim({ total: 2 });
  const blk = sim.spawnAt(200, 120, 1); give(sim, blk, 'blocker');
  const m = sim.spawnAt(180, 120, 1); give(sim, m, 'builder');
  stepUntil(sim, () => m.dir === -1, 400);
  assert.equal(m.state, S.BUILDING);
  sim.step(16); assert.equal(m.state, S.BUILDING); assert.equal(m.dir, -1);
});

test('T54 a blocker accepts bomber but not builder/basher/miner/digger', () => {
  const sim = mkSim(); const m = sim.spawnAt(150, 120, 1); give(sim, m, 'blocker');
  for (const r of ['builder', 'basher', 'miner', 'digger', 'blocker', 'climber', 'floater']) assert.equal(give(sim, m, r), null, r);
  assert.ok(give(sim, m, 'bomber'));
});

// ---------------- Builder ----------------
function buildRun(extra, x = 100, dir = 1) {
  const sim = mkSim(extra); const m = sim.spawnAt(x, 120, dir); give(sim, m, 'builder');
  return { sim, m };
}
test('T60 twelve bricks: 24 px on, 12 px up, shrug, walk on', () => {
  const { sim, m } = buildRun();
  stepUntil(sim, () => m.state === S.SHRUGGING, 400);
  assert.deepEqual([m.x, m.y], [124, 108]);
  stepUntil(sim, () => m.state === S.WALKING, 20); assert.equal(m.dir, 1);
  const { sim: s2, m: m2 } = buildRun({}, 200, -1);
  stepUntil(s2, () => m2.state === S.SHRUGGING, 400); assert.deepEqual([m2.x, m2.y], [176, 108]);
});

test('T61 the running-out cue is raised on bricks 10, 11 and 12 only', () => {
  const { sim, m } = buildRun();
  stepUntil(sim, () => m.state === S.SHRUGGING, 400);
  const warns = sim.events.filter(e => e.type === 'warn').map(e => e.extra);
  const bricks = sim.events.filter(e => e.type === 'brick').length;
  assert.deepEqual(warns, [10, 11, 12]); assert.equal(bricks, 12);
});

test('T62 a builder hitting a ceiling turns around and walks', () => {
  const { sim, m } = buildRun({ addTerrain: [rect(90, 96, 80, 10)] });
  stepUntil(sim, () => m.state !== S.BUILDING, 400);
  assert.equal(m.state, S.WALKING); assert.equal(m.dir, -1);
  assert.ok(sim.events.filter(e => e.type === 'brick').length < 12);
});

test('T63 a builder approaching a wall turns before the 12th brick', () => {
  const { sim, m } = buildRun({ addTerrain: [rect(140, 60, 10, 60)] }, 120);
  stepUntil(sim, () => m.state !== S.BUILDING, 400);
  assert.equal(m.state, S.WALKING); assert.equal(m.dir, -1);
  const n = sim.events.filter(e => e.type === 'brick').length; assert.ok(n < 12 && n > 0, 'bricks ' + n);
});

test('T64 a builder given to a shrugging marcher continues the staircase', () => {
  const { sim, m } = buildRun();
  stepUntil(sim, () => m.state === S.SHRUGGING, 400);
  assert.ok(give(sim, m, 'builder'));
  stepUntil(sim, () => m.state === S.SHRUGGING, 400);
  assert.deepEqual([m.x, m.y], [148, 96]);
});

test('T65 a builder cannot be given to a BUILDING marcher', () => {
  const { sim, m } = buildRun(); const n = sim.skills.builder;
  sim.step(3); assert.equal(give(sim, m, 'builder'), null); assert.equal(sim.skills.builder, n);
});

test('T66 bricks never overwrite steel or existing dirt', () => {
  const sim = mkSim({ addTerrain: [rect(103, 119, 1, 1, 'steel'), rect(105, 119, 1, 1, 'dirt')] });
  const m = sim.spawnAt(100, 120, 1); give(sim, m, 'builder'); sim.step(12);
  assert.equal(sim.T.get(103, 119), STEEL); assert.equal(sim.T.get(105, 119), DIRT);
  assert.equal(sim.T.tint[119 * 320 + 105], 0); assert.equal(sim.T.tint[119 * 320 + 104], 1);
});

// ---------------- Basher ----------------
test('T70 basher goes through a 40 px wall, tunnel >= 9 px high, walks out', () => {
  const sim = mkSim({ addTerrain: [rect(150, 60, 40, 60)] });
  const m = sim.spawnAt(141, 120, 1); assert.ok(give(sim, m, 'basher'));
  stepUntil(sim, () => m.state === S.WALKING, 600);
  assert.ok(m.x >= 180, 'x ' + m.x); assert.equal(m.dir, 1);
  for (let x = 150; x < 190; x++) for (let y = 111; y <= 119; y++) assert.equal(sim.T.get(x, y), EMPTY, `${x},${y}`);
  sim.step(30); assert.ok(m.x > 200); assert.equal(m.y, 120);
});

test('T71 basher stops without turning when the terrain ends, only on first strokes', () => {
  const sim = mkSim({ addTerrain: [rect(150, 60, 25, 60)] });
  const m = sim.spawnAt(141, 120, 1); give(sim, m, 'basher'); const t0 = sim.tick;
  stepUntil(sim, () => m.state === S.WALKING, 600);
  assert.equal(m.dir, 1); assert.equal((sim.tick - t0 - 6) % 32, 0);
  // assigning with nothing ahead: carves air once, stops at tick 5
  const s2 = mkSim(); const a = s2.spawnAt(100, 120, 1); give(s2, a, 'basher');
  s2.step(5); assert.equal(a.state, S.BASHING); s2.step(1); assert.equal(a.state, S.WALKING);
});

test('T72 basher meeting steel turns and walks; steel unchanged', () => {
  const sim = mkSim({ addTerrain: [rect(150, 60, 50, 60), rect(175, 60, 10, 60, 'steel')] });
  const m = sim.spawnAt(141, 120, 1); give(sim, m, 'basher');
  stepUntil(sim, () => m.state === S.WALKING, 600);
  assert.equal(m.dir, -1);
  for (let x = 175; x < 185; x++) for (let y = 60; y < 120; y++) assert.equal(sim.T.get(x, y), STEEL);
  assert.ok(sim.events.some(e => e.type === 'clank'));
});

test('T73 basher assignment with steel at the probe fails', () => {
  const sim = mkSim({ addTerrain: [rect(108, 100, 5, 20, 'steel')] });
  const m = sim.spawnAt(100, 120, 1); const n = sim.skills.basher;
  assert.equal(give(sim, m, 'basher'), null); assert.equal(sim.skills.basher, n); assert.equal(m.state, S.WALKING);
});

test('T74 one-way: facing right into a left-only wall turns; facing left passes', () => {
  const L = { addTerrain: [rect(150, 60, 20, 60, 'oneway_l')] };
  const sim = mkSim(L); const m = sim.spawnAt(139, 120, 1); assert.ok(give(sim, m, 'basher'));
  stepUntil(sim, () => m.state === S.WALKING, 300); assert.equal(m.dir, -1);
  for (let x = 150; x < 170; x++) assert.equal(sim.T.get(x, 115), ONEWAY_L);
  // assignment right at the wall fails
  const s3 = mkSim(L); const c = s3.spawnAt(143, 120, 1); assert.equal(give(s3, c, 'basher'), null);
  const s2 = mkSim(L); const b = s2.spawnAt(180, 120, -1); assert.ok(give(s2, b, 'basher'));
  stepUntil(s2, () => b.state === S.WALKING, 400); assert.equal(b.dir, -1);
  s2.step(20); assert.ok(b.x < 140);
});

test('T75 basher whose floor disappears falls', () => {
  const sim = mkSim({ addTerrain: [rect(150, 60, 40, 60), erase(170, 120, 150, 40)] });
  const m = sim.spawnAt(141, 120, 1); give(sim, m, 'basher');
  stepUntil(sim, () => m.state === S.FALLING, 600); assert.ok(m.x >= 170);
});

// ---------------- Miner ----------------
test('T80 miner descends 2 px per 4 px forward', () => {
  const sim = mkSim({ addTerrain: [rect(0, 40, 320, 80)] });
  const m = sim.spawnAt(100, 40, 1); give(sim, m, 'miner');
  sim.step(24); const x0 = m.x, y0 = m.y;
  sim.step(48 * 3); assert.equal(m.x - x0, 24); assert.equal(m.y - y0, 12);
  const s2 = mkSim({ addTerrain: [rect(0, 40, 320, 80)] }); const b = s2.spawnAt(200, 40, -1); give(s2, b, 'miner');
  s2.step(24 * 5 + 1); assert.equal(b.x, 180); assert.equal(b.y, 50);
});

test('T81 miner never falls through its own floor on continuous dirt', () => {
  const sim = mkSim({ size: { w: 320, h: 300 }, terrain: [rect(0, 40, 320, 260)] });
  const m = sim.spawnAt(20, 40, 1); give(sim, m, 'miner');
  for (let i = 0; i < 24 * 60; i++) { sim.step(); assert.equal(m.state, S.MINING, 'tick ' + i); if (m.x > 300) break; }
});

test('T82 miner reaching steel underfoot turns and walks', () => {
  const sim = mkSim({ addTerrain: [rect(0, 140, 320, 20, 'steel')] });
  const m = sim.spawnAt(100, 120, 1); give(sim, m, 'miner');
  stepUntil(sim, () => m.state !== S.MINING, 2000);
  assert.equal(m.state, S.WALKING); assert.equal(m.dir, -1); assert.equal(sim.T.get(m.x, 140), STEEL);
});

test('T83 miner assignment fails with steel underfoot', () => {
  const sim = mkSim({ addTerrain: [rect(90, 120, 20, 2, 'steel')] });
  const m = sim.spawnAt(100, 120, 1); const n = sim.skills.miner;
  assert.equal(give(sim, m, 'miner'), null); assert.equal(sim.skills.miner, n);
});

test('T84 miner breaking out of the bottom of a slab falls', () => {
  const sim = mkSim({ terrain: [rect(80, 100, 200, 12), rect(0, 150, 320, 10)] });
  const m = sim.spawnAt(100, 100, 1); give(sim, m, 'miner');
  stepUntil(sim, () => m.state === S.FALLING, 2000); assert.ok(m.y >= 108);
});

// ---------------- Digger ----------------
test('T90 digger goes down 1 px per 8 ticks with a 9 px shaft', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 120, 1); give(sim, m, 'digger');
  sim.step(1); const y0 = m.y; sim.step(80); assert.equal(m.y - y0, 10);
  for (let y = 121; y < 129; y++) {
    for (let x = 96; x <= 104; x++) assert.equal(sim.T.get(x, y), EMPTY);
    assert.equal(sim.T.get(95, y), DIRT); assert.equal(sim.T.get(105, y), DIRT);
  }
});

test('T91 digger breaking into empty space falls, with normal fall damage', () => {
  const sim = mkSim({ terrain: [rect(0, 30, 320, 8), rect(0, 150, 320, 10)] });
  const m = sim.spawnAt(100, 30, 1); give(sim, m, 'digger');
  stepUntil(sim, () => m.state === S.FALLING, 400);
  stepUntil(sim, () => m.removed, 400); assert.equal(m.fate, 'splat');
});

test('T92 digger reaching steel stops and walks', () => {
  const sim = mkSim({ addTerrain: [rect(0, 130, 320, 30, 'steel')] });
  const m = sim.spawnAt(100, 120, 1); give(sim, m, 'digger');
  stepUntil(sim, () => m.state !== S.DIGGING, 400);
  assert.equal(m.state, S.WALKING); assert.equal(m.y, 130); assert.equal(m.dir, 1);
});

test('T93 digger ignores one-way walls', () => {
  const sim = mkSim({ terrain: [rect(0, 120, 320, 10, 'oneway_l'), rect(0, 140, 320, 20)] });
  const m = sim.spawnAt(100, 120, 1); give(sim, m, 'digger');
  stepUntil(sim, () => m.state === S.FALLING, 400);
  stepUntil(sim, () => m.state === S.DIGGING || m.state === S.WALKING, 100);
});

// ---------------- Assignment rules ----------------
test('T100 jobs cannot be given to a FALLING marcher', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 40, 1, S.FALLING);
  for (const r of ['builder', 'basher', 'miner', 'digger', 'blocker']) assert.equal(give(sim, m, r), null, r);
  assert.ok(give(sim, m, 'floater')); assert.ok(give(sim, m, 'climber')); assert.ok(give(sim, m, 'bomber'));
});

test('T101 overlap BUILDING + WALKING: blocker goes to the builder, or to the walker with the modifier', () => {
  for (const free of [false, true]) {
    const sim = mkSim({ total: 2 });
    const b = sim.spawnAt(150, 120, 1); give(sim, b, 'builder');
    const w = sim.spawnAt(150, 120, 1); w.state = S.WALKING;
    const got = sim.assignAt(150, 116, 'blocker', free);
    assert.equal(got, free ? w : b);
  }
});

test('T102 overlap BLOCKING + WALKING: builder falls back to the walker', () => {
  const sim = mkSim({ total: 2 });
  const b = sim.spawnAt(150, 120, 1); give(sim, b, 'blocker');
  const w = sim.spawnAt(150, 120, 1);
  assert.equal(sim.assignAt(150, 116, 'builder'), w); assert.equal(b.state, S.BLOCKING);
});

test('T103 failed assignments never spend inventory', () => {
  const sim = mkSim(); const before = { ...sim.skills };
  assert.equal(sim.assignAt(10, 10, 'digger'), null);
  const m = sim.spawnAt(100, 40, 1, S.FALLING);
  give(sim, m, 'digger'); give(sim, m, 'basher');
  assert.deepEqual(sim.skills, before);
  const s2 = mkSim({ skills: { digger: 0 } }); const w = s2.spawnAt(100, 120, 1);
  assert.equal(give(s2, w, 'digger'), null); assert.equal(s2.skills.digger, 0);
});

test('T104 an assignment queued while paused applies on the next tick', () => {
  const sim = mkSim(); const m = sim.spawnAt(100, 120, 1); sim.step(5);
  sim.input([{ tick: sim.tick, x: m.x, y: m.y - 4, skill: 'builder' }]);
  assert.equal(m.state, S.WALKING); assert.equal(sim.skills.builder, 9);
  sim.step(1); assert.equal(m.state, S.BUILDING); assert.equal(sim.skills.builder, 8);
});

// ---------------- Hazards and exit ----------------
test('T110 water and fire kill; saved unchanged', () => {
  for (const type of ['water', 'fire']) {
    const sim = mkSim({ addObjects: [{ type, x: 150, y: 110, w: 30, h: 20 }] });
    const m = sim.spawnAt(140, 120, 1);
    stepUntil(sim, () => m.state === (type === 'water' ? S.DROWNING : S.BURNING), 30);
    stepUntil(sim, () => m.removed, 30); assert.equal(sim.saved, 0); assert.equal(sim.dead, 1);
  }
});

test('T111 trap kills one, spares the next during cooldown, kills again after', () => {
  const sim = mkSim({ total: 3, addObjects: [{ type: 'trap', x: 150, y: 112, w: 8, h: 10, cooldown: 20 }] });
  const a = sim.spawnAt(140, 120, 1), b = sim.spawnAt(135, 120, 1), c = sim.spawnAt(110, 120, 1);
  sim.step(60);
  assert.equal(a.fate, 'trap'); assert.equal(b.removed, false); assert.equal(c.fate, 'trap');
});

test('T112 walker entering the exit is saved after the exit duration', () => {
  const sim = mkSim({ objects: [{ type: 'hatch', x: 20, y: 60, w: 20, h: 10 }, { type: 'exit', x: 150, y: 110, w: 10, h: 12 }] });
  const m = sim.spawnAt(140, 120, 1);
  stepUntil(sim, () => m.state === S.EXITING, 30); assert.equal(sim.saved, 0);
  sim.step(7); assert.equal(sim.saved, 0); sim.step(1); assert.equal(sim.saved, 1); assert.equal(m.removed, true);
});

test('T113 a falling marcher crossing the exit mid-air is not saved', () => {
  const sim = mkSim({ objects: [{ type: 'hatch', x: 20, y: 60, w: 20, h: 10 }, { type: 'exit', x: 140, y: 70, w: 20, h: 40 }] });
  const m = sim.spawnAt(150, 65, 1, S.FALLING);
  stepUntil(sim, () => m.state === S.WALKING, 100); assert.equal(sim.saved, 0);
});

// ---------------- Nuke and end ----------------
test('T120 + T121 nuke stops releases; timers one per tick in creation order; no inventory used', () => {
  const sim = mkSim({ total: 10, rrMin: 99, skills: { bomber: 0 } });
  stepUntil(sim, () => sim.released === 4, 200);
  sim.now({ nuke: true });
  sim.step(1);
  assert.deepEqual(sim.marchers.map(m => m.bomb), [79, 0, 0, 0]);
  sim.step(1); assert.deepEqual(sim.marchers.map(m => m.bomb), [78, 79, 0, 0]);
  sim.step(2); assert.deepEqual(sim.marchers.map(m => m.bomb), [76, 77, 78, 79]);
  sim.step(100); assert.equal(sim.released, 4); assert.equal(sim.skills.bomber, 0);
  stepUntil(sim, () => sim.ended, 300); assert.equal(sim.endReason, 'nuked');
});

test('T122 level ends on all removed, on time, on nuke with nobody out; not on quota', () => {
  const s1 = mkSim({ total: 2, needed: 1, objects: [{ type: 'hatch', x: 20, y: 60, w: 20, h: 10 }, { type: 'exit', x: 150, y: 110, w: 10, h: 12 }] });
  s1.spawnAt(140, 120, 1); const w = s1.spawnAt(60, 120, -1);
  stepUntil(s1, () => s1.saved === 1, 60); s1.step(20);
  assert.equal(s1.ended, false);
  stepUntil(s1, () => s1.ended, 400); assert.equal(s1.endReason, 'done'); assert.ok(w.removed);
  const s2 = mkSim({ time: '0:02' }); s2.spawnAt(100, 120, 1, S.BLOCKING);
  stepUntil(s2, () => s2.ended, 100); assert.equal(s2.tick, 34); assert.equal(s2.endReason, 'time');
  const s3 = mkSim({ total: 5 }); s3.spawnAt(100, 120, 1); s3.now({ nuke: true });
  stepUntil(s3, () => s3.ended, 300); assert.equal(s3.endReason, 'nuked'); assert.equal(s3.released, 1);
});

test('T123 win iff saved >= needed; percent = floor(saved*100/total)', () => {
  const sim = mkSim({ total: 3, needed: 2 });
  sim.saved = 1; assert.equal(sim.won, false); assert.equal(sim.percent, 33);
  sim.saved = 2; assert.equal(sim.won, true); assert.equal(sim.percent, 66); assert.equal(sim.neededPercent, 66);
});

// ---------------- Determinism ----------------
function bigLevel() {
  return {
    format: 'marchers-level/1', id: 'det', size: { w: 1600, h: 160 }, total: 40, needed: 1, rrMin: 70, time: '9:00',
    skills: { climber: 20, floater: 20, bomber: 20, blocker: 20, builder: 20, basher: 20, miner: 20, digger: 20 },
    terrain: [rect(0, 120, 1600, 40), { op: 'poly', pts: [[300, 120], [380, 70], [460, 120]] }, rect(600, 60, 30, 60), rect(700, 100, 60, 20, 'steel'),
      { op: 'ellipse', cx: 1000, cy: 110, rx: 80, ry: 30 }, rect(1200, 80, 20, 40, 'oneway_r'), erase(1300, 120, 40, 40)],
    objects: [{ type: 'hatch', x: 60, y: 60, w: 24, h: 10 }, { type: 'exit', x: 1500, y: 110, w: 12, h: 12 }, { type: 'water', x: 1300, y: 150, w: 40, h: 10 }, { type: 'trap', x: 900, y: 112, w: 8, h: 10 }],
  };
}
function liveRun() {
  const sim = new Sim(bigLevel());
  const roles = ['climber', 'floater', 'bomber', 'blocker', 'builder', 'basher', 'miner', 'digger'];
  let k = 0, made = 0;
  for (let t = 0; t < 5000 && !sim.ended; t++) {
    if (t > 120 && t % 97 === 0 && made < 30) {
      const al = sim.alive(); if (al.length) { const m = al[(t * 7) % al.length]; sim.now({ x: m.x, y: m.y - 3, skill: roles[k++ % 8] }); made++; }
    }
    if (t === 400) sim.now({ rr: 90 });
    sim.step();
  }
  return sim;
}
const snap = (sim) => JSON.stringify([sim.tick, sim.T.hash(), sim.saved, sim.dead, sim.marchers.map(m => [m.x, m.y, m.state, m.removed])]);
test('T130 identical runs and replay from the input log', () => {
  const a = liveRun(), b = liveRun();
  assert.equal(snap(a), snap(b));
  assert.ok(a.log.filter(e => e.skill).length === 30);
  const r = new Sim(bigLevel()); r.input(a.log);
  r.step(a.tick);
  assert.equal(snap(r), snap(a));
});

test('T131 fast-forward (6 ticks per frame) equals normal speed', () => {
  const a = new Sim(bigLevel()), b = new Sim(bigLevel());
  for (let f = 0; f < 300; f++) { a.step(6); for (let i = 0; i < 6; i++) b.step(1); assert.equal(a.T.hash(), b.T.hash()); }
  assert.equal(snap(a), snap(b));
});

test('level loader: ASCII grid and validation', () => {
  const L = parseLevel({ id: 'g', total: 2, needed: 1, rrMin: 50, time: '1:00', scale: 4,
    grid: ['.H......', '........', '......X.', '########', 'SS<<>>##'] });
  assert.equal(L.w, 32); assert.equal(L.h, 20);
  assert.equal(L.terrain.get(0, 12), DIRT); assert.equal(L.terrain.get(0, 16), STEEL); assert.equal(L.terrain.get(9, 17), ONEWAY_L);
  assert.deepEqual([L.hatches[0].x, L.hatches[0].y, L.hatches[0].w], [4, 0, 4]);
  assert.throws(() => parseLevel({ id: 'bad', total: 5, needed: 6, grid: ['H.X', '###'] }));
  assert.throws(() => parseLevel({ id: 'bad', total: 5, needed: 1, grid: ['...', '###'] }));
  assert.throws(() => parseLevel({ id: 'bad', total: 5, needed: 1, rrMin: 0, grid: ['H.X', '###'] }));
});
