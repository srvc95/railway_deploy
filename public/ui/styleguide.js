// Living style page for the design-system layer. Reachable only at /?ui=1 (not in the navigation). Every primitive in every state, built with the same helpers
// the screens use, so this page cannot drift from them.
import { count, dateLong, dateShort, dateTime, days, money, moneyPerMonth, percent, plural, timeOfDay } from './format.js';
import {
  actions, button, callout, chip, emptyState, errorState, esc, factList, keyValueGrid, layerBadge, loadingState, num, prov, ruleRef, secHead, statRow, statusPill, tableHTML,
} from './primitives.js';

/** @param {string} id @param {string} title @param {string} intro @param {string} body @param {{ badge?: string }} [o] */
const card = (id, title, intro, body, o = {}) =>
  '<section class="card pad ui-guide-card" data-ui-section="' + id + '" aria-labelledby="ui-h-' + id + '">' +
  secHead(title, { badge: o.badge }).replace('<h2>', '<h2 id="ui-h-' + id + '">') + (intro ? '<p class="small muted ui-guide-intro">' + esc(intro) + '</p>' : '') + body + '</section>';
/** @param {string} label @param {string} html */
const sample = (label, html) => '<div class="ui-sample"><span class="ui-sample-l">' + esc(label) + '</span>' + html + '</div>';

const FACTS = [
  ['Plan', 'Northlake Choice (PPO)'], ['Monthly premium', moneyPerMonth(0)], ['Annual drug cost', money(134400) + ' per year'], ['Primary care doctor', 'Dr. Sullivan'],
  ['Pharmacy', 'Maple Street Pharmacy'], ['Fills per year', '12'], ['Effective', dateLong('2027-01-01')], ['Open enrollment ends', dateLong('2026-12-07')], ['Days left', days(48)],
].map(([label, value]) => ({ label, value }));

