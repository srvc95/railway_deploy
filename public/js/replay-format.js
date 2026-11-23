// Replay diff in plain English, and the two-outcome renderer shared by the Why sheet and Performance & audit (change polish-and-realism, task 6.3).
// The server sends fact ids and raw values (integer cents, booleans, small records); this file only writes them out for a person.
// It never computes a business number: money is formatted with money() from ../ui/format.js. The cause headline is built from the replay diff, never typed.
import { callout, emptyState, esc, idCode, verified } from '../ui/primitives.js';
import { count, dateLong, money, plural, shortHash } from '../ui/format.js';
import { countyName, humanize } from './format.js';
import { nameOf } from './state.js';

/** @typedef {import('../../shared/contracts.ts').DecisionTrace} DecisionTrace */
/** @typedef {import('../../shared/contracts.ts').ReplayResult} ReplayResult */
/** @typedef {{ factId: string, from: unknown, to: unknown }} FactChange */
/** @typedef {{ group: string, label: string, from: string, to: string, onlyOneRun: boolean }} Described */
/** @typedef {{ original: ReplayResult | null, current: ReplayResult | null }} Replays */

/** The stored decision the replay re-runs (a date is read from its id; nothing else about it is typed here). */
export const PRIOR_DECISION_ID = 'DEC-2025-1112-HAYES';

const CMS_LABELS = /** @type {Record<string, string>} */ ({
  'partD-deductible-max': 'Part D standard deductible maximum',
  'partD-oop-threshold': 'Part D out-of-pocket threshold',
  'part-d-deductible': 'Part D standard deductible maximum',
  'oop-threshold': 'Part D out-of-pocket threshold',
});

/** Labels for the system a record came from. Raw ids ("cms-params") never reach the page. */
export const SOURCE_LABEL = /** @type {Record<string, string>} */ ({
  'plan-landscape': 'Plan landscape', formulary: 'Formulary', 'provider-directory': 'Provider directory', enrollment: 'Enrollment', crm: 'CRM records',
  comms: 'Communications', consent: 'Consent records', 'cms-params': 'CMS parameters', rules: 'Rule pack', llm: 'Model output',
});
/** @param {string} system */
export const sourceLabel = (system) => SOURCE_LABEL[system] ?? humanize(system).replace(/^./, (c) => c.toUpperCase());

/** @param {unknown} v */
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} v
 * @returns {string}
 */
function formularyText(v) {
  if (!isObj(v)) return String(v);
  const o = /** @type {Record<string, unknown>} */ (v);
  if (o.covered === false) return 'Not covered';
  const parts = [];
  if (o.tier != null) parts.push(`Tier ${o.tier}`);
  if (typeof o.copay30 === 'number') parts.push(`${money(o.copay30)} copay for 30 days`);
  if (typeof o.coinsurancePct === 'number') parts.push(`${o.coinsurancePct}% coinsurance`);
  if (o.priorAuth) parts.push('prior authorization');
  if (o.stepTherapy) parts.push('step therapy');
  if (o.quantityLimit) parts.push('quantity limit');
  return parts.length ? parts.join(', ') : 'Covered';
}

/** @param {unknown} v */
function periodText(v) {
  if (!isObj(v)) return String(v);
  const o = /** @type {Record<string, unknown>} */ (v);
  return `${String(o.code ?? '')}: ${dateLong(String(o.start ?? ''))} to ${dateLong(String(o.end ?? ''))}${o.open === true ? ' (open now)' : o.open === false ? ' (not open)' : ''}`;
}

/** @param {unknown} v */
function noticeText(v) {
  if (!isObj(v)) return String(v);
  const o = /** @type {Record<string, unknown>} */ (v);
  return `Plan ends ${dateLong(String(o.effectiveOn ?? ''))}; notice mailed ${dateLong(String(o.noticeMailedOn ?? ''))}`;
}

/** Fallback for any value: objects are never printed as JSON. @param {unknown} v @returns {string} */
function plain(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(plain).join(', ');
  if (isObj(v)) return Object.entries(/** @type {Record<string, unknown>} */ (v)).filter(([, x]) => x != null).map(([k, x]) => `${humanize(k)}: ${plain(x)}`).join(', ');
  return '';
}

/**
 * One changed fact in words.
 * @param {FactChange} c
 * @param {(id: string) => string} name display name for a plan, drug or provider id
 * @param {(factId: string) => string | undefined} statementOf the stored sentence for a fact, used only for kinds this file does not know
 * @returns {Described}
 */
