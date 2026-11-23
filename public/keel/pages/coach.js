/* Copied from keel-prototype v1.2.3 public/prototype.js (PAGES.coach: case rail, chat card, scorecard, next best actions), adapted for adopt-keel-shell */
// Agent Coach (S6, polished in UI6). The case rail, the chat card and the right column keep the Keel markup. Everything the page says about Dottie's case is read from
// the run: the scorecard is the rule results of the recommendation trace (pass or fail, never a score the page made up), the next best action is the
// rules' own. Sample members have no trace, so they get no verdict. The docked ask bar is S7's (`dock: 'coach'`).
// "On the call" (change cosmetic-and-oncall, design D7): four rows read from the rules traces by onCallChecks() (labels.js) and the member's questions as chips through the existing /api/ask. Labels and values, no prose.
import { electionDates, onCallChecks, planLabel, shortNames } from '../../js/labels.js';
import { packNo, snapshotDay } from '../../js/replay-format.js';
import { dateLong, dateShort, dateTime, money } from '../../ui/format.js';
import { STEPS, stepMeta } from '../../js/steps.js';
import { decisionsOfKind, factById, nameOf, recommendation } from '../../js/state.js';
import { emptyState, idCode, prov, secHead, statusPill, verified } from '../../ui/primitives.js';
import { esc, registerPage, scheduleRender, top } from '../shell.js';
import { shortName } from './home.js';

/** @typedef {import('../../../shared/contracts.ts').DecisionTrace} DecisionTrace */
/** @typedef {import('../../../shared/contracts.ts').RuleResult} RuleResult */

const MAIN_CASE = 'ben-hayes';
/** Selected case and scorecard plan live here, not in the run: they are view state, they never reach the server. */
let selected = MAIN_CASE;
/** A plan id, 'excluded' for the list of excluded plans, or null for the recommended plan. @type {string | null} */
let planPick = null;
/** The Blocked words details is open. Module state: the shell rebuilds the page on every run event, and the terms load with the Rules view the first time it opens. */
let termsOpen = false;
/** View state setters, for the page acts and the unit tests. @param {string} id */
export const selectCase = (id) => { selected = id || MAIN_CASE; planPick = null; };
/** @param {string | null} id */
export const pickPlan = (id) => { planPick = id; };

const SITUATION = /** @type {Record<string, string>} */ ({ renewing: 'Renewing', 'non-renewing': 'Non-renewing', 'new-to-medicare': 'New to Medicare', moved: 'Moved', 'turning-65': 'Turning 65' });
const ACTION_TEXT = /** @type {Record<string, string>} */ ({
  'send-soa': 'Record SOA before the call',
  'book-appointment': 'Book the appointment',
  wait: 'Wait for the member',
  escalate: 'Escalate to a supervisor',
  close: 'Close the case',
});

/** "Lorain County" and "Lorain" both read "... County". @param {string} c */
const county = (c) => (/county$/i.test(c) ? c : c + ' County');

/** @param {string} name */
const initials = (name) => { const nick = /[“"”]([^“"”]+)[“"”]/.exec(name)?.[1]; const w = name.replace(/[“"”].*?[“"”]\s*/g, '').trim().split(/\s+/); return ((nick ?? w[0] ?? '')[0] + (w.length > 1 ? (w.at(-1)?.[0] ?? '') : '')).toUpperCase(); };

/** A date the rules wrote as 2026-12-07 reads "Dec 7, 2026"; whole dollars lose ".00" ("$18.00" reads "$18"). @param {string} t */
const plainDates = (t) => shortNames(String(t ?? '')).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => dateLong(d)).replace(/(\$[\d,]+)\.00\b/g, '$1');

/** First name for questions: the nickname in quotes when the record has one. @param {string} name */
const firstName = (name) => /[“"”]([^“"”]+)[“"”]/.exec(name)?.[1] ?? name.trim().split(/\s+/)[0] ?? name;

/** Rule results that make up the suitability scorecard for one plan: eligibility, suitability and cost rules, applicable ones only.
 * @param {DecisionTrace} trace @param {string} planId @returns {RuleResult[]} */
export function scorecardRows(trace, planId) {
  return trace.ruleResults.filter((r) => /^(ELIG|SUIT|COST)-/.test(r.ruleId) && r.outcome !== 'not_applicable' && (r.subject === planId || r.subject == null || r.subject === 'case'));
}

/** Workflow requirements the rules raised for the plan (WF-* rules that failed): steps that must happen before anything is sent.
 * @param {DecisionTrace} trace @param {string} planId */
export function requirements(trace, planId) {
  return trace.ruleResults.filter((r) => /^WF-/.test(r.ruleId) && r.outcome === 'fail' && (r.subject === planId || r.subject == null || r.subject === 'case'));
}

/** The recommendation's candidates, eligible first, in the rules' rank order. @param {DecisionTrace | null} rec */
const candidatesOf = (rec) => [...(rec?.candidates ?? [])].sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.rank ?? 99) - (b.rank ?? 99));

