/* Built from keel-prototype v1.2.3 public/prototype.js (PAGES.proposals board, proposalView, sections), adapted for adopt-keel-shell, reworked in polish-and-realism task 5 */
// Plan comparisons: the case board, and the comparison and outreach document (also mounted in Member detail at #member/<id>/outreach through
// outreachDocHTML). The document shows a status bar, the personalised plan comparison, the outreach message as it stands (with the compliance block when the
// gate blocked it), and in the right rail the approval card first, then the compliance check, the change log, the sources and the cost. Nothing here decides:
// it renders what the run store holds. Layout goes through public/ui/primitives.js, figures and dates through public/ui/format.js.
import { esc, nativeButton, registerPage, toast, top } from '../shell.js';
import { callout, chip, emptyState, factList, layerBadge, loadingState, secHead, statRow, statusPill, verified } from '../../ui/primitives.js';
import { dateLong, dateShort, dateTime, days, money } from '../../ui/format.js';
import { countyName, etDay, shortHash } from '../../js/format.js';
import { costLines, electionDates, memberName, prefText } from '../../js/labels.js';
import { planDataDate, stepIndex } from '../../js/steps.js';
import { decisionsOfKind, llmFor, nameOf, recommendation, stepStatus } from '../../js/state.js';
import { approvalHTML, CHANNEL, complianceHTML, complianceRailHTML, gateDecisions, roleLabel, whyButton } from '../../js/views-compliance.js';
import { candidatesTableHTML, draftCardHTML, executionHTML, progressHTML, provenanceHTML, stepBodyHTML } from '../../js/views-stage.js';
import { installWhySheet, whyActs } from '../../js/views-why.js';

/** @typedef {import('../shell.js').Ctx} Ctx */
/** @typedef {import('../../../shared/contracts.ts').CommunicationDraft} CommunicationDraft */

const LANES = /** @type {[string, string][]} */ ([['new', 'New'], ['reviewing', 'Reviewing'], ['outreach', 'Outreach'], ['follow-up', 'Follow-up']]);
const SOURCE_LABEL = /** @type {Record<string, string>} */ ({
  'plan-landscape': 'Plan data', formulary: 'Drug lists', 'provider-directory': 'Doctor networks', enrollment: 'Enrollment', crm: 'CRM records',
  comms: 'Communications', consent: 'Consent records', 'cms-params': 'Medicare figures', rules: 'Rules', llm: 'Model output',
});
/** Steps whose native button belongs in this page's header (the outreach part of the run). The gate and its re-check run inside these presses. */
const OUTREACH_STEPS = ['action.draft', 'action.rep-edit', 'human.approve'];
/** The word for a channel in "channel set to text". */
const CHANNEL_WORD = /** @type {Record<string, string>} */ ({ sms: 'text', email: 'email', phone: 'phone', mail: 'mail' });

