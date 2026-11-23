/* Copied from keel-prototype v1.2.3 public/prototype.js (PAGES.home, kpiData, sigHTML, feedHTML, ACT.dismiss, the .filters row), adapted for adopt-keel-shell, polished in polish-and-realism task 8.3 */
// Home: the briefing. Tiles, the signal feed (Dottie's signal with "Open case", sample signals, closed-loop signals that arrive from run events),
// Deadlines, and the docked ask (dock: 'home', mounted by chat.js outside #main). Every value comes from the scenario, the story view or the
// run state; nothing here reads the clock, counts a person's work or decides anything. Interface: notes/keel-shell-map.md section 8.
import { esc, ico, nativeButton, registerPage, scheduleRender, setNavCountSource, stepAgent, top } from '../shell.js';
import { countyName, etDay } from '../../js/format.js';
import { dateLong, dateShort, dateTime } from '../../ui/format.js';
import { emptyState, loadingState } from '../../ui/primitives.js';
import { memberName, planLabel } from '../../js/labels.js';
import { caseFinished, exceptionCaseOpen, factById, openCasesText, stepStatus } from '../../js/state.js';
import { STEPS, stepMeta } from '../../js/steps.js';
import { NATIVE } from '../run.js';
import { PREP_STEPS, PREP_TEXT, prep, prepDone, prepSeconds } from '../autoprep.js';
import { MEMBER_BRIEFS, WEEK } from '../history.js';
import { money } from '../../ui/format.js';
import { factById as factOf, recommendation, nameOf } from '../../js/state.js';

/** Steps whose timeline entry becomes a closed-loop signal on the feed: the card title, the pill and the follow-up each one offers. */
const LOOP = /** @type {Record<string, { title: (first: string) => string, pill: string, pillCls: string, act: [string, string, string?] }>} */ ({
  'action.deliver': { title: (f) => `Email to ${f} delivered`, pill: 'Simulated', pillCls: 'neutral', act: ['member', 'Open member', 'comms'] },
  'action.crm-log': { title: () => 'Activity logged in the Sandbox CRM', pill: 'Simulated', pillCls: 'neutral', act: ['page', 'Open Sandbox CRM'] },
  'action.task': { title: () => 'Follow-up task created', pill: 'Simulated', pillCls: 'neutral', act: ['page', 'Open Sandbox CRM'] },
  'action.escalate': { title: () => 'Exception case opened', pill: 'Simulated', pillCls: 'neutral', act: ['page', 'Open Sandbox CRM'] },
  'action.monitor': { title: (f) => `${f} replied by email`, pill: 'Simulated', pillCls: 'neutral', act: ['member', 'Open member', 'comms'] },
  'decision.next-action': { title: () => 'Next action set', pill: 'Next action', pillCls: 'accent', act: ['member', 'Open member', 'workflow'] },
});
const FILTERS = /** @type {[string, string][]} */ ([['all', 'All'], ['research', 'Member Agent'], ['proposal', 'Plan and workflow']]);
/** The Annual Enrollment Period closes on December 7 every year (42 CFR 422.62(a)(2)). Used only before the case opens; after intake the election facts replace it. */
const AEP_CLOSES = '12-07';

// module state that outlives a render (the shell rebuilds the page on every run event)
let filter = 'all';
const dismissed = new Set();
const seen = new Set();
let seenRun = '';
let started = false;

/** @param {string} iso demo clock instant */
const easternParts = (iso) => {
  /** @type {Record<string, string>} */ const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
  return { weekday: p.weekday, month: p.month, day: p.day, h: parseInt(p.hour, 10) };
};
/** `Dorothy "Dottie" Hayes` to "Dottie Hayes": the one name helper of labels.js. @param {{ beneficiary: { name: string } }} sc */
export const shortName = (sc) => memberName(sc, 'short');
/** The agent tag of a step: colour and name only. The layer badge belongs to the stepper and the cards, not to a feed card. @param {string} stepId */
const tagOf = (stepId) => { const a = stepAgent(stepId); return `<span class="tag ${a.cls}">${esc(a.label)}</span>`; };
/** A server timeline sentence without its "simulated" marker; the card's one pill says it. @param {string} t */
const plain = (t) => { const x = t.replace(/\s*\(simulated\)/gi, '').replace(/^simulated\s+/i, ''); return x.charAt(0).toUpperCase() + x.slice(1); };

