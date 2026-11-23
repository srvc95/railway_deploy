// The run store of the Keel shell (change adopt-keel-shell, design S6; interface: notes/keel-shell-map.md section 6).
// One run behind every page: pages read `run.state` / `run.views` / `run.ui` and call the methods below; nothing else holds run state, and
// navigation, tab changes and the role toggle never create a run, reset it or send a request. It sits on public/js/state.js (a fold of the
// server's RunEvents) and on the transports (live REST + SSE, or ?fixture=1). It decides nothing: the server does.
import { APPROVAL_CHAIN, apply, chainEnd, clearRun, createState, heldMessage, isRunning, nextStepId, recommendation, stepStatus } from '../js/state.js';
import { LAYERS, STEPS, stepMeta } from '../js/steps.js';
import { liveTransport } from '../js/transport-live.js';

/** @typedef {import('../js/state.js').State} State */
/** @typedef {import('../js/transport-live.js').Transport} Transport */
/** @typedef {import('../../shared/contracts.ts').StepId} StepId */
/** @typedef {import('../../shared/contracts.ts').Layer} Layer */
/** @typedef {import('../../shared/contracts.ts').RunEvent} RunEvent */
/** @typedef {import('../../shared/contracts.ts').ReplayResult} ReplayResult */
/** @typedef {import('../../shared/contracts.ts').AuditVerifyResult} AuditVerifyResult */
/** @typedef {import('../../shared/contracts.ts').StoryView} StoryView */
/** @typedef {import('../../shared/contracts.ts').CoverageView} CoverageView */
/** @typedef {import('../../shared/contracts.ts').RulesView} RulesView */
/** @typedef {import('../../shared/contracts.ts').CrmRecord} CrmRecord */
/** @typedef {'story' | 'coverage' | 'rules' | 'crm'} ViewName */
/** @typedef {RunEvent['event'] | 'ui' | 'reset' | 'panel'} Reason */
/** @typedef {'why' | 'audit' | 'dock'} PanelName The three panels (design D4): the Why sheet, the audit report sheet and the dock thread. At most one is open. */
/** @typedef {{ draftId: string, body: string, channel: string }} EditDraft */

const PRIOR_DECISION = 'DEC-2025-1112-HAYES';
const PANELS = /** @type {const} */ (['why', 'audit', 'dock']);

/**
 * The native button of each step that a click can start: one click is one `next` request. Some presses run a chain (change
 * polish-and-realism, D3): Check plans loads the records and then runs the rules, Draft outreach also runs the gate, Request changes also runs the
 * re-check and routes the message for approval, Simulate member reply also runs the reply reading and the next-action rules. The steps that only ever run inside a chain, or inside the approval, have no entry and no button.
 * Approve is the only run action that is not a `next`. `testid` is the button's data-testid.
 * @type {Partial<Record<StepId, { label: string, testid: string }>>}
 */
export const NATIVE = {
  'signal.intake': { label: 'Open case', testid: 'open-case' },
  'signal.interpret': { label: 'Read the voicemail', testid: 'act-interpret' },
  'memory.assemble': { label: 'Check plans', testid: 'check-plans' },
  'action.draft': { label: 'Draft outreach', testid: 'draft-outreach' },
  'action.rep-edit': { label: 'Edit and send', testid: 'request-changes' },
  'action.monitor': { label: 'Simulate member reply', testid: 'simulate-reply' },
  'briefing.audit': { label: 'Build audit', testid: 'build-audit' },
};

/** @param {unknown} e @param {string} lead */
const netMessage = (e, lead) => ((/** @type {any} */ (e))?.network ? /** @type {Error} */ (e).message : `${lead} Is the server running?`);

/** The transport the URL asks for: ?fixture=1 plays recorded events (delay and variant from ?delay= and ?variant=), anything else is the real server. @returns {Promise<Transport>} */
async function pickTransport() {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  if (q.get('fixture') !== '1') return liveTransport();
  const { fixtureTransport } = await import('../js/transport-fixture.js');
  const d = q.get('delay');
  return fixtureTransport({ variant: q.get('variant') ?? 'live', delayMs: d == null ? 1500 : Number(d) });
}

