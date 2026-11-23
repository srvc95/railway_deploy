/* Copied from keel-prototype v1.2.3 public/prototype.js (helpers, nav, delegated clicks, toast), adapted for adopt-keel-shell */
// The Keel shell: sidebar, user card, toast, delegated data-act clicks and page rendering. Interface: notes/keel-shell-map.md sections 3 to 5.
// Pages are ES modules that return HTML strings (every dynamic value through esc()) and register themselves with registerPage().
import { startAutoQuitBeacon } from '../js/autoquit.js';
import { ACTOR_LABEL, LAYERS, STEPS, stepMeta } from '../js/steps.js';
import { PAGE_IDS, router } from './router.js';

/** @typedef {import('./router.js').PageId} PageId */
/** @typedef {'agent' | 'supervisor'} Role */
/** @typedef {{ id: PageId, title: string, render(ctx: Ctx): string, after?(el: HTMLElement, ctx: Ctx): void, acts?: Record<string, (el: HTMLElement, ctx: Ctx) => void>, dock?: 'home' | 'coach' | 'perf' }} PageDef */
/** @typedef {{ run: any, state: any, ui: any, role: Role, params: Record<string, string>, go: (page: PageId, params?: Record<string, string | undefined>) => void }} Ctx */

// ---------- helpers (copied) ----------
/** @param {unknown} s */
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c); }

const IC = /** @type {Record<string, string>} */ ({
  research: '<circle cx="8" cy="8" r="5"/><path d="M12 12l4 4"/>',
  proposal: '<path d="M5 2h6l3 3v11H5z"/><path d="M7.5 8h4M7.5 11h4"/>',
  coach: '<path d="M3 4h12v8H8l-3 3v-3H3z"/>',
  perf: '<path d="M3 15V9M8 15V4M13 15v-8"/>',
  home: '<path d="M3 8l6-5 6 5v7H3z"/>',
  members: '<circle cx="7" cy="6" r="2.6"/><path d="M2.5 15c0-2.6 2-4.2 4.5-4.2s4.5 1.6 4.5 4.2"/><path d="M12 4.2a2.4 2.4 0 010 4.6M13.5 11c1.6.5 2.5 1.9 2.5 4"/>',
  plans: '<path d="M5 2h6l3 3v11H5z"/><path d="M7.5 8h4M7.5 11h4"/>',
  crm: '<ellipse cx="9" cy="4.5" rx="5.5" ry="2.2"/><path d="M3.5 4.5v9c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2v-9M3.5 9c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2"/>',
  rules: '<path d="M9 2v14M4 5h10M4 5l-2 5a2.2 2.2 0 004 0zM14 5l-2 5a2.2 2.2 0 004 0zM6 16h6"/>',
});
/** @param {string} k */
export function ico(k) { return '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[k] ?? '') + '</svg>'; }

/** Page header. `right` is trusted HTML. `opts.sample` is accepted and ignored: the demo-data disclosure is one footer line, not a chip.
 * @param {string} title @param {string} sub @param {string} [right] @param {{ sample?: boolean }} [opts] */
export function top(title, sub, right, opts = {}) {
  return '<div class="top"><div><h1>' + title + '</h1><p>' + sub + '</p></div><div class="sp">' + (right || '') + '</div></div>';
}

/** Copied `.tabs` markup. tabs: [id, label][]; act is the data-act each button carries. @param {string} act @param {[string, string][]} tabs @param {string | null} current */
export function tabsHTML(act, tabs, current) {
  return '<div class="tabs" role="tablist">' + tabs.map(([id, label]) => '<button type="button" role="tab" data-act="' + esc(act) + '" data-v="' + esc(id) + '" aria-selected="' + (current === id) + '">' + esc(label) + '</button>').join('') + '</div>';
}

let toastTimer = 0;
/** @param {string} m */
export function toast(m) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = m; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = /** @type {any} */ (setTimeout(() => t.classList.remove('on'), 2400));
}

/** The one actor badge: colour from --layer-* tokens and the text says it too. @param {string} actor */
export function layerBadge(actor) { return '<span class="badge badge-' + esc(actor) + '" data-badge="' + esc(actor) + '">' + esc(ACTOR_LABEL[actor] ?? actor) + '</span>'; }

