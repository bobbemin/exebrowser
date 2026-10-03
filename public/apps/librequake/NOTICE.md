# LibreQuake on exebrowser.com: notice and provenance

This directory runs **LibreQuake**, a free and open-source game for the Quake engine,
in the **WebQuake** engine (a JavaScript/WebGL port of the Quake engine).

Nothing from id Software's commercial or shareware Quake data is included here.
The "own files" mode reads Quake files the visitor already has, inside their own
browser tab; those files are never uploaded or stored by this site.

## Engine: WebQuake (GPL-2.0-or-later)

- Source: https://github.com/Triang3l/WebQuake, commit `917617ffdfe42fa9dca41bf1762f16a2e71f2d7b` (2019-04-21).
- The JavaScript in `WebQuake/` is that source, with these changes made for this site:
  - `Sys.js`: boots when the start screen asks it to (`Sys.Boot`) instead of on page load.
    No `alert()` and no "are you sure" prompt on leaving. Quit and fatal errors return to the start screen.
  - `M.js`: no `confirm()` dialogs. Deleting a save takes two presses of the key.
  - `COM.js`: game data can be served from memory (the visitor's own files).
    It also stops probing for paks past the number that exist.
  - `CDAudio.js`: the page supplies the music track list instead of probing 99 URLs.
  - `S.js`: bounds checks in the WAV chunk parser (LibreQuake's sounds carry metadata chunks the original parser over-read).
    Media `play()` rejections are caught (`Q.play` in `Q.js`).
  - `SCR.js`: render resolution capped at 1.5× device pixels, for speed on phones.
- `COPYING.md` is the GPL text shipped with WebQuake.
- The page shell (`index.html`, `style.css`, `launcher.js`) and `unpack.js` (the zip/LHA reader for the 1996 shareware download) were written for exebrowser.com.
  They are released under the same GPL-2.0-or-later licence.

## Game data: LibreQuake v0.09-beta

- Source: https://github.com/lavenderdotpet/LibreQuake, release `v0.09-beta`, asset `lite.zip`.
  The sha256 is `428e736b2f01d953e09a08c60bee975bdc4a0ac2219e97fa095c8af41754da83`.
- Built by `scripts/build-librequake-data.mjs` in the site repository:
  - The two release paks are re-split, unmodified and in order, into `id1/pak0.pak`–`pak2.pak`, to fit the hosting file-size limit.
  - The music `trackNN.ogg` files are renamed `id1/media/quakeNN.ogg`.
  - The release's loose `.cfg` files are copied as they are.
- Licences (see `licenses/`):
  - Maps, models, textures, sounds and music: **BSD 3-Clause**, Copyright © 2019-2023 Contributors to the LibreQuake project (`LibreQuake-BSD-3-Clause.txt`).
  - Game code `progs.dat` and `gfx/pop.lmp`: **GPL-2.0**, Copyright © 1996-1997 Id Software, Inc. and LibreQuake contributors (`LibreQuake-progs-GPL-2.txt`).
    The game code's source is `qcsrc/` in the LibreQuake repository at the same tag.
  - Contributors are listed in `LibreQuake-CREDITS.txt`.

## Trademarks

Quake is a trademark of id Software / ZeniMax Media. LibreQuake and this site are not affiliated with, or endorsed by, either.
"Quake" is used only to say which engine the game runs on and which files the "own files" mode accepts.
