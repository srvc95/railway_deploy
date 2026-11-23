// Sandbox CRM screen (change adopt-keel-shell, task 11.1; polished in polish-and-realism task 8.4; interface: notes/keel-shell-map.md section 8).
// Built from the Keel tables, tabs, pills and the design-system primitives. It shows records and writes only: the connector is simulated, and the page says so
// once, in the header chip. Records come from run.load('crm'); the write-back log comes straight from `crm` run events (state.crm).
import { esc, nativeButton, registerPage, scheduleRender, tabsHTML, top } from '../shell.js';
import { CHANNEL_LABEL, MESSAGE_VERSION_LABEL, WRITE_OP, shortNames } from '../../js/labels.js';
import { dateLong, dateTime, timeOfDay } from '../../ui/format.js';
import { emptyState, idCode, loadingState, secHead, statRow } from '../../ui/primitives.js';
import { CRM_EARLIER, HISTORY_LABEL, WRITES_EARLIER } from '../history.js';

const TABS = /** @type {[string, string][]} */ ([['record', 'Record'], ['activity', 'Activity'], ['tasks', 'Tasks'], ['cases', 'Cases'], ['log', 'Write-back log']]);
const CRM_STEPS = ['action.monitor', 'signal.reply-interpret', 'decision.next-action'];
const MEMBER_ID = 'M-0001';
const OBJECT_ORDER = ['Member', 'Activity', 'Task', 'Case'];
/** Write-back rows that are open. Module state: the shell rebuilds the page on every run event. */
const openRows = new Set();

/** A stored value as text, with ISO dates and instants written the way the rest of the app writes them. @param {unknown} v */
export function show(v) {
  if (v == null || v === '') return '—';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g, (m) => dateTime(m)).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => dateLong(m));
}

/** What each write means to the reader, one of the five closed-loop writes. @param {any} w @param {boolean} firstMemberUpdate */
export function writeLabel(w, firstMemberUpdate) {
  if (w.objectType === 'Activity') return 'Communication logged';
  if (w.objectType === 'Task') return 'Follow-up task created';
  if (w.objectType === 'Case') return 'Exception escalated';
  if (w.objectType === 'Member') return 'Next best action' in (w.after ?? {}) && !firstMemberUpdate ? 'Next action updated' : 'Member updated';
  return 'Record changed';
}

/** The header figures: how many writes, to which objects, and when the last one happened. Counted from the writes. @param {any[]} writes */
export function crmStats(writes) {
  const n = writes.length;
  const objects = OBJECT_ORDER.filter((o) => writes.some((w) => w.objectType === o));
  const created = writes.filter((w) => w.op === 'create').length, updated = n - created;
  const last = n ? writes.reduce((a, w) => (w.at > a ? w.at : a), writes[0].at) : null;
  return [
    { label: 'Writes', value: String(n), sub: n ? [created ? `${created} created` : '', updated ? `${updated} updated` : ''].filter(Boolean).join(' · ') : 'None yet' },
    { label: 'Objects', value: String(objects.length), sub: objects.length ? objects.join(', ') : 'None yet' },
    { label: 'Last write', value: last ? dateTime(last) : 'None yet' },
  ];
}

/** The one lozenge for the operation of a write, in the write-back log and on the changed fields of the record: Created is accent, Updated is neutral. @param {'create' | 'update'} op */
export const opLozenge = (op) => '<span class="pill ' + (op === 'create' ? 'accent' : 'neutral') + ' crm-op" data-op="' + op + '">' + WRITE_OP[op] + '</span>';

/** "draft-2-corrected" reads "Corrected draft", "draft-1" "Original draft", "draft-2" "Agent edit". Any other value is returned as it is. @param {unknown} id */
const messageLabel = (id) => {
  const m = /^draft-(\d+)(-corrected)?$/.exec(String(id));
  return m ? MESSAGE_VERSION_LABEL[m[2] ? 'corrected' : m[1] === '1' ? 'original' : 'edit'] : String(id);
};

