// "Why this action?" as a Keel side sheet (change adopt-keel-shell, task 5.2; polish-and-realism, tasks 6.1 to 6.4). Everything comes from the server's
// DecisionTrace and the run's records, never from a model. Three tabs: Summary (the rules that fired, last year's decision replayed, required disclosures,
// approver, versions), Evidence (sources, facts, relationships, the rule by plan matrix) and Replay (both outcomes with every change).
// The sheet lives in #why-sheet (outside #main) and is drawn from run.ui.whyId and run.ui.whyTab, so it stays open across navigation and the role toggle.
import { esc } from '../keel/shell.js';
import { CHECK } from '../ui/icons.js';
import { callout, factList, idCode, layerBadge, loadingState, secHead, sheetHead, statRow, verified } from '../ui/primitives.js';
import { count, dateLong, dateTime, plural, shortHash } from '../ui/format.js';
import { RELATION_VERB, draftLabel, gateTitle, shortNames } from './labels.js';
import { groupFacts, outcomeTitle, packNo, replaySummaryHTML, replaysOf, snapshotDay, sourceLabel } from './replay-format.js';
import { humanize } from './format.js';
import { nameOf } from './state.js';
import { roleLabel } from './views-compliance.js';

export { outcomeTitle };

/** @typedef {import('../../shared/contracts.ts').DecisionTrace} DecisionTrace */
/** @typedef {import('../../shared/contracts.ts').ReplayResult} ReplayResult */
/** @typedef {{ state: any, ui: any, views?: any }} WhyCtx */
/** @typedef {'summary' | 'evidence' | 'replay'} WhyTab */

const KIND_TEXT = /** @type {Record<string, string>} */ ({ 'plan-recommendation': 'Plan recommendation', 'next-action': 'Next action' });
const TAB_LABEL = /** @type {Record<WhyTab, string>} */ ({ summary: 'Summary', evidence: 'Evidence', replay: 'Replay' });
const ATTN_MAX = 4;

/** The tabs a decision has: only a recommendation can be replayed. @param {DecisionTrace} t @returns {WhyTab[]} */
const tabsOf = (t) => (t.kind === 'plan-recommendation' ? ['summary', 'evidence', 'replay'] : ['summary', 'evidence']);
/** @param {WhyCtx} ctx @param {DecisionTrace} t @returns {WhyTab} */
const tabOf = (ctx, t) => (tabsOf(t).includes(ctx.ui.whyTab) ? ctx.ui.whyTab : 'summary');

/** A named block of the sheet. @param {string} id @param {string} head secHead markup @param {string} body */
const section = (id, head, body) => `<section class="why-sec" data-section="${id}">${head}${body}</section>`;
const sh = (/** @type {string} */ title, /** @type {{ meta?: string }} */ o = {}) => secHead(title, { level: 3, ...o });

/** Server-written sentences keep their words; whole dollars lose a trailing ".00" ("$30.00" reads "$30"). @param {string} text */
const tidy = (text) => shortNames(text).replace(/\$(\d{1,3}(?:,\d{3})+|\d+)\.00\b/g, '$$$1');

/** Plan columns carry the plan name without the carrier word: "Advantage Plus (HMO)". @param {string} n */
const shortPlan = (n) => n.replace(/^\S+\s+/, '');

