/* Copied from keel-prototype v1.2.3 public/prototype.js (PAGES.performance header, .kpis tiles, .tabs, dealTable), adapted for adopt-keel-shell */
// Performance & audit (S6, polished in UI6, cosmetic-and-oncall WP3). It leads with the cycle time of this run next to a labelled manual estimate, then the Decisions,
// Approvals and Audit packages tabs; the replay of last year's decision lives on the Audit packages tab (and in the Why sheet's Replay tab) only. No forecast chart and no
// pipeline dashboard: nothing here is a sales figure. Every number is read from a run event, a stored trace or the server's verify answer; the page formats it and adds
// nothing. The audit report opens in the side sheet from the built package itself, with the same header as the Why sheet; the closing line is the report's last line.
import { count, plural, shortHash, timeOfDay } from '../../ui/format.js';
import { duration } from '../../js/format.js';
import { appliedRules, gateTitle, memberName } from '../../js/labels.js';
import { PRIOR_DECISION_ID, packNo, replaySummaryHTML, replaysOf, snapshotDay } from '../../js/replay-format.js';
import { nameOf, recommendation } from '../../js/state.js';
import { isReplacedGate, showWhy } from '../../js/views-why.js';
import { callout, chip, emptyState, factList, idCode, secHead, sheetHead, statRow, statusPill, verified } from '../../ui/primitives.js';
import { esc, nativeButton, registerPage, scheduleRender, tabsHTML, top } from '../shell.js';
import { AUDITS_EARLIER, DECISIONS_EARLIER, HISTORY_LABEL, WEEK } from '../history.js';
import { dateLong as dayLong } from '../../ui/format.js';

/** @typedef {import('../../../shared/contracts.ts').DecisionTrace} DecisionTrace */
/** @typedef {import('../../../shared/contracts.ts').CycleTime} CycleTime */
/** @typedef {{ status: 'idle' | 'busy' | 'ok' | 'fail' | 'error', files?: number, manifestSha256?: string }} Verify */

const TABS = /** @type {[string, string][]} */ ([['decisions', 'Decisions'], ['approvals', 'Approvals'], ['audit', 'Audit packages']]);
const ACTION = /** @type {Record<string, string>} */ ({
  'send-soa': 'Record SOA before the call', 'book-appointment': 'Book the appointment', wait: 'Wait for the member', escalate: 'Escalate', close: 'Close the case',
});
const ROLE = /** @type {Record<string, string>} */ ({ 'sales-supervisor': 'Sales supervisor', 'compliance-reviewer': 'Compliance reviewer', 'licensed-agent': 'Licensed agent' });

/** What the decision concluded, in a sentence. @param {any} state @param {DecisionTrace} t */
export function outcomeText(state, t) {
  const o = t.outcome;
  if (o.type === 'plan-recommendation') return o.recommendedPlanId ? 'Recommended ' + nameOf(state, o.recommendedPlanId) : 'No plan passed the rules';
  if (o.type === 'communication-gate') {
    if (o.verdict === 'blocked') return 'Blocked: ' + o.violations.length + ' rule' + (o.violations.length === 1 ? '' : 's') + ' violated';
    return o.verdict === 'held-for-approval' ? 'Held for supervisor approval' : 'Passed the gate';
  }
  return (ACTION[o.action] ?? o.action);
}

/** The reduction text. calc.ts truncates toward zero, so a real run never reads 100%; this guards the display anyway.
 * @param {CycleTime} c @returns {{ big: string, small: string }} */
export function reductionText(c) {
  const v = c.reduction.value;
  if (c.measuredMs > 0 && v >= 100) return { big: 'Over 99.9%', small: 'less than the modeled baseline' };
  const m = /^(-?\d+(?:\.\d+)?)%\s+(less|more)\s+(.*)$/.exec(c.reduction.display);
  return m ? { big: m[1] + '%', small: m[2] + ' ' + m[3] } : { big: c.reduction.display, small: '' };
}

