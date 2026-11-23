// The compliance block (the blocked draft: what was blocked, which rule named it, what was removed and added, the channel change and the routing), the compliance-check
// rail and the human approval card. Pure HTML strings: every dynamic value goes through esc() (change adopt-keel-shell task 5.1, reworked in polish-and-realism task 5).
// They only show what the server's DecisionTrace and Approval say; nothing here decides. Layout goes through public/ui/primitives.js, figures through public/ui/format.js.
import { esc } from '../keel/shell.js';
import { CHECK } from '../ui/icons.js';
import { actions, emptyState, factList, idCode, secHead, statRow, tableHTML, verified } from '../ui/primitives.js';
import { dateLong, dateTime, money } from '../ui/format.js';
import { decisionsOfKind, heldMessage, nameOf, recommendation } from './state.js';
import { shortNames } from './labels.js';

/** @typedef {import('../../shared/contracts.ts').TextEdit} TextEdit */
/** @typedef {import('../../shared/contracts.ts').CommunicationDraft} CommunicationDraft */
/** @typedef {import('../../shared/contracts.ts').DecisionTrace} DecisionTrace */
/** @typedef {{ state: any, ui?: any, role?: 'agent' | 'supervisor', run?: any }} GovCtx */

export const ATTEST_APPROVE = 'I reviewed the recommendation and the corrected message and approve them for delivery.';
export const ATTEST_REJECT = 'I reviewed the recommendation and the corrected message and do not approve them.';
export const CHANNEL = /** @type {Record<string, string>} */ ({ email: 'Email', sms: 'Text message', phone: 'Phone', mail: 'Mail' });
/** "text" and "email": the word for a channel in "revoked text consent". */
const CONSENT_WORD = /** @type {Record<string, string>} */ ({ sms: 'text', email: 'email', phone: 'phone', mail: 'mail' });
export const roleLabel = (/** @type {string} */ r) => r.charAt(0).toUpperCase() + r.slice(1).replace(/-/g, ' ');
const lower = (/** @type {string} */ t) => t.charAt(0).toLowerCase() + t.slice(1);
/** A rule id: one mono token that never wraps; the legacy rule-id class stays because other suites select it. @param {string} id */
const ruleRef = (id) => idCode(id, { cls: 'rule-id', title: `Rule ${id}` });
/** A rule's own sentence, with its dates and whole dollars written the way the screens write them. @param {string} t */
const plain = (t) => shortNames(String(t ?? '')).replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => dateLong(d)).replace(/(\$[\d,]+)\.00\b/g, '$1');
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const joinAnd = (/** @type {string[]} */ xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** "Why this action?" opener. The shell's delegated `why` act opens the Why sheet; focus returns here when the sheet closes.
 * @param {string} decisionId @param {string} [label] @param {string} [cls] */
export const whyButton = (decisionId, label = 'Why this action?', cls = 'btn') =>
  `<button type="button" class="${esc(cls)}" data-act="why" data-v="${esc(decisionId)}" data-testid="why-open" aria-haspopup="dialog">${esc(label)}</button>`;

/** To / channel / subject / author of a message. @param {CommunicationDraft} d */
export const mailHeadHTML = (d) => {
  const row = (/** @type {string} */ k, /** @type {string} */ v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  return `<dl class="stage-mail-head">${row('To', d.to)}${row('Channel', CHANNEL[d.channel] ?? d.channel)}${row('Subject', d.subject)}${row('Author', d.author.kind === 'llm' ? 'Model draft' : 'Agent edit')}</dl>`;
};

// ---------- edits: groups, markers, corrections ----------

/**
 * Overlapping edits (for example MKT-FREE inside MKT-MISLEADING) share one group; the longer replacement wins. Offsets are into `body`.
 * @param {TextEdit[]} edits @returns {{ start: number, end: number, rules: string[], after: string }[]}
 */
export function editGroups(edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
  /** @type {{ start: number, end: number, rules: string[], after: string, afterLen: number }[]} */
  const groups = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && e.start < g.end) {
      g.end = Math.max(g.end, e.end); g.rules.push(e.ruleId);
      if (e.end - e.start > g.afterLen) { g.after = e.after; g.afterLen = e.end - e.start; }
    } else groups.push({ start: e.start, end: e.end, rules: [e.ruleId], after: e.after, afterLen: e.end - e.start });
  }
  return groups.map(({ afterLen: _l, ...g }) => g);
}
/** A group made only of added statements (a disclosure appended at the end). @param {{ rules: string[] }} g */
const isDisclosure = (g) => g.rules.every((r) => r.startsWith('DISC-'));