/** "2026.2" for pack-2026.2 version 2026.2; the version is added only when it differs from the id. @param {{ id: string, version: string }} p */
export const packLabel = (p) => { const n = p.id.replace(/^pack-/, ''); return p.version && p.version !== n ? `${n}, version ${p.version}` : n; };
const isExplore = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'explore';
const lower = (/** @type {string} */ t) => t.charAt(0).toLowerCase() + t.slice(1);
const upper = (/** @type {string} */ t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Where the case stands, in words, read from the run's steps. A label for the board and the header; it decides nothing.
 * @param {any} s run state @returns {{ label: string, cls: 'good' | 'warn' | 'crit' | 'neutral' | 'accent', lane: string }}
 */
export function caseStatus(s) {
  const st = (/** @type {string} */ id) => stepStatus(s, id);
  const at = stepIndex(s.head);
  if (at < 0) return { label: 'New', cls: 'neutral', lane: 'new' };
  if (s.approval?.decision === 'rejected') return { label: 'Rejected · not sent', cls: 'neutral', lane: 'follow-up' };
  if (st('action.deliver') === 'done') return { label: 'Sent (simulated)', cls: 'neutral', lane: 'follow-up' };
  if (s.approval?.decision === 'approved') return { label: 'Approved to send', cls: 'neutral', lane: 'outreach' };
  if (st('human.approve') === 'waiting') return { label: 'Held for approval', cls: 'warn', lane: 'outreach' };
  if (st('action.gate-recheck') === 'done') return { label: 'Blocked · corrected', cls: 'warn', lane: 'outreach' };
  if (st('action.rep-edit') === 'done') return { label: 'Agent edited', cls: 'warn', lane: 'outreach' };
  if (st('action.gate') === 'done') return { label: 'Draft checked', cls: 'accent', lane: 'outreach' };
  if (st('action.draft') === 'started') return { label: 'Drafting…', cls: 'accent', lane: 'outreach' };
  if (st('action.draft') === 'done') return { label: 'Draft written', cls: 'accent', lane: 'outreach' };
  if (st('decision.recommend') === 'done') return { label: 'Plan recommended', cls: 'accent', lane: 'reviewing' };
  if (st('decision.recommend') === 'started') return { label: 'Checking plans…', cls: 'accent', lane: 'reviewing' };
  return { label: 'Gathering records', cls: 'accent', lane: 'new' };
}

// ---------- board ----------
/** The recommended candidate of the run, with its annual cost. @param {any} s */
function recommended(s) {
  const rec = recommendation(s);
  const id = rec?.outcome.type === 'plan-recommendation' ? rec.outcome.recommendedPlanId : null;
  return rec?.candidates?.find((/** @type {any} */ c) => c.planId === id) ?? null;
}

/** @param {Ctx} ctx */
function boardHTML(ctx) {
  const s = ctx.state, sc = s.scenario, story = ctx.run.views?.story;
  /** @type {Record<string, string[]>} */ const lanes = Object.fromEntries(LANES.map(([id]) => [id, []]));
  if (sc) {
    const stt = caseStatus(s);
    const ed = electionDates(s), best = recommended(s);
    const figures = [best?.estAnnualCost != null ? `Est. ${money(best.estAnnualCost)}/yr` : '', ed.aepEnd ? `AEP ${dateShort(ed.aepEnd)}` : ''].filter(Boolean).join(' · ');
    lanes[stt.lane].push(`<button type="button" class="card pcard" data-act="plans.open" data-v="${esc(sc.caseId)}" data-testid="case-${esc(sc.caseId)}" data-ctx-type="member" data-ctx-id="${esc(sc.beneficiary.id)}">` +
      `<span class="small muted">${esc(memberName(sc, 'short'))} · plan ends ${esc(dateLong(sc.currentPlan.endsOn))}</span><b>2027 options · ${esc(sc.currentPlan.name)} non-renewal</b>` +
      `<span><span class="pill ${stt.cls}" data-testid="case-status">${esc(stt.label)}</span></span>` +
      `<span class="ft"><span class="ui-num">${esc(figures)}</span></span></button>`);
  }
  for (const c of story?.cases ?? []) {
    const m = story.members.find((/** @type {any} */ x) => x.id === c.memberId);
    lanes[c.lane]?.push(`<div class="card pcard" data-testid="case-${esc(c.id)}"><span class="small muted">${esc(m?.name ?? '')}</span><b>${esc(c.title)}</b>` +
      `<span class="ft"><button type="button" class="link" data-act="member" data-v="${esc(c.memberId)}">Open member</button><span>Updated ${esc(dateShort(c.updatedAt.slice(0, 10)))}</span></span></div>`);
  }
  const cases = (sc ? 1 : 0) + (story?.cases?.length ?? 0);
  const waiting = s.steps['human.approve']?.status === 'waiting' && !s.approval;
  const sub = `${cases} ${cases === 1 ? 'case' : 'cases'}${waiting ? ' · 1 needs approval today' : ''}`;
  const data = planDataDate(s);
  return top('Plan comparisons', esc(sub), data ? chip(`Plan data ${data}`) : '') +
    `<div>${secHead('Cases')}<div class="board cmp-board" data-testid="case-board">${LANES.map(([id, label]) => `<div class="lane" data-lane="${id}"><h4><span>${esc(label)}</span><span class="num">${lanes[id].length}</span></h4>${lanes[id].join('')}</div>`).join('')}</div></div>`;
}

// ---------- the document ----------
/**
 * The decision on the document, read from the approval record: one verified line in the document's meta row ("Approved by Carol Sutton · Oct 20, 10:01 AM ET · Sent (simulated)"),
 * or a rejected line. Empty while nobody has decided. @param {Ctx} ctx
 */
function decisionLine(ctx) {
  const s = ctx.state, a = s.approval;
  if (!a) return '';
  const who = a.approver?.name ?? s.scenario.approver.name;
  // the case page already shows it in the header chip (case status): said once
  const sent = stepStatus(s, 'action.deliver') === 'done' && !ctx.params?.caseId ? ' · Sent (simulated)' : '';
  if (a.decision === 'approved') return `<div class="cmp-decision" data-testid="doc-decision">${verified(`Approved by ${who}`)}<span class="small muted">${esc(dateTime(a.at))}${sent}</span></div>`;
  return `<div class="cmp-decision" data-testid="doc-decision">${verified(`Rejected by ${who}`, { state: 'mismatch' })}<span class="small muted">${esc(dateTime(a.at))} · Not sent</span></div>`;
}

/**
 * What the send waits for, as one state banner: only while a person still has to act. A decision is the verified line in the header; before the rules ran there is nothing to say.
 * @param {Ctx} ctx
 */
function statusBar(ctx) {
  const s = ctx.state, sc = s.scenario, rec = recommendation(s);
  const name = sc.approver.name, role = lower(roleLabel(sc.approver.role));
  const supervisor = (ctx.role ?? ctx.ui?.role) === 'supervisor';
  let html = '';
  if (s.approval) html = '';
  else if (s.steps['human.approve']?.status === 'waiting') html = callout('warn', supervisor ? 'Awaiting your approval' : `Waiting for ${name}, ${role}`);
  else if (rec) html = callout('info', 'Needs supervisor approval');
  return html ? `<div class="cmp-status" data-testid="doc-status">${html}</div>` : '';
}

/** The latest message in the document, with the step that produced it. @param {Ctx} ctx */
function messageSection(ctx) {
  const s = ctx.state;
  const st = (/** @type {string} */ id) => stepStatus(s, id);
  const { blocked } = gateDecisions(s);
  const gate1 = decisionsOfKind(s, 'communication-gate')[0];
  const ai = s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).find((/** @type {CommunicationDraft} */ x) => x.author.kind === 'llm' && !/gated/.test(x.id));
  const human = s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).find((/** @type {CommunicationDraft} */ x) => x.author.kind === 'human' && !/-corrected$/.test(x.id));
  let step = 'action.draft', inner = '', revised = false, pill = '';
  if (st('action.gate-recheck') === 'done' && blocked) { step = 'action.gate-recheck'; inner = complianceHTML(ctx); revised = true; pill = 'Corrected by rules'; }
  else if (st('action.rep-edit') === 'done' && human) { step = 'action.rep-edit'; inner = stepBodyHTML(ctx, 'action.rep-edit'); pill = 'Agent edit'; }
  else if (st('action.gate') === 'done' && gate1) { step = 'action.gate'; inner = stepBodyHTML(ctx, 'action.gate'); revised = true; pill = 'Corrected by rules'; }
  else if (ai) {
    pill = 'Model draft';
    inner = draftCardHTML(s, ai, '') +
      `<details class="cmp-claims"><summary>Claims (${ai.claims.length})</summary><ul class="cmp-claim-list">${ai.claims.map((/** @type {any} */ c) => `<li><span>“${esc(c.text)}”</span></li>`).join('')}</ul></details>`;
  } else if (st('action.draft') === 'started') inner = progressHTML('Drafting the outreach');
  else inner = emptyState('No message yet');
  const edit = ctx.ui?.edit;
  const editor = edit ? `<div class="cmp-editor" data-testid="edit-form"><label>Message<textarea rows="9" data-testid="edit-body">${esc(edit.body)}</textarea></label>` +
    `<label>Channel<select data-testid="edit-channel"><option value="sms"${edit.channel === 'sms' ? ' selected' : ''}>Text message</option><option value="email"${edit.channel === 'email' ? ' selected' : ''}>Email</option></select></label>` +
    '<div class="cmp-row"><button type="button" class="btn pri" data-act="plans.edit-send" data-testid="edit-send">Re-check</button><button type="button" class="btn" data-act="plans.edit-cancel">Cancel</button></div>' +
    '<p class="muted small">Explore mode · not sent</p></div>'
    : (isExplore() && human ? '<div class="cmp-row"><button type="button" class="btn" data-act="plans.edit-open" data-testid="edit-open">Edit and re-check</button></div>' : '');
  const provLine = llmFor(s, step) || step !== 'action.draft' || ai ? provenanceHTML(s, step) : '';
  return `<section${revised ? ' class="rev"' : ''} data-testid="outreach-message">${secHead('Outreach message', { level: 3, right: pill ? `<span class="pill neutral">${esc(pill)}</span>` : '' })}${provLine}${inner}${editor}</section>`;
}

