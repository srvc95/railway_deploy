// Fixture transport (?fixture=1): plays the RunEvents of tests/support/ui-fixtures/run.ts, served at /fixtures/run.json, with the same
// pacing rules as the real server (one press per Next: a step, or a chain group; 409 while waiting for the human, approval required;
// an approval plays the five post-approval steps). The read-only views
// (story, coverage, rules, CRM records) come from the fixture server's /api/ routes, in the contract shapes. Development and tests only.

/** @typedef {import('./transport-live.js').Transport} Transport */
/** @typedef {import('../../shared/contracts.ts').RunEvent} RunEvent */
/** @typedef {import('../../shared/contracts.ts').CrmRecord} CrmRecord */
import { APPROVAL_CHAIN, CHAINS } from './state.js';

/** @param {string} url */
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
  return res.json();
}

/** The records after the writes the run has played so far (the fixture server returns the records before any write). @param {CrmRecord[]} base @param {RunEvent[]} history @returns {CrmRecord[]} */
function crmNow(base, history) {
  /** @type {Map<string, CrmRecord>} */
  const recs = new Map(base.map((r) => [`${r.objectType}:${r.id}`, { ...r, fields: { ...r.fields } }]));
  for (const e of history) {
    if (e.event !== 'crm') continue;
    const w = e.data, key = `${w.objectType}:${w.recordId}`, cur = recs.get(key);
    if (cur) cur.fields = { ...cur.fields, ...w.after };
    else recs.set(key, { objectType: w.objectType, id: w.recordId, fields: { ...w.after } });
  }
  return [...recs.values()];
}

/** @param {{ variant: string, delayMs: number }} opts @returns {Promise<Transport>} */
export async function fixtureTransport({ variant, delayMs }) {
  const fx = await getJson(`/fixtures/run.json?variant=${encodeURIComponent(variant)}`);
  /** @type {Set<(e: RunEvent) => void>} */
  const sinks = new Set();
  /** @type {RunEvent[]} */
  let history = [];
  let idx = 0, waitingHuman = false, ended = false, busy = false;
  /** Bumped by every createRun: a call still playing for an older run stops emitting. */
  let epoch = 0;
  /** The run id the page sees: a fresh one per createRun, as the real server gives, so a Reset is visible. */
  let curId = fx.runId;
  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
  /** @param {RunEvent} e */
  const emit = (e) => { const d = /** @type {any} */ (e.data); if (d && d.runId) e = /** @type {RunEvent} */ ({ ...e, data: { ...d, runId: curId } }); history.push(e); for (const s of sinks) s(e); };

  /** Emit the events of one entry; slow (live-model) steps pause after `started`. Stops when the run was replaced or the caller aborted. @param {RunEvent[]} events @param {boolean} slow @param {AbortSignal} [signal] */
  async function play(events, slow, signal) {
    const mine = epoch;
    for (let i = 0; i < events.length; i++) {
      if (mine !== epoch || signal?.aborted) return;
      emit(events[i]);
      const e = events[i];
      if (e.event === 'step' && e.data.status === 'started') await sleep(slow ? delayMs : Math.min(delayMs, 40));
      else if (delayMs > 0) await sleep(5);
    }
  }
  const err = (/** @type {number} */ status, /** @type {string} */ m) => Object.assign(new Error(m), { status });

  return {
    label: 'fixture',
    loadScenario: async () => fx.scenario,
    createRun: async () => { epoch++; history = []; idx = 0; waitingHuman = false; ended = false; busy = false; curId = epoch === 1 ? fx.runId : `${fx.runId}-${epoch}`; return curId; },
    subscribe(_runId, h) {
      const sink = (/** @type {RunEvent} */ e) => h.event(e);
      queueMicrotask(() => { h.open(); for (const e of history) h.event(e); sinks.add(sink); });
      return () => { sinks.delete(sink); };
    },
    async next(_runId, signal) {
      if (waitingHuman) throw err(409, 'Waiting for the human approval');
      if (ended || idx >= fx.steps.length) throw err(409, 'The run has finished');
      if (busy) throw err(409, 'A step is still running');
      busy = true;
      const mine = epoch;
      const entry = fx.steps[idx++];
      try {
        // one press = the step and the steps its chain group adds (the same table the server's orchestrator follows)
        const played = [entry, ...(CHAINS[entry.step] ?? []).map(() => fx.steps[idx++])];
        for (const e of played) {
          await play(e.events, !!e.slow, signal);
          if (mine !== epoch || signal?.aborted) return;
        }
        if (played.some((e) => e.waitsForHuman)) waitingHuman = true; // a chain can end at the approval (Request changes routes the message)
        if (idx >= fx.steps.length) ended = true;
      } finally { if (mine === epoch) busy = false; }
    },
    async approve(_runId, body) {
      if (!waitingHuman) throw err(409, 'No approval is pending');
      waitingHuman = false;
      if (body.decision === 'rejected') { ended = true; await play(fx.reject, false); return; }
      const mine = epoch;
      await play(fx.approve, false);
      for (const _ of APPROVAL_CHAIN) { // the approval runs the closed loop
        if (mine !== epoch) return;
        const e = fx.steps[idx++];
        await play(e.events, false);
      }
    },
    async edit() {
      if (idx < 8) throw err(409, 'The agent edit comes after the draft has passed the first gate');
      await play(fx.edit, false);
    },
    async replay(req) {
      await sleep(Math.min(delayMs, 300));
      return fx.replay[req.mode];
    },
    auditUrl: (runId) => `/api/runs/${runId}/audit.zip`,
    auditReportUrl: (runId) => `/api/runs/${runId}/audit/report`,
    auditVerify: async () => ({ ok: true, files: 6, manifestSha256: fx.auditManifestSha256 ?? '0'.repeat(64) }),
    loadStory: () => getJson('/api/story'),
    loadCoverage: () => getJson(`/api/scenario/${fx.scenario.id}/coverage`),
    loadRules: () => getJson('/api/rules'),
    loadCrm: async (runId) => crmNow(await getJson(`/api/runs/${encodeURIComponent(runId)}/crm`), history),
  };
}