/** Label of the native button of a step. @param {string} step */
const nativeLabel = (step) => /** @type {Record<string, { label: string }>} */ (NATIVE)[step]?.label ?? stepMeta(step).short;

/** @param {any} ctx */
const scenarioOf = (ctx) => ctx.run.views?.scenario ?? ctx.state.scenario ?? null;
/** What the case still needs from a person: the next native step, or the supervisor at the approval gate. @param {any} ctx */
function waitingOn(ctx) {
  const s = ctx.state;
  if (s.head === 'human.approve' && stepStatus(s, 'human.approve') === 'waiting') return { kind: 'approval', text: 'waiting for supervisor approval' };
  const next = ctx.run.nextStep?.();
  if (next) return { kind: 'step', text: `next: ${nativeLabel(next)}` };
  return null;
}
/** The open human task, once the rules have set one: the call after a Scope of Appointment. Read from the next-action decision; never decided here. @param {any} ctx */
function openTask(ctx) {
  const d = [...(ctx.state.decisions ?? [])].reverse().find((/** @type {any} */ x) => x.kind === 'next-action');
  const o = d?.outcome;
  if (!o || (o.action !== 'send-soa' && o.action !== 'book-appointment')) return null;
  return { action: /** @type {string} */ (o.action), at: /** @type {string | undefined} */ (o.earliestAppointment) };
}
/** "Needs attention": a task when the rules set one, else the case waiting on a person. @param {any} ctx */
function attention(ctx) {
  const task = openTask(ctx), wait = waitingOn(ctx), sc = scenarioOf(ctx);
  if (task) return { kind: 'task', value: '1 task', detail: `${task.action === 'send-soa' ? 'SOA call' : 'Call'} ${task.at ? dateTime(task.at) : 'to schedule'}` };
  const nm = sc ? shortName(sc) : 'Dottie Hayes';
  if (prep.active && !prepDone()) return { kind: 'case', value: '1 case', detail: `${nm}, Keel is preparing it` };
  if (wait && ctx.run.nextStep?.() === 'action.rep-edit') return { kind: 'case', value: '1 case', detail: `${nm}, ready for your review` };
  if (wait) return { kind: 'case', value: '1 case', detail: `${nm}, ${wait.text}` };
  return { kind: 'none', value: '0 cases', detail: 'None' };
}

/** The sidebar badge counts what waits on a person, the number the "Needs attention" tile shows; nothing waiting hides it. */
setNavCountSource((ctx) => (attention(ctx).kind === 'none' ? null : 1));

/**
 * The four tiles (copied `.kpis .card.kpi`). Before intake: the AEP closing date and the open case. After: days left, the no-gap deadline, from the election facts.
 * @param {any} ctx @returns {{ id: string, label: string, value: string, detail: string }[]}
 */
export function homeTiles(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx), story = ctx.run.views?.story;
  const aep = /** @type {any} */ (factById(s, 'fact:election:ep-aep')?.value), sep = /** @type {any} */ (factById(s, 'fact:election:ep-sep-nonrenewal')?.value);
  const n = story?.members?.length ?? 0;
  const who = sc ? shortName(sc) : 'Dottie Hayes';
  const aepClose = sc ? dateLong(`${etDay(sc.demoNow).slice(0, 4)}-${AEP_CLOSES}`) : 'Dec 7';
  const att = attention(ctx);
  return [
    aep
      ? { id: 'aep', label: 'Days left in AEP', value: `${aep.daysLeft} days`, detail: `Closes ${dateLong(aep.end)}` }
      : { id: 'aep', label: 'AEP closes', value: aepClose, detail: 'Annual Enrollment Period' },
    sep
      ? { id: 'nogap', label: 'No-gap deadline', value: dateLong(sep.noGapDate), detail: `${sep.daysToNoGap} days · non-renewal SEP` }
      : { id: 'nogap', label: 'Open cases', value: '1', detail: `${who} · plan not renewing` },
    { id: 'book', label: 'Prepared for you this week', value: `${WEEK.prepared} cases`, detail: `About ${WEEK.avgAgentMinutes} min of your time each · ${1 + n} members in book` },
    { id: 'attention', label: 'Needs attention', value: att.value, detail: att.detail },
  ];
}