/** Plain name of a decision; its id stays beside it, muted. @param {DecisionTrace} t */
function decisionName(t) {
  if (t.kind === 'plan-recommendation') return 'Plan recommendation';
  if (t.kind === 'next-action') return 'Next action';
  return gateTitle(t.decisionId);
}
/** The name of something an approval covers: a decision or a message draft. @param {any} s @param {string} id */
function subjectName(s, id) {
  const d = s.decisions.find((/** @type {DecisionTrace} */ x) => x.decisionId === id);
  if (d) return decisionName(d);
  return /-corrected$/.test(id) ? 'Corrected message' : 'Message draft';
}
/** When the step that made a decision finished (the run's story clock), else the decision's own date. @param {any} s @param {DecisionTrace} t */
function decidedAt(s, t) {
  const step = t.kind === 'plan-recommendation' ? 'decision.recommend' : t.kind === 'next-action' ? 'decision.next-action'
    : (t.outcome.type === 'communication-gate' && /-1$/.test(t.outcome.draftId) ? 'action.gate' : 'action.gate-recheck');
  return s.steps?.[step]?.at ?? t.asOf;
}

/** @param {any} state */
const approverOf = (state) => state.approval?.approver ?? state.scenario?.approver ?? null;

// ---------- tiles ----------
/** The cycle-time tile: this run and the manual estimate side by side as the hero; the percentage only as a labelled sub-line. One Modeled assumption chip, on the estimate. @param {any} ctx */
export function cycleTileHTML(ctx) {
  const c = /** @type {CycleTime | null} */ (ctx.state.cycle);
  const red = c ? reductionText(c) : null;
  const assumption = chip('Modeled assumption', { title: c?.baseline.note });
  return '<div class="card kpi perf-cycle" data-testid="cycle-metric"><div class="perf-pair">' +
    '<div data-testid="cycle-measured"><label>This run</label><div class="v">' + esc(c ? duration(c.measuredMs) : '—') + '</div><div class="d">Intake to the last CRM write</div></div>' +
    '<div data-testid="cycle-baseline"><label>Manual estimate</label><div class="v">' + esc(c ? c.baseline.minutes + ' min' : '—') + '</div><div class="d">' + assumption + '</div></div></div>' +
    (red ? '<p class="perf-reduction" data-testid="cycle-reduction"><span>Modeled reduction <b class="ui-num">' + esc(red.big) + '</b></span></p>' : '') + '</div>';
}

/** @param {any} ctx */
function tilesHTML(ctx) {
  const s = ctx.state;
  const rules = s.decisions.reduce((/** @type {number} */ n, /** @type {DecisionTrace} */ t) => n + appliedRules(t), 0);
  const who = approverOf(s);
  const tile = (/** @type {string} */ label, /** @type {string} */ v, /** @type {string} */ d, /** @type {string} */ id) =>
    '<div class="card kpi" data-testid="' + id + '"><label>' + esc(label) + '</label><div class="v">' + esc(v) + '</div><div class="d">' + esc(d) + '</div></div>';
  return '<div class="kpis perf-kpis">' + cycleTileHTML(ctx) +
    tile('Decisions', String(s.decisions.length), s.decisions.length ? plural(rules, 'rule') + ' applied' : 'None yet', 'perf-decisions-tile') +
    tile('Approvals', String(s.approval ? 1 : 0), s.approval ? who.name + ' · ' + (ROLE[who.role] ?? who.role) : s.decisions.length ? 'Waiting for ' + (who?.name ?? 'the supervisor') : 'Approver ' + (who?.name ?? 'the supervisor'), 'perf-approvals-tile') + '</div>';
}