/**
 * The body as the agent wrote it (`side` before: struck text) or as the gate leaves it (`side` after: inserted text), with a superscript number
 * after each change that names the violated rule it belongs to. A statement the rules append sits in its own quote below, not in the running text.
 * @param {string} body @param {TextEdit[]} edits @param {string[]} violations rule ids in table order @param {'before' | 'after'} side
 */
export function markedBody(body, edits, violations, side) {
  let out = '', at = 0;
  for (const g of editGroups(edits)) {
    out += esc(body.slice(at, g.start));
    at = g.end;
    if (isDisclosure(g)) continue;
    const marks = g.rules.map((r) => violations.indexOf(r) + 1).filter((n) => n > 0).sort((a, b) => a - b)
      .map((n) => `<sup class="cmp-mark" aria-label="Rule ${n}">${n}</sup>`).join('');
    out += (side === 'before' ? `<del>${esc(body.slice(g.start, g.end))}</del>` : (g.after ? `<ins>${esc(g.after)}</ins>` : '')) + marks;
  }
  return out + esc(body.slice(at));
}
/** Kept for callers of the old name: the grouped HTML of the changes made to a body. @param {string} body @param {TextEdit[]} edits */
export const groupEdits = (body, edits) => markedBody(body, edits, [...new Set(edits.map((e) => e.ruleId))], 'before');

