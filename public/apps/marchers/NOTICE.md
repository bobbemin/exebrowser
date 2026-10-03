# Marchers: notice and provenance

Marchers is an original browser puzzle game: a crowd of small walkers leaves a hatch and marches blindly on, and the player hands out a limited set of jobs to get enough of them home.

## Provenance

- Marchers is an original **clean-room** work. It was written from a mechanics-only specification, `cleanroom/marchers/SPEC.md` in the source repository, which describes rules, numbers, state machines, a level format and acceptance tests. The builder worked only from that document, this repository's own earlier code conventions, and their own design decisions. Where the specification left room for interpretation, or where the builder chose differently, the choice is written down in `DESIGN-NOTES.md`.
- **No code** from any other game, clone, reimplementation or decompilation was read or used.
- **No art** from any other game was used, traced or extracted. All graphics (the marchers, terrain textures, hatches, doorways, water, fire, traps, backdrops, toolbar icons) are drawn procedurally at run time by the Canvas 2D code in `js/art.js` and `js/render.js`. The game ships no image files.
- **No sound** from any other game was used. All audio is synthesised at run time with the WebAudio API in `js/audio.js`. The game ships no audio files.
- **No text or levels** from any other game were used. The 20 level layouts, their titles and hints, the job names (Scaler, Glider, Fuse, Stopper, Mason, Borer, Delver, Driller) and all interface wording were written for Marchers.
- There are **no third-party assets or libraries**. The game makes no network requests beyond loading its own files.

## Licence

MIT. See `LICENSE`.
