// Chrome around the stage: header, member card, stepper, CRM panel, timeline, footer.
import { h, setChildren } from './dom.js';
import { dateLong, dateUs, duration, etShort, etStamp, etTime, money } from './format.js';
import { ACTOR_LABEL, LAYERS, LLM_STATUS_TEXT, STEPS, stepIndex, stepMeta } from './steps.js';
import { factById, llmFor, recommendation, stepStatus, viewStep } from './state.js';

/** @typedef {import('./state.js').State} State */
/** @typedef {import('./main.js').App} App */

/** The one actor badge. Colour comes from --layer-* tokens, the text says it too. @param {string} actor */
export const badge = (actor) => h('span', { class: `badge badge-${actor}`, 'data-badge': actor }, ACTOR_LABEL[actor] ?? actor);

const EP_NAME = /** @type {Record<string, string>} */ ({ AEP: 'Annual Enrollment Period', 'SEP-NONRENEWAL': 'Special period after a plan non-renewal', 'MA-OEP': 'Medicare Advantage Open Enrollment' });

// ---------- header ----------
/** @param {HTMLElement} el @param {State} s @param {App} app */
export function renderHeader(el, s, app) {
  const sc = s.scenario;
  const running = s.runState === 'running' || s.runState === 'waiting-human';
  setChildren(el,
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'A'),
      h('div', null, h('h1', { class: 'brand-name' }, 'Keel'), h('p', { class: 'brand-sub' }, 'Medicare retention · governed workflow'))),
    h('p', { class: 'clock', 'data-testid': 'clock' }, h('span', { class: 'clock-label' }, 'Story clock '), s.demoNow ? etStamp(s.demoNow) : '—'),
    cycleMetric(s),
    h('div', { class: 'head-actions' },
      h('button', { class: 'btn', type: 'button', 'data-testid': 'mode', 'aria-pressed': String(app.mode === 'explore'), title: app.mode === 'explore' ? 'Explore mode: panels and the agent edit can be inspected or changed. Press to return to the guided walkthrough.' : 'Guided mode: the walkthrough explains each step. Press to explore on your own.', on: { click: () => app.toggleMode() } },
        app.mode === 'explore' ? 'Explore mode' : 'Guided mode'),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'tour-open', on: { click: () => app.startTour() } }, 'Walkthrough'),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'reset', on: { click: () => app.reset() } }, 'Reset'),
      s.audit
        ? h('a', { class: 'btn btn-primary', 'data-testid': 'audit-download', href: s.audit.url, download: '' }, 'Download audit package')
        : h('span', { class: 'btn btn-primary is-off', 'data-testid': 'audit-download', 'aria-disabled': 'true' }, 'Audit package: ready at the last step')),
  );
  el.toggleAttribute('data-running', running);
  void sc;
}

/** @param {State} s */
function cycleMetric(s) {
  const c = s.cycle;
  return h('div', { class: 'cycle', 'data-testid': 'cycle-metric', 'aria-label': 'Cycle time' },
    h('span', { class: 'cycle-title' }, 'Cycle time'),
    c
      ? h('div', { class: 'cycle-vals' },
        h('span', null, h('b', null, 'Measured '), duration(c.measuredMs), ' (this run)'),
        h('span', null, h('b', null, 'Modeled baseline '), `${c.baseline.minutes} min`, ' · modeled assumption'))
      : h('div', { class: 'cycle-vals' }, h('span', { class: 'muted' }, 'Measured at the end of the run, next to a labelled modeled baseline')));
}