export function describeFactChange(c, name, statementOf) {
  const [, kind = '', a = '', b = ''] = c.factId.split(':');
  const plan = (/** @type {string} */ id) => name(/^[A-Z]\d{4}-\d{3}$/.test(id) ? `plan-${id}` : id);
  const none = (/** @type {string} */ text) => (/** @type {unknown} */ v) => (v == null ? text : null);
  /** @param {string} group @param {string} label @param {(v: unknown) => string} fmt @param {string} [missing] */
  const mk = (group, label, fmt, missing = 'not on file') => {
    const side = (/** @type {unknown} */ v) => none(missing)(v) ?? fmt(v);
    return { group, label, from: side(c.from), to: side(c.to), onlyOneRun: c.from == null || c.to == null };
  };
  const cents = (/** @type {unknown} */ v) => (typeof v === 'number' ? money(v) : plain(v));
  switch (kind) {
    case 'cms': return mk('Medicare limits', CMS_LABELS[a] ?? humanize(a), cents);
    case 'copay': return mk('Drug costs', `${name(b)} copay for 30 days, ${plan(a)}`, cents, 'not evaluated');
    case 'formulary': return mk('Drug coverage', `${name(b)} on ${plan(a)}`, formularyText, 'not evaluated');
    case 'priorauth': return mk('Drug coverage', `${name(b)} prior authorization, ${plan(a)}`, (v) => (v === true ? 'Required' : v === false ? 'Not required' : plain(v)));
    case 'cost': return mk('Yearly cost', `Est. annual cost, ${plan(a)} (illustrative)`, cents, 'not evaluated');
    case 'premium': return mk('Yearly cost', `Monthly premium, ${plan(a)}`, cents, 'not evaluated');
    case 'network': return mk('Doctors and hospitals', `${name(b)} on ${plan(a)}`, (v) => (v === true ? 'In network' : v === false ? 'Not in network' : plain(v)), 'not evaluated');
    case 'offered': return mk('Plans', `${plan(a)} offered in county`, (v) => (v === true ? 'Offered' : v === false ? 'Not offered' : plain(v)));
    case 'nonrenewal': return mk('Plans', `Non-renewal notice, ${plan(a)}`, noticeText, 'none on file');
    case 'election': return mk('Enrollment periods', `${a.replace(/^ep-/, '').toUpperCase().replace('MAOEP', 'MA-OEP')} election period`, periodText, 'none on file');
    case 'medicaid': return mk('Member', 'Medicaid status', plain, 'none on file');
    default: {
      const s = statementOf(c.factId);
      return mk('Other', s ?? humanize(c.factId.replace(/^fact:/, '').replace(/:/g, ' ')), plain, 'not on file');
    }
  }
}

const GROUP_ORDER = ['Plans', 'Medicare limits', 'Yearly cost', 'Drug costs', 'Drug coverage', 'Doctors and hospitals', 'Enrollment periods', 'Member', 'Other'];

/**
 * All changed facts grouped for display. Changes where a plan is evaluated in only one of the two runs are split out so they do not bury the real changes.
 * @param {FactChange[]} changes @param {(id: string) => string} name @param {(factId: string) => string | undefined} statementOf
 * @returns {{ main: { group: string, items: Described[] }[], oneRun: Described[] }}
 */
export function groupChanges(changes, name, statementOf) {
  const all = changes.map((c) => describeFactChange(c, name, statementOf));
  return splitGroups(all);
}
/** @param {Described[]} all */
function splitGroups(all) {
  const oneRun = all.filter((d) => d.onlyOneRun && /not evaluated/.test(d.from + d.to));
  const rest = all.filter((d) => !oneRun.includes(d));
  const groups = [...new Set(rest.map((d) => d.group))].sort((x, y) => GROUP_ORDER.indexOf(x) - GROUP_ORDER.indexOf(y));
  return { main: groups.map((group) => ({ group, items: rest.filter((d) => d.group === group) })), oneRun };
}

// ---------- the facts of a trace, for the Evidence tab ----------
/** At most six groups, in this order. Each of the describer's groups lands in exactly one. */
const FACT_GROUPS = ['Election', 'Plans', 'Network', 'Formulary', 'Costs', 'Member'];
const TO_FACT_GROUP = /** @type {Record<string, string>} */ ({
  'Enrollment periods': 'Election', Plans: 'Plans', 'Doctors and hospitals': 'Network', 'Drug coverage': 'Formulary', 'Drug costs': 'Formulary',
  'Yearly cost': 'Costs', 'Medicare limits': 'Costs', Member: 'Member', Other: 'Member',
});

