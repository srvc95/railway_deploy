/* Copied from keel-prototype v1.2.3 public/prototype.js (dossier, treeHTML, .facts, .brief, .grid2/.col, tabs), adapted for adopt-keel-shell; polished in change polish-and-realism task 7 */
// Member detail: the dossier of one member. Dottie Hayes gets five tabs (Overview, Coverage checks, Relationships, Communications & consent, Workflow) and the
// outreach document (#member/<id>/outreach, built by plans.js). A sample member gets Overview only and never a recommendation, cost or verdict.
// Everything is read from the run store; the page decides nothing: eligibility, cost and the recommendation arrive in the decision trace.
// Built from the design-system primitives (ui/primitives.js, ui/format.js): figures in stat rows and fact lists, one badge per header, one pill per title.
import { esc, layerBadge, nativeButton, registerPage, scheduleRender, tabsHTML } from '../shell.js';
import { chip, emptyState, errorState, factList, loadingState, secHead, statRow, statusPill, verified } from '../../ui/primitives.js';
import { dateLong, dateShort, dateTime, days, money } from '../../ui/format.js';
import { CHECK } from '../../ui/icons.js';
import { countyName } from '../../js/format.js';
import { factById, heldMessage, llmFor, nameOf, recommendation, stepStatus, viewStep } from '../../js/state.js';
import { ACTOR_LABEL, LAYERS, LLM_STATUS_TEXT, STEPS, stepIndex, stepMeta } from '../../js/steps.js';
import { CHANNEL_LABEL, RELATION_VERB, electionDates, memberName, planLabel, prefText, shortNames } from '../../js/labels.js';
import { shortName } from './home.js';
import { MEMBER_BRIEFS, HISTORY_LABEL } from '../history.js';

import * as stage from '../../js/views-stage.js';
import { stageHTML } from '../../js/views-stage.js';

// plans.js (S5) is imported through a variable so the type checker does not pull its file into every test that renders this page. If it cannot load, the Outreach tab says so.
const PLANS_MODULE = './plans.js';
/** @type {any} outreachDocHTML(ctx) and outreachDocAfter(el, ctx) */
const plans = await import(PLANS_MODULE).catch((e) => { console.warn('plans.js not loaded', e); return null; });

export const TABS = /** @type {[string, string][]} */ ([['overview', 'Overview'], ['coverage', 'Coverage checks'], ['relationships', 'Relationships'], ['comms', 'Communications & consent'], ['workflow', 'Workflow']]);
const EP_NAME = /** @type {Record<string, string>} */ ({ AEP: 'Annual Enrollment Period', 'SEP-NONRENEWAL': 'Special period after a plan non-renewal', 'MA-OEP': 'Medicare Advantage Open Enrollment' });
const CHANNEL = /** @type {Record<string, string>} */ (CHANNEL_LABEL);
const SITUATION = /** @type {Record<string, string>} */ ({ renewing: 'Renewing', 'non-renewing': 'Non-renewing', 'new-to-medicare': 'New to Medicare', moved: 'Moved', 'turning-65': 'Turning 65' });
const BASIS = /** @type {Record<string, string>} */ ({ 'written-opt-in': 'Written opt-in', 'opt-out': 'Opt-out', 'member-initiated-request': 'Member request' });
/** The rule ids whose results the coverage matrices overlay (the trace's own results; the page never evaluates a rule). */
const MATRIX_RULE = /** @type {{ drugs: RegExp, network: RegExp }} */ ({ drugs: /FORMULARY/, network: /PROVIDER|NETWORK/ });
/** The icon of each step state, besides the border and the aria-label (the state is never told by colour alone). */
const STATE_ICON = /** @type {Record<string, string>} */ ({ done: CHECK, current: '●', waiting: '◐', pending: '○' });

// module state that outlives a render
let relSel = '';
let coverageFailed = false;

const scenarioOf = (/** @type {any} */ ctx) => ctx.run.views?.scenario ?? ctx.state.scenario ?? null;
const initials = (/** @type {string} */ name) => name.replace(/"[^"]*"/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fval = (/** @type {any} */ s, /** @type {string} */ id) => /** @type {any} */ (factById(s, id)?.value) ?? null;
const memberHash = (/** @type {string} */ id, /** @type {string} */ tab) => `member/${id}/${tab}`;
const cap = (/** @type {string} */ t) => t.charAt(0).toUpperCase() + t.slice(1);
/** Server sentences carry whole dollars as "$30.00"; the screen writes "$30". Display only. */
const plain = (/** @type {string | undefined} */ t) => shortNames(String(t ?? '')).replace(/(\$[\d,]+)\.00\b/g, '$1');
const basisLabel = (/** @type {string} */ b) => BASIS[b] ?? cap(String(b).replace(/-/g, ' '));
const pill = (/** @type {string} */ tone, /** @type {string} */ label) => `<span class="pill ${tone}">${esc(label)}</span>`;
/** A consent status as one verified line (icon and word, no box): Granted ticks, Revoked crosses, None is a dash. @param {string} status */
const consentStatus = (status) => (status === 'granted' ? verified('Granted') : status === 'revoked' ? verified('Revoked', { state: 'mismatch' }) : verified('None', { state: 'na' }));

// ---------- header ----------
/** @param {any} ctx @param {{ initials: string, name: string, sub: string, right: string }} h */
function header(ctx, h) {
  return `<div class="top"><div class="logo mem-logo">${esc(h.initials)}</div><div class="mem-id"><button type="button" class="back" data-act="page" data-v="members">&larr; All members</button><h1>${esc(h.name)}</h1><p>${esc(h.sub)}</p></div><div class="sp">${h.right}</div></div>`;
}

/**
 * The one next-step slot (MH-03): the native button for whichever step runs next, on every member tab, plus the audit download after briefing.audit.
 * The draft button also opens the outreach document. @param {any} ctx @param {string} id
 */
function headerActions(ctx, id) {
  const next = ctx.run.nextStep?.();
  let out = next ? nativeButton(ctx, next, next === 'action.draft' ? { go: memberHash(id, 'outreach') } : {}) : '';
  const url = ctx.state.audit ? ctx.run.auditUrl?.() : null;
  // one download per screen: when the Workflow tab shows the audit step, its card carries "Download audit package" and the header leaves it out (final review 7.9: an outlined button beside the filled one read as two different things)
  const cardHasIt = ctx.params.tab === 'workflow' && viewStep(ctx.state) === 'briefing.audit';
  if (url && !cardHasIt) out += `<a class="btn pri" href="${esc(url)}" download data-testid="audit-download">Download audit</a>`;
  return out;
}

// ---------- Overview ----------
/** A card of the Overview: title, at most one layer badge, optionally one pill. @param {string} id @param {string} title @param {string} badge layer id @param {string} body @param {string} [right] */
const facet = (id, title, badge, body, right = '') =>
  `<section class="card pad mem-facet" data-facet="${id}">${secHead(title, { level: 3, badge, right })}${body}</section>`;

