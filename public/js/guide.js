// Guided tour for the Keel shell (change polish-and-realism, task TOUR.2; design: notes/tour-redesign.md section 7).
// A short, linear tutorial: 10 stops in three acts named after the closing line (Grounded, Governed, Preserved). Every stop is one idea and one
// viewer action ("Your turn"): the guide rings the real control, waits for the run event the press causes, shows the result in the past tense and
// then enables Next. It never presses a product control, never sends a request, never writes to the run and never advances by itself.
// Next and Back only set the target stop's VIEW: the route hash, whether the Why sheet is open, and what is scrolled into view.
// Texts come from guide-script.json; nothing is generated. The toggle is invisible: `?guide=1`, `?guide=0`, Alt+G (not while typing) or Ctrl+Alt+G.
import { h, setChildren } from './dom.js';
import { ACTOR_LABEL } from './steps.js';
import { CHECK } from '../ui/icons.js';
import { llmFor, recommendation, stepStatus } from './state.js';
import { showWhy } from './views-why.js';

const MARGIN = 12, GAP = 12, POP_W = 380, AUDIT_SHEET_W = 560, WHY_SHEET_W = 680;
/** The ring is a 2 px outline 6 px outside its box (guide.css): 8 px of the page it draws on. The beak and the gap to a ringed element are measured from the outline, not the box. */
const RING_OUT = 8, BEAK = 10, POINT_GAP = RING_OUT + BEAK + 4;
const ACT_NAME = ['Prepared', 'Governed', 'Preserved'];
/** The Signal step whose model call a run step ends, for the fallback note. */
const LLM_OF = /** @type {Record<string, string>} */ ({ 'signal.interpret': 'signal.interpret', 'action.gate': 'action.draft', 'decision.next-action': 'signal.reply-interpret' });

/**
 * The popover text of a stop. `{gateHeadline}` becomes the headline the server wrote for the gate step that stop is about (`gateStep`; without one, the
 * latest gate step that is done), verbatim. Until that gate has run, the sentence that holds the token is left out, so a viewer never reads a placeholder.
 * @param {string} body @param {{ steps: Record<string, { status: string, headline?: string }> }} st @param {string} [gateStep]
 */
export function bodyText(body, st, gateStep) {
  if (!body.includes('{gateHeadline}')) return body;
  const ids = gateStep ? [gateStep] : ['action.gate-recheck', 'action.gate'];
  const done = ids.map((id) => st.steps[id]).find((x) => x?.status === 'done' && x.headline);
  if (done) return body.split('{gateHeadline}').join(/** @type {string} */ (done.headline));
  return body.split(/(?<=[.?])\s+/).filter((x) => !x.includes('{gateHeadline}')).join(' ');
}

/** @typedef {{ x: number, y: number, w: number, h: number, ctl?: boolean }} Box a `ctl` box is a control (button, link, field, tab), not a line of text */
/** @param {Box} a @param {Box} b */
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** @param {Box} r @param {number} g */
const grow = (r, g) => ({ x: r.x - g, y: r.y - g, w: r.w + 2 * g, h: r.h + 2 * g });

/**
 * Where a zone puts the popover's top-left corner. Zones are corners of the content column (notes/tour-redesign.md 7.3), so a stop's popover keeps one place
 * for its whole stop. Pure.
 * @param {string} zone
 * @param {{ pop: { w: number, h: number }, vp: { w: number, h: number }, content: { x0: number, x1: number }, dockTop: number, headerBottom: number, controlsBottom: number, tilesBottom?: number, tabsBottom?: number, target?: Box | null }} g
 * @returns {{ x: number, y: number } | null}
 */
export function zonePoint(zone, g) {
  const { pop, content: c } = g;
  switch (zone) {
    case 'right-of-target': return g.target ? { x: Math.max(g.target.x + g.target.w + GAP, c.x1 - pop.w), y: g.target.y } : null; // flush with the right edge of the column, so no text of the cards under it peeks out on that side
    case 'rail-lower': return { x: c.x1 - pop.w, y: g.dockTop - 8 - pop.h };
    case 'rail-upper': return { x: c.x1 - pop.w, y: g.headerBottom + 16 };
    case 'under-tabs': return { x: c.x1 - pop.w, y: (g.tabsBottom ?? g.headerBottom) + GAP }; // the right column below the page's tabs: Performance before the report is open
    case 'main-lower-left': return { x: c.x0, y: g.dockTop - 8 - pop.h };
    case 'top-right-under-header': return { x: c.x1 - pop.w, y: g.controlsBottom + 11 };
    case 'top-right': return { x: c.x1 - pop.w, y: MARGIN };
    case 'left-of-sheet': return { x: g.vp.w - Math.min(AUDIT_SHEET_W, g.vp.w) - GAP - pop.w, y: Math.max(g.tilesBottom ?? g.headerBottom, g.tabsBottom ?? 0) + GAP }; // left of the 560 px audit report sheet, under the page's tiles and tabs (the page's controls are at the bottom there)
    default: return null;
  }
}

/**
 * Pure placement: where the popover goes so it stays inside the viewport and covers neither the target nor the dock.
 * `prefer` (the stop's zone) is tried first. From there it moves up or down in steps of 2 px, and may grow by up to 24 px (up or down, so its edge stays where it was),
 * to the nearest spot where neither its top nor its bottom edge cuts a line of text across its height (`lines`: the text lines of the page under it). `keep` boxes
 * (the controls the stop asks for, the sidebar) are kept clear first; `lines` are given up next, then `clear` (the ringed element's own card), then `keep`. `panels`
 * (an open Why or audit sheet) are never given up: when no side fits, the last candidate is the bottom of the main column, left of the panel. A side next to the
 * target leaves room for the ring's outline and the beak. The result carries `h` when the popover has to be taller than `pop.h`.
 * `alts` are other zone points tried the same way when the zone itself has no room (the rail is full below the approval card: the lower left of the column is next).
 * @param {{ target: Box | null, pop: { w: number, h: number }, vp: { w: number, h: number }, dock?: Box | null, top?: number, clear?: Box | null, keep?: Box[], panels?: Box[], lines?: Box[], prefer?: { x: number, y: number } | null, alts?: { x: number, y: number }[] }} o
 * @returns {{ x: number, y: number, side: string, h?: number }}
 */
export function place(o) {
  let r = placeAt(o);
  if (r.side !== 'fallback') return r;
  if (o.lines?.some((l) => l.ctl)) { r = placeAt({ ...o, lines: o.lines.filter((l) => !l.ctl) }); if (r.side !== 'fallback') return r; } // controls are given up before lines of text
  if (o.lines?.length) { r = placeAt({ ...o, lines: [] }); if (r.side !== 'fallback') return r; }
  if (o.clear) { r = placeAt({ ...o, lines: [], clear: null }); if (r.side !== 'fallback') return r; }
  if (o.keep?.length) { r = placeAt({ ...o, lines: [], clear: null, keep: [] }); if (r.side !== 'fallback') return r; }
  if (o.panels?.length) {
    // the panel leaves only the main column and the target fills it: the popover may cover the target but still covers every line whole or not at all, and keeps clear of the controls it can (final review 7.9, stop 6 after Resume)
    for (const relax of [{ clear: null }, { clear: null, keep: [] }]) { const r2 = placeAt({ ...o, target: null, ...relax }); if (r2.side === 'zone') return r2; }
    // never over a panel: beside it at the bottom of the main column, even where that covers the target
    const px = Math.min(...o.panels.map((b) => b.x)), maxX = o.vp.w - MARGIN - o.pop.w, maxY = o.vp.h - MARGIN - o.pop.h;
    return { x: clamp(px - GAP - o.pop.w, MARGIN, maxX), y: clamp((o.dock ? o.dock.y - 8 : o.vp.h - MARGIN) - o.pop.h, MARGIN, maxY), side: 'beside-panel' };
  }
  return r;
}
/**
 * A line of text that an edge of the box passes through (the box covers it in part across its height): a half-hidden row; or a label or control a side edge passes through. A line the box covers whole, or misses, is fine.
 * `strict` also refuses a label or control that the box covers whole. An edge within 1 px of a line counts too: the popover is placed on whole pixels.
 * @param {Box} r @param {Box[]} lines @param {boolean} [strict]
 */
