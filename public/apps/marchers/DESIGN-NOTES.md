# Marchers: design notes

Every place where the build interprets `cleanroom/marchers/SPEC.md`, fills a gap in it, or deliberately departs from it. Section numbers refer to the spec. Where a rule is not listed here, it is implemented as written, and the acceptance tests in `cleanroom/marchers/tests/acceptance.test.mjs` check it.

## Code layout

- `js/terrain.js`, `js/level.js`, `js/sim.js` are the rules. They are pure, deterministic, integer-only ES modules with no DOM access, so the Node tests import them directly.
- `js/levels.js` holds the 20 levels. `js/art.js` and `js/render.js` draw, `js/audio.js` makes sound, and `js/main.js` holds the DOM, input, loop and saved progress.
- The headless API is the one in spec 10: `new Sim(level)`, `sim.input(events)`, `sim.step(n)`, `sim.state()`, plus the test helper `sim.spawnAt(x, y, dir, state)`.

## Ticks, input and timing

- **Input stamping (6.4, 5.7).** An input stamped with tick `n` is applied at the start of the step that takes the sim from `n` to `n + 1`, before the tick counter advances and before any handler runs. The UI calls `sim.now(event)`, which applies the event at once and logs it with the current tick. That is exactly what a replay does, so live play and replays match (T130).
- **Pause** lives outside the sim: the UI simply stops calling `step()`. Release-rate changes and job assignments still go through `sim.now()` while paused (5.7, 4.3.4). A held release-rate button repeats once per tick period while paused or running (5.2).
- **Hatch timing (1.5.1, T01).** At tick 35 the hatches open and the countdown is set to 20. It counts down from tick 36, so the first marcher appears at tick 55. A newly released marcher runs its first handler in the same tick.
- **Clock (1.1.4).** The clock loses one second on every tick divisible by 17. The level ends on the tick it reaches 0:00.
- **Fast-forward (5.8)** runs 6 ticks per normal tick period. The loop catches up at most 4 periods per animation frame, so a slow device runs the game slower instead of freezing.
- **After the end (8.1).** The sim freezes on the end tick. The UI keeps particles and animations going for 40 more tick periods, then shows the results card.
- **Give up (8.1 item 4)** is in the pause menu. It ends the level and shows the same results card.

## Walking, edges and falling

- **Side edges (1.6.2, 2.3 step 1).** A walker whose next step would leave the level stays where it is and turns, so it never stands at x = −1 or x = width.
- **Walls (2.3, 2.7).** Non-climbers use the [D] variant: they step back one column and turn, so they are never inside the wall. Climbers keep the [V] convention, standing in the wall's first column, as 2.7 recommends.
- **Top edge (1.6.3)** is handled where it can happen. A walker whose step-up would put its head above row −5 undoes the step and turns. Climbers fall off by the 2.7 rule. Builders stop by 3.5.2 step 5. Hoisting is not checked: no level reaches that high.
- **Falling (2.5).** Each tick tests `solid(x, y)` before each of the three 1 px moves. Distance on the landing tick is not counted. So:
  - measured from where FALLING starts, 60–62 px is safe and 63 px or more is fatal;
  - a walker stepping off a ledge enters FALLING 4 px below the edge, so the **walk-off golden threshold is 67 px**: 66 px is survived and 67 px is fatal.
  T21 asserts both. The spec's "drop of 66 px: splats" holds for a drop measured from the start of the fall, which is how the test reads it.
- **Exits** are not triggered while FALLING or FLOATING (T113). A fatal landing on an exit is a death (T24, the [D] rule).

## Jobs

- **Bomber (3.3).** When the timer reaches 0 for a marcher that is FALLING, FLOATING, DROWNING, BURNING or SPLATTING, the crater and removal happen on that same tick. EXPLODING is never seen as a state that lasts a tick. So a falling bomber pops exactly 79 ticks after assignment, and a walking one after 79 + 16 (T40).
- **Crater (3.3.6).** The cells removed are offsets dx −8…7 and dy −11…10 around `(x, y − 4)` whose cell centres fall inside the ellipse with radii 8 and 11. That is the 16 × 22 box. Steel is never removed, and the crater applies in water too (3.3.7). The pit it leaves can be walked across, with no step over 2 px.
- **Blocker field (3.4.3).** Fields turn walkers, fallers, floaters, step-uppers, builders, bashers, miners, diggers and shruggers. They do **not** turn CLIMBING or HOISTING marchers, because flipping a climber mid-wall would break the "inside the wall face" convention. Blockers and primed ex-blockers are not turned either.
- **Builder (3.5.2).** Exactly as listed: brick on cycle tick 9, warning on tick 10 for bricks 10–12, and the move-and-check sequence on tick 0 of every cycle after the first. Left-facing bricks mirror right-facing ones ([D]). If a builder's x would leave the level, it is put back and turns.
- **Basher (3.6).** The tunnel shape is carved in four slices: columns 0–2, 3–4, 5–6 and 7–8 (times dir) on stroke ticks 2–5, rows y − 9 … y − 1. The fall check after each step works like walking: down up to 3 px, otherwise one more pixel and FALLING.
- **Miner (3.7.3).** Read literally, the shape formula (rows down to `y + floor(d/2) − 1`) carves away the cell the miner stands on at cycle tick 15, `(x + 4, y + 1)`, so it would fall through its own tunnel. The shape used instead has a bottom row of `y − 1` for d ≤ 1 and `y` for d ≥ 2, from row y − 10, with columns −1 … 3 on cycle tick 1 and 4 … 7 on tick 2. Together with the movement in 3.7.1, this leaves a clean 1:2 floor that matches the path exactly (T80, T81).
- **One-way terrain while tunnelling.** Bashers and miners never remove a one-way cell that faces the other way, even one that falls inside their carve shape without crossing the probe cell. Craters and diggers remove one-way cells normally (3.8.4).
- **Digger (3.8.1).** The first tick removes rows y − 2 and y − 1, then also runs the cycle-tick-0 dig step.
- **Drowning drift (1.4.4)** is implemented, and it is cosmetic only.