/** Deadlines card rows: [date, title, detail] sorted by date, from the scenario, the election facts and the next-action decision; no clock. @param {any} ctx @returns {[string, string, string][]} */
export function deadlineRows(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx); if (!sc) return [];
  const aep = /** @type {any} */ (factById(s, 'fact:election:ep-aep')?.value), sep = /** @type {any} */ (factById(s, 'fact:election:ep-sep-nonrenewal')?.value);
  /** @type {[string, string, string, string][]} sort key, date, title, detail */ const rows = [];
  if (aep) rows.push([aep.end, dateShort(aep.end), 'Annual Enrollment Period closes', `${aep.daysLeft} days left`]);
  rows.push([sc.currentPlan.endsOn, dateShort(sc.currentPlan.endsOn), 'Current plan ends', `${sc.currentPlan.name}, notice mailed ${dateLong(sc.currentPlan.noticeMailedOn)}`]);
  if (sep) rows.push([sep.noGapDate, dateShort(sep.noGapDate), 'Latest no-gap date', `${sep.daysToNoGap} days left`]);
  const task = openTask(ctx), soaDone = sc.scopeOfAppointment.status === 'on-file';
  if (task?.at) rows.push([etDay(task.at), dateShort(task.at), 'Scope of Appointment, then call', `Before the ${dateTime(task.at).split(', ')[1]} call`]);
  else rows.push(['9999', '—', 'Scope of Appointment', soaDone ? 'On file' : 'Not on file']);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map((r) => /** @type {[string, string, string]} */ ([r[1], r[2], r[3]]));
}

/**
 * The feed, newest closed-loop signal first, then Dottie's signal, then the sample signals.
 * @param {any} ctx @returns {{ id: string, kind: 'loop' | 'case' | 'sample', ag: 'research' | 'proposal', html: (fresh: boolean, top?: boolean) => string }[]}
 */
