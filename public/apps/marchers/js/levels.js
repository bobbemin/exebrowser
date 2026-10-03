// Marchers — the level pack. Every level is a plain object in the "marchers-level/1" format
// (SPEC section 9): terrain drawing ops applied in order, plus trigger-rectangle objects.
// All layouts, titles and hints are original to this game.
const R = (x, y, w, h, mat) => (mat ? { op: 'rect', x, y, w, h, mat } : { op: 'rect', x, y, w, h, mat: 'dirt' });
const E = (x, y, w, h) => ({ op: 'erase', shape: 'rect', x, y, w, h });
const P = (pts, mat) => ({ op: 'poly', pts, mat: mat || 'dirt' });
const O = (cx, cy, rx, ry, mat) => ({ op: 'ellipse', cx, cy, rx, ry, mat: mat || 'dirt' });
const hatch = (x, y) => ({ type: 'hatch', x, y, w: 28, h: 14 });
// an exit doorway standing on ground whose top row is `ground`
const exit = (x, ground) => ({ type: 'exit', x, y: ground - 12, w: 14, h: 14 });
const water = (x, y, w, h) => ({ type: 'water', x, y, w, h });
const fire = (x, y, w, h) => ({ type: 'fire', x, y, w, h });
const trap = (x, ground, cooldown = 20) => ({ type: 'trap', x, y: ground - 5, w: 8, h: 6, cooldown });
const skills = (o) => ({ climber: 0, floater: 0, bomber: 0, blocker: 0, builder: 0, basher: 0, miner: 0, digger: 0, ...o });
const level = (n, o) => ({ format: 'marchers-level/1', id: 'L' + String(n).padStart(2, '0'), author: 'exebrowser.com', ...o, skills: skills(o.skills) });

