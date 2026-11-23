// Boot and controller. The page is a pure function of State (state.js), which is a pure fold of the server's RunEvents.
// ?fixture=1 swaps the transport for recorded events; everything else is identical.
import { startAutoQuitBeacon } from './autoquit.js';
import { $, setChildren, h } from './dom.js';
import { apply, clearRun, createState, heldMessage, isRunning, recommendation, stepStatus, viewStep } from './state.js';
import { STEPS, stepIndex } from './steps.js';
import { liveTransport } from './transport-live.js';
import { renderCrm, renderFooter, renderHeader, renderMember, renderStepper, renderTimeline } from './views-chrome.js';
import { renderStage } from './views-stage.js';
import { renderWhy } from './views-why.js';
import { ATTEST_APPROVE, ATTEST_REJECT } from './views-compliance.js';

/** @param {unknown} e @param {string} lead */
const netMessage = (e, lead) => ((/** @type {any} */ (e))?.network ? /** @type {Error} */ (e).message : `${lead} Is the server running?`);

/** @typedef {import('./state.js').State} State */
/** @typedef {import('./transport-live.js').Transport} Transport */
/** @typedef {import('../../shared/contracts.ts').StepId} StepId */
/** @typedef {import('../../shared/contracts.ts').ReplayResult} ReplayResult */

const PRIOR_DECISION = 'DEC-2025-1112-HAYES';

export class App {
  /** @param {Transport} transport @param {{ mode: 'guided' | 'explore', guide: boolean }} opts */
  constructor(transport, opts) {
    this.transport = transport;
    this.state = createState();
    /** @type {'guided' | 'explore'} */ this.mode = opts.mode;
    this.wantGuide = opts.guide;
    /** @type {string | null} */ this.whyId = null;
    /** @type {ReplayResult | null} */ this.replayResult = null;
    /** @type {string | null} */ this.replayBusy = null;
    /** @type {string | null} */ this.replayError = null;
    /** @type {string | null} */ this.editing = null;
    this.pending = false;
    /** Bumped by every new run: an answer that arrives for an older run is ignored. */ this.gen = 0;
    /** @type {AbortController | null} */ this.ac = null;
    /** @type {(() => void) | null} */ this.retryAction = null;
    /** @type {(() => void) | null} */ this.unsub = null;
    this.rendering = false;
    /** @type {string | null} */ this.focusKey = null;
    /** @type {HTMLElement | null} */ this.opener = null;
    /** @type {{ stop(): void, start(): void, active(): boolean } | null} */ this.guide = null;
    /** @type {Set<() => void>} */ this.listeners = new Set();
    this.autoTimer = 0;
  }

  // ---------- derived ----------
  viewId() { return viewStep(this.state); }
  busy() { return this.pending || isRunning(this.state); }
  canNext() {
    const s = this.state;
    if (!s.scenario || !s.runId || this.busy()) return false;
    if (!s.head) return true; // the case is not opened yet: the first Next opens it
    if (s.runState === 'done' || s.runState === 'failed' || s.runState === 'waiting-human') return false;
    if (s.head === 'human.approve' && stepStatus(s, 'human.approve') !== 'done') return false;
    return stepIndex(s.head) < STEPS.length - 1 || stepStatus(s, s.head) !== 'done';
  }

  // ---------- lifecycle ----------
  async boot() {
    this.bindGlobal();
    try { this.state.scenario = await this.transport.loadScenario(); } catch { this.state.error = 'The case could not be loaded.'; }
    this.render();
    await this.startRun();
  }

  async startRun() {
    this.unsub?.(); this.unsub = null;
    this.gen++; this.ac?.abort(); this.ac = null; this.pending = false; this.retryAction = null; // a call still pending for the old run must not hold the new case back
    clearRun(this.state);
    this.closeWhy(); this.closeEdit(); this.replayResult = null; this.replayError = null;
    this.render();
    let runId;
    try { runId = await this.transport.createRun(); } catch (e) { this.state.error = netMessage(e, 'The run could not be started.'); this.retryAction = () => { void this.startRun(); }; this.render(); return; }
    this.state.runId = runId;
    this.unsub = this.transport.subscribe(runId, {
      open: () => {
        const scenario = this.state.scenario; clearRun(this.state); this.state.scenario = scenario; this.state.runId = runId; // the server replays history after (re)connect
        window.clearTimeout(this.autoTimer);
        this.autoTimer = window.setTimeout(() => { if (!this.state.head && !this.pending) void this.next(); }, 120); // intake is pure data: open the case for the user
        this.render();
      },
      event: (e) => { apply(this.state, e); this.render(); },
      error: () => { /* EventSource retries by itself; the replay on reconnect rebuilds the state */ },
    });
  }

