# Marchers — mechanics specification (v1)

A browser puzzle game. Walkers ("marchers") pour out of one or more entrance
hatches and walk blindly forward. The player cannot steer them; the player can
only give individual marchers a limited supply of jobs (roles). The goal is to
get at least a quota of marchers into the exit before time runs out.

This document is mechanics only: rules, numbers, state machines, data formats
and tests. All visuals, audio, names, level content and text are to be designed
fresh by the builder.

Tags on each rule:
- **[V]** verified from a source listed in SPEC-LOG.md.
- **[R]** a reimplementation rule inferred from sources (behaviour reconstructed,
  details filled in so it is implementable).
- **[D]** our own design default. Free to change; tests should follow the value here.

Where a [V] behaviour of the reference genre is a known quirk or glitch, the spec
says so and normally chooses a clean [D] rule instead.

---

## 1. World model

### 1.1 Units, coordinates, tick

- 1.1.1 All simulation is integer and deterministic. Unit = 1 terrain pixel ("px"). [R]
- 1.1.2 Origin is the top-left of the level; x grows right, y grows down. [R]
- 1.1.3 The simulation advances in fixed **ticks**. Normal speed = 17 ticks per second
  (one tick ≈ 58.8 ms). [V] (reference clock: 17 ticks = 1 game second; reference
  clone runs a 58 ms frame timer.)
- 1.1.4 The level clock counts down 1 game second every 17 ticks. [V]
- 1.1.5 Rendering is decoupled from simulation: the renderer may run at 60 fps and
  draw the latest state; the simulation must never depend on wall-clock time
  except to decide how many ticks to run. [D]
- 1.1.6 Level height default 160 px; width 320–3200 px (default 1600). [R] height
  matches the reference playfield height; width range is [D].
- 1.1.7 Use a seeded PRNG only if a feature needs randomness. The core rules below
  need none. Two runs with the same level and the same input log must give
  identical results (replays). [D]

### 1.2 Terrain bitmap

- 1.2.1 Terrain is a 2-D array `T[x][y]` of cell types:
  `EMPTY`, `DIRT` (destructible), `STEEL` (indestructible), `ONEWAY_L`, `ONEWAY_R`
  (destructible terrain that can only be bashed or mined by a marcher facing that
  way). [R]
- 1.2.2 `solid(x,y)` = cell is not EMPTY. Any coordinate outside the level counts as
  EMPTY, except when 1.2.3 applies. [R]
- 1.2.3 Head clipping: a vertical probe that would read above row 0 reads row 0
  instead. (This stops marchers walking "over" the top of the level.) [R]
- 1.2.4 "Remove" sets a cell to EMPTY **only if** it is DIRT, ONEWAY_L or ONEWAY_R.
  STEEL cells are never removed by any action. [D] (The reference marks steel as
  rectangular overlay regions checked at probe points, not per pixel; per-pixel
  steel is our cleaner choice.)
- 1.2.5 "Add" (builder bricks) writes DIRT **only into EMPTY cells**; it never
  overwrites existing terrain. [V]
- 1.2.6 Terrain is never affected by gravity. Floating islands stay floating. [V]

### 1.3 Marcher position convention

- 1.3.1 A marcher is a point `(x, y)` plus a facing `dir ∈ {−1, +1}`. [R]
- 1.3.2 When standing, `(x, y)` is the **top solid pixel under its feet**, i.e.
  `solid(x, y)` is true. The body occupies roughly the 10 rows above
  (`y−10 … y−1`) and about 5 px either side. [R]
- 1.3.3 Collisions with terrain are tested only at specific probe points given in
  each state below, never against a full body shape. [V]
- 1.3.4 The cursor hit box and trigger tests use the same point; see 4.2 and 1.4. [R]

### 1.4 Trigger areas (objects)

Objects are rectangles placed in the level. A marcher is "in" an object when its
point `(x, y)` lies inside the object's trigger rectangle. [R] (The reference
quantises trigger areas to a 4×4 px grid; we use exact rectangles. [D])

| Object | Effect when a marcher's point enters | Tag |
|---|---|---|
| Entrance hatch | none (spawn point only) | [V] |
| Exit | if marcher is not falling/floating: switch to EXITING | [V] |
| Water | switch to DROWNING (fatal) | [V] |
| Fire / lava | switch to BURNING (fatal) | [V] |
| Trap (single-shot) | if trap is idle: marcher removed (dies), trap becomes busy for `trap.cooldown` ticks; while busy, marchers pass unharmed | [V] |
| One-way wall | no trigger; it is a terrain type (1.2.1) | [R] |
| Steel | no trigger; it is a terrain type (1.2.1) | [R] |

- 1.4.1 Trigger checks happen once per tick, after the marcher's state handler,
  and only if the handler reports "position settled" (handlers that are mid-
  animation with no movement may skip it). Simplest compliant implementation:
  check after every handler that moved the marcher or changed its state. [R]
- 1.4.2 Default trap cooldown 20 ticks. [D]
- 1.4.3 Fatal-state marchers (DROWNING, BURNING, SPLATTING, EXPLODING, EXITING) do
  not re-trigger objects. [R]
- 1.4.4 A marcher drowning keeps drifting 1 px per tick in its facing direction
  while the cell 8 px ahead at foot level is EMPTY. [V] Cosmetic only. [D]

### 1.5 Entrance hatches and release

- 1.5.1 Hatches open at tick 35 after level start. [V]
- 1.5.2 A release countdown starts at 20 when the hatches open and is decremented
  once per tick. When it reaches 0 a marcher is released (if any remain) and the
  countdown is reset to the release interval (1.5.4). The first marcher appears
  20 ticks after opening. [V]
