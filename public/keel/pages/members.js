/* Copied from keel-prototype v1.2.3 public/prototype.js (PAGES.research accounts table, `.card.tbl-wrap`, `tr.click`), adapted for adopt-keel-shell, polished in polish-and-realism task 8.3 */
// Members: Dottie Hayes (from the scenario) first, then the sample book from /api/story. No outcome, cost or verdict column.
// The count of members without a review sits in the subtitle; the rows carry no label of their own.
import { esc, registerPage, scheduleRender, top } from '../shell.js';
import { etDay } from '../../js/format.js';
import { dateShort } from '../../ui/format.js';
import { errorState, loadingState } from '../../ui/primitives.js';
import { memberName, planLabel } from '../../js/labels.js';
import { lastContactAt, openCasesText } from '../../js/state.js';

const SITUATION = /** @type {Record<string, [string, string]>} */ ({
  renewing: ['Renewing', 'neutral'], 'non-renewing': ['Non-renewing', 'warn'], 'new-to-medicare': ['New to Medicare', 'accent'], moved: ['Moved', 'accent'], 'turning-65': ['Turning 65', 'accent'],
});
/** @param {string} name "Barbara Whitman" to "HF" */
const initials = (name) => name.replace(/"[^"]*"/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
let loadFailed = false;

/** What Dottie's row says she last did, from how far the run has come (it said "options asked (voicemail)" to the end). @param {any} sc @param {any} [state] */
function pegSignal(sc, state) {
  const done = (/** @type {string} */ id) => state?.steps?.[id]?.status === 'done';
  if (done('decision.next-action')) return 'Non-renewal · next action set';
  if (done('action.monitor')) return 'Non-renewal · replied by email';
  if (done('action.deliver')) return 'Non-renewal · plan options emailed';
  return `Non-renewal · options asked (${sc.inbound.channel})`;
}

/**
 * Rows of the table, in order: Dottie first, then the sample members. Pure; the page renders them.
 * @param {any} sc ScenarioView @param {any} story StoryView | null @param {any} [state] the run, so Dottie's last contact follows it
 */
export function memberRows(sc, story, state) {
  const rows = [];
  if (sc) {
    const lastContact = state ? lastContactAt(state, sc.inbound.at) : sc.inbound.at;
    rows.push({
      id: sc.beneficiary.id, name: memberName(sc, 'short'), sub: `${sc.beneficiary.age}, ${sc.beneficiary.mbiDisplay}`, county: `${sc.beneficiary.county}, ${sc.beneficiary.state}`, plan: sc.currentPlan.name,
      situation: SITUATION['non-renewing'], last: dateShort(etDay(lastContact)), lastFull: etDay(lastContact), signal: pegSignal(sc, state), sample: false,
    });
  }
  for (const m of story?.members ?? []) {
    rows.push({
      id: m.id, name: m.name, sub: `${m.age}`, county: `${m.county}, ${m.state}`, plan: planLabel(m.currentPlanLabel), situation: SITUATION[m.situation] ?? [m.situation, 'neutral'],
      last: m.lastContactAt ? dateShort(etDay(m.lastContactAt)) : 'No contact yet', lastFull: m.lastContactAt ? etDay(m.lastContactAt) : '', signal: m.signal, sample: true,
    });
  }
  return rows;
}

/** The page: the counts in the subtitle, then one line per member. @param {any} ctx */
export function membersHTML(ctx) {
  const sc = ctx.run.views?.scenario ?? ctx.state.scenario, story = ctx.run.views?.story;
  if (!sc) return top('Members', '') + loadingState('Loading', { lines: 4 });
  const rows = memberRows(sc, story, ctx.state);
  const n = story?.members?.length ?? 0;
  const body = rows.map((r) => `<tr class="click" data-act="member" data-v="${esc(r.id)}" tabindex="0" data-testid="member-row-${esc(r.id)}"><td><div class="acct"><div class="logo">${esc(initials(r.name))}</div><div><b>${esc(r.name)}</b><div class="small muted">${esc(r.sub)}</div></div></div></td>` +
    `<td class="nowrap">${esc(r.county)}</td><td class="nowrap">${esc(r.plan)}</td><td><span class="pill ${r.situation[1]}">${esc(r.situation[0])}</span></td><td class="ui-num small nowrap"${r.lastFull ? ` title="${esc(r.lastFull)}"` : ''}>${esc(r.last)}</td>` +
    `<td class="small muted mem-signal" title="${esc(r.signal)}">${esc(r.signal)}</td></tr>`).join('');
  return top('Members', `${rows.length} member${rows.length === 1 ? '' : 's'} · ${openCasesText(ctx.state).toLowerCase()}${n ? ` · ${n} unreviewed` : ''}`) +
    (loadFailed ? `<div class="card pad">${errorState("Other members didn't load", { text: '', retry: { act: 'members.retry' } })}</div>` : '') +
    '<div class="card tbl-wrap"><table class="mem-list" data-testid="members-table"><caption class="sr">Members: the case in progress and the rest of the book</caption><thead><tr><th scope="col">Member</th><th scope="col">County</th><th scope="col">Current plan</th><th scope="col">Situation</th><th scope="col">Last contact</th><th scope="col">Signal</th></tr></thead>' +
    `<tbody>${body}</tbody></table></div>`;
}

/** @param {HTMLElement} _el @param {any} ctx */
function after(_el, ctx) {
  if (!ctx.run.views?.story && !loadFailed) ctx.run.load?.('story')?.catch?.(() => { loadFailed = true; });
}

registerPage({
  id: 'members', title: 'Members', render: membersHTML, after,
  acts: { 'members.retry': (_el, ctx) => { loadFailed = false; ctx.run.load?.('story')?.catch?.(() => { loadFailed = true; }).finally?.(() => scheduleRender()); scheduleRender(); } },
});