export function feedItems(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx), story = ctx.run.views?.story;
  /** @type {ReturnType<typeof feedItems>} */ const out = [];
  if (!sc) return out;
  const pegId = sc.beneficiary.id, who = shortName(sc), first = who.split(' ')[0];
  for (const t of [...s.timeline].reverse()) {
    const L = LOOP[t.step]; if (!L) continue;
    const id = `loop:${t.seq}`; if (dismissed.has(id)) continue;
    const ag = stepAgent(t.step).cls === 'research' ? 'research' : 'proposal';
    const act = (/** @type {boolean} */ top) => L.act[0] === 'page' ? `<button type="button" class="${top ? 'btn pri' : 'link'}" data-act="page" data-v="crm">${esc(L.act[1])}</button>`
      : `<button type="button" class="${top ? 'btn pri' : 'link'}" data-act="member" data-v="${esc(pegId)}" data-x="${esc(L.act[2] ?? 'overview')}">${esc(L.act[1])}</button>`;
    // the reply is the member speaking: her words, quoted; without them, the plain sentence
    const title = L.title(first);
    let body = t.step === 'action.monitor' && sc.memberReply?.text ? `“${sc.memberReply.text}”` : plain(t.text);
    // a sentence that starts with its own title says it twice ("Follow-up task created" / "Follow-up task created: record ..."): the title stays, the sentence goes on from there
    if (body.toLowerCase().startsWith(title.toLowerCase() + ':')) { const rest = body.slice(title.length + 1).trim(); if (rest) body = rest.charAt(0).toUpperCase() + rest.slice(1); }
    out.push({ id, kind: 'loop', ag, html: (fresh, top = true) => sig({ id, ag, fresh, tid: `feed-${t.step}`, tag: tagOf(t.step), who, when: dateTime(t.at), pill: [L.pillCls, L.pill], h: title, b: body, acts: act(top) + dismissBtn(id) }) });
  }
  const opened = stepStatus(s, 'signal.intake') === 'done';
  const native = nativeButton(ctx, 'signal.intake', { go: `member/${pegId}/overview` });
  const ready = prepDone();
  const open = (/** @type {boolean} */ top) => native || (opened ? `<button type="button" class="${top ? 'btn pri' : 'link'}" data-act="member" data-v="${esc(pegId)}" data-x="overview">${ready ? 'Review case' : 'Open member'}</button>` : '');
  out.push({
    id: 'case', kind: 'case', ag: 'research',
    html: (fresh, top = true) => sig({
      id: 'case', ag: 'research', fresh, tid: 'home-signal', tag: tagOf('signal.intake'), who, when: dateTime(sc.inbound.at), pill: ready && !s.approval ? ['accent', 'Ready for review'] : ['warn', 'Non-renewing'],
      h: `${sc.currentPlan.name} is not renewing for 2027`,
      b: `Ends ${dateLong(sc.currentPlan.endsOn)} · Notice ${dateLong(sc.currentPlan.noticeMailedOn)} · Voicemail ${dateTime(sc.inbound.at)}`, acts: open(top),
    }),
  });
  for (const m of story?.members ?? []) {
    out.push({
      id: m.id, kind: 'sample', ag: 'research',
      html: (fresh, top = true) => sig({
        id: m.id, ag: 'research', fresh, tid: `feed-${m.id}`, tag: tagOf('signal.intake'), who: m.name, when: m.lastContactAt ? dateTime(m.lastContactAt) : 'No contact yet', pill: [/** @type {any} */ (MEMBER_BRIEFS)[m.id]?.tone ?? 'neutral', /** @type {any} */ (MEMBER_BRIEFS)[m.id]?.status ?? 'No review yet'],
        h: m.signal, b: `${m.age}, ${countyName(m.county)}, ${m.state}. ${planLabel(m.currentPlanLabel)}.`,
        acts: `<button type="button" class="${top ? 'btn pri' : 'link'}" data-act="member" data-v="${esc(m.id)}" data-x="overview">Open member</button>`,
      }),
    });
  }
  return out;
}

const dismissBtn = (/** @type {string} */ id) => `<button type="button" class="link is-quiet" data-act="home.dismiss" data-id="${esc(id)}">Dismiss</button>`;
/** Copied `sigHTML`, meta in the original order: tag, member, time, one pill. `tag` is trusted HTML. @param {{ id: string, ag: string, fresh: boolean, tid: string, tag: string, who: string, when: string, pill: [string, string], h: string, b: string, acts: string }} x */
function sig(x) {
  return `<article class="sig${x.fresh ? ' fresh' : ''}" data-testid="${esc(x.tid)}" data-feed="${esc(x.id)}"><div class="sig-ic ${x.ag}">${ico(x.ag)}</div><div><div class="sig-meta">${x.tag}<span>${esc(x.who)}</span><span>${esc(x.when)}</span><span class="pill ${x.pill[0]}">${esc(x.pill[1])}</span></div>` +
    `<h4>${esc(x.h)}</h4><p>${esc(x.b)}</p><div class="sig-act">${x.acts}</div></div></article>`;
}

/** Copied `feedHTML`: filter, then the arrival highlight for what was not on the feed at the last render. @param {ReturnType<typeof feedItems>} items */
export function feedHTML(items) {
  const list = items.filter((i) => filter === 'all' || i.ag === filter);
  if (!list.length) return '<div class="pad">' + emptyState('No signals') + '</div>';
  return list.map((i, n) => i.html(started && !seen.has(i.id), n === 0)).join('');
}


