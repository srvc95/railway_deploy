/* Copied from keel-prototype v1.2.3 public/live.js (the ask half), adapted for adopt-keel-shell. Loaded as a module; it sets window.KeelLive exactly as live.js did. */
/* Keel live wiring: the transport between the chat sheet (chat.js) and POST /api/ask.
   It owns the network, the watchdogs, the SSE parser, validation of actions and sources, and the siqlive events.
   It never touches the page: every change reaches the thread through KeelChat.patch(id, state). */
(function () {
  "use strict";
  var X = window.__siq;
  var AGENTS = { "case": 1, coach: 1, audit: 1 };
  var VERBS = { page: 1, member: 1, why: 1 }; /* the dock only navigates: it never runs a step, approves or sends */
  var SENTENCE = {
    timeout: "Keel could not reach the agent in time.",
    busy: "The agent is busy right now.",
    unreachable: "Keel cannot reach its server. Make sure it is still running.",
    cap: "Keel has reached its spending limit for today.",
    config: "The agent is not configured correctly.",
    cut: "Answer interrupted."
  };
  var PAGES_OK = { home: 1, members: 1, plans: 1, coach: 1, performance: 1, crm: 1, rules: 1 };
  var MEMBER_OK = /^(ben-hayes|sample-m-\d{1,3})$/;
  var IDLE_MS = 45000, TOTAL_MS = 90000; // heartbeats arrive every 15 s; the server's own total watchdog is 75 s
  var RETRY_WINDOW_MS = 45000, RECONNECT = "Reconnecting to the agent"; // silent resubmits before the error card
  /* delays of the silent resubmits (one entry per retry); a test may set window.__siqRetryMs to a shorter list or [] */
  /* Evidence that cannot be lost: every failure is kept in sessionStorage ("siq.errors", last 20) and written to the console,
     so a later look at the console or KeelLive.errors() says which kind it was, for which URL, and when. No question text. */
  function note(m, kind, detail) {
    var rec = { t: new Date().toISOString(), kind: kind, url: location.origin + "/api/ask", attempt: (m && m.tries || 0) + 1, status: detail && detail.status || null, why: detail && detail.why || "" };
    try { console.warn("[keel] " + kind + " " + JSON.stringify(rec)); } catch (e) { /* no console */ }
    try {
      var list = JSON.parse(window.sessionStorage.getItem("siq.errors") || "[]");
      if (!Array.isArray(list)) list = [];
      list.push(rec);
      window.sessionStorage.setItem("siq.errors", JSON.stringify(list.slice(-20)));
    } catch (e) { /* blocked storage: the console line remains */ }
  }
  function errors() {
    try { var l = JSON.parse(window.sessionStorage.getItem("siq.errors") || "[]"); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function retryDelays() {
    var c = window.__siqRetryMs;
    if (Array.isArray(c) && c.length <= 4 && c.every(function (n) { return typeof n === "number" && n >= 0 && n <= 10000; })) return c;
    return [1500, 3000];
  }
  var inflight = null, last = null, msgs = {};

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : null; }
  function chat() { return window.KeelChat || null; }

  /* ---------- markdown: marked, then DOMPurify with an allowlist (p, ul, ol, li, b, a) ---------- */
  var md = null, wrapStyle = "overflow-wrap:anywhere";
  function initMarkdown() {
    if (md || !window.marked || !window.DOMPurify) return;
    var para = function (inner) { return "<p>" + inner + "</p>\n"; };
    md = new window.marked.Marked({
      gfm: true,
      renderer: {
        heading: function (t) { return para("<b>" + this.parser.parseInline(t.tokens) + "</b>"); },
        strong: function (t) { return "<b>" + this.parser.parseInline(t.tokens) + "</b>"; },
        html: function () { return ""; },
        hr: function () { return ""; },
        image: function (t) { return esc(t.text || ""); },
        code: function (t) { return para(esc(t.text)); },
        table: function (t) {
          var self = this;
          var row = function (cells) { return para(cells.map(function (c) { return self.parser.parseInline(c.tokens); }).join(" | ")); };
          return row(t.header) + t.rows.map(row).join("");
        },
        link: function (t) {
          var href = safeUrl(t.href), inner = this.parser.parseInline(t.tokens);
          return href ? '<a class="link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + inner + "</a>" : inner;
        }
      }
    });
    window.DOMPurify.addHook("afterSanitizeAttributes", function (n) {
      var tag = n.tagName;
      if (tag === "A") { n.setAttribute("class", "link"); n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
      if (tag === "A" || tag === "P" || tag === "LI") n.setAttribute("style", wrapStyle);
      if (tag === "OL") n.setAttribute("style", "margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px");
    });
  }
  function mdHTML(text) {
    initMarkdown();
    if (!md) return "<p>" + esc(text) + "</p>";
    // an email draft: the header lines and the sign-off are separate lines, but Markdown joins single line breaks
    text = text.replace(/^((?:To|From|Cc|Bcc|Subject):[^\n]*)\n(?=\S)/gim, "$1\n\n")
      .replace(/^((?:Best|Best regards|Kind regards|Regards|Thanks|Thank you|Cheers|Sincerely),?)\n(?=\S)/gim, "$1\n\n");
    return window.DOMPurify.sanitize(md.parse(text), {
      ALLOWED_TAGS: ["p", "ul", "ol", "li", "b", "a"],
      ALLOWED_ATTR: ["href", "class", "target", "rel"],
      ALLOWED_URI_REGEXP: /^https?:/i
    });
  }

  /* ---------- validation of what the model proposes ---------- */
  function targetOk(a) {
    if (a.act === "page") return !!PAGES_OK[a.v];
    if (a.act === "member") return MEMBER_OK.test(a.v);
    return a.act === "why" && /^[\w.-]{1,80}$/.test(a.v);
  }
  function validActions(m) {
    return (m.actions || []).filter(function (a) {
      return a && VERBS[a.act] && typeof a.v === "string" && a.v && typeof a.label === "string" && a.label && targetOk(a);
    }).slice(0, 3);
  }
  /* ---------- state handed to chat.js (a fresh snapshot per patch) ---------- */
  function snapshot(m) {
    return {
      phase: m.phase, buf: m.buf, status: m.status, steps: m.steps.slice(), agent: m.agent, label: m.label,
      actions: validActions(m),
      grounded: Array.isArray(m.grounded) ? m.grounded.filter(function (g) { return typeof g === "string"; }) : null,
      err: m.err ? { kind: m.err.kind, text: m.err.text } : null,
      cost: m.cost
    };
  }
  function push(m) {
    var c = chat();
    if (c && typeof c.patch === "function") { try { c.patch(m.id, snapshot(m)); } catch (e) { /* the sheet can never break streaming */ } }
  }
  function flush(m) { if (m.raf) { cancelAnimationFrame(m.raf); m.raf = 0; } push(m); }
  function schedule(m) {
    if (!m.raf) m.raf = requestAnimationFrame(function () { m.raf = 0; push(m); });
  }
  function setBusy(v) {
    var c = chat();
    if (c && typeof c.busy === "function") { try { c.busy(v); } catch (e) { /* ignore */ } }
  }

  /* ---------- lifecycle events (siqlive) and locate: read-only hooks for the opt-in guide; no answer text ---------- */
  function emit(m, phase) {
    try {
      document.dispatchEvent(new CustomEvent("siqlive", { detail: {
        id: m.id, surface: m.surface, screen: m.screen || null, q: m.q, phase: phase, agent: m.agent || null, label: m.label || null,
        status: m.status || "", grounded: Array.isArray(m.grounded) ? m.grounded.filter(function (g) { return typeof g === "string"; }) : [],
        costUsd: typeof m.cost === "number" ? m.cost : null,
        actions: validActions(m).length, errKind: m.err ? m.err.kind || null : null
      } }));
    } catch (e) { /* a listener can never affect streaming */ }
  }
  function locate(id) {
    var c = chat();
    if (!msgs[id] || !c || typeof c.message !== "function") return null;
    try { return c.message(id) || null; } catch (e) { return null; }
  }

  /* ---------- requests ---------- */
  function sentenceFor(kind, message) {
    if (kind === "input") return message === "Please shorten your question." ? message : "Keel could not use that question. Please rephrase it.";
    if (kind === "config" && typeof message === "string" && message && message.length < 240) return message; /* demo-polish: the server names what is wrong (key, model access) */
    return SENTENCE[kind] || SENTENCE.busy;
  }
  function over(m) { return m.phase === "done" || m.phase === "failed" || m.phase === "stopped"; }
  /* A failure before any text (timeout or busy) is retried quietly: the same request again, up to twice, only while the
     whole try is still young. The status line says so. Anything else, or any failure after text, shows the card. */
  function retryable(m, kind) {
    var max = kind === "unreachable" ? 1 : retryDelays().length; // an unreachable server gets one quiet retry
    return !m.buf && (kind === "timeout" || kind === "busy" || kind === "unreachable") && m.tries < Math.min(max, retryDelays().length) && Date.now() - m.t0 < RETRY_WINDOW_MS;
  }
  function retryLater(m) {
    var delay = retryDelays()[m.tries];
    m.tries++;
    m.att++; // everything the old attempt still delivers is ignored
    clearTimeout(m.idle); clearTimeout(m.cap); clearTimeout(m.retryT);
    if (m.ac) { try { m.ac.abort(); } catch (e) { /* already closed */ } m.ac = null; }
    m.phase = "wait"; m.buf = ""; m.err = null; m.status = RECONNECT;
    if (m.steps[m.steps.length - 1] !== RECONNECT) m.steps.push(RECONNECT);
    schedule(m); emit(m, "status");
    clearTimeout(m.retryT);
    m.retryT = setTimeout(function () { if (inflight === m && m.phase === "wait") attempt(m); }, delay);
  }
  function fail(m, kind, message, cut) {
    if (over(m)) return;
    if (cut && m.buf) kind = "interrupted"; // text was shown and then the stream ended: neither a timeout nor an unreachable server
    note(m, kind, { why: cut ? "stream ended or went idle" : "server error event" });
    if (retryable(m, kind)) { retryLater(m); return; }
    m.phase = "failed";
    m.err = { kind: kind, text: cut && m.buf ? SENTENCE.cut : sentenceFor(kind, message) };
    finish(m);
    emit(m, "failed");
  }
  function finish(m) {
    clearTimeout(m.idle); clearTimeout(m.cap);
    if (m.ac) { try { m.ac.abort(); } catch (e) { /* already closed */ } m.ac = null; }
    var mine = inflight === m;
    if (mine) inflight = null;
    flush(m); // synchronous: the sheet shows the final state before the siqlive event
    if (mine) setBusy(false);
  }
  function stop() {
    var m = inflight;
    if (!m || over(m)) return false;
    m.phase = "stopped";
    finish(m);
    emit(m, "stopped");
    return true;
  }
  function handle(m, ev, data) {
    if (over(m)) return;
    if (ev === "meta") {
      if (m.agent) return; // the first meta wins; a later one is ignored
      if (data && AGENTS[data.agent]) m.agent = data.agent;
      if (data && typeof data.label === "string") m.label = data.label;
      schedule(m); emit(m, "meta");
    }
    else if (ev === "status") {
      if (data && typeof data.text === "string") {
        m.status = data.text;
        if (data.text && m.steps[m.steps.length - 1] !== data.text) m.steps.push(data.text);
      }
      schedule(m); emit(m, "status");
    }
    else if (ev === "delta") {
      if (data && typeof data.text === "string") m.buf += data.text;
      if (m.phase === "wait" && m.buf) m.phase = "text";
      schedule(m);
      if (!m.texted && m.buf) { m.texted = true; emit(m, "text"); }
    }
    else if (ev === "reset") { // the server restarted a cut stream: forget the partial text
      m.buf = ""; m.phase = "wait"; m.status = RECONNECT;
      schedule(m);
    }
    else if (ev === "actions") m.actions = Array.isArray(data) ? data : null;
    else if (ev === "done") {
      if (!m.buf.trim()) { fail(m, "timeout", "", false); return; } // an empty answer is a failure, never an endless indicator
      m.grounded = data && data.groundedIn; m.phase = "done";
      m.cost = data && typeof data.costUsd === "number" ? data.costUsd : null;
      finish(m); emit(m, "done");
    }
    else if (ev === "error") { var ek = data && data.kind; fail(m, ek, data && data.message, !!m.buf && (ek === "timeout" || ek === "busy")); } // an error after text is an interruption, not a failure to connect
  }
  function parser(m, stale) {
    var buf = "";
    return function (chunk) {
      if (stale && stale()) return;
      buf += chunk.replace(/\r\n/g, "\n");
      var i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        var block = buf.slice(0, i), ev = "message", data = [];
        buf = buf.slice(i + 2);
        block.split("\n").forEach(function (line) {
          if (line.charAt(0) === ":") return;
          if (line.indexOf("event:") === 0) ev = line.slice(6).trim();
          else if (line.indexOf("data:") === 0) data.push(line.slice(5).replace(/^ /, ""));
        });
        if (!data.length) continue;
        var parsed;
        try { parsed = JSON.parse(data.join("\n")); } catch (e) { continue; }
        if (stale && stale()) return; // an earlier frame of this chunk started a silent retry
        try { handle(m, ev, parsed); } catch (e) { /* one bad frame must not kill the stream */ }
      }
    };
  }
  function start(m) {
    m.tries = 0; m.att = m.att || 0; m.t0 = Date.now();
    m.steps = []; m.texted = false;
    inflight = m;
    setBusy(true);
    attempt(m, true);
  }
  function attempt(m, first) {
    var mine = m.att = (m.att || 0) + 1, stale = function () { return m.att !== mine; };
    m.phase = "wait"; m.buf = ""; m.err = null; m.actions = null; m.grounded = null;
    m.agent = null; m.label = null; m.cost = null;
    if (first) m.status = "";
    var ac = new AbortController();
    m.ac = ac;
    push(m);
    if (first) emit(m, "start");
    var feed = parser(m, stale);
    var touch = function () { clearTimeout(m.idle); m.idle = setTimeout(function () { if (!stale()) fail(m, "timeout", "", true); }, IDLE_MS); };
    touch();
    clearTimeout(m.cap);
    m.cap = setTimeout(function () { if (!stale()) fail(m, "timeout", "", true); }, TOTAL_MS);
    fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m.req), signal: ac.signal })
      .then(function (res) {
        if (stale()) { try { if (res.body) res.body.cancel(); } catch (e) { /* closed */ } return; }
        if (!res.ok) {
          return res.json().catch(function () { return null; }).then(function (j) {
            var e = j && j.error, kind = e && e.kind;
            if (res.status === 400) kind = "input";
            else if (res.status === 401 || res.status === 403) kind = "config";
            else if (!kind || !SENTENCE[kind]) kind = "busy";
            if (!stale()) fail(m, kind, e && e.message, false);
          });
        }
        var reader = res.body.getReader(), dec = new TextDecoder();
        var pump = function () {
          return reader.read().then(function (r) {
            if (over(m) || stale()) { try { reader.cancel(); } catch (e) { /* closed */ } return; }
            touch();
            if (r.done) { feed(dec.decode()); if (!over(m) && !stale()) fail(m, "timeout", "", true); return; }
            feed(dec.decode(r.value, { stream: true }));
            return pump();
          });
        };
        return pump();
      })
      .catch(function (e) { if (!stale() && !over(m)) { note(m, "fetch-failed", { why: String(e && e.name || "error") }); fail(m, "unreachable", "", true); } });
  }

  /* ---------- entry points ---------- */
  function ask(turn) {
    if (!X) X = window.__siq;
    var c = chat();
    if (!turn || !c || typeof c.begin !== "function") return false;
    var q = String(turn.q || "").trim();
    if (!q || inflight) return false;
    var now = Date.now();
    if (last && last.q === q && now - last.t < 1500) return false;
    last = { q: q, t: now };
    var req = { surface: turn.surface, q: q, role: turn.role };
    if (turn.runId) req.runId = turn.runId;
    if (turn.memberId) req.memberId = turn.memberId;
    req.history = Array.isArray(turn.history) ? turn.history : [];
    if (Array.isArray(turn.context) && turn.context.length) req.context = turn.context;
    var id = c.begin(turn);
    if (!id) return false;
    var m = { id: id, surface: turn.surface, screen: turn.screen || null, q: q, req: req, turn: turn,
      phase: "wait", buf: "", status: "", steps: [] };
    msgs[id] = m;
    start(m);
    return true;
  }
  function regenerate(id) {
    var m = msgs[id];
    if (!m || inflight) return false;
    last = { q: m.q, t: Date.now() };
    if (m.raf) { cancelAnimationFrame(m.raf); m.raf = 0; }
    start(m);
    return true;
  }
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-act="liveretry"]') : null;
    if (el) { ev.stopPropagation(); regenerate(el.dataset.id); }
  }, true);

  window.KeelLive = { errors: errors, ask: ask, locate: locate, stop: stop, regenerate: regenerate, md: mdHTML };
})();