// ---------- tabs ----------
/** @param {any} ctx */
export function decisionsHTML(ctx) {
  const s = ctx.state;
  if (!s.decisions.length) return '<div data-testid="perf-decisions">' + emptyState('No decisions from today yet', { text: 'They appear here as soon as Keel prepares a case.' }) + '</div>';
  const a = s.approval;
  /** The outcome cell: derived from the record, so a decision the supervisor approved never still says it needs approval. */
  const outcomeOf = (/** @type {DecisionTrace} */ t) => {
    const o = t.outcome;
    if (o.type === 'plan-recommendation') return (o.recommendedPlanId ? statusPill('recommended') : statusPill('failed')) + '<span>' + esc(o.recommendedPlanId ? nameOf(s, o.recommendedPlanId) : 'No plan passed the rules') + '</span>';
    if (o.type === 'communication-gate') {
      if (o.verdict === 'blocked') return statusPill('failed') + '<span>' + esc(plural(o.violations.length, 'rule') + ' violated') + '</span>';
      if (o.verdict === 'pass') return verified('Passed') + '<span>No rule violated</span>';
      if (isReplacedGate(s, t)) return '<span class="muted">Replaced</span>'; // a draft the approval does not cover, or one a later gate took over: the Why sheet's word and rule
      if (a) return verified((a.decision === 'approved' ? 'Approved by ' : 'Rejected by ') + a.approver.name, { state: a.decision === 'approved' ? 'verified' : 'mismatch' });
      return statusPill('approval') + '<span>Waiting for the supervisor</span>';
    }
    return '<span>' + esc(outcomeText(s, t)) + '</span>';
  };
  const rows = s.decisions.map((/** @type {DecisionTrace} */ t) => {
    const out = (t.candidates ?? []).filter((c) => !c.eligible).length;
    return '<tr class="click" data-act="why" data-v="' + esc(t.decisionId) + '" tabindex="0" data-testid="perf-decision-' + esc(t.decisionId) + '" data-ctx-type="panel" data-ctx-id="decision-' + esc(t.decisionId) + '" data-ctx-label="' + esc(decisionName(t)) + '">' +
      '<td class="perf-name"><b>' + esc(decisionName(t)) + '</b><div class="small muted">' + idCode(t.decisionId) + '</div></td>' +
      '<td><span class="perf-out">' + outcomeOf(t) + '</span></td>' +
      '<td><span class="ui-num">' + esc(timeOfDay(decidedAt(s, t))) + '</span></td>' +
      '<td>' + esc(count(appliedRules(t)) + ' applied') + (t.kind === 'plan-recommendation' && out ? '<div class="small muted">' + esc(plural(out, 'plan') + ' excluded') + '</div>' : '') + '</td>' +
      '<td>' + idCode(shortHash(t.traceHash), { title: t.traceHash }) + '</td></tr>';
  });
  return '<div class="card tbl-wrap ui-table" data-testid="perf-decisions" tabindex="0" role="region" aria-label="Decisions in this run"><table><caption class="sr">Decisions in this run, in the order the rules made them. Select a row for the reasons.</caption>' +
    '<thead><tr><th scope="col">Decision</th><th scope="col">Outcome</th><th scope="col">Time</th><th scope="col">Rules</th><th scope="col">Fingerprint</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}

/** @param {any} ctx */
export function approvalsHTML(ctx) {
  const s = ctx.state, a = s.approval;
  if (!a) {
    const w = approverOf(s);
    return '<div data-testid="perf-approvals"><div data-testid="perf-approval-pending">' + emptyState('No approval yet', { text: 'Waiting for ' + (w ? w.name : 'the supervisor') }) + '</div></div>';
  }
  const ok = a.decision === 'approved';
  return '<div class="card tbl-wrap ui-table" data-testid="perf-approvals" tabindex="0" role="region" aria-label="Approvals recorded in this run"><table><caption class="sr">Approvals recorded in this run</caption>' +
    '<thead><tr><th scope="col">Approver</th><th scope="col">Decision</th><th scope="col">Time</th><th scope="col">Approved items</th><th scope="col">Attestation</th></tr></thead><tbody>' +
    '<tr data-testid="perf-approval"><td class="perf-name"><b>' + esc(a.approver.name) + '</b><div class="small muted">' + esc(ROLE[a.approver.role] ?? a.approver.role) + '</div></td>' +
    '<td class="nowrap">' + verified(ok ? 'Approved' : 'Rejected', { state: ok ? 'verified' : 'mismatch' }) + '</td>' +
    '<td><span class="ui-num">' + esc(timeOfDay(a.at)) + '</span></td>' +
    '<td><span class="perf-items">' + a.subjectIds.map((/** @type {string} */ id) => chip(subjectName(s, id), { title: id })).join('') + '</span></td>' +
    '<td class="perf-attest">' + esc(a.attestation) + '</td></tr></tbody></table></div>';
}

// ---------- audit package ----------
/** @param {number} bytes */
const sizeOf = (bytes) => (bytes >= 1048576 ? Math.round(bytes / 1048576) + ' MB' : bytes >= 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' bytes');

/** The verify answer, as one verified (or mismatch) line under the buttons; the manifest hash is in the fact list. @param {Verify} v */
function verifyHTML(v) {
  const wrap = (/** @type {string} */ inner) => '<div class="perf-verify" data-testid="audit-verified" role="status">' + inner + '</div>';
  if (v.status === 'ok') return wrap(verified('Hashes verified', { detail: plural(v.files ?? 0, 'file') }));
  if (v.status === 'fail') return wrap(verified('Integrity check failed', { state: 'mismatch', detail: 'hash mismatch' }));
  if (v.status === 'error') return wrap(callout('warn', 'Check didn’t run'));
  return wrap('');
}

/** The model calls and, only when some did not simply succeed, how those ended ("Retried (1)", "Fallback output (1)"). Every call live says nothing: that is the normal case. @param {any} s */
function callsOf(s) {
  const by = { retried: 0, fallback: 0 };
  for (const l of Object.values(s.llm ?? {})) { const st = /** @type {any} */ (l).status; if (st === 'fallback') by.fallback++; else if (st === 'live-after-retry') by.retried++; }
  return { n: Object.keys(s.llm ?? {}).length, how: [by.retried ? `Retried (${by.retried})` : "", by.fallback ? `Offline backup answer (${by.fallback})` : ""].filter(Boolean).join(' · ') };
}

/** The itemised manual estimate: an assumption, labelled as one. @param {CycleTime} c */
function baselineHTML(c) {
  return '<details class="perf-more" data-testid="baseline-card"><summary>Manual estimate by task</summary>' +
    '<table class="perf-base"><caption class="sr">Modeled manual work by task</caption><thead><tr><th scope="col">Task</th><th scope="col" class="r">Minutes</th></tr></thead><tbody>' +
    c.baseline.breakdown.map((b) => '<tr><td>' + esc(b.task) + '</td><td class="r ui-num">' + b.minutes + '</td></tr>').join('') +
    '<tr><td><b>Total</b></td><td class="r ui-num"><b>' + c.baseline.minutes + '</b></td></tr></tbody></table>' +
    '<p class="small muted">' + chip('Modeled assumption') + ' ' + esc(c.baseline.note) + '</p></details>';
}

/** @param {any} ctx @param {Verify} v */
export function auditHTML(ctx, v) {
  const s = ctx.state, run = ctx.run, au = s.audit, c = /** @type {CycleTime | null} */ (s.cycle);
  const build = nativeButton(ctx, 'briefing.audit');
  const head = secHead('Audit package', { meta: au ? s.runId ?? '' : '', right: build });
  if (!au) {
    return '<div class="card pad" data-testid="audit-card">' + head + emptyState('No audit package yet') + '</div>';
  }
  const url = run.auditUrl?.() ?? au.url;
  const calls = callsOf(s);
  const rec = recommendation(s);
  const busy = v.status === 'busy';
  const stat = [
    statRow([{ label: 'Size', value: sizeOf(au.bytes) }, { label: 'Files', value: v.files != null ? String(v.files) : '—' }, { label: 'Decisions', value: String(s.decisions.length) }, { label: 'Approvals', value: String(s.approval ? 1 : 0) }]),
    statRow([{ label: 'Messages', value: String(s.draftOrder.length) }, { label: 'CRM writes', value: String(s.crm.length), sub: 'Simulated' }, { label: 'Model calls', value: String(calls.n), sub: calls.how }, { label: 'Timeline entries', value: String(s.timeline.length) }]),
  ].join('');
  // the counts are the stat tiles above; this list holds only what they do not say
  const facts = rec ? factList([{ label: 'Versions', value: 'Rule pack ' + packNo(rec.pack) + (snapshotDay(rec.snapshot.id) ? ' · Plan data ' + snapshotDay(rec.snapshot.id) : '') }]) : '';
  /** The hashes are identifiers: one mono token each, under the fact list. */
  const hashes = '<dl class="ui-kv perf-hashes"><div><dt>Record hash</dt><dd>' + idCode(shortHash(au.recordSha256), { title: au.recordSha256 }) + '</dd></div>' +
    (v.manifestSha256 ? '<div><dt>Manifest</dt><dd>' + idCode(shortHash(v.manifestSha256), { title: v.manifestSha256 }) + ' <span class="small muted">SHA-256 · not a signature</span></dd></div>' : '') + '</dl>';
  return '<div class="card pad" data-testid="audit-card">' + head +
    '<div class="perf-stats" data-testid="perf-package">' + stat + '</div>' +
    '<div class="ui-actions perf-actions"><a class="btn pri" data-testid="audit-download" href="' + esc(url) + '" download>Download audit package</a>' +
    '<button type="button" class="btn" data-act="performance.verify" data-testid="audit-verify"' + (busy ? ' aria-busy="true" disabled' : '') + '>Verify integrity</button>' +
    '<button type="button" class="btn" data-act="performance.open-report" data-testid="open-audit-report">Open audit report</button></div>' +
    verifyHTML(v) +
    '<div class="perf-contents">' + facts + hashes + '</div>' + (c ? baselineHTML(c) : '') + '</div>';
}

// ---------- the report preview sheet ----------
/** @param {any} s */
function countsOf(s) {
  const seen = new Set();
  for (const t of s.decisions) for (const r of t.sourceRecords) seen.add(r.system + ':' + r.recordId);
  const gates = s.decisions.filter((/** @type {DecisionTrace} */ t) => t.outcome.type === 'communication-gate' && t.outcome.verdict === 'blocked');
  const failed = gates.reduce((/** @type {number} */ n, /** @type {DecisionTrace} */ t) => n + (t.outcome.type === 'communication-gate' ? t.outcome.violations.length : 0), 0);
  return { sources: seen.size, blocked: gates.length, failed };
}

/** The three counts of this run, under the sheet header. @param {any} ctx @param {Verify} v */
function sheetCountsHTML(ctx, v) {
  const s = ctx.state, n = countsOf(s), rec = recommendation(s), who = approverOf(s);
  const day = rec ? snapshotDay(rec.snapshot.id) : null;
  const kept = v.status === 'ok' || v.status === 'fail';
  return '<div class="perf-counts" data-testid="audit-counts">' + statRow([
    { label: 'Grounded', value: plural(n.sources, 'source record'), sub: 'Across ' + plural(s.decisions.length, 'decision') + (day ? ' · Plan data ' + day : '') },
    { label: 'Governed', value: n.blocked + ' blocked', sub: plural(n.failed, 'rule') + ' failed · ' + (s.approval ? who.name + ' approved' : 'Waiting for ' + (who?.name ?? 'the supervisor')) },
    { label: 'Preserved', value: kept && v.files != null ? plural(v.files, 'file') : '—', sub: v.status === 'ok' ? 'Hashes verified' : v.status === 'fail' ? 'Hashes do not match' : v.status === 'busy' ? 'Verifying' : 'Not verified yet' },
  ], { size: 'sm' }) + '</div>';
}

/** The dialog inside the side sheet: the shared sheet header, the three counts, then the package's own report (embedded: no second title; it ends on the closing line). @param {any} ctx @param {Verify} v */
export function previewSheetHTML(ctx, v) {
  const s = ctx.state;
  const base = ctx.run.auditReportUrl?.() ?? '';
  const who = s.scenario ? memberName(s.scenario, 'short') : '';
  return '<div class="perf-sheet" role="dialog" aria-modal="true" aria-label="Audit report" data-testid="audit-preview">' +
    sheetHead({ eyebrow: who ? 'Audit package · ' + who : 'Audit package', title: 'Audit report', closeAct: 'performance.close-report', closeTestid: 'audit-preview-close' }) +
    sheetCountsHTML(ctx, v) +
    '<iframe class="perf-frame" data-testid="audit-preview-frame" title="Audit report" tabindex="-1" sandbox src="' + esc(base ? base + '?embed=1' : '') + '"></iframe></div>';
}

// ---------- replay ----------
/** Rule names for the changed versions, from the Rules view once it has loaded. @param {any} ctx */
function ruleTitleOf(ctx) {
  const packs = /** @type {{ rules: { id: string, title: string }[] }[]} */ (ctx.run?.views?.rules?.packs ?? []);
  return (/** @type {string} */ id) => { for (const p of packs) { const r = p.rules.find((x) => x.id === id); if (r) return r.title; } return undefined; };
}

/** The replay of last year's decision, drawn by the same renderer as the Why sheet. Shown on the Audit packages tab only. @param {any} ctx */
export function replayCardHTML(ctx) {
  const u = ctx.ui, s = ctx.state;
  const rec = recommendation(s);
  const full = rec ? '<button type="button" class="btn" data-act="performance.full-replay" data-testid="replay-full">Open full replay</button>' : '';
  return '<div class="card pad perf-replay" data-testid="replay-card">' + secHead('Replay last year’s decision', { meta: PRIOR_DECISION_ID, right: full }) +
    replaySummaryHTML(replaysOf(u), { state: s, ruleTitle: ruleTitleOf(ctx), controls: { act: 'performance.replay', ids: { original: 'perf-replay-original', current: 'perf-replay-current' }, busy: u.replayBusy } }) +
    (u.replayError ? callout('block', u.replayError) : '') + '</div>';
}

// ---------- page ----------
/** @param {any} ctx @param {Verify} v */
/** The week so far, counted from the sample history plus today's case (demo-polish). */
function weekHTML() {
  return '<p class="perf-week" data-testid="perf-week"><span>This week: <b>' + WEEK.prepared + ' cases prepared</b> by Keel</span><span><b>About ' + WEEK.avgAgentMinutes + ' min</b> of agent time each</span><span><b>' + WEEK.blockedBeforeSending + '</b> risky message stopped before it reached a member</span><span class="hist-tag">' + esc(HISTORY_LABEL) + '</span></p>';
}

/** The same tab for earlier cases this week (sample history). @param {string} tab */
function earlierHTML(tab) {
  const head = (/** @type {string} */ t) => '<div class="hist" data-testid="perf-earlier-' + tab + '"><div class="sec-h"><h3>' + esc(t) + '</h3><span class="hist-tag">' + esc(HISTORY_LABEL) + '</span></div><div class="card tbl-wrap ui-table"><table>';
  const end = '</tbody></table></div></div>';
  if (tab === 'approvals') {
    const list = DECISIONS_EARLIER.filter((d) => d.approvedBy);
    return head('Earlier this week') + '<caption class="sr">Earlier approvals</caption><thead><tr><th scope="col">Member</th><th scope="col">Approved</th><th scope="col">Approver</th><th scope="col">Date</th></tr></thead><tbody>' +
      list.map((d) => '<tr><td class="perf-name"><b>' + esc(d.member) + '</b></td><td>' + esc(d.what + ': ' + d.outcome) + '</td><td>' + esc(d.approvedBy) + '</td><td>' + esc(dayLong(d.at)) + '</td></tr>').join('') + end;
  }
  if (tab === 'audit') {
    return head('Earlier audit packages') + '<caption class="sr">Earlier audit packages</caption><thead><tr><th scope="col">Package</th><th scope="col">Member</th><th scope="col">Files</th><th scope="col">Built</th></tr></thead><tbody>' +
      AUDITS_EARLIER.map((a) => '<tr><td>' + idCode(a.id) + '</td><td>' + esc(a.member) + '</td><td class="ui-num">' + a.files + '</td><td>' + esc(dayLong(a.at)) + '</td></tr>').join('') + end;
  }
  return head('Earlier this week') + '<caption class="sr">Earlier decisions</caption><thead><tr><th scope="col">Member</th><th scope="col">Decision</th><th scope="col">Outcome</th><th scope="col">Status</th><th scope="col">Date</th></tr></thead><tbody>' +
    DECISIONS_EARLIER.map((d) => '<tr><td class="perf-name"><b>' + esc(d.member) + '</b><div class="small muted">' + idCode(d.id) + '</div></td><td>' + esc(d.what) + '</td><td>' + esc(d.outcome) + '<div class="small muted">' + esc(d.note) + '</div></td><td>' + (d.approvedBy ? verified('Approved', { detail: d.approvedBy }) : statusPill('approval') + ' <span>In review</span>') + '</td><td>' + esc(dayLong(d.at)) + '</td></tr>').join('') + end;
}

export function performanceHTML(ctx, v) {
  const tab = TABS.some(([id]) => id === ctx.params.tab) ? ctx.params.tab : 'decisions';
  const body = (tab === 'approvals' ? approvalsHTML(ctx) : tab === 'audit' ? auditHTML(ctx, v) : decisionsHTML(ctx)) + earlierHTML(tab);
  const right = ctx.state.audit && tab !== 'audit' ? '<button type="button" class="btn" data-act="tab" data-v="audit" data-testid="perf-to-audit">Audit package</button>' : '';
  const sub = ctx.state.scenario ? esc(memberName(ctx.state.scenario, 'short')) + (ctx.state.runId ? ' · ' + esc(ctx.state.runId) : '') : '';
  return '<div class="perf-page">' + top('Performance & audit', sub, right) +
    tilesHTML(ctx) + weekHTML() +
    tabsHTML('tab', TABS, tab) + '<div class="perf-body" role="tabpanel" aria-label="' + esc(TABS.find(([id]) => id === tab)?.[1] ?? '') + '">' + body + '</div>' +
    (tab === 'audit' ? replayCardHTML(ctx) : '') + '</div>';
}

// ---------- view state: the verify answer and the sheet ----------
/** @type {Verify} */ let verify = { status: 'idle' };
/** @type {string | null | undefined} */ let verifyRun;
let previewOpen = false;
let drawn = '';
/** @type {HTMLElement | null} */ let opener = null;
let refocus = false;
/** @type {any} */ let watched = null;

/** The verify answer belongs to one run: a new run starts clean. @param {any} ctx */
function syncRun(ctx) {
  const id = ctx.state.runId ?? null;
  if (verifyRun === id) return;
  verifyRun = id; verify = { status: 'idle' };
  if (previewOpen) closeSheet(false);
}

/** Ask the server to re-hash the built package. @param {any} ctx */
function runVerify(ctx) {
  if (verify.status === 'busy' || !ctx.state.audit || typeof ctx.run.auditVerify !== 'function') return;
  const runId = ctx.state.runId ?? null;
  verify = { status: 'busy' };
  scheduleRender(); drawSheet(ctx);
  ctx.run.auditVerify().then(
    (/** @type {{ ok: boolean, files: number, manifestSha256: string }} */ r) => { if (verifyRun === runId) verify = { status: r.ok ? 'ok' : 'fail', files: r.files, manifestSha256: r.manifestSha256 }; },
    () => { if (verifyRun === runId) verify = { status: 'error' }; },
  ).then(() => { scheduleRender(); drawSheet(ctx); });
}

const hostEl = () => {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('audit-sheet');
  if (!el) { el = document.createElement('div'); el.id = 'audit-sheet'; el.hidden = true; document.body.appendChild(el); }
  return el;
};

/** Draw the sheet from the run. The report frame is created once; later draws only replace the counts, so a change in the verify answer never reloads the report. @param {any} ctx */
function drawSheet(ctx) {
  const el = hostEl(); if (!el) return;
  if (!previewOpen) { if (!el.hidden) { el.hidden = true; el.replaceChildren(); drawn = ''; } return; }
  const html = previewSheetHTML(ctx, verify);
  const wasHidden = el.hidden;
  if (wasHidden || !el.querySelector('iframe')) { el.innerHTML = html; el.hidden = false; }
  else if (html !== drawn) {
    const t = document.createElement('template'); t.innerHTML = html;
    const next = t.content.querySelector('[data-testid=audit-counts]'), cur = el.querySelector('[data-testid=audit-counts]');
    if (next && cur) cur.replaceWith(next);
  }
  drawn = html;
  if (wasHidden) /** @type {HTMLElement | null} */ (el.querySelector('[data-testid=audit-preview-close]'))?.focus({ preventScroll: true });
}

/** Close the sheet and the audit panel with it (one panel at a time: the run store owns which panel is open). @param {boolean} [giveFocusBack] @param {any} [run] */
function closeSheet(giveFocusBack = true, run = watched) {
  if (!previewOpen) return;
  previewOpen = false; refocus = giveFocusBack;
  const el = hostEl(); if (el) { el.hidden = true; el.replaceChildren(); }
  drawn = '';
  run?.closePanel?.('audit');
  if (giveFocusBack) { scheduleRender(); setTimeout(restoreFocus, 120); }
}
function restoreFocus() {
  if (!refocus) return; refocus = false;
  const b = /** @type {HTMLElement | null} */ (document.querySelector('[data-testid=open-audit-report]'));
  if (b) b.focus({ preventScroll: true }); else opener?.focus({ preventScroll: true });
}

/** Follow the run store's panel: another panel opening (the Why sheet) closes this sheet. @param {any} run */
function watchPanel(run) {
  if (watched === run || typeof run?.subscribe !== 'function') return;
  watched = run;
  run.subscribe(() => { if (previewOpen && run.ui?.panel !== 'audit') closeSheet(false, run); });
}

if (typeof document !== 'undefined') {
  // Escape closes the sheet; Tab stays inside it; leaving the page closes it.
  document.addEventListener('keydown', (ev) => {
    if (!previewOpen) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSheet(); return; }
    if (ev.key !== 'Tab') return;
    const el = document.getElementById('audit-sheet'); if (!el || el.hidden) return;
    const f = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('button, a[href]')].filter((n) => !n.hasAttribute('disabled')));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (!el.contains(at)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
  }, true);
  document.addEventListener('siq:render', (ev) => {
    const page = /** @type {CustomEvent} */ (ev).detail?.page;
    if (previewOpen && page !== 'performance') closeSheet(false);
    if (refocus) restoreFocus();
  });
}

