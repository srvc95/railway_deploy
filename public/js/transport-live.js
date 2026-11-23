// The real transport: REST + SSE exactly as listed under "HTTP API" in shared/contracts.ts. The fixture transport has the same shape,
// so switching between them is the ?fixture=1 query parameter and nothing else.

/** @typedef {import('../../shared/contracts.ts').RunEvent} RunEvent */
/** @typedef {import('../../shared/contracts.ts').ReplayRequest} ReplayRequest */
/** @typedef {import('../../shared/contracts.ts').ReplayResult} ReplayResult */
/** @typedef {import('../../shared/contracts.ts').AuditVerifyResult} AuditVerifyResult */
/** @typedef {import('./state.js').Scenario} Scenario */
/** @typedef {import('../../shared/contracts.ts').StoryView} StoryView */
/** @typedef {import('../../shared/contracts.ts').CoverageView} CoverageView */
/** @typedef {import('../../shared/contracts.ts').RulesView} RulesView */
/** @typedef {import('../../shared/contracts.ts').CrmRecord} CrmRecord */
/**
 * @typedef {object} Transport
 * @property {string} label
 * @property {() => Promise<Scenario>} loadScenario
 * @property {() => Promise<string>} createRun
 * @property {(runId: string, h: { event: (e: RunEvent) => void, open: () => void, error: () => void }) => () => void} subscribe
 * @property {(runId: string, signal?: AbortSignal) => Promise<void>} next
 * @property {(runId: string, body: { approverId: string, decision: 'approved' | 'rejected', subjectIds: string[] }) => Promise<void>} approve
 * @property {(runId: string, body: { draftId: string, body: string, channel: string }) => Promise<void>} edit
 * @property {(req: ReplayRequest) => Promise<ReplayResult>} replay
 * @property {(runId: string) => string} auditUrl
 * @property {(runId: string) => string} auditReportUrl  GET /api/runs/:id/audit/report
 * @property {(runId: string) => Promise<AuditVerifyResult>} auditVerify  GET /api/runs/:id/audit/verify
 * @property {() => Promise<StoryView>} loadStory  GET /api/story
 * @property {() => Promise<CoverageView>} loadCoverage  GET /api/scenario/:id/coverage
 * @property {() => Promise<RulesView>} loadRules  GET /api/rules
 * @property {(runId: string) => Promise<CrmRecord[]>} loadCrm  GET /api/runs/:id/crm
 */

export const EVENT_NAMES = ['run', 'step', 'facts', 'llm', 'decision', 'draft', 'approval', 'crm', 'timeline', 'cycle', 'audit', 'error'];
const SCENARIO_ID = 'hayes-2027';

/** @param {string} url @param {RequestInit} [init] */
async function call(url, init) {
  /** @type {Response} */ let res;
  try { res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init }); }
  catch (e) {
    if (/** @type {Error} */ (e).name === 'AbortError') throw e; // the page cancelled it on purpose
    // The browser's own text ("Failed to fetch") says nothing a viewer can act on.
    throw Object.assign(new Error('The demo server could not be reached. Check that it is still running, then try again.'), { network: true });
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.message ?? j.error ?? msg; } catch { /* no body */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** @returns {Transport} */
export function liveTransport() {
  return {
    label: 'live',
    loadScenario: () => call(`/api/scenario/${SCENARIO_ID}`),
    createRun: async () => (await call('/api/runs', { method: 'POST', body: JSON.stringify({ scenarioId: SCENARIO_ID }) })).runId,
    subscribe(runId, h) {
      const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
      es.onopen = () => h.open();
      for (const name of EVENT_NAMES) {
        es.addEventListener(name, (ev) => {
          const data = /** @type {MessageEvent} */ (ev).data;
          if (typeof data !== 'string') { h.error(); return; } // the connection-level 'error' event has no data
          try { h.event(/** @type {RunEvent} */ ({ event: name, data: JSON.parse(data) })); } catch { /* malformed event: ignored */ }
        });
      }
      es.onerror = () => h.error();
      return () => es.close();
    },
    next: async (runId, signal) => { await call(`/api/runs/${encodeURIComponent(runId)}/next`, { method: 'POST', body: '{}', ...(signal ? { signal } : {}) }); },
    approve: async (runId, body) => { await call(`/api/runs/${encodeURIComponent(runId)}/approve`, { method: 'POST', body: JSON.stringify(body) }); },
    edit: async (runId, body) => { await call(`/api/runs/${encodeURIComponent(runId)}/edit`, { method: 'POST', body: JSON.stringify(body) }); },
    replay: (req) => call('/api/replay', { method: 'POST', body: JSON.stringify(req) }),
    auditUrl: (runId) => `/api/runs/${encodeURIComponent(runId)}/audit.zip`,
    auditReportUrl: (runId) => `/api/runs/${encodeURIComponent(runId)}/audit/report`,
    auditVerify: (runId) => call(`/api/runs/${encodeURIComponent(runId)}/audit/verify`),
    loadStory: () => call('/api/story'),
    loadCoverage: () => call(`/api/scenario/${SCENARIO_ID}/coverage`),
    loadRules: () => call('/api/rules'),
    loadCrm: (runId) => call(`/api/runs/${encodeURIComponent(runId)}/crm`),
  };
}
