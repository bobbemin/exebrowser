// LibreQuake launcher for exebrowser.com.
//
// WebQuake (the engine in ./WebQuake/) normally boots on window.onload and reads
// its game data over HTTP Range requests. This file puts a start screen in front
// of it, so audio and pointer lock get the user gesture they need, and adds a
// second mode: the visitor picks their own Quake pak files, which are read into
// memory and served to the engine from there. Nothing is uploaded.
(function () {
  "use strict";

  var TRACKS = [];
  for (var t = 2; t <= 11; t++) TRACKS.push("id1/media/quake" + (t < 10 ? "0" : "") + t + ".ogg");

  // /play-events.js on the parent page treats a frame with a Module global as a
  // canvas engine and waits for a live canvas. Without it, this frame (whose
  // canvas stays hidden until Play) would be taken for a DOM game and counted
  // as booted 2.5s after load.
  window.Module = window.Module || { exebrowserEngine: "webquake" };

  var WQ = (window.WQ = {
    maxPixelRatio: 1.5,
    // How many pak files /apps/librequake/id1/ holds. scripts/build-librequake-data.mjs
    // fails if this drifts; without it the engine probes for one more and logs a 404.
    pakCount: 3,
    tracks: null,
    mode: null,
    onQuit: function () {
      location.reload();
    },
    onError: function (text) {
      showPanel("error");
      document.getElementById("err-text").textContent = String(text || "Unknown error");
      report("quake_error", { mode: WQ.mode, error: String(text || "").slice(0, 100) });
    },
  });

  function $(id) {
    return document.getElementById(id);
  }

  function showPanel(name) {
    $("start").hidden = name !== "start";
    $("error").hidden = name !== "error";
    $("start").parentNode.hidden = name === null;
  }

  // The parent /run/ page listens for these to record plays, the same as the
  // other native games. Silently does nothing when not framed.
  function report(event, params) {
    try {
      if (window.parent !== window) window.parent.postMessage({ source: "librequake", event: event, params: params || {} }, location.origin);
    } catch (e) {}
  }

  function boot(mode, extraArgv) {
    WQ.mode = mode;
    report("quake_start", { mode: mode });
    WQ.tracks = mode === "free" ? TRACKS : [];
    showPanel(null);
    $("progress").style.display = "block";
    document.body.classList.add("running");
    if (isTouch()) setupTouch();
    // Let the progress text paint before the engine's synchronous loads start.
    setTimeout(function () {
      var t0 = performance.now();
      try {
        Sys.Boot(extraArgv.concat(isTouch() ? ["+mlook"] : []));
      } catch (e) {
        if (String(e && e.message) !== "quit") WQ.onError(e && e.message ? e.message : e);
        return;
      }
      report("quake_boot", { mode: mode, ms: Math.round(performance.now() - t0) });
    }, 30);
  }

  // ---- Bring your own Quake ------------------------------------------------

  // A .pak is used as is; quake106.zip (or resource.1) is unpacked in the tab.
  function readPak(file) {
    return file.arrayBuffer().then(function (buf) {
      return QUnpack.findPak(buf, file.name);
    }).then(function (pak) {
      if (!pak) throw new Error(file.name + " doesn't contain Quake game data (a pak file).");
      return pak;
    });
  }

  function pakNames(buf) {
    var v = new DataView(buf);
    var ofs = v.getUint32(4, true), len = v.getUint32(8, true), names = {};
    for (var i = 0; i < len / 64; i++) {
      var bytes = new Uint8Array(buf, ofs + i * 64, 56), s = "";
      for (var j = 0; j < 56 && bytes[j]; j++) s += String.fromCharCode(bytes[j]);
      names[s.toLowerCase()] = true;
    }
    return names;
  }

  function onOwnFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var msg = $("own-msg");
    msg.textContent = "";
    if (!files.length) return;
    var paks = files.filter(function (f) {
      return /\.(pak|zip|1)$/i.test(f.name);
    });
    if (!paks.length) {
      msg.textContent = "Choose quake106.zip, or the .pak files from your Quake id1 folder (pak0.pak, and pak1.pak if you own the full game).";
      return;
    }
    msg.textContent = (paks.some(function (f) { return !/\.pak$/i.test(f.name); }) ? "Unpacking " : "Reading ") +
      paks.map(function (f) { return f.name; }).join(", ") + "…";
    Promise.all(paks.map(readPak)).then(function (bufs) {
      // Order: pak0 first, then pak1; anything else after, by name.
      var entries = paks.map(function (f, i) {
        return { name: f.name.toLowerCase(), buf: bufs[i] };
      });
      entries.sort(function (a, b) {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      var base = entries.filter(function (e) {
        var n = pakNames(e.buf);
        return n["gfx.wad"] && n["progs.dat"];
      });
      if (!base.length) {
        msg.textContent = "That isn't the base game data. pak0.pak from the id1 folder is the one that's needed.";
        return;
      }
      COM.vfsOnly.byo = true;
      entries.forEach(function (e, i) {
        COM.vfs["byo/pak" + i + ".pak"] = e.buf;
      });
      report("quake_own_files", { count: entries.length, bytes: bufs.reduce(function (s, b) { return s + b.byteLength; }, 0) });
      boot("own", ["-basedir", "byo"]);
    }).catch(function (e) {
      msg.textContent = e && e.message ? e.message : String(e);
    });
  }

  // ---- Touch controls ------------------------------------------------------

  function isTouch() {
    return window.matchMedia && matchMedia("(pointer: coarse)").matches;
  }

  var touchReady = false;
  function setupTouch() {
    if (touchReady) return;
    touchReady = true;
    var pad = $("touch");
    pad.hidden = false;

    function cmd(s) {
      try { Cmd.ExecuteString(s); } catch (e) {}
    }

    // Left half: a floating stick for movement. Right half: drag to look.
    var stick = null, look = null, held = {};
    function setMove(dir, on) {
      if (!!held[dir] === on) return;
      held[dir] = on;
      cmd((on ? "+" : "-") + dir);
    }
    function moveFrom(dx, dy) {
      var dead = 14;
      setMove("forward", dy < -dead);
      setMove("back", dy > dead);
      setMove("moveleft", dx < -dead);
      setMove("moveright", dx > dead);
    }
    var zone = $("touch-zone");
    zone.addEventListener("touchstart", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var tch = e.changedTouches[i];
        if (tch.clientX < innerWidth / 2 && !stick) stick = { id: tch.identifier, x: tch.clientX, y: tch.clientY };
        else if (!look) look = { id: tch.identifier, x: tch.clientX, y: tch.clientY };
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener("touchmove", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var tch = e.changedTouches[i];
        if (stick && tch.identifier === stick.id) moveFrom(tch.clientX - stick.x, tch.clientY - stick.y);
        else if (look && tch.identifier === look.id) {
          IN.mouse_x += (tch.clientX - look.x) * 2.2;
          IN.mouse_y += (tch.clientY - look.y) * 2.2;
          look.x = tch.clientX;
          look.y = tch.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    function end(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var tch = e.changedTouches[i];
        if (stick && tch.identifier === stick.id) {
          stick = null;
          moveFrom(0, 0);
        } else if (look && tch.identifier === look.id) look = null;
      }
    }
    zone.addEventListener("touchend", end);
    zone.addEventListener("touchcancel", end);

    Array.prototype.forEach.call(pad.querySelectorAll("[data-hold]"), function (b) {
      var c = b.getAttribute("data-hold");
      b.addEventListener("touchstart", function (e) { cmd("+" + c); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      b.addEventListener("touchend", function (e) { cmd("-" + c); e.preventDefault(); e.stopPropagation(); }, { passive: false });
    });
    Array.prototype.forEach.call(pad.querySelectorAll("[data-key]"), function (b) {
      var k = b.getAttribute("data-key");
      b.addEventListener("touchstart", function (e) {
        var code = k === "escape" ? Key.k.escape : k === "enter" ? Key.k.enter : k === "up" ? Key.k.uparrow : k === "down" ? Key.k.downarrow : null;
        if (code != null) { Key.Event(code, true); Key.Event(code); }
        else cmd(k);
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    });
  }

  // ---- Wire up --------------------------------------------------------------

  $("play-free").addEventListener("click", function () {
    boot("free", []);
  });
  $("own-input").addEventListener("change", function (e) {
    onOwnFiles(e.target.files);
  });
  // Drag and drop the pak files anywhere on the start screen.
  var startEl = $("start");
  startEl.addEventListener("dragover", function (e) { e.preventDefault(); startEl.classList.add("drop"); });
  startEl.addEventListener("dragleave", function () { startEl.classList.remove("drop"); });
  startEl.addEventListener("drop", function (e) {
    e.preventDefault();
    startEl.classList.remove("drop");
    onOwnFiles(e.dataTransfer && e.dataTransfer.files);
  });
  $("err-reload").addEventListener("click", function () {
    location.reload();
  });
  if (isTouch()) document.body.classList.add("touch");
  // ?autostart=1 boots the free game without the start screen (used by tests).
  if (/[?&]autostart=1/.test(location.search)) boot("free", []);
})();