export const LEVELS = [
  level(1, {
    title: 'Straight Down', theme: 'loam', size: { w: 640, h: 160 }, total: 10, needed: 6, rrMin: 50, time: '3:00',
    hint: 'The way home is under your feet. Pick the Driller, then tap a marcher on the shelf.',
    terrain: [R(40, 60, 560, 14), R(40, 26, 8, 34), R(592, 26, 8, 34), R(0, 118, 640, 42), O(160, 60, 60, 4), O(470, 60, 50, 3)],
    objects: [hatch(90, 36), exit(470, 118)],
    skills: { digger: 2 },
  }),
  level(2, {
    title: 'Glide Path', theme: 'loam', size: { w: 640, h: 160 }, total: 10, needed: 8, rrMin: 40, time: '3:00',
    hint: 'That cliff is far too tall to survive. Gliders open a canopy and drift down safely.',
    terrain: [R(0, 30, 200, 130), P([[200, 30], [214, 44], [200, 60]]), R(200, 150, 440, 10), O(330, 158, 80, 14), O(600, 160, 40, 16)],
    objects: [hatch(40, 6), exit(520, 150)],
    skills: { floater: 10 },
  }),
  level(3, {
    title: 'First Stair', theme: 'loam', size: { w: 800, h: 160 }, total: 12, needed: 10, rrMin: 50, time: '3:00',
    hint: 'A ledge too tall to step onto. A Mason lays twelve bricks into a staircase.',
    terrain: [R(0, 120, 800, 40), R(600, 108, 200, 12), O(700, 110, 60, 5)],
    objects: [hatch(80, 96), exit(720, 108)],
    skills: { builder: 3 },
  }),
  level(4, {
    title: 'Through the Ridge', theme: 'loam', size: { w: 800, h: 160 }, total: 12, needed: 10, rrMin: 50, time: '4:00',
    hint: 'No way over. A Borer punches a level tunnel straight through soft rock.',
    terrain: [R(0, 120, 800, 40), R(320, 50, 160, 70), O(400, 50, 80, 22), P([[300, 120], [320, 90], [320, 120]])],
    objects: [hatch(100, 96), exit(650, 120)],
    skills: { basher: 2 },
  }),
  level(5, {
    title: 'Sheer Face', theme: 'quartz', size: { w: 640, h: 160 }, total: 10, needed: 8, rrMin: 30, time: '4:00',
    hint: 'Scalers grip any wall they walk into and haul themselves over the top.',
    terrain: [R(0, 120, 640, 40), R(360, 70, 280, 50), O(500, 70, 140, 10)],
    objects: [hatch(80, 96), exit(560, 70)],
    skills: { climber: 10 },
  }),
  level(6, {
    title: 'Hold the Line', theme: 'quartz', size: { w: 640, h: 160 }, total: 12, needed: 10, rrMin: 50, time: '4:00',
    hint: 'Plant a Stopper before the drop so the crowd turns back, then drill to the cellar.',
    terrain: [R(0, 70, 420, 16), R(0, 128, 420, 32), R(410, 86, 10, 42), R(0, 0, 8, 70)],
    objects: [hatch(60, 46), exit(40, 128), water(420, 140, 220, 20)],
    skills: { blocker: 2, digger: 2 },
  }),
  level(7, {
    title: 'On the Slant', theme: 'quartz', size: { w: 640, h: 160 }, total: 12, needed: 10, rrMin: 50, time: '4:00',
    hint: 'Delvers cut a sloping tunnel downward. The cavern is somewhere below and to the right.',
    terrain: [R(0, 70, 640, 90), E(300, 110, 300, 30), { op: 'erase', shape: 'ellipse', cx: 450, cy: 112, rx: 150, ry: 10 }],
    objects: [hatch(60, 46), exit(520, 140)],
    skills: { miner: 2 },
  }),
  level(8, {
    title: 'Short Fuse', theme: 'quartz', size: { w: 640, h: 160 }, total: 10, needed: 8, rrMin: 50, time: '4:00',
    hint: 'A Fuse ticks down five beats and then blows a hole. Time it so the blast meets the thin wall.',
    terrain: [R(0, 120, 640, 40), R(60, 50, 10, 70), R(300, 50, 6, 70), R(60, 44, 246, 6)],
    objects: [hatch(150, 96), exit(520, 120)],
    skills: { bomber: 3 },
  }),
  level(9, {
    title: 'Long Span', theme: 'frost', size: { w: 800, h: 160 }, total: 15, needed: 12, rrMin: 50, time: '5:00',
    hint: 'One staircase will not reach. A Mason who shrugs can be handed another load of bricks.',
    terrain: [R(0, 120, 300, 40), R(372, 120, 428, 40), O(150, 120, 90, 4), O(560, 121, 120, 5)],
    objects: [hatch(60, 96), exit(700, 120), water(300, 140, 72, 20)],
    skills: { builder: 4, blocker: 1, bomber: 1 },
  }),
  level(10, {
    title: 'Over the Top', theme: 'frost', size: { w: 720, h: 160 }, total: 10, needed: 8, rrMin: 20, time: '5:00',
    hint: 'Up one side, down the other. Anyone who gets over will need a way to land softly.',
    terrain: [R(0, 120, 720, 40), R(300, 30, 30, 90), O(315, 31, 14, 4)],
    objects: [hatch(80, 96), exit(600, 120)],
    skills: { climber: 10, floater: 10 },
  }),
  level(11, {
    title: 'Arrow Rock', theme: 'frost', size: { w: 800, h: 160 }, total: 12, needed: 10, rrMin: 50, time: '4:00',
    hint: 'Arrowed rock only gives way to a marcher heading the way the arrows point.',
    terrain: [R(0, 120, 800, 40), R(200, 40, 40, 80, 'oneway_l'), R(560, 40, 40, 80, 'oneway_l'), R(0, 104, 150, 16), O(75, 104, 60, 4)],
    objects: [hatch(380, 96), exit(40, 104)],
    skills: { basher: 2, builder: 2 },
  }),
  level(12, {
    title: 'Iron Spine', theme: 'ember', size: { w: 800, h: 160 }, total: 15, needed: 12, rrMin: 50, time: '5:00',
    hint: 'There is a plate of iron low in that hill. Tunnel above it.',
    terrain: [R(0, 120, 800, 40), R(300, 40, 200, 80), O(400, 40, 100, 16), R(360, 100, 80, 20, 'steel')],
    objects: [hatch(80, 96), exit(650, 120)],
    skills: { builder: 3, basher: 2 },
  }),
  level(13, {
    title: 'Embers', theme: 'ember', size: { w: 900, h: 160 }, total: 15, needed: 12, rrMin: 50, time: '5:00',
    hint: 'Two burning pits. Hold the crowd back while the bridges go up, then clear the way.',
    terrain: [R(0, 120, 900, 40), E(250, 120, 20, 10), E(470, 120, 20, 10)],
    objects: [hatch(60, 96), exit(780, 120), fire(250, 122, 20, 9), fire(470, 122, 20, 9)],
    skills: { builder: 3, blocker: 1, bomber: 1 },
  }),
  level(14, {
    title: 'Snap Alley', theme: 'ember', size: { w: 900, h: 160 }, total: 16, needed: 12, rrMin: 50, time: '5:00',
    hint: 'Snapjaws bite the first one through. Go over the first, under the second.',
    terrain: [R(0, 120, 900, 40), R(500, 80, 200, 28), E(500, 135, 400, 15)],
    objects: [hatch(60, 96), exit(820, 150), trap(300, 120), trap(600, 120)],
    skills: { builder: 3, blocker: 1, digger: 1 },
  }),
  level(15, {
    title: 'Twin Gates', theme: 'loam', size: { w: 900, h: 160 }, total: 20, needed: 16, rrMin: 50, time: '5:00',
    hint: 'Two hatches, one door on the mesa. Stairs from both sides, and mind the pond.',
    terrain: [R(0, 120, 800, 40), R(380, 96, 80, 24), O(420, 96, 40, 6), R(800, 150, 100, 10)],
    objects: [hatch(80, 96), hatch(660, 96), exit(414, 96), water(800, 128, 100, 32)],
    skills: { builder: 5, blocker: 1 },
  }),
  level(16, {
    title: 'Hanging Gardens', theme: 'loam', size: { w: 960, h: 160 }, total: 10, needed: 7, rrMin: 50, time: '5:00',
    hint: 'Bridge the first gap, then everyone needs a canopy for the long drop.',
    terrain: [R(0, 50, 220, 16), O(110, 66, 100, 14), R(268, 60, 200, 16), O(368, 76, 90, 12), R(440, 150, 520, 10)],
    objects: [hatch(60, 26), exit(860, 150)],
    skills: { builder: 3, blocker: 1, bomber: 1, floater: 10 },
  }),
  level(17, {
    title: 'Deep Seam', theme: 'quartz', size: { w: 900, h: 160 }, total: 14, needed: 11, rrMin: 50, time: '5:00',
    hint: 'Iron above and iron below. Only one slant gets between them.',
    terrain: [R(0, 60, 900, 100), R(0, 100, 300, 8, 'steel'), R(300, 60, 420, 6, 'steel'), E(320, 110, 500, 30), R(600, 110, 24, 30, 'oneway_r')],
    objects: [hatch(60, 36), exit(760, 140)],
    skills: { miner: 2, basher: 2, digger: 2 },
  }),
  level(18, {
    title: 'Chimney Sweep', theme: 'quartz', size: { w: 480, h: 160 }, total: 10, needed: 8, rrMin: 40, time: '5:00',
    hint: 'Stairs can zig-zag. When a Mason turns at a wall, send it back the other way.',
    terrain: [R(0, 80, 170, 80), R(220, 80, 260, 80), R(170, 130, 50, 30)],
    objects: [hatch(181, 90), exit(30, 80)],
    skills: { builder: 5 },
  }),
  level(19, {
    title: 'The Long March', theme: 'frost', size: { w: 1600, h: 160 }, total: 30, needed: 26, rrMin: 60, time: '7:00',
    hint: 'A long road: a ridge, a cellar, a mesa and a mound. One marcher can do it all.',
    terrain: [R(0, 120, 400, 40), R(300, 50, 80, 70), O(340, 50, 40, 12), R(400, 120, 300, 14), R(700, 40, 20, 94), R(400, 150, 600, 10),
      R(1000, 126, 300, 34), O(1150, 127, 120, 6), R(1300, 150, 300, 10), R(1400, 90, 60, 60), O(1430, 90, 30, 10)],
    objects: [hatch(60, 96), exit(1520, 150)],
    skills: { basher: 3, digger: 2, builder: 3, blocker: 2, climber: 2, floater: 2 },
  }),
  level(20, {
    title: 'Last Light', theme: 'ember', size: { w: 1200, h: 160 }, total: 20, needed: 16, rrMin: 50, time: '6:00',
    hint: 'Everything you have learned, in one evening. Two hatches, one door, very little to spare.',
    terrain: [R(0, 40, 260, 120), O(130, 40, 120, 5), R(260, 130, 940, 30), R(480, 60, 30, 70, 'oneway_r'), E(620, 130, 40, 30), O(900, 131, 150, 5)],
    objects: [hatch(60, 16), hatch(150, 16), exit(760, 130), water(620, 140, 40, 20)],
    skills: { miner: 2, blocker: 3, basher: 2, builder: 3, bomber: 2, floater: 2, digger: 1 },
  }),
];
