/* Copied from keel-prototype v1.2.3 public/skel.js, adapted for adopt-keel-shell */
/* Keel skeleton utility (add-agentic-ux S3, design D6). window.KeelSkel.show(region, opts) lays a layer of .siqx-skel lines,
   sized to the measured content box, over the region and hides its content without removing it, so the region's box never changes
   and nothing shifts. The region carries aria-busy="true" while it shows ("false" after), the layer is aria-hidden, and the layer
   stays for at least MIN_MS. It never fetches and never touches data: it is a view of "work is in progress", nothing else. */
(function () {
  "use strict";
  var MIN_MS = 400, MAX_TIMED_MS = 1200, MAX_LINES = 40;

  /* ---------- pure rules (unit-tested without a DOM) ---------- */
  function releaseDelay(elapsed) {
    elapsed = Number(elapsed);
    if (!(elapsed >= 0)) elapsed = 0;
    return Math.max(0, MIN_MS - elapsed);
  }
  function timedMs(ms) {
    ms = Number(ms);
    if (!(ms >= 0)) return MIN_MS;
    return Math.min(MAX_TIMED_MS, Math.max(MIN_MS, ms));
  }
  /* widths (percent) of the lines that fill `height`: all full width, the last one shorter */
  function lines(height, step) {
    height = Number(height); step = Number(step);
    if (!(step > 0)) step = 20;
    var n = !(height > 0) ? 1 : Math.max(1, Math.min(MAX_LINES, Math.floor(height / step)));
    var out = [];
    for (var i = 0; i < n; i++) out.push(i === n - 1 ? 60 : 100);
    return out;
  }

  /* tile bars: how many placeholder bars fit a tile of this height (0 to 3) */
  function bars(height) {
    height = Number(height);
    return !(height > 0) ? 0 : Math.max(0, Math.min(3, Math.floor((height - 24) / 24)));
  }

  var api = { MIN_MS: MIN_MS, MAX_TIMED_MS: MAX_TIMED_MS, pure: { releaseDelay: releaseDelay, timedMs: timedMs, lines: lines, bars: bars } };
  window.KeelSkel = api;
  if (typeof document === "undefined") return;

  /* ---------- DOM ---------- */
  var NOOP = { region: null, released: true, removed: true, release: function () {}, then: function (fn) { try { fn(); } catch (e) { /* ignore */ } } };
  function px(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function stepOf(node) {
    var cs = getComputedStyle(node), lh = px(cs.lineHeight);
    return lh > 0 ? lh : (px(cs.fontSize) || 14) * 1.45;
  }
  function span(cls) { var s = document.createElement("span"); s.className = cls; return s; }

  /* The box to cover, relative to the region's padding box: the union of `nodes`, or the region's content box. */
  function boxOf(region, nodes) {
    var cs = getComputedStyle(region);
    if (nodes && nodes.length) {
      var rr = region.getBoundingClientRect(), x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      nodes.forEach(function (n) {
        var r = n.getBoundingClientRect();
        if (!r.width && !r.height) return;
        x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
      });
      if (x1 !== Infinity) return { left: x1 - rr.left - region.clientLeft, top: y1 - rr.top - region.clientTop, width: x2 - x1, height: y2 - y1 };
    }
    var pl = px(cs.paddingLeft), pt = px(cs.paddingTop);
    return { left: pl, top: pt, width: Math.max(0, region.clientWidth - pl - px(cs.paddingRight)), height: Math.max(0, region.clientHeight - pt - px(cs.paddingBottom)) };
  }

  function show(region, opts) {
    opts = opts || {};
    if (!region || !region.isConnected) return NOOP;
    if (region.__siqSkel) return region.__siqSkel;
    var nodes = Array.isArray(opts.nodes) ? opts.nodes.filter(function (n) { return n && n.nodeType === 1; }) : null;
    var started = Date.now(), prevPos = region.style.position, madeRelative = false, timers = [], waiters = [];
    var shape = opts.tiles === "children" || opts.tiles === "self" ? opts.tiles : null;
    var kids = shape === "children" ? Array.prototype.filter.call(region.children, function (n) { return n.nodeType === 1 && !n.classList.contains("siqx-skel"); }) : [];
    if (shape === "children" && !kids.length) shape = null;
    if (shape) nodes = null;
    var b = shape === "self" ? { left: 0, top: 0, width: region.clientWidth, height: region.clientHeight } : boxOf(region, nodes), step = stepOf(nodes && nodes.length ? nodes[0] : region);
    if (getComputedStyle(region).position === "static") { region.style.position = "relative"; madeRelative = true; }
    var layer = span("siqx-skel");
    layer.setAttribute("aria-hidden", "true");
    layer.style.left = Math.max(0, b.left) + "px"; layer.style.top = Math.max(0, b.top) + "px";
    layer.style.width = Math.max(0, b.width) + "px"; layer.style.height = Math.max(0, b.height) + "px";
    var lineH = Math.max(6, Math.round(step * 0.6)), gap = Math.max(2, Math.round(step - lineH));
    function tile(w, h, x, y) {
      var t = span("siqx-skel-tile");
      t.style.width = Math.max(0, w) + "px"; t.style.height = Math.max(0, h) + "px";
      if (x != null) { t.style.left = x + "px"; t.style.top = y + "px"; }
      for (var i = 0; i < bars(h); i++) { var bar = span("siqx-skel-bar"); bar.style.width = (i === 0 ? 40 : i === 1 ? 90 : 65) + "%"; t.appendChild(bar); }
      layer.appendChild(t);
    }
    if (shape) {
      layer.classList.add("siqx-skel-tiles");
      if (shape === "self") tile(b.width, b.height, 0, 0);
      else {
        var lr = region.getBoundingClientRect(), ox = lr.left + region.clientLeft + b.left, oy = lr.top + region.clientTop + b.top;
        kids.forEach(function (k) { var kr = k.getBoundingClientRect(); tile(kr.width, kr.height, kr.left - ox, kr.top - oy); });
      }
    } else lines(b.height, step).forEach(function (w, i, all) {
      var l = span("siqx-skel-line");
      l.style.width = w + "%";
      l.style.height = lineH + "px";
      if (i < all.length - 1) l.style.marginBottom = gap + "px";
      layer.appendChild(l);
    });
    if (nodes && nodes.length) nodes.forEach(function (n) { n.classList.add("siqx-skel-hide"); });
    else region.classList.add("siqx-skeleton");
    region.setAttribute("aria-busy", "true");
    region.appendChild(layer);

    var h = { region: region, released: false, removed: false };
    function remove() {
      if (h.removed) return;
      h.removed = true;
      timers.forEach(clearTimeout);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      if (nodes && nodes.length) nodes.forEach(function (n) { n.classList.remove("siqx-skel-hide"); if (!n.getAttribute("class")) n.removeAttribute("class"); });
      else region.classList.remove("siqx-skeleton");
      if (madeRelative) { region.style.position = prevPos; if (!region.getAttribute("style")) region.removeAttribute("style"); }
      region.setAttribute("aria-busy", "false");
      region.__siqSkel = null;
      waiters.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* a waiter never breaks the utility */ } });
    }
    /* release when the work is done; the layer still stays for the rest of MIN_MS */
    h.release = function () {
      if (h.released) return;
      h.released = true;
      var d = releaseDelay(Date.now() - started);
      if (d > 0) timers.push(setTimeout(remove, d)); else remove();
    };
    h.then = function (fn) { if (h.removed) { try { fn(); } catch (e) { /* ignore */ } } else waiters.push(fn); };
    if (opts.max > 0) timers.push(setTimeout(h.release, Math.max(MIN_MS, opts.max)));
    region.__siqSkel = h;
    return h;
  }

  /* a skeleton of fixed length for display-only actions (never more than MAX_TIMED_MS) */
  function timed(region, ms, opts) {
    var h = show(region, opts);
    setTimeout(h.release, timedMs(ms));
    return h;
  }

  api.show = show;
  api.timed = timed;
  api.active = function (region) { return !!(region && region.__siqSkel); };
})();
