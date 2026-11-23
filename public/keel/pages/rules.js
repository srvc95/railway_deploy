// Rules & disclosures screen (change adopt-keel-shell, task 11.2; polished in polish-and-realism task 8.4). The rule pack in force as one table, the rules whose
// version moved since the last pack side by side, the required disclosures and the data snapshots. It decides nothing: the "this run" column comes from the run's decision traces.
import { shortHash } from '../../js/format.js';
import { dateLong } from '../../ui/format.js';
import { chip, emptyState, idCode, secHead, verified } from '../../ui/primitives.js';
import { esc, registerPage, scheduleRender, top } from '../shell.js';

/** Severity is an attribute of the rule, plain muted text: it is not a state, so it never takes a colour. */
const SEV = /** @type {Record<string, string>} */ ({ block: 'Block', hold: 'Hold', warn: 'Warn', info: 'Info' });
/** Rule rows that are open. Module state: the shell rebuilds the page on every run event. */
const openRules = new Set();

/** Rule id -> the failed results of this run, with the pack each came from. @param {any} state */
export function firedRules(state) {
  /** @type {Map<string, { packId: string, results: any[] }>} */ const out = new Map();
  for (const d of state?.decisions ?? []) {
    for (const r of d.ruleResults ?? []) {
      if (r.outcome !== 'fail') continue;
      const cur = out.get(r.ruleId) ?? { packId: d.pack?.id, results: /** @type {any[]} */ ([]) };
      cur.results.push(r); out.set(r.ruleId, cur);
    }
  }
  return out;
}

/**
 * What each rule did in this run: how many results failed and for how many plans, and whether it passed. The same words as the Why sheet.
 * @param {any} state @param {string} [packId] only results from this pack count
 * @returns {Map<string, { failed: number, held: number, plans: number, passed: boolean, na: boolean }>}
 */
export function ruleOutcomes(state, packId) {
  /** @type {Map<string, { failed: number, held: number, subjects: Set<string>, passed: boolean, na: boolean }>} */ const acc = new Map();
  for (const d of state?.decisions ?? []) {
    if (packId && d.pack?.id && d.pack.id !== packId) continue;
    for (const r of d.ruleResults ?? []) {
      const cur = acc.get(r.ruleId) ?? { failed: 0, held: 0, subjects: new Set(), passed: false, na: false };
      // a hold is not a failure: it sends the action to a person (the Why sheet says "Needs approval" too)
      if (r.outcome === 'fail' && r.severity === 'hold') cur.held++;
      else if (r.outcome === 'fail') { cur.failed++; if (/^plan-/.test(r.subject ?? '')) cur.subjects.add(r.subject); } else if (r.outcome === 'pass') cur.passed = true; else if (r.outcome === 'not_applicable') cur.na = true;
      acc.set(r.ruleId, cur);
    }
  }
  return new Map([...acc].map(([id, v]) => [id, { failed: v.failed, held: v.held, plans: v.subjects.size, passed: v.passed, na: v.na }]));
}

/** The rules whose version differs between two packs, with both versions. @param {any} cur @param {any} old */
export function changedRules(cur, old) {
  if (!cur || !old) return [];
  const before = new Map(old.rules.map((/** @type {any} */ r) => [r.id, r]));
  return cur.rules.filter((/** @type {any} */ r) => before.has(r.id) && /** @type {any} */ (before.get(r.id)).version !== r.version)
    .map((/** @type {any} */ r) => ({ id: r.id, title: r.title, from: before.get(r.id), to: r }));
}

