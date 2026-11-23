// Keel design-system layer: string-returning helpers over the shell's own classes (.card .pill .chip .btn .badge .sec-h .tbl-wrap) plus a few ui- classes
// from css/primitives.css. Every dynamic value goes through esc(). Parameters named `right` or `html` are trusted markup built by another helper.
// Living reference: open the app with ?ui=1. Rules the helpers enforce are written next to each helper.
import { CHECK } from './icons.js';

/** @param {unknown} s */
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c); }

/** Product-voice defaults for the states below. Nothing here explains the system. */
export const COPY = Object.freeze({
  emptyTitle: 'Nothing here yet',
  loading: 'Loading',
  errorTitle: 'Something went wrong',
  errorText: 'Try again in a moment.',
  retry: 'Try again',
  showAll: 'Show all',
  showFewer: 'Show fewer',
});

/**
 * Phrases that read as developer notes or system explanations. Used by tests over the helpers' defaults and the style page, and available to page tests.
 * @type {readonly [RegExp, string][]}
 */
export const COPY_BANNED = Object.freeze([
  [/rules decided, not ai/i, 'AI/rules boundary as a sentence (use prov())'],
  [/\bdata only\b/i, 'step statement'],
  [/the system does the work/i, 'step statement'],
  [/scripted for (the|this) demo/i, 'demo meta copy'],
  [/untrusted input/i, 'security note'],
  [/ai layer working/i, 'system narration'],
  [/\bnpm run\b|\bnpx\b/i, 'command line in the UI'],
  [/stand-in|for this demo\b|here to show|this page only shows/i, 'prototype meta copy'],
  [/(model|ai) does no arithmetic|not from the model|never decides|adds nothing/i, 'boundary sentence'],
  [/\b(todo|fixme|lorem ipsum|tbd)\b/i, 'placeholder text'],
]);
/** Banned phrasings found in a text. @param {string} text @returns {string[]} */
export function copyViolations(text) { return COPY_BANNED.filter(([re]) => re.test(text)).map(([, what]) => what); }

// ---------- badges, pills, chips ----------
/** @type {Record<string, string>} */
const ACTOR_LABEL = { ai: 'AI', data: 'DATA', rules: 'RULES', human: 'HUMAN', system: 'SYSTEM' };
/** The one layer badge. actor: ai | data | rules | human | system. @param {string} actor */
export function layerBadge(actor) { return '<span class="badge badge-' + esc(actor) + '" data-badge="' + esc(actor) + '">' + esc(ACTOR_LABEL[actor] ?? actor) + '</span>'; }

/** @typedef {'passed' | 'failed' | 'approval' | 'excluded' | 'recommended' | 'eligible' | 'simulated'} Status */
/** @type {Record<Status, { tone: string, label: string }>} */
const STATUS = {
  passed: { tone: 'neutral', label: 'Passed' }, failed: { tone: 'crit', label: 'Failed' }, approval: { tone: 'warn', label: 'Needs approval' },
  excluded: { tone: 'crit', label: 'Excluded' }, recommended: { tone: 'accent', label: 'Recommended' }, eligible: { tone: 'neutral', label: 'Eligible' }, simulated: { tone: 'neutral', label: 'Simulated' },
};
/**
 * The one status vocabulary. At most one pill per title. 'eligible' takes `n` for "Eligible #2". 'passed' is never a pill (green is only the icon of a passed check, R7): it is the verified indicator.
 * @param {Status} state @param {{ n?: number, title?: string }} [opts]
 */