## Assignment validity (4.3)

- Climber and floater are also refused for DROWNING, BURNING, EXITING and PRE_EXPLODE marchers, not only for BLOCKING, SPLATTING and EXPLODING. Giving a role to a marcher that is already doomed or leaving does nothing useful, and this keeps the inventory safe.
- Bomber is also refused for EXITING marchers, because entering EXITING cancels the timer anyway (7.3.4).
- Picking follows 4.2.3–4.2.5 exactly. The newest busy marcher under the cursor is the primary and the newest free one is the secondary. Builder, basher, miner and digger fall back to the secondary. The "prefer free" modifier is right-click or Shift with a mouse, and a long press (450 ms) on touch.
- A level count of `-1` means unlimited (4.1.3), and the toolbar shows it as ∞. No shipped level uses it.

## Hazards, nuke and end

- **Trigger order** after each handler is water, fire, trap, exit, then blocker fields. A trap kill removes the marcher at once (counted dead), and the trap's busy timer counts down at the end of each tick (step 6).
- **Nuke (7.3).** The nuke takes effect on the tick in which its input is processed. From then on it hands out one timer per tick in creation order. It skips every dying state (SPLATTING, DROWNING, BURNING, EXITING, EXPLODING, PRE_EXPLODE) as well as marchers already timed. The button needs a second press within 2.5 s. It is a button state, never a browser dialog.
- **Percentages** always use `total` (7.3.5). Winning compares counts (8.2).

## Level format (9)

- Levels are authored in `js/levels.js` as plain objects in the `marchers-level/1` format. Small helper functions there (`R`, `E`, `P`, `O`, `hatch`, `exit`, …) emit exactly the spec's op and object records, which keeps the file short. An extra `hint` string is shown on the intro card.
- Validation follows 9.4, with the size range widened to 16–3200 × 16–400 px so the tiny ASCII test levels in 9.5 load.
- The `bitmap` op's `rle` field is base64 of byte run-lengths that alternate empty and filled, starting with empty.
- The `exit` helper makes a 14 × 14 trigger whose rows include the ground row, because a standing marcher's point is the ground cell (1.3.2).

## Levels

- There are 20 original levels. Levels 1–4 each teach one job (Driller, Glider, Mason, Borer). Levels 5–8 add Scaler, Stopper, Delver and Fuse. Levels 9–20 combine them and add one-way rock, steel, fire, water, snapping traps, two hatches, zig-zag stairs and long multi-stage routes.
- Every level is proved solvable. `cleanroom/marchers/tests/record-solutions.mjs` turns hand-written solution directives into plain positional click logs (`solutions.json`), and `solver.test.mjs` replays only those logs through the headless sim. It requires `saved ≥ needed`, checks that every click spent a job, and checks that doing nothing does **not** win.
- **Unlocking.** Passing level n opens level n + 1. Best percentages are kept in `localStorage` under `marchers.progress.v1`, and every access is wrapped in try/catch so the game still runs without storage. A `#level=N` link opens any level directly, for sharing and testing.

## Presentation

- **Names.** The jobs are Scaler, Glider, Fuse, Stopper, Mason, Borer, Delver and Driller. A marcher with both permanent flags is an "Ace". Its hood bobble changes colour to show its flags.
- **Zoom.** The playfield canvas is the view at 1 px per level pixel, scaled up by an integer factor with pixelated sampling. The factor is the largest that fits the stage height, or one more if that crops at most 14% of the level and leaves at least 160 level px of width. Taller stages centre the level vertically, and shorter ones scroll vertically.
- **Scrolling** works by drag (mouse or touch), arrow keys, mouse wheel, pushing the mouse against the left or right edge, and tapping or dragging the minimap strip.
- **Embedding.** The game never touches `window.top` or `window.parent`, so it runs inside a sandboxed iframe (checked by `browser-ui.mjs`).