/** Free text from a rule pack with its ISO dates written as dates ("2026-06-01" to "Jun 1, 2026"). @param {string} t */
const prose = (t) => String(t ?? '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => dateLong(m));

/** @param {any} c */
export const cite = (c) => '<span class="rules-cite">' + (/^https?:\/\//i.test(c.url ?? '') ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' + esc(prose(c.text)) + '<span class="sr"> (opens in a new tab)</span></a>' : /^policy:/.test(c.url ?? '') ? '<span class="chip" data-testid="policy-cite">Carrier policy (illustrative)</span> ' + esc(prose(c.text)) : esc(prose(c.text))) + (c.illustrative ? ' ' + chip('Illustrative') : '') + '</span>';
/** @param {any} d */
const dates = (d) => esc(dateLong(d.effectiveFrom)) + (d.effectiveTo ? ' to ' + esc(dateLong(d.effectiveTo)) : ' onward');
const plural = (/** @type {number} */ n, /** @type {string} */ one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The "this run" cell and its kind. A rule that failed for plans excluded them: neutral "Excluded N plans", no bar. A rule that failed with no plan (a message blocked) is "Failed" in red with the row bar
 * until the supervisor approved the corrected message: then it is resolved and reads verified "Corrected", with no bar (red is for what is unresolved).
 * A hold reads "Needs approval" until the supervisor approved, then verified "Approved by <name>". A passed rule is verified.
 * @param {{ failed: number, held?: number, plans: number, passed: boolean, na?: boolean } | undefined} o @param {string | null} approver
 * @returns {{ run: 'excluded' | 'failed' | 'corrected' | 'approved' | 'held' | 'passed' | 'na' | 'none', html: string }}
 */
function runCell(o, approver) {
  if (o && o.failed) {
    if (o.plans) return { run: 'excluded', html: `<span class="pill neutral">Excluded ${plural(o.plans, 'plan')}</span>` };
    return approver ? { run: 'corrected', html: verified('Corrected', { state: 'done' }) } : { run: 'failed', html: '<span class="pill crit">Failed</span>' };
  }
  if (o?.held) return approver ? { run: 'approved', html: verified('Approved by ' + approver) } : { run: 'held', html: '<span class="pill warn">Needs approval</span>' };
  if (o?.passed) return { run: 'passed', html: verified('Passed') };
  if (o?.na) return { run: 'na', html: verified('Not applicable', { state: 'na' }) }; // the rule was evaluated and did not apply: the Why sheet and the coach say the same words
  return { run: 'none', html: '<span class="muted small">Not run</span>' };
}

/** @param {any} pack @param {Map<string, any>} outcomes @param {string | null} approver */
function rulesTable(pack, outcomes, approver) {
  const rows = pack.rules.map((/** @type {any} */ r) => {
    const o = outcomes.get(r.id), hit = !!o && o.failed > 0, isOpen = openRules.has(r.id), run = runCell(o, approver);
    return '<tr class="rules-row" data-testid="rule-' + esc(r.id) + '" data-rule="' + esc(r.id) + '" data-version="' + esc(r.version) + '"' + (hit ? ' data-fired="true"' : '') + (run.run === 'failed' ? ' data-bar="crit"' : '') + ' data-ctx-type="rule" data-ctx-id="' + esc(r.id) + '">' +
      '<td><button type="button" class="rules-open" data-act="rules.toggle" data-v="' + esc(r.id) + '" aria-expanded="' + isOpen + '" aria-controls="rd-' + esc(r.id) + '"><b class="rules-title">' + esc(r.title) + '</b><span class="rules-idline">' + idCode(r.id, { cls: 'rule-id' }) + '</span></button></td>' +
      '<td class="rules-sev">' + esc(SEV[r.severity] ?? String(r.severity)) + '</td><td><span class="ui-num">v' + esc(r.version) + '</span></td><td class="small rules-dates">' + dates(r) + '</td><td class="rules-run" data-run="' + run.run + '">' + run.html + '</td></tr>' +
      '<tr class="rules-detail" id="rd-' + esc(r.id) + '"' + (isOpen ? '' : ' hidden') + '><td colspan="5"><div class="rules-detail-in"><p>' + esc(prose(r.plain)) + '</p>' +
      (r.caveat ? '<p class="small muted rules-caveat">' + chip(/illustrative/i.test(r.caveat) ? 'Illustrative' : 'Note') + ' ' + esc(prose(r.caveat)) + '</p>' : '') +
      (r.citations?.length ? '<div class="rules-cites small">' + r.citations.map(cite).join('') + '</div>' : '') + '</div></td></tr>';
  }).join('');
  return '<div class="tbl-wrap"><table class="rules-table"><caption class="sr">Rules in pack ' + esc(pack.version) + '</caption><thead><tr><th scope="col">Rule</th><th scope="col">Severity</th><th scope="col">Version</th><th scope="col">Effective</th><th scope="col">This run</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/** The rules whose version moved, side by side. @param {ReturnType<typeof changedRules>} list @param {any} cur @param {any} old */
function changedCard(list, cur, old) {
  if (!list.length) return '';
  const side = (/** @type {any} */ r) => '<span class="ui-num">v' + esc(r.version) + '</span> <span class="small muted">' + dates(r) + '</span><p class="small" title="' + esc(prose(r.plain)) + '">' + esc(prose(r.plain)) + '</p>';
  return '<div class="card pad rules-changed" data-testid="rules-changed">' + secHead('Changed from ' + old.version, { meta: plural(list.length, 'rule'), level: 2 }) +
    '<div class="tbl-wrap"><table><caption class="sr">Rules that changed between pack ' + esc(old.version) + ' and pack ' + esc(cur.version) + '</caption><thead><tr><th scope="col">Rule</th><th scope="col">Pack ' + esc(old.version) + '</th><th scope="col">Pack ' + esc(cur.version) + '</th></tr></thead><tbody>' +
    list.map((/** @type {any} */ c) => '<tr data-testid="rules-diff-' + esc(c.id) + '"><td><b>' + esc(c.title) + '</b><div>' + idCode(c.id, { cls: 'rule-id' }) + '</div></td><td>' + side(c.from) + '</td><td>' + side(c.to) + '</td></tr>').join('') + '</tbody></table></div></div>';
}

/** @param {any} pack */
function disclosuresCard(pack) {
  const rows = pack.disclosures.map((/** @type {any} */ d) =>
    '<tr data-testid="disclosure-' + esc(d.id) + '"><td>' + idCode(d.id, { cls: 'rule-id' }) + '</td><td class="rules-disc"><p class="small" title="' + esc(prose(d.text)) + '">' + esc(prose(d.text)) + '</p><div class="rules-cites small">' + cite(d.citation) + '</div></td><td><span class="ui-num">v' + esc(d.version) + '</span></td><td class="small rules-dates">' + dates(d) + '</td></tr>').join('');
  return '<div class="card pad rules-disclosures">' + secHead('Required disclosures', { level: 2 }) + '<div class="tbl-wrap"><table><caption class="sr">Required disclosures in pack ' + esc(pack.version) + '</caption><thead><tr><th scope="col">Disclosure</th><th scope="col">Text</th><th scope="col">Version</th><th scope="col">Effective</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="4" class="muted">None</td></tr>') + '</tbody></table></div></div>';
}

/** The page. @param {any} ctx */
export function rulesHTML(ctx) {
  const view = ctx.run.views?.rules;
  const fired = firedRules(ctx.state);
  const packs = view ? [...view.packs].sort((a, b) => b.version.localeCompare(a.version)) : [];
  const [cur, old] = packs;
  const outcomes = cur ? ruleOutcomes(ctx.state, cur.id) : new Map();
  const approver = ctx.state?.approval?.decision === 'approved' ? (ctx.state.approval.approver?.name ?? 'the supervisor') : null;
  const failedHere = cur ? cur.rules.filter((/** @type {any} */ r) => (outcomes.get(r.id)?.failed ?? 0) > 0 && !(approver && !outcomes.get(r.id)?.plans)).length : fired.size;
  // once the corrected message is approved the message rules are history: the chip counts them as corrected, not failed
  const correctedHere = approver && cur ? cur.rules.filter((/** @type {any} */ r) => (outcomes.get(r.id)?.failed ?? 0) > 0 && !outcomes.get(r.id)?.plans).length : 0;
  const head = top('Rules & disclosures', cur ? `Rule pack ${esc(cur.version)} · ${plural(cur.rules.length, 'rule')} · ${plural(cur.disclosures.length, 'disclosure')}` : 'Loading',
    correctedHere ? `<span class="pill neutral" data-testid="rules-fired-count">Corrected in this run · ${plural(correctedHere, 'rule')}</span>`
      : failedHere ? `<span class="pill neutral" data-testid="rules-fired-count">Failed in this run · ${plural(failedHere, 'rule')}</span>` : '');
  if (!view || !cur) return head + '<div class="card pad" data-testid="rules-loading"><div class="ui-state ui-skel" role="status" aria-busy="true"><span class="sr">Loading</span><i class="ui-skel-line"></i><i class="ui-skel-line"></i><i class="ui-skel-line"></i></div></div>';
  const snaps = view.snapshots.map((/** @type {any} */ s) => '<tr data-testid="snapshot-' + esc(s.id) + '"><td title="' + esc(s.id) + '">Plan year ' + esc(s.planYear) + '</td><td class="small">' + esc(dateLong(s.knownAt)) + '</td><td><code class="ui-id" title="' + esc(s.hash) + '">' + esc(shortHash(s.hash)) + '</code></td></tr>').join('');
  return head + '<div class="rules-packs" data-testid="rules-packs"><section class="rules-pack" data-testid="rules-pack-' + esc(cur.version) + '" aria-labelledby="rp-' + esc(cur.version) + '">' +
    '<div class="card pad rules-head">' + secHead('Rule pack ' + cur.version, { right: chip('In force') }).replace('<h2>', '<h2 id="rp-' + esc(cur.version) + '">') +
    '<p class="small muted">Effective ' + dates(cur) + ' · Content hash <code class="ui-id" title="' + esc(cur.hash) + '" data-testid="rules-hash-' + esc(cur.version) + '">' + esc(shortHash(cur.hash)) + '</code></p>' +
    rulesTable(cur, outcomes, approver) + '</div></section>' +
    changedCard(changedRules(cur, old), cur, old) +
    disclosuresCard(cur) +
    '<div class="card pad rules-snaps" data-testid="rules-snapshots">' + secHead('Data snapshots', { level: 2 }) + '<div class="tbl-wrap"><table><caption class="sr">Data snapshots and their hashes</caption><thead><tr><th scope="col">Data snapshot</th><th scope="col">Known</th><th scope="col">Hash</th></tr></thead><tbody>' + (snaps || '<tr><td colspan="3">' + emptyState('No snapshots') + '</td></tr>') + '</tbody></table></div></div></div>';
}

registerPage({
  id: 'rules', title: 'Rules & disclosures', render: rulesHTML,
  acts: { 'rules.toggle': (el) => { const id = String(el.dataset.v); if (openRules.has(id)) openRules.delete(id); else openRules.add(id); scheduleRender(); } },
  after(_el, ctx) { if (!ctx.run.views?.rules) void ctx.run.load('rules').catch(() => { /* keeps the loading note */ }); },
});
