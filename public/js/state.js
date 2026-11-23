// Client state: one object, changed only by apply(state, RunEvent). Nothing here decides anything; it files what the server sent.
import { STEPS, stepIndex } from './steps.js';

/** @typedef {import('../../shared/contracts.ts').RunEvent} RunEvent */
/** @typedef {import('../../shared/contracts.ts').StepId} StepId */
/** @typedef {import('../../shared/contracts.ts').Fact} Fact */
/** @typedef {import('../../shared/contracts.ts').Relation} Relation */
/** @typedef {import('../../shared/contracts.ts').SourceRef} SourceRef */
/** @typedef {import('../../shared/contracts.ts').DecisionTrace} DecisionTrace */
/** @typedef {import('../../shared/contracts.ts').CommunicationDraft} CommunicationDraft */
/** @typedef {import('../../shared/contracts.ts').Approval} Approval */
/** @typedef {import('../../shared/contracts.ts').CrmWrite} CrmWrite */
/** @typedef {import('../../shared/contracts.ts').TimelineEntry} TimelineEntry */
/** @typedef {import('../../shared/contracts.ts').CycleTime} CycleTime */
/** @typedef {import('../../shared/contracts.ts').LlmCallRecord} LlmCallRecord */
/** @typedef {import('../../shared/contracts.ts').InterpretResult} InterpretResult */
/** @typedef {import('../../shared/contracts.ts').ScenarioView} ScenarioView */
/** @typedef {import('../../shared/contracts.ts').RunState} RunState */
/** @typedef {ScenarioView & { plans?: { id: string, name: string, type: string, contractPlanId: string, premiumMonthly: number }[] }} Scenario */
/** @typedef {LlmCallRecord & { result?: InterpretResult | CommunicationDraft, fallbackUsed?: boolean }} LlmEvent */
/**
 * @typedef {object} State
 * @property {Scenario | null} scenario
 * @property {string | null} runId
 * @property {RunState} runState
 * @property {string | null} demoNow
 * @property {Record<string, { status: 'started' | 'done' | 'waiting', at: string, headline?: string }>} steps
 * @property {StepId | null} head  furthest step the run has reached
 * @property {Fact[]} facts
 * @property {Relation[]} relations
 * @property {SourceRef[]} sources
 * @property {Record<string, LlmEvent>} llm  keyed by step
 * @property {DecisionTrace[]} decisions  in arrival order
 * @property {Record<string, CommunicationDraft>} drafts
 * @property {string[]} draftOrder
 * @property {Approval | null} approval
 * @property {CrmWrite[]} crm
 * @property {TimelineEntry[]} timeline
 * @property {CycleTime | null} cycle
 * @property {{ url: string, recordSha256: string, bytes: number } | null} audit
 * @property {string | null} error
 * @property {string | null} view  step shown in the stage (null: follow the head)
 */

/**
 * Chain groups (change polish-and-realism, D3): one press of the key runs the steps listed after it, in order, each with its own events.
 * The server's orchestrator and the fixture transport both follow this table; a test asserts that they agree.
 */
export const CHAINS = Object.freeze(/** @type {Record<string, readonly StepId[]>} */ ({
  'memory.assemble': ['decision.recommend'],
  'action.draft': ['action.gate'],
  'action.rep-edit': ['action.gate-recheck', 'human.approve'], // the chain ends with human.approve waiting, not done
  'action.monitor': ['signal.reply-interpret', 'decision.next-action'],
}));

/** The steps an approval with decision `approved` runs, in order (the closed loop). */
export const APPROVAL_CHAIN = Object.freeze(/** @type {StepId[]} */ (['action.compare', 'action.deliver', 'action.crm-log', 'action.task', 'action.escalate']));

/** The last step of the chain that a press of `step` runs (the step itself when it opens no chain). @param {StepId} step @returns {StepId} */
export const chainEnd = (step) => CHAINS[step]?.at(-1) ?? step;