- 1.5.3 A released marcher spawns at the hatch's spawn point in state FALLING,
  facing right (dir = +1), with fall counter 0. [V]
- 1.5.4 Release interval in ticks = `floor((99 − RR) / 2) + 4`, where RR is the
  current release rate 1…99. So RR 99 → 4 ticks, RR 1 → 53 ticks; RR 98 and 99
  behave the same. [V]
- 1.5.5 With several hatches, releases cycle through them in round-robin order
  of their index in the level file. [D] (Reference uses a fixed per-count order
  table.)
- 1.5.6 No release happens once the nuke has been triggered. [V]
- 1.5.7 Spawn point = hatch rectangle centre-x, hatch bottom − 2. [D]

### 1.6 Level edges

- 1.6.1 A marcher whose y exceeds `levelHeight + 3` (fell out of the bottom) is
  removed as dead. [V]
- 1.6.2 A walking marcher whose x would go below 0 or above `width − 1` turns
  around instead. Builders, bashers and miners at the side edge stop and turn
  around (become WALKER with dir reversed). [V]
- 1.6.3 Top edge: if a marcher's head (y − 10) would go above row −5, it is pushed
  back down and turns around; a climber or builder in that situation stops. [V]
  [R] for the exact head offset.

---

## 2. Marcher state machine

### 2.1 States

`FALLING, WALKING, STEPPING_UP, CLIMBING, HOISTING, FLOATING, BLOCKING,
BUILDING, SHRUGGING, BASHING, MINING, DIGGING, PRE_EXPLODE, EXPLODING,
SPLATTING, DROWNING, BURNING, EXITING`. [R]

Persistent flags per marcher (not states): `isClimber`, `isFloater`,
`bombTimer` (0 = none), `fallen` (px fallen in the current fall),
`bricksLeft`, `cycleTick` (tick within the current action cycle). [R]

- 2.1.1 Every state change resets `cycleTick = 0`, `fallen = 0`,
  `bricksLeft = 0` except where noted (entering BUILDING sets `bricksLeft = 12`). [V]
- 2.1.2 Turning around flips `dir` and nothing else. [R]

### 2.2 Per-tick update order

For each tick: [V] order, [R] details
1. If paused: only apply release-rate button changes (if held); stop.
2. Advance tick counter; advance the game clock (1.1.4).
3. Hatch release step (1.5).
4. For each marcher in creation order (oldest first), skipping removed ones:
   a. If `bombTimer > 0`: decrement it. If it reached 0, enter PRE_EXPLODE
      (or EXPLODING directly if the marcher is FALLING, FLOATING or DROWNING),
      and skip the rest for this marcher this tick.
   b. Run the state handler.
   c. Run trigger checks (1.4).
5. Nuke step (7.3).
6. Update objects (trap cooldowns).
7. Check end conditions (8.1).

Marchers do not collide with each other, except via blocker fields (3.4). [V]

### 2.3 WALKING [V] unless tagged

Each tick:
1. `x += dir`. If x is now outside `[0, width−1]`: undo is not needed, just turn
   around (1.6.2) and end.
2. If `solid(x, y)` (something at foot level ahead — ground continues or a wall/step):
   - Measure `h` = how many consecutive solid cells there are going up from
     `(x, y−1)`, testing at most 7 (`y−1 … y−7`).
   - If `h ≥ 7` → it is a wall: if `isClimber` enter CLIMBING, else turn around
     (x stays where it is, i.e. inside the wall's first column). [V]
     [D] cleaner variant: also step x back by `dir` before turning so the marcher
     is never embedded. Tests use the [D] variant.
   - Else if `h ≥ 3` → step of 3–6 px: set `y −= 2`, enter STEPPING_UP. [V]
   - Else (0–2) → `y −= h` (instant step-up). [V]
3. Else (nothing at foot level): try to walk down: move y down 1 at a time, up to
   3 times, stopping as soon as `solid(x, y)`. If no ground was found after 3,
   set `y += 1` more and enter FALLING (fallen = 0). [V]
4. If `y > levelHeight + 3`, die (1.6.1).

Consequences: walking speed is 1 px per tick (17 px per game second) [V]; a
marcher walks down any drop of up to 3 px and falls from anything deeper [V];
it can mount a step of up to 6 px; 7 px or more is a wall [V].

### 2.4 STEPPING_UP [V]

Each tick: rise up to 2 px, 1 px at a time, while `solid(x, y−1)` (i.e. y −= 1
while the cell above the foot is solid, max 2). If it rose fewer than 2 px, enter
WALKING. Apply the top-edge rule 1.6.3.

### 2.5 FALLING [V]

Each tick:
1. If `isFloater` and `fallen > 16` → enter FLOATING and end.
2. Move down up to 3 px, 1 px at a time, stopping when `solid(x, y)`.
3. If it moved the full 3 px without landing → `fallen += 3`, continue falling.
4. If it landed → if `fallen > 60` enter SPLATTING (death), else enter WALKING.

Numbers: fall speed 3 px/tick [V]; a fall is fatal when the counted distance
exceeds 60 px, so a drop of 63 px or more is fatal and a drop of 60 px or less is
safe [V]; partial-tick distance on the landing tick is not counted [V]. Note: the
counter only grows in whole 3 px steps, so drops of 61–62 px are safe. [R]
A marcher that starts falling from walking enters FALLING already 4 px below the
edge (3 walked down + 1). [V]

The reference lets a marcher that lands on an exit trigger survive a fatal fall
(the exit check after the landing overrides the splat). [V] Our rule: **SPLATTING
takes priority; a fatal landing on an exit is a death.** [D]

### 2.6 FLOATING (floater) [V] numbers, [R] table shape

- 2.6.1 Floating begins once a falling floater has `fallen > 16` (i.e. after
  about 6 ticks of free fall). [V]
- 2.6.2 Vertical movement per tick follows this sequence (positive = down):
  `3, 3, 3, 3, −1, 0, 1, 1` then `2` every tick forever (terminal speed
  2 px/tick). [V] (the reference uses a looping 8-entry table whose entries are all 2.)
- 2.6.3 Downward movement is applied 1 px at a time; if `solid(x, y)` before any
  step, the floater lands → WALKING (no fall damage ever). [V]
- 2.6.4 Upward movement (−1) does not test terrain. [V]
- 2.6.5 Floating marchers do not move horizontally. Falling marchers do not move
  horizontally either. [V]

### 2.7 CLIMBING [V] unless tagged

Climbing runs in an 8-tick cycle. [D] for cycle length; behaviour [V].
- Ticks 0–3 of the cycle (no movement): if the wall cell at `(x, y − 7 − cycleTick)`
  is EMPTY, the marcher has reached the top: `y = y − cycleTick + 2`, enter
  HOISTING.
- Ticks 4–7 of the cycle: `y −= 1`. Then if the head is above the top limit
  (1.6.3) **or** there is an overhang, i.e. `solid(x − dir, y − 8)`, the climber
  falls off: turn around, `x += 2·dir` (with the new dir, i.e. away from the
  wall), enter FALLING. [V]
- Net climbing speed: 4 px per 8 ticks = 0.5 px/tick. [V]

Notes: the marcher's x during climbing is the first column of the wall (it is
"inside" the wall face). [V] With the [D] variant in 2.3 (stepping back before
turning), a climber instead stays at the last free column and probes
`(x + dir, …)` for the wall. **Choose one convention and apply it in 2.3, 2.7 and
2.8 consistently.** Recommended: keep the [V] convention (marcher inside the wall
face) for climbers only, because it makes the top check simple. [D]

