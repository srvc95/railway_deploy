import { dateLong } from '../ui/format.js';

// Static step metadata for the stepper (architecture.md section 3). Titles and actors are labels, not data: the run itself is
// driven by RunEvents from the server.

/** @typedef {import('../../shared/contracts.ts').StepId} StepId */
/** @typedef {import('../../shared/contracts.ts').Actor} Actor */
/** @typedef {import('../../shared/contracts.ts').Layer} Layer */
/** @typedef {{ id: StepId, n: number, layer: Layer, actor: Actor, title: string, short: string }} StepMeta */

/** @type {StepMeta[]} */
export const STEPS = [
  { id: 'signal.intake', layer: 'signal', actor: 'data', title: 'Case opened', short: 'Intake' },
  { id: 'signal.interpret', layer: 'signal', actor: 'ai', title: 'Voicemail read', short: 'Read' },
  { id: 'memory.assemble', layer: 'memory', actor: 'data', title: 'Records assembled', short: 'Records' },
  { id: 'decision.recommend', layer: 'decision', actor: 'rules', title: 'Plan recommended', short: 'Recommend' },
  { id: 'action.draft', layer: 'action', actor: 'ai', title: 'Outreach drafted', short: 'Draft' },
  { id: 'action.gate', layer: 'action', actor: 'rules', title: 'Draft checked', short: 'Gate' },
  { id: 'action.rep-edit', layer: 'action', actor: 'human', title: 'Agent edit', short: 'Edit' },
  { id: 'action.gate-recheck', layer: 'action', actor: 'rules', title: 'Edit re-checked', short: 'Re-check' },
  { id: 'human.approve', layer: 'action', actor: 'human', title: 'Supervisor approval', short: 'Approve' },
  { id: 'action.compare', layer: 'action', actor: 'system', title: 'Comparison generated', short: 'Compare' },
  { id: 'action.deliver', layer: 'action', actor: 'system', title: 'Email delivered', short: 'Deliver' },
  { id: 'action.crm-log', layer: 'action', actor: 'system', title: 'Activity logged', short: 'Log' },
  { id: 'action.task', layer: 'action', actor: 'system', title: 'Follow-up task created', short: 'Task' },
  { id: 'action.escalate', layer: 'action', actor: 'system', title: 'Exception case opened', short: 'Escalate' },
  { id: 'action.monitor', layer: 'action', actor: 'system', title: 'Member reply', short: 'Reply' },
  { id: 'signal.reply-interpret', layer: 'signal', actor: 'ai', title: 'Reply read', short: 'Read reply' },
  { id: 'decision.next-action', layer: 'decision', actor: 'rules', title: 'Next action set', short: 'Next action' },
  { id: 'briefing.audit', layer: 'briefing', actor: 'data', title: 'Audit package built', short: 'Audit' },
].map((s, i) => /** @type {StepMeta} */ ({ ...s, n: i + 1 }));

export const STEP_IDS = STEPS.map((s) => s.id);
/** @param {string | null | undefined} id */
export const stepIndex = (id) => (id ? STEP_IDS.indexOf(/** @type {StepId} */ (id)) : -1);
/** @param {string | null | undefined} id */
export const stepMeta = (id) => STEPS[stepIndex(id)];

export const ACTOR_LABEL = /** @type {Record<string, string>} */ ({ ai: 'AI', data: 'DATA', rules: 'RULES', human: 'HUMAN', system: 'SYSTEM' });
export const LAYERS = /** @type {{ id: Layer, name: string, actor: string }[]} */ ([
  { id: 'signal', name: 'Signal', actor: 'ai' }, { id: 'memory', name: 'Memory', actor: 'data' }, { id: 'decision', name: 'Decision', actor: 'rules' },
  { id: 'action', name: 'Action', actor: 'system' }, { id: 'briefing', name: 'Briefing', actor: 'data' },
]);

/**
 * The one provenance line of each step card: who produced what is on the card. `actor` is the layer badge, `parts` the muted text after it.
 * The AI/rules boundary is carried by this line, the layer badge and the stepper, never by a sentence. A part equal to `LLM_PART` is replaced by the
 * live / fallback status of the model call. @typedef {{ actor: Actor, parts: string[] }} Provenance
 */