// ---------- member card ----------
/** @param {HTMLElement} el @param {State} s */
export function renderMember(el, s) {
  const sc = s.scenario;
  if (!sc) { setChildren(el, h('p', { class: 'muted pad' }, 'Loading the case')); return; }
  const b = sc.beneficiary;
  const rec = recommendation(s);
  const ep = factById(s, 'fact:election:ep-aep'), sep = factById(s, 'fact:election:ep-sep-nonrenewal');
  const epv = /** @type {any} */ (ep?.value ?? {}), sepv = /** @type {any} */ (sep?.value ?? {});
  const o = rec?.outcome?.type === 'plan-recommendation' ? rec.outcome : null;
  const deadline = epv.end ?? o?.deadline, daysLeft = o?.daysLeft ?? epv.daysLeft; // the AEP close date goes with the AEP days left (o.deadline is the no-gap date)
  const interp = /** @type {import('../../shared/contracts.ts').InterpretResult | undefined} */ (s.llm['signal.interpret']?.result);
  const facets = [
    facet('election', 'County and election period', [
      h('p', { class: 'strong' }, `${b.county}, ${b.state}`),
      deadline
        ? h('p', null, EP_NAME[epv.code ?? 'AEP'] ?? 'Election period', ' closes ', h('b', null, dateLong(deadline)), ' · ', h('b', { class: 'accent' }, `${daysLeft} days left`))
        : h('p', { class: 'muted' }, 'Calculated by rules when the case opens'),
      sepv.noGapDate ? h('p', { class: 'muted' }, `No-gap deadline: ${dateLong(sepv.noGapDate)} (${sepv.daysToNoGap} days), using the non-renewal special period`) : null,
    ]),
    facet('plan', 'Current plan', [
      h('p', { class: 'strong' }, sc.currentPlan.name),
      h('p', null, h('span', { class: 'chip chip-block' }, `Non-renewing ${dateUs(sc.currentPlan.endsOn)}`), ` Notice mailed ${dateLong(sc.currentPlan.noticeMailedOn)}`),
      h('p', { class: 'muted' }, `${sc.currentPlan.contractPlanId} · premium ${money(sc.currentPlan.premiumMonthly)} per month in 2026`),
    ]),
    facet('care-team', 'Doctors and hospital', [
      h('ul', { class: 'plain' }, [...sc.providers.map((p) => h('li', null, h('b', null, p.name), ` ${p.specialty} `, h('span', { class: 'chip' }, p.priority === 'must-keep' ? 'Must keep' : p.priority))),
        ...sc.facilities.map((f) => h('li', null, h('b', null, f.name), ' Hospital ', h('span', { class: 'chip' }, f.priority === 'must-keep' ? 'Must keep' : 'Preferred')))]),
    ]),
    facet('prescriptions', 'Prescriptions', [
      h('ul', { class: 'plain' }, sc.prescriptions.map((p) => h('li', null, h('b', null, p.name.replace(/ \d.*$/, '')), ` ${p.strength} · ${p.fillsPerYear} fills a year`))),
    ]),
    facet('preferences', 'Preferences, in her words', interp ? [
      h('ul', { class: 'plain' }, [
        ...interp.preferences.map((p) => h('li', null, h('b', null, PREF_LABEL[p.kind] ?? p.kind), ` ${p.value}`, h('q', { class: 'quote' }, p.quote))),
        ...interp.consentSignals.map((c) => h('li', null, h('b', null, `${c.permission === 'revoke' ? 'No' : 'OK to use'} ${c.channel === 'sms' ? 'text messages' : c.channel}`), h('q', { class: 'quote' }, c.quote))),
      ]),
    ] : [h('p', { class: 'muted' }, 'Read from her voicemail by the model at step 2, each with a quote.')]),
    facet('consent', 'Consent by channel', [
      h('ul', { class: 'plain' }, sc.consents.map((c) => h('li', null,
        h('b', null, CHANNEL[c.channel] ?? c.channel), ' ',
        h('span', { class: `chip ${c.status === 'granted' ? 'chip-pass' : 'chip-block'}` }, c.status === 'granted' ? 'Granted' : c.status === 'revoked' ? 'Revoked' : 'None'),
        h('span', { class: 'muted' }, ` ${c.basis.replace(/-/g, ' ')}, ${dateUs(c.at.slice(0, 10))}`)))),
      h('div', { class: 'comms' },
        h('p', { class: 'muted' }, h('b', null, 'Prior communications '), `Voicemail from her, ${etShort(sc.inbound.at)}; non-renewal letter mailed ${dateUs(sc.currentPlan.noticeMailedOn)}; no Scope of Appointment on file.`)),
    ]),
  ];
  setChildren(el,
    h('header', { class: 'member-head' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, 'PE'),
      h('div', null, h('h2', { class: 'member-name' }, b.name),
        h('p', { class: 'muted' }, `${b.age} · ${b.mbiDisplay} · Parts A and B`))),
    ...facets);
}
const PREF_LABEL = /** @type {Record<string, string>} */ ({ 'keep-provider': 'Keep', 'max-premium': 'Premium', channel: 'Contact by', 'benefit-interest': 'Interested in' });
const CHANNEL = /** @type {Record<string, string>} */ ({ email: 'Email', sms: 'Text message', phone: 'Phone', mail: 'Mail' });
/** @param {string} id @param {string} title @param {unknown[]} body */
const facet = (id, title, body) => h('section', { class: 'facet', 'data-facet': id }, h('h3', { class: 'facet-title' }, title), ...body);