/**
 * Trace facts as label / value rows in six groups: Election, Plans, Network, Formulary, Costs, Member. Empty groups are left out.
 * @param {DecisionTrace['facts']} facts @param {(id: string) => string} name
 * @returns {{ group: string, rows: { label: string, value: string, source: string, sourceTitle: string, origin: string, quote: string | null }[] }[]}
 */
export function groupFacts(facts, name) {
  const rows = facts.map((f) => {
    const d = describeFactChange({ factId: f.id, from: null, to: f.value ?? null }, name, () => f.statement);
    return {
      group: TO_FACT_GROUP[d.group] ?? 'Member', label: d.label, value: f.value == null ? f.statement : d.to, source: sourceLabel(f.source.system), sourceTitle: f.source.label,
      origin: f.origin, quote: f.span?.quote ?? null,
    };
  });
  return FACT_GROUPS.map((group) => ({ group, rows: rows.filter((r) => r.group === group).map(({ group: _g, ...r }) => r) })).filter((g) => g.rows.length);
}

// ---------- the decision in a line ----------
/** @param {any} s @param {DecisionTrace} t */
export function outcomeTitle(s, t) {
  const o = t.outcome;
  if (o.type === 'plan-recommendation') return `Recommend ${nameOf(s, o.recommendedPlanId ?? '')}`;
  if (o.type === 'communication-gate') {
    const a = s.approval?.decision;
    return o.verdict === 'blocked' ? `Blocked: ${o.violations.length} rules failed` : o.verdict === 'pass' ? 'Passed' : a === 'approved' ? 'Approved' : a === 'rejected' ? 'Rejected' : 'Held for approval';
  }
  return o.action === 'send-soa' ? 'Record SOA first' : o.action;
}

/** "2025.3" for pack-2025.3. @param {{ id: string, version: string }} p */
export const packNo = (p) => (/^\d+(\.\d+)*$/.test(p.version ?? '') ? p.version : p.id.replace(/^pack-/, ''));
/** The calendar date in a snapshot id (snap-2026-10-15-py2027), written long; null when the id carries none. @param {string} id */
export function snapshotDay(id) { const m = /(\d{4}-\d{2}-\d{2})/.exec(id); return m ? dateLong(m[1]) : null; }
/** "Nov 12, 2025" from DEC-2025-1112-... @param {string} id */
function decisionDay(id) { const m = /^DEC-(\d{4})-(\d{2})(\d{2})-/.exec(id); return m ? dateLong(`${m[1]}-${m[2]}-${m[3]}`) : 'the stored date'; }

/**
 * The two replay results of the store, whichever shape it keeps: `ui.replays = {original, current}`, or the older single `ui.replay`.
 * @param {{ replays?: Partial<Replays> | null, replay?: ReplayResult | null }} ui @returns {Replays}
 */
export function replaysOf(ui) {
  if (ui?.replays) return { original: ui.replays.original ?? null, current: ui.replays.current ?? null };
  const r = ui?.replay;
  if (!r) return { original: null, current: null };
  return r.reproduced || !r.diff.outcomeChanged ? { original: r, current: null } : { original: null, current: r };
}

// ---------- the story of a changed outcome ----------
/**
 * What changed and why, from the replay diff: the cause headline (the decisive fact change first), the changed rule versions by name, up to three decisive
 * changes, and every other change grouped.
 * @param {ReplayResult} r
 * @param {{ state: any, ruleTitle?: (id: string) => string | undefined }} o
 */