/** Agent tag for a step: the tag class and label from STEP_AGENT, exactly one layer badge from the step's actor in steps.js. @param {string} stepId */
export function agentTag(stepId) {
  const a = stepAgent(stepId);
  const actor = stepMeta(stepId)?.actor ?? 'system';
  return '<span class="tag ' + a.cls + '">' + esc(a.label) + '</span> ' + layerBadge(actor);
}
/** @param {string} id @returns {{ cls: string, label: string }} */
export function stepAgent(id) {
  if (id.startsWith('signal.') || id === 'memory.assemble') return { cls: 'research', label: 'Member Agent' };
  if (id === 'human.approve') return { cls: 'coach', label: 'Supervisor' };
  if (id === 'briefing.audit') return { cls: 'perf', label: 'Audit Agent' };
  if (id.startsWith('decision.')) return { cls: 'proposal', label: 'Plan Agent' };
  const n = STEPS.findIndex((s) => s.id === id);
  const lo = STEPS.findIndex((s) => s.id === 'action.draft'), mid = STEPS.findIndex((s) => s.id === 'action.gate-recheck');
  if (n >= lo && n <= mid) return { cls: 'proposal', label: 'Plan Agent' };
  return { cls: 'proposal', label: 'Workflow' };
}

/** The native button of a step (section 7): only while run.nextStep() is that step and run.canNext().
 * @param {Ctx} ctx @param {string} stepId @param {{ cls?: string, go?: string }} [opts] */
export function nativeButton(ctx, stepId, opts = {}) {
  const run = ctx.run;
  if (!run || run.nextStep?.() !== stepId || !run.canNext?.()) return '';
  const n = nativeTable()[stepId]; if (!n) return '';
  return '<button type="button" class="btn pri' + (opts.cls ? ' ' + esc(opts.cls) : '') + '" data-act="next" data-v="' + esc(stepId) + '" data-testid="' + esc(n.testid) + '"' + (opts.go ? ' data-go="' + esc(opts.go) + '"' : '') + '>' + esc(n.label) + '</button>';
}

// ---------- sidebar pieces (pure: input in, HTML out) ----------
export const NAV = /** @type {{ id: PageId, label: string, icon: string, color: string }[]} */ ([
  { id: 'home', label: 'Home', icon: 'home', color: 'var(--accent)' },
  { id: 'members', label: 'Members', icon: 'members', color: 'var(--research)' },
  { id: 'plans', label: 'Plan comparisons', icon: 'plans', color: 'var(--proposal)' },
  { id: 'coach', label: 'Agent Coach', icon: 'coach', color: 'var(--coach)' },
  { id: 'performance', label: 'Performance & audit', icon: 'perf', color: 'var(--perf)' },
  { id: 'crm', label: 'Sandbox CRM', icon: 'crm', color: 'var(--good)' },
  { id: 'rules', label: 'Rules & disclosures', icon: 'rules', color: 'var(--warn)' },
]);

/** @param {PageId} page current page; `member` highlights Members. @param {number | null} count Home feed items. */
export function navHTML(page, count) {
  const at = page === 'member' ? 'members' : page;
  return NAV.map((n) => '<button type="button" data-act="page" data-v="' + n.id + '" data-testid="nav-' + n.id + '"' + (at === n.id ? ' aria-current="page"' : '') + '><span style="color:' + n.color + ';display:grid">' + ico(n.icon) + '</span>' + esc(n.label) +
    (n.id === 'home' ? '<span class="count num" id="navcount" data-testid="navcount"' + (count == null ? ' hidden' : '') + '>' + esc(count ?? '') + '</span>' : '') + '</button>').join('');
}

/** The run's error as a banner outside #main (a request that failed or a server that went away), with Try again when a retry exists. @param {any} run */
export function alertHTML(run) {
  const msg = run?.state?.error;
  if (!msg) return '';
  return '<div class="run-alert" data-testid="error" role="alert"><p>' + esc(msg) + '</p>' + (run.canRetry?.() ? '<button type="button" class="btn" data-act="retry" data-testid="retry">Try again</button>' : '') + '</div>';
}

/** The Action row is SYSTEM (deliver, log, task, escalate); it shows HUMAN only while the run waits at the approval step (S10, P2). @param {any} state run state @returns {boolean} */
export const waitingForHuman = (state) => state?.head === 'human.approve' && state?.steps?.['human.approve']?.status === 'waiting';

