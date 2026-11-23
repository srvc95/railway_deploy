// Packaged demo only. When the server marks the page document (Server-Timing: siq-autoquit), this tab registers with a random id, sends a heartbeat every 15 s
// and a beacon when the page is hidden for good, so the demo's server can stop once the last tab is closed. A reload registers a new id at once.
// Anywhere else (npm start, tests, the user's own server) there is no mark and no request is made.

const HEARTBEAT_MS = 15000;

/** True when the server said this document runs in the packaged demo. */
export function isPackaged() {
  try {
    const nav = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0]);
    return !!nav?.serverTiming?.some((t) => t.name === 'siq-autoquit');
  } catch { return false; }
}

/** @param {{ packaged?: boolean }} [o] */
export function startAutoQuitBeacon(o = {}) {
  if (!(o.packaged ?? isPackaged())) return false;
  const id = `t${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  const body = () => JSON.stringify({ id });
  const post = (/** @type {string} */ path) => { try { void fetch(path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: body(), keepalive: true }).catch(() => { /* server gone */ }); } catch { /* no fetch */ } };
  const beat = () => post('/api/tab');
  const bye = () => {
    let sent = false;
    try { sent = !!navigator.sendBeacon?.('/api/bye', new Blob([body()], { type: 'text/plain' })); } catch { /* no beacon */ }
    if (!sent) post('/api/bye');
  };
  beat();
  setInterval(beat, HEARTBEAT_MS);
  window.addEventListener('pagehide', bye);
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) beat(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
  return true;
}
