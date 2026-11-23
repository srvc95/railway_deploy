// Wording helpers for what the rules and the model produced (S10 review): the two election dates, the labelled cost lines and the preference text. Formatting only, no business logic;
// every number is a fact value, a CalcRecord value or an arg exactly as the engine wrote it.
import { dateTime } from '../ui/format.js';
import { dateLong, money } from './format.js';
import { factById } from './state.js';

// The two dates a viewer must never mix up, read from the election-period facts of the run (formatting only; the rules computed both).
//  - the Annual Enrollment Period closes on `aep.end` (fact:election:ep-aep, with its own daysLeft);
//  - the no-gap date is `sep.noGapDate` (fact:election:ep-sep-nonrenewal, with daysToNoGap), reached through the non-renewal special period.
// RecommendationOutcome.deadline is the no-gap date and RecommendationOutcome.daysLeft counts to the AEP end, so a sentence must never print them together.

/** @param {any} s run state @returns {{ aepEnd: string | null, aepDays: number | null, noGapDate: string | null, noGapDays: number | null }} */
export function electionDates(s) {
  const aep = /** @type {any} */ (factById(s, 'fact:election:ep-aep')?.value) ?? {};
  const sep = /** @type {any} */ (factById(s, 'fact:election:ep-sep-nonrenewal')?.value) ?? {};
  return { aepEnd: aep.end ?? null, aepDays: aep.daysLeft ?? null, noGapDate: sep.noGapDate ?? null, noGapDays: sep.daysToNoGap ?? null };
}