// ---------- stepper ----------
/** @param {HTMLElement} el @param {State} s @param {App} app */
export function renderStepper(el, s, app) {
  const view = viewStep(s);
  const cur = stepMeta(view);
  const headIdx = stepIndex(s.head);
  setChildren(el,
    h('div', { class: 'layers', 'aria-label': 'Pipeline layers' }, LAYERS.map((l, i) => h('div', { class: `layer ${cur?.layer === l.id ? 'is-current' : ''}`, 'data-layer': l.id },
      h('span', { class: 'layer-n' }, i + 1), h('span', { class: 'layer-name' }, l.name), badge(l.actor === 'human' ? 'human' : l.actor), l.id === 'action' ? badge('system') : null))),
    h('div', { class: 'controls' },
      h('p', { class: 'now', 'aria-live': 'polite' }, cur ? [h('b', null, `Step ${cur.n} of 18`), ` ${cur.title}`] : 'Not started'),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'back', disabled: !(stepIndex(view) > 0), on: { click: () => app.back() } }, 'Back'),
      s.view && s.view !== s.head ? h('button', { class: 'btn', type: 'button', 'data-testid': 'return', on: { click: () => app.view(null) } }, 'Return to current') : null,
      h('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'next', 'aria-disabled': app.canNext() ? null : 'true', on: { click: () => app.next() } }, 'Next step')),
    h('ol', { class: 'steps', 'data-testid': 'stepper' }, STEPS.map((m, i) => {
      const st = stepStatus(s, m.id);
      const state = st === 'pending' ? 'pending' : st === 'started' ? 'current' : st === 'waiting' ? 'waiting' : 'done';
      const reached = i <= headIdx && st !== 'pending';
      const llm = llmFor(s, m.id);
      return h('li', { 'data-step': m.id, 'data-state': state, class: `step ${view === m.id ? 'is-view' : ''}` },
        h('button', { type: 'button', class: 'step-btn', disabled: !reached, 'aria-current': view === m.id ? 'step' : null, 'aria-label': `Step ${m.n}: ${m.title}, ${ACTOR_LABEL[m.actor]}, ${state}`, title: m.title, on: { click: () => app.view(m.id) } },
          h('span', { class: 'step-n' }, m.n), badge(m.actor), h('span', { class: 'step-short' }, llm?.status === 'fallback' ? 'Backup' : m.short)));
    })));
}

// ---------- CRM sandbox ----------
/** @param {HTMLElement} el @param {State} s */
export function renderCrm(el, s) {
  /** @type {Map<string, import('../../shared/contracts.ts').CrmWrite[]>} */
  const byRecord = new Map();
  for (const w of s.crm) { const k = `${w.objectType} ${w.recordId}`; byRecord.set(k, [...(byRecord.get(k) ?? []), w]); }
  setChildren(el,
    h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Sandbox CRM (simulated)'), badge('system')),
    h('p', { class: 'muted small' }, 'A simulated connector. Nothing leaves this page; a real deployment writes to the carrier’s CRM.'),
    s.crm.length === 0
      ? h('p', { class: 'empty' }, 'No writes yet. Each write will show before and after.')
      : h('ol', { class: 'writes' }, s.crm.map((w) => h('li', { class: 'write', 'data-write': String(w.seq) },
        h('div', { class: 'write-head' }, h('span', { class: `chip ${w.op === 'create' ? 'chip-pass' : ''}` }, w.op === 'create' ? 'Created' : 'Updated'), h('b', null, ` ${w.objectType} ${w.recordId}`), h('time', { class: 'muted' }, ` ${etTime(w.at)}`)),
        h('code', { class: 'req' }, w.simulatedRequest, ' (simulated)'),
        h('dl', { class: 'fields' }, Object.entries(w.after).flatMap(([k, v]) => [
          h('dt', null, k),
          h('dd', null, w.before && k in w.before ? [h('del', null, String(w.before[k])), ' ', h('span', { 'aria-hidden': 'true' }, '→'), ' ', h('ins', null, String(v))] : String(v)),
        ]))))));
}

// ---------- timeline ----------
/** @param {HTMLElement} el @param {State} s */
export function renderTimeline(el, s) {
  setChildren(el,
    h('header', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Run timeline'), h('span', { class: 'muted small' }, 'server time, ET')),
    h('ol', { class: 'tl' }, s.timeline.map((t) => h('li', { class: 'tl-item', 'data-step': t.step },
      h('time', { class: 'tl-time', datetime: t.at }, etTime(t.at)), badge(t.actor), h('span', { class: 'tl-text' }, t.text)))));
  const list = el.querySelector('.tl');
  if (list) list.scrollTop = list.scrollHeight;
}

// ---------- footer ----------
/** @param {HTMLElement} el @param {State} s */
export function renderFooter(el, s) {
  const lines = ['Demo data - synthetic members. Simulated CRM and delivery. Rule text is illustrative and is not legal advice.'];
  const llm = Object.entries(s.llm).map(([step, l]) => ({ step, l: llmFor(s, step) })).filter((x) => x.l);
  setChildren(el, h('p', null, lines[0]), llm.length ? h('p', { class: 'muted' }, llm.map((x) => `${stepMeta(x.step)?.short}: ${LLM_STATUS_TEXT(/** @type {any} */ (x.l).status)}`).join(' · ')) : null);
}