### 2.8 HOISTING [V]

Over the first 5 ticks rise 2 px per tick (10 px total), then wait until tick 8
of the cycle and enter WALKING (same direction). The x does not change, so on
the next walking tick the marcher steps onto the top of the wall. Apply 1.6.3.

### 2.9 SPLATTING, DROWNING, BURNING, EXITING

Timed non-interactive states. When the duration ends:
- SPLATTING: removed, dead. Duration 16 ticks. [D]
- DROWNING: removed, dead. 16 ticks. [D]
- BURNING: removed, dead. 14 ticks. [D]
- EXITING: removed, **saved count +1**. 8 ticks. [D] The save is counted when the
  state ends, not when it starts. [V]
None of these states can receive a skill, except that a bomber timer already
running keeps counting and may convert DROWNING into EXPLODING (2.2 step 4a). [V]

---

## 3. Roles (skills)

Common rules:
- 3.0.1 There are 8 roles. Two are **permanent flags** (climber, floater) that
  combine with every other job and persist until the marcher dies or exits. [V]
  One is a **timer** (bomber). Five are **jobs** that replace the current state
  (blocker, builder, basher, miner, digger). [V]
- 3.0.2 A marcher can hold both flags at once (sometimes called an "athlete"
  in the genre; give it your own name in UI). [V]
- 3.0.3 Assigning a job to a marcher already doing a job replaces that job
  immediately, subject to the validity table in 4.3. [V]
- 3.0.4 When a job ends normally, the marcher becomes WALKING in its current
  direction unless the rule says "turn around". [V]

### 3.1 Climber (flag)

- On assignment: `isClimber = true`. Takes effect the next time the marcher walks
  into a wall of 7+ px (2.3). Assignable while falling/floating. [V]
- Climbers do not grab walls while falling. [V]
- See CLIMBING (2.7) and HOISTING (2.8).

### 3.2 Floater (flag)

- On assignment: `isFloater = true`. Takes effect the next time the marcher is
  FALLING with `fallen > 16`, including the current fall if it is already falling
  (it will open on its next falling tick). [V]
- A floater can never die from a fall. [V]

### 3.3 Bomber (timer)

- 3.3.1 On assignment: `bombTimer = 79` ticks (about 4.6 s; the HUD shows a
  countdown digit 5→1 above the marcher). [V]
- 3.3.2 Digit shown = `ceil(bombTimer / 16)` clamped to 1…5 (79–65 → 5, 64–49 → 4,
  48–33 → 3, 32–17 → 2, 16–1 → 1). [V] (exact bucket edges) [R]
- 3.3.3 The marcher keeps doing whatever it was doing while the timer runs
  (walking, building, falling, …). [V]
- 3.3.4 When the timer hits 0:
  - if FALLING, FLOATING or DROWNING (or BURNING): enter EXPLODING immediately; [V]
  - otherwise: enter PRE_EXPLODE: the marcher stops its job, stands still for
    16 ticks [D duration], still falling 3 px/tick if there is no ground under
    it [V], then enters EXPLODING. A blocker in PRE_EXPLODE keeps its blocker
    field until it explodes. [V]
- 3.3.5 EXPLODING lasts 1 tick: the marcher is removed (dead) and a crater is
  removed from the terrain (3.3.6). It does not kill or push other marchers. [V]
  Draw a particle burst for ~52 ticks (cosmetic). [V] count, [D] look.
- 3.3.6 Crater: remove every removable cell inside the ellipse centred on
  `(x, y − 4)` with horizontal radius 8 and vertical radius 11 (bounding box
  16 × 22 px). [R] bounding box from source; ellipse shape [D].
- 3.3.7 The reference skips the crater entirely if the marcher stands on a steel
  region or in water. [V] Our rule: crater always applies but never removes
  STEEL (1.2.4); in water, the crater still applies. [D]