/** The plan the scorecard shows: the one picked, else the recommended one, else the first eligible; 'excluded' when every plan was excluded. @param {DecisionTrace | null} rec */
function chosenPlan(rec) {
  const o = rec?.outcome?.type === 'plan-recommendation' ? rec.outcome : null;
  const all = candidatesOf(rec), eligible = all.filter((c) => c.eligible);
  if (planPick === 'excluded' && all.some((c) => !c.eligible)) return 'excluded';
  if (planPick && eligible.some((c) => c.planId === planPick)) return planPick;
  return o?.recommendedPlanId ?? eligible[0]?.planId ?? (all.length ? 'excluded' : null);
}

// ---------- rail ----------
/** @param {any} ctx */
function railHTML(ctx) {
  const sc = ctx.state.scenario ?? ctx.run.views?.scenario;
  const story = ctx.run.views?.story;
  const aep = electionDates(ctx.state).aepEnd;
  const one = (/** @type {{ id: string, name: string, line: string, meta: string }} */ x) =>
    '<button type="button" data-act="coach.case" data-v="' + esc(x.id) + '" data-testid="coach-case-' + esc(x.id) + '" aria-pressed="' + (x.id === selected) + '"><span class="small muted">' + esc(x.line) + '</span><b>' + esc(x.name) + '</b><span class="small">' + esc(x.meta) + '</span></button>';
  const samples = (story?.members ?? []).map((/** @type {any} */ m) => ({ id: m.id, name: m.name, line: county(m.county), meta: SITUATION[m.situation] ?? m.situation }));
  if (!sc && !samples.length) return '<div class="deals" aria-label="Cases"><p class="small muted pad">Loading</p></div>';
  return '<div class="deals" role="group" aria-label="Cases">' +
    (sc ? one({ id: MAIN_CASE, name: shortName(sc), line: county(sc.beneficiary.county), meta: 'Non-renewing' + (aep ? ' · AEP ' + dateShort(aep) : '') }) : '') +
    (samples.length ? '<p class="coach-sample small muted">Sample members</p>' + samples.map(one).join('') : '') + '</div>';
}

// ---------- chat card ----------
/** The first bubble: the rules' result as values, in one line. Nothing here is generated. @param {any} ctx */
function seedHTML(ctx) {
  const s = ctx.state, sc = s.scenario;
  const rec = recommendation(s);
  const o = rec?.outcome?.type === 'plan-recommendation' ? rec.outcome : null;
  if (!sc) return '<p>Loading</p>';
  if (!rec || !o) return '<p><b>' + esc(sc.currentPlan.name) + '</b> ends ' + esc(dateLong(sc.currentPlan.endsOn)) + ' · <span class="nowrap">2027 plans not checked</span></p>';
  const cand = rec.candidates ?? [];
  const best = cand.find((c) => c.planId === o.recommendedPlanId);
  const out = cand.filter((c) => !c.eligible).length;
  const first = o.recommendedPlanId ? 'Recommended: <b>' + esc(nameOf(s, o.recommendedPlanId)) + '</b>' + (best?.estAnnualCost != null ? ' · ' + esc(money(best.estAnnualCost)) + '/yr' : '') : 'No eligible plan';
  const day = snapshotDay(rec.snapshot.id);
  const foot = '<p class="src">' + esc(rec.decisionId) + ' · Rule pack ' + esc(packNo(rec.pack)) + (day ? ' · Plan data ' + esc(day) : '') + '</p>';
  return '<p>' + first + ' · ' + out + ' excluded</p>' + foot;
}

/** The case questions, as the chips inside the card. @param {string} name */
const QUESTIONS = (name) => ['Why were the other plans excluded?', 'What does ' + firstName(name) + ' need before Dec 31?', 'Which records did the rules use?'];