/** @param {Record<string, string> | null | undefined} states Layer -> done | active | waiting (run.layerStates()) @param {{ human?: boolean }} [opts] human: the run waits for a person right now */
export function layersHTML(states, opts = {}) {
  return '<h5>Agents at work</h5><div class="mini" data-testid="layers">' + LAYERS.map((l) => {
    const st = states?.[l.id] ?? 'waiting';
    return '<div class="lyr" data-layer="' + l.id + '" data-state="' + st + '">' + (st === 'active' ? '<i class="live"></i>' : '<i class="st"></i>') +
      '<span>' + esc(l.name) + '<span class="sr">, ' + st + '</span></span>' + layerBadge(l.id === 'action' && opts.human ? 'human' : l.actor) + '</div>';
  }).join('') + '</div>';
}

const SOURCE_LABEL = /** @type {Record<string, string>} */ ({
  'plan-landscape': 'Plan landscape', formulary: 'Formulary', 'provider-directory': 'Provider directory', enrollment: 'Enrollment',
  crm: 'CRM records', comms: 'Communications', consent: 'Consent records', 'cms-params': 'CMS parameters',
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "as of Oct 15" read from a snapshot id such as snap-2026-10-15-py2027; null when the id carries no date (never invented). @param {string} id */
export function asOfFromId(id) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(id); if (!m) return null;
  return MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

/** "Connected": three one-line rows. Plan data with its date, the rule pack and the Sandbox CRM; the snapshot id and the source systems are in the row's title.
 * @param {{ sources?: { system: string, snapshotId: string }[], packId?: string } | null | undefined} scenario */
export function sourcesHTML(scenario) {
  /** @type {Map<string, string[]>} */ const groups = new Map();
  for (const s of scenario?.sources ?? []) {
    const label = SOURCE_LABEL[s.system];
    if (!label || !s.snapshotId.startsWith('snap-')) continue;
    const list = groups.get(s.snapshotId) ?? [];
    if (!list.includes(label)) list.push(label);
    groups.set(s.snapshotId, list);
  }
  const snaps = [...groups.keys()];
  const asOf = snaps.map(asOfFromId).find(Boolean) ?? null;
  const detail = [...groups].map(([snap, systems]) => snap + ' · ' + systems.join(', ')).join('; ');
  const pack = scenario?.packId ? String(scenario.packId).replace(/^pack-/, '') : '2026.2';
  const rows = [
    '<div class="src" data-source="plan-data"' + (detail ? ' title="' + esc(detail) + '"' : '') + '><b>Plan data' + (asOf ? ' · ' + esc(asOf) : '') + '</b></div>',
    '<button type="button" class="src" data-act="page" data-v="rules" data-source="rules" title="Open Rules &amp; disclosures"><b>Rule pack ' + esc(pack) + '</b></button>',
    '<button type="button" class="src" data-act="page" data-v="crm" data-source="crm-sandbox" title="Open the Sandbox CRM"><b>Sandbox CRM · simulated</b></button>',
  ];
  return '<h5>Connected</h5><div class="mini" data-testid="sources">' + rows.join('') + '</div>';
}
const PEOPLE = /** @type {Record<Role, { initials: string, name: string, title: string }>} */ ({
  agent: { initials: 'JP', name: 'Ryan Mitchell', title: 'Licensed agent' },
  supervisor: { initials: 'DW', name: 'Carol Sutton', title: 'Sales supervisor' },
});
/** @param {Role} role */
export function userCardHTML(role) {
  const p = PEOPLE[role] ?? PEOPLE.agent;
  const btn = (/** @type {Role} */ v, /** @type {string} */ label) => '<button type="button" data-act="role" data-v="' + v + '" data-testid="role-' + v + '" aria-pressed="' + (role === v) + '">' + label + '</button>';
  return '<div class="who" data-testid="user-card"><div class="av">' + p.initials + '</div><div><b>' + esc(p.name) + '</b><div class="small muted">' + esc(p.title) + '</div></div></div>' +
    '<div class="seg" role="group" aria-label="View as">' + btn('agent', 'Agent') + btn('supervisor', 'Supervisor') + '</div>';
}

// ---------- registry, run store, context ----------
/** @type {Map<string, PageDef>} */ const pages = new Map();
/** @param {PageDef} def */
export function registerPage(def) { pages.set(def.id, def); scheduleRender(); }

/** A minimal run store used only when public/keel/run.js (S2) is not on the page yet: the shell, the role toggle and navigation work, nothing is sent. */
function stubRun() {
  const subs = new Set();
  const o = {
    state: { scenario: null, steps: {}, head: null }, ui: { role: 'agent', whyId: null }, views: { scenario: null }, stub: true,
    boot() {}, reset() { fire('reset'); }, next() { return Promise.resolve(); },
    setRole(/** @type {Role} */ r) { o.ui.role = r; fire('ui'); }, openWhy() {}, closeWhy() {},
    canNext: () => false, busy: () => false, nextStep: () => null, layerStates: () => ({ signal: 'waiting', memory: 'waiting', decision: 'waiting', action: 'waiting', briefing: 'waiting' }),
    subscribe(/** @type {(r: string) => void} */ fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  /** @param {string} r */
  function fire(r) { subs.forEach((f) => f(r)); document.dispatchEvent(new CustomEvent('siq:run', { detail: { reason: r } })); }
  return o;
}

/** @type {any} */ let run = null;
/** @type {Record<string, { label: string, testid: string }>} */ let NATIVE_TABLE = {};
const nativeTable = () => NATIVE_TABLE;
/** Test hook: install the NATIVE table without run.js. @param {Record<string, { label: string, testid: string }>} t */
export function setNativeTable(t) { NATIVE_TABLE = t; }
let navCount = /** @type {number | null} */ (null);
/** The sidebar badge is the number of things waiting on a person (null hides it). A page registers where the number comes from, so it follows the run on every screen. @type {((ctx: Ctx) => number | null) | null} */
let navCountSource = null;
/** @param {(ctx: Ctx) => number | null} fn */
export function setNavCountSource(fn) { navCountSource = fn; }
/** Set the badge directly (null hides it). @param {number | null} n */
export function setNavCount(n) { navCount = n; const el = document.getElementById('navcount'); if (el) { el.textContent = n == null ? '' : String(n); el.toggleAttribute('hidden', n == null); } }

/** @returns {Ctx} */
function makeCtx() {
  const cur = router.current();
  return { run, state: run.state, ui: run.ui, role: run.ui?.role === 'supervisor' ? 'supervisor' : 'agent', params: cur.params, go: router.go };
}

// ---------- rendering ----------
const PLACEHOLDER_TITLE = Object.fromEntries(NAV.map((n) => [n.id, n.label]));
PLACEHOLDER_TITLE.member = 'Member detail';
/** @param {PageId} id @returns {PageDef} */
function placeholder(id) {
  return { id, title: PLACEHOLDER_TITLE[id] ?? 'Keel', render: () => top(esc(PLACEHOLDER_TITLE[id] ?? id), 'This screen is not available yet.') + '<div class="card pad pageload" data-testid="page-placeholder">Nothing to show here yet.</div>' };
}

let lastKey = '';
let queued = false;
export function scheduleRender() {
  if (queued || typeof document === 'undefined' || !run) return; queued = true;
  let done = false; const go = () => { if (done) return; done = true; queued = false; render(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  setTimeout(go, 60); // rAF does not fire in a hidden tab
}

/** @returns {string | null} a selector for the focused control, so a re-render can give focus back */
function focusKey() {
  const a = document.activeElement; if (!a || a === document.body || !a.closest('#app')) return null;
  const d = /** @type {HTMLElement} */ (a).dataset;
  if (d.testid) return `[data-testid="${CSS.escape(d.testid)}"]`;
  if (d.act) return `[data-act="${CSS.escape(d.act)}"]` + (d.v ? `[data-v="${CSS.escape(d.v)}"]` : '');
  return null;
}

export function render() {
  if (!run) return;
  queued = false;
  const { page, params } = router.current();
  const def = pages.get(page) ?? placeholder(page);
  const key = page + '|' + JSON.stringify(params);
  const fk = focusKey();
  const $ = (/** @type {string} */ s) => document.querySelector(s);
  const html = (/** @type {string} */ s, /** @type {string} */ h) => { const el = $(s); if (el) el.innerHTML = h; };
  const sc = run.views?.scenario ?? run.state?.scenario ?? null;
  html('#alert', alertHTML(run));
  html('#nav', navHTML(page, navCountSource ? navCountSource(makeCtx()) : navCount));
  html('#layers', layersHTML(run.layerStates?.(), { human: waitingForHuman(run.state) }));
  html('#sources', sourcesHTML(sc));
  html('#me', userCardHTML(run.ui?.role === 'supervisor' ? 'supervisor' : 'agent'));
  const main = /** @type {HTMLElement | null} */ ($('#main')); if (!main) return;
  let wrap = /** @type {HTMLElement | null} */ (main.querySelector(':scope > .wrap'));
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'wrap'; main.replaceChildren(wrap); }
  const ctx = makeCtx();
  let body;
  try { body = def.render(ctx); } catch (e) { console.error(e); body = top('Something went wrong', 'This screen could not be drawn.') + '<div class="card pad" role="alert">Reload the page to try again.</div>'; }
  wrap.innerHTML = body;
  if (key !== lastKey) { main.scrollTop = 0; lastKey = key; }
  document.title = def.title + ' | Keel';
  try { def.after?.(wrap, ctx); } catch (e) { console.error(e); }
  if (fk) { const n = /** @type {HTMLElement | null} */ (document.querySelector('#app ' + fk)); n?.focus({ preventScroll: true }); }
  document.dispatchEvent(new CustomEvent('siq:render', { detail: { page, params } }));
}

// ---------- delegated clicks (copied ACT table) ----------
const ACT = /** @type {Record<string, (el: HTMLElement) => void | Promise<void>>} */ ({
  page: (e) => router.go(/** @type {PageId} */ (e.dataset.v)),
  member: (e) => router.go('member', { id: e.dataset.v, tab: e.dataset.x || 'overview' }),
  tab: (e) => { const c = router.current(); router.go(c.page, { ...c.params, tab: e.dataset.v }); },
  role: (e) => {
    const r = e.dataset.v === 'supervisor' ? 'supervisor' : 'agent';
    run.setRole(r);
    if (document.body.dataset.guide !== 'on') toast(r === 'supervisor' ? 'Viewing as Carol Sutton, sales supervisor' : 'Viewing as Ryan Mitchell, licensed agent'); // the tour's own ticks say it while the tour runs, and the toast would sit over its popover
  },
  newcase: () => { run.reset(); router.go('home'); scheduleRender(); },
  next: async (e) => {
    const go = e.dataset.go;
    try { await run.next(); } catch (err) { toast(String(/** @type {Error} */ (err)?.message ?? err)); return; }
    if (go) location.hash = go.startsWith('#') ? go : '#' + go;
  },
  retry: () => { void run.retry?.(); },
  why: (e) => run.openWhy(e.dataset.v),
  toastmsg: (e) => toast(e.dataset.v ?? ''),
});

/** @param {HTMLElement} el @returns {boolean} true when the act was handled here */
function dispatch(el) {
  const name = el.dataset.act ?? '';
  const shell = ACT[name];
  if (shell) { void shell(el); return true; }
  const ctx = makeCtx();
  const def = pages.get(router.current().page);
  const fn = def?.acts?.[name] ?? [...pages.values()].map((p) => p.acts?.[name]).find(Boolean);
  if (fn) { fn(el, ctx); return true; }
  return false;
}

function wire() {
  document.addEventListener('click', (ev) => {
    const el = /** @type {HTMLElement | null} */ ((/** @type {Element} */ (ev.target)).closest?.('[data-act]'));
    if (el && dispatch(el)) ev.stopPropagation();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const t = /** @type {HTMLElement} */ (ev.target);
    if (t.tagName === 'TR' && t.dataset.act) dispatch(t);
  });
}

// ---------- boot ----------
export async function boot() {
  try {
    const RUN_MODULE = './run.js'; // S2 owns it; a variable keeps the checker from resolving a file that may not exist yet
    const m = await import(RUN_MODULE);
    run = m.run; NATIVE_TABLE = m.NATIVE ?? {};
  } catch (e) { if (!/Failed to fetch|Importing a module|404|not found/i.test(String(e))) console.warn("run.js not loaded, using the shell stub:", e); run = stubRun(); }
  /** @type {any} */ (window).__siq = {
    get S() { const c = router.current(); return { page: c.page, params: c.params, role: run.ui?.role === 'supervisor' ? 'supervisor' : 'agent' }; },
    render: scheduleRender, run, router,
  };
  const LIVE_ASK = './live-ask.js'; // a variable keeps the checker out of the copied, untyped transport
  void import(LIVE_ASK).catch((e) => console.warn('live-ask.js not loaded:', e)); // the dock's transport to POST /api/ask; it reads window.__siq, so it loads after it is set
  wire();
  router.onChange(() => render());
  run.subscribe?.(() => scheduleRender());
  startAutoQuitBeacon();
  // Page modules register themselves on import; a missing one leaves the placeholder.
  await Promise.all(['home', 'members', 'member', 'plans', 'coach', 'performance', 'crm', 'rules'].map((p) => import(`./pages/${p}.js`).catch(() => null)));
  router.start();
  try { await run.boot?.(); } catch (e) { console.error(e); }
  render();
  document.body.dataset.ready = 'true';
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !(/** @type {any} */ (window)).__SIQ_NO_BOOT__) void boot();

export { PAGE_IDS };