export const LLM_PART = '\u00a7llm\u00a7';

/** The day the plan data was published, from its snapshot id ("snap-2026-10-15-py2027" is Oct 15, 2026). @param {any} s */
export function planDataDate(s) {
  const id = s.decisions?.[0]?.snapshot?.id ?? s.scenario?.snapshotId ?? '';
  const m = /(\d{4}-\d{2}-\d{2})/.exec(id);
  return m ? dateLong(m[1]) : '';
}
/** "Rule pack 2026.2" and "Plan data Oct 15, 2026", as far as the run knows them. @param {any} s */
const packParts = (s) => {
  const v = s.decisions?.[0]?.pack?.version, d = planDataDate(s);
  return [v ? `Rule pack ${v}` : '', d ? `Plan data ${d}` : ''].filter(Boolean);
};
/** "licensed agent" from the role id. @param {string} role */
const roleWords = (role) => String(role ?? '').replace(/-/g, ' ');
/** @param {any} s @param {string[]} [lead] */
const rulesP = (s, lead = ['Decided by rules']) => ({ actor: /** @type {Actor} */ ('rules'), parts: [...lead, ...packParts(s)] });
/** @param {string} verb @param {any} hasCall */
const aiP = (verb, hasCall) => ({ actor: /** @type {Actor} */ ('ai'), parts: [verb, ...(hasCall ? [LLM_PART] : []), 'Checked by rules'] });
/** @param {string} text */
const systemP = (text) => ({ actor: /** @type {Actor} */ ('system'), parts: [text] });

/** @type {Record<string, (s: any, llm: any) => Provenance>} */
export const PROVENANCE = {
  'signal.intake': (s) => ({ actor: 'data', parts: ['Case records', ...(planDataDate(s) ? [`Plan data ${planDataDate(s)}`] : [])] }),
  'signal.interpret': (_s, llm) => aiP('Read by AI', llm),
  'memory.assemble': (s) => ({ actor: 'data', parts: ['Dated records', ...(planDataDate(s) ? [`Plan data ${planDataDate(s)}`] : [])] }),
  'decision.recommend': (s) => rulesP(s),
  'action.draft': (_s, llm) => aiP('Drafted by AI', llm),
  'action.gate': (s) => rulesP(s),
  'action.rep-edit': (s) => ({ actor: 'human', parts: [`Decided by ${s.scenario?.agent?.name ?? 'the agent'}, ${roleWords(s.scenario?.agent?.role ?? 'licensed-agent')}`] }),
  'action.gate-recheck': (s) => rulesP(s),
  'human.approve': (s) => {
    const who = s.approval?.approver ?? s.scenario?.approver;
    return { actor: 'human', parts: [`${s.approval || s.steps?.['human.approve']?.status === 'done' ? 'Decided by' : 'Waiting for'} ${who?.name ?? 'the supervisor'}, ${roleWords(who?.role ?? 'sales-supervisor')}`] };
  },
  'action.compare': () => systemP('After approval'),
  'action.deliver': () => systemP('After approval'),
  'action.crm-log': () => systemP('After approval'),
  'action.task': () => systemP('After approval'),
  'action.escalate': () => systemP('After approval'),
  'action.monitor': () => systemP('Member reply received'),
  'signal.reply-interpret': (_s, llm) => aiP('Read by AI', llm),
  'decision.next-action': (s) => rulesP(s),
  'briefing.audit': () => ({ actor: 'data', parts: ['Run record', 'SHA-256'] }),
};

/** @param {string} status LlmCallRecord.status */
export const LLM_STATUS_TEXT = (status) =>
  status === 'fallback' ? 'Offline backup answer' : status === 'live-after-retry' ? 'Live (retried)' : 'Live';

/** In-progress copy for steps that wait on a live model call (3 to 17 seconds). */
export const PROGRESS = /** @type {Record<string, string>} */ ({
  'signal.interpret': 'Reading the voicemail',
  'action.draft': 'Drafting the outreach',
  'signal.reply-interpret': 'Reading her reply',
});