/** @param {any} ctx */
function electionFacet(ctx) {
  const s = ctx.state, b = scenarioOf(ctx).beneficiary, d = electionDates(s);
  const aep = fval(s, 'fact:election:ep-aep');
  if (!aep || !d.aepEnd) return facet('election', 'County and election period', 'data', emptyState('Not calculated yet'));
  /** @type {{ label: string, value: string, sub?: string, title?: string }[]} */
  const items = [
    { label: 'County', value: countyName(b.county), sub: b.state },
    { label: 'Period', value: aep.code === 'AEP' ? 'AEP' : (EP_NAME[aep.code] ?? 'Election period'), sub: EP_NAME[aep.code] ?? '' },
  ];
  // once there is a recommendation its stat row carries the two dates, so they are said once on the page (K-046)
  if (!recommendation(s)) {
    items.push({ label: 'AEP closes', value: dateShort(d.aepEnd), sub: days(d.aepDays), title: dateLong(d.aepEnd) });
    if (d.noGapDate) items.push({ label: 'No-gap date', value: dateShort(d.noGapDate), sub: days(d.noGapDays), title: dateLong(d.noGapDate) });
  }
  return facet('election', 'County and election period', 'data', statRow(items));
}

/** @param {any} ctx */
function planFacet(ctx) {
  const p = scenarioOf(ctx).currentPlan;
  return facet('plan', 'Current plan and renewal', 'data',
    `<p class="mem-strong">${esc(p.name)}</p>` + factList([
      { label: 'Contract', value: p.contractPlanId },
      { label: '2026 premium', value: `${money(p.premiumMonthly)} per month` },
      { label: 'Ends', value: dateLong(p.endsOn) },
      { label: 'Notice mailed', value: dateLong(p.noticeMailedOn) },
    ]));
}

/** @param {any} ctx */
function providersFacet(ctx) {
  const sc = scenarioOf(ctx), prio = (/** @type {string} */ p) => (p === 'must-keep' ? 'Must keep' : p === 'preferred' ? 'Preferred' : p);
  const li = (/** @type {string} */ n, /** @type {string} */ sub, /** @type {string} */ p) => `<li><span><b>${esc(n)}</b> <span class="muted small">${esc(sub)}</span></span>${chip(prio(p))}</li>`;
  return facet('providers', 'Doctors and facility', 'data',
    `<ul class="mem-list">${sc.providers.map((/** @type {any} */ p) => li(p.name, p.specialty, p.priority)).join('')}${sc.facilities.map((/** @type {any} */ f) => li(f.name, 'Hospital', f.priority)).join('')}</ul>`);
}

/** @param {any} ctx */
function rxFacet(ctx) {
  return facet('prescriptions', 'Prescriptions', 'data',
    `<ul class="mem-list">${scenarioOf(ctx).prescriptions.map((/** @type {any} */ p) => `<li><span><b>${esc(p.name.replace(/ \d.*$/, ''))}</b> <span class="muted small">${esc(p.strength)}</span></span><span class="small muted">${esc(p.fillsPerYear)} fills a year</span></li>`).join('')}</ul>`);
}

/** Her words as fact rows: the label and value from the extraction, the quote as the second line. @param {any} ctx */
function prefsFacet(ctx) {
  const s = ctx.state, interp = /** @type {import('../../../shared/contracts.ts').InterpretResult | undefined} */ (s.llm['signal.interpret']?.result);
  const call = llmFor(s, 'signal.interpret');
  const note = call && call.status !== 'live' ? `<p class="small muted"><span class="chip" data-testid="prefs-llm-status">${esc(LLM_STATUS_TEXT(call.status))}</span></p>` : '';
  // a skeleton means the read is running; before that it is an empty state (one "Not read yet", never both)
  if (!interp) return facet('preferences', 'Preferences', 'ai', stepStatus(s, 'signal.interpret') === 'started' ? loadingState('Reading', { lines: 3 }) : emptyState('Not read yet'));
  const q = (/** @type {string} */ t) => `“${t}”`;
  const revoked = interp.consentSignals.filter((c) => c.permission === 'revoke');
  const hasChannel = interp.preferences.some((p) => p.kind === 'channel');
  /** @type {{ label: string, value: string, note?: string }[]} */
  const rows = interp.preferences.map((p) => {
    const t = prefText(p);
    const quotes = [q(p.quote), ...(p.kind === 'channel' ? revoked.map((c) => q(c.quote)) : [])];
    return { label: t.label, value: p.kind === 'benefit-interest' ? cap(t.value) : t.value, note: quotes.join(' · ') };
  });
  if (!hasChannel) for (const c of interp.consentSignals) rows.push({ label: 'Contact', value: `${c.permission === 'revoke' ? 'No' : 'OK to use'} ${(CHANNEL[c.channel] ?? c.channel).toLowerCase()}`, note: q(c.quote) });
  return facet('preferences', 'Preferences', 'ai', note + factList(rows));
}

/** @param {any} ctx */
function commsFacet(ctx) {
  const sc = scenarioOf(ctx);
  const rows = sc.consents.map((/** @type {any} */ c) => `<li><span><b>${esc(CHANNEL[c.channel] ?? c.channel)}</b> <span class="muted small">${esc(basisLabel(c.basis))} · ${esc(dateLong(c.at))}</span></span>${consentStatus(c.status)}</li>`).join('');
  return facet('comms', 'Communications and consent', 'data',
    `<ul class="mem-list">${rows}</ul><div class="mem-prior">${factList([
      { label: 'Voicemail from her', value: dateTime(sc.inbound.at) },
      { label: 'Non-renewal letter', value: `Mailed ${dateLong(sc.currentPlan.noticeMailedOn)}` },
      { label: 'Scope of Appointment', value: sc.scopeOfAppointment.status === 'on-file' ? 'On file' : 'Not on file' },
    ])}</div>`);
}

/** The plain-language reasons the plan fits, grouped for reading (S10-06): doctors, prescriptions, premium against her limit, cost. Reads the trace's own facts and rule results; decides nothing.
 * @param {any} s run state @param {any} rec the plan-recommendation decision @param {any} o its outcome @param {any} cand the recommended candidate */
