// Marchers — every shipped level is solvable: replay the recorded positional input log
// (solutions.json: tick -> click at x,y with a role, release-rate changes) through the headless
// sim and require saved >= needed. Also: no level is won by doing nothing.
// Regenerate the logs with: node cleanroom/marchers/tests/record-solutions.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Sim } from '../../../public/apps/marchers/js/sim.js';
import { parseLevel } from '../../../public/apps/marchers/js/level.js';
import { LEVELS } from '../../../public/apps/marchers/js/levels.js';

const LOGS = JSON.parse(readFileSync(new URL('./solutions.json', import.meta.url), 'utf8'));

test('the pack has 20 valid levels with unique ids and titles', () => {
  assert.equal(LEVELS.length, 20);
  assert.equal(new Set(LEVELS.map(l => l.id)).size, 20);
  assert.equal(new Set(LEVELS.map(l => l.title)).size, 20);
  for (const L of LEVELS) { const p = parseLevel(L); assert.ok(p.hatches.length && p.exits.length); assert.equal(L.format, 'marchers-level/1'); }
});

function play(L, log) {
  const sim = new Sim(L, { events: false });
  if (log) sim.input(log);
  while (!sim.ended && sim.tick < 60000) sim.step();
  return sim;
}

for (const L of LEVELS) {
  test(`${L.id} "${L.title}" is solved by its recorded input log`, () => {
    const log = LOGS[L.id];
    assert.ok(Array.isArray(log) && log.length > 0, 'missing log');
    for (const e of log) assert.ok(Number.isInteger(e.tick) && (e.skill ? Number.isInteger(e.x) && Number.isInteger(e.y) : e.rr != null || e.nuke));
    const sim = play(L, log);
    assert.ok(sim.ended);
    assert.ok(sim.saved >= sim.needed, `saved ${sim.saved} < needed ${sim.needed}`);
    // every scripted click landed on a marcher and spent a role
    const spent = Object.values(sim.used).reduce((a, b) => a + b, 0);
    assert.equal(spent, log.filter(e => e.skill).length);
    // and the replay is deterministic
    const again = play(L, log);
    assert.equal(again.T.hash(), sim.T.hash()); assert.equal(again.saved, sim.saved); assert.equal(again.tick, sim.tick);
  });
  test(`${L.id} is not won by doing nothing`, () => {
    const sim = play(L, null);
    assert.ok(sim.saved < sim.needed, `saved ${sim.saved} with no input`);
  });
}