/** @param {any} ctx */
function chatHTML(ctx) {
  const s = ctx.state, sc = s.scenario;
  const dottie = selected === MAIN_CASE;
  const sample = (ctx.run.views?.story?.members ?? []).find((/** @type {any} */ m) => m.id === selected);
  const name = dottie ? (sc ? shortName(sc) : '') : (sample?.name ?? 'Member');
  const stepNo = s.head ? 'Step ' + stepMeta(s.head).n + ' of ' + STEPS.length : 'Not opened';
  const sub = dottie
    ? (sc ? esc(county(sc.beneficiary.county)) + ' · ' + esc(sc.currentPlan.name) : 'Loading')
    : esc(county(sample?.county ?? '') + ' · ' + planLabel(sample?.currentPlanLabel));
  const pill = dottie ? '<span class="pill neutral coach-status" title="' + esc(s.head ? stepMeta(s.head).title : '') + '">' + esc(stepNo) + '</span>' : '';
  const seed = dottie ? seedHTML(ctx) : '<p>No review yet</p>';
  const chips = dottie
    ? (recommendation(s) ? QUESTIONS(name).map((q) => '<button type="button" data-act="coach.ask" data-v="' + esc(q) + '">' + esc(q) + '</button>').join('') : '')
    : '<button type="button" data-act="coach.case" data-v="' + MAIN_CASE + '">Go to ' + esc(sc ? shortName(sc) : 'the main') + '’s case</button>';
  return '<div class="card chat" data-testid="coach-chat"><div class="pad coach-head"><div class="logo">' + esc(initials(name)) + '</div><div><b>' + esc(name) + '</b><div class="small muted">' + sub + '</div></div>' + pill + '</div>' +
    '<div class="chatlog" id="chatlog" role="log" aria-label="Coach conversation"><div class="bubble a">' + seed + '</div></div>' +
    (chips ? '<div class="pad coach-foot"><div class="sugg">' + chips + '</div></div>' : '') + '</div>';
}

// ---------- right column ----------
/** One rule result: its title with its verified Pass or Fail state, then the reason clamped to two lines (the full text in the title). The rule id is a tooltip only. @param {RuleResult} r */
function ruleRow(r) {
  const pass = r.outcome === 'pass';
  return '<div class="coach-rule" data-rule="' + esc(r.ruleId) + '" data-outcome="' + esc(r.outcome) + '" data-ctx-type="rule" data-ctx-id="' + esc(r.ruleId) + '" title="Rule ' + esc(r.ruleId) + '">' +
    '<span class="coach-label">' + esc(r.title) + '</span>' + verified(pass ? 'Pass' : 'Fail', { state: pass ? 'verified' : 'mismatch' }) +
    '<p class="coach-why small muted" title="' + esc(plainDates(r.message)) + '">' + esc(plainDates(r.message)) + '</p></div>';
}

/** The excluded plans, each with the rule that excluded it, in the rules' words. @param {DecisionTrace} rec @param {any} s */
function excludedHTML(rec, s) {
  const out = candidatesOf(rec).filter((c) => !c.eligible);
  return '<div class="coach-rules">' + out.map((c) => {
    const fails = rec.ruleResults.filter((x) => x.subject === c.planId && x.outcome === 'fail' && c.excludedBy.includes(x.ruleId));
    const why = fails[0]?.message ?? 'Excluded';
    return '<div class="coach-rule" data-excluded="' + esc(c.planId) + '" title="' + esc(fails.map((x) => x.ruleId).join(', ')) + '"><span class="coach-label">' + esc(nameOf(s, c.planId)) + '</span>' + statusPill('excluded') +
      '<p class="coach-why small muted" title="' + esc(plainDates(why)) + '">' + esc(plainDates(why)) + '</p></div>';
  }).join('') + '</div>';
}