/** Her words, one row each: what she keeps, what she can pay, what she asked about, how to reach her (her contact preference and her consent together). @param {Ctx} ctx */
function heardSection(ctx) {
  const l = llmFor(ctx.state, 'signal.interpret');
  const r = /** @type {import('../../../shared/contracts.ts').InterpretResult | undefined} */ (l?.result);
  if (!r) return '';
  /** @type {Map<string, { values: string[], quotes: string[] }>} */ const rows = new Map();
  const add = (/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ quote) => {
    const row = rows.get(label) ?? { values: [], quotes: [] };
    if (value && !row.values.includes(value)) row.values.push(value);
    if (quote && !row.quotes.includes(quote)) row.quotes.push(quote);
    rows.set(label, row);
  };
  for (const p of r.preferences) { const t = prefText(p); add(t.label, t.value, p.quote); }
  for (const c of r.consentSignals) add('Contact by', `${c.channel === 'phone' ? 'Calls' : `${CHANNEL[c.channel] ?? c.channel}s`}: ${c.permission === 'revoke' ? 'revoked' : 'granted'}`, c.quote);
  const order = ['Keep', 'Premium', 'Interested in', 'Contact by'];
  const labels = [...rows.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return `<section data-testid="heard">${secHead('What we heard', { level: 3, badge: 'ai', meta: 'From her voicemail' })}` +
    factList(labels.map((k) => { const row = rows.get(k) ?? { values: [], quotes: [] }; return { label: k, value: upper(row.values.join(row.values.some((v) => v.includes(',')) ? ' · ' : ', ')), note: row.quotes.map((q) => `“${q}”`).join(' ') }; })) + '</section>';
}

/** @param {Ctx} ctx */
function comparisonSection(ctx) {
  const s = ctx.state, rec = recommendation(s);
  if (!rec) return `<section data-testid="comparison-wait">${secHead('Plan comparison', { level: 3, badge: 'rules' })}${emptyState('Not checked yet')}</section>`;
  return `<section data-testid="plan-comparison">${secHead('Plan comparison', { level: 3, badge: 'rules' })}
  <div class="ui-actions">${whyButton(rec.decisionId, 'Why this action?', 'btn')}</div>
  ${candidatesTableHTML(s, rec, { compact: true })}</section>`;
}

/** What a rule's edit is called in the change log. @param {string} id @param {string} title @param {any} cc */
function actionOf(id, title, cc) {
  if (id === 'MKT-COMPARATIVE') return 'Superlative removed';
  if (id === 'MKT-FREE' || id === 'MKT-MISLEADING') return 'Zero-cost claim corrected';
  if (id === 'CONSENT-CHANNEL') return `Channel moved to ${lower(CHANNEL[cc?.to] ?? 'email')}`;
  if (id.startsWith('DISC-')) return 'Disclosure added';
  return `Corrected: ${lower(title)}`;
}

/** @param {Ctx} ctx */
function changedCard(ctx) {
  const s = ctx.state;
  const gates = decisionsOfKind(s, 'communication-gate');
  /** @type {{ at: string, actor: string, action: string, detail: string[] }[]} */ const items = [];
  // each row carries the time its gate step ran (the timeline), not the trace's as-of time, so the log reads in the order things happened
  const ranAt = (/** @type {string} */ step) => s.timeline?.find((/** @type {any} */ x) => x.step === step)?.at;
  const fromGate = (/** @type {any} */ t, /** @type {string | undefined} */ at) => {
    const o = t?.outcome;
    if (o?.type !== 'communication-gate') return;
    /** @type {Map<string, { at: string, actor: string, action: string, detail: string[] }>} */ const by = new Map();
    /** @type {string[]} */ const none = [];
    for (const e of o.edits) {
      const title = t.ruleResults.find((/** @type {any} */ r) => r.ruleId === e.ruleId)?.title ?? e.ruleId;
      const action = actionOf(e.ruleId, title, o.channelChange);
      const row = by.get(action) ?? { at: at ?? t.asOf, actor: 'rules', action, detail: none.slice() };
      row.detail.push(e.before && e.after ? `<del>${esc(e.before)}</del> → <ins>${esc(e.after)}</ins>` : e.before ? `Removed <del>${esc(e.before)}</del>` : `Added <ins>${esc(e.after.trim())}</ins>`);
      by.set(action, row);
    }
    items.push(...by.values());
  };
  if (gates[0]) fromGate(gates[0], ranAt('action.gate'));
  const human = s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).find((/** @type {CommunicationDraft} */ x) => x.author.kind === 'human' && !/-corrected$/.test(x.id));
  if (human) items.push({ at: human.createdAt, actor: 'human', action: `Agent edit: channel set to ${CHANNEL_WORD[human.channel] ?? human.channel}`, detail: [`Edited by ${esc(s.scenario?.agent?.name ?? 'the agent')}, ${esc((s.scenario?.agent?.role ?? 'licensed-agent').replace(/-/g, ' '))}`] });
  const { blocked } = gateDecisions(s);
  if (blocked && blocked !== gates[0]) fromGate(blocked, ranAt('action.gate-recheck'));
  // two gates that did the same thing at the same minute are one change; their details are listed once
  /** @type {typeof items} */ const rows = [];
  for (const i of items) {
    const same = rows.find((r) => r.action === i.action && dateTime(r.at) === dateTime(i.at));
    if (same) same.detail.push(...i.detail.filter((d) => !same.detail.includes(d)));
    else rows.push({ ...i, detail: [...i.detail] });
  }
  items.splice(0, items.length, ...rows);
  if (!items.length) return '';
  return `<div class="card pad" data-testid="change-log">${secHead('Changes', { level: 3 })}<ul class="cmp-changes">${items.map((i) =>
    `<li><time class="small muted ui-num">${esc(dateTime(i.at))}</time>${layerBadge(i.actor)}<span class="cmp-act">${esc(i.action)}</span>` +
    `<details class="cmp-more"><summary>Details</summary><p class="small">${i.detail.join('<br>')}</p></details></li>`).join('')}</ul></div>`;
}