// ---------- status words that follow the record ----------
/** The approval that covers this decision: it names the decision or its draft. She approved the corrected draft, not the agent's blocked edit. @param {any} s @param {DecisionTrace} t */
const coveringApproval = (s, t) => {
  const a = s.approval, ids = a?.subjectIds ?? [];
  return a && (ids.includes(t.decisionId) || (t.outcome.type === 'communication-gate' && ids.includes(t.outcome.draftId))) ? a : null;
};
/** The state with only the approval that covers this decision, so every status word below follows the decision itself. @param {any} s @param {DecisionTrace} t */
const scoped = (s, t) => { const approval = coveringApproval(s, t); return { ...s, approval, replaced: !approval && isReplaced(s, t) }; };
/** A gate whose message was replaced: someone approved a different draft, or a later gate decision took over. @param {any} s @param {DecisionTrace} t */
function isReplaced(s, t) {
  if (t.outcome.type !== 'communication-gate') return false;
  const i = s.decisions.indexOf(t);
  return !!s.approval || (t.outcome.verdict === 'held-for-approval' && s.decisions.slice(i + 1).some((/** @type {DecisionTrace} */ d) => d.kind === 'communication-gate'));
}
/** The one definition of "Replaced" for a gate decision, shared by the Why sheet and Performance: no approval covers it and it is replaced. @param {any} s @param {DecisionTrace} t */
export const isReplacedGate = (s, t) => !coveringApproval(s, t) && isReplaced(s, t);
/** What the supervisor did, or null while nothing is decided. @param {any} s */
const decisionOf = (s) => (s.approval?.decision === 'approved' ? 'Approved' : s.approval?.decision === 'rejected' ? 'Rejected' : null);
/** The word for a rule that routes to a person: "Needs approval" until someone decided, then what they decided. @param {any} s */
const holdWord = (s) => decisionOf(s) ?? 'Approval required'; // the rule asked for a person; the draft it asked about was replaced (the header says Replaced), so the rule is not "Replaced" itself
/** The verdict of a gate decision, worded from the gate outcome and the current approval. @param {any} s @param {any} o */
function gateStatus(s, o) {
  if (o.verdict === 'blocked') return `Blocked · ${plural(o.violations.length, 'rule')} failed`;
  if (o.verdict === 'pass') return 'Passed';
  return decisionOf(s) ?? (s.replaced ? 'Replaced' : 'Held for approval');
}
/** A rule id: one mono token that never wraps; the legacy rule-id class stays because other suites select it. @param {string} id */
const ruleId = (id) => idCode(id, { cls: 'rule-id', title: `Rule ${id}` });

// ---------- header ----------
/** @param {WhyCtx} ctx @param {DecisionTrace} t @param {WhyTab} tab */
function headHTML(ctx, t, tab) {
  const s = ctx.state;
  const gate = t.outcome.type === 'communication-gate';
  const provLine = `<p class="ui-prov" data-testid="provenance" data-actor="rules">${layerBadge('rules')}<span class="small muted">${idCode(t.decisionId)} · ${esc(dateTime(t.asOf))}</span></p>`;
  return sheetHead({
    eyebrow: gate ? gateStatus(scoped(s, t), t.outcome) : KIND_TEXT[t.kind] ?? t.kind,
    title: gate ? gateTitle(t.decisionId) : outcomeTitle(s, t), titleId: 'why-title', prov: provLine, closeAct: 'why.close', closeTestid: 'why-close',
  }) + `
  <div class="why-tabbar"><div class="seg why-tabs" role="tablist" aria-label="Sections of this sheet">${tabsOf(t).map((id) =>
    `<button type="button" role="tab" id="why-tab-${id}" class="why-tab" data-act="why.tab" data-v="${id}" data-testid="why-tab-${id}" aria-selected="${id === tab}" aria-controls="why-panel" tabindex="${id === tab ? 0 : -1}">${esc(TAB_LABEL[id])}</button>`).join('')}</div></div>`;
}

// ---------- Summary ----------
/** The mark of a rule result: an icon and the words a screen reader hears. A hold reads as what the supervisor decided once someone did. @param {any} s */
const markOf = (s) => ({
  pass: { icon: CHECK, text: 'Passed' }, fail: { icon: '✕', text: 'Failed' }, hold: decisionOf(s) === 'Approved' ? { icon: CHECK, text: 'Approved' } : { icon: s.replaced ? '–' : '!', text: holdWord(s) },
  not_applicable: { icon: '–', text: 'Not applicable' },
  corrected: { icon: CHECK, text: 'Corrected' },
});
/**
 * What a rule result is for a reader: a hold is not a failure, it sends the message to a person; a required disclosure that was missing and that the gate added by rule is "corrected"
 * (it did fail, and the message in force no longer does). Reads the gate's own edits, so the counts are the data (final review 7.9, P2 b).
 * @param {DecisionTrace} t @returns {(r: DecisionTrace['ruleResults'][number]) => 'pass' | 'fail' | 'hold' | 'not_applicable' | 'corrected'}
 */