/** @param {any} ctx */
function scorecardHTML(ctx) {
  const s = ctx.state;
  const rec = recommendation(s);
  const o = rec?.outcome?.type === 'plan-recommendation' ? rec.outcome : null;
  const card = (/** @type {string} */ body) => '<div class="card pad" data-testid="coach-scorecard">' + secHead('Suitability scorecard', { level: 3 }) + body + '</div>';
  if (selected !== MAIN_CASE) return card(emptyState('No review yet'));
  if (!rec || !o) return card(emptyState('Not checked yet'));
  const plan = chosenPlan(rec);
  const all = candidatesOf(rec), eligible = all.filter((c) => c.eligible), excludedN = all.length - eligible.length;
  // plans of one carrier read "Choice (PPO)" and "Value (HMO)" in the narrow selector; the full name is the tooltip
  const names = eligible.map((c) => nameOf(s, c.planId)), brand = names[0]?.split(' ')[0] ?? '';
  const label = (/** @type {string} */ n) => (names.length > 1 && names.every((x) => x.startsWith(brand + ' ')) ? n.slice(brand.length + 1) : n);
  const seg = '<div class="seg coach-seg" role="group" aria-label="Plan to score">' + eligible.map((c) =>
    '<button type="button" data-act="coach.plan" data-v="' + esc(c.planId) + '" aria-pressed="' + (c.planId === plan) + '" title="' + esc(nameOf(s, c.planId)) + '">' + esc(label(nameOf(s, c.planId))) + '</button>').join('') +
    (excludedN ? '<button type="button" data-act="coach.plan" data-v="excluded" aria-pressed="' + (plan === 'excluded') + '">Excluded (' + excludedN + ')</button>' : '') + '</div>';
  if (plan === 'excluded' || !plan) {
    return '<div class="card pad" data-testid="coach-scorecard" data-plan="excluded">' + secHead('Suitability scorecard', { level: 3, meta: 'From ' + rec.decisionId }) + seg + excludedHTML(rec, s) + '</div>';
  }
  const cand = all.find((c) => c.planId === plan);
  const rows = scorecardRows(rec, plan);
  const passed = rows.filter((r) => r.outcome === 'pass').length;
  const verdict = cand ? (plan === o.recommendedPlanId ? statusPill('recommended') : statusPill('eligible', cand.rank != null ? { n: cand.rank } : {})) : '';
  const cost = cand?.estAnnualCost != null ? '<span class="small muted">Est. <span class="ui-num">' + esc(money(cand.estAnnualCost)) + '</span>/yr</span>' : '';
  const pct = rows.length ? Math.round((passed * 100) / rows.length) : 0;
  return '<div class="card pad" data-testid="coach-scorecard" data-plan="' + esc(plan) + '">' +
    secHead('Suitability scorecard', { level: 3, meta: 'From ' + rec.decisionId, right: '<span class="ui-num coach-total">' + passed + ' of ' + rows.length + '</span>' }) +
    '<div class="bar coach-meter" role="img" aria-label="' + passed + ' of ' + rows.length + ' rules passed"><i style="width:' + pct + '%"></i></div>' +
    seg + '<div class="coach-verdict">' + verdict + cost + '</div>' +
    '<div class="coach-rules">' + (rows.length ? rows.map(ruleRow).join('') : '<p class="muted small">No rules applied</p>') + '</div></div>';
}

/** The next action as one line: the rules' action and its time. The reasons are one press away (Why this action?); the pre-enrollment topics are in On the call. @param {any} ctx @returns {{ items: string[], why: string | null }} */
function nextActions(ctx) {
  const s = ctx.state;
  const na = decisionsOfKind(s, 'next-action').at(-1);
  if (na && na.outcome.type === 'next-action') {
    const o = na.outcome;
    return { items: [(ACTION_TEXT[o.action] ?? o.action) + (o.earliestAppointment ? ', earliest ' + dateTime(o.earliestAppointment) : '')], why: na.decisionId };
  }
  const rec = recommendation(s);
  if (rec && rec.outcome.type === 'plan-recommendation') {
    const o = rec.outcome;
    return { items: [o.recommendedPlanId ? 'Review recommendation: ' + nameOf(s, o.recommendedPlanId) : 'Review exclusions'], why: rec.decisionId };
  }
  return { items: [], why: null };
}

/** @param {any} ctx */
function nbaHTML(ctx) {
  const head = secHead('Next best actions', { level: 3 });
  if (selected !== MAIN_CASE) return '<div class="card pad" data-testid="coach-next-action">' + head + emptyState('No review yet') + '</div>';
  const { items, why } = nextActions(ctx);
  if (!items.length) return '<div class="card pad" data-testid="coach-next-action">' + head + emptyState('Not checked yet') + '</div>';
  const li = items.map((n, i) => '<div><i>' + (i + 1) + '</i><span>' + esc(n) + '</span></div>').join('');
  return '<div class="card pad" data-testid="coach-next-action">' + head + (why ? prov('rules', ['Decided by rules']) : '') + '<div class="nba">' + li + '</div>' +
    (why ? '<div class="sig-act"><button type="button" class="btn" data-act="why" data-v="' + esc(why) + '" data-testid="coach-why">Why this action?</button></div>' : '') + '</div>';
}