/** A stored value as the screen says it: the channel and the message version as product words, everything else through show(). @param {string} key @param {unknown} v */
export function fieldText(key, v) {
  if (key === 'Channel') return /** @type {Record<string, string>} */ (CHANNEL_LABEL)[String(v)] ?? show(v);
  if (key === 'Message') return messageLabel(v);
  return show(v);
}

/** @param {any} w */
function changeSummary(w) {
  const keys = Object.keys(w.after ?? {});
  return '<ul class="crm-diff">' + keys.map((k) => {
    const b = w.before ? w.before[k] : undefined;
    return '<li><span class="crm-k">' + esc(k) + '</span> ' + (w.before ? '<s class="crm-was">' + esc(fieldText(k, b)) + '</s> <span aria-hidden="true">&rarr;</span><span class="sr"> changed to </span> ' : '') + '<b>' + esc(fieldText(k, w.after[k])) + '</b></li>';
  }).join('') + '</ul>';
}

/** @param {any[]} records @param {any[]} writes */
export function recordHTML(records, writes) {
  const m = records.find((r) => r.objectType === 'Member');
  if (!m) return '<div class="card pad" data-testid="crm-record">' + emptyState('No member record yet') + '</div>';
  const touched = writes.filter((w) => w.objectType === 'Member' && w.recordId === m.id).sort((a, b) => a.seq - b.seq);
  const first = new Map(); // field -> value before the run's first write to it
  for (const w of touched) for (const k of Object.keys(w.after)) if (!first.has(k)) first.set(k, w.before ? w.before[k] : undefined);
  const rows = Object.entries(m.fields).map(([k, now]) => {
    const changed = first.has(k) && show(first.get(k)) !== show(now);
    return '<tr' + (changed ? ' data-changed="true"' : '') + ' data-field="' + esc(k) + '"><th scope="row" class="crm-field">' + esc(k) + '</th><td>' + (changed ? '<s class="crm-was">' + esc(show(first.get(k))) + '</s>' : '<span class="muted">No change</span>') +
      '</td><td>' + (changed ? '<b>' + esc(show(now)) + '</b> ' + opLozenge('update') : esc(show(now))) + '</td></tr>';
  }).join('');
  const perWrite = touched.length
    ? '<div class="card pad crm-writes">' + secHead('Changes by write', { level: 3 }) + '<ol class="crm-steps">' + touched.map((w) =>
      '<li data-testid="crm-change-' + w.seq + '"><div><b>' + esc(writeLabel(w, w === touched[0])) + '</b> <span class="muted small">write ' + w.seq + ', ' + esc(dateTime(w.at)) + '</span></div>' + changeSummary(w) + '</li>').join('') + '</ol></div>'
    : '';
  return '<div class="crm-stack" data-testid="crm-record"><div class="card tbl-wrap crm-record"><table><caption class="sr">Member record, before and after this run</caption><colgroup><col class="crm-c1"><col class="crm-c2"><col class="crm-c3"></colgroup><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">Now</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + perWrite + '</div>';
}

