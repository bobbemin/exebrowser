// Unpacks the 1996 Quake shareware download (quake106.zip) in the browser, so a
// visitor can play the real first episode from id's own file without installing
// anything. The zip holds resource.1, an LHA archive (-lh5-), which holds
// ID1/PAK0.PAK. Nothing here touches the network; the file never leaves the tab.
//
// Exposes QUnpack.findPak(arrayBuffer, fileName) -> Promise<ArrayBuffer|null>,
// and QUnpack.lhaExtract(bytes, wantedName) for tests.
(function (root) {
  "use strict";

  // ---- ZIP (stored or deflate, via DecompressionStream) ----------------------

  function zipEntries(buf) {
    var v = new DataView(buf), u8 = new Uint8Array(buf);
    var eocd = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not a zip file.");
    var count = v.getUint16(eocd + 10, true), p = v.getUint32(eocd + 16, true), out = [];
    for (var n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Damaged zip directory.");
      var method = v.getUint16(p + 10, true);
      var csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
      var nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      var local = v.getUint32(p + 42, true);
      var name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      out.push({ name: name, method: method, csize: csize, usize: usize, local: local });
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  function zipRead(buf, e) {
    var v = new DataView(buf);
    if (v.getUint32(e.local, true) !== 0x04034b50) return Promise.reject(new Error("Damaged zip entry."));
    var start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    var data = new Uint8Array(buf, start, e.csize);
    if (e.method === 0) return Promise.resolve(data.slice().buffer);
    if (e.method !== 8) return Promise.reject(new Error("Unsupported zip compression (method " + e.method + ")."));
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser can't unzip files. Unzip it first and choose pak0.pak."));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer();
  }

  // ---- LHA (-lh5- / -lh6- / -lh7-, header levels 0 and 1) --------------------

  function crc16(u8) {
    var crc = 0;
    for (var i = 0; i < u8.length; i++) {
      crc ^= u8[i];
      for (var k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    return crc;
  }

  function lhaHeaders(u8) {
    var out = [], ascii = function (a, b) { return String.fromCharCode.apply(null, u8.subarray(a, b)); };
    // resource.1 starts with a small loader stub, so scan for the first header.
    var p = 0;
    while (p + 22 < u8.length && !(ascii(p + 2, p + 4) === "-l" && u8[p + 6] === 0x2d && u8[p] > 20)) p++;
    while (p + 22 < u8.length && u8[p] !== 0) {
      var hsize = u8[p], method = ascii(p + 2, p + 7);
      var dv = new DataView(u8.buffer, u8.byteOffset + p);
      var csize = dv.getUint32(7, true), usize = dv.getUint32(11, true), level = u8[p + 20];
      var nlen = u8[p + 21], name = ascii(p + 22, p + 22 + nlen);
      var crc = dv.getUint16(22 + nlen, true);
      var dataStart = p + 2 + hsize;
      if (level === 1) {
        // Extended headers sit between the base header and the data and are
        // counted in csize.
        var ext = dv.getUint16(hsize, true), q = dataStart;
        while (ext) {
          q += ext;
          csize -= ext;
          ext = new DataView(u8.buffer, u8.byteOffset + q - 2).getUint16(0, true);
        }
        dataStart = q;
      } else if (level !== 0) {
        throw new Error("Unsupported LHA header level " + level + ".");
      }
      out.push({ name: name.replace(/\\/g, "/"), method: method, csize: csize, usize: usize, crc: crc, data: dataStart });
      p = dataStart + csize;
    }
    return out;
  }

  function lhDecode(src, outLen, dicbit) {
    var NC = 510, NT = 19, TBIT = 5, CBIT = 9;
    var NP = dicbit + 1, PBIT = dicbit === 13 ? 4 : 5;
    var out = new Uint8Array(outLen), o = 0;
    var bitbuf = 0, bitcnt = 0, sp = 0;

    function need(n) {
      while (bitcnt < n) {
        bitbuf = ((bitbuf << 8) | (sp < src.length ? src[sp++] : 0)) >>> 0;
        bitcnt += 8;
      }
    }
    function peek(n) {
      need(n);
      return (bitbuf >>> (bitcnt - n)) & ((1 << n) - 1);
    }
    function skip(n) {
      need(n);
      bitcnt -= n;
      bitbuf &= bitcnt >= 32 ? 0xffffffff : (1 << bitcnt) - 1;
    }
    function bits(n) {
      if (n === 0) return 0;
      var v = peek(n);
      skip(n);
      return v;
    }

    // Canonical Huffman, MSB first, as LHA's make_table assigns it. The table is
    // indexed by the next 16 bits: (symbol << 5) | length.
    function table(lens, n) {
      var t = new Int32Array(1 << 16), code = 0, any = false;
      for (var len = 1; len <= 16; len++) {
        for (var s = 0; s < n; s++) {
          if (lens[s] !== len) continue;
          any = true;
          var span = 1 << (16 - len), start = code << (16 - len);
          if (start + span > 65536) throw new Error("Bad Huffman table.");
          for (var k = 0; k < span; k++) t[start + k] = (s << 5) | len;
          code++;
        }
        code <<= 1;
      }
      if (!any) throw new Error("Empty Huffman table.");
      return t;
    }
    function decode(t) {
      if (t.single != null) return t.single;
      var e = t[peek(16)];
      skip(e & 31);
      return e >>> 5;
    }
    function constant(c) {
      return { single: c };
    }

    function readPtLen(nn, nbit, special) {
      var n = bits(nbit), lens = new Uint8Array(nn), i = 0;
      if (n === 0) return constant(bits(nbit));
      while (i < n) {
        var c = bits(3);
        if (c === 7) while (bits(1) === 1) c++;
        lens[i++] = c;
        if (i === special) {
          var z = bits(2);
          while (z-- > 0) lens[i++] = 0;
        }
      }
      return table(lens, nn);
    }
    function readCLen(pt) {
      var n = bits(CBIT), lens = new Uint8Array(NC), i = 0;
      if (n === 0) return constant(bits(CBIT));
      while (i < n) {
        var c = decode(pt);
        if (c <= 2) {
          c = c === 0 ? 1 : c === 1 ? bits(4) + 3 : bits(CBIT) + 20;
          while (c-- > 0) lens[i++] = 0;
        } else lens[i++] = c - 2;
      }
      return table(lens, NC);
    }

    var block = 0, ct, pt;
    while (o < outLen) {
      if (block === 0) {
        block = bits(16);
        var tt = readPtLen(NT, TBIT, 3);
        ct = readCLen(tt);
        pt = readPtLen(NP, PBIT, -1);
      }
      block--;
      var c = decode(ct);
      if (c < 256) {
        out[o++] = c;
      } else {
        var len = c - 256 + 3, d = decode(pt);
        if (d !== 0) d = (1 << (d - 1)) + bits(d - 1);
        var from = o - d - 1;
        if (from < 0) throw new Error("Corrupt LHA data.");
        while (len-- > 0 && o < outLen) out[o++] = out[from++];
      }
    }
    return out;
  }

  function lhaExtract(u8, wanted) {
    var hs = lhaHeaders(u8), want = wanted.toLowerCase();
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (h.name.toLowerCase() !== want) continue;
      var data = u8.subarray(h.data, h.data + h.csize), out;
      if (h.method === "-lh0-") out = data.slice();
      else if (h.method === "-lh5-") out = lhDecode(data, h.usize, 13);
      else if (h.method === "-lh6-") out = lhDecode(data, h.usize, 15);
      else if (h.method === "-lh7-") out = lhDecode(data, h.usize, 16);
      else throw new Error("Unsupported LHA method " + h.method + ".");
      if (crc16(out) !== h.crc) throw new Error("The file inside the archive failed its checksum, so the download may be damaged.");
      return out.buffer;
    }
    return null;
  }

  // ---- Entry point -----------------------------------------------------------

  function isPak(buf) {
    return buf.byteLength > 12 && String.fromCharCode.apply(null, new Uint8Array(buf, 0, 4)) === "PACK";
  }

  // Returns the base-game pak0.pak inside whatever the visitor chose: a .pak,
  // the quake106.zip download, a zip of an id1 folder, or resource.1 itself.
  function findPak(buf, fileName) {
    if (isPak(buf)) return Promise.resolve(buf);
    var u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) {
      var es = zipEntries(buf), i;
      for (i = 0; i < es.length; i++) {
        if (/(^|\/)pak0\.pak$/i.test(es[i].name)) return zipRead(buf, es[i]);
      }
      for (i = 0; i < es.length; i++) {
        if (/(^|\/)resource\.1$/i.test(es[i].name)) {
          return zipRead(buf, es[i]).then(function (res) {
            return lhaExtract(new Uint8Array(res), "ID1/PAK0.PAK");
          });
        }
      }
      return Promise.resolve(null);
    }
    if (/resource\.1$/i.test(fileName || "")) return Promise.resolve(lhaExtract(u8, "ID1/PAK0.PAK"));
    return Promise.resolve(null);
  }

  var api = { findPak: findPak, lhaExtract: lhaExtract, zipEntries: zipEntries };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QUnpack = api;
})(this);