// ---------- On the call ----------
/** The member's questions as chips: the three the card always offers once a recommendation exists, the fourth once the next action is decided. @param {any} s */
const MEMBER_QUESTIONS = (s) => ['Why not Northlake Value?', 'Is Dr. Brennan covered?', 'What will it cost?', ...(decisionsOfKind(s, 'next-action').length ? ['Do I need a Scope of Appointment?'] : [])];
/** @type {Record<string, 'verified' | 'mismatch' | 'pending' | 'na'>} */
const CHECK_ICON = { verified: 'verified', mismatch: 'mismatch', pending: 'pending', na: 'na', unchecked: 'pending' };

/** One row of the checklist: the label, its real state from the traces, the rule ids, and what the row holds (the seven topics, the blocked terms). @param {import('../../js/labels.js').OnCallRow} r @param {boolean} rulesLoaded */
function checkRow(r, rulesLoaded) {
  const ids = r.rules.map((id) => idCode(id)).join(' ') + (r.when ? ' <span class="muted small">Before ' + esc(r.when) + '</span>' : '');
  const more = r.key === 'topics' && r.items?.length ? '<ul class="coach-list">' + r.items.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>'
    : r.key === 'blocked' ? '<details class="coach-more"' + (termsOpen ? ' open' : '') + '><summary data-act="coach.terms">' + (r.terms?.length ? r.terms.length + ' terms' : 'Terms') + '</summary>' +
      '<p class="coach-terms' + (r.terms?.length ? '' : ' muted') + '">' + (r.terms?.length ? esc(r.terms.join(', ')) : rulesLoaded ? '' : 'Loading') + '</p></details>'
      : '';
  return '<div class="coach-rule coach-check" data-check="' + r.key + '" data-state="' + r.state + '"><span class="coach-label">' + esc(r.label) + '</span>' +
    verified(r.text, { state: CHECK_ICON[r.state] }) + '<span class="coach-ids">' + ids + '</span>' + more + '</div>';
}

/** The On the call card for Dottie's case; sample members have no trace, so no card. @param {any} ctx */
function onCallHTML(ctx) {
  if (selected !== MAIN_CASE) return '';
  const s = ctx.state;
  const rows = onCallChecks(s, ctx.run.views?.rules);
  const chips = recommendation(s) ? '<div class="sugg" data-testid="coach-oncall-chips">' + MEMBER_QUESTIONS(s).map((q) => '<button type="button" data-act="coach.ask" data-v="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' : '';
  return '<div class="card pad coach-oncall" data-testid="coach-oncall">' + secHead('On the call', { level: 3 }) +
    '<div class="coach-rules">' + rows.map((r) => checkRow(r, !!ctx.run.views?.rules)).join('') + '</div>' + chips + '</div>';
}

/** The page body. @param {any} ctx */
export function coachHTML(ctx) {
  if (selected !== MAIN_CASE && !(ctx.run.views?.story?.members ?? []).some((/** @type {any} */ m) => m.id === selected)) selected = MAIN_CASE;
  return '<div class="coach-root">' + top('Agent Coach', '') +
    '<div class="coach" data-testid="coach-page">' + railHTML(ctx) + '<div class="col coach-col">' + chatHTML(ctx) + onCallHTML(ctx) + nbaHTML(ctx) + '</div><div class="col coach-col">' + scorecardHTML(ctx) + '</div></div></div>';
}

registerPage({
  id: 'coach',
  title: 'Agent Coach',
  dock: 'coach',
  render: coachHTML,
  acts: {
    'coach.case': (el) => { selectCase(el.dataset.v || MAIN_CASE); scheduleRender(); },
    'coach.plan': (el) => { pickPlan(el.dataset.v || null); scheduleRender(); },
    /** A case chip asks the docked bar, with its own question only. */
    'coach.ask': (el) => { /** @type {any} */ (window).KeelChat?.submit?.(el.dataset.v ?? '', { solo: true }); },
    /** The Blocked words details: the terms are the pack's, loaded with the Rules view (GET /api/rules) the first time it opens, never on render. */
    'coach.terms': (_el, ctx) => {
      termsOpen = !termsOpen;
      if (termsOpen && !ctx.run.views?.rules) void ctx.run.load('rules').catch(() => { /* the row keeps its label */ });
      scheduleRender();
    },
  },
});