- 3.3.8 Bomber cannot be assigned if `bombTimer > 0` already, or to a marcher in
  PRE_EXPLODE, EXPLODING, BURNING or SPLATTING. [V]

### 3.4 Blocker (job)

- 3.4.1 On assignment the marcher enters BLOCKING and stays on the spot forever
  (until it dies, is bombed, or the ground under it disappears). [V]
- 3.4.2 It projects a **blocker field**: a rectangle 12 px wide and 12 px tall
  centred horizontally on the blocker: x from `bx − 6` to `bx + 5`, y from
  `by − 8` to `by + 3`. [R] (reference: a 3×3 grid of 4×4 px cells around
  `(bx, by−2)`) The left third (`bx−6 … bx−3`) is a "turn left" zone, the right
  third (`bx+2 … bx+5`) is a "turn right" zone, the middle is neutral. [V]
- 3.4.3 Any other marcher whose point is in the left zone while facing right turns
  to face left; in the right zone while facing left turns to face right. The
  check runs as part of the trigger step (1.4), for every state that runs
  trigger checks — so builders, bashers and miners are turned too (they keep
  their job; their facing flips). [V] [R] for the job-keeping detail: in the
  reference, `TurnAround` only flips direction. A builder flipped mid-staircase
  continues building in the new direction. [V]
- 3.4.4 Falling marchers are also turned if they fall through the field. [R]
- 3.4.5 A blocker is not affected by its own or other fields. [V]
- 3.4.6 Each tick, if `solid(bx, by)` is false, the blocker reverts to WALKING (and
  then falls normally); its field is removed at once. [V]
- 3.4.7 A blocker cannot be assigned where its field would overlap an existing
  blocker field. [V]
- 3.4.8 A blocker can still be given bomber (3.3); its field is removed when it
  explodes. [V] Assigning any other job to a blocker is invalid. [V]
- 3.4.9 Fields are recorded with the blocker; removing a field must restore exactly
  what was there before (in our design fields are not stored in the terrain, so
  simply delete the field). [D]

### 3.5 Builder (job)

- 3.5.1 On assignment: enter BUILDING, `bricksLeft = 12`. [V]
- 3.5.2 Building runs in a 16-tick cycle per brick. [D] cycle length; events [V]:
  - Cycle tick 9: lay a brick: 6 cells in row `y − 1`, from `x` to `x + 5` when
    facing right, from `x − 5` to `x` when facing left. Only EMPTY cells are
    filled (1.2.5). [V] width; [D] mirrored left placement (the reference places
    left bricks 1 px offset, a known asymmetry).
  - Cycle tick 10: if `bricksLeft ≤ 3` (i.e. while laying the 10th, 11th and 12th
    brick), raise the "running out" warning (HUD/audio cue). [V]
  - Cycle tick 0 (start of each new cycle after the first, i.e. after each brick):
    1. `x += dir`, `y −= 1` (climb onto the brick). If x is out of bounds or
       `solid(x, y − 1)` (head bumps) → turn around, enter WALKING, end. [V]
    2. `x += dir`. If `solid(x, y − 1)` → turn around, WALKING, end. [V]
    3. `bricksLeft −= 1`. If 0 → enter SHRUGGING, end. [V]
    4. If `solid(x + 2·dir, y − 9)` (wall ahead at head height) or x at an edge →
       turn around, WALKING, end. [V]
    5. If the head is above the top limit → WALKING (no turn). [V]
- 3.5.3 Geometry: each brick advances the builder 2 px forward and 1 px up; a full
  set of 12 bricks makes a staircase rising 12 px over 24 px horizontally (slope
  1:2). [V] Bricks overlap: each is 6 px long but the step is 2 px. [V]
- 3.5.4 SHRUGGING: stands for 8 ticks [D], then WALKING in the same direction.
  A shrugging marcher can be given another builder (that is how long bridges are
  made). [V]
- 3.5.5 Builder is not assignable to a marcher already BUILDING (wait for the
  shrug). [V] Many modern clones allow it; keep the [V] rule as default. [D]
- 3.5.6 Builders cannot build through steel (steel is solid, so the head checks
  stop them). Bricks never overwrite steel. [R]
- 3.5.7 The reference only checks one cell above the head while moving 2 px per
  step, so a builder can pass through overhangs exactly 1 px wide. [V] We keep this
  (it falls out of the rules). [D]

### 3.6 Basher (job) — horizontal tunnel

- 3.6.1 Bashing runs in a 32-tick cycle made of two 16-tick strokes. Let
  `s = cycleTick mod 16`. [D] cycle length; events [V]:
  - `s ∈ 2..5`: carve. Each of these 4 ticks removes a slice of the stroke's
    tunnel shape (3.6.2) — any carving that removes the whole shape by tick 5
    is compliant. [R]
  - At `cycleTick == 5` only (the first stroke of each 32-tick cycle): look for
    more terrain: test the 4 cells `(x + 8·dir + k·dir, y − 6)` for k = 0..3. If
    none is solid → stop, WALKING. [V] So the "keep going" test happens on every
    second stroke. [V]
  - `s ∈ 11..15`: step forward 1 px per tick (5 px per stroke, 10 px per cycle). [V]
    After each step:
    - If x is out of bounds → turn around, WALKING. [V]
    - Fall check: if `solid(x, y)` is false, move down up to 3 px looking for
      ground; if none within 3 px → FALLING. [V]
    - Steel / one-way check at the probe cell `(x + 8·dir, y − 8)`: if it is
      STEEL, or ONEWAY_L while facing right, or ONEWAY_R while facing left →
      turn around, WALKING. [V] (play a "clank" cue on steel) [V]