export function fitRows(s, rec, o, cand) {
  const sc = s.scenario;
  const ids = /** @type {string[]} */ (o.reasons);
  const facts = ids.map((id) => factById(s, id)).filter((f) => !!f);
  const of = (/** @type {RegExp} */ re) => facts.filter((f) => re.test(/** @type {any} */ (f).id));
  const last = (/** @type {string} */ factId) => factId.split(':').at(-1) ?? factId;
  /** @type {{ key: string, label: string, value: string }[]} */ const out = [];
  const net = of(/^fact:network:/);
  if (net.length) out.push({ key: 'network', label: 'Doctors', value: `${net.length} of ${(sc?.providers?.length ?? 0) + (sc?.facilities?.length ?? 0) || net.length} in network` });
  const drugIds = [...new Set(of(/^fact:(formulary|copay):/).map((f) => last(/** @type {any} */ (f).id)))];
  if (drugIds.length) {
    const pa = of(/^fact:priorauth:/).filter((f) => /** @type {any} */ (f).value === true).map((f) => nameOf(s, last(/** @type {any} */ (f).id)).replace(/ \(.*$|\s\d.*$/, ''));
    out.push({ key: 'drugs', label: 'Prescriptions', value: `${drugIds.length} of ${sc?.prescriptions?.length ?? drugIds.length} covered${pa.length ? ` · prior authorization for ${pa.join(', ')}` : ''}` });
  }
  const pref = of(/^fact:pref:max-premium/)[0], prem = of(/^fact:premium:/)[0];
  if (prem) {
    const limit = pref ? /** @type {number} */ (/** @type {any} */ (pref).value) : null;
    out.push({ key: 'premium', label: 'Premium', value: limit == null ? `${money(/** @type {number} */ (/** @type {any} */ (prem).value))} per month` : cand?.softFlags?.includes('SUIT-PREMIUM-PREF') ? `Above her ${money(limit)} limit` : `Within her ${money(limit)} limit` });
  }
  if (of(/^fact:cost:/)[0] && cand?.rank === 1) out.push({ key: 'cost', label: 'Cost', value: `Lowest of ${(rec.candidates ?? []).filter((/** @type {any} */ c) => c.eligible).length} eligible plans` });
  for (const f of facts.filter((x) => !/^fact:(network|formulary|copay|priorauth|premium|pref:max-premium|cost)(:|$)/.test(/** @type {any} */ (x).id))) out.push({ key: 'other', label: 'Also', value: /** @type {any} */ (f).statement });
  return out;
}

/** The stat row, the "Why it fits" rows and the plans-checked table of the recommendation, from the shared renderer of the step card. @param {any} s run state @param {any} _rec @param {{ where: 'overview' }} o */
const recommendationSummary = (s, _rec, o) => stage.recommendationSummaryHTML(s, o);

/** The recommendation card (after decision.recommend): the plan, four figures, why it fits, the plans checked, Why this action. @param {any} ctx */
function recommendationCard(ctx) {
  const s = ctx.state, rec = recommendation(s), o = rec?.outcome;
  if (!rec || !o || o.type !== 'plan-recommendation') return '';
  const plan = (scenarioOf(ctx).plans ?? []).find((/** @type {any} */ p) => p.id === o.recommendedPlanId);
  const all = o.reasons.map((id) => factById(s, id)).filter((f) => !!f);
  const head = secHead('Recommended plan for 2027', { level: 3, badge: 'rules', right: stage.approvalStatusHTML(s, o) });
  return `<section class="brief mem-rec" data-testid="recommendation" data-ctx-type="decision" data-ctx-id="${esc(rec.decisionId)}">${head}` +
    `<p class="mem-rec-plan">${esc(nameOf(s, o.recommendedPlanId ?? ''))}</p>${plan ? `<p class="small muted mem-rec-sub">${esc(plan.type)} · ${esc(plan.contractPlanId)}</p>` : ''}` +
    recommendationSummary(s, rec, { where: 'overview' }) +
    `<div class="ui-actions mem-rec-act"><button type="button" class="btn" data-act="why" data-v="${esc(rec.decisionId)}" data-testid="why-open" aria-haspopup="dialog">Why this action?</button></div>` +
    (all.length ? `<details class="mem-allfacts" data-testid="all-facts"><summary>Facts (${all.length})</summary><ul class="mem-reasons">${all.map((f) => `<li>${esc(plain(/** @type {any} */ (f).statement))}</li>`).join('')}</ul></details>` : '') + '</section>';
}

/** Before the recommendation: where the case stands as figures. @param {any} ctx */
function statusBrief(ctx) {
  const s = ctx.state, first = s.timeline[0], next = ctx.run.nextStep?.();
  const nextLabel = next ? (nativeButton(ctx, next).replace(/<[^>]+>/g, '') || stepMeta(next).short) : '—';
  const items = [
    { label: 'Step', value: s.head ? `${stepIndex(s.head) + 1} of ${STEPS.length}` : 'Not started' },
    { label: 'Next', value: nextLabel },
    { label: 'Opened', value: first ? dateTime(first.at) : '—' },
  ];
  return `<div class="brief mem-status" data-testid="member-status">${secHead('Case status', { level: 3 })}${statRow(items)}</div>`;
}

/**
 * What the recommendation means for her, in four figures (demo-polish): doctors kept, medicines covered, premium against her limit, and the cheaper plan
 * the rules turned down to protect a doctor. Every figure is read from the decision trace and the scenario; nothing is computed beyond counting. @param {any} ctx
 */
function outcomeStrip(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx), rec = recommendation(s), o = rec?.outcome;
  if (!rec || o?.type !== 'plan-recommendation' || !o.recommendedPlanId) return '';
  const code = o.recommendedPlanId.replace(/^plan-/, '');
  const must = (sc.providers ?? []).filter((/** @type {any} */ p) => p.priority === 'must-keep');
  const rx = sc.prescriptions ?? [];
  const pa = rx.filter((/** @type {any} */ d) => fval(s, `fact:priorauth:${code}:${d.drugId}`) === true).length;
  const prem = fval(s, `fact:premium:${code}`), max = fval(s, 'fact:pref:max-premium');
  const recCost = (rec.candidates ?? []).find((/** @type {any} */ c) => c.planId === o.recommendedPlanId)?.estAnnualCost ?? null;
  const cheaper = (rec.candidates ?? []).filter((/** @type {any} */ c) => !c.eligible && c.estAnnualCost != null && recCost != null && c.estAnnualCost < recCost).sort((/** @type {any} */ a, /** @type {any} */ b) => a.estAnnualCost - b.estAnnualCost)[0];
  const why = cheaper ? (rec.ruleResults ?? []).find((/** @type {any} */ r) => r.subject === cheaper.planId && r.outcome === 'fail')?.message ?? '' : '';
  const who = (why.split(':')[1] ?? '').trim().replace(/\.$/, '').replace(/,\s*MD$/, '');
  const cell = (/** @type {string} */ label, /** @type {string} */ big, /** @type {string} */ small, cls = '') => `<div class="oc${cls}"><label>${esc(label)}</label><b>${esc(big)}</b><span>${esc(small)}</span></div>`;
  return `<div class="outcome-strip" data-testid="outcome-strip">` +
    cell('Doctors she must keep', `${must.length} of ${must.length} in network`, must.map((/** @type {any} */ p) => String(p.name).replace(/,\s*MD$/, '')).join(' · ')) +
    cell('Her medicines', `${rx.length} of ${rx.length} covered`, pa ? `${pa} needs prior approval from the plan` : 'All on the 2027 drug list') +
    cell('Monthly premium', prem != null ? money(prem) : '—', max != null ? `Her limit is ${money(max)}` : '') +
    (cheaper ? cell('Cheaper plan turned down', nameOf(s, cheaper.planId), `${money(recCost - cheaper.estAnnualCost)} a year less, but ${who || 'a must-keep doctor'} is out of network`, ' is-save')
      : cell('Year estimate', recCost != null ? money(recCost) : '—', 'Premium plus drug costs')) + '</div>';
}

/** @param {any} ctx */
export function overviewHTML(ctx) {
  const rec = recommendationCard(ctx);
  // as the old dossier: the recommendation, her words and the election period in the wide column; the records behind them in the narrow one
  return `<div class="grid2 mem-overview" data-testid="member-overview"><div class="col mem-main">${rec ? outcomeStrip(ctx) + rec : statusBrief(ctx)}${prefsFacet(ctx)}${electionFacet(ctx)}</div><div class="col mem-side">${planFacet(ctx)}${providersFacet(ctx)}${rxFacet(ctx)}${commsFacet(ctx)}</div></div>`;
}