const cutsLine = (r, lines, strict = false) => lines.some((l) => r.x < l.x + l.w && l.x < r.x + r.w && ([r.y, r.y + r.h].some((e) => e > l.y - 1 && e < l.y + l.h + 1) || cutsLabel(r, l) || (strict && isLabel(l) && coversLabel(r, l))));
/** A label or a control. @param {Box & { ctl?: boolean }} l */
const isLabel = (l) => l.w <= LABEL_W || !!l.ctl;
/** The box covers part of the label (over 1 px on both axes). @param {Box} r @param {Box} l */
const coversLabel = (r, l) => r.x + 1 < l.x + l.w && l.x < r.x + r.w - 1 && r.y + 1 < l.y + l.h && l.y < r.y + r.h - 1;
/** A side edge of the box through a line or a control leaves half a word or a stray tail showing ("Premium" reads "m", "Dr. Steven Sullivan," reads "es,"). Long lines count too (final review 7.9): the box covers a line whole or not at all. Over 1 px of overlap on both axes and not wholly inside. @param {Box} r @param {Box & { ctl?: boolean }} l */
const cutsLabel = (r, l) => coversLabel(r, l) && (l.x < r.x - 0.5 || l.x + l.w > r.x + r.w + 0.5);
/** The widest line that counts as a label. */
const LABEL_W = 260;
/** The zone tried next when a zone has no room. */
const ALT_ZONES = /** @type {Record<string, string[]>} */ ({ 'rail-lower': ['main-lower-left'], 'rail-upper': ['main-lower-left'], 'main-lower-left': ['rail-lower'] });
/** Offsets 0, -2, 2, -4, 4 … up to 120 px: the nearest spot to a zone's point first. */
const NUDGES = [0, ...Array.from({ length: 60 }, (_, k) => [-(k + 1) * 2, (k + 1) * 2]).flat()];
/** Slides 8, -8, 16 … along a zone's row (up to 240 px): the nearest gap between two columns first. */
const SLIDES = [...Array.from({ length: 30 }, (_, k) => [-(k + 1) * 8, (k + 1) * 8]).flat()];
/** Rows 0, -6, 6 … up to 120 px, for the slide. */
const COARSE = [0, ...Array.from({ length: 20 }, (_, k) => [-(k + 1) * 6, (k + 1) * 6]).flat()];
/** Growths 0, 2 … 24 px: a popover may be a little taller so that both of its edges fall between two lines. */
const GROWTHS = Array.from({ length: 13 }, (_, k) => k * 2);
/** @param {Parameters<typeof place>[0]} o @returns {{ x: number, y: number, side: string, h?: number }} */
function placeAt(o) {
  const { target: t, pop, vp } = o;
  const maxX = vp.w - MARGIN - pop.w, maxY = vp.h - MARGIN - pop.h;
  const gd = o.dock ? grow(o.dock, 8) : null;
  const rect = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ h) => ({ x, y, w: pop.w, h });
  const ok = (/** @type {number} */ x, /** @type {number} */ y, h = pop.h, strict = false) => x >= MARGIN - 0.01 && y >= MARGIN - 0.01 && x <= maxX + 0.01 && y + h <= vp.h - MARGIN + 0.01 && !(gd && hit(rect(x, y, h), gd)) && !(t && hit(rect(x, y, h), grow(t, RING_OUT + 2))) && !(o.clear && hit(rect(x, y, h), o.clear)) && !(o.keep ?? []).some((k) => hit(rect(x, y, h), grow(k, 4))) && !(o.panels ?? []).some((k) => hit(rect(x, y, h), k)) && !(o.lines?.length && cutsLine(rect(x, y, h), o.lines, strict));
  const zones = [o.prefer, ...(o.alts ?? [])].filter((z) => !!z);
  /**
   * The zone's own row first (nearest spot first), then, when the row has no clean spot, slid along it to a gap between two columns, then taller. `strict`: not even a whole label or
   * control may be under the popover (a button hidden by it is as bad as a half word), within a short reach; the lenient pass only never cuts one.
   * @param {boolean} strict @returns {{ x: number, y: number, side: string, h?: number } | null}
   */
  const searchZones = (strict) => {
    const rows = strict ? NUDGES.slice(0, 41) : NUDGES, slides = SLIDES, coarse = strict ? COARSE.slice(0, 17) : COARSE;
    for (const at of zones) {
      for (const dy of rows) for (const dh of GROWTHS) {
        if (ok(at.x, at.y + dy, pop.h + dh, strict)) return dh ? { x: at.x, y: at.y + dy, side: 'zone', h: pop.h + dh } : { x: at.x, y: at.y + dy, side: 'zone' };
        if (dh && ok(at.x, at.y + dy - dh, pop.h + dh, strict)) return { x: at.x, y: at.y + dy - dh, side: 'zone', h: pop.h + dh };
        if (!o.lines?.length && dh === 0) break; // without lines a growth never helps
      }
    }
    if (!o.lines?.length) return null;
    for (const at of zones) for (const dx of slides) for (const dy of coarse) for (const dh of [0, 8, 16, 24]) {
      const x = at.x + dx, y = at.y + dy;
      if (ok(x, y, pop.h + dh, strict)) return dh ? { x, y, side: 'zone', h: pop.h + dh } : { x, y, side: 'zone' };
      if (dh && ok(x, y - dh, pop.h + dh, strict)) return { x, y: y - dh, side: 'zone', h: pop.h + dh };
    }
    return null;
  };
  const inZone = (o.lines?.length ? searchZones(true) : null) ?? searchZones(false);
  if (inZone) return inZone;
  if (!t) {
    const cx = clamp((vp.w - pop.w) / 2, MARGIN, maxX);
    let cy = clamp(o.top ?? vp.h * 0.16, MARGIN, maxY);
    if (gd && hit(rect(cx, cy, pop.h), gd)) cy = MARGIN;
    if ((o.panels ?? []).some((k) => hit(rect(cx, cy, pop.h), k))) return { x: maxX, y: gd ? MARGIN : maxY, side: 'fallback' }; // the middle of the window can lie over an open panel: never there (final review 8, stop 8 after Resume)
    return { x: cx, y: cy, side: 'center' };
  }
  const cy = clamp(t.y + t.h / 2 - pop.h / 2, MARGIN, maxY), cx = clamp(t.x + t.w / 2 - pop.w / 2, MARGIN, maxX);
  const cands = /** @type {[string, number, number][]} */ ([
    ['right', t.x + t.w + POINT_GAP, cy], ['left', t.x - POINT_GAP - pop.w, cy], ['below', cx, t.y + t.h + POINT_GAP], ['above', cx, t.y - POINT_GAP - pop.h],
    ['bottom-right', maxX, maxY], ['bottom-left', MARGIN, maxY], ['top-right', maxX, MARGIN], ['top-left', MARGIN, MARGIN],
  ]);
  for (const [side, x, y] of cands) if (ok(x, y)) return { x, y, side };
  if (o.lines?.length) { // a side of the target with a clean spot along it: slid up or down (left, right) or sideways (below, above) and a little taller, the beak still facing the ring
    for (const [side, x, y] of cands.slice(0, 4)) {
      const vertical = side === 'right' || side === 'left', reach = vertical ? pop.h / 2 - 16 : pop.w / 2 - 16;
      for (const d of NUDGES) {
        if (Math.abs(d) > reach) continue;
        for (const dh of GROWTHS) {
          const nx = vertical ? x : x + d, ny = vertical ? y + d : y;
          if (ok(nx, ny, pop.h + dh)) return dh ? { x: nx, y: ny, side, h: pop.h + dh } : { x: nx, y: ny, side };
          if (dh && ok(nx, ny - dh, pop.h + dh)) return { x: nx, y: ny - dh, side, h: pop.h + dh };
        }
      }
    }
  }
  return { x: maxX, y: gd ? MARGIN : maxY, side: 'fallback' };
}