- 3.6.2 Tunnel shape per stroke (relative to x, mirrored by dir): columns
  `x … x + 8·dir`, rows `y − 9 … y − 1` (9 rows high, floor row y kept). [R] height
  from the reference's 10-row mask; exact shape [D]. Includes the marcher's own
  column. [V]
- 3.6.3 Assignment check (4.3): fails (no skill spent) if the cell at
  `(x + 8·dir, y − 8)` is STEEL or a one-way wall facing the other way. [V]
  Assigning a basher where there is nothing to bash is allowed: the marcher
  carves air once and stops at tick 5. [V]
- 3.6.4 Because the steel probe is 8 px ahead at head height, a basher can stop
  with a thin sliver of dirt left between it and steel. [V]

### 3.7 Miner (job) — diagonal tunnel downwards

- 3.7.1 Mining runs in a 24-tick cycle. [D] cycle length; per-cycle movement [V]:
  - Cycle tick 1: carve the first half of the stroke shape. [V]
  - Cycle tick 2: carve the second half (shifted 1 px forward and 1 px down). [V]
  - Cycle tick 3: `x += dir`, check bounds; `x += dir`, check bounds; `y += 1`. [V]
  - Cycle tick 15: `x += dir`, check bounds; `x += dir`, check bounds. [V]
  - Cycle tick 0 (of the next cycle): `y += 1`. [V]
  - After each move on ticks 3 and 15: if `solid(x, y)` is false → FALLING. [V]
    Then if the cell `(x, y)` is STEEL, or a one-way wall facing the other way →
    turn around, WALKING. [V]
  - Bounds failure (x outside level) → turn around, WALKING. [V]
- 3.7.2 Net movement: 4 px forward and 2 px down per cycle (slope 1:2 downward). [V]
- 3.7.3 Stroke shape [D]: remove removable cells at column offsets `d = −1 … 7`
  (in facing direction, `d = −1` is one column behind — the reference mask
  reaches 1 px behind [V]) and rows from `y − 10` down to `y + floor(d/2) − 1`.
  The floor left behind is a 1:2 slope exactly matching the miner's path so it
  never falls through its own tunnel.
- 3.7.4 Assignment fails if the cell 8 px ahead at head height `(x + 8·dir, y − 8)`
  is STEEL, if the cell under the feet `(x, y)` is STEEL, or if a one-way wall
  ahead faces the other way. [V]
- 3.7.5 Known reference quirk: a right-pointing one-way wall cannot be mined from
  either side. [V] Not reproduced. [D]
- 3.7.6 A miner continues until it falls out of its tunnel, hits steel or a wrong
  one-way wall, or leaves the level. Running out of terrain = falling. [V]

### 3.8 Digger (job) — vertical shaft

- 3.8.1 On the first tick of DIGGING: remove rows `y − 2` and `y − 1` (9 cells each,
  `x − 4 … x + 4`). [V]
- 3.8.2 Digging runs in a 16-tick cycle; on cycle ticks 0 and 8 (2 rows per cycle,
  0.125 px/tick): [V]
  1. Let `r = y`; `y += 1`. If below the level → dead (1.6.1).
  2. Remove row r, cells `x − 4 … x + 4` (9 cells). If **no** cell in that row was
     removed (all were EMPTY) → FALLING. [V]
  3. Else if the cell `(x, y)` is STEEL → WALKING (stops, no turn). [V]
- 3.8.3 The reference checks for terrain in the whole 9-cell row but for steel only
  in the single cell under the marcher, so a digger can dig past the edge of a
  steel block. [V] With per-pixel steel (1.2.4) the steel cells in the row are
  simply kept. [D]
- 3.8.4 One-way walls do not affect diggers. [V]
- 3.8.5 Assignment fails if the cell under the feet `(x, y)` is STEEL. [V]

---

## 4. Assigning roles

### 4.1 Inventory

- 4.1.1 Each level gives a count 0…99 for each of the 8 roles. [V] A count of 0
  greys out the button. [D]
- 4.1.2 A successful assignment decrements the count by 1. A failed assignment
  (invalid target, steel ahead, etc.) costs nothing. [V]
- 4.1.3 Optional [D] extension: `-1` = unlimited (for tutorials/sandbox).

### 4.2 Picking the target under the cursor

- 4.2.1 Hit box per marcher [D]: `x − 6 … x + 6`, `y − 12 … y` (13 × 13 px;
  reference box size 13 × 13 [V], placement relative to the body [D]).
- 4.2.2 Among the marchers whose hit box contains the cursor, split into
  **busy** (BLOCKING, BUILDING, SHRUGGING, BASHING, MINING, DIGGING, PRE_EXPLODE)
  and **free** (all other non-removed states). [V]
- 4.2.3 Primary candidate = the last (newest) busy marcher if any, else the last
  free one. Secondary candidate = the last free marcher. [V]
- 4.2.4 Holding the "prefer free" modifier (right mouse button / Shift on touch:
  a long-press) makes the primary candidate the free one. [V] [D] for input binding.
- 4.2.5 For builder, basher, miner and digger: if the role is invalid for the
  primary candidate, try the secondary. For the other roles only the primary is
  tried. [V] [D] simplification allowed: try every marcher under the cursor in
  priority order and assign to the first valid one.
- 4.2.6 The HUD shows the state name of the primary candidate (or a combined name
  if it has both flags) and the number of marchers under the cursor. [V] wording [D]

### 4.3 Validity table [V]

"From" lists the states in which the role may be assigned. Anything else = invalid.