function stateFn(t) {
  const added = new Set(t.outcome.type === 'communication-gate' ? t.outcome.edits.filter((e) => e.ruleId.startsWith('DISC-')).map((e) => e.ruleId) : []);
  return (r) => (r.outcome === 'fail' && r.severity === 'hold' ? (added.has(r.ruleId) ? 'corrected' : 'hold') : /** @type {'pass' | 'fail' | 'not_applicable'} */ (r.outcome));
}

/** @param {WhyCtx} ctx @param {DecisionTrace} t */
function rulesSummaryHTML(ctx, t) {
  const s = scoped(ctx.state, t), MARK = markOf(s), stateOfRule = stateFn(t);
  const results = t.ruleResults;
  const n = (/** @type {string} */ st) => results.filter((r) => stateOfRule(r) === st).length;
  const pass = n('pass'), fail = n('fail'), hold = n('hold'), na = n('not_applicable'), corr = n('corrected');
  const attention = [...results.filter((r) => stateOfRule(r) === 'fail'), ...results.filter((r) => stateOfRule(r) === 'hold'), ...results.filter((r) => stateOfRule(r) === 'corrected')];
  const row = (/** @type {DecisionTrace['ruleResults'][number]} */ r) => {
    const st = stateOfRule(r);
    const done = st === 'hold' && decisionOf(s) === 'Approved';
    return `<li class="why-attn is-${st}${done ? ' is-approved' : ''}${st === 'hold' && s.replaced ? ' is-replaced' : ''}" data-rule="${esc(r.ruleId)}" data-outcome="${st}"><span class="why-mark" aria-hidden="true">${MARK[st].icon}</span>${st === 'corrected' ? '' : `<span class="sr">${MARK[st].text}: </span>`}<span class="why-attn-t">${st === 'corrected' ? '<span class="why-attn-k">Corrected:</span> ' : ''}${esc(tidy(r.message))}</span>${ruleId(r.ruleId)}</li>`;
  };
  const list = attention.length
    ? `<ul class="why-attn-list">${attention.slice(0, ATTN_MAX).map(row).join('')}</ul>` +
      (attention.length > ATTN_MAX ? `<details class="why-more"><summary>Show ${attention.length - ATTN_MAX} more</summary><ul class="why-attn-list">${attention.slice(ATTN_MAX).map(row).join('')}</ul></details>` : '')
    : verified('All applicable rules passed');
  // a stat row holds at most five: with a corrected rule on the sheet, "Not applicable" moves under "Rules applied" (the figures still add up)
  const stats = [
    { label: 'Rules applied', value: count(pass + fail + hold + corr), sub: `of ${count(results.length)}` }, { label: 'Passed', value: count(pass) },
    ...(corr ? [{ label: 'Corrected', value: count(corr) }] : []),
    { label: holdWord(s), value: count(hold) }, { label: 'Failed', value: count(fail) }, { label: 'Not applicable', value: count(na) },
  ];
  // the sixth figure does not fit a tile: it gets a line of its own under the row, with the same neutral dash as a Not applicable result elsewhere (final review 8, P2)
  const naLine = stats.length > 5 ? `<p class="small muted why-na" data-testid="why-na-count"><span aria-hidden="true">${MARK.not_applicable.icon}</span> ${count(na)} not applicable</p>` : '';
  if (stats.length > 5) stats.pop();
  return section('rules', sh('Rules'), statRow(stats, { size: 'sm' }) + naLine + list);
}

/** One row that opens the Replay tab: the replay lives in the Replay tab and on Performance > Audit packages only. */
const replayLinkHTML = () => section('replay', '', '<button type="button" class="why-link" data-act="why.tab" data-v="replay" data-testid="why-replay-link">Replay last year’s decision <span aria-hidden="true">→</span></button>');