export function statusPill(state, opts = {}) {
  const s = STATUS[state]; if (!s) throw new RangeError('unknown status: ' + state);
  if (state === 'passed') return '<span data-status="passed"' + (opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' + verified(s.label) + '</span>';
  return '<span class="pill ' + s.tone + '" data-status="' + state + '"' + (opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' + s.label + (state === 'eligible' && opts.n != null ? ' #' + esc(opts.n) : '') + '</span>';
}
/** Muted label chip ("Simulated", "Scripted edit", "Sample data"). One per surface. @param {string} text @param {{ title?: string }} [opts] */
export function chip(text, opts = {}) { return '<span class="chip"' + (opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' + esc(text) + '</span>'; }
/**
 * The one identifier style: a rule id, decision id or hash as `code.ui-id` (mono face, never broken inside the token). A hash is shortened with shortHash() before it gets here.
 * @param {string} id @param {{ title?: string, cls?: string }} [o] cls adds a legacy class next to ui-id
 */
export function idCode(id, o = {}) { return '<code class="ui-id' + (o.cls ? ' ' + esc(o.cls) : '') + '"' + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + esc(id) + '</code>'; }
/**
 * Rule id for detail surfaces only (Why sheet, Rules page, violation tables). Summary surfaces show the plain reason.
 * Kept with its legacy `rule-id` class because tests outside this package still assert it (stage-cards.test.ts, ui-member.spec.ts); css/primitives.css draws `code.rule-id` exactly like `code.ui-id`.
 * New code calls idCode(). @param {string} id
 */
export function ruleRef(id) { return '<code class="rule-id" title="Rule ' + esc(id) + '">' + esc(id) + '</code>'; }
/** A figure that must line up: tabular figures in the body face. Never monospace. @param {string | number} text */
export function num(text) { return '<span class="ui-num">' + esc(text) + '</span>'; }

// ---------- verified ----------
const CROSS = '<svg class="ic-cross" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const RING = '<svg class="ic-pending" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const DASHIC = '<svg class="ic-na" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 6h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
/** @typedef {'verified' | 'mismatch' | 'pending' | 'na' | 'done'} VerifiedState */
/** @type {Record<VerifiedState, string>} */
const VERIFIED_ICON = { verified: CHECK, mismatch: CROSS, pending: RING, na: DASHIC, done: CHECK };
/**
 * A lasting check result: a 14 px icon, a label and an optional muted identifier. This replaces the green callout (green is only the icon colour of a passed check, css/primitives.css header).
 * `done` is a neutral check for history that is resolved but not a pass (a failure that was corrected): same mark as verified, in the muted colour.
 * The icon is decoration; the words carry the state. verified: check, mismatch: cross, pending ("To do", "Not checked yet"): ring, na ("Not applicable"): dash.
 * @param {string} label @param {{ state?: VerifiedState, detail?: string }} [o] detail is shown as an `idCode`
 */
export function verified(label, o = {}) {
  const state = o.state ?? 'verified';
  const icon = VERIFIED_ICON[state];
  if (!icon) throw new RangeError('unknown verified state: ' + state);
  return '<span class="ui-verified" data-state="' + state + '"><span class="ui-verified-ic" aria-hidden="true">' + icon + '</span><span class="ui-verified-l">' + esc(label) + '</span>' + (o.detail ? ' ' + idCode(o.detail) : '') + '</span>';
}

// ---------- headers ----------
/**
 * Card or section header: the `.sec-h` layout. Badge rule: at most ONE layer badge per header, right-aligned; a second one throws.
 * @param {string} title
 * @param {{ meta?: string, badge?: string, right?: string, level?: 2 | 3 | 4 }} [o] right is trusted markup (buttons, links), badge is a layer id
 */
export function secHead(title, o = {}) {
  if (Array.isArray(o.badge) || (o.badge && /class="badge/.test(o.right ?? ''))) throw new RangeError('secHead takes at most one badge per header');
  const h = o.level ?? 2;
  return '<div class="sec-h"><h' + h + '>' + esc(title) + '</h' + h + '>' + (o.meta ? '<span class="small muted">' + esc(o.meta) + '</span>' : '') +
    (o.badge || o.right ? '<span class="sp">' + (o.right ?? '') + (o.badge ? layerBadge(o.badge) : '') + '</span>' : '') + '</div>';
}
/**
 * The header of a side sheet (the Why sheet and the audit report): an eyebrow, the title once, an optional provenance line and one Close button of class `btn`.
 * @param {{ eyebrow?: string, title: string, titleId?: string, prov?: string, closeAct: string, closeTestid?: string }} o prov is trusted markup (prov())
 */
export function sheetHead(o) {
  return '<header class="ui-sheet-head"><div class="ui-sheet-main">' + (o.eyebrow ? '<p class="ui-sheet-eyebrow">' + esc(o.eyebrow) + '</p>' : '') +
    '<h2 class="ui-sheet-title"' + (o.titleId ? ' id="' + esc(o.titleId) + '"' : '') + '>' + esc(o.title) + '</h2>' + (o.prov ?? '') + '</div>' +
    button('Close', { act: o.closeAct, testid: o.closeTestid }) + '</header>';
}
/**
 * Provenance line: one layer badge plus muted parts ("Decided by rules" / "Rule pack 2026.2" / "Plan data Oct 15, 2026").
 * @param {string} actor @param {string[]} partsList
 */
export function prov(actor, partsList) {
  return '<p class="ui-prov" data-testid="provenance" data-actor="' + esc(actor) + '">' + layerBadge(actor) + '<span class="small muted">' + partsList.map(esc).join(' · ') + '</span></p>';
}

// ---------- figures and facts ----------
/**
 * Row of 2 to 5 figures: label, value (tabular figures), optional sub-line. Values arrive already formatted (format.js), units included.
 * @param {{ label: string, value: string, sub?: string, title?: string }[]} items
 * @param {{ size?: 'sm' }} [o] the one small variant (--text-stat-sm); there is no other size
 */
export function statRow(items, o = {}) {
  if (items.length < 2 || items.length > 5) throw new RangeError('statRow takes 2 to 5 items, got ' + items.length);
  if (o.size != null && o.size !== 'sm') throw new RangeError('statRow size is sm or nothing, got ' + o.size);
  return '<div class="ui-stat-row" data-count="' + items.length + '"' + (o.size ? ' data-size="sm"' : '') + '>' + items.map((i) =>
    '<div class="ui-stat"' + (i.title ? ' title="' + esc(i.title) + '"' : '') + '><span class="ui-stat-l">' + esc(i.label) + '</span><span class="ui-stat-v">' + esc(i.value) + '</span>' +
    (i.sub ? '<span class="ui-stat-sub">' + esc(i.sub) + '</span>' : '') + '</div>').join('') + '</div>';
}

/** @param {{ label: string, value: string, note?: string, source?: string }} r */
const factRow = (r) => '<div class="ui-fact"><dt>' + esc(r.label) + '</dt><dd><span class="ui-fact-v">' + esc(r.value) + '</span>' + (r.source ? ' ' + chip(r.source) : '') +
  (r.note ? '<span class="ui-fact-note">' + esc(r.note) + '</span>' : '') + '</dd></div>';
/**
 * Label / value rows with an optional second line and source chip. More than `max` rows (default 6): the rest sit under "Show all N" (native disclosure, no script).
 * @param {{ label: string, value: string, note?: string, source?: string }[]} rows @param {{ max?: number }} [o]
 */
export function factList(rows, o = {}) {
  const max = o.max ?? 6;
  const head = rows.slice(0, max), rest = rows.slice(max);
  return '<div class="ui-facts-wrap"><dl class="ui-facts">' + head.map(factRow).join('') + '</dl>' +
    (rest.length ? '<details class="ui-more"><summary><span class="ui-more-closed">' + COPY.showAll + ' ' + rows.length + '</span><span class="ui-more-open">' + COPY.showFewer + '</span></summary><dl class="ui-facts">' + rest.map(factRow).join('') + '</dl></details>' : '') + '</div>';
}
/** Compact grid of short label / value pairs (plan, dates, ids). Use factList when a value needs a second line. @param {{ label: string, value: string }[]} rows */
export function keyValueGrid(rows) {
  return '<dl class="ui-kv">' + rows.map((r) => '<div><dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd></div>').join('') + '</dl>';
}

// ---------- callouts ----------
const CALLOUT = /** @type {Record<string, { cls: string, icon: string, sr: string }>} */ ({
  info: { cls: 'info', icon: 'i', sr: 'Note: ' }, good: { cls: 'good', icon: CHECK, sr: 'Passed: ' }, warn: { cls: 'warn', icon: '!', sr: 'Attention: ' }, block: { cls: 'block', icon: '✕', sr: 'Blocked: ' },
});
/**
 * One-line state banner, no nesting. The icon and a screen-reader prefix say the state, so colour is never the only signal.
 * @param {'info' | 'good' | 'warn' | 'block'} kind @param {string} text @param {{ right?: string, testid?: string }} [o] right is trusted markup; testid marks the text itself
 */
export function callout(kind, text, o = {}) {
  const c = CALLOUT[kind]; if (!c) throw new RangeError('unknown callout kind: ' + kind);
  return '<div class="ui-callout ui-callout-' + c.cls + '" data-kind="' + kind + '"><span class="ui-callout-ic" aria-hidden="true">' + c.icon + '</span><span class="ui-callout-t"><span class="sr">' + c.sr + '</span>' + (o.testid ? '<span data-testid="' + esc(o.testid) + '">' + esc(text) + '</span>' : esc(text)) + '</span>' +
    (o.right ? '<span class="ui-callout-r">' + o.right + '</span>' : '') + '</div>';
}

// ---------- table ----------
/** @typedef {string | number | { html: string }} Cell */
/**
 * Table in the shell style. Columns marked `num` are right-aligned with tabular figures. A cell is text (escaped) or `{ html }` (trusted). The scroller is focusable and labelled.
 * @param {{ caption: string, columns: { key: string, label: string, num?: boolean }[], rows: Record<string, Cell>[], empty?: string }} t
 */
export function tableHTML(t) {
  if (!t.rows.length) return emptyState(t.empty ?? COPY.emptyTitle, { cls: 'ui-empty' });
  const cell = (/** @type {Cell} */ v) => (v && typeof v === 'object' ? v.html : esc(v));
  return '<div class="tbl-wrap ui-table" tabindex="0" role="region" aria-label="' + esc(t.caption) + '"><table><caption class="sr">' + esc(t.caption) + '</caption><thead><tr>' +
    t.columns.map((c) => '<th scope="col"' + (c.num ? ' class="r"' : '') + '>' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
    t.rows.map((r) => '<tr>' + t.columns.map((c) => '<td' + (c.num ? ' class="r ui-num"' : '') + '>' + cell(r[c.key] ?? '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}

// ---------- empty, loading, error ----------
/** @param {string} label @param {string} [act] @param {string} [v] */
const actionBtn = (label, act, v) => button(label, { act, v });
/** Empty state: a title, one optional line, one optional action. @param {string} title @param {{ text?: string, action?: { label: string, act?: string, v?: string }, cls?: string }} [o] */
export function emptyState(title, o = {}) {
  return '<div class="ui-state ' + esc(o.cls ?? '') + '" data-state="empty"><b>' + esc(title) + '</b>' + (o.text ? '<span class="muted">' + esc(o.text) + '</span>' : '') + (o.action ? actionBtn(o.action.label, o.action.act, o.action.v) : '') + '</div>';
}
/** Loading skeleton: muted lines, no spinner text. @param {string} [label] @param {{ lines?: number }} [o] */
export function loadingState(label = COPY.loading, o = {}) {
  const n = o.lines ?? 3;
  return '<div class="ui-state ui-skel" data-state="loading" role="status" aria-busy="true"><span class="sr">' + esc(label) + '</span>' +
    Array.from({ length: n }, (_, i) => '<i class="ui-skel-line"></i>').join('') + '</div>';
}
/** Error state with an optional retry. @param {string} [title] @param {{ text?: string, retry?: { label?: string, act: string, v?: string } }} [o] */
export function errorState(title = COPY.errorTitle, o = {}) {
  return '<div class="ui-state ui-state-error" data-state="error" role="alert"><b>' + esc(title) + '</b><span class="muted">' + esc(o.text ?? COPY.errorText) + '</span>' +
    (o.retry ? actionBtn(o.retry.label ?? COPY.retry, o.retry.act, o.retry.v) : '') + '</div>';
}

// ---------- buttons ----------
/**
 * Button hierarchy: primary (`btn pri`, one per group), secondary (default), ghost. `href` makes an anchor. Native focus ring from the shell.
 * @param {string} label
 * @param {{ kind?: 'primary' | 'secondary' | 'ghost', act?: string, v?: string, testid?: string, href?: string, disabled?: boolean, title?: string }} [o]
 */
export function button(label, o = {}) {
  const cls = 'btn' + (o.kind === 'primary' ? ' pri' : o.kind === 'ghost' ? ' ghost' : '');
  const attrs = (o.testid ? ' data-testid="' + esc(o.testid) + '"' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '');
  if (o.href) return '<a class="' + cls + '" href="' + esc(o.href) + '"' + attrs + '>' + esc(label) + '</a>';
  return '<button type="button" class="' + cls + '"' + (o.act ? ' data-act="' + esc(o.act) + '"' : '') + (o.v ? ' data-v="' + esc(o.v) + '"' : '') + attrs + (o.disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
}
/** A row of buttons. Exactly one primary at most. @param {({ label: string } & NonNullable<Parameters<typeof button>[1]>)[]} list */
export function actions(list) {
  if (list.filter((b) => b.kind === 'primary').length > 1) throw new RangeError('actions takes one primary button per group');
  return '<div class="ui-actions">' + list.map((b) => button(b.label, b)).join('') + '</div>';
}