/** @param {Ctx} ctx */
function sourcesCard(ctx) {
  const s = ctx.state, rec = recommendation(s);
  if (!rec) return `<div class="card pad">${secHead('Sources', { level: 3 })}${emptyState('None yet')}</div>`;
  const bySystem = new Map();
  for (const r of rec.sourceRecords) bySystem.set(r.system, (bySystem.get(r.system) ?? 0) + 1);
  const snapDate = planDataDate(s);
  return `<div class="card pad" data-testid="sources-card">${secHead('Sources', { level: 3 })}<div class="chips">
  <span class="chip" title="${esc(rec.pack.hash)}">Rule pack ${esc(packLabel(rec.pack))}</span>
  ${snapDate ? `<span class="chip" title="${esc(rec.snapshot.hash)}">Plan data ${esc(snapDate)}</span>` : ''}
  ${[...bySystem].map(([k, n]) => `<span class="chip">${esc(SOURCE_LABEL[k] ?? k)} · ${n}</span>`).join('')}</div>
  <details class="cmp-more cmp-hashes"><summary>Hashes</summary><p class="small muted">Rule pack hash <code>${esc(shortHash(rec.pack.hash))}</code> · plan data hash <code>${esc(shortHash(rec.snapshot.hash))}</code> · decision as of ${esc(dateLong(etDay(rec.asOf)))}</p></details>
  <div class="sig-act">${whyButton(rec.decisionId, 'View sources', 'btn')}</div></div>`;
}

