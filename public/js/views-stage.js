// The step body of the Workflow tab: one renderer per run step, as HTML strings (changes adopt-keel-shell task 5.1, polish-and-realism task 4).
// `stageHTML(ctx)` returns the card for the step the run store points at (`state.view ?? state.head`). Everything shown is read from the state the
// server's events built; a live-model step shows a spinner and skeleton while it waits, and a fallback or retried output says so in the provenance line.
// Figures and dates go through ui/format.js; layout goes through the ui/primitives.js helpers (stat rows, fact lists, callouts, provenance).
import { esc } from '../keel/shell.js';
import { CHECK } from '../ui/icons.js';
import { callout, chip, emptyState, factList, idCode, loadingState, prov, ruleRef, secHead, statRow, statusPill, tableHTML, verified } from '../ui/primitives.js';
import { dateLong, dateShort, dateTime, days, money, moneyPerMonth, moneyPerYear, shortHash, timeOfDay } from '../ui/format.js';
import { countyName, duration } from './format.js';
import { LAYERS, LLM_PART, LLM_STATUS_TEXT, PROGRESS, PROVENANCE, STEPS, planDataDate, stepMeta } from './steps.js';
import { approvalHTML, CHANNEL, complianceHTML, mailHeadHTML, whyButton } from './views-compliance.js';
import { electionDates, memberName, prefText, shortNames } from './labels.js';
import { decisionsOfKind, factById, heldMessage, llmFor, nameOf, recommendation, stepStatus } from './state.js';

/** @typedef {import('../../shared/contracts.ts').InterpretResult} InterpretResult */
/** @typedef {import('../../shared/contracts.ts').CommunicationDraft} CommunicationDraft */
/** @typedef {import('./views-compliance.js').GovCtx} GovCtx */

export { countyName };

// ---------- small shared pieces ----------

/** Visible, announced progress for a live model call: a spinner, a label and skeleton lines. @param {string} label */
export function progressHTML(label) {
  return `<div class="stage-progress" role="status" data-testid="progress"><div class="stage-progress-line"><span class="stage-spinner" aria-hidden="true"></span><b>${esc(label)}…</b></div>` +
    '<div class="stage-skeleton" aria-hidden="true"><i></i><i></i><i></i></div></div>';
}

/** Whole dollars in running text: "$18.00" reads "$18", "$38.40" stays. @param {string} t */
const plainMoney = (t) => shortNames(String(t ?? '')).replace(/(\$[\d,]+)\.00\b/g, '$1');
/** "Dorothy \"Dottie\" Hayes" reads "Dottie Hayes" (the one name helper of labels.js). @param {string} name */
const casualName = (name) => memberName({ beneficiary: { name: name ?? '' } });
/** "Dr. Karen Brennan, MD" reads "Dr. Karen Brennan"; "Jardiance (empagliflozin) 10 mg" reads "Jardiance". @param {string} n */
const shortProvider = (n) => n.replace(/,\s*(MD|DO|NP|PA)\b.*$/, '');
const shortDrug = (/** @type {string} */ n) => n.replace(/\s*[(\d].*$/, '');
const list = (/** @type {string[]} */ names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''));
const lastId = (/** @type {string} */ factId) => factId.split(':').at(-1) ?? factId;
const memberId = (/** @type {any} */ s) => s.scenario?.beneficiary?.id ?? 'ben-hayes';
/** The id the address bar shows (the router maps it back). */
const urlId = (/** @type {any} */ s) => (memberId(s) === 'ben-hayes' ? 'dottie-hayes' : memberId(s));
const outreachHref = (/** @type {any} */ s) => `#member/${urlId(s)}/outreach`;

/** The frame of a section inside a step card: a heading line (one optional chip or button on the right), then the content. No box, no border. @param {string} title @param {string} inner @param {{ meta?: string, right?: string, attrs?: string, level?: 3 | 4 }} [o] */
const block = (title, inner, o = {}) => `<section class="stage-block"${o.attrs ?? ''}>${secHead(title, { level: o.level ?? 3, meta: o.meta, right: o.right })}${inner}</section>`;

/** A native disclosure for detail that is one click away. @param {string} summary @param {string} inner @param {string} [attrs] */
const fold = (summary, inner, attrs = '') => `<details class="stage-fold"${attrs}><summary>${esc(summary)}</summary><div class="stage-fold-body">${inner}</div></details>`;

/** Plain names for the places a fact came from. Ids stay in the title. */
const SOURCE = /** @type {Record<string, string>} */ ({
  'provider-directory': 'Network directory', formulary: 'Drug list', 'plan-landscape': 'Plan data', enrollment: 'Enrollment', crm: 'CRM', comms: 'Communications', consent: 'Consent records',
  'cms-params': 'Medicare figures', rules: 'Rules', llm: 'Her message',
});
/** The chip label of a fact id in a claim. @param {string} id */
function factSource(id) {
  if (id.startsWith('calc:')) return 'Cost calculation';
  if (/^fact:(network)/.test(id)) return 'Network directory';
  if (/^fact:(formulary|copay|priorauth)/.test(id)) return 'Drug list';
  if (/^fact:premium/.test(id)) return 'Plan data';
  if (/^fact:pref/.test(id)) return 'Her voicemail';
  if (/^fact:election/.test(id)) return 'Election periods';
  if (/^fact:cost/.test(id)) return 'Cost calculation';
  return 'Records';
}
/** The category of a fact in the folded list. @param {string} id */
function factLabel(id) {
  if (/^fact:network/.test(id)) return 'Network'; if (/^fact:formulary/.test(id)) return 'Drug list'; if (/^fact:copay/.test(id)) return 'Copay';
  if (/^fact:priorauth/.test(id)) return 'Prior authorization'; if (/^fact:premium/.test(id)) return 'Premium'; if (/^fact:pref/.test(id)) return 'Her preference';
  if (/^fact:cost/.test(id)) return 'Estimated cost'; if (/^fact:election/.test(id)) return 'Election period';
  return 'Record';
}

