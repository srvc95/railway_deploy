/* Copied from keel-prototype v1.2.3 public/ctx.js, adapted for adopt-keel-shell (healthcare context types; targets are marked by the pages with data-ctx-type and data-ctx-id). */
/* Keel point-and-ask (add-agentic-ux S2, design D5 and D13): a post-render decorator that marks the P0 records as pointable,
   a floating "Ask" button, Alt+click, the Point mode toggle and the resolver that turns a target into a context chip.
   It adds attributes and one floating control only: no text node and no layout box of the page changes. It talks to the chat
   through KeelChat.attach, chips, onAttachChange and onEscape (design D25) and never sends a request itself. */
(function () {
  "use strict";
  var MAX_TEXT = 600, MAX_LABEL = 80, CLOSE_MS = 120, HIT_PAD = 8;
  // controls that stay themselves inside a target: a click on one of them is never an attach
  var CONTROLS = "a[href],button,input,select,textarea,summary,[role='tab'],[data-act],.tabs,.filters,nav";
  var TABBABLE = "a[href],button,input,select,textarea,summary,[tabindex],[contenteditable='']," + "[contenteditable='true']";

  /* ---------- pure part: the resolver (no DOM) ---------- */
  function collapse(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; }
  function first(n) { return String(n || "").split(" ")[0]; }
  /* The context types the dock accepts (server/ask/context.ts has the same list and checks every id). A page marks a pointable node with
     data-ctx-type="<type>" data-ctx-id="<id>" and, optionally, data-ctx-label="<short name>". Types that carry text send what the screen showed. */
  var TYPES = { member: 1, kpi: 1, signal: 1, plan: 1, rule: 1, step: 1, draft: 1, crm: 1, panel: 1, answer: 1 };
  var CARRY = { panel: 1, answer: 1, signal: 1, draft: 1, crm: 1 };
  var ID_OK = /^[\w:. -]{1,80}$/;
  function carries(type) { return !!CARRY[type]; }
  function item(type, id, label, o) {
    var it = { type: type, id: id, label: clip(label, MAX_LABEL) };
    if (carries(type)) {
      var t = collapse(o && o.text);
      if (t) it.text = clip(t, MAX_TEXT);
    }
    return it;
  }
  /** o = {label, text, question}. Returns {type, id, label, text?} or null. */
  function build(type, id, x, o) {
    type = String(type); id = String(id == null ? "" : id); o = o || {};
    if (!Object.prototype.hasOwnProperty.call(TYPES, type) || !ID_OK.test(id)) return null;
    var label = collapse(o.label) || collapse(o.question) || type + " " + id;
    if (type === "answer" && !o.label && collapse(o.question)) label = "Answer: " + collapse(o.question);
    return item(type, id, label, o);
  }

  var api = { build: build, carries: carries, pointing: function () { return false; } };
  window.KeelCtx = api;

  /* ---------- DOM part ---------- */
  var ask, toggle, ta, statusEl, hot = null, pointOn = false, hideTimer = 0, statusTimer = 0, lastX = -1, lastY = -1, hotKey = "";
  function X() { return window.__siq || null; }
  function Chat() { return window.KeelChat || null; }
  function $(s, r) { return (r || document).querySelector(s); }

  /** Visible text of a node: its text nodes joined by one space, minus controls and chrome. */
  function textOf(el, skip) {
    if (!el) return "";
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = [], n;
    while ((n = w.nextNode())) {
      var p = n.parentElement;
      if (!p || (skip && p.closest(skip))) continue;
      out.push(n.textContent);
    }
    return collapse(out.join(" ")).replace(/\s+([.,;:!?)\]])/g, "$1").replace(/([(\[])\s+/g, "$1");
  }
  function say(text) {
    statusEl = statusEl || $("#siqx-status");
    if (!statusEl) return;
    clearTimeout(statusTimer);
    if (statusEl.textContent === text) {
      statusEl.textContent = "";
      statusTimer = setTimeout(function () { statusEl.textContent = text; }, 60);
    } else statusEl.textContent = text;
  }

  /* the target table: selector, and how to read type:id off the element */
  function indexIn(el, sel) {
    var sib = [].filter.call(el.parentNode.children, function (c) { return c.matches(sel); });
    return sib.indexOf(el);
  }
  function stateOf() { var x = X(); return x && x.S ? x.S : {}; }
  /* the pages mark their pointable nodes; the dock's own answers are pointable too */
  var TARGETS = [
    // never a table cell: data-ctx belongs on the row (requirement "Hover outline only in Point mode"); the coverage cells of member.js carry a type the dock does not accept anyway
    { sel: "#main [data-ctx-type][data-ctx-id]:not(td)", id: function (el) { return el.getAttribute("data-ctx-type") + ":" + el.getAttribute("data-ctx-id"); } },
    { sel: "#main .kpis > .kpi", id: function (el) { if (el.hasAttribute("data-ctx-type")) return null; var l = el.querySelector("label"); return l && collapse(l.textContent) ? "kpi:" + collapse(l.textContent) : null; } },
    { sel: "#siqx-log .siqx-msg[data-role='assistant']", id: function (el) { var m = el.getAttribute("data-msg-id"); return m ? "answer:" + m : null; } }
  ];

  function stampAll() {
    for (var t = 0; t < TARGETS.length; t++) {
      var nodes = document.querySelectorAll(TARGETS[t].sel);
      for (var i = 0; i < nodes.length; i++) {
        var v = TARGETS[t].id(nodes[i]);
        if (v && nodes[i].getAttribute("data-ctx") !== v) nodes[i].setAttribute("data-ctx", v);
      }
    }
    applyAttached();
    if (pointOn) applyTabindex();
    if (hot && !hot.isConnected) {
      // a repaint (the feed) replaced the held target: the same record, drawn again, keeps the button; else what is under the pointer
      var held = hot.hasAttribute("data-ctx-hot"), same = null, all = document.querySelectorAll("[data-ctx]"), k;
      for (k = 0; k < all.length && !same; k++) if (all[k].getAttribute("data-ctx") === hotKey) same = all[k];
      var over = document.querySelectorAll("[data-ctx]:hover"), keep = over.length ? over[over.length - 1] : null;
      if (same) { hot = same; setHeld(held); place(); } else if (keep) showAsk(keep, false); else hideAsk();
    }
  }

  /* the attached outline state is derived from the chip state, never stored */
  function applyAttached() {
    var chips = Chat() ? window.KeelChat.chips() : [], on = {}, i;
    for (i = 0; i < chips.length; i++) on[chips[i].type + ":" + chips[i].id] = 1;
    var nodes = document.querySelectorAll("[data-ctx]");
    for (i = 0; i < nodes.length; i++) {
      var has = nodes[i].hasAttribute("data-ctx-attached"), want = !!on[nodes[i].getAttribute("data-ctx")];
      if (want && !has) nodes[i].setAttribute("data-ctx-attached", "");
      else if (!want && has) nodes[i].removeAttribute("data-ctx-attached");
    }
  }

  /* ---------- the item of a target ---------- */
  function describe(el) {
    var v = el.getAttribute("data-ctx"), cut = v.indexOf(":"), type = v.slice(0, cut), id = v.slice(cut + 1), text = "", question = "", label = collapse(el.getAttribute("data-ctx-label"));
    if (carries(type)) {
      if (type === "answer" && /^m\d+$/.test(id)) {
        text = textOf($(".siqx-body", el), "button");
        var prev = el.previousElementSibling;
        if (prev && prev.getAttribute("data-role") === "user") question = textOf($(".siqx-text", prev));
      } else text = textOf(el, "button,[data-siq-ui]");
    }
    if (!label && type !== "answer") { var h = el.querySelector("h1,h2,h3,h4,b,label,strong"); label = h ? collapse(h.textContent) : textOf(el, "button,[data-siq-ui]"); }
    return build(type, id, X(), { text: text, question: question, label: label });
  }

  function attachTarget(el, focusComposer) {
    var it = describe(el);
    if (!Chat() || !it) return "invalid";
    var r = window.KeelChat.attach(it);
    if (r === "duplicate") say("Already attached");
    else if (r === "full") say("Up to 5 items can be attached");
    if (focusComposer && ta && r !== "invalid") ta.focus();
    return r;
  }

  /* ---------- the floating Ask button ---------- */
  function overlapsX(dock, r) { var d = dock.getBoundingClientRect(); return d.left < r.right && d.right > r.left; }
  function visibleRect(el) {
    var r = el.getBoundingClientRect(), L = r.left, T = r.top, R = r.right, B = r.bottom, p, cs, pr;
    for (p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      cs = getComputedStyle(p);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        pr = p.getBoundingClientRect();
        L = Math.max(L, pr.left); T = Math.max(T, pr.top); R = Math.min(R, pr.right); B = Math.min(B, pr.bottom);
      }
    }
    var dock = document.getElementById("siqx-dock");
    if (dock && !dock.contains(el) && overlapsX(dock, r)) B = Math.min(B, dock.getBoundingClientRect().top); // the dock only covers what lies under it
    L = Math.max(L, 0); T = Math.max(T, 0); R = Math.min(R, window.innerWidth); B = Math.min(B, window.innerHeight);
    return { left: L, top: T, right: R, bottom: B };
  }
  /** The right edge of the area that clips the element: its overflow ancestors and the viewport. */
  function clipRight(el) {
    var R = window.innerWidth, p;
    for (p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") R = Math.min(R, p.getBoundingClientRect().right);
    }
    return R;
  }
  /** Text rectangles under root (Range.getClientRects of its text nodes), clipped to box; nodes inside skip are left out. */
  function textRects(root, box, skip, cap) {
    var out = [], tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), rg = document.createRange(), n, pe, rs, i, r, l, t, rr, b, seen = 0;
    for (n = tw.nextNode(); n && seen < cap; n = tw.nextNode()) {
      if (!/\S/.test(n.nodeValue) || (skip && skip.contains(n))) continue;
      pe = n.parentElement;
      if (!pe || (pe.checkVisibility && !pe.checkVisibility({ visibilityProperty: true }))) continue;
      seen++;
      rg.selectNodeContents(n);
      rs = rg.getClientRects();
      for (i = 0; i < rs.length; i++) {
        r = rs[i]; l = Math.max(r.left, box.left); t = Math.max(r.top, box.top); rr = Math.min(r.right, box.right); b = Math.min(r.bottom, box.bottom);
        if (rr - l >= 1 && b - t >= 1) out.push({ left: l, top: t, right: rr, bottom: b });
      }
    }
    return out;
  }
  function hits(c, rects) {
    var i, r, p = 1; // a 1 px margin: the text never touches the button
    for (i = 0; i < rects.length; i++) {
      r = rects[i];
      if (r.left < c.x + c.w + p && r.right > c.x - p && r.top < c.y + c.h + p && r.bottom > c.y - p) return true;
    }
    return false;
  }
  /**
   * Put the button in free space, chosen per target from the measured text rectangles: outside the right edge when there is room,
   * else overhanging the top-right corner or above the block edge (icon only there), else inside the corner where no text is.
   * A position that also clears the text of the neighbouring blocks wins (a short block, a line of a scorecard, keeps the first fit); a position that covers text of the target never does.
   * With no such position the button is hidden.
   */
  function place() {
    if (!hot || !ask || ask.hidden) return;
    var v = visibleRect(hot), room = v.bottom - v.top, wF, wI, h, hr, cr, vb, anchored, isTR, short, mine, others, list = [], c, i, pass, pick = null, fallback = null;
    ask.toggleAttribute("data-compact", room < 34); // short rows get a smaller button
    ask.removeAttribute("data-icon");
    wF = ask.offsetWidth; h = ask.offsetHeight;
    ask.setAttribute("data-icon", ""); wI = ask.offsetWidth;
    if (v.right - v.left < wI + 8 || room < 3) { ask.removeAttribute("data-icon"); ask.style.visibility = "hidden"; return; }
    // a record that another layer covers (a sheet, the guide card) gets no button: whatever is at its centre must be the record itself
    var cover = document.elementFromPoint((v.left + v.right) / 2, (v.top + v.bottom) / 2);
    if (!cover || !(hot.contains(cover) || cover.closest(".siqx-ask"))) { ask.removeAttribute("data-icon"); ask.style.visibility = "hidden"; return; }
    hr = hot.getBoundingClientRect(); cr = clipRight(hot);
    vb = window.innerHeight;
    var dock = document.getElementById("siqx-dock");
    if (dock && !dock.contains(hot) && overlapsX(dock, hr)) vb = Math.min(vb, dock.getBoundingClientRect().top);
    var comp = dock && dock.contains(hot) ? dock.querySelector(".siqx-composer") : null;
    if (comp) vb = Math.min(vb, comp.getBoundingClientRect().top); // a target in the sheet: the button rides above the dock but never over the composer
    var pop = popRect(); // the guide popover (--z-tour) is above the button: a position under it is not free
    anchored = hr.top >= v.top - 0.5; // the target's top edge is on screen
    isTR = hot.tagName === "TR";
    short = room < h + 8;
    function add(x, y, icon, outside) {
      var w = icon ? wI : wF;
      x = Math.round(outside ? x : Math.min(x, window.innerWidth - w - 2)); // outside never slides back over the target
      y = Math.round(Math.max(0, y));
      if (x < 0 || y + h > vb || x + w > window.innerWidth) return;
      if (outside && x + w > cr) return; // the area that clips the target would crop the button
      var under = !!pop && x - HIT_PAD < pop.right && x + w + HIT_PAD > pop.left && y - HIT_PAD < pop.bottom && y + h + HIT_PAD > pop.top;
      list.push({ x: x, y: y, w: w, h: h, icon: icon, under: under });
    }
    var inY = short ? v.top + (room - h) / 2 : v.top + 6;
    if (!isTR) {
      var oy = short ? hr.top + (hr.height - h) / 2 : Math.max(hr.top, v.top);
      var gap = short ? 2 : 6; // a short line has no outline room to spare
      // a thin sidebar row: the icon sits just past the sidebar edge, level with the row, never over the row above or below
      if (short && anchored && hot.closest(".side")) add(hr.right + 2, oy, true, false);
      if (anchored) { add(hr.right + gap, oy, false, true); add(hr.right + gap, oy, true, true); }
      if (anchored) add(hr.right - wI / 2, hr.top - h / 2, true, false); // overhangs the top-right corner
      if (anchored) add(hr.right - wI, hr.top - h - 2, true, false); // above the block edge
    } else if (anchored) {
      // a table row: the button sits inside the row's last cell, centred on its height; only when the cell's own text is in the way does it ride the row's top edge
      if (!short) { add(v.right - wF - 6, v.top + Math.round((room - h) / 2), false, false); add(v.right - wI - 6, v.top + Math.round((room - h) / 2), true, false); }
      add(v.right - wF - 6, v.top - Math.round(h / 2), false, false); // between two rows
      add(v.right - wI - 6, v.top - Math.round(h / 2), true, false);
      add(v.right - wI - 6, v.top - h + 6, true, false); // mostly in the gap above the row
    }
    add(v.right - wF - 6, inY, false, false);
    add(v.right - wI - 6, inY, true, false);
    if (!short) { add(v.right - wF - 6, v.bottom - h - 6, false, false); add(v.right - wI - 6, v.bottom - h - 6, true, false); }
    mine = textRects(hot, v, null, 2000);
    others = null;
    // a position clear of the guide popover wins; only when none is, the button rides above the popover (data-over)
    for (pass = 0; pass < 2 && !(pick || fallback); pass++) {
      for (i = 0; i < list.length && !pick; i++) {
        c = list[i];
        if (c.under !== (pass === 1) || hits(c, mine)) continue;
        if (!others) others = hot.parentElement && !short ? textRects(hot.parentElement, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, hot, 800) : [];
        if (!hits(c, others)) pick = c; else if (!fallback) fallback = c;
      }
    }
    pick = pick || fallback;
    ask.toggleAttribute("data-over", !!pick && pick.under);
    if (!pick) { ask.removeAttribute("data-icon"); ask.style.visibility = "hidden"; return; }
    ask.toggleAttribute("data-icon", pick.icon);
    ask.style.visibility = "";
    ask.style.left = pick.x + "px";
    ask.style.top = pick.y + "px";
  }
  /** The rectangle of the visible guide popover, or null. */
  function popRect() {
    var p = document.querySelector(".siqg-pop");
    if (!p || p.hidden || !p.getClientRects().length) return null;
    var r = p.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  var popKey = "";
  /** The guide moves its popover on its own (a step, a re-anchor): re-place the button when the popover moved under a held target. */
  function checkPop() {
    var r = popRect(), k = r ? [r.left, r.top, r.right, r.bottom].join() : "";
    if (k === popKey) return;
    popKey = k;
    if (hot) place();
  }
  var popEl = null, popMO = null;
  /** The guide appends and repositions its popover on its own: watch its style and content. */
  function watchPop() {
    var p = document.querySelector(".siqg-pop");
    if (p !== popEl) {
      popEl = p;
      if (popMO) popMO.disconnect();
      popMO = null;
      if (p) { popMO = new MutationObserver(checkPop); popMO.observe(p, { attributes: true, attributeFilter: ["style", "class", "hidden"], childList: true, subtree: true }); }
    }
    checkPop();
  }
  /** The held target is lit by an attribute only while the pointer is not on it (on the button, in the gap) or the keyboard holds it; under the pointer :hover does it. */
  function setHeld(on) {
    if (!hot) return;
    if (on) { hot.setAttribute("data-ctx-hot", ""); document.documentElement.setAttribute("data-ctx-hold", ""); }
    else { hot.removeAttribute("data-ctx-hot"); document.documentElement.removeAttribute("data-ctx-hold"); }
  }
  function showAsk(el, held) {
    if (!ask || !pointOn) return; // the hover outline and the Ask button belong to Point mode (Alt+click still attaches without them)
    var it = describe(el);
    if (!it) return;
    if (hot && hot !== el) setHeld(false);
    hot = el;
    hotKey = el.getAttribute("data-ctx");
    setHeld(!!held);
    ask.setAttribute("aria-label", "Ask about " + it.label);
    ask.hidden = false;
    place();
  }
  function hideAsk() {
    if (hot) hot.removeAttribute("data-ctx-hot");
    hot = null;
    document.documentElement.removeAttribute("data-ctx-hold");
    if (ask) { ask.hidden = true; ask.style.visibility = ""; }
  }
  function cancelHide() { clearTimeout(hideTimer); hideTimer = 0; }
  /** The pointer left the window: hide now unless a keyboard-focused target or the focused Ask button holds it. */
  function hideUnlessFocused() {
    cancelHide();
    var ae = document.activeElement;
    if (hot && ae && (ae === ask || hot.contains(ae)) && ae.matches(":focus-visible")) return;
    hideAsk();
  }
  /** Close after CLOSE_MS (one timer, not restarted by further moves). A setTimeout, so a paused or fake clock controls it. */
  function scheduleHide() {
    if (hideTimer) return;
    hideTimer = setTimeout(function () {
      hideTimer = 0;
      var ae = document.activeElement;
      // a keyboard-focused target (or the focused Ask button) keeps the button; a target focused by a click does not
      if (hot && ae && (ae === ask || hot.contains(ae)) && ae.matches(":focus-visible")) return;
      if (hot && lastX >= 0 && inHull(lastX, lastY)) return;
      hideAsk();
    }, CLOSE_MS);
  }

  /* ---------- hover intent: the pointer is "in" while it is in the convex hull of the target and the padded button ---------- */
  function askBox() {
    if (!ask || ask.hidden || ask.style.visibility === "hidden") return null;
    var r = ask.getBoundingClientRect();
    return { left: r.left - HIT_PAD, top: r.top - HIT_PAD, right: r.right + HIT_PAD, bottom: r.bottom + HIT_PAD };
  }
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function corners(r) { return [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }]; }
  /** Convex hull (monotone chain) of points. */
  function hull(pts) {
    pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    var lo = [], up = [], i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
      lo.push(p);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      p = pts[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
      up.push(p);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function inRect(r, x, y) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
  /** Is the point in the target, the padded button, or the gap between them? */
  function inHull(x, y) {
    if (!hot) return false;
    var t = visibleRect(hot), a = askBox();
    if (a && inRect(a, x, y)) return true;
    if (inRect(t, x, y)) { // inside the target's box: only while the target (not an overlay such as the guide card) is what is there
      var e = document.elementFromPoint(x, y);
      return !!e && (hot.contains(e) || !!e.closest(".siqx-ask"));
    }
    if (!a) return false;
    var h = hull(corners(t).concat(corners(a))), i, n = h.length;
    for (i = 0; i < n; i++) if (cross(h[i], h[(i + 1) % n], { x: x, y: y }) < 0) return false;
    return true;
  }
  function targetOf(tg) { return tg && tg.closest ? tg.closest("[data-ctx]") : null; }
  /** One decision for a pointer position over element tg (mouseover, mousemove, and scroll). */
  function settle(tg, x, y) {
    if (!tg || !tg.closest) return;
    if (tg.closest(".siqx-ask")) { cancelHide(); setHeld(true); return; }
    var t = targetOf(tg);
    if (!hot) { if (t) showAsk(t, false); return; }
    if (t === hot) { cancelHide(); setHeld(hot.matches(":focus-visible")); return; }
    var related = t && (t.contains(hot) || hot.contains(t)); // a child or parent target: the innermost wins at once
    if (!related && x >= 0) {
      // the padded button always holds the pointer; the hull (the way to the button) holds it only while it is over no target at all,
      // so a pointer inside another target's own box switches to that target at once
      var a = askBox();
      if ((a && inRect(a, x, y)) || (!t && inHull(x, y))) { cancelHide(); setHeld(true); return; }
    }
    if (t) { cancelHide(); showAsk(t, false); return; }
    scheduleHide();
  }

  function onOver(ev) { lastX = ev.clientX; lastY = ev.clientY; settle(ev.target, lastX, lastY); }
  function onMove(ev) { lastX = ev.clientX; lastY = ev.clientY; if (hot) { checkPop(); settle(ev.target, lastX, lastY); } }
  function onOut(ev) { if (!ev.relatedTarget && hot) hideUnlessFocused(); }
  function onScroll() {
    place();
    if (!hot || lastX < 0) return;
    var e = document.elementFromPoint(lastX, lastY);
    if (e) settle(e, lastX, lastY);
  }
  function onFocusIn(ev) {
    var tg = ev.target;
    if (!tg || !tg.closest) return;
    if (tg.closest(".siqx-ask")) { cancelHide(); return; }
    var t = tg.closest("[data-ctx]");
    if (t) { cancelHide(); if (t !== hot) showAsk(t, true); else setHeld(true); } else if (hot) hideAsk();
  }
  function onFocusOut(ev) {
    var rt = ev.relatedTarget;
    if (rt && rt.closest && (rt.closest(".siqx-ask") || (hot && hot.contains(rt)))) return;
    if (hot) { cancelHide(); scheduleHide(); }
  }

  /* ---------- clicks, keys ---------- */
  function onClick(ev) {
    if (ev.button !== 0) return;
    var tg = ev.target;
    if (!tg || !tg.closest || tg.closest(".siqx-ask")) return;
    if (!(ev.altKey || pointOn)) return;
    var t = tg.closest("[data-ctx]");
    if (!t) return;
    var ctl = tg.closest(CONTROLS);
    if (ctl && ctl !== t && t.contains(ctl)) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    attachTarget(t, false);
  }
  function nextTabbable(el) {
    var nodes = document.querySelectorAll(TABBABLE), i, n, ti;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n === ask || n.disabled || !(el.compareDocumentPosition(n) & 4)) continue;
      ti = n.getAttribute("tabindex");
      if (ti !== null && +ti < 0) continue;
      if (n.closest("[inert]") || (n.checkVisibility && !n.checkVisibility({ visibilityProperty: true }))) continue;
      return n;
    }
    return null;
  }
  function onKeyDown(ev) {
    var ae = document.activeElement;
    if (ev.key === "Tab" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      if (!hot || !ask || ask.hidden) return;
      if (!ev.shiftKey && ae === hot) { ev.preventDefault(); ask.focus(); return; }
      if (ae === ask) {
        if (ev.shiftKey) { ev.preventDefault(); hot.focus(); return; }
        var n = nextTabbable(hot);
        if (n) { ev.preventDefault(); n.focus(); }
      }
      return;
    }
    if (!pointOn || (ev.key !== "Enter" && ev.key !== " ") || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (!ae || !ae.hasAttribute || !ae.hasAttribute("data-ctx")) return;
    ev.preventDefault(); ev.stopPropagation();
    attachTarget(ae, false);
  }
  function onKeyUp(ev) {
    var ae = document.activeElement;
    if (pointOn && ev.key === " " && ae && ae.hasAttribute && ae.hasAttribute("data-ctx")) ev.preventDefault();
  }

  /* ---------- Point mode ---------- */
  function applyTabindex() {
    var nodes = document.querySelectorAll("[data-ctx]");
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].hasAttribute("tabindex")) { nodes[i].setAttribute("tabindex", "0"); nodes[i].setAttribute("data-ctx-ti", ""); }
    }
  }
  function restoreTabindex() {
    var nodes = document.querySelectorAll("[data-ctx-ti]");
    for (var i = 0; i < nodes.length; i++) { nodes[i].removeAttribute("tabindex"); nodes[i].removeAttribute("data-ctx-ti"); }
  }
  function setPoint(on) {
    on = !!on;
    if (on === pointOn) return;
    pointOn = on;
    if (toggle) toggle.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) document.documentElement.setAttribute("data-ctx-pointing", ""); else document.documentElement.removeAttribute("data-ctx-pointing");
    if (on) {
      applyTabindex();
      var under = lastX >= 0 ? document.elementFromPoint(lastX, lastY) : null; // the record the pointer already rests on is lit at once
      if (under) settle(under, lastX, lastY);
      say("Point mode on. Click a record to attach it");
      return;
    }
    hideAsk();
    var ae = document.activeElement, lost = !!(ae && ae.hasAttribute && ae.hasAttribute("data-ctx-ti"));
    restoreTabindex();
    if (lost && ta) ta.focus();
    say("Point mode off");
  }
  api.pointing = function () { return pointOn; };
  api.setPoint = setPoint;
  api.stamp = stampAll;

  function mountToggle() {
    var row = $("#siqx-dock .siqx-row");
    if (!row || $('[data-siqx="point"]', row)) return false;
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "siqx-btn siqx-point";
    toggle.setAttribute("data-siqx", "point");
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "Point at a record on the page to attach it";
    toggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5l9 4.2-3.9 1.4-1.4 3.9z"/></svg><span>Point</span>';
    var before = $('[data-siqx="toggle"]', row) || $('[data-siqx="send"]', row);
    row.insertBefore(toggle, before);
    toggle.addEventListener("click", function () { setPoint(!pointOn); });
    return true;
  }
  function mountAsk() {
    ask = document.createElement("button");
    ask.type = "button";
    ask.className = "siqx-ask";
    ask.setAttribute("data-siq-ui", "");
    ask.setAttribute("data-siqx", "ask");
    ask.setAttribute("tabindex", "-1"); // reached from its focused target by the Tab handler below, not by the page tab order
    ask.setAttribute("aria-label", "Ask");
    ask.hidden = true;
    ask.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v12M2 8h12"/></svg><span>Ask</span>';
    document.body.appendChild(ask);
    ask.addEventListener("click", function () { if (hot) attachTarget(hot, true); });
  }

  var tries = 0;
  function init() {
    if (!Chat() || !document.getElementById("siqx-dock") || !$("#main")) {
      if (++tries < 40) setTimeout(init, 50);
      return;
    }
    ta = $("#siqx-q"); statusEl = $("#siqx-status");
    mountToggle();
    mountAsk();
    window.KeelChat.onAttachChange(applyAttached);
    window.KeelChat.onEscape(function () { if (!pointOn) return false; setPoint(false); return true; });
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("mouseover", onOver, { passive: true });
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseout", onOut, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", place);
    try { new MutationObserver(watchPop).observe(document.body, { childList: true }); } catch (e3) { /* optional */ }
    watchPop();
    document.addEventListener("siq:render", stampAll);
    document.addEventListener("siq:run", function () { if (hot) place(); }); // a sheet opening over the held record takes the button away
    try {
      new MutationObserver(stampAll).observe($("#main"), { childList: true, subtree: true });
      var log = $("#siqx-log");
      if (log) new MutationObserver(stampAll).observe(log, { childList: true });
    } catch (e) { /* no observer: siq:render still re-stamps */ }
    // a layout change under a held target (the guide closing, the dock growing) moves it: keep the button with it
    try { if (window.ResizeObserver) new ResizeObserver(function () { place(); }).observe($("#main")); } catch (e2) { /* optional */ }
    stampAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