/** The whole style page as one HTML string. */
export function styleguideHTML() {
  const stat = card('stat-row', 'Stat row', 'Two to five figures. Values are formatted before they get here, units included.',
    sample('Four figures with sub-lines', statRow([
      { label: 'Annual cost', value: money(134400), sub: 'Plan year 2027' }, { label: 'Monthly premium', value: moneyPerMonth(0) },
      { label: 'Drug copay', value: money(4700) + ' per 30 days' }, { label: 'Decision window', value: days(48), sub: 'Ends ' + dateLong('2026-12-07') }])) +
    sample('Three figures', statRow([{ label: 'Members', value: count(1284) }, { label: 'Needs approval', value: '3' }, { label: 'Share reviewed', value: percent(62.5) }])) +
    sample('Two figures', statRow([{ label: 'Total', value: money(215080) }, { label: 'Of which copays', value: money(18000, { cents: 'always' }) }])));

  const facts = card('fact-list', 'Fact list', 'Label, value, optional second line and source. Past six rows the rest sits under Show all.',
    sample('With a second line and a source', factList([
      { label: 'Preferred doctor', value: 'Dr. Sullivan', note: '“I want to keep seeing her.”', source: 'Call Oct 19' },
      { label: 'Pharmacy', value: 'Maple Street Pharmacy', source: 'Enrollment' }, { label: 'Fills per year', value: '12' }])) +
    sample('Nine rows, six shown', factList(FACTS)));

  const heads = card('sec-head', 'Section header', 'A title, optional meta and at most one layer badge on the right. A second badge is refused.',
    sample('Title only', secHead('Coverage', { level: 3 })) + sample('With meta', secHead('Recommendation', { level: 3, meta: dateShort('2026-10-20') })) +
    sample('With one badge', secHead('Plans checked', { level: 3, badge: 'rules' })) +
    sample('With an action', secHead('Outreach message', { level: 3, right: button('Open', { kind: 'ghost' }) })) +
    sample('Provenance line', prov('rules', ['Decided by rules', 'Rule pack 2026.2', 'Plan data ' + dateLong('2026-10-15')])));

  const badges = card('badges', 'Badges, pills and chips', 'Badges name the layer. Pills name a state. Chips label a surface. Each is used once per title.',
    sample('Layer badges', '<div class="chips">' + ['ai', 'data', 'rules', 'human', 'system'].map(layerBadge).join('') + '</div>') +
    sample('Status pills', '<div class="chips">' + [statusPill('passed'), statusPill('failed'), statusPill('approval'), statusPill('excluded'), statusPill('recommended'), statusPill('eligible', { n: 2 }), statusPill('simulated')].join('') + '</div>') +
    sample('Chips and rule ids', '<div class="chips">' + chip('Simulated', { title: 'Sandbox record' }) + chip('Scripted edit') + chip('Sample data') + ruleRef('ELIG-SERVICE-AREA') + '</div>'));

  const kv = card('kv-grid', 'Key-value grid', 'Short pairs in a flowing grid.',
    sample('Four pairs', keyValueGrid([{ label: 'Member', value: 'Dottie Hayes' }, { label: 'County', value: 'Lorain County' }, { label: 'Plan year', value: '2027' }, { label: 'As of', value: dateTime('2026-10-20T14:00:00Z') }])));

  const callouts = card('callouts', 'Callouts', 'One line, one state, no nesting. An icon and hidden text carry the state as well as colour.',
    sample('Info', callout('info', 'Plan data is current as of ' + dateLong('2026-10-15') + '.')) +
    sample('Passed', callout('good', 'All four checks passed.')) +
    sample('Warning with an action', callout('warn', 'Waiting for approval from Carol Sutton.', { right: button('Review') })) +
    sample('Blocked', callout('block', 'Text messages are not allowed for this member. The message was moved to email.')));

  const table = card('table', 'Table', 'Shell table style. Figures sit right-aligned in tabular numerals. The scroller takes focus from the keyboard.',
    sample('Plans checked', tableHTML({
      caption: 'Plans checked',
      columns: [{ key: 'plan', label: 'Plan' }, { key: 'state', label: 'Result' }, { key: 'prem', label: 'Premium', num: true }, { key: 'cost', label: 'Annual cost', num: true }],
      rows: [
        { plan: 'Northlake Choice (PPO)', state: { html: statusPill('recommended') }, prem: moneyPerMonth(0), cost: money(134400) },
        { plan: 'Birch Value (PPO)', state: { html: statusPill('eligible', { n: 2 }) }, prem: moneyPerMonth(2150), cost: money(215080) },
        { plan: 'Cedar Plus (HMO)', state: { html: statusPill('excluded') }, prem: '—', cost: '—' }] })) +
    sample('No rows', tableHTML({ caption: 'Violations', columns: [{ key: 'a', label: 'Rule' }], rows: [], empty: 'No violations' })));

  const states = card('states', 'Empty, loading and error', 'Three states every list needs. Each has a title, at most one line and at most one action.',
    '<div class="ui-guide-states">' + sample('Empty', emptyState('No members yet', { text: 'Open a case to see it here.', action: { label: 'New case' } })) +
    sample('Loading', loadingState('Loading plans')) + sample('Error', errorState(undefined, { retry: { act: 'retry' } })) + '</div>');

  const buttons = card('buttons', 'Buttons and focus', 'One primary action per group. Everything else is secondary or ghost. Press Tab to see the focus ring on each control.',
    sample('Group with one primary', actions([{ label: 'Approve and send', kind: 'primary' }, { label: 'Send back' }, { label: 'Cancel', kind: 'ghost' }])) +
    sample('Secondary, ghost, disabled, link', '<div class="ui-actions">' + button('Secondary') + button('Ghost', { kind: 'ghost' }) + button('Disabled', { disabled: true }) + button('Open plans', { href: '#plans' }) + '</div>'));

  const rows = [
    ['money(134400)', money(134400)], ['money(215080)', money(215080)], ['money(0)', money(0)], ['money(134400, {cents:\'always\'})', money(134400, { cents: 'always' })],
    ['moneyPerMonth(1800)', moneyPerMonth(1800)], ['percent(12.5)', percent(12.5)], ['days(48)', days(48)], ['plural(3, \'member\')', plural(3, 'member')],
    ['dateLong(\'2026-12-31\')', dateLong('2026-12-31')], ['dateShort(\'2026-12-31\')', dateShort('2026-12-31')], ['dateTime(\'2026-10-22T14:00:00Z\')', dateTime('2026-10-22T14:00:00Z')], ['timeOfDay(\'2026-10-22T14:00:12Z\')', timeOfDay('2026-10-22T14:00:12Z')],
  ].map(([call, out]) => ({ call: { html: '<code>' + esc(call) + '</code>' }, out: { html: num(out) } }));
  const numbers = card('numbers', 'Numbers and dates', 'One format for each kind of figure. Money keeps the body face with tabular figures, never a monospace face. Dates are US Eastern.',
    sample('Format helpers', tableHTML({ caption: 'Format helpers', columns: [{ key: 'call', label: 'Call' }, { key: 'out', label: 'Output', num: true }], rows })) +
    sample('In a sentence', '<p>The plan costs ' + num(money(134400)) + ' a year, or ' + num(moneyPerMonth(11200)) + '. The window closes ' + dateLong('2026-12-07') + '.</p>'));

  const copy = card('copy-rules', 'Copy rules', 'Product voice.',
    '<ul class="ui-rules"><li>Say what the screen shows, in the words a licensed agent would use.</li><li>Where a figure came from goes in the provenance line, not in a sentence.</li>' +
    '<li>Units on every figure: dollars per month, days, percent.</li><li>Plain reasons on summary screens. Rule ids only on detail screens.</li>' +
    '<li>No instructions for developers, no commands, no placeholders.</li><li>One status per title, one chip per surface.</li></ul>');

  return '<div class="wrap ui-guide-wrap" data-testid="ui-styleguide"><div class="top"><div><h1>Interface components</h1><p>Every building block in each of its states.</p></div></div>' +
    [stat, facts, heads, badges, kv, callouts, table, states, buttons, numbers, copy].join('') + '</div>';
}

/** Replace the app with the style page. The shell keeps running underneath, hidden. */
export function mountStyleguide() {
  const app = document.getElementById('app'); if (app) { app.hidden = true; app.style.display = 'none'; }
  document.querySelectorAll('[id^="siqx-"], #alert, #why-sheet').forEach((el) => { if (el instanceof HTMLElement) el.style.display = 'none'; });
  const host = document.createElement('main');
  host.id = 'ui-styleguide'; host.className = 'ui-guide'; host.tabIndex = -1;
  host.innerHTML = styleguideHTML();
  document.body.append(host);
  document.title = 'Interface components | Keel';
  document.body.dataset.ui = 'true';
}

if (typeof location !== 'undefined' && typeof document !== 'undefined' && new URLSearchParams(location.search).get('ui') === '1') mountStyleguide();