| Role | Valid from | Extra failure conditions |
|---|---|---|
| Climber | any live state except BLOCKING, SPLATTING, PRE_EXPLODE/EXPLODING | already `isClimber` |
| Floater | any live state except BLOCKING, SPLATTING, PRE_EXPLODE/EXPLODING | already `isFloater` |
| Bomber | any live state except PRE_EXPLODE, EXPLODING, BURNING, SPLATTING | `bombTimer > 0` |
| Blocker | WALKING, SHRUGGING, BUILDING, BASHING, MINING, DIGGING | field would overlap another blocker field |
| Builder | WALKING, SHRUGGING, BASHING, MINING, DIGGING | head above top limit |
| Basher | WALKING, SHRUGGING, BUILDING, MINING, DIGGING | steel / wrong one-way at `(x+8·dir, y−8)` |
| Miner | WALKING, SHRUGGING, BUILDING, BASHING, DIGGING | steel ahead `(x+8·dir, y−8)` or under `(x, y)`; wrong one-way ahead |
| Digger | WALKING, SHRUGGING, BUILDING, BASHING, MINING | steel under `(x, y)` |

Notes:
- 4.3.1 EXITING, DROWNING, BURNING, SPLATTING marchers are never valid targets for
  jobs. FALLING, FLOATING, CLIMBING, HOISTING, STEPPING_UP marchers accept only the
  two flags and bomber. [V]
- 4.3.2 Jobs cannot be assigned to a marcher holding the same job (no re-assigning
  digger to a digger, etc.). [V]
- 4.3.3 Assigning a job applies on the next tick's handler with `cycleTick = 0`,
  except DIGGING which runs its first-tick rows (3.8.1). [R]
- 4.3.4 The reference blocks the DOS-era "assign while paused". We allow assigning
  while paused. [D] (Option to disable for purists.) [D]

---

## 5. Release rate, time, speed controls

- 5.1 Release rate RR is an integer. Level gives a minimum `rrMin` (1…99). The player
  can raise it to 99 and lower it back to `rrMin`, never below. [V]
- 5.2 While the "+" or "−" control is held, RR changes by 1 per tick (also while
  paused). A single tap changes it by 1. [V] per tick; [D] tap.
- 5.3 RR takes effect when the next release countdown is reset (1.5.2); it does not
  shorten a countdown already running. [V]
- 5.4 Time limit per level in whole minutes and seconds, 0:01 … 99:59 (default
  5:00). [D] range. The clock starts at tick 0 (before the hatches open). [V]
- 5.5 When the clock reaches 0:00 the level ends immediately (8.1). [V] (Some
  descriptions say the remaining marchers explode; the reference clone ends the
  level at once. We end at once.) [D]
- 5.6 Optional [D] "no time limit" level flag: clock counts up instead.
- 5.7 Pause: freezes the simulation; camera, cursor, role selection, RR buttons and
  role assignment (4.3.4) still work. [D]
- 5.8 Fast-forward: run 6 ticks per normal tick period. [D] (reference clone ≈ 6×)
  Assignments still allowed in fast-forward. [D]
- 5.9 Optional [D] "step one tick" and "rewind" (re-simulate from start with the
  recorded input log, using 1.1.7 determinism).

---

## 6. Camera and input (minimal, all [D])

- 6.1 Viewport shows a window of the level at integer zoom ≥ 2 on desktop; the
  camera scrolls horizontally (and vertically if the level is taller than the view)
  by edge-push, arrow keys, drag on a minimap, or two-finger drag.
- 6.2 Select a role by clicking its button or keys 1–8; F1/F2-style keys or −/+ for
  RR; P or Space for pause; F for fast-forward; a double-confirmed button for nuke.
- 6.3 Click/tap on a marcher = assign the selected role (4.2).
- 6.4 Input events are queued and applied at the start of the next tick, stamped
  with the tick number, so replays reproduce them exactly.

---

## 7. Counters and nuke

### 7.1 Counters [V]

- `total` — marchers the level will release.
- `released` — released so far.
- `out` — currently alive in the level.
- `saved` — finished EXITING.
- `removed` — gone for any reason (saved or dead).

### 7.2 HUD values [V] meaning, [D] layout

OUT = `out`; IN = saved shown as a percentage `floor(saved × 100 / total)` (option:
show as a count); TIME = the clock. Show the quota as well.

### 7.3 Nuke [V]

- 7.3.1 Triggering the nuke stops further releases immediately.
- 7.3.2 From the next tick on, once per tick, the nuke gives `bombTimer = 79` to the
  next marcher in creation order that is not removed and not already timed,
  skipping SPLATTING and EXPLODING ones, until it has passed all released
  marchers. One marcher per tick, so the explosions ripple. [V]
- 7.3.3 Nuke does not consume bomber inventory and can only be triggered once. [V]
- 7.3.4 Marchers already EXITING keep going and count as saved if their exit
  finishes. [R] In the reference a running bomb timer is not cancelled by
  EXITING, so a timed marcher can still blow up inside the exit if the timer ends
  first. [R] Our rule: entering EXITING cancels the bomb timer (the marcher is
  always saved). [D]
- 7.3.5 Reference glitch: after a nuke, the percentage is computed against the
  number released rather than the level total. [V] Not reproduced: always use
  `total`. [D]

---

## 8. Win / lose

### 8.1 End of level [V]

The level ends at the first tick on which any of these is true:
1. the clock reached 0:00;
2. `saved ≥ total` or `removed ≥ total` (every marcher is saved or dead);
3. the nuke was triggered and `out == 0`.

Also [D]: 4. the player presses "give up" (same as 8.2 evaluation).
The level does **not** end early just because the quota is reached. [V]
After the end condition, keep simulating 40 ticks for cosmetic effects, then show
results. [D] Explosion particles may delay the end check until finished. [V]