/** @returns {State} */
export function createState() {
  return {
    scenario: null, runId: null, runState: 'idle', demoNow: null, steps: {}, head: null, facts: [], relations: [], sources: [], llm: {},
    decisions: [], drafts: {}, draftOrder: [], approval: null, crm: [], timeline: [], cycle: null, audit: null, error: null, view: null,
  };
}

/** Forget everything about the run (Reset, or an SSE reconnect that replays history). Keeps the scenario. @param {State} s */
export function clearRun(s) {
  const fresh = createState();
  Object.assign(s, fresh, { scenario: s.scenario });
}

/** Apply one RunEvent. @param {State} s @param {RunEvent} e @returns {State} */
export function apply(s, e) {
  switch (e.event) {
    case 'run':
      s.runId = e.data.runId; s.runState = e.data.state; s.demoNow = e.data.demoNow; break;
    case 'step': {
      s.steps[e.data.step] = { status: e.data.status, at: e.data.at, ...(e.data.headline ? { headline: e.data.headline } : {}) };
      if (stepIndex(e.data.step) >= stepIndex(s.head)) s.head = e.data.step;
      s.demoNow = e.data.at;
      break;
    }
    case 'facts': {
      const known = new Set(s.facts.map((f) => f.id));
      for (const f of e.data.facts) if (!known.has(f.id)) s.facts.push(f); else s.facts[s.facts.findIndex((x) => x.id === f.id)] = f;
      const rk = new Set(s.relations.map((r) => `${r.from}|${r.type}|${r.to}`));
      for (const r of e.data.relations) if (!rk.has(`${r.from}|${r.type}|${r.to}`)) s.relations.push(r);
      const sk = new Set(s.sources.map((x) => `${x.system}|${x.recordId}`));
      for (const x of e.data.sources) if (!sk.has(`${x.system}|${x.recordId}`)) s.sources.push(x);
      break;
    }
    case 'llm': s.llm[e.data.step] = e.data; break;
    case 'decision': {
      const i = s.decisions.findIndex((d) => d.decisionId === e.data.decisionId);
      if (i >= 0) s.decisions[i] = e.data; else s.decisions.push(e.data);
      break;
    }
    case 'draft':
      if (!s.drafts[e.data.id]) s.draftOrder.push(e.data.id);
      s.drafts[e.data.id] = e.data; break;
    case 'approval': s.approval = e.data; break;
    case 'crm': if (!s.crm.some((w) => w.seq === e.data.seq)) s.crm.push(e.data); break;
    case 'timeline': if (!s.timeline.some((t) => t.seq === e.data.seq)) s.timeline.push(e.data); break;
    case 'cycle': s.cycle = e.data; break;
    case 'audit': s.audit = e.data; break;
    case 'error': s.error = e.data.message; break;
  }
  return s;
}

// ---------- selectors (read-only helpers shared by the views) ----------

/** @param {State} s @param {string} id @returns {'pending' | 'started' | 'done' | 'waiting'} */
export const stepStatus = (s, id) => s.steps[id]?.status ?? 'pending';

/** True once the case has run to the end: the run says so, or the last step is done. @param {State} s */
export const caseFinished = (s) => s.runState === 'done' || s.steps['briefing.audit']?.status === 'done';

/** The exception case the run opened at its escalation step is a case in the CRM that stays open: nothing in this run closes it (final review 7.9, P2 e). @param {State} s */
export const exceptionCaseOpen = (s) => s.steps['action.escalate']?.status === 'done';
/** What is still open once the run is over, in the one wording Home and Members share: the retention case is complete, the exception case is not. @param {State} s */
export const openCasesText = (s) => (caseFinished(s) ? (exceptionCaseOpen(s) ? '1 exception case open' : 'No open case') : '1 open case');

/** The last time the case touched the member: the inbound message, the message sent, the member's reply. Read from the run's timeline, never from the clock. @param {State} s @param {string} inboundAt @returns {string} */
export function lastContactAt(s, inboundAt) {
  let at = inboundAt;
  for (const t of s.timeline ?? []) if ((t.step === 'action.deliver' || t.step === 'action.monitor') && t.at > at) at = t.at;
  return at;
}