/** A fresh store. The app uses the `run` singleton below; tests build their own. */
export function createRunStore() {
  const state = createState();
  const ui = /** @type {{ role: 'agent' | 'supervisor', panel: PanelName | null, whyId: string | null, edit: EditDraft | null, replay: ReplayResult | null, replays: { original: ReplayResult | null, current: ReplayResult | null }, replayBusy: string | null, replayError: string | null }} */ ({
    role: 'agent', panel: null, whyId: null, edit: null, replay: null, replays: { original: null, current: null }, replayBusy: null, replayError: null,
  });
  const views = /** @type {{ scenario: State['scenario'], story: StoryView | null, coverage: CoverageView | null, rules: RulesView | null, crm: CrmRecord[] | null }} */ ({
    scenario: null, story: null, coverage: null, rules: null, crm: null,
  });

  /** @type {Transport | null} */ let transport = null;
  /** @type {Promise<void> | null} */ let bootP = null;
  /** Bumped by every new run: an answer or event that belongs to an older run is ignored. */ let gen = 0;
  let pending = false;
  /** @type {AbortController | null} */ let ac = null;
  /** @type {(() => unknown) | null} */ let retryAction = null;
  /** @type {(() => void) | null} */ let unsub = null;
  /** @type {Set<(reason: Reason) => void>} */ const listeners = new Set();
  /** @type {Map<string, Promise<unknown>>} */ const loads = new Map();
  let crmWanted = false, crmSeq = 0, crmScheduled = false;

  // ---------- notification ----------
  /** @param {Reason} reason */
  function emit(reason) {
    for (const fn of [...listeners]) { try { fn(reason); } catch { /* a page's render error must not stop the others */ } }
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') document.dispatchEvent(new CustomEvent('siq:run', { detail: { reason } }));
  }

  /** @param {string} message @param {(() => unknown) | null} retry */
  function fail(message, retry) { state.error = message; retryAction = retry; emit('ui'); }

  // ---------- derived ----------
  const busy = () => pending || (isRunning(state) && !state.error); // a started step with an error filed is a failed step, not a running one
  const nextStep = () => nextStepId(state);
  const canNext = () => !busy() && nextStep() !== null;

  /** @returns {Record<Layer, 'done' | 'active' | 'waiting'>} */
  function layerStates() {
    const st = state.head ? stepStatus(state, state.head) : 'pending';
    const nxt = nextStep();
    // active = the layer of a started/waiting head, or of a done head whose next step is in the same layer (the layer is mid-way, not finished)
    const active = !state.head ? null : (st === 'started' || st === 'waiting') ? stepMeta(state.head)?.layer : st === 'done' && nxt && stepMeta(nxt)?.layer === stepMeta(state.head)?.layer ? stepMeta(state.head)?.layer : null;
    const out = /** @type {Record<Layer, 'done' | 'active' | 'waiting'>} */ ({});
    for (const l of LAYERS) out[l.id] = l.id === active ? 'active' : STEPS.some((s) => s.layer === l.id && stepStatus(state, s.id) === 'done') ? 'done' : 'waiting';
    return out;
  }

  // ---------- read-only views ----------
  function fetchCrm() {
    const t = /** @type {Transport} */ (transport), g = gen, seq = ++crmSeq;
    const p = t.loadCrm(/** @type {string} */ (state.runId)).then((recs) => {
      if (g === gen && seq === crmSeq) { views.crm = recs; emit('ui'); } // an older answer never replaces a newer one
      return recs;
    });
    loads.set('crm', p);
    p.catch(() => { if (loads.get('crm') === p) loads.delete('crm'); });
    return p;
  }
  /** The CRM records are the run's: after each `crm` event fetch them again, once the screen has asked for them at least once. */
  function crmChanged() {
    loads.delete('crm');
    if (!crmWanted || crmScheduled) return;
    crmScheduled = true;
    void Promise.resolve().then(() => { crmScheduled = false; if (!loads.has('crm') && transport && state.runId) fetchCrm().catch(() => { /* keeps the last records */ }); });
  }

  /** @param {ViewName} name @returns {Promise<any>} */
  function load(name) {
    if (!transport) return Promise.reject(new Error('The demo is not started.'));
    const t = transport;
    if (name === 'crm') {
      if (!state.runId) return Promise.reject(new Error('There is no run yet.'));
      crmWanted = true;
      return /** @type {Promise<CrmRecord[]>} */ (loads.get('crm')) ?? fetchCrm();
    }
    const cached = loads.get(name);
    if (cached) return cached;
    const call = name === 'story' ? t.loadStory : name === 'coverage' ? t.loadCoverage : name === 'rules' ? t.loadRules : null;
    if (!call) return Promise.reject(new Error(`Unknown view: ${String(name)}`));
    const p = call().then((v) => { /** @type {any} */ (views)[name] = v; emit('ui'); return v; });
    loads.set(name, p);
    p.catch(() => { if (loads.get(name) === p) loads.delete(name); });
    return p;
  }

  // ---------- lifecycle ----------
  /** @param {{ transport?: Transport }} [opts] */
  function boot(opts) {
    bootP ??= doBoot(opts ?? {});
    return bootP;
  }

  /** @param {{ transport?: Transport }} opts */
  async function doBoot(opts) {
    try { transport = opts.transport ?? transport ?? await pickTransport(); }
    catch (e) { fail(netMessage(e, 'The demo could not be started.'), () => { bootP = null; return boot(opts); }); return; }
    const t = transport;
    const [scenario, story] = await Promise.allSettled([t.loadScenario(), t.loadStory()]);
    if (scenario.status === 'rejected') { fail(netMessage(scenario.reason, 'The case could not be loaded.'), () => { bootP = null; return boot(opts); }); return; }
    state.scenario = views.scenario = scenario.value;
    if (story.status === 'fulfilled') { views.story = story.value; loads.set('story', Promise.resolve(story.value)); }
    emit('ui');
    await startRun();
  }

  /** New run: forget the old one, cancel what it still has in flight, subscribe to the new one. */
  async function startRun() {
    unsub?.(); unsub = null;
    const myGen = ++gen;
    ac?.abort(); ac = null; pending = false; retryAction = null; // a call still pending for the old run must not hold the new case back
    const scenario = state.scenario;
    clearRun(state); state.scenario = scenario;
    ui.whyId = null; if (ui.panel === 'why' || ui.panel === 'audit') ui.panel = null; ui.edit = null; ui.replay = null; ui.replays = { original: null, current: null }; ui.replayBusy = null; ui.replayError = null;
    views.crm = null; loads.delete('crm'); crmWanted = false; crmSeq++;
    emit('reset');
    const t = /** @type {Transport} */ (transport);
    let runId;
    try { runId = await t.createRun(); }
    catch (e) { if (myGen === gen) fail(netMessage(e, 'The run could not be started.'), () => startRun()); return; }
    if (myGen !== gen) return;
    state.runId = runId;
    unsub = t.subscribe(runId, {
      open: () => {
        if (myGen !== gen) return;
        const sc = state.scenario; clearRun(state); state.scenario = sc; state.runId = runId; // the server replays the history after (re)connect
        if (crmWanted) { loads.delete('crm'); crmChanged(); }
        emit('ui');
      },
      event: (e) => {
        if (myGen !== gen) return;
        apply(state, e);
        if (e.event === 'crm') crmChanged();
        emit(e.event);
      },
      error: () => { /* EventSource retries by itself; the replay on reconnect rebuilds the state */ },
    });
    emit('ui');
  }

  const reset = () => startRun();

  /** Repeat what failed (the run start, the case load or the last next), after the "Try again" button. */
  async function retry() {
    const f = retryAction;
    state.error = null; retryAction = null; emit('ui');
    await f?.();
  }

  // ---------- run actions ----------
  /**
   * Resolves once the last step of the chain that `step` opened is filed in the state (the events travel on their own stream, so the answer
   * to the request can come first). Gives up after 8 s so a dropped stream cannot freeze the page. @param {StepId} step @param {number} g
   */
  async function arrived(step, g) {
    const last = chainEnd(step);
    const arrivedAt = () => { const st = stepStatus(state, last); return st === 'done' || (last === 'human.approve' && st === 'waiting'); }; // a routed approval ends the chain waiting
    if (arrivedAt()) return;
    let timer;
    await Promise.race([until(() => g !== gen || arrivedAt()), new Promise((res) => { timer = setTimeout(res, 8000); })]);
    clearTimeout(timer);
  }

  /**
   * Exactly one POST /next. No-op while a call is in flight, a step is running, the run waits for the human or has ended.
   * @param {StepId} [expect] the step the pressed button was drawn for; a stale button for another step does nothing
   */
  async function next(expect) {
    if (!transport || pending || !canNext()) return;
    const step = nextStep();
    if (expect && expect !== step) return;
    const myGen = gen, c = new AbortController(), t = transport;
    ac = c; pending = true; state.view = null; state.error = null; retryAction = null; emit('ui');
    try { await t.next(/** @type {string} */ (state.runId), c.signal); await arrived(/** @type {StepId} */ (step), myGen); }
    catch (e) {
      if (myGen === gen) { state.error = /** @type {Error} */ (e).message; if (/** @type {any} */ (e).network) retryAction = () => next(/** @type {StepId} */ (step)); }
    } finally { if (myGen === gen) { pending = false; ac = null; emit('ui'); } }
  }

  /** @param {'approved' | 'rejected'} decision */
  async function approve(decision) {
    if (ui.role !== 'supervisor') throw new Error('Approving or rejecting needs the Supervisor view.');
    if (!transport || !state.scenario || !state.runId || pending) return;
    const myGen = gen, t = transport, rec = recommendation(state), corrected = heldMessage(state);
    pending = true; state.error = null; emit('ui');
    try {
      await t.approve(state.runId, { approverId: state.scenario.approver.id, decision, subjectIds: [rec?.decisionId, corrected?.id].filter(/** @returns {x is string} */ (x) => !!x) });
      if (decision === 'approved') await arrived(/** @type {StepId} */ (APPROVAL_CHAIN.at(-1)), myGen); // the closed loop is five steps: resolve after the last one
    } catch (e) {
      if (myGen === gen) { state.error = /** @type {Error} */ (e).message; if (/** @type {any} */ (e).network) retryAction = () => approve(decision); }
    } finally { if (myGen === gen) { pending = false; emit('ui'); } }
  }

  /** Explore mode only: send an edited message. The video path uses the seeded edit through `next`. @param {string} body @param {string} channel */
  async function edit(body, channel) {
    if (!transport || !state.runId || pending) return;
    const myGen = gen, t = transport, draftId = ui.edit?.draftId ?? state.draftOrder.at(-1);
    if (!draftId) return;
    pending = true; state.error = null; emit('ui');
    try { await t.edit(state.runId, { draftId, body, channel }); if (myGen === gen) ui.edit = null; }
    catch (e) { if (myGen === gen) { state.error = /** @type {Error} */ (e).message; if (/** @type {any} */ (e).network) retryAction = () => edit(body, channel); } }
    finally { if (myGen === gen) { pending = false; emit('ui'); } }
  }

  /** @param {'as-of-original' | 'with-current'} mode */
  async function replay(mode) {
    if (!transport) return;
    const myGen = gen, t = transport;
    ui.replayBusy = mode; ui.replayError = null; emit('ui');
    try { const r = await t.replay({ decisionId: PRIOR_DECISION, mode }); if (myGen === gen) { ui.replay = r; ui.replays = { ...ui.replays, [mode === 'as-of-original' ? 'original' : 'current']: r }; } }
    catch (e) { if (myGen === gen) ui.replayError = `Replay failed: ${/** @type {Error} */ (e).message}`; }
    finally { if (myGen === gen) { ui.replayBusy = null; emit('ui'); } }
  }

  // ---------- ui state (kept across navigation) ----------
  /** @param {'agent' | 'supervisor'} role */
  function setRole(role) { if (role !== 'agent' && role !== 'supervisor') return; ui.role = role; emit('ui'); }
  /**
   * The one place that says which panel is open (design D4, requirement "One panel at a time"). Opening a panel replaces the one that was open: the Why sheet is closed
   * (`ui.whyId` cleared) when another panel opens. A change of panel is announced with the `panel` event, which the dock and the tour subscribe to. @param {PanelName} name
   */
  function openPanel(name) {
    if (!PANELS.includes(name)) throw new RangeError(`Unknown panel: ${String(name)}`);
    if (ui.panel === name) return;
    ui.panel = name;
    if (name !== 'why') ui.whyId = null;
    emit('panel');
  }
  /** Closes the open panel; with a name, only if that is the one open. The Why sheet closes with its panel. @param {PanelName} [name] */
  function closePanel(name) {
    if (!ui.panel || (name && ui.panel !== name)) return;
    ui.panel = null; ui.whyId = null;
    emit('panel');
  }
  /** Opens the Why sheet on a decision (the why panel). Another decision in the open sheet is a redraw, not a new panel. @param {string} id */
  function openWhy(id) {
    const changed = ui.panel !== 'why';
    ui.whyId = id; ui.panel = 'why';
    if (changed) emit('panel');
    emit('ui');
  }
  function closeWhy() { if (!ui.whyId) return; closePanel('why'); emit('ui'); }
  /** An unsent edit of a draft; null discards it. @param {Partial<EditDraft> | null} partial */
  function setEdit(partial) {
    ui.edit = partial === null ? null : { draftId: state.draftOrder.at(-1) ?? '', body: '', channel: 'email', ...(ui.edit ?? {}), ...partial };
    emit('ui');
  }
  /** Look back at an earlier step in the workflow stage (null: follow the head). @param {string | null} id */
  function view(id) { state.view = id && id !== state.head ? /** @type {StepId} */ (id) : null; emit('ui'); }

  /** Resolves when `pred()` holds, checked after every change (the guide and tests wait on run events this way). @param {() => boolean} pred @returns {Promise<void>} */
  function until(pred) {
    if (pred()) return Promise.resolve();
    return new Promise((res) => { const off = subscribe(() => { if (pred()) { off(); res(); } }); });
  }

  /** @param {(reason: Reason) => void} fn @returns {() => void} */
  function subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

  const auditUrl = () => (state.audit?.url ?? (transport && state.runId ? transport.auditUrl(state.runId) : null));
  /** The built package's own audit-report.html, for the preview sheet (404 before briefing.audit). */
  const auditReportUrl = () => (transport && state.runId ? transport.auditReportUrl(state.runId) : null);
  /** Re-hash the built package on the server: { ok, files, manifestSha256 }. @returns {Promise<AuditVerifyResult>} */
  function auditVerify() {
    if (!transport || !state.runId) return Promise.reject(new Error('There is no run yet.'));
    return transport.auditVerify(state.runId);
  }

  return {
    state, ui, views,
    boot, reset, next, approve, edit, replay, load, retry, canRetry: () => !!retryAction,
    setRole, openWhy, closeWhy, openPanel, closePanel, setEdit, view,
    canNext, busy, nextStep, layerStates, auditUrl, auditReportUrl, auditVerify, subscribe, until,
  };
}

export const run = createRunStore();

if (typeof window !== 'undefined') {
  const w = /** @type {any} */ (window);
  w.__siq = w.__siq ?? {};
  w.__siq.run = run;
}