/** "AEP closes Dec 7, 2026 (48 days left); latest no-gap date Dec 31, 2026 (72 days left)". Empty before the rules have counted. @param {any} s */
export function electionLine(s) {
  const d = electionDates(s);
  const parts = [];
  if (d.aepEnd) parts.push(`the Annual Enrollment Period closes ${dateLong(d.aepEnd)} (${d.aepDays} days left)`);
  if (d.noGapDate) parts.push(`the latest no-gap date is ${dateLong(d.noGapDate)} (${d.noGapDays} days left, through the non-renewal special period)`);
  if (!parts.length) return '';
  const t = parts.join('; ');
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

// Labelled lines for the calculation records of a plan's annual cost (S10-02). The numbers are the CalcRecord values and args exactly as the calculation engine produced them;
// this file only says what each one is. A figure never appears without its label.

/** @typedef {import('../../shared/contracts.ts').CalcRecord} CalcRecord */

/**
 * @param {CalcRecord[]} calcs every calculation of the decision @param {{ calcIds: string[] }} cand the candidate whose cost is shown
 * @returns {{ key: 'premium' | 'drugs' | 'total', label: string, text: string, value: number }[]}
 */
export function costLines(calcs, cand) {
  const own = calcs.filter((c) => cand.calcIds.includes(c.id) || cand.calcIds.some((id) => id.endsWith(':total') && c.id.startsWith(id.slice(0, -5))));
  const by = (/** @type {string} */ p) => own.find((c) => c.id.startsWith(p));
  const premium = by('calc:premium-annual:'), raw = by('calc:drug-oop-raw:'), capped = by('calc:drug-oop:'), total = by('calc:annual-cost:');
  /** @type {{ key: 'premium' | 'drugs' | 'total', label: string, text: string, value: number }[]} */ const out = [];
  if (premium) {
    const [months, monthly] = premium.args;
    out.push({ key: 'premium', label: 'Premium for the year', text: `${months} months x ${money(monthly)} per month = ${money(premium.value)}`, value: premium.value });
  }
  const drugs = capped ?? raw;
  if (drugs) {
    const cap = capped ? capped.args[1] : null;
    const note = capped && raw ? (raw.value > capped.value ? ` (${money(raw.value)} before the yearly out-of-pocket cap of ${money(cap)})` : ` (under the yearly out-of-pocket cap of ${money(cap)})`) : '';
    out.push({ key: 'drugs', label: 'Drug costs for the year', text: `${money(drugs.value)}${note}`, value: drugs.value });
  }
  if (total) {
    const [p, d] = total.args;
    out.push({ key: 'total', label: 'Estimated annual cost', text: `${money(p)} premium + ${money(d)} drug costs = ${money(total.value)}`, value: total.value });
  }
  return out;
}

/** The two day counts, each with the date it counts to, from the days-between calculations and the election facts. @param {CalcRecord[]} calcs @param {{ aepEnd: string | null, noGapDate: string | null }} dates @param {(d: string) => string} fmt */
export function dayLines(calcs, dates, fmt) {
  const aep = calcs.find((c) => c.id.startsWith('calc:days-left:')), gap = calcs.find((c) => c.id === 'calc:days-to-no-gap');
  /** @type {{ label: string, text: string }[]} */ const out = [];
  if (aep) out.push({ label: 'Annual Enrollment Period', text: `${aep.value} days until it closes${dates.aepEnd ? ` on ${fmt(dates.aepEnd)}` : ''}` });
  if (gap) out.push({ label: 'Latest no-gap date', text: `${gap.value} days until${dates.noGapDate ? ` ${fmt(dates.noGapDate)}` : ' that date'}, through the non-renewal special period` });
  return out;
}

// How an extracted preference reads on screen (S10 P2: "max premium: 30" had no unit). Wording only: the value is what the model extracted and the rules validated.
const LABEL = /** @type {Record<string, string>} */ ({ 'keep-provider': 'Keep', 'max-premium': 'Premium', channel: 'Contact by', 'benefit-interest': 'Interested in' });

/** @param {{ kind: string, value: string }} p @returns {{ label: string, value: string }} */
export function prefText(p) {
  let value = String(p.value ?? '').trim();
  // a bare number for a premium is dollars per month
  if (p.kind === 'max-premium' && /^\$?\d+(\.\d{1,2})?$/.test(value)) value = `Max $${value.replace(/^\$/, '')}/mo`;
  value = value.charAt(0).toUpperCase() + value.slice(1);
  return { label: LABEL[p.kind] ?? p.kind.replace(/-/g, ' '), value };
}

// ---------- product labels for data keys (change cosmetic-and-oncall, requirement "Product labels for data keys") ----------
// Screens show these words, never the enum key. Wording only: the keys are what the server wrote.

/** Channel of a message or a consent. @type {Readonly<Record<string, string>>} */
export const CHANNEL_LABEL = Object.freeze({ email: 'Email', sms: 'Text message', phone: 'Phone', mail: 'Mail' });

/** The three versions of an outreach message: what the model wrote, what the agent changed it to, what the gate corrected it to. @type {Readonly<Record<'original' | 'edit' | 'corrected', string>>} */
export const MESSAGE_VERSION_LABEL = Object.freeze({ original: 'Original draft', edit: 'Agent edit', corrected: 'Corrected draft' });

/** A relation of the ontology as a verb phrase: "Dottie takes Atorvastatin", "Dr. Brennan in network for Northlake Choice". @type {Readonly<Record<import('../../shared/contracts.ts').RelationType, string>>} */
export const RELATION_VERB = Object.freeze({
  RESIDES_IN: 'lives in', ENROLLED_IN: 'enrolled in', OFFERED_IN: 'offered in', OFFERED_BY: 'offered by', NON_RENEWING_IN: 'not renewing in',
  HAS_FORMULARY: 'has formulary', LISTS_DRUG: 'lists', TAKES: 'takes', SEES: 'sees', IN_NETWORK: 'in network for', AFFILIATED_WITH: 'affiliated with',
  HAS_CONSENT: 'has consent for', SENT_TO: 'sent to', RECEIVED_FROM: 'received from', ASSIGNED_AGENT: 'assigned to',
});

/** The operation of a CRM write. @type {Readonly<Record<'create' | 'update', string>>} */
export const WRITE_OP = Object.freeze({ create: 'Created', update: 'Updated' });

/**
 * The title of a communication-gate decision: "GATE-draft-2-corrected" reads "Message gate · corrected draft". Any other id is returned as it is.
 * draft-1 is the model's draft, draft-N (N above 1) an agent edit, and "-corrected" the version the gate produced.
 * @param {string} decisionId
 */
export function gateTitle(decisionId) {
  const m = /^GATE-draft-(\d+)(-corrected)?$/.exec(decisionId);
  if (!m) return decisionId;
  const kind = m[2] ? 'corrected' : m[1] === '1' ? 'original' : 'edit';
  const v = MESSAGE_VERSION_LABEL[kind];
  return `Message gate · ${v.charAt(0).toLowerCase()}${v.slice(1)}`;
}

/**
 * The version of the message a draft id names, for a column or a row that would otherwise show the id: "draft-1" is the original draft, "draft-N" (N above 1) an agent edit,
 * "draft-N-corrected" the corrected draft. Any other id is returned as it is.
 * @param {string} draftId
 */
export function draftLabel(draftId) {
  const m = /^draft-(\d+)(-corrected)?$/.exec(draftId);
  if (!m) return draftId;
  return MESSAGE_VERSION_LABEL[m[2] ? 'corrected' : m[1] === '1' ? 'original' : 'edit'];
}

/**
 * The member's name from the one record. 'short' is "Dottie Hayes" (the nickname and the last name), 'full' is the record's own name, `Dorothy "Dottie" Hayes`.
 * A name with no nickname reads the same in both. No scenario reads as an empty string.
 * @param {{ beneficiary?: { name?: string } } | null | undefined} sc @param {'short' | 'full'} [form]
 */
export function memberName(sc, form = 'short') {
  const n = (sc?.beneficiary?.name ?? '').trim();
  if (form === 'full') return n;
  const nick = /["“”]([^"“”]+)["“”]/.exec(n), last = n.split(/\s+/).pop() ?? '';
  return nick ? `${nick[1]} ${last}` : n;
}

/** A plan label for a list or a line: the plan name; the contract number belongs on the plan's own detail ("Northlake Choice (PPO) H9701-011-000" reads "Northlake Choice (PPO)"). @param {string | undefined} label */
export const planLabel = (label) => String(label ?? '').replace(/\s+[HS]\d{4}-\d{3}(-\d{3})?$/, '');

/** Server-written sentences name the member by her record: First "Nick" Last reads "Nick Last" on screen (the record keeps its own name). @param {string} text */
export const shortNames = (text) => String(text ?? '').replace(/\b[A-Z][a-z]+ ["“”]([A-Z][a-z]+)["“”] ([A-Z][a-z]+)\b/g, '$1 $2');

/**
 * @typedef {'verified' | 'mismatch' | 'pending' | 'na' | 'unchecked'} OnCallState
 * @typedef {{ key: 'soa' | 'topics' | 'tpmo' | 'blocked', label: string, rules: string[], state: OnCallState, text: string, when?: string, items?: string[], terms?: string[] }} OnCallRow
 */
/** "Cover before enrollment: a; b; c." splits into its topics (the rule's own message, no text of ours). @param {string} t @returns {string[]} */
export function topicList(t) {
  const m = /^(.{3,60}?):\s+(.+?)\.?$/.exec(String(t ?? ''));
  const list = m ? m[2].split(/;\s+/) : [];
  return m && list.length >= 3 ? list : [];
}

/**
 * The "On the call" checklist of Agent Coach: four rows read from the rules traces (design D7). Pure: it reads `state` (decisions) and `rulesView` (the blocked-word terms of the pack) and nothing else.
 * Each row takes the LATEST trace that holds its rule. A rule's own outcome is not enough for the Scope of Appointment: the engine passes WF-SOA while the next action is still send-soa
 * (no Scope of Appointment on file), so a tick there would be false; that reads "To do".
 *   soa      no next-action trace: unchecked | WF-SOA fail: mismatch "Fail" | pass and action send-soa: pending "To do" (+ `when`, the earliest appointment) | pass otherwise: verified "Pass"
 *   topics   no trace: unchecked | pass: verified "7 topics" with `items` from the rule message | fail: mismatch "Fail"
 *   tpmo     DISC-TPMO in the latest gate: not_applicable: na "Not applicable" | pass: verified | fail: mismatch | no gate: unchecked
 *   blocked  MKT-COMPARATIVE and MKT-FREE in the latest gate: both pass: verified "Pass" | either fails: mismatch "Fail" | no gate: unchecked; `terms` are the pack's, in pack order
 * @param {{ decisions?: readonly any[] } | null | undefined} state the run state @param {{ packs?: readonly any[] } | null | undefined} rulesView the Rules view (GET /api/rules)
 * @returns {OnCallRow[]}
 */
export function onCallChecks(state, rulesView) {
  const decisions = state?.decisions ?? [];
  /** The latest decision of a kind that holds a rule, with that rule's result. @param {string} kind @param {string} ruleId */
  const latest = (kind, ruleId) => {
    for (let i = decisions.length - 1; i >= 0; i--) {
      const d = decisions[i];
      const r = d?.kind === kind ? d.ruleResults?.find((/** @type {any} */ x) => x.ruleId === ruleId) : null;
      if (r) return { d, r };
    }
    return null;
  };
  const none = /** @type {Pick<OnCallRow, 'state' | 'text'>} */ ({ state: 'unchecked', text: 'Not checked yet' });
  /** @param {string} outcome */
  const byOutcome = (outcome) => (outcome === 'fail' ? { state: /** @type {OnCallState} */ ('mismatch'), text: 'Fail' } : outcome === 'not_applicable' ? { state: /** @type {OnCallState} */ ('na'), text: 'Not applicable' } : { state: /** @type {OnCallState} */ ('verified'), text: 'Pass' });

  /** @type {OnCallRow} */ const soa = { key: 'soa', label: 'Scope of Appointment', rules: ['WF-SOA'], ...none };
  const s = latest('next-action', 'WF-SOA');
  if (s) {
    if (s.r.outcome === 'fail') Object.assign(soa, byOutcome('fail'));
    else if (s.d.outcome?.action === 'send-soa') {
      Object.assign(soa, { state: 'pending', text: 'To do' });
      if (s.d.outcome.earliestAppointment) soa.when = dateTime(s.d.outcome.earliestAppointment);
    } else Object.assign(soa, byOutcome('pass'));
  }

  /** @type {OnCallRow} */ const topics = { key: 'topics', label: 'Pre-enrollment topics', rules: ['WF-PRE-ENROLLMENT-TOPICS'], ...none };
  const t = latest('next-action', 'WF-PRE-ENROLLMENT-TOPICS');
  if (t) {
    const items = t.r.outcome === 'pass' ? topicList(t.r.message) : [];
    if (t.r.outcome === 'pass') { Object.assign(topics, items.length ? { state: 'pending', text: `${items.length} to cover` } : { state: 'verified', text: 'Pass' }); /* the rule produced a list; nothing records what was said, so no green check */ if (items.length) topics.items = items; } else Object.assign(topics, byOutcome(t.r.outcome));
  }

  /** @type {OnCallRow} */ const tpmo = { key: 'tpmo', label: 'TPMO disclaimer', rules: ['DISC-TPMO'], ...none };
  const p = latest('communication-gate', 'DISC-TPMO');
  if (p) Object.assign(tpmo, byOutcome(p.r.outcome));

  /** @type {OnCallRow} */ const blocked = { key: 'blocked', label: 'Blocked words', rules: ['MKT-COMPARATIVE', 'MKT-FREE'], ...none };
  const c = latest('communication-gate', 'MKT-COMPARATIVE'), f = latest('communication-gate', 'MKT-FREE');
  if (c && f) Object.assign(blocked, byOutcome(c.r.outcome === 'fail' || f.r.outcome === 'fail' ? 'fail' : 'pass'));
  // the terms are the pack's, read from the pack the gate ran on (else the newest), never typed here
  const packs = rulesView?.packs ?? [];
  const pack = packs.find((/** @type {any} */ x) => x.id === (c ?? f)?.d.pack?.id) ?? packs[0];
  blocked.terms = blocked.rules.length && pack ? pack.rules.filter((/** @type {any} */ r) => blocked.rules.includes(r.id)).flatMap((/** @type {any} */ r) => r.params?.terms ?? []) : [];
  return [soa, topics, tpmo, blocked];
}

/** The one definition of a rule count on screen: the rules that applied to the subject (a rule that was not applicable is not counted). @param {{ ruleResults: { outcome: string }[] }} t */
export const appliedRules = (t) => t.ruleResults.filter((r) => r.outcome !== 'not_applicable').length;