  async reset() { await this.startRun(); if (this.guide?.active()) this.guide.start(); }

  // ---------- actions ----------
  async next() {
    if (this.pending || !this.canNext()) return;
    const gen = this.gen, ac = new AbortController();
    this.ac = ac; this.pending = true; this.state.view = null; this.state.error = null; this.retryAction = null; this.render();
    try { await this.transport.next(/** @type {string} */ (this.state.runId), ac.signal); }
    catch (e) { if (gen === this.gen) { this.state.error = /** @type {Error} */ (e).message; if (/** @type {any} */ (e).network) this.retryAction = () => { void this.next(); }; } }
    finally { if (gen === this.gen) { this.pending = false; this.ac = null; this.render(); } }
  }

  back() {
    const i = stepIndex(this.viewId());
    if (i > 0) { this.state.view = STEPS[i - 1].id; this.render(); }
  }

  /** @param {string | null} id */
  view(id) { this.state.view = id && id !== this.state.head ? /** @type {StepId} */ (id) : null; this.render(); }

  /** @param {'approved' | 'rejected'} decision */
  async approve(decision) {
    const s = this.state, rec = recommendation(s);
    const corrected = heldMessage(s);
    const gen = this.gen;
    this.pending = true; this.render();
    try {
      await this.transport.approve(/** @type {string} */ (s.runId), { approverId: /** @type {any} */ (s.scenario).approver.id, decision, subjectIds: [rec?.decisionId, corrected?.id].filter(/** @returns {x is string} */ (x) => !!x) });
    } catch (e) { if (gen === this.gen) { s.error = /** @type {Error} */ (e).message; if (/** @type {any} */ (e).network) this.retryAction = () => { void this.approve(decision); }; } }
    finally { if (gen === this.gen) { this.pending = false; this.render(); } }
  }
  get attestation() { return { approved: ATTEST_APPROVE, rejected: ATTEST_REJECT }; }

  /** @param {string} id */
  openWhy(id) {
    this.opener = /** @type {HTMLElement | null} */ (document.activeElement);
    this.whyId = id; this.render();
    queueMicrotask(() => $('[data-testid=why-close]')?.focus());
  }
  closeWhy() {
    if (!this.whyId) return;
    this.whyId = null; this.render();
    if (this.opener?.isConnected) this.opener.focus(); this.opener = null;
  }
  /** @param {'as-of-original' | 'with-current'} mode */
  async runReplay(mode) {
    this.replayBusy = mode; this.replayError = null; this.render();
    try { this.replayResult = await this.transport.replay({ decisionId: PRIOR_DECISION, mode }); }
    catch (e) { this.replayError = `Replay failed: ${/** @type {Error} */ (e).message}`; }
    finally { this.replayBusy = null; this.render(); }
  }

  /** @param {string} draftId */
  openEdit(draftId) { this.editing = draftId; this.render(); queueMicrotask(() => $('[data-testid=edit-body]')?.focus()); }
  closeEdit() { if (this.editing) { this.editing = null; this.render(); } }
  /** @param {string} draftId @param {string} body @param {string} channel */
  async sendEdit(draftId, body, channel) {
    const gen = this.gen;
    this.editing = null; this.pending = true; this.render();
    try { await this.transport.edit(/** @type {string} */ (this.state.runId), { draftId, body, channel }); }
    catch (e) { if (gen === this.gen) { this.state.error = /** @type {Error} */ (e).message; if (/** @type {any} */ (e).network) this.retryAction = () => { void this.sendEdit(draftId, body, channel); }; } }
    finally { if (gen === this.gen) { this.pending = false; this.render(); } }
  }

  toggleMode() {
    if (this.mode === 'explore') { this.mode = 'guided'; void this.startTour(); }
    else { this.mode = 'explore'; this.guide?.stop(); }
    this.render();
  }

  async startTour() {
    this.mode = 'guided';
    if (!this.guide) { const m = await import('./guide.js'); this.guide = m.createGuide(this); }
    this.guide.start(); this.render();
  }
  skipTour() { this.mode = 'explore'; this.guide?.stop(); this.render(); }

  /** Press Next until `id` is done (or, for the human gate, waiting). Same code path as the Next button. @param {StepId} id */
  async advanceTo(id) {
    const target = stepIndex(id);
    for (let guard = 0; guard < 40; guard++) {
      await this.until(() => !this.busy());
      const s = this.state, hi = stepIndex(s.head), st = s.head ? stepStatus(s, s.head) : 'pending';
      if (hi > target || (hi === target && (st === 'done' || (id === 'human.approve' && st === 'waiting')))) return;
      if (!this.canNext() && s.head) return; // waiting for a person
      await this.next();
      if (this.state.error) return;
    }
  }
  /** @param {() => boolean} pred @returns {Promise<void>} */
  until(pred) {
    if (pred()) return Promise.resolve();
    return new Promise((res) => { const l = () => { if (pred()) { this.listeners.delete(l); res(); } }; this.listeners.add(l); });
  }