/** The step the stage shows. @param {State} s */
export const viewStep = (s) => s.view ?? s.head;

/** True while a step has started and not finished (a live model call, or a system step). @param {State} s */
export const isRunning = (s) => !!s.head && s.steps[s.head]?.status === 'started';

/**
 * The step the next `next` request will run, or null when no request may be sent: the case is not loaded, a step is running, the run waits
 * for the human gate, or it has ended. Pure; the run store adds its own in-flight flag. @param {State} s @returns {StepId | null}
 */
export function nextStepId(s) {
  if (!s.scenario || !s.runId) return null;
  if (!s.head) return STEPS[0].id; // the case is not opened yet: the first next opens it
  if (s.runState === 'done' || s.runState === 'failed' || s.runState === 'waiting-human') return null;
  const st = stepStatus(s, s.head);
  if (st === 'started' && s.error && s.runState === 'running') return s.head; // the step failed (error event after started): the same press repeats it
  if (st === 'started' || st === 'waiting') return null;
  if (s.head === 'human.approve' && st !== 'done') return null;
  if (st === 'pending') return s.head; // cannot happen from events; keep the step the head names
  const i = stepIndex(s.head);
  return i < STEPS.length - 1 ? STEPS[i + 1].id : null;
}

/** @param {State} s @param {string} id */
export const factById = (s, id) => s.facts.find((f) => f.id === id) ?? s.decisions.flatMap((d) => d.facts).find((f) => f.id === id);

/** @param {State} s @param {DecisionTrace['kind']} kind */
export const decisionsOfKind = (s, kind) => s.decisions.filter((d) => d.kind === kind);

/** The message the gate holds for approval: the corrected draft, or the draft itself when the gate had nothing to change. @param {State} s */
export function heldMessage(s) {
  const t = [...s.decisions].reverse().find((d) => d.outcome.type === 'communication-gate' && d.outcome.verdict === 'held-for-approval');
  if (!t || t.outcome.type !== 'communication-gate') return null;
  return t.outcome.corrected ?? s.drafts[t.outcome.draftId] ?? null;
}

/** The recommendation trace of this run. @param {State} s */
export const recommendation = (s) => s.decisions.find((d) => d.kind === 'plan-recommendation') ?? null;

/** Display name for an ontology id (plan, provider, drug, facility, person), from the scenario. @param {State} s @param {string} id */
export function nameOf(s, id) {
  const sc = s.scenario;
  if (!sc) return id;
  const plan = sc.plans?.find((p) => p.id === id);
  if (plan) return plan.name;
  if (id === sc.currentPlan.id) return sc.currentPlan.name;
  const p = sc.providers.find((x) => x.id === id) ?? sc.facilities.find((x) => x.id === id);
  if (p) return p.name;
  const d = sc.prescriptions.find((x) => x.drugId === id);
  if (d) return d.name;
  if (id === sc.beneficiary.id) return sc.beneficiary.name.replace(/\b[A-Z][a-z]+ ["“”]([A-Z][a-z]+)["“”] ([A-Z][a-z]+)\b/, '$1 $2'); // short form on screen (labels.js memberName); the record keeps its own name
  if (id === sc.agent.id) return sc.agent.name;
  if (id === sc.approver.id) return sc.approver.name;
  const f = s.facts.find((x) => x.source.recordId === id);
  if (f) return f.source.label.replace(/^[^:]+:\s*/, '');
  // a county record id (county-lorain-oh) reads as its name
  const county = /^county-([a-z-]+)-[a-z]{2}$/.exec(id);
  return county ? `${county[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')} County` : id;
}

/** Latest LLM call for a step, with the honest status label inputs. @param {State} s @param {string} step */
export function llmFor(s, step) {
  const l = s.llm[step];
  if (!l) return null;
  return { ...l, status: l.fallbackUsed ? /** @type {const} */ ('fallback') : l.status };
}