/** The formula text as a person writes it: × between factors, whole dollars. @param {string} t */
const formula = (t) => t.replace(/ x /g, ' × ').replace(/(\$[\d,]+)\.00\b/g, '$1');

/** @param {Ctx} ctx */
function costCard(ctx) {
  const s = ctx.state, rec = recommendation(s);
  if (!rec) return `<div class="card pad">${secHead('Cost', { level: 3 })}${emptyState('Not estimated yet')}</div>`;
  const cands = [...(rec.candidates ?? [])].filter((c) => c.estAnnualCost != null).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const ed = electionDates(s);
  const plan = (/** @type {any} */ c) => {
    const lines = costLines(rec.calculations, c);
    const get = (/** @type {string} */ k) => lines.find((x) => x.key === k);
    const rows = /** @type {[string, any][]} */ ([['Premium', get('premium')], ['Drugs', get('drugs')], ['Total', get('total')]]).filter(([, l]) => l);
    return `<div class="cmp-calc" data-plan="${esc(c.planId)}"><div class="cmp-calc-h"><b>${esc(nameOf(s, c.planId))}</b>${c.eligible ? '' : statusPill('excluded')}</div>` +
      `<table class="cmp-mini"><caption class="sr">Estimated annual cost of ${esc(nameOf(s, c.planId))}</caption><tbody>${rows.map(([label, l]) => `<tr${label === 'Total' ? ' class="is-total"' : ''}><th scope="row">${label}</th><td class="r ui-num" data-calc="${esc(l.key)}">${esc(money(l.value))}</td></tr>`).join('')}</tbody></table>` +
      `<details class="cmp-more"><summary>Calculation</summary><ul class="small cmp-formula">${lines.map((l) => `<li><span class="muted">${esc(l.label)}</span> ${esc(formula(l.text))}</li>`).join('')}</ul></details></div>`;
  };
  const [best, ...rest] = cands;
  const dayItems = [
    ed.aepEnd && ed.aepDays != null ? { label: 'Annual Enrollment Period', value: days(ed.aepDays), sub: `closes ${dateLong(ed.aepEnd)}` } : null,
    ed.noGapDate && ed.noGapDays != null ? { label: 'Latest no-gap date', value: days(ed.noGapDays), sub: dateLong(ed.noGapDate) } : null,
  ].filter((x) => x !== null);
  return `<div class="card pad" data-testid="cost-card">${secHead('Cost', { level: 3, meta: 'Estimated for 2027' })}${best ? plan(best) : ''}
  ${rest.length ? `<details class="cmp-others"><summary>Other plans (${rest.length})</summary>${rest.map(plan).join('')}</details>` : ''}
  ${dayItems.length >= 2 ? `<div class="cmp-days">${statRow(/** @type {any} */ (dayItems))}</div>` : ''}</div>`;
}