### 8.2 Evaluation

- Quota is stored as a **count** `needed` (0 ≤ needed ≤ total). [D] (reference
  stores a count and shows it as `floor(needed × 100 / total)` %. [V])
- Win iff `saved ≥ needed`. [D] (reference compares the floored percentages, which
  can make the two disagree by rounding; comparing counts avoids that.)
- Results screen: saved %, needed %, saved/total counts, time left, roles used.
- Optional [D] scoring for leaderboards: primary = saved; tie-break 1 = fewer
  roles used; tie-break 2 = more ticks left.

---

## 9. Level format (our design) [D]

JSON, one file per level. Terrain is described as drawing operations on an empty
bitmap so levels stay small and diffable; a raw-bitmap alternative is allowed.

```json
{
  "format": "marchers-level/1",
  "id": "pack1-007",
  "title": "string written by our level designers",
  "author": "string",
  "size": { "w": 1200, "h": 160 },
  "total": 40,
  "needed": 30,
  "rrMin": 50,
  "time": "4:00",
  "skills": { "climber": 0, "floater": 2, "bomber": 1, "blocker": 3,
              "builder": 10, "basher": 2, "miner": 0, "digger": 1 },
  "theme": "any-theme-id",
  "camera": { "x": 300, "y": 0 },
  "terrain": [
    { "op": "rect",    "x": 0,   "y": 120, "w": 400, "h": 40, "mat": "dirt" },
    { "op": "poly",    "pts": [[400,160],[520,100],[640,160]], "mat": "dirt" },
    { "op": "ellipse", "cx": 800, "cy": 130, "rx": 60, "ry": 20, "mat": "dirt" },
    { "op": "rect",    "x": 700, "y": 60, "w": 16, "h": 60, "mat": "steel" },
    { "op": "rect",    "x": 900, "y": 60, "w": 30, "h": 100, "mat": "oneway_l" },
    { "op": "erase",   "shape": "rect", "x": 100, "y": 130, "w": 20, "h": 10 },
    { "op": "bitmap",  "x": 0, "y": 0, "w": 32, "h": 8, "mat": "dirt",
      "rle": "base64-run-length-1bpp" }
  ],
  "objects": [
    { "type": "hatch", "x": 80,   "y": 40,  "w": 40, "h": 20 },
    { "type": "exit",  "x": 1100, "y": 100, "w": 12, "h": 12 },
    { "type": "water", "x": 640,  "y": 150, "w": 120, "h": 10 },
    { "type": "fire",  "x": 300,  "y": 110, "w": 20, "h": 10 },
    { "type": "trap",  "x": 500,  "y": 100, "w": 8,  "h": 8, "cooldown": 20 }
  ]
}
```

Rules:
- 9.1 Terrain ops are applied in array order; later ops overwrite earlier cells
  (`erase` sets EMPTY). `mat` ∈ `dirt | steel | oneway_l | oneway_r`.
- 9.2 Polygons are filled with the even-odd rule, integer-rounded vertices,
  pixel centre sampling at (x+0.5, y+0.5).
- 9.3 Object rectangles are trigger rectangles (1.4); visuals are drawn from them
  by theme, not stored in the level.
- 9.4 Validation (loader rejects the level): `needed ≤ total`, `1 ≤ rrMin ≤ 99`,
  skill counts in 0…99 (or −1, 4.1.3), ≥1 hatch, ≥1 exit, all rects inside the
  level, `total ≤ 200` [D cap].
- 9.5 ASCII alternative for quick authoring/tests: a `"grid"` array of strings
  plus `"scale"` (px per character, default 4). Characters: `.` empty, `#` dirt,
  `S` steel, `<` one-way left, `>` one-way right, `H` hatch spawn point, `X` exit
  cell, `~` water, `^` fire, `T` trap. Objects from adjacent identical characters
  merge into one rectangle. Grid and ops may be combined (grid first).
- 9.6 Every acceptance test in section 10 is a tiny level in this format plus an
  input script `[{ "tick": n, "x": px, "y": px, "skill": "builder" }, …]` and
  a set of expectations.

---

## 10. Acceptance tests (headless)

The simulation must run headless: `sim = new Sim(level); sim.input(events);
sim.step(n); sim.state()` with no DOM. Each test lists setup, action and expected
outcome. Unless stated, levels are 320 × 160, one hatch, one marcher, ground is a
dirt slab with top at y = 120, and the marcher is placed directly (test helper
`spawnAt(x, y, dir, state)`) to avoid hatch timing.

### Timing and release
- T01 Hatch opens at tick 35; first marcher appears at tick 55 (± the handler order
  convention, fixed once and asserted exactly). [V]
- T02 RR 99: consecutive releases 4 ticks apart. RR 1: 53 ticks. RR 50: 28 ticks.
  RR 98 equals RR 99. [V]
- T03 RR cannot be set below `rrMin` or above 99. [V]
- T04 After `total` releases, no more marchers spawn. [V]
- T05 Clock: after 17 × 60 ticks a 5:00 clock reads 4:00. [V]
- T06 Two hatches alternate releases (0,1,0,1…). [D]

### Walking and terrain following
- T10 Walker on flat ground moves exactly +1 px per tick. [V]
- T11 Steps of 1 and 2 px are climbed in the same tick (y changes by 1 or 2). [V]
- T12 Steps of 3–6 px: walker goes through STEPPING_UP and ends on top. [V]
- T13 A 7 px wall turns a walker; a 6 px step does not. [V]
- T14 A 3 px drop is walked down without FALLING; a 4 px drop causes FALLING. [V]
- T15 Walker reaching x = 0 or width−1 turns around. [V]