/** The disclosures the outreach message must carry. @param {WhyCtx} ctx @param {DecisionTrace} t */
function disclosuresHTML(ctx, t) {
  const head = sh('Disclosures', t.kind === 'plan-recommendation' ? { meta: 'Outreach' } : {});
  if (t.kind !== 'plan-recommendation') {
    const items = t.requiredDisclosures.map((id) => {
      const r = t.ruleResults.find((x) => x.ruleId === id), e = t.outcome.type === 'communication-gate' ? t.outcome.edits.find((x) => x.ruleId === id) : null;
      return `<li>${ruleId(id)} <b>${esc(r?.title ?? '')}</b>${e?.after ? `<blockquote class="why-disc">${esc(e.after.trim())}</blockquote>` : '<span class="muted small"> On send</span>'}</li>`;
    });
    return section('disclosures', head, `<div data-testid="why-disclosures">${items.length ? `<ul class="why-list">${items.join('')}</ul>` : '<p class="muted">None required.</p>'}</div>`);
  }
  const rules = ctx.views?.rules;
  if (!rules) return section('disclosures', head, `<div data-testid="why-disclosures">${loadingState('Loading', { lines: 2 })}</div>`);
  const planId = t.outcome.type === 'plan-recommendation' ? t.outcome.recommendedPlanId : null;
  const items = /** @type {{ planId: string, disclosureId: string, text: string }[]} */ (rules.outreachDisclosures ?? []).filter((d) => d.planId === planId);
  const gate = gateOfRecommendation(ctx.state);
  return section('disclosures', head, `<div data-testid="why-disclosures">${items.length
    ? `<ul class="why-list">${items.map((d) => `<li>${ruleId(d.disclosureId)}<span class="why-disc-t">${esc(d.text)}</span></li>`).join('')}</ul>` +
      (gate ? `<button type="button" class="why-link why-gate-link" data-act="why" data-v="${esc(gate.decisionId)}" data-testid="why-gate-link">Message gate decision <span aria-hidden="true">→</span></button>` : '')
    : '<p class="muted">None required.</p>'}</div>`);
}

/** The gate decision the message in force went through: the one the approval covers, else the one held for approval, else the latest. Never the superseded first draft. @param {any} s */
export function gateOfRecommendation(s) {
  const gates = /** @type {DecisionTrace[]} */ (s.decisions).filter((d) => d.kind === 'communication-gate');
  return gates.find((d) => coveringApproval(s, d)) ?? [...gates].reverse().find((d) => d.outcome.type === 'communication-gate' && d.outcome.verdict === 'held-for-approval') ?? gates[gates.length - 1] ?? null;
}

/** @param {WhyCtx} ctx @param {DecisionTrace} t */
function approverHTML(ctx, t) {
  const approval = coveringApproval(ctx.state, t), sc = ctx.state.scenario;
  if (approval) {
    const ok = approval.decision === 'approved';
    return section('approver', sh('Approver'), verified(ok ? 'Approved' : 'Rejected', { state: ok ? 'verified' : 'mismatch' }) + factList([
      { label: 'Approver', value: `${approval.approver.name}, ${roleLabel(approval.approver.role).toLowerCase()}` },
      { label: 'Time', value: dateTime(approval.at) },
    ], { max: 2 }) + `<q class="why-quote">${esc(approval.attestation)}</q>`);
  }
  // an approval that exists but covers another draft: this one was replaced by the corrected draft
  const other = scoped(ctx.state, t).replaced;
  return section('approver', sh('Approver'), `<p class="muted">${t.kind === 'next-action' ? 'None' : other ? 'Not sent · replaced by the corrected draft' : `Pending · ${esc(sc?.approver.name ?? 'the supervisor')}`}</p>`);
}