/**
 * The comparison and outreach document without a page header. Plan comparisons mounts it under its own header; Member detail mounts it at `#member/<id>/outreach`.
 * @param {Ctx} ctx
 */
export function outreachDocHTML(ctx) {
  const s = ctx.state, sc = s.scenario;
  if (!sc) return `<div data-testid="doc-loading">${loadingState('Loading', { lines: 4 })}</div>`;
  const showApproval = !!s.approval || !!s.steps['human.approve'];
  const last = s.draftOrder.length ? s.drafts[s.draftOrder[s.draftOrder.length - 1]] : null;
  const prepared = `Prepared by ${sc.agent.name}, ${sc.agent.role.replace(/-/g, ' ')} · ${last ? `Version ${s.draftOrder.length} · ${dateLong(last.createdAt)}` : 'No message yet'}`;
  return `<div class="docgrid" data-testid="outreach-doc">
  <div class="card doc cmp-doc"><header><div class="small muted">${esc(prepared)}</div>${decisionLine(ctx)}
    <h2>Your 2027 Medicare plan options</h2></header>
    ${statusBar(ctx)}${heardSection(ctx)}${comparisonSection(ctx)}${messageSection(ctx)}</div>
  <div class="col">${showApproval ? `<div class="card pad" data-testid="approval-section">${approvalHTML(ctx)}</div>` : ''}${s.approval?.decision === 'approved' ? `<div class="card pad" data-testid="approval-loop">${executionHTML(s, '')}</div>` : ''}${complianceRailHTML(ctx)}${changedCard(ctx)}${sourcesCard(ctx)}${costCard(ctx)}</div></div>`;
}
/** Nothing to wire after render: the editor is drawn with its value. Kept so a mounting page can call it. */
export function outreachDocAfter() {}