/** A table of records, one row each. @param {any[]} list @param {string} type @param {string[]} cols @param {boolean} [earlier] */
function rowsTable(list, type, cols, earlier = false) {
  return '<table><caption class="sr">' + esc(type) + (earlier ? ' records from earlier' : ' records from this run') + '</caption><thead><tr><th scope="col">Id</th>' + (earlier ? '<th scope="col">Date</th>' : '') + cols.map((c) => '<th scope="col">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    list.map((r) => '<tr data-testid="crm-' + type.toLowerCase() + '-' + esc(r.id) + '" data-ctx-type="crm" data-ctx-id="' + esc(r.id) + '"><td>' + idCode(r.id) + '</td>' + (earlier ? '<td class="crm-cell">' + esc(dateLong(r.at)) + '</td>' : '') + cols.map((c) => '<td class="crm-cell">' + esc(fieldText(c, r.fields[c])) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

/** One table for Activity, Tasks or Cases: this run's records, then the member's earlier ones (sample history). @param {any[]} records @param {string} type @param {string} noun @param {string} testid */
function objectTab(records, type, noun, testid) {
  const list = records.filter((r) => r.objectType === type);
  const earlier = /** @type {any[]} */ (/** @type {any} */ (CRM_EARLIER)[type] ?? []);
  const cols = [...new Set([...list, ...earlier].flatMap((r) => Object.keys(r.fields)))].filter((c) => c !== 'Member');
  const now = list.length
    ? '<div class="card tbl-wrap" data-testid="' + testid + '">' + rowsTable(list, type, cols) + '</div>'
    : '<div class="card pad" data-testid="' + testid + '">' + emptyState('No ' + noun + ' from today yet', { text: 'They are written here when the supervisor approves.' }) + '</div>';
  const old = earlier.length ? '<div class="hist" data-testid="' + testid + '-earlier"><div class="sec-h"><h3>Earlier</h3><span class="hist-tag">' + esc(HISTORY_LABEL) + '</span></div><div class="card tbl-wrap">' + rowsTable(earlier, type, cols, true) + '</div></div>' : '';
  return now + old;
}

/** One line for a write: its meaning and the first value it set. @param {any} w @param {string} label */
function oneLine(w, label) {
  const k = Object.keys(w.after ?? {});
  if (!k.length) return label;
  const key = w.op === 'create' ? (k.includes('Subject') ? 'Subject' : k[0]) : k[k.length - 1];
  const v = fieldText(key, w.after[key]);
  return w.op === 'create' ? `${label} · ${v}` : `${label} · ${key}: ${v}`;
}

/** The write-back log: one line per write; the request and what changed open under the row. @param {any[]} writes @param {Set<number>} [open] */
export function logHTML(writes, open = new Set()) {
  return logNowHTML(writes, open) + earlierLogHTML();
}

/** Earlier writes to this member's records, from previous runs (sample history). */
function earlierLogHTML() {
  return '<div class="hist" data-testid="crm-log-earlier"><div class="sec-h"><h3>Earlier writes</h3><span class="hist-tag">' + esc(HISTORY_LABEL) + '</span></div><div class="card tbl-wrap"><table class="crm-log"><caption class="sr">Earlier writes</caption><thead><tr><th scope="col">Ref</th><th scope="col">Object</th><th scope="col">Operation</th><th scope="col">Record</th><th scope="col">Summary</th><th scope="col">Date</th></tr></thead><tbody>' +
    WRITES_EARLIER.map((w) => '<tr><td>' + idCode(w.ref) + '</td><td>' + esc(w.objectType) + '</td><td>' + opLozenge(/** @type {'create' | 'update'} */ (w.op)) + '</td><td>' + idCode(w.recordId) + '</td><td class="crm-sum"><span class="crm-clamp">' + esc(w.summary) + '</span></td><td class="crm-time">' + esc(dateLong(w.at)) + '</td></tr>').join('') + '</tbody></table></div></div>';
}

/** This run's write-back log. @param {any[]} writes @param {Set<number>} open */
function logNowHTML(writes, open) {
  if (!writes.length) return '<div class="card pad" data-testid="crm-log">' + emptyState('No writes from today yet', { text: 'Keel writes to the CRM only after the supervisor approves.' }) + '</div>';
  let members = 0;
  const body = [...writes].sort((a, b) => a.seq - b.seq).map((w) => {
    const label = writeLabel(w, w.objectType === 'Member' && members++ === 0), isOpen = open.has(w.seq), line = oneLine(w, label);
    return '<tr data-testid="crm-write-' + w.seq + '" data-ctx-type="crm-write" data-ctx-id="' + w.seq + '"><td class="r ui-num">' + w.seq + '</td><td>' + esc(w.objectType) + '</td>' +
      '<td>' + opLozenge(w.op) + '</td><td>' + idCode(w.recordId) + '</td>' +
      '<td class="crm-sum" title="' + esc(line) + '"><span class="crm-clamp">' + esc(line) + '</span></td><td class="crm-time"><time datetime="' + esc(w.at) + '">' + esc(timeOfDay(w.at)) + '</time></td>' +
      '<td class="r"><button type="button" class="link small" data-act="crm.toggle" data-v="' + w.seq + '" aria-expanded="' + isOpen + '" aria-controls="crm-d-' + w.seq + '">' + (isOpen ? 'Hide' : 'Details') + '<span class="sr"> for write ' + w.seq + '</span></button></td></tr>' +
      '<tr class="crm-detail" id="crm-d-' + w.seq + '"' + (isOpen ? '' : ' hidden') + '><td colspan="7"><div class="crm-detail-in"><p class="small muted">Request <code class="crm-req">' + esc(w.simulatedRequest) + '</code></p>' + changeSummary(w) + '</div></td></tr>';
  }).join('');
  return '<div class="card tbl-wrap" data-testid="crm-log"><table class="crm-log"><caption class="sr">Write-back log of the Sandbox CRM, in order</caption><thead><tr><th scope="col" class="r">#</th><th scope="col">Object</th><th scope="col">Operation</th><th scope="col">Record</th><th scope="col">Summary</th><th scope="col">Time</th><th scope="col"><span class="sr">Details</span></th></tr></thead><tbody>' + body + '</tbody></table></div>';
}

const loading = () => '<div class="card pad" data-testid="crm-loading">' + loadingState('Loading') + '</div>';

/** The page. @param {any} ctx */
export function crmHTML(ctx) {
  const run = ctx.run;
  const tab = TABS.some(([id]) => id === ctx.params.tab) ? ctx.params.tab : 'record';
  const writes = /** @type {any[]} */ (ctx.state?.crm ?? []);
  const records = /** @type {any[] | null} */ (run.views?.crm ?? null);
  const member = records?.find((r) => r.objectType === 'Member');
  const name = member?.fields?.Name ?? ctx.state?.scenario?.beneficiary?.name ?? null;
  const next = CRM_STEPS.map((s) => nativeButton(ctx, s)).join('');
  const head = top('Sandbox CRM', 'Member ' + MEMBER_ID + (name ? ', ' + esc(shortNames(name)) : ''), '<span class="chip" data-testid="crm-simulated">Simulated connector</span>' + next);
  let body;
  if (tab === 'activity') body = records ? objectTab(records, 'Activity', 'activities', 'crm-activity') : loading();
  else if (tab === 'tasks') body = records ? objectTab(records, 'Task', 'tasks', 'crm-tasks') : loading();
  else if (tab === 'cases') body = records ? objectTab(records, 'Case', 'cases', 'crm-cases') : loading();
  else if (tab === 'log') body = logHTML(writes, openRows);
  else body = records ? recordHTML(records, writes) : loading();
  return head + '<div class="crm-stats" data-testid="crm-label">' + statRow(crmStats(writes)) + '</div><div class="crm-tabs">' + tabsHTML('tab', TABS, tab) + '</div><div class="crm-panel" role="tabpanel" data-testid="crm-panel" data-tab="' + tab + '">' + body + '</div>';
}

registerPage({
  id: 'crm',
  title: 'Sandbox CRM',
  render: crmHTML,
  acts: { 'crm.toggle': (el) => { const n = Number(el.dataset.v); if (openRows.has(n)) openRows.delete(n); else openRows.add(n); scheduleRender(); } },
  after(_el, ctx) { if (ctx.state?.runId) void ctx.run.load('crm').catch(() => { /* the log still shows */ }); },
});