/** Shape check for a script from the network; the strict schema lives in scripts/guide-schema.ts and the unit test. @param {unknown} s */
function validScript(s) {
  const sc = /** @type {any} */ (s);
  if (!sc || sc.version !== 6 || !Array.isArray(sc.steps) || sc.steps.length < 8) return false;
  const ids = new Set();
  return sc.steps.every((/** @type {any} */ p) => {
    if (!p || typeof p.id !== 'string' || ids.has(p.id) || typeof p.title !== 'string' || typeof p.body !== 'string' || typeof p.met !== 'string' || typeof p.target !== 'string') return false;
    ids.add(p.id);
    return Array.isArray(p.task) && p.task.length > 0 && p.task.every((/** @type {any} */ t) => typeof t?.label === 'string' && typeof t.control === 'string' && t.done) && !!p.view && !!p.metView && typeof p.place === 'string';
  });
}

/** querySelector that tolerates a bad selector from the script. @param {string} sel @returns {HTMLElement | null} */
function q(sel) { try { return /** @type {HTMLElement | null} */ (document.querySelector(sel)); } catch { return null; } }
/** @param {HTMLElement | null} e @returns {Box | null} */
function shown(e) { if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** @param {string} sel @param {number} ms @returns {Promise<HTMLElement | null>} */
async function waitFor(sel, ms) { const t0 = performance.now(); for (;;) { const e = q(sel); if (e && shown(e)) return e; if (performance.now() - t0 > ms) return null; await nextFrame(); } }

/** The collision box of the ask dock and its expanded sheet, or null. @returns {Box | null} */
function dockBox() {
  const parts = [shown(q('#siqx-dock')), shown(q('#siqx-sheet')), shown(q('.siqx-backdrop'))].filter((b) => !!b);
  if (!parts.length) return null;
  const x0 = Math.min(...parts.map((b) => /** @type {Box} */ (b).x)), y0 = Math.min(...parts.map((b) => /** @type {Box} */ (b).y));
  const x1 = Math.max(...parts.map((b) => /** @type {Box} */ (b).x + /** @type {Box} */ (b).w)), y1 = Math.max(...parts.map((b) => /** @type {Box} */ (b).y + /** @type {Box} */ (b).h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** The left edge of the page's right-hand column: the cards that end at the content's right edge and are narrower than 60% of it. Null when the page has none. @param {number} x0 @param {number} x1 @returns {number | null} */
function railLeft(x0, x1) {
  let left = /** @type {number | null} */ (null);
  for (const e of document.querySelectorAll('#main .card')) {
    const r = e.getBoundingClientRect();
    if (r.width > 200 && r.width < (x1 - x0) * 0.6 && Math.abs(r.right - x1) < 4 && !e.closest('[data-siqg-root]')) left = Math.min(left ?? r.left, r.left);
  }
  return left;
}
/** Boxes the popover keeps clear besides the stop's own controls: the sidebar. @returns {Box[]} */
function layerBoxes() {
  return [shown(q('aside'))].filter((b) => !!b).map((b) => /** @type {Box} */ (b));
}
/** The panels that are open: the Why sheet and the audit report sheet (never both: one panel at a time). @returns {{ name: 'why' | 'audit', sel: string, box: Box }[]} */
function openPanels() {
  const out = [];
  for (const [name, sel] of /** @type {const} */ ([['why', '#why-sheet'], ['audit', '#audit-sheet']])) { const b = shown(q(`${sel}:not([hidden])`)); if (b) out.push({ name, sel, box: b }); }
  return out;
}
/** The panels a stop asks for: the Why sheet when its view or one of its tasks opens it, the audit report when a task opens it. @param {any} s @param {boolean} met */
function askedPanels(s, met) {
  const view = met ? s.metView : s.view, ui = s.task.map((/** @type {any} */ t) => t.done.ui);
  return { why: view.why === 'open' || ui.includes('why') || ui.includes('replayOriginal'), audit: ui.includes('auditReport') };
}
/**
 * Every line of text and every control in the pane as a box: the popover must cover one whole or not at all. A box is the part of the line the viewer can see:
 * clipped to the pane, to the dock's top edge and to the left edge of an open panel (the text under a panel is not on screen).
 * @param {number} dockTop @param {Box[]} [panels] @returns {Box[]}
 */
function textLines(dockTop, panels = []) {
  const main = q('#main'), mb = shown(main), out = /** @type {Box[]} */ ([]);
  if (!main || !mb) return out;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT), range = document.createRange();
  for (let n = walker.nextNode(); n && out.length < 2500; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent?.trim() || el.closest('[data-siqg-root], script, style') || !(/** @type {any} */ (el)).checkVisibility?.()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width >= 2 && r.height >= 4) { const b = visibleBox(r, mb, dockTop, panels); if (b && b.w >= 2 && b.h >= 3) out.push(b); }
  }
  // a button, link, field or tab is a line too: the popover covers it whole or not at all (final review C-06, "View sources" and the Decisions tab)
  for (const el of main.querySelectorAll('button, a[href], input, select, textarea, summary, [role=tab]')) {
    if (el.closest('[data-siqg-root], [hidden]') || !(/** @type {any} */ (el)).checkVisibility?.()) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 8 && r.height >= 8) { const b = visibleBox(r, mb, dockTop, panels); if (b && b.w >= 8 && b.h >= 8) out.push({ ...b, ctl: true }); }
  }
  return out;
}
/** The part of a rect that is on screen: inside the pane, above the dock and left of an open panel; null when none of it is. @param {DOMRect} r @param {Box} mb the pane @param {number} dockTop @param {Box[]} panels @returns {Box | null} */
function visibleBox(r, mb, dockTop, panels) {
  const x0 = Math.max(r.left, mb.x), y0 = Math.max(r.top, mb.y);
  let x1 = Math.min(r.right, mb.x + mb.w);
  const y1 = Math.min(r.bottom, dockTop, mb.y + mb.h);
  for (const p of panels) if (p.x < x1 && p.x + p.w > x0) x1 = Math.min(x1, p.x);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/** Is a sheet (the Why sheet or the audit report) open? Esc closes it before it ends the tour. */
const layerOpen = () => !!run()?.ui?.whyId || !!q('#audit-sheet:not([hidden])');
/** Hard-coded text of the Resume chip, one place so the test and the page agree. @param {number} i @param {number} n */
const resumeText = (i, n) => `Step ${i + 1} of ${n} · Resume`;

/** @type {any} */ let script = null;
let idx = 0, on = false, token = 0, raf = 0, lastSig = '', prevMet = false, placedKey = '', loading = /** @type {Promise<boolean> | null} */ (null);
/** @type {{ x: number, y: number, side: string, h?: number } | null} */ let placed = null;
/** The column a stop's popover was slid to, kept for the stop. @type {{ idx: number, zone: string, x: number } | null} */ let stickyX = null;
/** @type {HTMLElement | null} */ let pop = null;
/** @type {HTMLElement | null} */ let ring = null;
/** @type {HTMLElement | null} */ let live = null;
/** @type {HTMLElement | null} */ let beak = null;
/** @type {HTMLElement | null} */ let chip = null;
/** @type {MutationObserver | null} */ let mo = null;
/** The tour is paused behind the Resume chip: a panel is open that this stop did not ask for (Q5). `resumedKey` is the stop and panel the viewer chose to continue beside; `opener` the last product control that held focus before a panel opened. */
let paused = false, resumedKey = '', openerTid = '', lastScroll = 0, lastCutCheck = 0, applying = 0;
/** @type {ReturnType<typeof setTimeout> | 0} */ let cutTimer = 0;
/** @type {Element | null} */ let opener = null;
let liveText = '', wasBusy = false, wasError = '', wantFocus = '', wantUntil = 0;
/** UI waits, latched for the run: once the viewer did them they stay done, so Back never asks for them again. */
const latch = { runId: /** @type {string | null} */ (null), why: false, replayOriginal: false, supervisor: false, auditReport: false };

const run = () => /** @type {any} */ ((/** @type {any} */ (window)).__siq?.run);
const step = () => script.steps[idx];

async function load() {
  if (script) return true;
  loading ??= (async () => {
    try { const r = await fetch('/guide-script.json'); const j = await r.json(); if (validScript(j)) script = j; else console.warn('Keel guide: /guide-script.json is invalid, the guide stays off.'); } catch { console.warn('Keel guide: /guide-script.json could not be loaded, the guide stays off.'); }
    return !!script;
  })();
  const ok = await loading; loading = null; return ok;
}

// ---------- reading the run ----------
function syncLatch() {
  const r = run(); if (!r) return;
  if (latch.runId !== r.state.runId) { latch.runId = r.state.runId; latch.why = latch.replayOriginal = latch.supervisor = latch.auditReport = false; }
  // the Why sheet counts for stop 4 only when it was opened at stop 4 or later: one opened during stop 3 must not make stop 4 start done (final review)
  const whyAt = script?.steps?.findIndex((/** @type {any} */ s) => s.task.some((/** @type {any} */ t) => t.done.ui === 'why')) ?? -1;
  if (r.ui?.whyId && (whyAt < 0 || idx >= whyAt)) latch.why = true;
  if (r.ui?.replays?.original) latch.replayOriginal = true;
  if (r.ui?.role === 'supervisor') latch.supervisor = true;
  if (q('#audit-sheet:not([hidden])')) latch.auditReport = true;
}
/** @param {{ done: any }} t @param {any} st */
function itemDone(t, st) {
  const d = t.done;
  if ('ui' in d) return !!(/** @type {any} */ (latch))[d.ui];
  const now = stepStatus(st, d.step);
  return d.status === 'waiting' ? now === 'waiting' || now === 'done' : now === 'done';
}
/** Is the task of stop `s` done for this run? @param {any} s */
function stopMet(s) { syncLatch(); return s.task.every((/** @type {any} */ t) => itemDone(t, run().state)); }

/**
 * Everything the popover and the ring depend on, read once per pass.
 * @returns {{ s: any, items: { label: string, control: string, done: boolean }[], met: boolean, cur: { label: string, control: string }, controlEl: HTMLElement | null, targetEl: HTMLElement | null, ctxEl: HTMLElement | null, busy: boolean, error: string, fallback: boolean, gateStep: string | undefined }}
 */
function read() {
  const s = step(), r = run(), st = r.state;
  syncLatch();
  const items = s.task.map((/** @type {any} */ t) => ({ label: t.label, control: t.control, done: itemDone(t, st) }));
  const met = items.every((/** @type {{ done: boolean }} */ i) => i.done);
  const cur = items.find((/** @type {{ done: boolean }} */ i) => !i.done) ?? items[items.length - 1];
  const cEl = q(cur.control), controlEl = !met && shown(cEl) ? cEl : null;
  const tEl = q(s.target), targetEl = shown(tEl) ? tEl : null;
  const xEl = s.context ? q(s.context) : null, ctxEl = shown(xEl) ? xEl : null;
  const lastStep = s.task.at(-1).done.step;
  const busy = !met && !st.error && (r.busy() || (!!st.head && stepStatus(st, st.head) === 'started'));
  const fb = lastStep && LLM_OF[lastStep] ? llmFor(st, LLM_OF[lastStep]) : null;
  const gateStep = lastStep === 'action.gate' ? 'action.gate' : lastStep === 'human.approve' ? 'action.gate-recheck' : undefined;
  return { s, items, met, cur, controlEl, targetEl, ctxEl, busy, error: !met && st.error ? String(st.error) : '', fallback: fb?.status === 'fallback', gateStep };
}

// ---------- rendering ----------
function build() {
  pop = h('div', { class: 'siqg-pop', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'siqg-title', 'aria-describedby': 'siqg-keys', 'data-testid': 'guide', 'data-siq-ui': '', 'data-siqg-root': '' });
  ring = h('div', { class: 'siqg-ring', 'aria-hidden': 'true', hidden: true, 'data-siqg-root': '' });
  beak = h('div', { class: 'siqg-beak', 'aria-hidden': 'true', hidden: true, 'data-testid': 'tour-beak', 'data-siqg-root': '' });
  live = h('div', { class: 'siqg-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-testid': 'guide-live', 'data-siqg-root': '' }); // one persistent region: created before it is ever written to
  document.body.append(ring, pop, beak, live);
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', onScroll, true);
  for (const ev of ['siq:render', 'siq:run', 'siq:route']) document.addEventListener(ev, onChange);
  window.addEventListener('keydown', onEsc, true); // before the sheets' own handlers, to see whether a sheet was open
  pop.addEventListener('keydown', onPopKey);
  if (window.MutationObserver) {
    mo = new MutationObserver((recs) => { if (recs.some((m) => !(m.target instanceof Element ? m.target : m.target.parentElement)?.closest?.('[data-siqg-root]'))) schedule(); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-busy', 'data-state', 'hidden', 'disabled'] });
  }
  document.body.dataset.guide = 'on';
}
function destroy() {
  window.removeEventListener('resize', schedule);
  document.removeEventListener('scroll', onScroll, true);
  for (const ev of ['siq:render', 'siq:run', 'siq:route']) document.removeEventListener(ev, onChange);
  window.removeEventListener('keydown', onEsc, true);
  mo?.disconnect(); mo = null;
  if (raf) cancelAnimationFrame(raf); raf = 0;
  if (cutTimer) clearTimeout(cutTimer); cutTimer = 0;
  pop?.remove(); ring?.remove(); live?.remove(); beak?.remove(); chip?.remove(); pop = ring = live = beak = chip = null;
  lastSig = ''; placedKey = ''; placed = null; stickyX = null; liveText = ''; paused = false; resumedKey = ''; opener = null; openerTid = '';
  clearRoom();
  document.body.dataset.guide = 'off';
}

/** Say something to a screen reader through the one live region; the same text twice in a row is said twice. @param {string} msg */
function announce(msg) {
  if (!live || !msg) return;
  if (msg === liveText) { live.textContent = ''; const l = live; requestAnimationFrame(() => { l.textContent = msg; }); return; }
  liveText = msg; live.textContent = msg;
}

/** @param {Event} e */
function onChange(e) {
  const ev = /** @type {CustomEvent} */ (e);
  if (!on) return;
  if (ev.type === 'siq:run' && /** @type {any} */ (ev.detail)?.reason === 'reset') { latch.why = latch.replayOriginal = latch.supervisor = latch.auditReport = false; void enter(0); return; } // New case: the tour starts over with the new run
  // the popover follows run events at once (a Next that is still gated one frame after the event is a lie); layout waits for the frame
  if (ev.type === 'siq:run' || ev.type === 'siq:render') safePass(); else schedule();
}
function safePass() { try { if (on) pass(); } catch (e) { console.warn('Keel guide:', e); } }
/** The page scrolled: the ring follows at once; the popover is nudged off a half-hidden line only once the scroll has settled. */
function onScroll() { lastScroll = performance.now(); schedule(); setTimeout(() => { if (on && performance.now() - lastScroll >= 190) schedule(); }, 200); }
function schedule() { if (!on || raf) return; raf = requestAnimationFrame(() => { raf = 0; if (on) safePass(); }); }

/** One pass: redraw the popover when what it shows changed, then place the ring and the popover. */
function pass() {
  if (!pop || !script || !run()?.state?.scenario) return;
  const v = read();
  const st = run().state;
  const text = bodyText(v.met ? v.s.met : v.s.body, st, v.gateStep);
  const sig = [idx, v.met, v.busy, v.error, v.fallback, v.items.map((i) => (i.done ? 1 : 0)).join(''), !!v.controlEl, text].join('|');
  const becameMet = v.met && !prevMet && lastSig !== '';
  if (sig !== lastSig) { lastSig = sig; draw(v, text); }
  if (becameMet) void onMet(v);
  prevMet = v.met;
  if (v.busy && !wasBusy) announce('Working. A live model call takes a few seconds.');
  wasBusy = v.busy;
  if (v.error && v.error !== wasError) announce(v.error);
  wasError = v.error;
  if (wantFocus) { // "Your turn" asked for focus on a control: if a redraw of the page dropped it to the body, give it back (once)
    const a = document.activeElement, e = q(wantFocus);
    if (performance.now() > wantUntil || (a && a !== document.body && a !== document.documentElement) || (e && a === e)) wantFocus = '';
    else if (e && shown(e)) { e.focus({ preventScroll: true }); wantFocus = ''; }
  }
  layout(v);
}

/** The task just became done: show the result view once, announce it, and hand focus to Next only when nothing else holds it. @param {ReturnType<typeof read>} v */
async function onMet(v) {
  const my = token;
  announce('Done. Next is available.');
  const reveal = v.s.metView?.reveal;
  if (reveal) { await nextFrame(); await nextFrame(); if (my === token) await applyReveal(reveal); }
  if (my !== token) return;
  const a = document.activeElement;
  if (a === document.body || !a || pop?.contains(a)) /** @type {HTMLElement | null} */ (pop?.querySelector('[data-testid="guide-next"]'))?.focus({ preventScroll: true });
}

/** @param {ReturnType<typeof read>} v @param {string} text */
function draw(v, text) {
  if (!pop) return;
  const had = pop.contains(document.activeElement), focusId = had ? /** @type {HTMLElement} */ (document.activeElement).getAttribute('data-testid') : null;
  const s = v.s, n = script.steps.length, last = idx === n - 1;
  const segs = script.steps.map((/** @type {any} */ p, /** @type {number} */ i) => h('span', { class: `siqg-seg${i > 0 && script.steps[i - 1].act !== p.act ? ' siqg-gap' : ''}`, 'data-act': p.act, 'data-state': i < idx ? 'done' : i === idx ? 'now' : 'todo' }));
  /** The task cell: the control to press, "Working", an error, or the ticks. */
  let task;
  const multi = v.items.length > 1;
  if (v.met) task = h('span', { class: 'siqg-done', 'data-testid': 'guide-done' }, h('span', { class: 'siqg-tick', 'aria-hidden': 'true' }, checkIcon()), multi ? v.items.map((i) => i.label).join(', ') : v.items[0].label, ' ', h('span', { class: 'siqg-sr' }, 'done'));
  else task = h('span', { class: 'siqg-items' }, v.items.map((i, k) => {
    if (i.done) return h('span', { class: 'siqg-done', 'data-testid': 'guide-item-done' }, h('span', { class: 'siqg-tick', 'aria-hidden': 'true' }, checkIcon()), i.label);
    const mine = i === v.cur;
    if (!mine) return h('span', { class: 'siqg-later' }, `${k + 1}. ${i.label}`);
    if (v.busy || s.auto) return h('span', { class: 'siqg-busy', 'data-testid': 'guide-busy' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), s.auto ? 'Keel is working…' : 'Working…'); // an auto stop is done by Keel itself (autoprep): nothing to press
    return h('span', { class: 'siqg-turnrow' }, h('span', { class: 'siqg-turn' }, 'Your turn:'), ` ${i.label} `, // the control is named at every stop, one action or two (final review 7.9, P2 f)
      h('button', { class: 'siqg-link', type: 'button', 'aria-label': `Your turn: ${i.label}. Show me where`, 'data-testid': 'guide-focus', on: { click: () => void focusControl() } }, 'Show me where'));
  }));
  const gated = !v.met;
  setChildren(pop,
    h('span', { id: 'siqg-keys', class: 'siqg-sr' }, 'Right and Left arrow keys move between steps while focus is in this panel. Alt J brings focus back here. Escape ends the tour.'),
    h('div', { class: 'siqg-head' },
      h('span', { class: 'siqg-act', 'data-testid': 'guide-act' }, `Act ${s.act} · ${ACT_NAME[s.act - 1]}`),
      h('span', { class: `badge badge-${s.badge}`, 'data-badge': s.badge, 'data-testid': 'guide-badge' }, ACTOR_LABEL[s.badge]),
      h('button', { class: 'siqg-x', type: 'button', 'aria-label': 'End tour', title: 'End tour', 'data-testid': 'guide-end', on: { click: () => stop({ focus: 'heading' }) } }, h('span', { 'aria-hidden': 'true' }, '×'))),
    h('div', { class: 'siqg-prog' }, h('span', { class: 'siqg-step', 'data-testid': 'guide-step' }, `Step ${idx + 1} of ${n}`), h('span', { class: 'siqg-segs', 'aria-hidden': 'true' }, segs)),
    h('h2', { class: 'siqg-title', id: 'siqg-title', tabindex: '-1' }, s.title),
    // the text of the other phase sits invisible in the same cell, so the popover keeps one height for the whole stop and never jumps when the result arrives
    h('p', { class: 'siqg-body' }, h('span', { class: 'siqg-now', 'data-testid': 'guide-text' }, text), h('span', { class: 'siqg-ghost', 'aria-hidden': 'true' }, ghost(v))),
    v.error ? h('p', { class: 'siqg-note siqg-error', 'data-testid': 'guide-error' }, v.error) : null,
    v.fallback ? h('p', { class: 'siqg-note siqg-fallback', 'data-testid': 'guide-fallback' }, 'Offline: a prepared backup answer was used') : null,
    h('div', { class: `siqg-foot${multi ? ' siqg-foot-multi' : ''}` }, task,
      h('span', { class: 'siqg-nav' },
        h('button', { class: 'siqg-btn', type: 'button', 'data-testid': 'guide-back', disabled: idx === 0, on: { click: () => void go(-1) } }, 'Back'),
        h('button', { class: `siqg-btn siqg-primary${gated ? ' siqg-gated' : ''}`, type: 'button', 'aria-disabled': String(gated), 'data-testid': 'guide-next', on: { click: () => (gated ? announce(`Do this step first: ${v.cur.label}.`) : void (last ? finish() : go(1))) } }, last ? 'Finish' : 'Next'))));
  if (had) {
    const again = /** @type {HTMLElement | null} */ (focusId ? pop.querySelector(`[data-testid="${focusId}"]`) : null) ?? pop.querySelector('[data-testid="guide-next"]') ?? pop.querySelector('.siqg-title');
    /** @type {HTMLElement | null} */ (again)?.focus({ preventScroll: true });
  }
}

/** The shared check icon (a constant SVG string of public/ui/icons.js) as a node; the U+2713 glyph is not drawn by the page font. */
function checkIcon() { const t = document.createElement('template'); t.innerHTML = CHECK; return t.content.firstElementChild?.cloneNode(true) ?? document.createTextNode(''); }

/** The text of the phase that is not showing, with a headline-sized stand-in when the gate has not run yet. @param {ReturnType<typeof read>} v */
function ghost(v) {
  const other = v.met ? v.s.body : v.s.met;
  if (!other.includes('{gateHeadline}')) return other;
  const st = run().state.steps[v.gateStep ?? ''];
  return other.split('{gateHeadline}').join(st?.status === 'done' && st.headline ? st.headline : Array(13).fill('xxxxx').join(' '));
}

/** "Your turn": move focus to the real control. The guide never presses it. */
async function focusControl() {
  const v = read();
  let el = v.controlEl;
  if (!el) { const e = q(v.cur.control); if (e) { e.scrollIntoView({ block: 'nearest' }); el = e; } }
  el?.focus({ preventScroll: false });
  wantFocus = v.cur.control; wantUntil = performance.now() + 1500; // the page may draw again a moment later and drop focus: pass() gives it back once
}

/** Write a style value only when it changed, so the page's observers see real moves only. @param {HTMLElement} n @param {string} prop @param {string} value */
function put(n, prop, value) { if (/** @type {any} */ (n.style)[prop] !== value) /** @type {any} */ (n.style)[prop] = value; }

/** @param {ReturnType<typeof read>} v */
function layout(v) {
  if (!pop || !ring) return;
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const main = q('#main'), mb = shown(main), dock = dockBox();
  const top = shown(q('#main .top')), sp = shown(q('#main .top .sp'));
  // ---------- panels: the tour never covers one, and pauses behind a chip for one the stop did not ask for (R3, R4) ----------
  const panels = openPanels();
  const asked = askedPanels(v.s, v.met);
  const panelKey = `${idx}|${panels.map((p) => p.name).join()}`;
  if (!panels.length) { resumedKey = ''; if (!applying && roomWas !== null && !roomTimer) roomTimer = setTimeout(() => { roomTimer = 0; if (!openPanels().length) clearRoom(); }, 400); } // the panel is gone for good, not for the moment a page redraws
  const wantPause = panels.some((p) => !asked[p.name]) && resumedKey !== panelKey && !applying;
  if (!panels.length && !paused) { const a = document.activeElement; if (a && a !== document.body && a !== document.documentElement && !pop.contains(a)) { opener = a; openerTid = a.getAttribute('data-testid') ?? ''; } }
  if (wantPause !== paused) { paused = wantPause; placedKey = ''; placed = null; if (!paused) void focusAfterPanel(token); }
  const content = top ? { x0: top.x, x1: top.x + top.w } : { x0: (mb?.x ?? 0) + 28, x1: (mb ? mb.x + mb.w : vp.w) - 28 };
  const zone = v.met && v.s.placeMet ? v.s.placeMet : v.s.place;
  const panelBoxes = panels.map((p) => p.box);
  if (panelBoxes.length) content.x1 = Math.min(content.x1, Math.min(...panelBoxes.map((b) => b.x))); // the main column ends where the panel starts: flush, so that no line running under the panel shows a tail beside the popover (final review 7.9)
  // a stop that opens the Why sheet keeps its place when the sheet arrives: it is laid out beside the sheet before it is open
  const futureSheet = !panels.length && asked.why;
  if (futureSheet) content.x1 = Math.min(content.x1, vp.w - Math.min(WHY_SHEET_W, vp.w));
  if (paused) { // one chip at the bottom left of the main column; no popover, no ring, no beak
    pop.hidden = true; ring.hidden = true; if (beak) beak.hidden = true;
    if (!chip) { chip = h('button', { class: 'siqg-resume', type: 'button', 'data-testid': 'tour-resume', 'data-siqg-root': '', on: { click: resumeNow } }); document.body.append(chip); }
    const text = resumeText(idx, script.steps.length);
    if (chip.textContent !== text) chip.textContent = text;
    const cb = chip.getBoundingClientRect();
    put(chip, 'left', `${Math.round(content.x0)}px`); put(chip, 'top', `${Math.round((dock ? dock.y : vp.h - MARGIN) - 8 - cb.height)}px`);
    return;
  }
  if (chip) { chip.remove(); chip = null; }
  pop.hidden = false;
  // ---------- the ring: on the control while the stop waits, otherwise on the enclosing card or Why section of the result ----------
  const el0 = v.met ? v.targetEl : (v.controlEl ?? v.ctxEl ?? v.targetEl);
  document.querySelectorAll('[data-siqg-press]').forEach((n) => n.removeAttribute('data-siqg-press'));
  if (el0 && !v.met && el0 === v.controlEl) el0.setAttribute('data-siqg-press', '');
  const el = el0 && !(!v.met && el0 === v.controlEl) ? (el0.closest('.card, .why-sec') ?? el0) : el0;
  let box = shown(/** @type {HTMLElement | null} */ (el));
  if (box && mb && el?.closest('#main')) { // only the part that is in the pane and above the docked composer, with room for the outline
    const x0 = Math.max(box.x, mb.x), y0 = Math.max(box.y, mb.y), x1 = Math.min(box.x + box.w, mb.x + mb.w), y1 = Math.min(box.y + box.h, dock ? dock.y - RING_OUT - 2 : mb.y + mb.h);
    box = x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  if (box) { // never draw outside the window, inside the sheet the element lives in, or over a panel it does not live in
    const sh = el ? panels.find((p) => el.closest(p.sel)) : undefined;
    ring.dataset.in = sh?.name ?? '';
    const x0 = Math.max(box.x, RING_OUT, sh ? sh.box.x + RING_OUT : 0), y0 = Math.max(box.y, RING_OUT, sh ? sh.box.y + RING_OUT : 0);
    let x1 = Math.min(box.x + box.w, window.innerWidth - RING_OUT, sh ? sh.box.x + sh.box.w - RING_OUT : Infinity);
    const y1 = Math.min(box.y + box.h, window.innerHeight - RING_OUT, sh ? sh.box.y + sh.box.h - RING_OUT : Infinity);
    for (const p of panels) if (p !== sh) x1 = Math.min(x1, p.box.x - RING_OUT - 1);
    box = x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  if (box) { ring.hidden = false; put(ring, 'left', `${box.x}px`); put(ring, 'top', `${box.y}px`); put(ring, 'width', `${box.w}px`); put(ring, 'height', `${box.h}px`); }
  else ring.hidden = true;
  // ---------- the popover ----------
  let maxH = vp.h - 2 * MARGIN; if (dock) maxH = Math.min(maxH, dock.y - 8 - 4 - MARGIN);
  put(pop, 'maxHeight', `${Math.max(160, maxH)}px`);
  // the popover's width: beside a panel it fills the visible column, in the rail it fills the rail, so no line of the page peeks out at its side
  let fitW = 0;
  if (panelBoxes.length || futureSheet) fitW = clamp(content.x1 - content.x0, POP_W, 520);
  else if (zone === 'rail-lower' || zone === 'rail-upper' || zone === 'right-of-target') { const rl = railLeft(content.x0, content.x1); if (rl !== null) fitW = clamp(content.x1 - rl, POP_W, 460); }
  put(pop, 'width', fitW ? `${Math.round(fitW)}px` : '');
  const was = pop.getBoundingClientRect(); // where the popover is now, with whatever height the last placement gave it
  put(pop, 'minHeight', ''); // the natural height: the placement may ask for a few px more
  const pb = pop.getBoundingClientRect();
  // the controls this stop asks for, wherever they are on screen, stay clear, and so does the card or section they live in
  const showBoxes = (v.s.show ?? []).map((/** @type {string} */ sel) => { const b = shown(q(sel)); return b && mb ? visibleBox(/** @type {DOMRect} */ ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h }), mb, dock ? dock.y : vp.h, panelBoxes) : null; }); // what the stop talks about: kept clear while it is on screen
  const keep = [...v.items.map((i) => shown(q(i.control))), ...layerBoxes(), ...showBoxes].filter((b) => !!b).map((b) => /** @type {Box} */ (b));
  const ctxBox = shown(v.ctxEl);
  const clear = ctxBox && v.ctxEl !== el0 && ctxBox.w * ctxBox.h < vp.w * vp.h * 0.5 ? grow(ctxBox, 4) : null;
  const tiles = [...document.querySelectorAll('#main [data-testid=cycle-metric], #main [data-testid=perf-decisions-tile], #main [data-testid=perf-approvals-tile]')].map((e) => shown(/** @type {HTMLElement} */ (e))).filter((b) => !!b);
  const tilesBottom = tiles.length ? Math.max(...tiles.map((b) => /** @type {Box} */ (b).y + /** @type {Box} */ (b).h)) : undefined;
  const tabs = shown(q('#main .tabs[role=tablist]'));
  const g = { pop: { w: pb.width, h: pb.height }, vp, content, dockTop: dock ? dock.y : vp.h, headerBottom: top ? top.y + top.h : 94, controlsBottom: sp ? sp.y + sp.h : 75, tilesBottom, tabsBottom: tabs ? tabs.y + tabs.h : undefined, target: v.met ? box : (ctxBox ?? shown(v.controlEl) ?? box) };
  // the popover keeps its place for the whole phase of a stop; it moves only when it would hit something
  const key = `${idx}|${zone}|${Math.round(pb.width)}x${Math.round(pb.height)}|${vp.w}x${vp.h}|${dock ? Math.round(dock.y) : 0}|${panels.map((p) => `${p.name}${Math.round(p.box.x)}`).join()}|${zone === 'left-of-sheet' ? Math.round(tilesBottom ?? 0) : ''}|${zone === 'under-tabs' ? Math.round(g.tabsBottom ?? 0) : ''}`; // the tiles grow once the audit is built: stop 10 follows them
  const cur = { x: was.left, y: was.top, w: was.width, h: was.height };
  const colliding = [box ? grow(box, RING_OUT + 2) : null, clear, ...keep.map((k) => grow(k, 4)), ...panelBoxes, dock ? grow(dock, 8) : null].some((b) => !!b && hit(cur, /** @type {Box} */ (b)));
  // a line of text cut in half is a collision too, but only checked at rest: while the viewer scrolls, the popover stays put
  const now = performance.now();
  let cutting = false;
  if (placed && key === placedKey && !colliding) {
    const wait = Math.max(190 - (now - lastScroll), 300 - (now - lastCutCheck), 0);
    if (wait > 0) { if (!cutTimer) cutTimer = setTimeout(() => { cutTimer = 0; schedule(); }, wait + 20); } // come back when the page has been still for a moment
    else { lastCutCheck = now; cutting = cutsLine(cur, textLines(g.dockTop, panelBoxes)); }
  }
  if (key !== placedKey || colliding || cutting || !placed) {
    // within one stop the popover keeps its column: a slide found earlier is where the search starts again (also when the popover changes size between phases), so the stop moves only up or down
    const zp = zonePoint(zone, g), prefer = zp && stickyX && stickyX.idx === idx && stickyX.zone === zone ? { x: stickyX.x, y: zp.y } : zp;
    placed = place({ target: v.met ? box : (shown(v.controlEl) ?? box), clear, keep, panels: panelBoxes, lines: textLines(g.dockTop, panelBoxes), pop: { w: pb.width, h: pb.height }, vp, dock, top: g.headerBottom + 8, prefer, alts: (ALT_ZONES[zone] ?? []).map((z) => zonePoint(z, g)).filter((p) => !!p) });
    placedKey = key; lastCutCheck = now;
    stickyX = placed.side === 'zone' ? { idx, zone, x: placed.x } : null;
  }
  put(pop, 'minHeight', placed.h ? `${Math.round(placed.h)}px` : ''); put(pop, 'left', `${Math.round(placed.x)}px`); put(pop, 'top', `${Math.round(placed.y)}px`);
  const popH = Math.max(pb.height, placed.h ?? 0);
  pop.dataset.side = placed.side; pop.dataset.zone = zone;
  // ---------- the beak: on the side that faces the ring, for a popover that points at its target (a zone is a reserved place and has none) ----------
  if (beak) {
    const t = v.met ? box : (shown(v.controlEl) ?? box), side = placed.side, px = Math.round(placed.x), py = Math.round(placed.y);
    if (t && !ring.hidden && (side === 'right' || side === 'left' || side === 'below' || side === 'above')) {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2, half = BEAK / 2, inset = 14;
      const dir = side === 'right' ? 'left' : side === 'left' ? 'right' : side === 'below' ? 'up' : 'down';
      const bx = side === 'right' ? px : side === 'left' ? px + pb.width : clamp(cx, px + inset, px + pb.width - inset);
      const by = side === 'below' ? py : side === 'above' ? py + popH : clamp(cy, py + inset, py + popH - inset);
      beak.hidden = false; put(beak, 'left', `${Math.round(bx - half)}px`); put(beak, 'top', `${Math.round(by - half)}px`); beak.dataset.dir = dir;
    } else beak.hidden = true;
  }
}

/** The panel closed (or the viewer chose to go on beside it): focus goes back to the stop's title, but only from the body, the popover, the chip or the control that opened the panel. @param {number} my */
async function focusAfterPanel(my) {
  await nextFrame(); await sleep(260); // the Why sheet gives focus back to its opener a moment after it closes
  if (!on || paused || my !== token) return;
  const a = document.activeElement;
  if (a === document.body || a === document.documentElement || !a || pop?.contains(a) || a === opener || (!!openerTid && a.getAttribute('data-testid') === openerTid)) /** @type {HTMLElement | null} */ (pop?.querySelector('.siqg-title'))?.focus({ preventScroll: true });
}
/** The page column's own bottom padding before the tour added room to it (null: none added). The pane itself is the ask dock's: it sets its bottom padding to the dock's height. @type {string | null} */
let roomWas = null;
/** @type {ReturnType<typeof setTimeout> | 0} */ let roomTimer = 0;
/** Let the pane scroll `px` further than its content allows: padding at the foot of the page column, for as long as a panel is open beside a stop. @param {HTMLElement} m @param {number} px */
function makeRoom(m, px) {
  const wrap = /** @type {HTMLElement | null} */ (m.querySelector(':scope > .wrap')); if (!wrap) return;
  if (roomWas === null) roomWas = wrap.style.paddingBottom;
  wrap.style.paddingBottom = `${parseFloat(getComputedStyle(wrap).paddingBottom) + px}px`;
  void m.scrollHeight; // lay the pane out with its new room before anything is scrolled into it
}
/** Give the pane its own bottom padding back. */
function clearRoom() {
  if (roomTimer) clearTimeout(roomTimer); roomTimer = 0;
  if (roomWas === null) return;
  const wrap = q('#main > .wrap'); if (wrap) wrap.style.paddingBottom = roomWas;
  roomWas = null;
}
/** Room left above the visible band's top edge when a target is scrolled to it. */
const VIEW_PAD = RING_OUT, POP_EST = 200; // POP_EST: the popover's height when it cannot be measured
/**
 * With a panel open the viewer sees only the part of the pane left of the panel and above the dock (the "band"). Scroll the pane so the stop's target is in that band and the
 * popover has a place of its own: the target's top at the band's top with the popover below it (a small control in the middle; the end of the page can stop that scroll short).
 * A target taller than the band and the popover together is top-aligned and the popover covers its foot. A target that lies wholly under the panel (the right-hand rail at stop 8) cannot be brought out from under it by scrolling: the first of the stop's `show`
 * components that is in the band is scrolled into view instead. A target inside a panel is the panel's own business. View state only. (final review 8, P1: Resume at stops 6 and 7.)
 * @param {ReturnType<typeof read>} v @returns {boolean} true when the pane scrolled
 */
function bringTargetIntoView(v) {
  const m = q('#main'), mb = shown(m), panels = openPanels();
  if (!m || !mb || !panels.length) return false;
  const dock = dockBox(), bandL = mb.x, bandR = Math.min(mb.x + mb.w, ...panels.map((p) => p.box.x)), bandT = mb.y, bandB = Math.min(mb.y + mb.h, dock ? dock.y - 8 : Infinity);
  const subject = [v.met ? v.targetEl : (v.controlEl ?? v.ctxEl ?? v.targetEl), v.targetEl, ...(v.s.show ?? []).map((/** @type {string} */ sel) => q(sel))]
    .find((e) => { const b = shown(e ?? null); return !!e && !!b && !e.closest('#why-sheet, #audit-sheet') && b.x < bandR - 8 && b.x + b.w > bandL + 8; });
  const b = shown(subject ?? null);
  if (!subject || !b) return false;
  let popH = POP_EST; // the popover is hidden behind the chip: measure it by showing it for a moment (nothing is painted in between)
  if (pop) { const was = pop.hidden; pop.hidden = false; const ph = pop.getBoundingClientRect().height; pop.hidden = was; if (ph > 40) popH = ph; }
  const bandH = bandB - bandT, seen = Math.max(0, Math.min(b.y + b.h, bandB) - Math.max(b.y, bandT)), room = popH + POINT_GAP; // room: the popover and the gap that keeps it off the ring
  // in the band already and out of the popover's own place (the lowest part of the band), or already at the top of the band: leave the page as the viewer has it
  if (seen >= 0.95 * Math.min(b.h, bandH) && (b.y + b.h <= bandB - room || b.y <= bandT + VIEW_PAD + 2)) return false;
  const before = m.scrollTop, goal = before + (b.y - (b.h < bandH * 0.4 ? bandT + (bandH - b.h) / 2 : bandT + VIEW_PAD)); // the target's top at the band's top (small: in the middle)
  // the last card of a page ends at the dock: scrolling it to the top of the band takes room under it, where the popover goes, so the pane gets that room while the panel is open
  const short = Math.ceil(goal - (m.scrollHeight - m.clientHeight));
  if (short > 0) makeRoom(m, short);
  m.scrollTop = goal;
  return m.scrollTop !== before;
}
/** The Resume chip: go on with the stop beside the open panel; the target first comes into the part of the pane the panel leaves; the popover then keeps clear of it. */
function resumeNow() {
  resumedKey = `${idx}|${openPanels().map((p) => p.name).join()}`;
  try { bringTargetIntoView(read()); } catch (e) { console.warn('Keel guide:', e); }
  safePass();
  void nextFrame().then(() => { if (on && !paused) /** @type {HTMLElement | null} */ (pop?.querySelector('.siqg-title'))?.focus({ preventScroll: true }); });
}

/** Bring an element or the top of the pane into view, without smooth scrolling (reduced motion). @param {string} reveal */
async function applyReveal(reveal) {
  if (reveal === 'top') { const m = q('#main'); if (m) m.scrollTop = 0; return; }
  const e = await waitFor(reveal, 1500);
  if (e) {
    // a control sits in the middle of the pane (never flush with its edge); a large result starts at the top; a sheet section starts at the top of the sheet
    const small = !e.closest('#why-sheet') && e.getBoundingClientRect().height < (q('#main')?.clientHeight ?? 700) * 0.4;
    e.scrollIntoView({ block: small ? 'center' : 'start', behavior: 'instant' });
  }
  schedule();
}

/**
 * Show the view of a stop: the route hash, the Why sheet, the scroll position. View state only: no run step, no role, no CRM write.
 * @param {{ hash: string, why: 'open' | 'closed', tab?: 'summary' | 'evidence' | 'replay', reveal: string }} view @returns {Promise<boolean>} true when it closed the Why sheet
 */
async function applyView(view) {
  applying++; // while a view is being applied the open panels are the tour's own doing: no Resume chip flashes up between two stops
  try {
    const r = run(); let closedSheet = false;
    if (view.why !== 'open' && r.ui?.whyId) { r.closeWhy(); closedSheet = true; await nextFrame(); } // a stop that wants the sheet closed closes it first, before the page changes
    if (view.hash && location.hash !== view.hash) { location.hash = view.hash; await waitFor('#main .wrap', 2000); await nextFrame(); await nextFrame(); }
    if (view.why === 'open') {
      const rec = recommendation(r.state);
      const tab = view.tab ?? 'summary';
      if (rec && (r.ui.whyId !== rec.decisionId || (r.ui.whyTab ?? 'summary') !== tab)) { showWhy(r, rec.decisionId, tab); await nextFrame(); await nextFrame(); }
    }
    await applyReveal(view.reveal);
    return closedSheet;
  } finally { applying--; }
}

// ---------- moving between stops ----------
/** Open stop `i`: apply its entry view, or its result view when its task is already done. @param {number} i */
async function enter(i) {
  const my = ++token;
  const a = document.activeElement;
  const mayFocus = a === document.body || !a || !!pop?.contains(a); // focus is never stolen from a product control
  idx = clamp(i, 0, script.steps.length - 1);
  const s = step(), met = stopMet(s);
  lastSig = ''; placedKey = ''; placed = null;
  clearRoom();
  const closed = await applyView(met ? s.metView : s.view);
  if (my !== token || !on) return;
  prevMet = met; lastSig = '';
  if (openPanels().length) { try { bringTargetIntoView(read()); } catch (e) { console.warn('Keel guide:', e); } } // a stop shown while a panel is open (one it asked for): its target in the part the panel leaves
  pass(); prevMet = met;
  const v = read();
  announce(`Step ${idx + 1} of ${script.steps.length}, ${s.title}. ${v.met ? 'Done.' : `Your turn: ${v.cur.label}.`}`);
  if (closed) await sleep(160); // the Why sheet gives focus back to its opener a moment after it closes
  await nextFrame();
  const a2 = document.activeElement; // the viewer may have moved on to a control meanwhile: focus is taken only from the body or from the panel itself
  if (my === token && mayFocus && (a2 === document.body || !a2 || !!pop?.contains(a2))) /** @type {HTMLElement | null} */ (pop?.querySelector('.siqg-title'))?.focus({ preventScroll: true });
}

/** @param {number} d */
async function go(d) {
  if (!on) return;
  if (d > 0 && !read().met) { announce(`Do this step first: ${read().cur.label}.`); return; }
  if (d > 0 && idx >= script.steps.length - 1) return;
  if (d < 0 && idx === 0) return;
  await enter(idx + d);
}

/** Finish: the tour closes with the audit report open (its second task item) and focus goes into the report, so the closing line shows with no tooltip on screen. */
async function finish() { if (on && read().met) stop({ focus: 'audit' }); }

/** Left and Right move between stops, only while focus is inside the popover. @param {KeyboardEvent} e */
function onPopKey(e) {
  if (!on || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); void go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); void go(-1); }
}

/**
 * Esc closes the top layer first: with a sheet open the sheet's own handler closes it and the tour stays. With none open, Esc ends the tour when focus is
 * inside the popover or on the page body. @param {KeyboardEvent} e
 */
function onEsc(e) {
  if (!on || e.key !== 'Escape' || e.defaultPrevented) return;
  if (layerOpen()) return;
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement || pop?.contains(a)) { e.preventDefault(); stop({ focus: 'heading' }); }
}

/** The first stop whose task is not done for this run (the last stop when all are done). */
function firstUnmet() {
  const i = script.steps.findIndex((/** @type {any} */ s) => !stopMet(s));
  return i < 0 ? script.steps.length - 1 : i;
}

async function start() {
  if (!(await load())) return;
  if (!on) { on = true; build(); }
  await enter(script.steps[0]?.auto ? 0 : firstUnmet());
}
/** End the tour. The page, sheet, role and run stay as they are. @param {{ focus?: 'heading' | 'audit' }} [o] */
function stop(o = {}) {
  if (!on) return;
  on = false; token++;
  destroy();
  if (o.focus) void focusAfter(o.focus);
}
/** @param {'heading' | 'audit'} where */
async function focusAfter(where) {
  await nextFrame(); await nextFrame();
  let el = null;
  if (where === 'audit') el = await waitFor(q('#audit-sheet:not([hidden])') ? '[data-testid=audit-preview-close]' : '[data-testid=open-audit-report]', 1500); // the report is open inside the tour: focus goes into it
  else el = q('#why-sheet:not([hidden])') ?? q('#main h1') ?? q('h1');
  if (!el) return;
  if (!el.matches('button, a[href], input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: false });
}
const toggle = () => (on ? stop() : void start());

/** Adapter for the retired V0 public/js/main.js, which still imports this name; delete it together with that file. */
export function createGuide(/** @type {unknown} */ _app) { return { active: () => on, start: () => { void start(); }, stop }; }

// ---------- the invisible toggle: ?guide=1 / ?guide=0 / Alt+G / Ctrl+Alt+G ----------
/** Resolves once the shell has drawn a page and the case is loaded. */
function whenReady() {
  const ready = () => !!(/** @type {any} */ (window)).__siq?.run?.state?.scenario && !!document.querySelector('#main .wrap') && !!document.body.dataset.screen;
  if (ready()) return Promise.resolve();
  return new Promise((res) => {
    const f = () => { if (ready()) { for (const ev of ['siq:render', 'siq:run']) document.removeEventListener(ev, f); res(null); } };
    for (const ev of ['siq:render', 'siq:run']) document.addEventListener(ev, f);
    setTimeout(f, 50);
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.body && (document.body.dataset.guide ??= 'off');
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ' && e.altKey && on && !e.metaKey && !e.shiftKey) { // back to the tour panel from anywhere on the page
      e.preventDefault();
      /** @type {HTMLElement | null} */ (pop?.querySelector('[data-testid="guide-next"]') ?? pop?.querySelector('.siqg-title'))?.focus();
      return;
    }
    if (e.code !== 'KeyG' || !e.altKey || e.metaKey || e.shiftKey) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (!e.ctrlKey && t.matches?.('input, textarea, select, [contenteditable]')) return; // typing is never hijacked
    e.preventDefault(); toggle();
  });
  /** @type {any} */ (window).KeelGuide = { start: () => start(), stop, toggle, active: () => on, place };
  const g = new URLSearchParams(location.search).get('guide');
  if (g === '1') void whenReady().then(() => start());
}