/** @param {Ctx} ctx @param {string} caseId */
function caseHTML(ctx, caseId) {
  const s = ctx.state, sc = s.scenario, story = ctx.run.views?.story;
  const back = '<button type="button" class="back" data-act="page" data-v="plans" data-testid="back-to-board">&larr; All cases</button>';
  if (!sc) return back + top('Plan comparison', '') + loadingState('Loading', { lines: 4 });
  if (caseId !== sc.caseId) {
    const c = story?.cases.find((/** @type {any} */ x) => x.id === caseId);
    const m = c && story.members.find((/** @type {any} */ x) => x.id === c.memberId);
    return back + top(esc(c?.title ?? 'Unknown case'), esc(m ? `${m.name} · ${countyName(m.county)}` : 'Case not found'), '') +
      '<div class="card pad" data-testid="sample-case">' + emptyState('No decision yet') +
      `<p class="muted">${c ? `<button type="button" class="link" data-act="member" data-v="${esc(c.memberId)}">Open member</button>` : ''}</p></div>`;
  }
  const stt = caseStatus(s);
  const buttons = OUTREACH_STEPS.map((id) => nativeButton(ctx, id)).join('');
  return back + top(`Plan comparison for ${esc(memberName(sc, 'short'))}`, `${esc(countyName(sc.beneficiary.county))}, ${esc(sc.beneficiary.state)} · ${esc(sc.currentPlan.name)} ends ${esc(dateLong(sc.currentPlan.endsOn))}`,
    `<span class="chip" data-testid="case-status">${esc(stt.label)}</span>${buttons}<button type="button" class="btn" data-act="member" data-v="${esc(sc.beneficiary.id)}">Member detail</button>`) + outreachDocHTML(ctx);
}

/** The page: the board, or one case. @param {Ctx} ctx */
export const render = (ctx) => (ctx.params.caseId ? caseHTML(ctx, ctx.params.caseId) : boardHTML(ctx));

// ---------- acts ----------
/** @param {HTMLElement} _el @param {Ctx} ctx */
const editOpen = (_el, ctx) => {
  const s = ctx.state;
  const d = s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).filter((/** @type {CommunicationDraft} */ x) => x.author.kind === 'human').pop() ?? s.drafts[s.draftOrder.at(-1)];
  if (d) ctx.run.setEdit({ draftId: d.id, body: d.body, channel: d.channel });
};
const ACTS = {
  ...whyActs,
  'plans.approve': async (/** @type {HTMLElement} */ el, /** @type {Ctx} */ ctx) => {
    try { await ctx.run.approve(el.dataset.v === 'rejected' ? 'rejected' : 'approved'); } catch (e) { toast(String(/** @type {Error} */ (e)?.message ?? e)); }
  },
  'plans.open': (/** @type {HTMLElement} */ el, /** @type {Ctx} */ ctx) => ctx.go('plans', { caseId: el.dataset.v }),
  'plans.edit-open': editOpen,
  'plans.edit-cancel': (/** @type {HTMLElement} */ _el, /** @type {Ctx} */ ctx) => ctx.run.setEdit(null),
  'plans.edit-send': (/** @type {HTMLElement} */ _el, /** @type {Ctx} */ ctx) => {
    const box = /** @type {HTMLTextAreaElement | null} */ (document.querySelector('[data-testid="edit-body"]'));
    const ch = /** @type {HTMLSelectElement | null} */ (document.querySelector('[data-testid="edit-channel"]'));
    if (box) void ctx.run.edit(box.value, ch?.value ?? 'email');
  },
};

registerPage({
  id: 'plans',
  title: 'Plan comparisons',
  render,
  after: (_el, ctx) => { installWhySheet(ctx.run); },
  acts: ACTS,
});

if (typeof document !== 'undefined') {
  // The unsent edit lives in the run store: typing updates it in place (no re-render, so the caret stays), and it survives navigation.
  const keep = (/** @type {Event} */ ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const edit = /** @type {any} */ (window).__siq?.run?.ui?.edit;
    if (!edit || !t?.dataset) return;
    if (t.dataset.testid === 'edit-body') edit.body = /** @type {HTMLTextAreaElement} */ (t).value;
    else if (t.dataset.testid === 'edit-channel') edit.channel = /** @type {HTMLSelectElement} */ (t).value;
  };
  document.addEventListener('input', keep);
  document.addEventListener('change', keep);
  const run = /** @type {any} */ (window).__siq?.run;
  if (run) installWhySheet(run);
}