/** The time a step finished on the demo clock, from the run timeline. @param {any} s @param {string} step */
const doneAt = (s, step) => { const t = s.timeline.find((/** @type {any} */ x) => x.step === step); return t ? timeOfDayET(t.at) : ''; };
/** "10:00 AM" in Eastern time. @param {string} iso */
const timeOfDayET = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/**
 * "Prepared for you": the work Keel did on Dottie's case before anyone asked (autoprep). Four rows that tick as the run events arrive, then the result
 * in plain words and the one button that matters. Hidden in the click-through mode (?prep=0) until the case is open. @param {any} ctx
 */
export function prepPanelHTML(ctx) {
  const s = ctx.state, sc = scenarioOf(ctx);
  if (!sc) return '';
  const started = stepStatus(s, 'signal.intake') !== 'pending';
  if (!prep.enabled && !started) return '';
  if (s.approval) return ''; // after approval the feed carries the story
  const first = shortName(sc).split(' ')[0];
  const ready = prepDone();
  const rows = PREP_STEPS.map((id) => {
    const chainEnd = id === 'memory.assemble' ? 'decision.recommend' : id === 'action.draft' ? 'action.gate' : id;
    const st = stepStatus(s, chainEnd), working = !ready && (prep.current === id || (st !== 'done' && stepStatus(s, id) === 'started'));
    const done = st === 'done';
    const icon = done ? '<span class="prep-ic is-done" aria-hidden="true">✓</span>' : working ? '<span class="stage-spinner" aria-hidden="true"></span>' : '<span class="prep-ic" aria-hidden="true">○</span>';
    const t = PREP_TEXT[id];
    return `<li class="prep-row" data-state="${done ? 'done' : working ? 'working' : 'waiting'}" data-step="${id}">${icon}<span class="prep-text">${esc(done ? t.done : t.doing)}</span></li>`;
  }).join('');
  let result = '';
  if (ready) {
    const rec = recommendation(s), planId = rec?.outcome?.recommendedPlanId;
    const plan = planId ? nameOf(s, planId) : '';
    const code = planId ? planId.replace(/^plan-/, '') : '';
    const cost = code ? /** @type {any} */ (factOf(s, `fact:cost:${code}`))?.value : null;
    const out = (rec?.candidates ?? []).filter((/** @type {any} */ c) => !c.eligible).length;
    const docs = (sc.providers ?? []).filter((/** @type {any} */ p) => /must/i.test(String(p.priority))).length, meds = (sc.prescriptions ?? []).length;
    const docText = docs === 2 ? 'both her doctors' : docs ? `all ${docs} of her doctors` : 'her doctors';
    result = `<div class="prep-result" data-testid="prep-result"><p class="prep-headline"><b>${esc(first)} keeps ${docText} and all ${meds} of her medicines on ${esc(plan)}</b>${cost != null ? `, about ${esc(money(cost))} for the year` : ''}.</p>` +
      `<p class="small muted">${out} plans ruled out, each with a reason. Her email is written and checked. It needs your review, then supervisor approval.</p>` +
      `<div class="prep-acts"><button type="button" class="btn pri" data-act="member" data-v="${esc(sc.beneficiary.id)}" data-x="overview" data-testid="prep-review">Review ${esc(first)}'s case</button>` +
      `<button type="button" class="btn" data-act="member" data-v="${esc(sc.beneficiary.id)}" data-x="outreach">See her email</button></div></div>`;
  }
  const title = ready ? `${first}'s case is ready for you` : `Keel is preparing ${first}'s case`;
  const secs = prepSeconds();
  const sub = ready ? `Done before you asked${secs ? `, in ${secs} seconds` : ''}. Nobody clicked anything.` : `Her plan ends Dec 31 and she left a voicemail last night. No one has asked Keel to do this.`;
  return `<section class="card pad prep-card${ready ? ' is-ready' : ''}" data-testid="prep-feed" aria-live="polite"><div class="sec-h"><h2>${esc(title)}</h2><span class="sp small muted">${ready ? '' : '<i class="live"></i>Working now'}</span></div>` +
    `<p class="small muted prep-sub">${esc(sub)}</p><ol class="prep-list">${rows}</ol>${result}</section>`;
}