/** @param {DecisionTrace} t */
function versionsHTML(t) {
  const cell = (/** @type {string} */ k, /** @type {string} */ v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const hash = (/** @type {string} */ h) => idCode(shortHash(h), { title: h, cls: 'why-hash' });
  return section('versions', sh('Versions'), `<dl class="ui-kv why-ver">${cell('Rule pack', esc(packNo(t.pack)))}${cell('Data snapshot', esc(snapshotDay(t.snapshot.id) ?? t.snapshot.id))}${cell('Trace hash', hash(t.traceHash))}</dl>
    <details class="why-more"><summary>All hashes</summary><dl class="ui-kv why-ver">${cell('Pack hash', hash(t.pack.hash))}${cell('Data hash', hash(t.snapshot.hash))}${cell('Input hash', hash(t.inputHash))}${cell('Trace hash', hash(t.traceHash))}</dl></details>`);
}


// ---------- replay ----------
/** @param {WhyCtx} ctx @param {{ full?: boolean }} [o] */
function replayHTML(ctx, o = {}) {
  const { state, ui } = ctx;
  const ruleTitle = ruleTitleOf(ctx);
  return `<section class="why-sec" data-section="replay">${sh('Replay last year’s decision')}
  ${replaySummaryHTML(replaysOf(ui), { state, ruleTitle, full: o.full, controls: { act: 'why.replay', ids: { original: 'replay-original', current: 'replay-current' }, busy: ui.replayBusy } })}
  ${ui.replayBusy ? '<p class="why-busy" role="status"><span class="stage-spinner" aria-hidden="true"></span>Replaying…</p>' : ''}
  ${ui.replayError ? callout('block', ui.replayError) : ''}</section>`;
}

/** Rule names for the changed versions, from the Rules view once it has loaded. @param {WhyCtx} ctx */
function ruleTitleOf(ctx) {
  const packs = /** @type {{ rules: { id: string, title: string }[] }[]} */ (ctx.views?.rules?.packs ?? []);
  return (/** @type {string} */ id) => { for (const p of packs) { const r = p.rules.find((x) => x.id === id); if (r) return r.title; } return undefined; };
}

// ---------- Evidence ----------
/** @param {DecisionTrace} t */
function sourcesHTML(t) {
  const by = new Map();
  for (const r of t.sourceRecords) by.set(r.system, (by.get(r.system) ?? 0) + 1);
  return section('sources', sh('Sources', { meta: `${count(t.sourceRecords.length)} records` }),
    `<p class="why-chips">${[...by].map(([k, n]) => `<span class="chip">${esc(sourceLabel(k))} · ${count(n)}</span>`).join('')}</p>` +
    `<details class="why-more"><summary>Records</summary><ul class="why-list">${t.sourceRecords.map((r) => `<li><span class="chip">${esc(sourceLabel(r.system))}</span> ${esc(r.label)}</li>`).join('')}</ul></details>`);
}

/** @param {any} s @param {DecisionTrace} t */
function factsHTML(s, t) {
  const groups = groupFacts(t.facts, (id) => nameOf(s, id));
  return section('facts', sh('Facts', { meta: `${count(t.facts.length)} in ${groups.length} groups` }), groups.map((g) =>
    `<details class="why-group" data-count="${g.rows.length}"><summary><span>${esc(g.group)}</span><span class="why-count">${count(g.rows.length)}</span></summary>
    <div class="tbl-wrap"><table><thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>${g.rows.map((r) =>
    `<tr><td>${esc(r.label)}${r.quote ? `<q class="why-quote">${esc(r.quote)}</q>` : ''}</td><td class="why-val">${esc(r.value)}</td><td><span class="chip" title="${esc(r.sourceTitle)}">${esc(r.origin === 'llm-extracted' ? 'AI-extracted' : r.source)}</span></td></tr>`).join('')}</tbody></table></div></details>`).join(''));
}

/** @param {any} s @param {DecisionTrace} t */
function relationsHTML(s, t) {
  return section('relations', sh('Relationships', { meta: count(t.relations.length) }),
    `<ul class="why-list why-rel">${t.relations.map((r) => `<li>${esc(nameOf(s, r.from))} ${esc(RELATION_VERB[r.type] ?? humanize(r.type))} ${esc(nameOf(s, r.to))}<span class="muted small"> from ${esc(dateLong(r.validFrom))}${r.validTo ? ` to ${esc(dateLong(r.validTo))}` : ''}</span></li>`).join('')}</ul>`);
}

/** Rules by plan: a row per rule, failures and holds first, a mark per cell that says its state in words for a screen reader. @param {any} s @param {DecisionTrace} t */
function matrixHTML(s, t) {
  const sv = scoped(s, t), MARK = markOf(sv);
  const subjects = [...new Set(t.ruleResults.map((r) => r.subject).filter((x) => x && x !== 'case'))];
  const hasCase = t.ruleResults.some((r) => !r.subject || r.subject === 'case');
  // a gate decision checks drafts: the column says which version of the message, not the draft id
  const isDraft = (/** @type {string} */ p) => /^draft-\d+(-corrected)?$/.test(p);
  const colName = (/** @type {string} */ p) => (isDraft(p) ? draftLabel(p) : nameOf(s, p));
  const colHead = (/** @type {string} */ p) => (isDraft(p) ? draftLabel(p) : shortPlan(nameOf(s, p)));
  const ids = [...new Set(t.ruleResults.map((r) => r.ruleId))];
  const stateOfRule = stateFn(t);
  const rank = /** @type {Record<string, number>} */ ({ fail: 0, hold: 1, corrected: 2, pass: 3, not_applicable: 4 });
  const cellOf = (/** @type {string} */ id, /** @type {string | null} */ subject) => t.ruleResults.find((r) => r.ruleId === id && (subject ? r.subject === subject : !r.subject || r.subject === 'case'));
  const rows = ids.map((id) => {
    const cells = [...(hasCase ? [null] : []), ...subjects].map((sub) => cellOf(id, /** @type {string | null} */ (sub ?? null)));
    const worst = cells.filter(Boolean).map((c) => stateOfRule(/** @type {any} */ (c))).sort((a, b) => rank[a] - rank[b])[0] ?? 'not_applicable';
    const title = t.ruleResults.find((r) => r.ruleId === id)?.title ?? id;
    return { id, title, cells, worst };
  }).sort((a, b) => rank[a.worst] - rank[b.worst]);
  const td = (/** @type {any} */ r) => {
    if (!r) return '<td class="why-cell is-none"><span aria-hidden="true">–</span><span class="sr">Not evaluated</span></td>';
    const st = stateOfRule(r);
    return `<td class="why-cell is-${st}${st === 'hold' && decisionOf(sv) === 'Approved' ? ' is-approved' : ''}${st === 'hold' && sv.replaced ? ' is-replaced' : ''}" title="${esc(tidy(r.message))}"><span aria-hidden="true">${MARK[st].icon}</span><span class="sr">${MARK[st].text}</span></td>`;
  };
  return section('rules', sh('Rules', { meta: `${count(ids.length)} rules` }),
    `<div class="tbl-wrap why-matrix" tabindex="0" role="region" aria-label="Rules by plan"><table><thead><tr><th scope="col">Rule</th>${hasCase ? '<th scope="col" class="why-colh">Case</th>' : ''}${subjects.map((p) => `<th scope="col" class="why-colh" title="${esc(colName(/** @type {string} */ (p)))}">${esc(colHead(/** @type {string} */ (p)))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr data-rule="${esc(r.id)}" data-worst="${r.worst}"><th scope="row"><span class="why-rule-t">${esc(r.title)}</span>${ruleId(r.id)}</th>${r.cells.map(td).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="why-legend small muted"><span aria-hidden="true">${CHECK}</span> Passed · <span aria-hidden="true">✕</span> Failed · <span aria-hidden="true">${MARK.hold.icon}</span> ${holdWord(sv)}${rows.some((r) => r.worst === 'corrected' || r.cells.some((c) => c && stateOfRule(c) === 'corrected')) ? ' · <span aria-hidden="true">' + CHECK + '</span> Corrected' : ''} · <span aria-hidden="true">–</span> Not applicable</p>`);
}

// ---------- the sheet body ----------
/** The whole sheet body for one trace. @param {WhyCtx} ctx @param {DecisionTrace} t */
export function whyHTML(ctx, t) {
  const s = ctx.state;
  const tab = tabOf(ctx, t);
  const panel = tab === 'summary'
    ? rulesSummaryHTML(ctx, t) + (t.kind === 'plan-recommendation' ? replayLinkHTML() : '') + `<div class="why-pair">${disclosuresHTML(ctx, t)}${approverHTML(ctx, t)}</div>` + versionsHTML(t)
    : tab === 'evidence'
      ? sourcesHTML(t) + factsHTML(s, t) + relationsHTML(s, t) + matrixHTML(s, t)
      : replayHTML(ctx, { full: true });
  return `${headHTML(ctx, t, tab)}<div class="why-body" data-testid="why-body" data-tab="${tab}"><div id="why-panel" class="why-panel" role="tabpanel"${tab === 'summary' ? ' data-testid="why-summary"' : ''} aria-labelledby="why-tab-${tab}">${panel}</div></div>`;
}

// ---------- the sheet (side panel in #why-sheet) ----------
/** What to focus when the sheet closes: where the opener sat, found again after the page re-rendered. @param {Element | null} el */
function openerKey(el) {
  const b = el && /** @type {HTMLElement} */ (el).closest?.('[data-act]');
  if (!b) return null;
  const host = b.parentElement?.closest('[data-testid]');
  return { act: b.getAttribute('data-act'), v: b.getAttribute('data-v'), host: host?.getAttribute('data-testid') ?? null, testid: b.getAttribute('data-testid') };
}
/** @param {ReturnType<typeof openerKey>} k */
function findOpener(k) {
  if (!k) return null;
  const q = `[data-act="${k.act}"]${k.v ? `[data-v="${CSS.escape(k.v)}"]` : ''}`;
  return (k.host && document.querySelector(`#main [data-testid="${CSS.escape(k.host)}"] ${q}`)) || document.querySelector(`#main ${q}`);
}

/** @type {WeakMap<HTMLElement, string>} */
const drawn = new WeakMap();
/** @type {WeakMap<HTMLElement, number>} */
const shown = new WeakMap();
/** @type {WeakMap<HTMLElement, string>} the decision the body was last drawn for: a sheet opened on another decision starts at the top */
const drawnFor = new WeakMap();
const replayCount = (/** @type {any} */ ui) => { const r = replaysOf(ui); return (r.original ? 1 : 0) + (r.current ? 1 : 0); };

/** Draws the sheet into `el` from the run store. Returns whether it is open. @param {HTMLElement} el @param {WhyCtx} ctx */
export function renderWhySheet(el, ctx) {
  const t = ctx.state.decisions.find((/** @type {DecisionTrace} */ d) => d.decisionId === ctx.ui.whyId);
  if (!t) { if (!el.hidden) { el.hidden = true; el.replaceChildren(); drawn.delete(el); shown.delete(el); drawnFor.delete(el); } return false; }
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'why-title');
  const html = whyHTML(ctx, t);
  const body = el.querySelector('.why-body');
  const top = body && body.getAttribute('data-tab') === tabOf(ctx, t) && drawnFor.get(el) === t.decisionId ? body.scrollTop : 0;
  const keep = el.contains(document.activeElement) ? /** @type {HTMLElement} */ (document.activeElement) : null;
  const fk = keep ? (keep.dataset.testid ? `[data-testid="${CSS.escape(keep.dataset.testid)}"]` : keep.dataset.act ? `[data-act="${CSS.escape(keep.dataset.act)}"]${keep.dataset.v ? `[data-v="${CSS.escape(keep.dataset.v)}"]` : ''}` : null) : null;
  if (drawn.get(el) !== html) { el.innerHTML = html; drawn.set(el, html); }
  el.hidden = false;
  drawnFor.set(el, t.decisionId);
  const nb = el.querySelector('.why-body'); if (nb) nb.scrollTop = top;
  if (fk) /** @type {HTMLElement | null} */ (el.querySelector(fk))?.focus({ preventScroll: true });
  // a replay result that just arrived is brought into view, clear of the header
  const n = replayCount(ctx.ui);
  if (n > (shown.get(el) ?? 0)) el.querySelector('[data-section=replay]')?.scrollIntoView({ block: 'start' });
  shown.set(el, n);
  return true;
}

/** @type {() => void} */
let redraw = () => {};

/** Acts of the sheet; plans.js merges them into its page definition (page acts are looked up across all pages). */
export const whyActs = {
  'why.close': (/** @type {HTMLElement} */ _el, /** @type {any} */ ctx) => ctx.run.closeWhy(),
  'why.tab': (/** @type {HTMLElement} */ el, /** @type {any} */ ctx) => { ctx.run.ui.whyTab = el.dataset.v ?? 'summary'; redraw(); },
  'why.replay': (/** @type {HTMLElement} */ el, /** @type {any} */ ctx) => {
    if (ctx.run.ui.replayBusy) return;
    void ctx.run.load?.('rules')?.catch?.(() => undefined); // the names of the changed rule versions come from the Rules view
    void ctx.run.replay(el.dataset.v === 'with-current' ? 'with-current' : 'as-of-original');
  },
};

/** Opens the sheet on a decision, on the given tab (the Performance replay card opens it on 'replay'). @param {any} run @param {string} decisionId @param {WhyTab} [tab] */
export function showWhy(run, decisionId, tab = 'summary') { run.ui.whyTab = tab; run.openWhy(decisionId); }

let installed = false;
/** Wire the sheet to the run store once: redraw on every change, Esc closes, arrow keys move between tabs, focus moves in on open and back to the opener on close. @param {any} run */
export function installWhySheet(run) {
  if (installed || typeof document === 'undefined') return;
  const el = document.getElementById('why-sheet'); if (!el) return;
  installed = true;
  el.hidden = true; el.tabIndex = -1;
  /** @type {ReturnType<typeof openerKey>} */ let opener = null;
  let wasOpen = false, refocus = false;
  const draw = () => {
    const open = renderWhySheet(el, run);
    if (open && !run.views?.rules) void run.load?.('rules')?.catch?.(() => undefined); // required disclosures come from the Rules view
    if (open && !wasOpen) { opener = openerKey(document.activeElement); /** @type {HTMLElement | null} */ (el.querySelector('[data-testid="why-close"]'))?.focus({ preventScroll: true }); }
    if (!open && wasOpen) { refocus = true; run.ui.whyTab = 'summary'; setTimeout(restore, 120); }
    wasOpen = open;
  };
  redraw = draw;
  const restore = () => { if (!refocus) return; refocus = false; /** @type {HTMLElement | null} */ (findOpener(opener))?.focus({ preventScroll: true }); };
  run.subscribe(draw);
  // the shell re-renders the page one frame after a change: give focus back after that render
  document.addEventListener('siq:render', () => { if (refocus) restore(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && wasOpen) { ev.stopPropagation(); run.closeWhy(); } });
  el.addEventListener('keydown', (ev) => {
    const tab = /** @type {HTMLElement} */ (ev.target).closest?.('[role=tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const tabs = [...el.querySelectorAll('[role=tab]')];
    const i = tabs.indexOf(tab);
    const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    ev.preventDefault();
    run.ui.whyTab = /** @type {HTMLElement} */ (tabs[next]).dataset.v ?? 'summary';
    draw();
    /** @type {HTMLElement | null} */ (el.querySelector('[role=tab][aria-selected=true]'))?.focus({ preventScroll: true });
  });
  draw();
}

/** Adapter for the retired V0 public/js/main.js, which still imports this name; delete it together with that file. @param {HTMLElement} el @param {any} s @param {any} app */
export function renderWhy(el, s, app) {
  renderWhySheet(el, { state: s, ui: { whyId: app.whyId, replay: app.replayResult, replayBusy: app.replayBusy, replayError: app.replayError } });
}