// ---------- Coverage checks ----------
/** Rule results of the recommendation for one subject, limited to the rules this matrix shows. @param {any} rec @param {RegExp} re @param {string} planId */
const resultsFor = (rec, re, planId) => (rec?.ruleResults ?? []).filter((/** @type {any} */ r) => r.subject === planId && r.outcome !== 'not_applicable' && re.test(r.ruleId));

/**
 * The Result column: one plain pill and the engine's reason per plan. The rule id sits in the tooltip, not on the screen. A plan the rules dropped before this check is said to be excluded earlier.
 * @param {any} rec @param {string} planId @param {RegExp} re @param {{ pass: string, fail: string }} label
 */
function resultCell(rec, planId, re, label) {
  const rs = resultsFor(rec, re, planId);
  const bad = rs.filter((/** @type {any} */ r) => r.outcome === 'fail');
  const shown = bad.length ? bad : rs;
  if (shown.length) {
    const ruleTitle = shown.map((/** @type {any} */ r) => `Rule ${r.ruleId}`).join(', ');
    const status = bad.length ? `<span class="pill crit" title="${esc(ruleTitle)}">${label.fail}</span>` : `<span title="${esc(ruleTitle)}">${verified(label.pass)}</span>`;
    return `<td data-plan="${esc(planId)}" class="mem-rulecell">${status}<div class="small muted">${esc(shown.map((/** @type {any} */ r) => plain(r.message)).join(' '))}</div></td>`;
  }
  const cand = (rec.candidates ?? []).find((/** @type {any} */ c) => c.planId === planId);
  const why = cand?.excludedBy?.length ? (rec.ruleResults ?? []).find((/** @type {any} */ r) => r.subject === planId && r.ruleId === cand.excludedBy[0] && r.outcome === 'fail') : null;
  return why
    ? `<td data-plan="${esc(planId)}" class="mem-rulecell"><span class="pill neutral" title="Rule ${esc(why.ruleId)}">Excluded earlier</span><div class="small muted">${esc(plain(why.message))}</div></td>`
    : `<td data-plan="${esc(planId)}" class="mem-rulecell"><span class="muted">—</span></td>`;
}