registerPage({
  id: 'performance',
  title: 'Performance & audit',
  dock: 'perf',
  render(ctx) { syncRun(ctx); return performanceHTML(ctx, verify); },
  after(wrap, ctx) {
    watchPanel(ctx.run);
    // arrow keys move between the tabs, as in the Why sheet
    const tl = wrap.querySelector('.tabs[role=tablist]');
    tl?.addEventListener('keydown', (e) => {
      const ev = /** @type {KeyboardEvent} */ (e);
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
      const tabs = /** @type {HTMLElement[]} */ ([...tl.querySelectorAll('[role=tab]')]);
      const i = tabs.indexOf(/** @type {HTMLElement} */ (ev.target));
      if (i < 0) return;
      const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      ev.preventDefault(); tabs[next].focus(); tabs[next].click();
    });
    if (ctx.params.tab === 'audit' && ctx.state.audit && verify.status === 'idle') runVerify(ctx); // the Files figure and the verified line come from the server
    drawSheet(ctx);
  },
  acts: {
    'performance.replay': (el, ctx) => {
      void ctx.run.load?.('rules')?.catch?.(() => undefined); // the names of the changed rule versions come from the Rules view
      void ctx.run.replay(el.dataset.v === 'with-current' ? 'with-current' : 'as-of-original');
    },
    'performance.full-replay': (_el, ctx) => { const rec = recommendation(ctx.state); if (rec) showWhy(ctx.run, rec.decisionId, 'replay'); },
    'performance.verify': (_el, ctx) => { verify = { status: 'idle' }; runVerify(ctx); },
    'performance.open-report': (el, ctx) => {
      watchPanel(ctx.run);
      opener = el; previewOpen = true;
      ctx.run.openPanel?.('audit'); // the Why sheet and the dock thread step aside; the page behind stays where it is
      if (verify.status === 'idle') runVerify(ctx);
      drawSheet(ctx);
    },
    'performance.close-report': () => closeSheet(),
  },
});