// ---------- the frame ----------

/** The provenance line of a step: one actor badge and a muted line; an AI step carries its live / fallback status. @param {any} s @param {string} id */
export function provenanceHTML(s, id) {
  const build = PROVENANCE[id]; if (!build) return '';
  const llm = llmFor(s, id);
  const p = build(s, llm);
  let html = prov(p.actor, p.parts);
  if (llm) {
    const slow = llm.latencyMs >= 1000 && llm.status !== 'fallback';
    const label = `${LLM_STATUS_TEXT(llm.status)}${slow ? ` · ${duration(llm.latencyMs)}` : ''}`;
    html = html.replace(LLM_PART, `<span class="stage-llm${llm.status === 'fallback' ? ' is-fallback' : ''}" data-testid="llm-status" data-llm-status="${esc(llm.status)}">${esc(label)}</span>`);
  }
  return html;
}

/** @param {GovCtx} ctx */
export function stageHTML(ctx) {
  const s = ctx.state;
  const id = s.view ?? s.head;
  if (!id) return `<div class="card pad stage-card stage-empty" data-testid="stage-empty">${emptyState('No steps yet')}</div>`;
  const meta = stepMeta(id);
  if (!meta) return '';
  const st = stepStatus(s, id);
  const llm = llmFor(s, id);
  const layer = LAYERS.find((l) => l.id === meta.layer)?.name ?? '';
  const body = BODY[id]?.(ctx, id) ?? '';
  return `<article class="card pad stage-card" data-stage="${esc(id)}" aria-labelledby="stage-title">
  <header class="stage-head"><div class="stage-head-l"><p class="stage-step">Step ${meta.n} of ${STEPS.length} · ${esc(layer)}</p><h2 id="stage-title" class="stage-title">${esc(meta.title)}</h2></div>${provenanceHTML(s, id)}</header>
  ${st === 'started' && PROGRESS[id] && !llm ? progressHTML(PROGRESS[id]) : ''}${body}</article>`;
}

// ---------- reading a message (steps 2 and 16) ----------

/** Quote highlighting: wrap the quotes found in `text`. @param {string} text @param {string[]} quotes */
function highlight(text, quotes) {
  /** @type {{ a: number, b: number }[]} */
  const spans = [];
  for (const q of quotes) { const a = text.indexOf(q); if (a >= 0) spans.push({ a, b: a + q.length }); }
  spans.sort((x, y) => x.a - y.a);
  const merged = spans.reduce((/** @type {{ a: number, b: number }[]} */ acc, sp) => {
    const last = acc[acc.length - 1];
    if (last && sp.a <= last.b) last.b = Math.max(last.b, sp.b); else acc.push({ ...sp });
    return acc;
  }, []);
  let out = '', at = 0;
  for (const m of merged) { out += esc(text.slice(at, m.a)) + `<mark class="stage-quote-mark">${esc(text.slice(m.a, m.b))}</mark>`; at = m.b; }
  return out + esc(text.slice(at));
}

const INTENT = /** @type {Record<string, string>} */ ({
  'plan-change-inquiry': 'Plan change request', 'provider-question': 'Provider question', 'drug-question': 'Drug question', 'cost-concern': 'Cost concern',
  'schedule-request': 'Call-back request', 'consent-change': 'Consent change', other: 'Other request',
});
const CHANNEL_PLURAL = /** @type {Record<string, string>} */ ({ sms: 'Text messages', email: 'Email', phone: 'Phone calls', mail: 'Mail' });
const words = (/** @type {string} */ q) => `<span class="stage-words">“${esc(q)}”</span>`;

/** What was pulled out of a message: Type, Value, Her words. @param {InterpretResult} r @param {any} l */
function extractedHTML(r, l) {
  /** @type {{ type: string, value: string, words: { html: string } }[]} */
  const rows = [];
  const add = (/** @type {string} */ type, /** @type {string} */ value, /** @type {string} */ wordsHtml) => rows.push({ type, value, words: { html: wordsHtml } });
  for (const i of r.intents) add('Request', INTENT[i.type] ?? i.type.replace(/-/g, ' '), words(i.quote));
  for (const p of r.preferences) { const t = prefText(p); add('Preference', t.label === 'Keep' ? `Keep ${t.value}` : `${t.label}: ${t.value}`, words(p.quote)); }
  for (const c of r.consentSignals) add('Consent', `${CHANNEL_PLURAL[c.channel] ?? c.channel}: ${c.permission === 'revoke' ? 'revoked' : 'allowed'}`, words(c.quote));
  if (r.mentions.drugs.length) add('Medicines named', r.mentions.drugs.map((d) => d.name).join(', '), `<span class="muted">${r.mentions.drugs.length === 1 ? 'Matches records' : `All ${r.mentions.drugs.length} match`}</span>`);
  if (r.mentions.providers.length) add('Doctors named', r.mentions.providers.map((p) => p.name).join(', '), `<span class="muted">${r.mentions.providers.length === 1 ? 'Matches records' : `All ${r.mentions.providers.length} match`}</span>`);
  const dropped = l && l.rejected.length
    ? `<div class="stage-notkept" data-testid="rejected"><p class="stage-sub">Not kept (no exact quote)</p><ul class="stage-list">${l.rejected.map((/** @type {any} */ x) => `<li>${esc(x.reason)}</li>`).join('')}</ul></div>` : '';
  return block('Extracted', tableHTML({ caption: 'What was pulled out of the message', columns: [{ key: 'type', label: 'Type' }, { key: 'value', label: 'Value' }, { key: 'words', label: 'Her words' }], rows, empty: 'Nothing extracted' }) + dropped, { attrs: ' data-testid="extracted"' });
}