### Falling
- T20 Falling speed 3 px/tick. [V]
- T21 Drop of 60 px from a ledge: survives. Drop of 66 px: splats. Find the exact
  threshold for a walker stepping off a ledge with this spec and assert it never
  changes (golden value). [V] logic, [R] golden.
- T22 Floater falling 150 px: survives; opens after `fallen > 16`; then descends
  2 px/tick. [V]
- T23 Marcher falling below `height + 3` is removed and counted dead. [V]
- T24 Fatal fall landing on an exit: dies (our [D] rule).

### Climber
- T30 Climber hits a 40 px wall: climbs at 0.5 px/tick, hoists, walks on top in the
  same direction. [V]
- T31 Climber under an overhang: falls, now facing away from the wall, 2 px off. [V]
- T32 Climber assigned while falling keeps the flag and climbs the next wall. [V]
- T33 Climber flag cannot be assigned twice (count unchanged). [V]

### Bomber
- T40 Bomber explodes exactly 79 ticks after assignment + PRE_EXPLODE duration when
  walking; exactly 79 ticks when falling. [V]/[D]
- T41 Crater removes dirt within the ellipse of 3.3.6 and leaves steel intact. [D]
- T42 Explosion does not kill a marcher standing 3 px away. [V]
- T43 Countdown digit shows 5 at timer 79–65 and 1 at 16–1. [V]

### Blocker
- T50 Walker approaching a blocker from either side turns around at the field edge. [V]
- T51 Blocker over a digger-removed floor: becomes walker then falls; field gone. [V]
- T52 Second blocker cannot be placed inside the first's field (count unchanged). [V]
- T53 Builder walking into a field keeps building but reverses direction. [V]
- T54 Blocker can receive bomber but not builder/basher/miner/digger. [V]

### Builder
- T60 12 bricks on flat ground: builder ends 24 px further, 12 px higher, shrugs,
  walks on. [V]
- T61 Warning cue raised exactly on bricks 10, 11, 12. [V]
- T62 Builder hitting a ceiling turns around and walks. [V]
- T63 Builder approaching a wall (`solid(x+2·dir, y−9)`) turns around before the
  12th brick. [V]
- T64 Builder assigned to a SHRUGGING marcher continues the staircase. [V]
- T65 Builder cannot be assigned to a BUILDING marcher. [V]
- T66 Bricks do not overwrite steel or existing dirt. [V]

### Basher
- T70 Basher through a 40 px dirt wall: tunnel ≥ 9 px high, exits and walks. [V]
- T71 Basher stops (no turn) when terrain ahead ends, checked only on the first
  stroke of each cycle. [V]
- T72 Basher meeting steel turns around and walks; steel cells unchanged. [V]
- T73 Basher assignment with steel at the probe cell fails (count unchanged). [V]
- T74 Basher facing right into ONEWAY_L stops/turns; facing left passes. [V]
- T75 Basher whose floor disappears falls. [V]

### Miner
- T80 Miner descends 2 px per 4 px forward. [V]
- T81 Miner never falls through its own floor on continuous dirt. [D] shape.
- T82 Miner reaching steel underfoot turns around and walks. [V]
- T83 Miner assignment fails if steel is underfoot. [V]
- T84 Miner breaking out of the bottom of a slab falls. [V]

### Digger
- T90 Digger goes down 1 px per 8 ticks; shaft 9 px wide. [V]
- T91 Digger reaching EMPTY below falls (with normal fall damage). [V]
- T92 Digger reaching steel stops and walks. [V]
- T93 Digger ignores one-way walls. [V]

### Assignment rules
- T100 Builder/basher/miner/digger/blocker cannot be assigned to FALLING. [V]
- T101 Two overlapping marchers, one BUILDING, one WALKING: blocker goes to the
  builder by default, to the walker with the modifier held. [V]
- T102 Overlapping BLOCKING + WALKING, select builder: builder goes to the walker
  (fallback to secondary). [V]
- T103 Failed assignment never decrements inventory. [V]
- T104 Assignment works while paused and is applied on the next tick. [D]

### Hazards and exit
- T110 Walker entering water/fire dies; saved unchanged. [V]
- T111 Trap kills the first marcher, the next one 5 ticks later survives, one after
  the cooldown dies. [V]/[D]
- T112 Walker entering exit: saved +1 after the EXITING duration. [V]
- T113 Falling marcher crossing the exit rectangle mid-air is not saved. [V]

### Nuke and end
- T120 Nuke: no more releases; timers assigned one per tick in creation order. [V]
- T121 Nuke with 0 bombers in inventory still works and leaves inventory unchanged. [V]
- T122 Level ends when all are saved/dead, when time hits 0, or when nuked and
  out = 0; not when quota is merely reached. [V]
- T123 Win iff saved ≥ needed; % shown = floor(saved·100/total). [D]

### Determinism
- T130 Run a 5,000-tick level with 30 scripted assignments twice; the terrain hash and
  every marcher's (x, y, state) are identical. Replay from the input log equals the
  live run. [D]
- T131 Fast-forward and normal speed give identical results tick for tick. [D]

---

## 11. Open points for the builder

- 11.1 Action cycle lengths (8/16/24/32 ticks) are [D]; if they change, keep the
  movement-per-cycle ratios (builder 2 px/1 px per brick, basher 10 px per cycle,
  miner 4:2 per cycle, digger 2 rows per 16 ticks, climber 4 px per 8 ticks).
- 11.2 Animation frames are purely visual. Map each state's `cycleTick` to whatever
  frame count the art uses; logic never reads art.
- 11.3 All names of roles, UI text, level titles and hints are to be written fresh.
