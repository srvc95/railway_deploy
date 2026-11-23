/* Copied from keel-prototype v1.2.3 public/chat.js, adapted for adopt-keel-shell (case agents, healthcare chips, page ids, no web sources or follow-ups). */
/* Keel chat (add-agentic-ux S1): the global dock (#siqx-dock), the thread sheet, the message model and window.KeelChat.
   chat.js owns the DOM and the thread; live.js owns the network (KeelChat never calls fetch). The dock is a child of
   .app, never of #main, so no render() can touch its draft, chips, scroll position or expanded state. */
(function () {
  "use strict";
  var AGENTS = { "case": "Keel", coach: "Agent Coach", audit: "Audit Agent" }; // answers from the case surfaces are signed Keel
  var TAG_CLASS = { "case": "research", coach: "coach", audit: "perf" }; // the four prototype tag colours
  var VERBS = { page: 1, member: 1, why: 1 };
  /* every validated action verb only navigates the main view (or opens the Why sheet), so a click on one uncovers the destination */
  var NAV_ACTS = VERBS;
  var DOCK_PAGES = { home: "home", members: "members", member: "case", plans: "case", coach: "coach", performance: "perf", crm: "crm", rules: "rules" }; // page id -> chips key; the dock shows on every screen, as in the old app
  var CAP = 50, MAX_EXPLICIT = 5, MAX_ITEMS = 6, PIN_PX = 60, DUP_MS = 1500;
  var ANCHOR_GAP = 8, SHEET_MIN = 120, KEY_STEP = 32, USER_MS = 600, UNDO_MS = 10000, SHEET_KEY = "siqx.sheetH";
  var CHIPS = {
    home: ["What needs me today?", "Why was Northlake Value excluded?", "What does Dottie need before Dec 31?"],
    coach: ["Prep me for the call with Dottie", "Should Dottie switch to Northlake Value?", "What can I not say in the outreach?"],
    perf: ["How was the cycle time measured?", "What changed between pack 2025.3 and 2026.2?", "What is in the audit package?"],
    "case": ["Why was Northlake Value excluded?", "Which records did the rules use?", "What is still waiting on a person?"],
    members: ["Who needs attention?", "Which members have no review yet?", "What is Dottie's deadline?"],
    crm: ["Which CRM records changed?", "What did the approval write to the CRM?", "Which task was created?"],
    rules: ["Which rule blocked the message?", "What changed between pack 2025.3 and 2026.2?", "Which disclosure did the rules add?"]
  };
  var PLACEHOLDER = {
    home: ["Ask about Dottie's case, the plans or the rules", "Ask Keel about this case"],
    coach: ["Ask the Coach about Dottie's outreach", "Ask the Agent Coach"],
    perf: ["Ask about the run, the audit package or the rule packs", "Ask the Audit Agent"],
    "case": ["Ask about this case, the plans or the rules", "Ask Keel about this case"],
    members: ["Ask about the members and their cases", "Ask Keel about the members"],
    crm: ["Ask about the CRM records and writes", "Ask Keel about the Sandbox CRM"],
    rules: ["Ask about the rules and disclosures", "Ask Keel about the rules"]
  };
  var TAB_LABEL = { decisions: "Decisions", approvals: "Approvals", audit: "Audit packages", record: "Record", activity: "Activity", tasks: "Tasks", cases: "Cases", log: "Write-back log", overview: "Overview", coverage: "Coverage checks", relationships: "Relationships", comms: "Communications and consent", workflow: "Workflow", outreach: "Outreach" };
  var ICON = {
    send: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
    stop: '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10l4.5-4.5L12.5 10"/></svg>',
    chev: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.8v3.8M8 11.1v.1"/></svg>',
    x: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6"/></svg>'
  };

  var root, sheet, log, ta, tray, sendBtn, toggleBtn, pillEl, statusEl, jumpBtn, emptyEl, noteEl, presetsEl;
  var grip, countEl, newBtn, confirmEl, undoBtn, headSlot, pillSlot, tailEl, toggleLabel;
  var mode = "anchor";        // log scrolling: "anchor" (latest question at the top), "follow" (at the end) or "free" (the user's place)
  var reserveH = 0, sendTs = -1e9; // px the guide popover needs above the dock; time of the last send (performance.now)
  var userT = 0, dragging = false, savedTop = 0, userH = null, capH = 0, drag = null;
  var asking = false, snap = null, undoTimer = 0;
  var thread = [];            // chronological records of user and assistant messages (cap 50)
  var byId = {};              // assistant records by message id
  var explicit = [];          // explicit chips (up to 5), screen chip excluded
  var attachListeners = [];
  var escHooks = [];
  var seq = 0, isBusy = false, expandedFlag = false, unread = 0, trimmed = false;
  var screenGone = null;      // id of the screen whose chip the user removed
  var lastSubmit = { q: "", t: 0 };
  var curPage = "", curScreen = null, statusTimer = 0, measureRaf = 0;

  function $(s, r) { return (r || document).querySelector(s); }
  function X() { return window.__siq || null; }
  function Live() { return window.KeelLive || null; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : null; }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) : s; }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function root_() { return document.documentElement; }

  /* ---------- the screen chip, derived from window.__siq.S ---------- */
  function runViews() { var x = X(); return x && x.run && x.run.views ? x.run.views : {}; }
  /* Dorothy "Dottie" Hayes reads "Dottie Hayes" (labels.js memberName, short form; this file is a plain script and cannot import it) */
  function shortName(n) {
    n = String(n || "").trim();
    var nick = /["“”]([^"“”]+)["“”]/.exec(n), last = n.split(/\s+/).pop() || "";
    return nick ? nick[1] + " " + last : n;
  }
  function memberName(id) {
    var v = runViews(), sc = v.scenario, st = v.story;
    if (id === "ben-hayes") return sc && sc.beneficiary ? shortName(sc.beneficiary.name) : "Dottie Hayes";
    var m = st && Array.isArray(st.members) ? st.members.filter(function (k) { return k.id === id; })[0] : null;
    return m ? m.name : "Member";
  }
  function deriveScreen() {
    var x = X();
    if (!x || !x.S) return null;
    var S = x.S, P = S.params || {}, id, label;
    switch (S.page) {
      case "home": id = "home"; label = "Home"; break;
      case "members": id = "members"; label = "Members"; break;
      case "member":
        if (!P.id) return null;
        id = "member:" + P.id + (P.tab ? ":" + P.tab : ""); label = "Member: " + memberName(P.id) + (P.tab && TAB_LABEL[P.tab] ? " - " + TAB_LABEL[P.tab] : "");
        break;
      case "plans": id = "plans" + (P.caseId ? ":" + P.caseId : ""); label = "Plan comparisons"; break;
      case "coach": id = "coach"; label = "Agent Coach"; break;
      case "performance": id = "performance:" + (P.tab || "decisions"); label = "Performance and audit: " + (TAB_LABEL[P.tab || "decisions"] || P.tab); break;
      case "crm": id = "crm:" + (P.tab || "record"); label = "Sandbox CRM: " + (TAB_LABEL[P.tab || "record"] || P.tab); break;
      case "rules": id = "rules"; label = "Rules and disclosures"; break;
      default: return null;
    }
    return { type: "screen", id: clip(id, 80), label: clip(label, 80) };
  }
  function screenItem() {
    var s = curScreen;
    return s && screenGone !== s.id ? s : null;
  }

  /* ---------- announcements (hidden role=status) ---------- */
  function announce(text) {
    if (!statusEl) return;
    clearTimeout(statusTimer);
    if (statusEl.textContent === text) {
      statusEl.textContent = "";
      statusTimer = setTimeout(function () { statusEl.textContent = text; }, 60);
    } else statusEl.textContent = text;
  }

  /* ---------- panels: one at a time (change cosmetic-and-oncall, R2) ---------- */
  /* The left edge of the open panel (the Why sheet or the audit report sheet), or null. The dock ends there, so Point and Send stay clickable. */
  function panelEdge() {
    var edge = null;
    ["#why-sheet", "#audit-sheet"].forEach(function (sel) {
      var e = $(sel);
      if (!e || e.hidden) return;
      var r = e.getBoundingClientRect();
      if (r.width > 0 && (edge === null || r.left < edge)) edge = r.left;
    });
    return edge;
  }
  var panelWas = false;
  /* A panel opened: the thread collapses to its message-count pill (the composer stays); a panel closed: the dock takes its width back. */
  function onPanelChange() {
    if (!root) return;
    var open = panelEdge() !== null;
    if (open && !panelWas && expandedFlag) setExpanded(false);
    panelWas = open;
    measureSoon();
  }

  /* ---------- dock geometry: alignment, clearance, toast offset, sheet cap ---------- */
  function measure() {
    measureRaf = 0;
    if (!root || root.hidden) return;
    var main = $("#main"), st = root.style;
    if (!main) return;
    var vh = window.innerHeight, mr = main.getBoundingClientRect(), wrap = $(".wrap", main), left, width;
    if (wrap) {
      var wr = wrap.getBoundingClientRect(), cs = getComputedStyle(wrap);
      left = wr.left + parseFloat(cs.paddingLeft || 0);
      width = wr.width - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    } else { left = mr.left + 28; width = mr.width - 56; }
    if (!(width > 0)) return;
    var edge = panelEdge();
    if (edge !== null) { // an open panel: the composer and the thread end at its left edge minus the dock gutter
      var gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--siqx-gutter")) || 28;
      width = Math.min(width, Math.max(240, edge - gutter - left));
    }
    st.left = left + "px";
    st.width = width + "px";
    st.bottom = Math.max(0, vh - Math.min(mr.bottom, vh)) + "px";
    var comp = $(".siqx-composer", root).getBoundingClientRect();
    var area = comp.height + (presetsEl ? presetsEl.getBoundingClientRect().height + 8 : 0);
    var cap = Math.max(SHEET_MIN, Math.min(0.45 * vh, vh - area - 20 - 8 - Math.max(200, reserveH)));
    capH = Math.floor(cap);
    sheet.style.maxHeight = capH + "px";
    sheet.style.height = userH != null ? Math.max(SHEET_MIN, Math.min(capH, userH)) + "px" : "";
    root.toggleAttribute("data-compact", vh <= 700);
    fadePresets();
    if (expandedFlag) {
      grip.setAttribute("aria-valuemin", String(SHEET_MIN));
      grip.setAttribute("aria-valuemax", String(capH));
      grip.setAttribute("aria-valuenow", String(Math.round(sheet.getBoundingClientRect().height)));
    }
    var rr = root.getBoundingClientRect(), toast = $("#toast");
    if (toast) toast.style.bottom = Math.max(0, vh - rr.top + 12) + "px";
    main.style.paddingBottom = Math.ceil(rr.height + 20) + "px";
    main.style.scrollPaddingBottom = Math.ceil(rr.height + 20) + "px";
    keepFocusClear(main, rr);
    if (expandedFlag) applyScroll();
  }
  /* WCAG 2.4.11: when the dock grows (an answer lands under a focused page element), a keyboard-focused element it now covers scrolls back into view */
  var lastDockH = 0;
  function keepFocusClear(main, rr) {
    var grew = rr.height > lastDockH + 0.5;
    lastDockH = rr.height;
    if (!grew) return;
    var f = document.activeElement;
    if (!f || f === document.body || !main.contains(f)) return;
    try { if (!f.matches(":focus-visible")) return; } catch (e) { return; }
    var fr = f.getBoundingClientRect();
    if (fr.height > 0 && fr.bottom > rr.top && fr.top < rr.bottom) f.scrollIntoView({ block: "nearest" });
  }
  /* a clipped preset row marks the clipped end(s) with data-fade (start, end or both); the CSS paints the fade */
  function fadePresets() {
    if (!presetsEl) return;
    var e = presetsEl, max = e.scrollWidth - e.clientWidth, v = "";
    if (max > 1) {
      var s = e.scrollLeft > 1, n = e.scrollLeft < max - 1;
      v = s && n ? "both" : s ? "start" : n ? "end" : "";
    }
    if (v) { if (e.getAttribute("data-fade") !== v) e.setAttribute("data-fade", v); } else if (e.hasAttribute("data-fade")) e.removeAttribute("data-fade");
  }
  function measureSoon() {
    if (!measureRaf) measureRaf = requestAnimationFrame(measure);
  }

  /* ---------- tray (screen chip + explicit chips) ---------- */
  function chipEl(item, removable) {
    var c = el("span", "siqx-chip");
    c.setAttribute("data-type", item.type);
    c.setAttribute("data-id", item.id);
    c.title = item.label;
    c.appendChild(el("span", "siqx-chip-label", item.label));
    if (removable) {
      var b = el("button", "siqx-chip-x");
      b.type = "button";
      b.setAttribute("aria-label", "Remove " + item.label);
      b.title = "Remove " + item.label;
      b.innerHTML = ICON.x;
      c.appendChild(b);
    }
    return c;
  }
  function renderTray() {
    tray.textContent = "";
    var s = screenItem();
    if (s) tray.appendChild(chipEl(s, true));
    explicit.forEach(function (it) { tray.appendChild(chipEl(it, true)); });
    tray.hidden = !tray.firstChild;
    measure();
  }
  function notifyAttach() {
    var list = chips();
    attachListeners.slice().forEach(function (fn) { try { fn(list); } catch (e) { /* a listener never breaks the composer */ } });
  }
  /* harden-demo-failures: a chip belongs to the screen it was attached on (page, plus the open Coach deal, proposal or dossier) */
  function scopeKey() {
    var x = X(), S = x && x.S ? x.S : null;
    if (!S) return "";
    var p = S.page || "", P = S.params || {};
    if (p === "member") return "member:" + (P.id || "");
    if (p === "plans") return "plans:" + (P.caseId || "");
    return p;
  }
  function dropStale() {
    var k = scopeKey();
    if (!k) return;
    var keep = explicit.filter(function (c) { return !c.scope || c.scope === k; }), gone = explicit.length - keep.length;
    if (!gone) return;
    explicit = keep;
    renderTray(); notifyAttach();
    announce("Removed " + gone + (gone === 1 ? " attached item" : " attached items") + " from the previous screen");
  }
  function clipItem(c) {
    var o = { type: clip(c.type, 40), id: clip(c.id, 80), label: clip(c.label || c.id, 80) };
    if (typeof c.text === "string" && c.text) o.text = clip(c.text, 600);
    return o;
  }
  function chips() { return explicit.map(function (c) { var o = { type: c.type, id: c.id, label: c.label }; if (c.text) o.text = c.text; return o; }); }
  function attach(item) {
    if (!item || typeof item.type !== "string" || typeof item.id !== "string" || typeof item.label !== "string" || !item.type || !item.id) return "invalid";
    for (var i = 0; i < explicit.length; i++) if (explicit[i].type === item.type && explicit[i].id === item.id) return "duplicate";
    if (explicit.length >= MAX_EXPLICIT) return "full";
    var it = { type: item.type, id: clip(item.id, 80), label: clip(item.label, 80), scope: scopeKey() };
    if (typeof item.text === "string" && item.text) it.text = clip(item.text, 600);
    explicit.push(it);
    renderTray(); notifyAttach();
    if (!isBusy) announce("Attached " + it.label);
    return "ok";
  }
  function detach(type, id) {
    if (type === "screen") {
      var s = screenItem();
      if (s && (id == null || s.id === id)) { screenGone = s.id; renderTray(); announce("Removed " + s.label); return true; }
      return false;
    }
    for (var i = 0; i < explicit.length; i++) {
      if (explicit[i].type === type && explicit[i].id === id) {
        var gone = explicit.splice(i, 1)[0];
        renderTray(); notifyAttach(); announce("Removed " + gone.label);
        return true;
      }
    }
    return false;
  }

  /* ---------- presets, placeholder and aria-label per screen ---------- */
  function renderPresets() {
    var page = X() && X().S ? X().S.page : "";
    var key = DOCK_PAGES[page] || "";
    var ph = PLACEHOLDER[key || "home"];
    ta.placeholder = ph[0];
    ta.setAttribute("aria-label", ph[1]);
    if (key === (presetsEl ? presetsEl.getAttribute("data-key") : "")) return;
    if (presetsEl) { presetsEl.remove(); presetsEl = null; }
    if (!key) return;
    presetsEl = el("div", "sugg");
    presetsEl.setAttribute("data-key", key);
    CHIPS[key].forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("data-siqx", "preset"); b.setAttribute("data-q", q); b.textContent = q;
      presetsEl.appendChild(b);
    });
    presetsEl.addEventListener("scroll", fadePresets);
    presetsEl.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-siqx="preset"]') : null;
      if (b) submit(b.getAttribute("data-q"));
    });
    root.insertBefore(presetsEl, noteEl || null);
    measureSoon();
  }
  /* the dock shows on every screen (DOCK_PAGES); a page it does not list would hide it and give its space back */
  function applyDockVisibility() {
    var page = X() && X().S ? X().S.page : "", on = !!DOCK_PAGES[page], main = $("#main");
    root.hidden = !on;
    if (!on && main) { main.style.paddingBottom = ""; main.style.scrollPaddingBottom = ""; }
  }

  /* ---------- navigation signal ---------- */
  function refresh() {
    if (!root) return;
    var next = deriveScreen();
    if (screenGone && (!next || next.id !== screenGone)) screenGone = null;
    var changed = (next ? next.id + "|" + next.label : "") !== (curScreen ? curScreen.id + "|" + curScreen.label : "");
    curScreen = next;
    dropStale();
    renderPresets();
    applyDockVisibility();
    if (changed) renderTray();
    if (!root.hidden) measure();
  }

  /* ---------- sheet state ---------- */
  function plural(n) { return n + (n === 1 ? " message" : " messages"); }
  function unreadText(n) { return n + (n === 1 ? " new answer" : " new answers"); }
  function setToggle() {
    var n = thread.length, fresh = unread > 0 ? ", " + unreadText(unread) : "";
    var had = document.activeElement === toggleBtn;
    toggleBtn.setAttribute("aria-expanded", expandedFlag ? "true" : "false");
    var label = expandedFlag ? "Collapse conversation" : "Expand conversation, " + plural(n) + fresh;
    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.title = label;
    toggleLabel.textContent = expandedFlag ? "Collapse" : plural(n);
    var svg = toggleBtn.querySelector("svg");
    if (svg) svg.outerHTML = expandedFlag ? ICON.down : ICON.up;
    var slot = expandedFlag ? headSlot : pillSlot;
    if (toggleBtn.parentNode !== slot) slot.appendChild(toggleBtn);
    pillSlot.hidden = expandedFlag || !n;
    if (had) toggleBtn.focus();
  }
  function updateCount() {
    countEl.textContent = plural(thread.length);
    newBtn.disabled = isBusy || !thread.length;
    setToggle();
  }
  function setUnread(n) {
    unread = n;
    pillEl.textContent = unreadText(n);
    pillEl.hidden = n <= 0;
    setToggle();
  }
  function setExpanded(v) {
    v = !!v;
    if (v === expandedFlag) { setToggle(); return; }
    if (!v) { savedTop = log.scrollTop; cancelAsk(); }
    expandedFlag = v;
    sheet.hidden = !v;
    if (v) setUnread(0);
    else jumpBtn.hidden = true;
    setToggle();
    measure();
    if (v && mode === "free") { log.scrollTop = savedTop; syncJump(); }
  }

  /* ---------- scrolling: the latest question is anchored at the top; the log follows the end only when the user is there ---------- */
  function dist() { return log.scrollHeight - log.scrollTop - log.clientHeight; }
  function cy(node) { return node.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop; }
  function lastUserEl() {
    for (var i = thread.length - 1; i >= 0; i--) if (thread[i].kind === "user") return thread[i].el;
    return null;
  }
  function syncJump() { jumpBtn.hidden = !expandedFlag || dist() <= PIN_PX; }
  /* the spacer under the last message lets the latest question reach the top once the thread fills the sheet */
  function settleTail() {
    var a = lastUserEl(), h = 0;
    if (a) {
      var ch = log.clientHeight, content = cy(tailEl) + (parseFloat(getComputedStyle(log).paddingBottom) || 0);
      if (content > ch + 2) h = Math.max(0, cy(a) - ANCHOR_GAP + ch - content);
    }
    tailEl.style.height = Math.ceil(h) + "px";
  }
  function applyScroll() {
    if (!expandedFlag) return;
    settleTail();
    if (mode === "anchor") { var a = lastUserEl(); if (a) log.scrollTop = Math.max(0, cy(a) - ANCHOR_GAP); }
    else if (mode === "follow") log.scrollTop = log.scrollHeight;
    syncJump();
  }
  function scrollBottom() {
    mode = "follow";
    log.scrollTop = log.scrollHeight;
    jumpBtn.hidden = true;
  }
  function afterContent() { applyScroll(); }
  function unpin() { mode = "free"; userT = Date.now(); }

  /* ---------- sheet size: resize handle, kept for the page session ---------- */
  function setUserH(h) {
    userH = Math.max(SHEET_MIN, Math.min(capH || h, Math.round(h)));
    measure();
  }
  function saveH() {
    try { if (userH != null) sessionStorage.setItem(SHEET_KEY, String(Math.round(userH))); } catch (e) { /* storage blocked */ }
  }

  /* ---------- new chat with confirmation and Undo ---------- */
  function dropUndo() {
    clearTimeout(undoTimer);
    snap = null;
    if (undoBtn) undoBtn.hidden = true;
  }
  function askClear() {
    if (isBusy || !thread.length) return;
    asking = true;
    confirmEl.hidden = false;
    newBtn.hidden = true;
    var c = $('[data-siqx="cancel"]', confirmEl);
    if (c) c.focus();
    announce("Clear this conversation?");
  }
  function cancelAsk(refocus) {
    if (!asking) return;
    asking = false;
    confirmEl.hidden = true;
    newBtn.hidden = false;
    if (refocus) newBtn.focus();
  }
  function clearThread() {
    if (!asking || isBusy) return;
    cancelAsk();
    snap = { thread: thread, byId: byId, trimmed: trimmed, noteEl: noteEl };
    thread.forEach(function (r) { if (r.el.parentNode) r.el.parentNode.removeChild(r.el); });
    if (noteEl && noteEl.parentNode) noteEl.parentNode.removeChild(noteEl);
    thread = []; byId = {}; trimmed = false; noteEl = null;
    emptyEl.hidden = false;
    setUnread(0);
    updateCount();
    mode = "anchor";
    applyScroll();
    undoBtn.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(dropUndo, UNDO_MS);
    undoBtn.focus();
    announce("Conversation cleared. Undo is available for 10 seconds");
  }
  function undoClear() {
    if (!snap) return;
    thread = snap.thread; byId = snap.byId; trimmed = snap.trimmed; noteEl = snap.noteEl;
    if (noteEl) log.insertBefore(noteEl, log.firstChild);
    thread.forEach(function (r) { log.insertBefore(r.el, tailEl); });
    emptyEl.hidden = !!thread.length;
    dropUndo();
    updateCount();
    refreshTools();
    mode = "anchor";
    applyScroll();
    ta.focus();
    announce("Conversation restored");
  }

  /* ---------- message rendering ---------- */
  function md(text) {
    var live = Live();
    if (live && typeof live.md === "function") { try { return live.md(text); } catch (e) { /* fall through */ } }
    return "<p>" + esc(text) + "</p>";
  }
  function terminal(p) { return p === "done" || p === "failed" || p === "stopped"; }
  function plainText(rec) {
    var b = rec.p.body, blocks = b.querySelectorAll("p, li"), out = [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].querySelector("p, li")) continue;
      var t = blocks[i].textContent.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out.length ? out.join("\n") : b.textContent.trim();
  }
  function lastAssistant() {
    for (var i = thread.length - 1; i >= 0; i--) if (thread[i].kind === "asst") return thread[i];
    return null;
  }
  function refreshTools() {
    var last = lastAssistant();
    thread.forEach(function (r) {
      if (r.kind !== "asst") return;
      var ph = r.state.phase, fin = terminal(ph);
      vis(r.p.copy, ph === "done" || ph === "stopped");
      vis(r.p.regen, r === last && fin && !isBusy);
      vis(r.p.stopped, ph === "stopped");
      vis(r.p.foot, !!r.p.foot.firstChild);
    });
  }
  /* parts that do not apply are removed from the DOM (not just hidden), in a fixed order */
  function vis(node, show) {
    var parent = node._parent, order = node._order;
    if (show) {
      if (node.parentNode === parent) return;
      var i = order.indexOf(node), ref = null;
      for (var j = i + 1; j < order.length && !ref; j++) if (order[j].parentNode === parent) ref = order[j];
      parent.insertBefore(node, ref);
    } else if (node.parentNode === parent) parent.removeChild(node);
  }
  function validActions(list) {
    return (Array.isArray(list) ? list : []).filter(function (a) {
      return a && VERBS[a.act] && typeof a.v === "string" && a.v && typeof a.label === "string" && a.label;
    }).slice(0, 3);
  }
  function setHTML(node, key, html, rec) {
    if (rec.keys[key] === html) return;
    rec.keys[key] = html;
    node.innerHTML = html;
  }
  function paint(rec) {
    rec.raf = 0;
    var s = rec.state, p = rec.p, e = rec.el, ph = s.phase;
    var working = ph === "wait" || ph === "text";
    e.setAttribute("aria-busy", working ? "true" : "false");
    var ag = Object.prototype.hasOwnProperty.call(AGENTS, s.agent) ? s.agent : "";
    if (ag) e.setAttribute("data-agent", ag); else e.removeAttribute("data-agent");
    // tag
    var tagKey = ag ? ag + "|" + (s.label || "") : "";
    if (rec.keys.tag !== tagKey) {
      rec.keys.tag = tagKey;
      p.meta.textContent = "";
      if (ag) p.meta.appendChild(el("span", "tag " + TAG_CLASS[ag], ag !== "case" && typeof s.label === "string" && s.label ? s.label : AGENTS[ag]));
    }
    vis(p.meta, !!ag);
    // steps
    var steps = Array.isArray(s.steps) ? s.steps : rec.dsteps;
    var stepsKey = steps.join("\u0001");
    if (rec.keys.steps !== stepsKey) {
      rec.keys.steps = stepsKey;
      p.stepList.textContent = "";
      steps.forEach(function (t) { p.stepList.appendChild(el("li", "", t)); });
    }
    vis(p.steps, !!steps.length);
    if (working && rec.openRun !== rec.run) { rec.openRun = rec.run; p.steps.open = true; }
    if (!working && rec.closeRun !== rec.run) { rec.closeRun = rec.run; p.steps.open = false; }
    stepsLabel(p);
    // wait indicator
    var showWait = working && !s.buf;
    vis(p.wait, showWait);
    p.waitText.textContent = showWait && s.status ? s.status : "";
    // answer text
    vis(p.body, !!s.buf);
    if (s.buf && rec.keys.buf !== s.buf) { rec.keys.buf = s.buf; p.body.innerHTML = md(s.buf); if (window.KeelFigs) window.KeelFigs.mark(p.body); }
    if (!s.buf && rec.keys.buf) { rec.keys.buf = ""; p.body.textContent = ""; }
    // error + retry
    var err = s.err && typeof s.err.text === "string" ? s.err : null;
    vis(p.error, !!err);
    p.errText.textContent = err ? err.text : "";
    var actsHTML = "";
    if (err) actsHTML = '<button type="button" class="btn" data-act="liveretry" data-id="' + esc(rec.id) + '">Try again</button>';
    else if (ph === "done") {
      actsHTML = validActions(s.actions).map(function (a) {
        return '<button type="button" class="btn" data-act="' + esc(a.act) + '" data-v="' + esc(a.v) + '">' + esc(a.label) + "</button>";
      }).join("");
    }
    setHTML(p.acts, "acts", actsHTML, rec);
    vis(p.acts, !!actsHTML);
    // the "Grounded in" footer is built by the server from the tools it called
    var grounded = ph === "done" && !err && Array.isArray(s.grounded) ? s.grounded.filter(function (g) { return typeof g === "string" && g; }) : [];
    var gTxt = grounded.length ? "Grounded in: " + grounded.join(", ") : "";
    if (rec.keys.grounded !== gTxt) { rec.keys.grounded = gTxt; p.grounded.textContent = gTxt; }
    vis(p.grounded, !!gTxt);
    refreshTools();
    afterContent();
    measure();
  }
  /* the disclosure reads "Show steps" while closed and "Hide steps" while open (set now, and again by the toggle event) */
  function stepsLabel(p) {
    var t = p.steps.open ? "Hide steps" : "Show steps";
    if (p.sumText.textContent !== t) p.sumText.textContent = t;
  }
  function schedulePaint(rec) {
    if (!rec.raf) rec.raf = requestAnimationFrame(function () { paint(rec); });
  }
  function flushPaint(rec) {
    if (rec.raf) { cancelAnimationFrame(rec.raf); rec.raf = 0; }
    paint(rec);
  }

  function buildUser(id, turn) {
    var e = el("div", "siqx-msg");
    e.setAttribute("data-role", "user");
    e.setAttribute("data-turn", id);
    var items = Array.isArray(turn.context) ? turn.context : [];
    if (items.length) {
      var row = el("div", "siqx-chips");
      items.forEach(function (it) { if (it && it.label) row.appendChild(chipEl(it, false)); });
      e.appendChild(row);
    }
    e.appendChild(el("div", "siqx-text", String(turn.q == null ? "" : turn.q)));
    return { kind: "user", id: id, el: e, q: String(turn.q == null ? "" : turn.q), turn: turn };
  }
  function buildAssistant(id, turn) {
    var e = el("div", "siqx-msg");
    e.setAttribute("data-role", "assistant");
    e.setAttribute("data-msg-id", id);
    e.setAttribute("aria-busy", "true");
    var p = {};
    p.meta = el("div", "sig-meta");
    p.steps = el("details", "siqx-steps");
    p.sum = el("summary", "siqx-sum");
    p.sumText = el("span", "siqx-sum-text", "Show steps");
    p.sum.appendChild(p.sumText);
    p.sum.insertAdjacentHTML("beforeend", ICON.chev);
    p.steps.appendChild(p.sum);
    p.steps.addEventListener("toggle", function () { stepsLabel(p); });
    p.stepList = el("ol", "siqx-steplist"); p.steps.appendChild(p.stepList);
    p.wait = el("div", "siqx-wait");
    p.wait.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    p.waitText = el("span", "small muted"); p.wait.appendChild(p.waitText);
    p.body = el("div", "siqx-body");
    p.error = el("p", "siqx-error");
    p.error.insertAdjacentHTML("afterbegin", '<span class="siqx-err-ic" aria-hidden="true">' + ICON.warn + "</span>");
    p.errText = el("span", "siqx-err-text"); p.error.appendChild(p.errText);
    p.acts = el("div", "sig-act");
    p.grounded = el("p", "small muted");
    p.foot = el("div", "siqx-foot");
    p.stopped = el("span", "siqx-stopped", "Stopped");
    p.copy = el("button", "siqx-tool", "Copy"); p.copy.type = "button"; p.copy.setAttribute("data-siqx", "copy");
    p.regen = el("button", "siqx-tool", "Regenerate"); p.regen.type = "button"; p.regen.setAttribute("data-siqx", "regen");
    var order = [p.meta, p.steps, p.wait, p.body, p.error, p.acts, p.grounded, p.foot];
    order.forEach(function (n) { n._parent = e; n._order = order; });
    var forder = [p.stopped, p.copy, p.regen];
    forder.forEach(function (n) { n._parent = p.foot; n._order = forder; });
    e.appendChild(p.wait);
    return {
      kind: "asst", id: id, el: e, p: p, turn: turn, run: 1, openRun: 0, closeRun: 0, raf: 0, keys: {}, dsteps: [], annStatus: "",
      state: { phase: "wait", buf: "", status: "", steps: null, agent: null, label: null, actions: null, grounded: null, err: null }
    };
  }
  function trim() {
    var removed = false;
    while (thread.length > CAP) {
      var r = thread.shift();
      if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
      if (r.kind === "asst") { if (r.raf) cancelAnimationFrame(r.raf); delete byId[r.id]; }
      removed = true;
    }
    if (removed && !trimmed) {
      trimmed = true;
      noteEl = el("p", "siqx-note", "Older messages trimmed");
      noteEl.setAttribute("data-siqx", "trimmed");
      log.insertBefore(noteEl, log.firstChild);
    }
  }

  /* ---------- the live.js interface: begin, patch, busy ---------- */
  function begin(turn) {
    if (!root) return null;
    turn = turn || {};
    var id = "m" + (++seq);
    var u = buildUser(id, turn), a = buildAssistant(id, turn);
    thread.push(u, a);
    byId[id] = a;
    emptyEl.hidden = true;
    dropUndo(); cancelAsk();
    log.insertBefore(u.el, tailEl); log.insertBefore(a.el, tailEl);
    trim();
    mode = "anchor";
    setExpanded(true);
    updateCount();
    paint(a);
    applyScroll();
    announce("Keel is answering");
    return id;
  }
  function patch(id, st) {
    var rec = byId[id];
    if (!rec || !st) return;
    var s = rec.state, prev = s.phase, next = st.phase || prev;
    if (next === "wait" && terminal(prev)) {
      rec.run++; rec.dsteps = []; rec.annStatus = ""; rec.agent = null; rec.agentLabel = null;
      s.buf = ""; s.err = null; s.actions = null; s.grounded = null; s.steps = null; s.status = "";
      announce("Keel is answering");
      mode = "anchor"; userT = 0; // Try again and Regenerate anchor the question like a normal send, whatever the click scrolled
    }
    for (var k in st) if (Object.prototype.hasOwnProperty.call(st, k)) s[k] = st[k];
    // the first agent of a run wins: a duplicate meta never retags a message
    if (rec.agent && s.agent !== rec.agent) { s.agent = rec.agent; s.label = rec.agentLabel; }
    else if (AGENTS[s.agent] && !rec.agent) { rec.agent = s.agent; rec.agentLabel = s.label; }
    s.phase = next;
    if (typeof st.status === "string" && st.status && st.status !== rec.annStatus && !terminal(next)) {
      rec.annStatus = st.status;
      if (rec.dsteps[rec.dsteps.length - 1] !== st.status) rec.dsteps.push(st.status);
      announce(st.status);
    }
    if (next !== prev && terminal(next)) {
      if (next === "done") { announce("Answer complete"); if (!expandedFlag) setUnread(unread + 1); }
      else if (next === "stopped") announce("Stopped");
      else if (next === "failed") announce(s.err && s.err.text ? s.err.text : "The answer failed");
    }
    if (terminal(next) || next !== prev) flushPaint(rec); else schedulePaint(rec);
  }
  function busy(flag) {
    isBusy = !!flag;
    var stop = isBusy;
    sendBtn.setAttribute("aria-label", stop ? "Stop answer" : "Send question");
    if (stop) sendBtn.setAttribute("data-state", "stop"); else sendBtn.removeAttribute("data-state");
    sendBtn.title = stop ? "Stop answer" : "Send question";
    sendBtn.innerHTML = stop ? ICON.stop : ICON.send;
    if (newBtn) { newBtn.disabled = isBusy || !thread.length; if (isBusy) cancelAsk(); }
    refreshTools();
    measureSoon();
  }

  /* ---------- submit: build the turn from page state and hand it to live.js ---------- */
  function surfaceFor(page, hasChip) {
    if (!hasChip) return "global";
    if (page === "home") return "home";
    if (page === "coach") return "coach";
    if (page === "performance") return "perf";
    return "global";
  }
  function historyFor() {
    var out = [];
    thread.forEach(function (r, i) {
      if (r.kind !== "asst" || r.state.phase !== "done" || !r.state.buf) return;
      var u = thread[i - 1];
      if (!u || u.kind !== "user") return;
      var labels = (u.turn && u.turn.chips ? u.turn.chips : []).map(function (c) { return c.label; }).join(", ");
      var content = (labels ? "Attached: " + clip(labels, 190) + "\n" : "") + u.q;
      out.push({ role: "user", content: clip(content, 4000) }, { role: "assistant", content: clip(r.state.buf, 4000) });
    });
    return out.slice(-6);
  }
  function submit(q, opts) {
    var live = Live();
    q = String(q == null ? "" : q).trim();
    if (!q || !root) return false;
    if (isBusy) { announce("Wait for the current answer or stop it"); return false; }
    var now = Date.now();
    if (lastSubmit.q === q && now - lastSubmit.t < DUP_MS) return false;
    if (!live || typeof live.ask !== "function") return false;
    var x = X(), S = x && x.S ? x.S : {};
    var sc = screenItem(), context = [];
    if (sc) context.push({ type: sc.type, id: sc.id, label: sc.label });
    /* solo: a stub button sends only its own question and context; chips attached in the composer stay attached and unsent */
    var solo = !!(opts && opts.solo), chipsNow = solo ? [] : chips();
    chipsNow.forEach(function (c) { context.push(c); });
    if (opts && Array.isArray(opts.extra)) opts.extra.forEach(function (c) { if (c && c.type && c.id) context.push(clipItem(c)); });
    context = context.slice(0, MAX_ITEMS);
    var surface = surfaceFor(S.page, !!sc);
    var turn = {
      q: q, context: context, surface: surface, screen: curScreen ? curScreen.id : "", role: S.role === "supervisor" ? "supervisor" : "agent",
      history: historyFor(), chips: chipsNow
    };
    var rn = x && x.run && x.run.state ? x.run.state.runId : null;
    if (rn) turn.runId = rn;
    if (S.page === "member" && S.params && S.params.id) turn.memberId = S.params.id;
    lastSubmit = { q: q, t: now };
    sendTs = performance.now();
    if (!solo) { ta.value = ""; autosize(); explicit = []; renderTray(); notifyAttach(); }
    mode = "anchor";
    setExpanded(true);
    try { live.ask(turn); } catch (e) { return false; }
    return true;
  }

  /* ---------- composer behaviour ---------- */
  function autosize() {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    measureSoon();
  }
  function copyText(text) {
    var done = function () { announce("Copied"); };
    var fallback = function () {
      var t = document.createElement("textarea");
      t.value = text; t.setAttribute("readonly", ""); t.className = "siqx-sr";
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      t.remove();
      if (ok) done(); else announce("Copy failed");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  function onEsc(ev) {
    if (ev.key !== "Escape" || ev.defaultPrevented) return;
    var live = Live();
    if (live && typeof live.guide === "function" && live.guide()) return; // the guide owns Esc (D19)
    for (var i = 0; i < escHooks.length; i++) { try { if (escHooks[i](ev)) return; } catch (e) { /* ignore */ } }
    if (!expandedFlag) return;
    var inside = root.contains(document.activeElement);
    if (asking) { cancelAsk(true); return; }
    setExpanded(false);
    if (inside) ta.focus();
  }

  function mount() {
    var app = $(".app");
    if (!app || document.getElementById("siqx-dock")) return;
    root = document.createElement("div");
    root.id = "siqx-dock";
    root.className = "siqx-dock";
    root.innerHTML =
      '<section id="siqx-sheet" class="siqx-sheet" data-siq-ui hidden aria-label="Conversation sheet">' +
        '<div class="siqx-grip" data-siqx="resize" role="separator" aria-orientation="horizontal" aria-label="Resize conversation" title="Resize conversation: drag, or press Up and Down" tabindex="0" aria-valuemin="120" aria-valuemax="400" aria-valuenow="200"></div>' +
        '<div class="siqx-head">' +
          '<span class="siqx-title">Keel chat</span>' +
          '<span class="siqx-count" data-siqx="count">0 messages</span>' +
          '<span class="siqx-head-gap"></span>' +
          '<span class="siqx-confirm" data-siqx="confirm" hidden><span>Clear this conversation?</span>' +
            '<button type="button" class="siqx-hbtn" data-siqx="cancel" title="Keep the conversation">Cancel</button>' +
            '<button type="button" class="siqx-hbtn" data-siqx="clear" title="Clear the conversation">Clear</button></span>' +
          '<button type="button" class="siqx-hbtn" data-siqx="undo" title="Restore the cleared conversation" hidden>Undo</button>' +
          '<button type="button" class="siqx-hbtn" data-siqx="newchat" title="Start a new conversation" disabled>New chat</button>' +
          '<span class="siqx-head-slot" data-siqx="headslot"></span>' +
        '</div>' +
        '<div id="siqx-log" class="siqx-log" role="log" aria-live="off" aria-label="Conversation" tabindex="0">' +
          '<p class="siqx-empty">No messages yet.</p>' +
          '<div class="siqx-tail" aria-hidden="true"></div>' +
        '</div>' +
        '<button type="button" class="siqx-jump" data-siqx="jump" hidden>' + ICON.down + '<span>Jump to latest</span></button>' +
      '</section>' +
      '<div class="siqx-pill" data-siq-ui data-siqx="pillslot" hidden></div>' +
      '<div class="siqx-composer" data-siq-ui>' +
        '<div class="siqx-tray" data-siqx="tray" role="group" aria-label="Context for your question" hidden></div>' +
        '<div class="siqx-row">' +
          '<textarea id="siqx-q" class="siqx-input" rows="1" placeholder="" aria-label=""></textarea>' +
          '<button type="button" class="siqx-btn siqx-send" data-siqx="send" aria-label="Send question" title="Send question">' + ICON.send + '</button>' +
        '</div>' +
        '<div id="siqx-status" class="siqx-sr" role="status"></div>' +
      '</div>';
    app.appendChild(root);
    noteEl = document.getElementById("demo-note"); // the shell's one disclosure line (index.html) rides in the dock's bottom row, always in view
    if (noteEl) root.appendChild(noteEl);
    sheet = $("#siqx-sheet", root); log = $("#siqx-log", root); ta = $("#siqx-q", root); tray = $('[data-siqx="tray"]', root);
    sendBtn = $('[data-siqx="send"]', root);
    headSlot = $('[data-siqx="headslot"]', root); pillSlot = $('[data-siqx="pillslot"]', root);
    toggleBtn = el("button", "siqx-hbtn siqx-toggle");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("data-siqx", "toggle");
    toggleBtn.setAttribute("aria-controls", "siqx-sheet");
    toggleBtn.innerHTML = ICON.up;
    toggleLabel = el("span", "siqx-tlabel", "Collapse");
    pillEl = el("span", "siqx-new", "");
    pillEl.setAttribute("data-siqx", "unread");
    pillEl.hidden = true;
    toggleBtn.appendChild(toggleLabel); toggleBtn.appendChild(pillEl);
    pillSlot.appendChild(toggleBtn);
    grip = $('[data-siqx="resize"]', root); countEl = $('[data-siqx="count"]', root); newBtn = $('[data-siqx="newchat"]', root);
    confirmEl = $('[data-siqx="confirm"]', root); undoBtn = $('[data-siqx="undo"]', root); tailEl = $(".siqx-tail", root);
    try { var sv = parseInt(sessionStorage.getItem(SHEET_KEY), 10); if (sv > 0) userH = sv; } catch (e) { /* storage blocked */ }
    statusEl = $("#siqx-status", root); jumpBtn = $('[data-siqx="jump"]', root); emptyEl = $(".siqx-empty", root);

    // composer
    ta.addEventListener("input", autosize);
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        submit(ta.value);
      } else if (ev.key === "Backspace" && ta.value === "" && explicit.length && !ev.isComposing) {
        ev.preventDefault();
        var last = explicit[explicit.length - 1];
        detach(last.type, last.id);
      }
    });
    sendBtn.addEventListener("click", function (ev) {
      var live = Live();
      if (isBusy) {
        // the second click of a double-click on Send lands on Stop: ignore a Stop within 400 ms of the send
        if (ev.timeStamp - sendTs < 400) { ta.focus(); return; }
        if (live && typeof live.stop === "function") live.stop();
        ta.focus();
        return;
      }
      submit(ta.value);
      ta.focus();
    });
    toggleBtn.addEventListener("click", function () { setExpanded(!expandedFlag); });
    newBtn.addEventListener("click", askClear);
    confirmEl.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest("[data-siqx]") : null;
      if (!b) return;
      if (b.getAttribute("data-siqx") === "cancel") cancelAsk(true);
      else if (b.getAttribute("data-siqx") === "clear") clearThread();
    });
    undoBtn.addEventListener("click", undoClear);

    // resize handle: drag, or Up and Down (Home and End jump to the limits)
    grip.addEventListener("pointerdown", function (ev) {
      if (ev.button) return;
      ev.preventDefault();
      try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* no capture */ }
      drag = { y: ev.clientY, h: sheet.getBoundingClientRect().height };
    });
    grip.addEventListener("pointermove", function (ev) { if (drag) setUserH(drag.h + (drag.y - ev.clientY)); });
    var endDrag = function () { if (drag) { drag = null; saveH(); } };
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);
    grip.addEventListener("lostpointercapture", endDrag);
    grip.addEventListener("keydown", function (ev) {
      var cur = sheet.getBoundingClientRect().height, to = null;
      if (ev.key === "ArrowUp") to = cur + KEY_STEP;
      else if (ev.key === "ArrowDown") to = cur - KEY_STEP;
      else if (ev.key === "PageUp") to = cur + 3 * KEY_STEP;
      else if (ev.key === "PageDown") to = cur - 3 * KEY_STEP;
      else if (ev.key === "Home") to = capH;
      else if (ev.key === "End") to = SHEET_MIN;
      if (to == null) return;
      ev.preventDefault();
      setUserH(to);
      saveH();
    });
    tray.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".siqx-chip-x") : null;
      if (!b) return;
      var chip = b.closest(".siqx-chip");
      detach(chip.getAttribute("data-type"), chip.getAttribute("data-id"));
      ta.focus();
    });

    // log: pinning, jump, message actions
    log.addEventListener("wheel", function (ev) { userT = Date.now(); if (ev.deltaY < 0) unpin(); }, { passive: true });
    log.addEventListener("pointerdown", function () { dragging = true; userT = Date.now(); });
    var endScrollDrag = function () { dragging = false; };
    document.addEventListener("pointerup", endScrollDrag);
    document.addEventListener("pointercancel", endScrollDrag);
    var touchY = 0;
    log.addEventListener("touchstart", function (ev) { userT = Date.now(); touchY = ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0; }, { passive: true });
    log.addEventListener("touchmove", function (ev) {
      var y = ev.touches && ev.touches[0] ? ev.touches[0].clientY : touchY;
      if (y > touchY) unpin();
      touchY = y;
    }, { passive: true });
    log.addEventListener("keydown", function (ev) {
      userT = Date.now();
      if (ev.key === "ArrowUp" || ev.key === "PageUp" || ev.key === "Home" || (ev.key === " " && ev.shiftKey)) unpin();
    });
    log.addEventListener("scroll", function () {
      // a scroll the user made ends anchoring: at the end it follows the stream, anywhere else it stays put
      if (dragging || Date.now() - userT < USER_MS) mode = dist() <= PIN_PX ? "follow" : "free";
      syncJump();
    });
    jumpBtn.addEventListener("click", function () { scrollBottom(); ta.focus(); });
    log.addEventListener("click", function (ev) {
      var nav = ev.target.closest ? ev.target.closest(".sig-act [data-act]") : null;
      if (nav && NAV_ACTS[nav.getAttribute("data-act")] === 1 && expandedFlag) {
        // the page's own handler (on document) still runs the action after this; the thread and any stream stay as they are
        setExpanded(false);
        ta.focus();
        announce("Conversation collapsed");
        return;
      }
      var t = ev.target.closest ? ev.target.closest("[data-siqx]") : null;
      if (!t) return;
      var msg = t.closest(".siqx-msg"), id = msg ? msg.getAttribute("data-msg-id") : null, rec = id ? byId[id] : null;
      var kind = t.getAttribute("data-siqx");
      if (kind === "copy" && rec) copyText(plainText(rec));
      else if (kind === "regen" && rec) {
        var live = Live();
        if (!isBusy && live && typeof live.regenerate === "function") { mode = "anchor"; live.regenerate(id); ta.focus(); }
      }
    });

    document.addEventListener("keydown", onEsc);
    document.addEventListener("siq:render", refresh);
    document.addEventListener("siq:run", function (ev) { var r = ev && ev.detail && ev.detail.reason; if (r === "panel") requestAnimationFrame(onPanelChange); });
    try { /* the two sheets are shown and hidden with the hidden attribute, whoever draws them */
      new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) { var t = recs[i].target; if (t && (t.id === "why-sheet" || t.id === "audit-sheet")) { onPanelChange(); return; } }
      }).observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    } catch (e) { /* no observer */ }
    var main = $("#main");
    if (main) {
      try { new MutationObserver(function () { refresh(); }).observe(main, { childList: true }); } catch (e) { /* no observer */ }
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () { measureSoon(); });
        ro.observe(main); ro.observe(root);
      }
    }
    window.addEventListener("resize", measureSoon);
    /* the suggestions open when the composer takes focus and stay while focus is anywhere in the dock; focus on Point or Send alone must not move the row under the press (final review P0) */
    root.addEventListener("focusin", function (ev) { if (ev.target === ta) root.setAttribute("data-sugg", ""); measureSoon(); });
    root.addEventListener("focusout", function (ev) { if (!ev.relatedTarget || !root.contains(ev.relatedTarget)) root.removeAttribute("data-sugg"); measureSoon(); });
    refresh();
    updateCount();
    busy(false);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureSoon);
  }

  window.KeelChat = {
    submit: submit,
    begin: begin,
    patch: patch,
    busy: busy,
    attach: attach,
    detach: detach,
    chips: chips,
    expand: function () { setExpanded(true); },
    collapse: function () { setExpanded(false); },
    expanded: function () { return expandedFlag; },
    /* the guide asks for px of page above the dock for its step card; 0 releases it. The sheet is capped to leave them */
    reserve: function (px) { px = Math.max(0, Math.round(Number(px) || 0)); if (px !== reserveH) { reserveH = px; if (root) measure(); } },
    /* the guide asks the sheet to bring one of its elements into view and keep it there: the log stops re-pinning to the latest
       question until the next send. A view call, never a request. Returns false when the node is not in the log. */
    reveal: function (node) {
      if (!node || !log || !expandedFlag || !log.contains(node)) return false;
      var lr = log.getBoundingClientRect(), nr = node.getBoundingClientRect(), gap = 8;
      mode = "free"; userT = 0;
      if (nr.height + 2 * gap > lr.height || nr.top < lr.top + gap) log.scrollTop += nr.top - lr.top - gap;
      else if (nr.bottom > lr.bottom - gap) log.scrollTop += nr.bottom - lr.bottom + gap;
      syncJump();
      return true;
    },
    message: function (id) { var r = byId[id]; return r && expandedFlag && r.el.parentNode ? r.el : null; },
    onAttachChange: function (fn) { if (typeof fn === "function") attachListeners.push(fn); },
    onEscape: function (fn) { if (typeof fn === "function") escHooks.push(fn); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