/** @param {any} ctx */
export function coverageHTML(ctx) {
  const s = ctx.state, view = ctx.run.views?.coverage, sc = scenarioOf(ctx), rec = recommendation(s);
  const shell = (/** @type {string} */ inner) => `<div class="mem-coverage" data-testid="coverage">${inner}</div>`;
  if (stepStatus(s, 'memory.assemble') !== 'done') return shell(emptyState('No coverage data yet', { cls: 'mem-empty' }));
  if (!view) return shell(coverageFailed
    ? errorState("Coverage didn't load", { text: '', retry: { act: 'member.covretry' } })
    : loadingState('Loading', { lines: 4 }));
  const recPlan = rec?.outcome?.type === 'plan-recommendation' ? rec.outcome.recommendedPlanId : null;
  const planTh = (/** @type {{ id: string, name: string, type: string }} */ p) => `<th scope="row" data-plan="${esc(p.id)}"><b>${esc(p.name)}</b><div class="small muted">${esc(p.type)}${p.id === recPlan ? ` ${statusPill('recommended')}` : ''}</div></th>`;
  const drugIds = [...new Set(view.drugs.map((/** @type {any} */ d) => d.drugId))].sort((a, b) => {
    const order = sc.prescriptions.map((/** @type {any} */ p) => p.drugId), ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const provIds = [...new Set(view.network.map((/** @type {any} */ n) => n.providerId))];
  const rx = (/** @type {string} */ id) => sc.prescriptions.find((/** @type {any} */ p) => p.drugId === id);
  const drugHead = (/** @type {string} */ id) => { const p = rx(id); return p ? `<th scope="col" title="${esc(p.name)}">${esc(p.name.replace(/\s*\([^)]*\)/, ''))}</th>` : `<th scope="col">${esc(nameOf(s, id))}</th>`; };
  const cell = (/** @type {any} */ d) => {
    const flags = [d.priorAuth ? 'Prior authorization' : '', d.stepTherapy ? 'Step therapy' : '', d.quantityLimit ? `Quantity limit ${d.quantityLimit}` : ''].filter(Boolean);
    const price = d.copay30 != null ? ` · ${money(d.copay30)}` : d.coinsurancePct != null ? ` · ${d.coinsurancePct}%` : '';
    const body = d.onFormulary
      ? `<span class="ui-num">Tier ${esc(d.tier)}${esc(price)}</span>${flags.length ? `<div class="small muted">${esc(flags.join(', '))}</div>` : ''}`
      : '<span class="mem-no">Not on formulary</span>';
    return `<td class="mem-cell" data-plan="${esc(d.planId)}" data-drug="${esc(d.drugId)}" data-ctx-type="coverage" data-ctx-id="${esc(d.planId)}:${esc(d.drugId)}">${body}</td>`;
  };
  const drugRows = view.plans.map((/** @type {any} */ p) => `<tr>${planTh(p)}${drugIds.map((id) => { const d = view.drugs.find((/** @type {any} */ x) => x.planId === p.id && x.drugId === id); return d ? cell(d) : `<td data-plan="${esc(p.id)}" data-drug="${esc(id)}">—</td>`; }).join('')}${rec ? resultCell(rec, p.id, MATRIX_RULE.drugs, { pass: 'Covered', fail: 'Not covered' }) : ''}</tr>`).join('');
  const netRows = view.plans.map((/** @type {any} */ p) => `<tr>${planTh(p)}${provIds.map((id) => {
    const n = view.network.find((/** @type {any} */ x) => x.planId === p.id && x.providerId === id);
    if (!n) return `<td data-plan="${esc(p.id)}" data-provider="${esc(id)}">—</td>`;
    return `<td class="mem-cell" data-plan="${esc(p.id)}" data-provider="${esc(id)}" data-ctx-type="coverage" data-ctx-id="${esc(p.id)}:${esc(id)}">${n.inNetwork ? verified('In network') : '<span class="mem-no"><span aria-hidden="true">✕</span> Out of network</span>'}</td>`;
  }).join('')}${rec ? resultCell(rec, p.id, MATRIX_RULE.network, { pass: 'In network', fail: 'Out of network' }) : ''}</tr>`).join('');
  const head = (/** @type {string} */ title, /** @type {string} */ meta) => secHead(title, { level: 2, meta, badge: rec ? 'rules' : 'data', right: `<span class="small muted">Plan data as of ${esc(dateLong(view.snapshot.knownAt))}</span>` });
  const result = rec ? '<th scope="col">Result</th>' : '';
  return shell(`<div class="card mem-matrix-card">${head('Prescriptions by plan', 'Tier and 30-day copay')}<div class="tbl-wrap"><table class="mem-matrix" data-testid="coverage-drugs"><caption class="sr">Formulary tier, 30-day copay and restrictions for each prescription under each candidate plan</caption><thead><tr><th scope="col">Plan</th>${drugIds.map((id) => drugHead(/** @type {string} */ (id))).join('')}${result}</tr></thead><tbody>${drugRows}</tbody></table></div></div>` +
    `<div class="card mem-matrix-card">${head('Doctors and facility by plan', 'Network status')}<div class="tbl-wrap"><table class="mem-matrix" data-testid="coverage-network"><caption class="sr">Network status of each must-keep doctor and facility under each candidate plan</caption><thead><tr><th scope="col">Plan</th>${provIds.map((id) => `<th scope="col">${esc(nameOf(s, /** @type {string} */ (id)))}</th>`).join('')}${result}</tr></thead><tbody>${netRows}</tbody></table></div></div>`);
}

// ---------- Relationships ----------
const EDGE = /** @type {Record<string, [string, string]>} */ ({
  RESIDES_IN: ['Lives in', 'lives in'], SEES: ['Sees', 'sees'], ENROLLED_IN: ['Enrolled in', 'is enrolled in'], NON_RENEWING_IN: ['Non-renewing in', 'is not renewing in'],
  OFFERED_IN: ['Offered in', 'is offered in'], HAS_FORMULARY: ['Has list', 'has the drug list'], IN_NETWORK: ['In network for', 'is in network for'], TAKES: ['Takes', 'takes'],
  HAS_CONSENT: ['Consent', 'has consent'], OFFERED_BY: ['Offered by', 'is offered by'], LISTS_DRUG: ['Lists', 'lists'], AFFILIATED_WITH: ['Affiliated with', 'is affiliated with'],
});
const KIND = /** @type {[RegExp, string, string][]} */ ([[/^ben-/, 'member', 'members'], [/^prov-/, 'doctor', 'doctors'], [/^fac-/, 'facility', 'facilities'], [/^plan-/, 'plan', 'plans'], [/^county-/, 'county', 'counties'], [/^form-/, 'drug list', 'drug lists'], [/^drug-/, 'drug', 'drugs'], [/^consent-/, 'consent record', 'consent records']]);
const kindOf = (/** @type {string} */ id) => KIND.find(([re]) => re.test(id));
/** "3 doctors", "1 plan": the kind is named once, in the group header. @param {string[]} ids */
function kindCount(ids) {
  const kinds = new Set(ids.map((i) => kindOf(i)?.[1] ?? 'record'));
  const k = kinds.size === 1 ? KIND.find(([, one]) => one === [...kinds][0]) : null;
  return k ? `${ids.length} ${ids.length === 1 ? k[1] : k[2]}` : `${ids.length} ${ids.length === 1 ? 'record' : 'records'}`;
}
const relKey = (/** @type {any} */ r) => `${r.from}|${r.type}|${r.to}`;

/** Label of an ontology id: the scenario names first, then the county and drug-list ids the relations carry. @param {any} ctx @param {string} id @param {any[]} rels */
function labelFor(ctx, id, rels) {
  const sc = scenarioOf(ctx);
  if (id === sc.beneficiary.id) return shortName(sc);
  if (/^county-/.test(id)) return `${sc.beneficiary.county}, ${sc.beneficiary.state}`;
  if (/^form-/.test(id)) { const plan = rels.find((r) => r.type === 'HAS_FORMULARY' && r.to === id); return plan ? `${nameOf(ctx.state, plan.from)} drug list` : 'Drug list'; }
  return nameOf(ctx.state, id);
}

/** The hold on the recommended plan, read from the record: Needs approval until a person decided, then Approved or Rejected. @param {any} s run state @param {string} ruleId */
const heldStatus = (s, ruleId) => {
  const a = s.approval;
  if (a?.decision === 'approved') return `<span title="Rule ${esc(ruleId)}">${verified('Approved')}</span>`;
  if (a?.decision === 'rejected') return `<span title="Rule ${esc(ruleId)}">${verified('Rejected', { state: 'mismatch' })}</span>`;
  return `<span class="pill warn" title="Rule ${esc(ruleId)}">Needs approval</span>`;
};

/** The member's own links, in reading order. */
const GROUPS = /** @type {[string, string][]} */ ([['RESIDES_IN', 'Lives in'], ['ENROLLED_IN', 'Enrolled in'], ['SEES', 'Sees'], ['TAKES', 'Takes'], ['HAS_CONSENT', 'Consent']]);

/**
 * The relations as an org chart read as ontology: Member, then what she is linked to (current plan, doctors, drugs) and the plans offered in her county; under each plan its
 * doctors in network, its drug list, its notices and the rule results for it. Every relation appears once and no node is repeated.
 * @param {any[]} rels @param {string} rootId
 * @returns {{ rootId: string, groups: { type: string, label: string, nodes: { id: string, edge: any }[], plans: { id: string, edge: any, network: any[], lists: any[], nonRenewing: any[] }[] }[] }}
 */
export function relationChart(rels, rootId) {
  const out = (/** @type {string} */ id, /** @type {string} */ type) => rels.filter((r) => r.from === id && r.type === type);
  const planOf = (/** @type {string} */ id, /** @type {any} */ edge) => ({ id, edge, network: rels.filter((r) => r.type === 'IN_NETWORK' && r.to === id), lists: out(id, 'HAS_FORMULARY'), nonRenewing: out(id, 'NON_RENEWING_IN') });
  const enrolled = new Set(out(rootId, 'ENROLLED_IN').map((e) => e.to));
  /** @type {ReturnType<typeof relationChart>['groups']} */ const groups = [];
  const add = (/** @type {string} */ type, /** @type {string} */ label, /** @type {any[]} */ nodes, /** @type {any[]} */ plans) => { if (nodes.length || plans.length) groups.push({ type, label, nodes, plans }); };
  for (const [type, label] of GROUPS) {
    const edges = out(rootId, type);
    if (type === 'ENROLLED_IN') {
      // her current plan is listed once, here, with its notice and its offered-in links
      add(type, 'Enrolled in', [], edges.map((e) => ({ ...planOf(e.to, e), nonRenewing: [...out(e.to, 'NON_RENEWING_IN'), ...out(e.to, 'OFFERED_IN')] })));
      add('OFFERED_IN', 'Offered in her county', [], rels.filter((r) => r.type === 'OFFERED_IN' && !enrolled.has(r.from)).map((r) => planOf(r.from, r)));
    } else add(type, label, edges.map((e) => ({ id: e.to, edge: e })), []);
  }
  // The member is drawn centred over the whole row. A wide group (several plan cards) at either end would pull that centre away from the group heads, so it moves inward.
  const wide = groups.findIndex((g) => g.plans.length > 1);
  if (groups.length >= 3 && (wide === 0 || wide === groups.length - 1)) groups.splice(Math.floor(groups.length / 2), 0, /** @type {any} */ (groups.splice(wide, 1)[0]));
  return { rootId, groups };
}

/** @param {any} ctx */
export function relationshipsHTML(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx), rec = recommendation(s);
  const rels = rec?.relations?.length ? rec.relations : s.relations;
  if (!rels.length) return `<div data-testid="relationships">${emptyState('No relationships yet', { cls: 'mem-empty' })}</div>`;
  const chart = relationChart(rels, sc.beneficiary.id);
  const ruleResults = (/** @type {string} */ planId) => (rec?.ruleResults ?? []).filter((/** @type {any} */ r) => r.subject === planId && r.outcome !== 'not_applicable');
  const nameBtn = (/** @type {any} */ edge, /** @type {string} */ id, /** @type {string} */ extra = '') => {
    const key = relKey(edge);
    return `<button type="button" class="person" data-act="member.relnode" data-v="${esc(key)}" aria-pressed="${relSel === key}" data-node="${esc(id)}"><b>${esc(labelFor(ctx, id, rels))}</b>${extra}</button>`;
  };
  const chipBtn = (/** @type {any} */ edge, /** @type {string} */ label, /** @type {string} */ full = label) => `<button type="button" class="mem-relchip" data-act="member.relnode" data-v="${esc(relKey(edge))}" aria-pressed="${relSel === relKey(edge)}" title="${esc(full)}">${esc(label)}</button>`;
  /** "Dr. Karen Brennan, MD" reads "Dr. Brennan" on a chip; the full name stays in the tooltip. */
  const short = (/** @type {string} */ n) => n.replace(/,\s*MD$/, '').replace(/^(Dr\.)\s+\S+\s+(?=\S)/, '$1 ').replace(/\s+Medical Center$/, '');
  const planCard = (/** @type {{ id: string, edge: any, network: any[], lists: any[], nonRenewing: any[] }} */ p) => {
    const results = ruleResults(p.id), fails = results.filter((r) => r.outcome === 'fail'), held = fails.filter((r) => r.severity === 'hold');
    const cand = (rec?.candidates ?? []).find((/** @type {any} */ c) => c.planId === p.id);
    const tag = cand && !cand.eligible ? `<span class="ft">${statusPill('excluded')}</span>` : cand?.rank === 1 ? `<span class="ft">${statusPill('recommended')}</span>` : '';
    const line = (/** @type {any} */ r) => `<div class="mem-ruleline" title="Rule ${esc(r.ruleId)}"><span aria-hidden="true">${r.severity === 'block' ? '✕' : '!'}</span> ${esc(plain(r.message))}</div>`;
    const notes = fails.filter((r) => r.severity !== 'hold');
    const rows = (p.nonRenewing.length ? `<div><span class="small muted">Plan notice</span> ${p.nonRenewing.map((e) => chipBtn(e, EDGE[e.type]?.[0] ?? e.type)).join('')}</div>` : '') +
      (p.network.length ? `<div><span class="small muted">In network</span> ${p.network.map((e) => chipBtn(e, short(labelFor(ctx, e.from, rels)), labelFor(ctx, e.from, rels))).join('')}</div>` : '') +
      (p.lists.length ? `<div><span class="small muted">Drug list</span> ${p.lists.map((e) => chipBtn(e, '2027 list', labelFor(ctx, e.to, rels))).join('')}</div>` : '') +
      (results.length ? `<div class="mem-relrules"><div>${held.length ? heldStatus(s, held[0].ruleId) : ''}${results.length > fails.length ? `<span class="small muted">${results.length - fails.length} passed</span>` : ''}</div>${notes.map(line).join('')}</div>` : '');
    return `<li class="mem-relplan" data-plan="${esc(p.id)}">${nameBtn(p.edge, p.id, tag)}${rows ? `<div class="mem-relplan-rows">${rows}</div>` : ''}</li>`;
  };
  const leaf = (/** @type {any} */ n) => `<li>${nameBtn(n.edge, n.id)}</li>`;
  const group = (/** @type {any} */ g) => {
    const ids = [...g.nodes.map((/** @type {any} */ n) => n.id), ...g.plans.map((/** @type {any} */ p) => p.id)];
    return `<li data-group="${esc(g.type)}"><div class="person mem-relhead"><b>${esc(g.label)}</b><span>${esc(kindCount(ids))}</span></div><ul class="mem-relstack${g.plans.length > 1 ? ' mem-relgrid' : ''}">${g.nodes.map(leaf).join('')}${g.plans.map(planCard).join('')}</ul></li>`;
  };
  const sel = rels.find((/** @type {any} */ r) => relKey(r) === relSel);
  const detail = sel
    ? `<div class="brief mem-reldetail" data-testid="relation-source"><h3>${esc(labelFor(ctx, sel.from, rels))} ${esc(/** @type {Record<string, string>} */ (RELATION_VERB)[sel.type] ?? sel.type)} ${esc(labelFor(ctx, sel.to, rels))}</h3><p>${esc(sel.source.label)}</p>${factList([
      { label: 'Source', value: sel.source.system },
      { label: 'Valid', value: `${dateLong(sel.validFrom)}${sel.validTo ? ` to ${dateLong(sel.validTo)}` : ''}` },
      ...Object.entries(sel.attrs ?? {}).map(([k, v]) => ({ label: cap(k.replace(/[-_]/g, ' ')), value: String(v) })),
    ])}</div>`
    : '';
  // the tab is the title: no card heading that repeats it (K-035)
  return `<div data-testid="relationships"><div class="card pad">` +
    `<div class="tree mem-reltree" tabindex="0" role="group" aria-label="Relationship chart"><ul><li><button type="button" class="person" data-act="member.relnode" data-v="" aria-pressed="false" data-node="${esc(sc.beneficiary.id)}"><b>${esc(shortName(sc))}</b><span>${esc(sc.beneficiary.mbiDisplay)}</span></button><ul>${chart.groups.map(group).join('')}</ul></li></ul></div>${detail}</div></div>`;
}

// ---------- Communications & consent ----------
/** @param {any} ctx */
export function commsHTML(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx), pegId = sc.beneficiary.id;
  // one meta line per row ("Email · outbound · Oct 20, 10:01 AM ET"): the kind, the direction and the time as text; the date is said once
  const item = (/** @type {string} */ meta, /** @type {string} */ h, /** @type {string} */ body, /** @type {string} */ id) =>
    `<div class="news" data-comm="${id}"><div><div class="sig-meta"><span class="small muted">${esc(meta)}</span></div><h4>${esc(h)}</h4>${body}</div></div>`;
  const items = [
    item(`Letter · ${dateLong(sc.currentPlan.noticeMailedOn)}`, 'Non-renewal notice mailed', `<p class="muted">${esc(sc.currentPlan.name)} ends ${esc(dateLong(sc.currentPlan.endsOn))}</p>`, 'letter'),
    item(`Voicemail · inbound · ${dateTime(sc.inbound.at)}`, sc.inbound.subject, `<blockquote class="mem-vm">${esc(sc.inbound.text)}</blockquote>`, 'voicemail'),
  ];
  let simulated = false;
  const sent = stepStatus(s, 'action.deliver') === 'done' ? heldMessage(s) : null;
  if (sent) {
    simulated = true;
    const t = s.timeline.find((/** @type {any} */ x) => x.step === 'action.deliver');
    const ap = s.approval;
    items.push(item(`${CHANNEL[sent.channel] ?? sent.channel} · outbound${t ? ` · ${dateTime(t.at)}` : ''}`, sent.subject,
      `<p class="muted">To ${esc(sent.to)}${ap ? ` · Approved by ${esc(ap.approver.name)}` : ''}</p><div class="ui-actions"><button type="button" class="btn" data-act="member" data-v="${esc(pegId)}" data-x="outreach">Open</button></div>`, 'outreach'));
  }
  if (stepStatus(s, 'action.monitor') === 'done') {
    simulated = true;
    const t = s.timeline.find((/** @type {any} */ x) => x.step === 'action.monitor'), r = sc.memberReply;
    items.push(item(`${r ? (CHANNEL[r.channel] ?? r.channel) : 'Reply'} · inbound${t ? ` · ${dateTime(t.at)}` : ''}`,
      r ? r.subject : 'Member reply', r ? `<blockquote class="mem-vm">${esc(r.text)}</blockquote>` : `<p class="muted">${esc(String(t?.headline ?? t?.text ?? 'Reply').replace(/^simulated\s+/i, '').replace(/^./, (c) => c.toUpperCase()))}</p>`, 'reply'));
  }
  const nextAction = stepStatus(s, 'decision.next-action') === 'done' ? s.decisions.find((/** @type {any} */ d) => d.kind === 'next-action')?.outcome : null;
  const consents = sc.consents.map((/** @type {any} */ c) => `<tr data-consent="${esc(c.channel)}"><td class="nowrap"><b>${esc(CHANNEL[c.channel] ?? c.channel)}</b></td><td class="nowrap">${consentStatus(c.status)}</td><td class="small">${esc(basisLabel(c.basis))}</td><td class="small ui-num nowrap">${esc(dateLong(c.at))}</td></tr>`).join('');
  const soaRows = [{ label: 'Status', value: sc.scopeOfAppointment.status === 'on-file' ? 'On file' : 'Not on file' }];
  if (nextAction?.earliestAppointment && sc.scopeOfAppointment.status !== 'on-file') soaRows.push({ label: 'Required before', value: `Call on ${dateTime(nextAction.earliestAppointment)}` });
  return `<div class="grid2" data-testid="comms"><div class="card pad">${secHead('Communications', { level: 3, badge: 'data', right: simulated ? chip('Simulated') : '' })}${items.join('')}</div>` +
    `<div class="col"><div class="card tbl-wrap" data-testid="consent-table"><div class="mem-matrix-head">${secHead('Consent by channel', { level: 3, badge: 'data' })}</div><table><caption class="sr">Consent recorded for each channel</caption><thead><tr><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Basis</th><th scope="col">Recorded</th></tr></thead><tbody>${consents}</tbody></table></div>` +
    `<div class="card pad">${secHead('Scope of Appointment', { level: 3 })}${factList(soaRows)}</div></div></div>`;
}