/** The interpretation view, shared by the voicemail and the reply. @param {any} s @param {string} step @param {string | null} text @param {{ title: string, when?: string, chip: string }} o */
function interpretBody(s, step, text, o) {
  const l = llmFor(s, step);
  const r = /** @type {InterpretResult | undefined} */ (l?.result);
  const msg = (/** @type {string} */ inner) => block(o.title, inner, { meta: o.when, right: chip(o.chip), attrs: ' data-testid="message"' });
  if (!r) return text != null ? msg(`<p class="stage-transcript">${esc(text)}</p>`) : '';
  const quotes = [...r.intents.map((i) => i.quote), ...r.preferences.map((p) => p.quote), ...r.mentions.drugs.map((d) => d.quote), ...r.mentions.providers.map((p) => p.quote), ...r.consentSignals.map((c) => c.quote)];
  return `<div class="stage-two">${text != null ? msg(`<p class="stage-transcript">${highlight(text, quotes)}</p>`) : ''}${extractedHTML(r, l)}</div>`;
}

// ---------- step 3: records ----------

/** Plans by providers and drugs, from facts: the "records as of today" view. @param {any} s */
function matrixHTML(s) {
  const cps = [...new Set(s.facts.filter((/** @type {any} */ f) => f.id.startsWith('fact:formulary:')).map((/** @type {any} */ f) => f.id.split(':')[2]))];
  if (!cps.length || !s.scenario) return loadingState('Assembling records');
  const sc = s.scenario;
  const val = (/** @type {string} */ id) => factById(s, id)?.value;
  const planOf = (/** @type {string} */ cp) => sc.plans?.find((/** @type {any} */ p) => p.contractPlanId === cp);
  const pill = (/** @type {string} */ cls, /** @type {string} */ t) => `<span class="pill ${cls}">${esc(t)}</span>`;
  const head = cps.map((cp) => `<th scope="col">${esc(planOf(cp)?.name ?? cp)}${planOf(cp) ? `<span class="stage-sub">${esc(money(planOf(cp).premiumMonthly))}/mo</span>` : ''}</th>`).join('');
  const prov = [...sc.providers, ...sc.facilities].map((/** @type {any} */ p) => `<tr data-row="${esc(p.id)}"><th scope="row">${esc(p.name)}</th>${cps.map((cp) => {
    const v = val(`fact:network:${cp}:${p.id}`);
    return `<td>${v === true ? verified('In network') : v === false ? pill('crit', 'Out of network') : '—'}</td>`;
  }).join('')}</tr>`).join('');
  const drugs = sc.prescriptions.map((/** @type {any} */ d) => `<tr data-row="${esc(d.drugId)}"><th scope="row">${esc(shortDrug(d.name))}</th>${cps.map((cp) => {
    const fv = /** @type {any} */ (val(`fact:formulary:${cp}:${d.drugId}`)), tier = fv && typeof fv === 'object' ? (fv.covered === false ? null : fv.tier) : fv;
    const copay = val(`fact:copay:${cp}:${d.drugId}`), pa = val(`fact:priorauth:${cp}:${d.drugId}`);
    if (tier == null) return `<td>${pill('crit', 'Not covered')}</td>`;
    return `<td>Tier ${esc(tier)} · ${typeof copay === 'number' ? `${esc(money(copay))} copay / 30 days` : '—'}${pa === true ? ' ' + pill('warn', 'Prior auth') : ''}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="tbl-wrap ui-table" tabindex="0" role="region" aria-label="Providers and prescriptions by plan"><table data-testid="plan-matrix"><caption class="sr">Providers and prescriptions, plan by plan</caption><thead><tr><th scope="col"><span class="sr">Item</span></th>${head}</tr></thead><tbody>${prov}${drugs}</tbody></table></div>`;
}

// ---------- step 4: the recommendation ----------

/** Reason text for a candidate: the rule messages (no rule ids), or why an eligible plan ranks where it does. @param {any} rec @param {any} c */
function candidateReason(rec, c) {
  const msgs = [...c.excludedBy, ...c.softFlags]
    .map((/** @type {string} */ r) => rec.ruleResults.find((/** @type {any} */ x) => x.ruleId === r && x.outcome === 'fail' && x.subject === c.planId)?.message).filter(Boolean);
  if (msgs.length) return plainMoney(msgs.join(' '));
  if (!c.eligible) return '';
  return c.rank === 1 ? 'Lowest est. cost' : 'Higher est. cost';
}

/**
 * The plans-checked table of the recommendation: one row per candidate, the recommended row marked with an accent edge, excluded rows muted, no rule id.
 * `compact` puts the result and reason under the plan name (the outreach document column is narrow).
 * @param {any} s @param {any} rec @param {{ compact?: boolean }} [opts]
 */
export function candidatesTableHTML(s, rec, opts = {}) {
  const plansById = (/** @type {string} */ id) => s.scenario?.plans?.find((/** @type {any} */ p) => p.id === id);
  const cands = [...(rec.candidates ?? [])];
  const rows = cands.map((/** @type {any} */ c) => {
    const p = plansById(c.planId);
    const result = !c.eligible ? statusPill('excluded') : c.rank === 1 ? statusPill('recommended') : statusPill('eligible', { n: c.rank });
    const reason = candidateReason(rec, c);
    const name = `<span class="stage-plan">${esc(nameOf(s, c.planId))}</span>`;
    const premium = p ? esc(money(p.premiumMonthly)) : '—';
    const cost = c.estAnnualCost != null ? esc(money(c.estAnnualCost)) : '—';
    const cls = c.rank === 1 ? 'stage-best' : c.eligible ? '' : 'is-excluded';
    return `<tr data-plan="${esc(c.planId)}" data-ctx-type="plan" data-ctx-id="${esc(c.planId)}"${cls ? ` class="${cls}"` : ''}>` + (opts.compact
      ? `<th scope="row">${name}<span class="stage-result">${result}</span>${reason ? `<span class="stage-sub">${esc(reason)}</span>` : ''}</th><td class="r ui-num">${premium}</td><td class="r ui-num">${cost}</td></tr>`
      : `<th scope="row">${name}</th><td class="r ui-num">${premium}</td><td class="r ui-num">${cost}</td><td>${result}</td><td class="stage-reason">${esc(reason)}</td></tr>`);
  }).join('');
  const head = opts.compact
    ? '<th scope="col">Plan</th><th scope="col" class="r">Premium/mo</th><th scope="col" class="r">Est. annual cost</th>'
    : '<th scope="col">Plan</th><th scope="col" class="r">Premium/mo</th><th scope="col" class="r">Est. annual cost</th><th scope="col">Result</th><th scope="col">Reason</th>';
  return `<div class="tbl-wrap ui-table" tabindex="0" role="region" aria-label="Candidate plans"><table data-testid="candidates"><caption class="sr">Candidate plans in ${esc(countyName(s.scenario?.beneficiary.county))}, 2027</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The four "Why it fits" rows: doctors, prescriptions, premium and cost, each stated from the facts the rules passed. @param {any} s @param {any} rec @param {any} best */
function whyItFits(s, rec, best) {
  const o = rec.outcome, sc = s.scenario;
  const facts = (/** @type {RegExp} */ re) => o.reasons.filter((/** @type {string} */ id) => re.test(id)).map((/** @type {string} */ id) => factById(s, id) ?? rec.facts.find((/** @type {any} */ f) => f.id === id)).filter(Boolean);
  /** @type {{ label: string, value: string, note?: string }[]} */
  const rows = [];
  const net = facts(/^fact:network:/);
  if (net.length) {
    const total = Math.max(net.length, (sc?.providers?.length ?? 0) + (sc?.facilities?.length ?? 0));
    rows.push({ label: 'Doctors', value: `${net.length} of ${total} in network`, note: list(net.map((/** @type {any} */ f) => shortProvider(nameOf(s, lastId(f.id))))) });
  }
  const drugIds = [...new Set(facts(/^fact:(formulary|copay):/).map((/** @type {any} */ f) => lastId(f.id)))];
  if (drugIds.length) {
    const copays = facts(/^fact:copay:/).map((/** @type {any} */ f) => f.value).filter((/** @type {any} */ v) => Number.isInteger(v));
    const pa = facts(/^fact:priorauth:/).filter((/** @type {any} */ f) => f.value === true).map((/** @type {any} */ f) => shortDrug(nameOf(s, lastId(f.id))));
    const bits = [];
    if (copays.length) bits.push(`Copays ${money(Math.min(...copays))}–${money(Math.max(...copays))} / 30 days`);
    rows.push({ label: 'Prescriptions', value: `${drugIds.length} of ${Math.max(drugIds.length, sc?.prescriptions?.length ?? 0)} covered${pa.length ? ` · prior authorization for ${list(pa)}` : ''}`, note: bits.join('. ') });
  }
  const prem = facts(/^fact:premium:/)[0], pref = facts(/^fact:pref:max-premium/)[0];
  if (prem) rows.push({ label: 'Premium', value: pref ? `${best?.softFlags?.length ? 'Above' : 'Within'} her ${money(pref.value)} limit` : moneyPerMonth(prem.value), note: moneyPerMonth(prem.value) });
  if (best?.estAnnualCost != null) {
    const eligible = (rec.candidates ?? []).filter((/** @type {any} */ c) => c.eligible).length;
    rows.push({ label: 'Cost', value: best.rank === 1 ? `Lowest of ${eligible} eligible plans` : moneyPerYear(best.estAnnualCost), note: moneyPerYear(best.estAnnualCost) });
  }
  return rows;
}

/** Cost lines of the recommended plan: months x premium, drug costs under the yearly cap, the total. @param {any} rec @param {any} best */
function costRows(rec, best) {
  const by = (/** @type {string} */ p) => rec.calculations.find((/** @type {any} */ c) => best.calcIds.includes(c.id) && c.id.startsWith(p));
  const premium = by('calc:premium-annual:'), raw = by('calc:drug-oop-raw:'), capped = by('calc:drug-oop:'), total = by('calc:annual-cost:');
  /** @type {{ label: string, value: string, note?: string }[]} */ const out = [];
  if (premium) out.push({ label: 'Premium for the year', value: money(premium.value), note: `${premium.args[0]} months at ${money(premium.args[1])} per month` });
  if (capped ?? raw) {
    const d = capped ?? raw;
    out.push({ label: 'Drug costs for the year', value: money(d.value), note: capped && raw && raw.value > capped.value ? `${money(raw.value)} before ${money(capped.args[1])} cap` : capped ? `Under ${money(capped.args[1])} cap` : '' });
  }
  if (total) out.push({ label: 'Estimated annual cost', value: money(total.value), note: 'Premium plus drug costs' });
  return out;
}

/**
 * Where the approval of a recommendation stands, read from the record: a person's decision (s.approval) wins over the trace's own "requires approval" flag.
 * Approved and Rejected are verified lines; before a decision it is the warn pill. @param {any} s @param {any} o the plan-recommendation outcome
 */
export function approvalStatusHTML(s, o) {
  const a = s.approval;
  if (a?.decision === 'approved') return `<span data-status="approved">${verified(`Approved by ${a.approver?.name ?? 'the supervisor'}`)}</span>`;
  if (a?.decision === 'rejected') return `<span data-status="rejected">${verified(`Rejected by ${a.approver?.name ?? 'the supervisor'}`, { state: 'mismatch' })}</span>`;
  return o.requiresApproval ? '<span class="pill warn" data-status="approval">Needs supervisor approval</span>' : '';
}

/** The four figures of the recommendation. @param {any} s @param {any} rec @param {any} best @param {any} plan */
function summaryStats(s, rec, best, plan) {
  const el = electionDates(s);
  return [
    { label: 'Est. annual cost', value: money(best?.estAnnualCost), sub: 'Premium and drugs' },
    { label: 'Premium', value: moneyPerMonth(plan?.premiumMonthly) },
    { label: 'AEP closes', value: dateShort(el.aepEnd), sub: el.aepDays != null ? `${days(el.aepDays)} left` : undefined },
    { label: 'No-gap date', value: dateShort(el.noGapDays != null ? el.noGapDate : null), sub: el.noGapDays != null ? `${days(el.noGapDays)} left` : undefined },
  ];
}

/**
 * The recommendation as figures, shared by the step card and Member Overview: plan name and type, the four-figure stat row, "Why it fits", Why this action? and the
 * native action, the plans-checked table, and the facts and cost calculation folded. `where` is 'stage' or 'overview'; `native` is the trusted markup of the next native button.
 * @param {any} s run state @param {{ where?: 'stage' | 'overview', native?: string }} [opts]
 */
export function recommendationSummaryHTML(s, opts = {}) {
  const rec = recommendation(s); if (!rec) return '';
  const o = rec.outcome.type === 'plan-recommendation' ? rec.outcome : null; if (!o) return '';
  const best = rec.candidates?.find((/** @type {any} */ c) => c.planId === o.recommendedPlanId);
  const plan = s.scenario?.plans?.find((/** @type {any} */ p) => p.id === o.recommendedPlanId);
  const fits = whyItFits(s, rec, best);
  const facts = o.reasons.map((/** @type {string} */ id) => factById(s, id) ?? rec.facts.find((/** @type {any} */ f) => f.id === id)).filter(Boolean);
  const calc = best ? costRows(rec, best) : [];
  const ov = opts.where === 'overview';
  // on Overview the card supplies the plan name, the approval pill, the action row and the folded facts; this is the figures body only
  if (ov) return statRow(summaryStats(s, rec, best, plan)) + (fits.length ? `<div class="stage-fits" data-testid="why-it-fits">${secHead('Why it fits', { level: 4 })}${factList(fits, { max: 4 })}</div>` : '') +
    `<div class="stage-checked">${secHead('Plans checked', { level: 4, meta: `${countyName(s.scenario?.beneficiary.county)}, 2027` })}${candidatesTableHTML(s, rec, { compact: true }).replace('data-testid="candidates"', 'data-testid="plans-checked"')}</div>`;
  return `<section class="stage-reco" data-testid="stage-reco" data-where="${esc(opts.where ?? 'stage')}" data-ctx-type="decision" data-ctx-id="${esc(rec.decisionId)}">
  <div class="stage-reco-top"><div><p class="stage-kicker">Recommended plan</p><h3 class="stage-reco-name">${esc(nameOf(s, o.recommendedPlanId ?? ''))}</h3><p class="small muted">${esc(countyName(s.scenario?.beneficiary.county))} · 2027 plan year</p></div>${approvalStatusHTML(s, o)}</div>
  ${statRow(summaryStats(s, rec, best, plan))}
  <div class="ui-actions">${whyButton(rec.decisionId)}${opts.native ?? ''}</div>
  ${fits.length ? `<div class="stage-fits" data-testid="why-fits">${secHead('Why it fits', { level: 4 })}${factList(fits, { max: 4 })}</div>` : ''}
  <div class="stage-checked">${secHead('Plans checked', { level: 4, meta: `${countyName(s.scenario?.beneficiary.county)}, 2027` })}${candidatesTableHTML(s, rec, { compact: true })}</div>
  ${facts.length ? fold(`Facts (${facts.length})`, factList(facts.map((/** @type {any} */ f) => ({ label: factLabel(f.id), value: plainMoney(f.statement), source: SOURCE[f.source?.system] })), { max: facts.length }), ' data-testid="all-facts"') : ''}
  ${calc.length ? fold('Calculation', factList(calc, { max: calc.length }), ' data-testid="calc-fold"') : ''}</section>`;
}

// ---------- steps 5 to 8: the message ----------

/** The message of a draft: header, body, and the attachment as a link to the comparison. @param {any} s @param {CommunicationDraft} d @param {string} label @param {import('../../shared/contracts.ts').TextEdit[]} [edits] */
export function draftCardHTML(s, d, label, edits) {
  const ins = edits?.filter((e) => e.before === '' && e.after);
  const cut = d.body.lastIndexOf('\n\n');
  const bodyHtml = ins?.length && cut > 0 ? `${esc(d.body.slice(0, cut))}<ins title="Added by rule ${esc(ins[0].ruleId)}">${esc(d.body.slice(cut))}</ins>` : esc(d.body);
  return `<div class="stage-mail" data-testid="draft" data-ctx-type="draft" data-ctx-id="${esc(d.id)}">${label ? `<p class="stage-kicker">${esc(label)}</p>` : ''}${mailHeadHTML(d)}<div class="stage-body">${bodyHtml}</div>` +
    (d.attachments.length ? `<p class="small muted">Attachment: <a href="${esc(outreachHref(s))}" data-testid="attachment-link">Plan comparison</a></p>` : '') + '</div>';
}

/** The claims of a draft with the records behind each one. @param {any} s @param {CommunicationDraft} d */
function claimsHTML(s, d) {
  const rows = d.claims.map((/** @type {any} */ c) => {
    const bySource = new Map();
    for (const f of c.factIds) { const k = factSource(f); bySource.set(k, [...(bySource.get(k) ?? []), f]); }
    return { claim: `“${c.text}”`, source: { html: `<span class="stage-chips">${[...bySource].map(([k, ids]) => chip(k, { title: ids.join(', ') })).join('')}</span>` } };
  });
  return block('Claims',`<div data-testid="claims">${tableHTML({ caption: 'Claims in the draft and the records they come from', columns: [{ key: 'claim', label: 'Claim' }, { key: 'source', label: 'Source' }], rows })}</div>`, { meta: `${rows.length} claims` });
}

/** The verdict callout text: the gate's own headline when it has one. @param {any} o @param {string} [stepHeadline] the gate step's headline from the run (B6) */
function gateHeadline(o, stepHeadline) {
  if (stepHeadline) return stepHeadline;
  if (o.headline) return o.headline;
  const added = (o.edits ?? []).filter((/** @type {any} */ e) => /^DISC-/.test(e.ruleId)).length;
  if (o.verdict === 'pass') return added ? `Passed · ${added} disclosure${added === 1 ? '' : 's'} added` : 'Passed';
  if (o.verdict === 'held-for-approval') return 'Held for approval';
  return `Blocked: ${o.violations?.length ?? 0} rules failed`;
}

// ---------- steps 10 to 17: the execution checklist ----------

/** The seven actions of the closed loop, in the order the email lists them. */
const EXECUTION = /** @type {{ step: string, label: string }[]} */ ([
  { step: 'action.compare', label: 'Comparison generated' }, { step: 'action.deliver', label: 'Approved email delivered' }, { step: 'action.crm-log', label: 'Activity logged in CRM' },
  { step: 'action.task', label: 'Follow-up task created' }, { step: 'action.escalate', label: 'Exception escalated' }, { step: 'action.monitor', label: 'Response monitored' },
  { step: 'decision.next-action', label: 'Next action recalculated' },
]);
/** The checklist row a viewed step belongs to. */
const ROW_OF = /** @type {Record<string, string>} */ ({ 'signal.reply-interpret': 'action.monitor' });

/** The one artefact link of a done row. @param {any} s @param {string} step */
function artefact(s, step) {
  const rec = (/** @type {string} */ type) => s.crm.find((/** @type {any} */ w) => w.objectType === type)?.recordId;
  const view = (/** @type {string} */ label, /** @type {string} */ target) => `<button type="button" class="stage-link" data-act="member.view" data-v="${esc(target)}">${esc(label)}</button>`;
  const link = (/** @type {string} */ label, /** @type {string} */ href, /** @type {string} */ extra = '') => `<a class="stage-link" href="${esc(href)}"${extra}>${esc(label)}</a>`;
  switch (step) {
    case 'action.compare': return link('Open comparison', outreachHref(s), ' data-testid="comparison-link"');
    case 'action.deliver': return view('Sent message', 'action.deliver');
    case 'action.crm-log': return link(`Activity ${rec('Activity') ?? ''}`.trim(), '#crm/activity');
    case 'action.task': return link(`Task ${rec('Task') ?? ''}`.trim(), '#crm/tasks');
    case 'action.escalate': return link(`Case ${rec('Case') ?? ''}`.trim(), '#crm/cases');
    case 'action.monitor': return view('Reply', 'action.monitor');
    default: return view('Next action', 'decision.next-action');
  }
}

/** The execution checklist: seven rows that fill from the chain events, a state icon, one artefact link and a time on each. @param {any} s @param {string} current */
export function executionHTML(s, current) {
  const cur = ROW_OF[current] ?? current;
  const done = EXECUTION.filter((r) => stepStatus(s, r.step) === 'done').length;
  const rows = EXECUTION.map((r) => {
    const st = stepStatus(s, r.step), t = s.timeline.find((/** @type {any} */ x) => x.step === r.step);
    // a done row carries the verified icon (the one green), a running row a spinner, a waiting row an empty ring
    const icon = st === 'done' ? '<span class="ui-verified" data-state="verified"><span class="ui-verified-ic" aria-hidden="true">' + CHECK + '</span></span><span class="sr">Done: </span>' : st === 'started' ? '<span class="stage-ck-run" aria-hidden="true"></span><span class="sr">Running: </span>' : '<span class="stage-ck-wait" aria-hidden="true"></span><span class="sr">Waiting: </span>';
    return `<li class="stage-ck is-${st}${r.step === cur ? ' is-current' : ''}" data-step="${esc(r.step)}"${r.step === cur ? ' aria-current="step"' : ''}>${icon}<span class="stage-ck-l">${esc(r.label)}</span>` +
      `<span class="stage-ck-a">${st === 'done' ? artefact(s, r.step) : ''}</span><time class="stage-ck-t"${t ? ` datetime="${esc(t.at)}"` : ''}>${t && st === 'done' ? esc(timeOfDay(t.at)) : '—'}</time></li>`;
  }).join('');
  return `<section class="stage-loop" data-testid="closed-loop">${secHead('Execution', { level: 3, meta: `${done} of ${EXECUTION.length} done` })}<ol class="stage-ck-list" aria-label="Execution checklist">${rows}</ol></section>`;
}

/** A message that arrived or went out: who, channel and time on one line, the text below. @param {{ title: string, from: string, when: string, text: string | null, testid: string }} m */
function messageCard(m) {
  return `<section class="stage-block stage-msg" data-testid="${esc(m.testid)}">${secHead(m.title, { level: 3, right: chip('Simulated') })}<p class="small muted">${esc(m.from)} · ${esc(m.when)}</p>${m.text ? `<div class="stage-body">${esc(m.text)}</div>` : ''}</section>`;
}

/** @param {any} s */
function sentMessageHTML(s) {
  const d = heldMessage(s); if (!d) return '';
  const t = s.timeline.find((/** @type {any} */ x) => x.step === 'action.deliver');
  return `<section class="stage-block stage-msg" data-testid="sent-message">${secHead('Sent message', { level: 3, right: chip('Simulated') })}${mailHeadHTML(d)}${t ? `<p class="small muted">Sent ${esc(dateTime(t.at))}</p>` : ''}<div class="stage-body">${esc(d.body)}</div></section>`;
}

// ---------- the step bodies ----------

/** The body of one step without the frame (the outreach document reuses the draft, gate and edit bodies). @param {GovCtx} ctx @param {string} id */
export const stepBodyHTML = (ctx, id) => BODY[id]?.(ctx, id) ?? '';

/** @type {Record<string, (ctx: GovCtx, id: string) => string>} */
const BODY = {
  'signal.intake': ({ state: s }) => {
    const sc = s.scenario; if (!sc) return '';
    const el = electionDates(s);
    const stats = statRow([
      { label: 'Plan ends', value: dateLong(sc.currentPlan.endsOn) },
      { label: 'Voicemail', value: dateTime(sc.inbound.at) },
      { label: 'AEP closes', value: dateShort(el.aepEnd), sub: el.aepDays != null ? days(el.aepDays) : undefined },
      { label: 'No-gap date', value: dateShort(el.noGapDate), sub: el.noGapDays != null ? days(el.noGapDays) : undefined },
    ]);
    const sources = factList([
      { label: 'Non-renewal letter', value: `Mailed ${dateLong(sc.currentPlan.noticeMailedOn)}`, note: `Not offered in ${countyName(sc.beneficiary.county)} after ${dateLong(sc.currentPlan.endsOn)}` },
      { label: 'Voicemail', value: `From ${casualName(sc.beneficiary.name)}, ${dateTime(sc.inbound.at)}`, note: sc.inbound.subject },
    ]);
    return stats + block('Sources', sources);
  },

  'signal.interpret': ({ state: s }) => interpretBody(s, 'signal.interpret', s.scenario?.inbound.text ?? '', { title: 'Voicemail', when: s.scenario ? dateTime(s.scenario.inbound.at) : '', chip: 'Member message' }),

  'memory.assemble': ({ state: s }) => {
    if (!s.scenario) return '';
    const systems = new Set(s.sources.map((/** @type {any} */ x) => x.system)).size;
    return statRow([
      { label: 'Source records', value: String(s.sources.length) }, { label: 'Systems', value: String(systems) },
      { label: 'Plan data', value: planDataDate(s) || '—' }, { label: 'Plans compared', value: String(s.scenario.plans?.length ?? 0) },
    ]) + block('Providers and prescriptions by plan', matrixHTML(s), { right: `<a class="btn ghost" href="#member/${esc(urlId(s))}/coverage">Open coverage checks</a>` });
  },

  'decision.recommend': ({ state: s }) => recommendationSummaryHTML(s, { where: 'stage' }),

  'action.draft': ({ state: s }) => {
    const d = s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).find((/** @type {CommunicationDraft} */ x) => x.author.kind === 'llm' && !/gated/.test(x.id));
    return d ? draftCardHTML(s, d, 'Draft email') + claimsHTML(s, d) : '';
  },

  'action.gate': ({ state: s }) => {
    const t = decisionsOfKind(s, 'communication-gate')[0]; if (!t || t.outcome.type !== 'communication-gate') return '';
    const o = /** @type {any} */ (t.outcome);
    const kind = o.verdict === 'pass' ? 'good' : o.verdict === 'held-for-approval' ? 'warn' : 'block';
    const passed = t.ruleResults.filter((r) => r.outcome === 'pass').length;
    const added = (o.edits ?? []).filter((/** @type {any} */ e) => /^DISC-/.test(e.ruleId));
    const failed = (o.violations ?? []).length;
    const stats = statRow([
      { label: 'Rules passed', value: String(passed) }, ...(failed ? [{ label: 'Rules failed', value: String(failed) }] : []),
      { label: 'Disclosures added', value: String(added.length) }, { label: 'Next', value: o.verdict === 'blocked' ? 'Correction' : 'Supervisor approval' },
    ]);
    const quotes = added.length ? block('Added by rules', added.map((/** @type {any} */ e) => `<blockquote class="stage-quote-block" data-testid="disclosure-quote"><p>${esc(String(e.after).trim())}</p><footer>${ruleRef(e.ruleId)}</footer></blockquote>`).join('')) : '';
    const headline = gateHeadline(o, s.steps['action.gate']?.headline), why = whyButton(t.decisionId, 'Why this verdict?');
    // a passed gate is a lasting result (one verified line); a held or blocked one is a state banner
    const verdict = kind === 'good'
      ? `<div class="stage-verdict">${verified(headline).replace('<span class="ui-verified-l">', '<span class="ui-verified-l" data-testid="gate-headline">')}${why}</div>`
      : callout(kind, headline, { right: why, testid: 'gate-headline' });
    return verdict + stats + quotes + (o.corrected ? draftCardHTML(s, o.corrected, 'Corrected message', o.edits) : '');
  },

  'action.rep-edit': ({ state: s }) => {
    const ai = s.drafts['draft-1'] ?? s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).find((/** @type {CommunicationDraft} */ x) => x.author.kind === 'llm');
    // the agent's own edit, not the corrected copy the gate makes of it (that copy carries the trace's as-of time)
    const human = s.draftOrder.map((/** @type {string} */ i) => s.drafts[i]).find((/** @type {CommunicationDraft} */ x) => x.author.kind === 'human' && !/-corrected$/.test(x.id));
    if (!human) return '';
    const base = ai && human.body.startsWith(ai.body) ? ai.body : '';
    const added = human.body.slice(base.length).trim();
    const sc = s.scenario;
    const changed = ai && ai.channel !== human.channel;
    const line = `<p class="stage-seed" data-testid="seeded">Edited by ${esc(sc?.agent.name ?? 'the agent')}, ${esc(String(sc?.agent.role ?? 'licensed-agent').replace(/-/g, ' '))} · ${esc(dateTime(human.createdAt))} ${chip('Scripted edit')}</p>`;
    const stats = changed ? statRow([{ label: 'Channel', value: `${CHANNEL[ai.channel] ?? ai.channel} → ${CHANNEL[human.channel] ?? human.channel}` }, { label: 'Change', value: 'Sentence added' }]) : '';
    const full = `${mailHeadHTML(human)}<div class="stage-body">${base ? `${esc(base)}<mark class="stage-added">${esc(human.body.slice(base.length))}</mark>` : esc(human.body)}</div>`;
    return line + stats + (added ? block('Added sentence', `<div class="stage-body stage-added-body"><mark class="stage-added">${esc(added)}</mark></div>`, { level: 4 }) : '') + fold('Full message', full);
  },

  'action.gate-recheck': (ctx) => complianceHTML(ctx),

  'human.approve': (ctx) => approvalHTML(ctx, { badge: false }),

  'action.compare': ({ state: s }, id) => executionHTML(s, id),
  'action.deliver': ({ state: s }, id) => sentMessageHTML(s) + executionHTML(s, id),
  'action.crm-log': ({ state: s }, id) => executionHTML(s, id),
  'action.task': ({ state: s }, id) => executionHTML(s, id),
  'action.escalate': ({ state: s }, id) => executionHTML(s, id),

  'action.monitor': ({ state: s }, id) => {
    const t = s.timeline.find((/** @type {any} */ x) => x.step === 'action.monitor');
    const r = s.scenario?.memberReply;
    return messageCard({
      title: 'Her reply', from: `From ${casualName(s.scenario?.beneficiary.name ?? '')} · ${CHANNEL[r?.channel ?? 'email'] ?? 'Email'}`, when: t && stepStatus(s, 'action.monitor') === 'done' ? dateTime(t.at) : 'Waiting',
      text: r?.text ?? null, testid: 'reply-card',
    }) + executionHTML(s, id);
  },

  'signal.reply-interpret': ({ state: s }, id) => interpretBody(s, id, s.scenario?.memberReply?.text ?? null, { title: 'Her reply', chip: 'Simulated' }) + executionHTML(s, id),

  'decision.next-action': ({ state: s }, id) => {
    const t = decisionsOfKind(s, 'next-action')[0]; if (!t || t.outcome.type !== 'next-action') return '';
    const o = t.outcome;
    const label = /** @type {Record<string, string>} */ ({ 'send-soa': 'Record SOA, then call', 'book-appointment': 'Book the appointment', wait: 'Wait', escalate: 'Escalate', close: 'Close' })[o.action] ?? o.action;
    const stats = statRow([
      { label: 'Next action', value: label }, ...(o.earliestAppointment ? [{ label: 'Earliest call', value: dateTime(o.earliestAppointment) }] : []), { label: 'Owner', value: s.scenario?.agent.name ?? '—' },
    ]);
    const topicRule = t.ruleResults.find((r) => r.ruleId === 'WF-PRE-ENROLLMENT-TOPICS' && r.outcome === 'pass');
    const topicText = [topicRule?.message, ...o.reasons].find((x) => typeof x === 'string' && x.startsWith('Cover before enrollment:'));
    const topics = topicText ? topicText.replace(/^Cover before enrollment:\s*/, '').replace(/\.$/, '').split('; ').filter(Boolean) : [];
    const reasonText = (/** @type {string} */ r) => plainMoney(factById(s, r)?.statement ?? t.facts.find((f) => f.id === r)?.statement ?? r);
    const reasons = o.reasons.filter((r) => !r.startsWith('Cover before enrollment:')).map(reasonText);
    const write = stepStatus(s, 'decision.next-action') === 'done' ? s.crm.filter((/** @type {any} */ w) => w.objectType === 'Member').at(-1) : null;
    const title = (/** @type {string} */ k) => k.replace(/\b([a-z])/g, (_m, c) => c.toUpperCase());
    const changes = write ? block('CRM changes', tableHTML({
      caption: 'Fields the next-action decision changed in the CRM', columns: [{ key: 'f', label: 'Field' }, { key: 'b', label: 'Before' }, { key: 'a', label: 'After' }],
      rows: Object.entries(write.after).map(([k, v]) => ({ f: title(k), b: String(write.before?.[k] ?? '—'), a: String(v) })),
    }), { right: chip('Simulated'), attrs: ' data-testid="crm-changes"' }) : '';
    return stats + (reasons.length ? block('Why', `<ul class="stage-reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`) : '') +
      (topics.length ? block('Cover before enrollment', `<ul class="stage-topics">${topics.map((x) => `<li class="chip"><span aria-hidden="true">${CHECK}</span> ${esc(x)}</li>`).join('')}</ul>`, { meta: `${topics.length} topics` }) : '') +
      changes + executionHTML(s, id);
  },

  'briefing.audit': ({ state: s }) => {
    const c = s.cycle;
    const approvals = s.approval || stepStatus(s, 'human.approve') === 'done' ? 1 : 0;
    const pkg = s.audit
      ? statRow([
        { label: 'Package', value: `${Math.round(s.audit.bytes / 1024)} KB` }, { label: 'Decisions', value: String(s.decisions.length) },
        { label: 'Approvals', value: String(approvals) }, { label: 'CRM writes', value: String(s.crm.length) },
      ]) + `<div class="stage-dl"><p class="small muted">Record hash ${idCode(shortHash(s.audit.recordSha256))}</p><a class="btn pri" data-testid="audit-link" href="${esc(s.audit.url)}" download>Download audit package</a></div>`
      : loadingState('Building…');
    const time = c ? statRow([
      { label: 'This run', value: duration(c.measuredMs), sub: 'Intake to the last CRM write' }, { label: 'Manual estimate', value: `${c.baseline.minutes} min`, sub: 'Modeled assumption', title: c.baseline.note },
    ]) + fold('Baseline by task',factList(c.baseline.breakdown.map((/** @type {any} */ b) => ({ label: b.task, value: `${b.minutes} min` })), { max: c.baseline.breakdown.length })) : '';
    return `<section class="stage-audit" data-testid="audit-card">${block('Audit package', pkg)}${c ? block('Time to complete', time) : ''}</section>`;
  },
};

/** Adapter for the retired V0 public/js/main.js, which still imports this name; delete it together with that file. @param {HTMLElement} el @param {any} s @param {any} app */
export function renderStage(el, s, app) {
  el.innerHTML = stageHTML({ state: s, ui: app, role: 'agent' });
}
