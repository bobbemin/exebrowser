# Warzone 2100 Web Edition — provenance

This directory is the **official Warzone 2100 Web Edition**, release **4.7.0**,
as built and published by the Warzone 2100 Project. ExeBrowser hosts it with
the small changes listed below. ExeBrowser is not affiliated with the
Warzone 2100 Project.

- Project: https://wz2100.net
- Release: https://github.com/Warzone2100/warzone2100/releases/tag/4.7.0
- Asset: `warzone2100_web_wasm32_archive.zip` (100,414,952 bytes)
  sha256 `f729df690038511e0dee662554475a9a9a7c8a9488a268d647b93e7953820ee3`
- Corresponding source: https://github.com/Warzone2100/warzone2100/tree/4.7.0

## Licence

Warzone 2100's source code, data, music and videos are released under the
**GNU General Public License, version 2 or (at your option) any later version**.
See `COPYING` (the GPL text) and `COPYING.README` (the project's licence notes,
both taken from the 4.7.0 tag). §4 of `COPYING.README` grants permission to use
the name "Warzone 2100", the logos, stories, texts and related materials.

The page also embeds code under other permissive licences, unchanged from
upstream: the CSS loading spinner (MIT, Martin van Driel), wasm-feature-detect
(Apache-2.0, Google Chrome Labs), Bootstrap 5.3.2 (MIT, loaded from cdnjs) and
Bootstrap Icons (MIT).

## How it is built

`scripts/build-warzone2100-data.mjs` (in the ExeBrowser repository) downloads
the release, checks the sha256 above, and writes this directory. The large
binaries are not in git; that script is the record of what ships.

## What was changed

**Game binaries and data: nothing.** `warzone2100.wasm`, the music and classic
terrain packages, and the bytes of `warzone2100.data` are the release's own.

1. **`warzone2100.data` is served in parts.** Cloudflare Pages refuses files over
   25 MB, so the 64.4 MB bundle is cut into consecutive 20 MiB pieces
   (`warzone2100.data.part0` … `part3`), listed with their sizes in
   `warzone2100.parts.json`.
2. **One patch to the loader glue (`warzone2100.js`).** In the file packager's
   `fetchRemotePackage`, `fetch(packageName)` became `wzFetchPackage(packageName)`.
   That helper, inserted just before it, returns a `Response` whose body is the
   parts concatenated in order (with `Content-Length` set to the total) when the
   package is `warzone2100.data`, and calls plain `fetch` for anything else.
   Progress reporting and the IndexedDB package cache are unchanged.
3. **`index.html`** (the launcher page), otherwise upstream's:
   - the workbox service worker and its registration were removed (no offline
     precache; `service-worker.js`, `workbox-*.js` and `manifest.json` are not
     shipped, and the web-app install option is hidden);
   - the Cloudflare Web Analytics beacon was removed;
   - the intro and briefing videos are not loaded: upstream streams them from
     `data.play.wz2100.net`, which is the project's bandwidth, so no
     `--videourl` is passed. The game shows "Campaign videos are missing" and
     plays on without them;
   - the wasm is requested as `warzone2100.wasm?v=4.7.0` so it can be cached
     long-term;
   - added: a "← exebrowser.com" link, a hosting/licence line under upstream's
     own credits, a `noindex` tag, and ExeBrowser's Google Analytics tag
     (`play_click` when Play Now is pressed, `boot_success` when the main menu
     is first up).
4. The pre-compressed `*.gz` copies in the release are not shipped (the host
   compresses on the fly).

## What the page still contacts

Besides this site, the page loads Bootstrap from cdnjs.cloudflare.com and the
Google Analytics tag. The game itself fetches two small JSON files from
`data.wz2100.net` at the main menu (news and compatibility notices), as it
does on the project's own site, and the Multi Player menu talks to the
project's lobby server.