// ---------- Workflow ----------
/** The state of a step as the stepper shows it. @param {any} s @param {string} id */
function stepState(s, id) {
  const st = stepStatus(s, id);
  return st === 'pending' ? 'pending' : st === 'started' ? 'current' : st === 'waiting' ? 'waiting' : 'done';
}

/** One compact card: "Step n of 18" with the title and Back / Return, and the 18 steps grouped in their five layers. @param {any} ctx */
function stepperCard(ctx) {
  const s = ctx.state, view = viewStep(s), cur = view ? stepMeta(view) : null, headIdx = stepIndex(s.head);
  const bar = `<div class="mem-step-head"><p class="mem-now" aria-live="polite">${cur ? `<b>Step ${cur.n} of ${STEPS.length}</b> <span class="muted">·</span> ${esc(cur.title)}` : '<b>Not started</b>'}</p><div class="sp">` +
    (s.head && stepIndex(view) > 0 ? '<button type="button" class="btn" data-act="member.back" data-testid="back">Back</button>' : '') +
    (s.view && s.view !== s.head ? '<button type="button" class="btn" data-act="member.return" data-testid="return">Return to current</button>' : '') + '</div></div>';
  const column = (/** @type {typeof LAYERS[number]} */ L) => {
    const steps = STEPS.filter((m) => m.layer === L.id);
    // the Action column reads HUMAN while a person is the one it waits for
    const actor = L.id === 'action' && steps.some((m) => stepStatus(s, m.id) === 'waiting' && m.actor === 'human') ? 'human' : L.actor;
    return `<li class="mem-layer" data-layer="${L.id}"><div class="mem-layer-head"><span class="mem-layer-name">${esc(L.name)}</span>${layerBadge(actor)}</div><ol class="mem-layer-steps">${steps.map((m) => {
      const state = stepState(s, m.id), reached = STEPS.indexOf(m) <= headIdx && stepStatus(s, m.id) !== 'pending', fb = llmFor(s, m.id)?.status === 'fallback';
      const label = `Step ${m.n}: ${m.title}, ${ACTOR_LABEL[m.actor]}, ${state}${fb ? ', fallback output' : ''}`;
      return `<li class="mem-step${view === m.id ? ' is-view' : ''}" data-step="${m.id}" data-state="${state}"><button type="button" class="mem-step-btn" data-act="member.view" data-v="${m.id}"${reached ? '' : ' disabled'}${view === m.id ? ' aria-current="step"' : ''} aria-label="${esc(label)}" title="${esc(`${m.title}${fb ? ' (fallback output)' : ''}`)}"><span class="mem-step-ic" aria-hidden="true">${STATE_ICON[state]}</span><span class="mem-step-n mem-step-word">${esc(m.short)}</span><span class="sr" data-badge="${m.actor}">${esc(ACTOR_LABEL[m.actor])}</span></button></li>`;
    }).join('')}</ol></li>`;
  };
  return `<div class="card mem-stepper">${bar}<ol class="mem-rail" data-testid="stepper" aria-label="The ${STEPS.length} steps">${LAYERS.map(column).join('')}</ol></div>`;
}

