/* Copied from keel-prototype v1.2.3 public/ux/chat-figs.js, adapted for adopt-keel-shell */
/* polish-chat-sheet: key figures stand out in chat answers. window.KeelFigs.mark(root) wraps money, percentages, multiples,
   scores and counted units of the text nodes under root in span.siqx-fig. It runs after markdown sanitising, only adds spans (the
   text content never changes), skips code, links, buttons and inputs, and is safe to run again on the same tree. */
(function () {
  "use strict";
  var NUM = "\\d[\\d,]*(?:\\.\\d+)?";
  var MONEY = "-?\\$" + NUM + "[KMBkmb]?(?:\\s(?:million|billion|thousand)(?![\\w]))?(?:\\s?[\\u2013\\u2014-]\\s?\\$?" + NUM + "[KMBkmb]?)?(?![\\w$])";
  var PCT = NUM + "%(?!\\w)";
  var MULT = "\\d+(?:\\.\\d+)?x(?![\\w])";
  var SCORE = "\\d{1,3}\\/100(?![\\w\\/])";
  var UNITS = "(?:days?|plans?|drugs?|prescriptions?|rules?|weeks?|months?|steps?|fills?)";
  var COUNT = "\\d+(?:,\\d{3})*\\s" + UNITS + "(?![\\w])";
  // a figure never starts inside a word, an id, a url or a longer number
  var RE = new RegExp("(?<![\\w.\\/$-])(?:" + MONEY + "|" + SCORE + "|" + PCT + "|" + MULT + "|" + COUNT + ")", "g");
  var SKIP = "pre,code,b,strong,a,button,input,textarea,select,script,style,.siqx-fig,[data-siqx]";

  /* [{ text, fig }] segments of one string; the texts join back to the input */
  function split(text) {
    var out = [], last = 0, m;
    text = String(text == null ? "" : text);
    RE.lastIndex = 0;
    while ((m = RE.exec(text))) {
      if (!m[0]) { RE.lastIndex++; continue; }
      if (m.index > last) out.push({ text: text.slice(last, m.index), fig: false });
      out.push({ text: m[0], fig: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), fig: false });
    return out;
  }

  function mark(root) {
    if (!root || !root.ownerDocument) return;
    var doc = root.ownerDocument, nodes = [], w = doc.createTreeWalker(root, 4, null), n;
    while ((n = w.nextNode())) {
      var p = n.parentNode;
      if (!p || (p.closest && p.closest(SKIP))) continue;
      if (/[0-9]/.test(n.nodeValue)) nodes.push(n);
    }
    nodes.forEach(function (t) {
      var parts = split(t.nodeValue);
      if (!parts.some(function (s) { return s.fig; })) return;
      var frag = doc.createDocumentFragment();
      parts.forEach(function (s) {
        if (!s.fig) { frag.appendChild(doc.createTextNode(s.text)); return; }
        var e = doc.createElement("span");
        e.className = "siqx-fig";
        e.textContent = s.text;
        frag.appendChild(e);
      });
      t.parentNode.replaceChild(frag, t);
    });
  }

  window.KeelFigs = { split: split, mark: mark };
})();