/** @param {import('../../shared/contracts.ts').Citation[]} cs */
const citeFull = (cs) => cs.map((c) => c.text + (c.illustrative ? ' (illustrative)' : '')).join('; ');
/** "42 CFR 422.2262" from "42 CFR 422.2262(a)(1)(i); ..."; a policy name keeps its first words. @param {import('../../shared/contracts.ts').Citation[]} cs */
const citeShort = (cs) => {
  const t = cs[0]?.text ?? '';
  return /\b\d+ CFR \d+\.\d+/.exec(t)?.[0] ?? t.split(/[;(]/)[0]?.trim() ?? '';
};

/** What the gate did about one violated rule, in a phrase. @param {string} id @param {any} o the blocked gate outcome */
function correctionOf(id, o) {
  const e = o.edits.find((/** @type {TextEdit} */ x) => x.ruleId === id);
  const cc = o.channelChange?.ruleId === id ? o.channelChange : null;
  if (cc) return { text: `Sent by ${lower(CHANNEL[cc.to] ?? cc.to)}, not ${lower(CHANNEL[cc.from] ?? cc.from)}`, full: e?.after ? `“${e.before}” became “${e.after}”` : '' };
  if (e) return e.after ? { text: 'Reworded', full: `“${e.before}” became “${e.after}”` } : { text: `Removed “${e.before}”`, full: '' };
  return { text: 'Corrected', full: '' };
}

/** The latest gate decision that blocked, and the one that held the corrected message. @param {any} s */
export function gateDecisions(s) {
  const gates = decisionsOfKind(s, 'communication-gate');
  const gateOf = (/** @type {string} */ v) => [...gates].reverse().find((t) => t.outcome.type === 'communication-gate' && t.outcome.verdict === v) ?? null;
  return { gates, blocked: gateOf('blocked'), held: gateOf('held-for-approval') };
}

/** The gate's own headline (the server derives it once and sends it with the step), else the same wording built from the outcome. @param {any} s @param {any} o */
function headlineOf(s, o) {
  const fromRun = s.steps['action.gate-recheck']?.headline ?? s.steps['action.gate']?.headline;
  if (fromRun && /^Blocked/.test(fromRun)) return fromRun;
  return `Blocked before delivery · ${plural(o.violations.length, 'rule')} failed · ${o.corrected ? 'corrected and routed for approval' : 'could not be corrected'}`;
}

/**
 * Blocked view inside the document: the headline, the figures (channel change and approver included), the agent's text beside the corrected text
 * with numbered markers, the quoted disclosure and the table of failed rules with citations.
 * @param {GovCtx} ctx
 */
export function complianceHTML(ctx) {
  const s = ctx.state;
  const { blocked, held } = gateDecisions(s);
  if (!blocked || blocked.outcome.type !== 'communication-gate') return '<p class="muted" data-testid="compliance-wait">Checking…</p>';
  const o = blocked.outcome;
  const original = s.drafts[o.draftId];
  const sc = s.scenario;
  const rr = /** @type {any[]} */ (blocked.ruleResults);
  const failed = (/** @type {string} */ id) => rr.find((x) => x.ruleId === id && x.outcome === 'fail');
  const groups = editGroups(o.edits);
  const discs = groups.filter(isDisclosure).length;
  // every failed rule has a row in the table below and a correction in it (a wording, a removed phrase, the added statement or the channel), so the strip counts the same rows
  const corrected = o.corrected ? o.violations.length : 0;
  const approver = sc?.approver;
  const cc = o.channelChange;
  const channel = cc ? `${CHANNEL[cc.from] ?? cc.from} → ${CHANNEL[cc.to] ?? cc.to}` : (CHANNEL[original?.channel] ?? '');

  // The red block banner is for a message that is still blocked. Once the corrected draft exists (the re-check came after the blocked one) and nobody rejected it, the block is
  // history, as it is in the rest of the run (the rail says "4 corrected"): one neutral line with the same words and the same button (final review 7.9, P1-1).
  const corrected_ = !!(held && s.decisions.indexOf(held) > s.decisions.indexOf(blocked)) && s.approval?.decision !== 'rejected';
  const callout = corrected_
    ? `<div class="stage-verdict cmp-verdict" data-kind="history">${verified(headlineOf(s, o), { state: 'done' }).replace('<span class="ui-verified-l">', '<span class="ui-verified-l" data-testid="gate-headline">')}${whyButton(blocked.decisionId, 'Why was it blocked?')}</div>`
    : `<div class="ui-callout ui-callout-block cmp-callout" data-kind="block"><span class="ui-callout-ic" aria-hidden="true">✕</span>` +
      `<span class="ui-callout-t"><span class="sr">Blocked: </span><b data-testid="gate-headline">${esc(headlineOf(s, o))}</b>` +
      `</span><span class="ui-callout-r">${whyButton(blocked.decisionId, 'Why was it blocked?')}</span></div>`;

  const stats = statRow([
    { label: 'Failed', value: String(o.violations.length) },
    { label: 'Corrected', value: String(corrected) },
    { label: 'Disclosure', value: String(discs), title: discs ? joinAnd(o.edits.filter((/** @type {TextEdit} */ e) => e.ruleId.startsWith('DISC-')).map((/** @type {TextEdit} */ e) => lower(rr.find((r) => r.ruleId === e.ruleId)?.title ?? e.ruleId))) : undefined },
    { label: 'Channel', value: channel, sub: cc ? `${CONSENT_WORD[cc.from] ?? cc.from} consent revoked` : undefined },
    { label: 'Approver', value: approver?.name ?? 'The supervisor', sub: `${roleLabel(approver?.role ?? 'sales-supervisor')} · WF-APPROVAL` },
  ], { size: 'sm' });

  // the unchanged opening of the model's text is folded; the paragraph holding the first change starts the two columns
  const starts = o.edits.map((/** @type {TextEdit} */ e) => e.start);
  const first = starts.length ? Math.min(...starts) : -1;
  const para = first >= 0 && original ? original.body.lastIndexOf('\n\n', first) : -1;
  const cut = para > 20 ? para + 2 : 0;
  const shifted = o.edits.map((/** @type {TextEdit} */ e) => ({ ...e, start: e.start - cut, end: e.end - cut }));
  const tail = original ? original.body.slice(cut) : '';
  const discQuotes = o.edits.filter((/** @type {TextEdit} */ e) => e.ruleId.startsWith('DISC-') && e.after).map((/** @type {TextEdit} */ e) =>
    `<blockquote class="cmp-disc" data-testid="disclosure-quote"><ins>${esc(e.after.trim())}</ins> ${ruleRef(e.ruleId)}</blockquote>`).join('');
  const unchanged = original && cut ? `<details class="cmp-unchanged"><summary>Unchanged draft text</summary><div class="stage-body">${esc(original.body.slice(0, cut))}</div></details>` : '';
  const columns = original ? `
    <div class="cmp-cols">
      <div class="cmp-col" data-testid="cmp-before"><h4>As written <span class="chip">Agent edit</span></h4><div class="stage-body">${markedBody(tail, shifted, o.violations, 'before')}</div></div>
      <div class="cmp-col" data-testid="cmp-after"><h4>Corrected · ${esc(CHANNEL[o.corrected?.channel ?? cc?.to ?? original.channel] ?? '')}</h4><div class="stage-body">${markedBody(tail, shifted, o.violations, 'after')}</div>${discQuotes}</div>
    </div>` : '';

  const rows = o.violations.map((/** @type {string} */ id, /** @type {number} */ i) => {
    const r = failed(id);
    const cites = r?.citations ?? [];
    return {
      n: String(i + 1),
      rule: { html: `<b>${esc(r?.title ?? id)}</b><br>${ruleRef(id)}` },
      wrong: plain(r?.message ?? ''),
      fix: (() => { const c = correctionOf(id, o); return { html: `<span${c.full ? ` title="${esc(c.full)}"` : ''}>${esc(c.text)}</span>` }; })(),
      cite: { html: `<span title="${esc(citeFull(cites))}">${esc(citeShort(cites))}</span>` },
    };
  });
  let k = 0;
  const table = tableHTML({
    caption: 'Rules the edited message failed',
    columns: [{ key: 'n', label: '#' }, { key: 'rule', label: 'Rule' }, { key: 'wrong', label: 'Issue' }, { key: 'fix', label: 'Correction' }, { key: 'cite', label: 'Citation' }],
    rows,
  }).replace(/<tr>(?=<td)/g, () => `<tr data-violation="${esc(o.violations[k++])}">`);

  /** The block's body; the routing row (and its button) only while the approval is open. @param {boolean} routing */
  const rest = (routing) => `
  ${stats}
  ${columns}
  <div data-testid="violations">${table}</div>
  ${routing && held ? `<div class="cmp-foot-row">${whyButton(held.decisionId, 'Why held for approval?')}</div>` : ''}
  ${unchanged}`;

  // once the supervisor approved, the block is history: one neutral line, the four rules one press away (requirement "Red only for unresolved problems")
  if (s.approval?.decision === 'approved') {
    const line = `Blocked before delivery · ${plural(o.violations.length, 'rule')} · corrected · approved by ${s.approval.approver?.name ?? approver?.name ?? 'the supervisor'}`;
    return `<div class="cmp-view cmp-done" data-testid="compliance-view"><details class="cmp-history"><summary data-testid="gate-headline">${esc(line)}</summary>
    <div class="cmp-history-body">${rest(false)}</div></details>${whyButton(blocked.decisionId, 'Why was it blocked?', 'btn ghost')}</div>`;
  }
  return `<div class="cmp-view" data-testid="compliance-view">
  ${callout}${rest(true)}</div>`;
}

// ---------- the rail ----------

/**
 * Rail: every rule that applied to the checked message. Failures (✕) and holds (!) first, passes (check) collapsed. The circle carries the rule id for assistive
 * technology and for tests; the row repeats it, muted, for sighted readers.
 * @param {GovCtx} ctx
 */
export function complianceRailHTML(ctx) {
  const s = ctx.state;
  const { gates, blocked, held } = gateDecisions(s);
  const t = blocked ?? gates[gates.length - 1] ?? null;
  const head = (/** @type {string} */ right) => secHead('Compliance check', { level: 3, right });
  if (!t) return `<div class="card pad cmp-rail" data-testid="compliance-rail">${head('')}${emptyState('Not checked yet')}</div>`;
  // after a person decided, the held row and the status line say what happened (a stale "held for approval" is wrong once it was approved or rejected)
  const ap = s.approval, decided = ap?.decision === 'approved' || ap?.decision === 'rejected';
  const approver = ap?.approver?.name ?? s.scenario?.approver?.name ?? 'the supervisor';
  const holdLabel = decided ? `${ap.decision === 'approved' ? 'Approved' : 'Rejected'} by ${approver}` : 'Needs approval';
  const outcome = t.outcome.type === 'communication-gate' ? t.outcome : null;
  const addedByRule = new Set((outcome?.edits ?? []).filter((/** @type {TextEdit} */ e) => e.ruleId.startsWith('DISC-')).map((/** @type {TextEdit} */ e) => e.ruleId));
  const applied = /** @type {any[]} */ (t.ruleResults).filter((r) => r.outcome !== 'not_applicable');
  const isFail = (/** @type {any} */ r) => r.outcome === 'fail' && r.severity !== 'hold';
  const isHold = (/** @type {any} */ r) => r.outcome === 'fail' && r.severity === 'hold' && !addedByRule.has(r.ruleId);
  const fails = applied.filter(isFail), holds = applied.filter(isHold);
  const passes = applied.filter((r) => !isFail(r) && !isHold(r));
  // once the supervisor approved, a failure of the blocked draft is history ("Corrected", neutral) and the hold is a verified approval; a rejection keeps them as they were
  const approved = ap?.decision === 'approved';
  // the re-check of the corrected message came after the blocked one: its failures are history while the message waits for a person (the status line says "0 failures")
  const rechecked = !!(blocked && held && s.decisions.indexOf(held) > s.decisions.indexOf(blocked));
  const fixedNow = approved || (rechecked && !decided);
  const row = (/** @type {any} */ r, /** @type {'no' | 'hold' | 'ok' | 'fixed'} */ kind) => {
    const icon = kind === 'ok' || kind === 'fixed' ? CHECK : kind === 'hold' ? '!' : '✕';
    const state = kind === 'ok' ? (approved && isHold(r) ? holdLabel.toLowerCase() : 'passed') : kind === 'fixed' ? 'corrected' : kind === 'hold' ? (decided ? holdLabel.toLowerCase() : 'needs approval') : 'failed';
    const note = kind === 'hold' || (kind === 'ok' && approved && isHold(r)) ? `<span class="small muted">${esc(decided ? holdLabel : plain(r.message))}</span>` : kind === 'fixed' ? '<span class="small muted">Corrected</span>' : addedByRule.has(r.ruleId) ? '<span class="small muted">Added</span>' : '';
    return `<div data-rule="${esc(r.ruleId)}" data-outcome="${esc(r.outcome)}" data-ctx-type="rule" data-ctx-id="${esc(r.ruleId)}"><span class="ck ${kind}"><span aria-hidden="true">${icon}</span><span class="sr">${esc(r.ruleId)} ${state}</span></span>` +
      `<span class="cmp-rule"><b>${esc(r.title)}</b>${note}<span class="cmp-rule-ref" aria-hidden="true">${ruleRef(r.ruleId)}</span></span></div>`;
  };
  const pill = (/** @type {string} */ tone, /** @type {string} */ label) => `<span class="pill ${tone}">${esc(label)}</span>`;
  // one status pill per title: the counts read in one line, in the colour of the worst of them
  const parts = [
    fails.length ? `${fails.length} ${fixedNow ? 'corrected' : 'failed'}` : '',
    holds.length ? (decided ? `${holds.length} ${ap.decision}` : `${holds.length} ${holds.length === 1 ? 'needs' : 'need'} approval`) : '',
    passes.length ? `${passes.length} passed` : '',
  ].filter(Boolean);
  const tone = decided ? (ap.decision === 'rejected' ? 'crit' : 'neutral') : fails.length && !fixedNow ? 'crit' : holds.length ? 'warn' : 'neutral';
  const pills = parts.length ? pill(tone, parts.join(' · ')) : '';
  const status = rechecked && held.outcome.type === 'communication-gate'
    ? `Re-check: ${plural(held.ruleResults.filter((/** @type {any} */ r) => r.outcome === 'fail' && r.severity !== 'hold').length, 'failure')} · ${decided ? `${ap.decision} by ${esc(approver)}` : 'held for approval'}`
    : '';
  return `<div class="card pad cmp-rail" data-testid="compliance-rail">${head(pills)}
  <div class="check">${[...fails.map((r) => row(r, fixedNow ? 'fixed' : 'no')), ...holds.map((r) => row(r, approved ? 'ok' : 'hold'))].join('')}</div>
  ${passes.length ? `<details class="cmp-passed"><summary>${passes.length} passed</summary><div class="check">${passes.map((r) => row(r, 'ok')).join('')}</div></details>` : ''}
  ${status ? `<p class="small cmp-status-line" data-testid="rail-status">${status}</p>` : ''}</div>`;
}

// ---------- the approval card ----------

/** "Carol Sutton" to "DW". @param {string} name */
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();

/**
 * The approval card (no outer frame: the document rail and the step card each give it theirs). Agent view: who it is assigned to, no buttons.
 * Supervisor view: the quoted attestation, Approve and Reject (the `plans.approve` act). After a decision: who, role, time and the attestation.
 * `badge: false` when the frame already shows the HUMAN badge (the step card's provenance line).
 * @param {GovCtx} ctx @param {{ badge?: boolean }} [opts]
 */
export function approvalHTML(ctx, opts = {}) {
  const s = ctx.state;
  const rec = recommendation(s), sc = s.scenario;
  const corrected = heldMessage(s);
  if (!rec || !sc) return '';
  const supervisor = (ctx.role ?? ctx.ui?.role) === 'supervisor';
  const o = rec.outcome.type === 'plan-recommendation' ? rec.outcome : null;
  const best = rec.candidates?.find((/** @type {any} */ c) => c.planId === o?.recommendedPlanId);
  const a = s.approval;
  const pending = !a && s.steps['human.approve']?.status === 'waiting';
  const name = sc.approver.name, role = roleLabel(sc.approver.role);
  /** @type {string} */ let pill, body;
  if (a) {
    const ok = a.decision === 'approved';
    pill = ok ? `<span data-status="approved">${verified(`Approved ${dateTime(a.at)}`)}</span>` : '<span class="pill crit" data-status="rejected">Rejected</span>';
    body = factList([
      { label: ok ? 'Approved by' : 'Rejected by', value: a.approver.name }, { label: 'Role', value: roleLabel(a.approver.role) },
      { label: 'Time', value: dateTime(a.at) }, { label: 'Attestation', value: `“${a.attestation}”` },
    ], { max: 4 });
  } else if (pending && supervisor) {
    pill = '<span class="pill warn" data-status="waiting">Waiting</span>';
    body = `<blockquote class="appr-attest"><span class="small muted">Attestation</span>“${esc(ATTEST_APPROVE)}”</blockquote>` +
      actions([{ label: `Approve as ${name}`, kind: 'primary', act: 'plans.approve', v: 'approved', testid: 'approve' }, { label: 'Reject', act: 'plans.approve', v: 'rejected', testid: 'reject' }]);
  } else if (pending) {
    pill = '<span class="pill warn" data-status="waiting">Waiting</span>';
    body = `<p class="appr-assigned" role="status" data-testid="approval-assigned"><b>Assigned to ${esc(name)}, ${esc(lower(role))}</b></p>`;
  } else {
    pill = '<span class="pill neutral" data-status="idle">Not requested</span>';
    body = '';
  }
  const being = factList([
    { label: 'Plan change', value: `${nameOf(s, o?.recommendedPlanId ?? '')}${best ? ` · est. ${money(best.estAnnualCost)}/yr` : ''}` },
    { label: 'Message', value: corrected ? `${CHANNEL[corrected.channel]} to ${corrected.to}` : '—', note: corrected ? `“${corrected.subject}”` : undefined },
  ], { max: 2 });
  return `<div class="appr" data-testid="approval-card" role="group" aria-label="Supervisor approval">
  ${secHead('Supervisor approval', { level: 3, ...(opts.badge === false ? {} : { badge: 'human' }) })}
  <div class="appr-who"><div class="av appr-av" aria-hidden="true">${esc(initials(name))}</div><div class="appr-name"><b>${esc(name)}</b><span class="small muted">${esc(role)}</span>${a ? pill : ''}</div>${a ? '' : pill}</div>
  ${body}
  ${a ? "" : `<div class="appr-body"><h4>For approval</h4>${being}
    ${corrected ? `<details class="appr-read"><summary>Corrected message</summary>${mailHeadHTML(corrected)}<div class="stage-body small">${esc(corrected.body)}</div></details>` : ''}</div>`}</div>`;
}