/** @param {any} ctx */
export function workflowHTML(ctx) {
  const s = ctx.state;
  const rows = s.timeline.map((/** @type {any} */ t) =>
    `<li data-step="${esc(t.step)}"><time datetime="${esc(t.at)}">${esc(dateTime(t.at))}</time><span class="mem-who"><i class="mem-dot mem-dot-${esc(t.actor)}" aria-hidden="true"></i><span class="mem-actor">${esc(ACTOR_LABEL[t.actor] ?? t.actor)}</span></span><span class="mem-tl-text">${esc(t.headline ?? s.steps[t.step]?.headline ?? t.text)}</span></li>`).join('');
  const tl = `<div class="card pad mem-tl-card">${secHead('Run timeline', { level: 3, right: '<span class="small muted">ET</span>' })}<p class="small muted mem-tl-more" data-testid="timeline-more" hidden></p><ol class="mem-tl" data-testid="timeline" tabindex="0" aria-label="Run timeline">${rows}</ol>${s.timeline.length ? '' : emptyState('No entries yet')}</div>`;
  return `<div class="mem-workflow" data-testid="workflow">${stepperCard(ctx)}<div class="grid2"><div class="col mem-stage" data-testid="stage-slot">${stageHTML(ctx)}</div><div class="col">${tl}</div></div></div>`;
}

