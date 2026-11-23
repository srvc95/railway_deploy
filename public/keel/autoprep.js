// Autoprep (change demo-polish). Keel's core law is that the rep never asks first: the work is already prepared. So when a run starts, this module
// presses the four preparation steps itself, in order, through the same run.next() the buttons use: open the case, read the voicemail, check the plans
// (records + rules), draft the outreach (draft + compliance check). It stops there. Everything that needs a person (the agent's edit, the supervisor's
// approval) and everything after it stays a human click. The server still decides every step; this only replaces four clicks.
// Off with ?prep=0 (the old click-through mode). It runs again for every new run (\"+ New case\").
import { run } from './run.js';
import { scheduleRender } from './shell.js';

/** The steps autoprep presses, in run order. Each is the first step of a chain on the server. */
export const PREP_STEPS = /** @type {const} */ (['signal.intake', 'signal.interpret', 'memory.assemble', 'action.draft']);
/** What the home panel says for each, in plain words: while working, and when done. */
export const PREP_TEXT = /** @type {Record<string, { doing: string, done: string, layer: string }>} */ ({
  'signal.intake': { doing: 'Spotting the non-renewal and her voicemail', done: 'Spotted: her plan ends Dec 31 and she called last night', layer: 'signal' },
  'signal.interpret': { doing: 'Listening to her voicemail', done: 'Understood what she needs, in her own words', layer: 'signal' },
  'memory.assemble': { doing: 'Checking every 2027 plan in her county', done: 'Checked 5 plans against her doctors, drugs and budget', layer: 'decision' },
  'action.draft': { doing: 'Writing her email and checking it against the rules', done: 'Drafted her email and checked it against Medicare marketing rules', layer: 'action' },
});

const PAUSE_MS = 900;
/** Seconds the preparation took on the wall clock, or null when it was not timed here. */
export const prepSeconds = () => (prep.startedAt && prep.finishedAt ? Math.max(1, Math.round((prep.finishedAt - prep.startedAt) / 1000)) : null); // a beat between steps, so a room can follow what happens
const enabled = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('prep') !== '0';

export const prep = { active: false, runId: /** @type {string | null} */ (null), current: /** @type {string | null} */ (null), startedAt: 0, finishedAt: 0, enabled: enabled() };

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const status = (/** @type {string} */ id) => run.state.steps?.[id]?.status ?? 'pending';
/** Is the preparation finished for this run (the compliance check on the draft is done)? */
export const prepDone = () => status('action.gate') === 'done';

async function go() {
  const id = run.state.runId;
  if (!prep.enabled || !id || prep.runId === id) return;
  prep.runId = id; prep.active = true; prep.finishedAt = 0; prep.startedAt = 0;
  scheduleRender();
  await sleep(1200); // the room sees the morning screen before the agents start
  try {
    for (const step of PREP_STEPS) {
      if (run.state.runId !== id) return; // a new case started meanwhile: that run gets its own pass
      await run.until(() => !run.busy() || run.state.runId !== id || !!run.state.error);
      if (run.state.error) break;
      const nxt = run.nextStep();
      if (nxt !== step) { if (status(step) === 'done') continue; break; } // someone clicked ahead: never fight a person
      if (!prep.startedAt) prep.startedAt = Date.now();
      prep.current = step; scheduleRender();
      await run.next(step);
      if (run.state.error) break;
      prep.current = null; scheduleRender();
      await sleep(PAUSE_MS);
    }
  } finally {
    if (run.state.runId === id) { prep.active = false; prep.current = null; prep.finishedAt = prepDone() ? Date.now() - PAUSE_MS : 0; scheduleRender(); }
  }
}

if (typeof window !== 'undefined') {
  /** @type {any} */ (window).__siq = /** @type {any} */ (window).__siq ?? {};
  /** @type {any} */ (window).__siq.prep = prep;
  run.subscribe(() => {
    if (!prep.enabled || !run.state.runId || run.state.runId === prep.runId) return;
    if (run.nextStep() !== 'signal.intake' || run.busy()) return; // only a fresh run, never one already under way
    void go();
  });
}