/** @param {any} ctx */
function render(ctx) {
  const sc = scenarioOf(ctx);
  if (!sc) return top('Good morning', '') + loadingState('Loading', { lines: 4 });
  if (seenRun !== String(ctx.state.runId)) { seenRun = String(ctx.state.runId); dismissed.clear(); seen.clear(); started = false; }
  const items = feedItems(ctx);
  const html = feedHTML(items);
  for (const i of items) seen.add(i.id);
  started = true;
  const e = easternParts(sc.demoNow);
  const greet = ctx.role === 'supervisor' ? 'Carol' : 'Ryan';
  const tiles = homeTiles(ctx);
  const s = ctx.state, done = STEPS.filter((m) => stepStatus(s, m.id) === 'done').length;
  const next = ctx.run.nextStep?.();
  const finished = caseFinished(s) || done === STEPS.length;
  const caseNote = finished ? `<p class="small muted mem-casenote">${STEPS.length} of ${STEPS.length}${exceptionCaseOpen(s) ? ' · Exception case open' : ''} · <a class="link" href="#performance/audit">Open audit</a></p>`
    : `<p class="small muted mem-casenote">${done} of ${STEPS.length}${next ? ` · Next: ${esc(nativeLabel(next))}` : ''}</p>`;
  return top(`${e.h < 12 ? 'Good morning' : e.h < 17 ? 'Good afternoon' : 'Good evening'}, ${greet}`, `${e.weekday}, ${e.month} ${e.day}`) +
    '<div class="kpis" data-testid="home-tiles">' + tiles.map((t) => `<div class="card kpi" data-tile="${t.id}"><label>${esc(t.label)}</label><div class="v">${esc(t.value)}</div><div class="d">${esc(t.detail)}</div></div>`).join('') + '</div>' + prepPanelHTML(ctx) +
    '<div class="grid2"><div class="card"><div class="sec-h pad mem-feedhead"><h2>Signals and actions</h2><span class="small muted feed-live"><i class="live"></i>Live</span><div class="sp filters" role="group" aria-label="Filter signals">' +
    FILTERS.map(([id, label]) => `<button type="button" data-act="home.filter" data-v="${id}" aria-pressed="${filter === id}">${esc(label)}</button>`).join('') + '</div></div>' +
    `<div id="feed" data-testid="feed">${html}</div></div>` +
    '<div class="col"><div class="card pad" data-testid="deadlines"><div class="sec-h"><h3>Deadlines</h3></div><div class="sched">' +
    deadlineRows(ctx).map(([d, t, sub]) => `<div><span class="ui-num small muted">${esc(d)}</span><span><b>${esc(t)}</b><br><span class="small muted">${esc(sub)}</span></span></div>`).join('') + '</div></div>' +
    `<div class="card pad" data-testid="home-case"><div class="sec-h"><h3>${esc(shortName(sc))}'s case</h3><div class="sp"><button type="button" class="link small" data-act="member" data-v="${esc(sc.beneficiary.id)}" data-x="overview">View case</button></div></div>` +
    `<div class="bar" role="img" aria-label="${done} of ${STEPS.length} steps done"><i style="width:${Math.round((done / STEPS.length) * 100)}%"></i></div>${caseNote}</div></div></div>`;
}

/** @param {HTMLElement} el @param {any} ctx */
function after(el, ctx) {
  if (!ctx.run.views?.story) ctx.run.load?.('story')?.catch?.(() => { /* the feed still shows Dottie's signal */ });
}

registerPage({
  id: 'home', title: 'Home', dock: 'home', render, after,
  acts: {
    'home.dismiss': (el) => { dismissed.add(String(el.dataset.id)); scheduleRender(); },
    'home.filter': (el) => { filter = el.dataset.v ?? 'all'; scheduleRender(); },
  },
});