// ---------- the page ----------
/** @param {any} ctx @param {string} id */
export function sampleHTML(ctx, id) {
  const m = ctx.run.views?.story?.members?.find((/** @type {any} */ x) => x.id === id);
  if (!m) return ctx.run.views?.story ? notFound() : header(ctx, { initials: '..', name: 'Member', sub: 'Loading', right: '' }) + loadingState('Loading', { lines: 4 });
  const sc = ctx.run.views?.scenario, pegId = sc?.beneficiary?.id ?? '';
  const b = /** @type {any} */ (MEMBER_BRIEFS)[id];
  const brief = b
    ? `<div class="brief" data-testid="sample-brief">${secHead('What Keel prepared', { level: 3, right: pill(b.tone, b.status) })}<ul class="brief-steps">` +
      `<li><span>Signal</span><span>${esc(m.signal)}</span></li><li><span>What it found</span><span>${esc(b.found)}</span></li>` +
      `<li><span>Next best action</span><span><b>${esc(b.next)}</b></span></li><li><span>Where it stands</span><span>${esc(b.outcome)}</span></li></ul>` +
      `<p class="small muted" style="margin-top:10px"><span class="hist-tag">${esc(HISTORY_LABEL)}</span></p></div>`
    : `<div class="brief">${secHead('Latest signal', { level: 3 })}<p>${esc(m.signal)}</p></div>`;
  return header(ctx, { initials: initials(m.name), name: m.name, sub: `Age ${m.age} · ${countyName(m.county)}, ${m.state} · ${planLabel(m.currentPlanLabel)}`, right: '' }) +
    `<div class="grid2" data-testid="sample-member"><div class="col">${brief}</div>` +
    `<div class="col"><div class="card pad">${secHead('Member', { level: 3 })}${factList([
      { label: 'Current plan', value: planLabel(m.currentPlanLabel) }, { label: 'Situation', value: SITUATION[m.situation] ?? m.situation },
      { label: 'County', value: `${countyName(m.county)}, ${m.state}` }, { label: 'Last contact', value: m.lastContactAt ? dateLong(m.lastContactAt) : 'No contact yet' },
    ])}</div>` +
    `<div class="card pad">${secHead("Today's priority", { level: 3 })}${emptyState(sc ? `${shortName(sc)}: plan ends Dec 31` : 'Dottie Hayes', { text: 'Her case is prepared and waiting for review.', action: { label: `Go to ${sc ? shortName(sc) : 'Dottie Hayes'}`, act: 'member', v: pegId } })}</div></div></div>`;
}
const notFound = () => '<button type="button" class="back" data-act="page" data-v="members">&larr; All members</button><div class="card pad" role="alert" data-testid="member-missing">Member not found</div>';

/** @param {any} ctx */
export function render(ctx) {
  const sc = scenarioOf(ctx);
  const id = ctx.params.id ?? '', tab = ctx.params.tab ?? 'overview';
  if (!sc) return loadingState('Loading', { lines: 4 });
  if (id !== sc.beneficiary.id) return sampleHTML(ctx, id);
  const b = sc.beneficiary, name = shortName(sc);
  const tabs = tabsHTML('tab', TABS, tab === 'outreach' ? null : tab);
  let body;
  if (tab === 'coverage') body = coverageHTML(ctx);
  else if (tab === 'relationships') body = relationshipsHTML(ctx);
  else if (tab === 'comms') body = commsHTML(ctx);
  else if (tab === 'workflow') body = workflowHTML(ctx);
  else if (tab === 'outreach') {
    body = `<div class="mem-outreach-bar"><button type="button" class="back" data-act="member" data-v="${esc(id)}" data-x="overview">&larr; Back</button></div><div data-slot="outreach" data-testid="outreach-mount">` +
      (typeof plans?.outreachDocHTML === 'function' ? plans.outreachDocHTML(ctx) : emptyState("Outreach didn't load")) + '</div>';
  } else body = overviewHTML(ctx);
  return `<div class="mem-head">${header(ctx, { initials: initials(name), name, sub: `Age ${b.age} · ${countyName(b.county)}, ${b.state} · Medicare Parts A and B · MBI ending ${String(b.mbiDisplay).slice(-4)}`, right: headerActions(ctx, id) })}${tabs}</div>${body}`;
}

/** Scroll the timeline to its newest entry and say how many are above the fold. @param {HTMLElement} tl */
function settleTimeline(tl) {
  const more = tl.parentElement?.querySelector('.mem-tl-more');
  const rows = /** @type {HTMLElement[]} */ ([...tl.children]);
  // offsets are measured from the list, not from the card
  const at = (/** @type {HTMLElement} */ li) => li.offsetTop - tl.offsetTop;
  const update = () => {
    // a row counts as earlier once any part of it is above the visible top
    const above = rows.filter((li) => at(li) < tl.scrollTop - 1).length;
    tl.classList.toggle('is-clipped', above > 0);
    if (more) { more.textContent = above ? `${above} earlier` : ''; /** @type {HTMLElement} */ (more).hidden = !above; }
  };
  if (rows.length) {
    // whole rows only: the list is cut to the rows that fit under its own maximum height, the newest last, so no row shows as a fragment at either edge
    const last = /** @type {HTMLElement} */ (rows.at(-1)), end = at(last) + last.offsetHeight;
    const room = parseFloat(getComputedStyle(tl).maxHeight) || end;
    let k = 0;
    while (k < rows.length - 1 && end - at(rows[k]) > room) k++;
    if (k > 0) { tl.style.height = `${end - at(rows[k])}px`; tl.scrollTop = at(rows[k]); }
  }
  update();
  tl.addEventListener('scroll', update, { passive: true });
}

/** @param {HTMLElement} el @param {any} ctx */
function after(el, ctx) {
  const tab = ctx.params.tab ?? 'overview', views = ctx.run.views ?? {};
  if (ctx.params.id !== views.scenario?.beneficiary?.id && !views.story) ctx.run.load?.('story')?.catch?.(() => { /* the page says it is loading */ });
  if (tab === 'coverage' && !views.coverage && !coverageFailed && stepStatus(ctx.state, 'memory.assemble') === 'done') {
    ctx.run.load?.('coverage')?.catch?.(() => { coverageFailed = true; scheduleRender(); });
  }
  if (tab === 'workflow') { const tl = /** @type {HTMLElement | null} */ (el.querySelector('.mem-tl')); if (tl) settleTimeline(tl); }
  if (tab === 'outreach') { const slot = /** @type {HTMLElement | null} */ (el.querySelector('[data-slot="outreach"]')); if (slot && typeof plans?.outreachDocAfter === 'function') plans.outreachDocAfter(slot, ctx); }
}

registerPage({
  id: 'member', title: 'Member detail', render, after,
  acts: {
    'member.view': (el, ctx) => ctx.run.view(el.dataset.v ?? null),
    'member.back': (_el, ctx) => { const i = stepIndex(viewStep(ctx.state)); if (i > 0) ctx.run.view(STEPS[i - 1].id); },
    'member.return': (_el, ctx) => ctx.run.view(null),
    'member.relnode': (el) => { relSel = el.dataset.v ?? ''; scheduleRender(); },
    'member.covretry': (_el, ctx) => { coverageFailed = false; ctx.run.load?.('coverage')?.catch?.(() => { coverageFailed = true; }).finally?.(() => scheduleRender()); scheduleRender(); },
  },
});
