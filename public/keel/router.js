// Hash router for the Keel shell (interface: notes/keel-shell-map.md section 5).
// Pure helpers (parseHash, formatHash) plus a factory so tests can run without a browser; the module-level instance is the one the app uses.

/** @typedef {'home'|'members'|'member'|'plans'|'coach'|'performance'|'crm'|'rules'} PageId */
/** @typedef {{ page: PageId, params: Record<string, string> }} Route */

export const PAGE_IDS = /** @type {PageId[]} */ (['home', 'members', 'member', 'plans', 'coach', 'performance', 'crm', 'rules']);
export const MEMBER_TABS = ['overview', 'coverage', 'relationships', 'comms', 'workflow', 'outreach'];
export const PERFORMANCE_TABS = ['decisions', 'approvals', 'audit'];
export const CRM_TABS = ['record', 'activity', 'tasks', 'cases', 'log'];

const dec = (/** @type {string} */ s) => { try { return decodeURIComponent(s); } catch { return s; } };
/** The address bar says dottie-hayes; the data keeps its stored id ben-hayes (hashed records). Both hashes open her page. */
const URL_ALIAS = /** @type {Record<string, string>} */ ({ 'dottie-hayes': 'ben-hayes' });
const URL_NAME = /** @type {Record<string, string>} */ ({ 'ben-hayes': 'dottie-hayes' });

/**
 * Hash to route. Unknown or malformed hashes give null (the caller goes home without counting a screen change).
 * @param {string} hash  with or without the leading #
 * @returns {Route | null}
 */
export function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [head = '', a, b] = raw.split('/').map(dec);
  const one = (/** @type {string[]} */ tabs, /** @type {string | undefined} */ v, /** @type {string} */ dflt) => (v && tabs.includes(v) ? v : dflt);
  switch (head) {
    case 'home': case 'members': case 'coach': case 'rules': return { page: head, params: {} };
    case 'member': return a ? { page: 'member', params: { id: URL_ALIAS[a] ?? a, tab: one(MEMBER_TABS, b, 'overview') } } : null;
    case 'plans': return { page: 'plans', params: a ? { caseId: a } : {} };
    case 'performance': return { page: 'performance', params: { tab: one(PERFORMANCE_TABS, a, 'decisions') } };
    case 'crm': return { page: 'crm', params: { tab: one(CRM_TABS, a, 'record') } };
    default: return null;
  }
}

/** Route to hash (with the leading #). Missing params get their defaults, so parseHash(formatHash(r)) round-trips.
 * @param {PageId} page @param {Record<string, string | undefined>} [params] */
export function formatHash(page, params = {}) {
  const e = encodeURIComponent;
  switch (page) {
    case 'member': return `#member/${e(URL_NAME[params.id ?? ''] ?? params.id ?? '')}/${e(one(MEMBER_TABS, params.tab, 'overview'))}`;
    case 'plans': return params.caseId ? `#plans/${e(params.caseId)}` : '#plans';
    case 'performance': return `#performance/${one(PERFORMANCE_TABS, params.tab, 'decisions')}`;
    case 'crm': return `#crm/${one(CRM_TABS, params.tab, 'record')}`;
    default: return `#${page}`;
  }
}
const one = (/** @type {string[]} */ tabs, /** @type {string | undefined} */ v, /** @type {string} */ d) => (v && tabs.includes(v) ? v : d);

/**
 * @typedef {object} RouterEnv
 * @property {() => string} getHash
 * @property {(hash: string) => void} setHash  navigates (fires the change listener asynchronously in a browser)
 * @property {(hash: string) => void} replaceHash  rewrites the hash without a change
 * @property {(fn: () => void) => void} listen  calls fn on every hash change
 * @property {(detail: object) => void} emit  siq:route
 * @property {(page: string, changes: number) => void} [mark]  body data attributes
 */

/** @param {RouterEnv} env */
export function createRouter(env) {
  /** @type {Route | null} */ let cur = null;
  let changeCount = 0;
  /** @type {Array<(r: Route, info: { from: Route | null, screenChange: boolean }) => void>} */ const subs = [];

  /** Resolve the current hash into a route, notify, and count a screen change if the page differs. */
  function sync() {
    const parsed = parseHash(env.getHash());
    const next = parsed ?? { page: /** @type {PageId} */ ('home'), params: {} };
    if (!parsed) env.replaceHash('#home');
    const from = cur;
    const same = from && from.page === next.page && JSON.stringify(from.params) === JSON.stringify(next.params);
    if (same) return false;
    const screenChange = !!from && !!parsed && from.page !== next.page;
    if (screenChange) changeCount++;
    cur = next;
    env.mark?.(next.page, changeCount);
    env.emit({ from, to: next, params: next.params, screenChange });
    for (const fn of subs) fn(next, { from, screenChange });
    return true;
  }

  return {
    /** Start listening and resolve the first route. */
    start() { env.listen(() => { sync(); }); sync(); },
    /** Navigate. When the hash is already the target the route is not re-announced. @param {PageId} page @param {Record<string, string | undefined>} [params] */
    go(page, params = {}) {
      const h = formatHash(page, params);
      if (env.getHash() === h) { sync(); return; }
      env.setHash(h);
    },
    current() { return cur ?? { page: /** @type {PageId} */ ('home'), params: {} }; },
    get changes() { return changeCount; },
    resetChanges() { changeCount = 0; env.mark?.(this.current().page, 0); },
    /** @param {(r: Route, info: { from: Route | null, screenChange: boolean }) => void} fn */
    onChange(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    sync,
  };
}

function browserEnv() {
  return /** @type {RouterEnv} */ ({
    getHash: () => location.hash,
    setHash: (h) => { location.hash = h; },
    replaceHash: (h) => { try { history.replaceState(null, '', h); } catch { location.hash = h; } },
    listen: (fn) => window.addEventListener('hashchange', fn),
    emit: (detail) => document.dispatchEvent(new CustomEvent('siq:route', { detail })),
    mark: (page, n) => { document.body.dataset.screen = page; document.body.dataset.screenChanges = String(n); },
  });
}

/** @type {ReturnType<typeof createRouter> | null} */ let inst = null;
const app = () => (inst ??= createRouter(browserEnv()));

/** @param {PageId} page @param {Record<string, string | undefined>} [params] */
export function go(page, params = {}) { app().go(page, params); }
export function current() { return app().current(); }
export function resetChanges() { app().resetChanges(); }
export const router = {
  start: () => app().start(),
  go, current, resetChanges,
  /** Number of screen changes since resetChanges(). */
  get changes() { return app().changes; },
  onChange: (/** @type {Parameters<ReturnType<typeof createRouter>['onChange']>[0]} */ fn) => app().onChange(fn),
};
/** Getter form the map asks for (`changes`): a live number. */
export function getChanges() { return app().changes; }