  // ---------- rendering ----------
  render() {
    if (this.rendering) return;
    this.rendering = true;
    queueMicrotask(() => { this.rendering = false; this.paint(); });
  }

  paint() {
    const s = this.state, app = $('#app');
    if (!app) return;
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const key = active && active !== document.body ? focusKeyOf(active) : null;
    if (key) this.focusKey = key;
    app.dataset.ready = String(!!s.scenario && !!s.head);
    app.dataset.head = s.head ?? '';
    app.dataset.headStatus = s.head ? stepStatus(s, s.head) : '';
    app.dataset.runState = s.runState;
    app.dataset.busy = String(this.busy());
    app.dataset.view = this.viewId() ?? '';
    app.dataset.mode = this.mode;
    const part = (/** @type {string} */ id, /** @type {(el: HTMLElement) => void} */ fn) => { const el = $(id); if (el) fn(el); };
    part('#head', (el) => renderHeader(el, s, this));
    part('#member', (el) => renderMember(el, s));
    part('#stepper-wrap', (el) => renderStepper(el, s, this));
    const editorFocused = !!$('[data-testid=edit-body]') && document.activeElement === $('[data-testid=edit-body]');
    if (!editorFocused) part('#stage', (el) => { renderStage(el, s, this); if (s.error) el.prepend(h('div', { class: 'verdict verdict-block', role: 'alert', 'data-testid': 'error' }, s.error, this.retryAction ? [' ', h('button', { class: 'btn', type: 'button', 'data-testid': 'retry', on: { click: () => { const f = this.retryAction; this.state.error = null; this.retryAction = null; this.render(); f?.(); } } }, 'Try again')] : null)); });
    part('#why', (el) => renderWhy(el, s, this));
    part('#crm', (el) => renderCrm(el, s));
    part('#timeline-wrap', (el) => renderTimeline(el, s));
    part('#footer', (el) => renderFooter(el, s));
    app.classList.toggle('has-why', !!this.whyId);
    // keep keyboard focus where the user left it across re-renders
    if ((!document.activeElement || document.activeElement === document.body) && this.focusKey) {
      const el = $(`[data-focus="${this.focusKey}"]`);
      if (el && el.getAttribute('aria-disabled') !== 'true' && !(el instanceof HTMLButtonElement && el.disabled)) { el.focus(); this.focusKey = null; }
    }
    for (const l of [...this.listeners]) l();
    document.dispatchEvent(new CustomEvent('app:rendered'));
  }

  bindGlobal() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.whyId) { e.preventDefault(); e.stopPropagation(); this.closeWhy(); return; }
      if (this.editing) { this.closeEdit(); return; }
      if (this.guide?.active()) { e.preventDefault(); this.skipTour(); }
    });
  }
}

/** @param {HTMLElement} el */
function focusKeyOf(el) {
  const k = el.closest('[data-focus]');
  if (k) return k.getAttribute('data-focus');
  const t = el.getAttribute('data-testid');
  if (t && el.tagName === 'BUTTON') { el.setAttribute('data-focus', t); return t; }
  const step = el.closest('[data-step]');
  if (step && el.classList.contains('step-btn')) { const v = `step:${step.getAttribute('data-step')}`; el.setAttribute('data-focus', v); return v; }
  return null;
}

// ---------- boot ----------
async function main() {
  const q = new URLSearchParams(location.search);
  const guide = q.get('guide') === '1';
  const mode = q.get('mode') === 'explore' || !guide ? 'explore' : 'guided';
  let transport;
  if (q.get('fixture') === '1') {
    const { fixtureTransport } = await import('./transport-fixture.js');
    const d = q.get('delay');
    transport = await fixtureTransport({ variant: q.get('variant') ?? 'live', delayMs: d == null ? 1500 : Number(d) });
  } else transport = liveTransport();
  const app = new App(transport, { mode: guide ? 'guided' : mode, guide });
  /** @type {any} */ (window).__app = app;
  document.addEventListener('focusin', (e) => { const el = /** @type {HTMLElement} */ (e.target); if (el.getAttribute?.('data-testid') || el.classList?.contains('step-btn')) focusKeyOf(el); });
  startAutoQuitBeacon();
  await app.boot();
  if (guide) await app.startTour();
}
void main();
void setChildren;