export function replayStory(r, o) {
  const s = o.state;
  const name = (/** @type {string} */ id) => nameOf(s, id);
  const statementOf = (/** @type {string} */ fid) => r.replayed.facts.find((f) => f.id === fid)?.statement ?? r.original.facts.find((f) => f.id === fid)?.statement ?? s.facts?.find((/** @type {any} */ f) => f.id === fid)?.statement;
  const changes = r.diff.factsChanged;
  const kindOf = (/** @type {FactChange} */ c) => c.factId.split(':')[1];
  const tail = (/** @type {FactChange} */ c) => c.factId.split(':')[2] ?? '';
  const planOf = (/** @type {FactChange} */ c) => name(`plan-${tail(c)}`);
  const county = countyName(s.scenario?.beneficiary?.county);

  const gone = changes.filter((c) => kindOf(c) === 'offered' && c.from === true && c.to === false);
  const notices = changes.filter((c) => kindOf(c) === 'nonrenewal' && isObj(c.to));
  const picked = r.replayed.outcome.type === 'plan-recommendation' ? r.replayed.outcome.recommendedPlanId?.replace(/^plan-/, '') : null;
  const was = r.original.outcome.type === 'plan-recommendation' ? r.original.outcome.recommendedPlanId : null;
  const now = r.replayed.outcome.type === 'plan-recommendation' ? r.replayed.outcome.recommendedPlanId : null;
  const ofPick = (/** @type {string} */ kind) => changes.filter((c) => kindOf(c) === kind && picked && tail(c) === picked);

  const effective = gone.length && notices.length ? (/** @type {Record<string, unknown>} */ (notices[0].to).effectiveOn) : null;
  /** @type {string | null} */
  let cause = null;
  if (gone.length) {
    const names = gone.map(planOf);
    cause = `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are` : `${names[0]} is`} no longer offered in ${county || 'the member’s county'}${typeof effective === 'string' ? ` after ${dateLong(effective)}` : ''}`;
  } else if (was && now && was !== now) {
    cause = `${name(was)} → ${name(now)}`;
  }

  const decisiveChanges = [...gone, ...notices, ...ofPick('premium'), ...ofPick('cost')].slice(0, 3);
  const described = changes.map((c) => ({ c, d: describeFactChange(c, name, statementOf) }));
  const decisive = decisiveChanges.map((c) => /** @type {Described} */ (described.find((x) => x.c === c)?.d));
  const rest = splitGroups(described.filter((x) => !decisiveChanges.includes(x.c)).map((x) => x.d));

  const titleOf = (/** @type {string} */ id) => o.ruleTitle?.(id) ?? r.replayed.ruleResults.find((x) => x.ruleId === id)?.title ?? r.original.ruleResults.find((x) => x.ruleId === id)?.title ?? humanize(id.toLowerCase());
  const ruleVersions = r.diff.rulesChanged.map((c) => ({ ruleId: c.ruleId, title: titleOf(c.ruleId), from: c.from, to: c.to }));
  return { changedSince: `Outcome changed since ${dateLong(r.original.asOf)}`, cause, decisive, rest, ruleVersions, total: changes.length };
}

// ---------- the two outcome cards ----------
/**
 * Both outcomes at once. Original: a good callout with the stored trace hash. Today's rules: an info callout (an expected change is never red) with the cause
 * headline, the changed rule versions by name, the decisive changes first and the rest collapsed by group. With `controls` each card carries its own button, and a
 * card that has not been run yet is an empty slot; without them only finished cards are drawn. Returns '' when there is nothing to draw.
 * @param {Replays} replays
 * @param {{ state: any, ruleTitle?: (id: string) => string | undefined, full?: boolean, controls?: { act: string, ids: { original: string, current: string }, busy: string | null } }} o
 *   full: the Replay tab, every change under its group and none hidden. state: the run state, for names.
 */
export function replaySummaryHTML(replays, o) {
  const { original, current } = replays;
  const c = o.controls;
  if (!original && !current && !c) return '';
  const s = o.state;
  const story = current ? replayStory(current, o) : null;

  /** @param {'original' | 'current'} mode @param {string} idle @param {string} again */
  const button = (mode, idle, again) => {
    if (!c) return '';
    const key = mode === 'original' ? 'as-of-original' : 'with-current';
    return `<button type="button" class="btn rp-run" data-act="${esc(c.act)}" data-v="${key}" data-testid="${esc(c.ids[mode])}" aria-busy="${c.busy === key}"${c.busy ? ' aria-disabled="true"' : ''}>${esc((mode === 'original' ? original : current) ? again : idle)}</button>`;
  };
  /** The kind of outcome on the left; the lasting check result (verified) or the date on the right. @param {string} kind @param {string} right trusted markup */
  const eyebrow = (kind, right) => `<p class="rp-eyebrow"><span>${esc(kind)}</span>${right}</p>`;
  const dateOnly = (/** @type {string} */ d) => `<span class="rp-date">${esc(d)}</span>`;
  /** @param {DecisionTrace} t */
  const meta = (t) => `<p class="rp-meta">${esc(dateLong(t.asOf))} · Rule pack ${esc(packNo(t.pack))}${snapshotDay(t.snapshot.id) ? ` · Data ${esc(snapshotDay(t.snapshot.id))}` : ''}</p>`;

  const origCard = original
    ? `<article class="rp-card" data-testid="replay-original-result" data-state="done" data-reproduced="${original.reproduced}">${eyebrow('Original decision', original.reproduced ? verified('Reproduced', { detail: shortHash(original.original.traceHash) }) : '')}
      ${original.reproduced ? '' : callout('warn', `Not reproduced · stored hash ${shortHash(original.original.traceHash)}, re-run ${shortHash(original.replayed.traceHash)}`)}
      <p class="rp-out">${esc(outcomeTitle(s, original.original))}</p>${meta(original.original)}${button('original', '', 'Replay again')}</article>`
    : c ? `<article class="rp-card" data-testid="replay-original-slot" data-state="${c.busy === 'as-of-original' ? 'busy' : 'empty'}">${eyebrow('Original decision', dateOnly(decisionDay(PRIOR_DECISION_ID)))}
      <div class="rp-slot">${emptyState('Not run', { cls: 'rp-empty' })}${button('original', `Replay ${decisionDay(PRIOR_DECISION_ID)}`, '')}</div></article>` : '';

  const curCard = current && story
    ? `<article class="rp-card" data-testid="replay-current-result" data-state="done" data-changed="${current.diff.outcomeChanged}">${eyebrow('Today’s rules and data', current.diff.outcomeChanged ? '' : verified('Same outcome'))}
      ${current.diff.outcomeChanged ? callout('info', story.changedSince) : ''}
      <p class="rp-out">${esc(outcomeTitle(s, current.replayed))}</p>${meta(current.replayed)}${button('current', '', 'Run again')}</article>`
    : c ? `<article class="rp-card" data-testid="replay-current-slot" data-state="${c.busy === 'with-current' ? 'busy' : 'empty'}">${eyebrow('Today’s rules and data', '')}
      <div class="rp-slot">${emptyState('Not run', { cls: 'rp-empty' })}${button('current', 'Run today’s rules', '')}</div></article>` : '';

  const version = (/** @type {string | null} */ v) => (v == null ? 'none' : `v${esc(v)}`);
  const causeBlock = current && story && current.diff.outcomeChanged
    ? `<div class="rp-cause" data-testid="replay-cause">${story.cause ? `<p class="rp-cause-h">${esc(story.cause)}</p>` : ''}
      ${story.ruleVersions.length ? `<ul class="rp-rules" data-testid="diff-rules">${story.ruleVersions.map((v) => `<li><span>${esc(v.title)} ${idCode(v.ruleId, { cls: 'rule-id', title: `Rule ${v.ruleId}` })}</span><span class="rp-vals"><del>${version(v.from)}</del> <span class="rp-arrow" role="img" aria-label="changed to">→</span> <ins>${version(v.to)}</ins></span></li>`).join('')}</ul>` : ''}</div>`
    : '';

  /** @param {Described} d */
  const row = (d) => `<li class="rp-row"><span class="rp-l">${esc(d.label)}</span><span class="rp-vals"><del>${esc(d.from)}</del> <span class="rp-arrow" role="img" aria-label="changed to">→</span> <ins>${esc(d.to)}</ins></span></li>`;
  /** @param {{ group: string, items: Described[] }[]} groups */
  const groupsHTML = (groups) => groups.map((g) => `<div class="rp-group"><h5>${esc(g.group)} <span class="rp-n">${g.items.length}</span></h5><ul class="rp-diff">${g.items.map(row).join('')}</ul></div>`).join('');
  const restN = story ? story.rest.main.reduce((n, g) => n + g.items.length, 0) + story.rest.oneRun.length : 0;
  const oneRun = story?.rest.oneRun.length ? `<details class="rp-more"><summary>One run only (${esc(count(story.rest.oneRun.length))})</summary><ul class="rp-diff">${story.rest.oneRun.map(row).join('')}</ul></details>` : '';
  const changes = current && story && current.diff.outcomeChanged
    ? `<div class="rp-changes" data-testid="diff-facts"><div class="rp-sec"><h4>What changed</h4><span class="small muted">${esc(plural(story.total, 'fact'))}</span></div>
      <ul class="rp-diff">${story.decisive.map(row).join('')}</ul>
      ${restN === 0 ? '' : o.full
    ? groupsHTML(story.rest.main) + oneRun
    : `<details class="rp-more"><summary>${esc(count(restN))} more</summary>${groupsHTML(story.rest.main)}${oneRun}</details>`}</div>`
    : '';

  return `<div class="rp${o.full ? ' is-full' : ''}" data-testid="replay-result"><div class="rp-cards">${origCard}${curCard}</div>${causeBlock}${changes}</div>`;
}
