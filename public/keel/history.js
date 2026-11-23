// Sample history for the demo (change demo-polish). Synthetic and fictional, like every record in this demo; shown under "Earlier" headings
// so a viewer can tell it apart from what the live run produces. Nothing here is decided by the page and nothing is sent to the server.
// It exists so a screen never opens empty: the book has been in use for weeks, and Dottie's case is today's new item.

export const HISTORY_LABEL = 'Earlier · sample history';

/** Dottie's own CRM history before today (Sandbox CRM, Member M-0001). Fields mirror the run's records so the tables line up. */
export const CRM_EARLIER = {
  Activity: [
    { id: 'A-0991', at: '2026-10-19T15:42:00-04:00', fields: { Subject: 'Voicemail from member: plan ending, wants options', Member: 'M-0001', Channel: 'phone', Status: 'Received', 'Approved by': '—', Message: 'Inbound voicemail' } },
    { id: 'A-0974', at: '2026-09-24T09:00:00-04:00', fields: { Subject: 'Non-renewal notice mailed by carrier', Member: 'M-0001', Channel: 'mail', Status: 'Mailed', 'Approved by': '—', Message: 'Carrier letter' } },
    { id: 'A-0712', at: '2025-11-14T11:20:00-05:00', fields: { Subject: 'Email: 2026 plan options (approved)', Member: 'M-0001', Channel: 'email', Status: 'Sent', 'Approved by': 'Carol Sutton', Message: 'Approved draft' } },
  ],
  Task: [
    { id: 'T-1688', at: '2025-11-18T10:00:00-05:00', fields: { Subject: 'Annual review call with member (2026 plan year)', Member: 'M-0001', Owner: 'Ryan Mitchell', Checklist: 'Scope of Appointment on file; plan year review', Status: 'Done' } },
  ],
  Case: [
    { id: 'C-2410', at: '2025-11-12T14:05:00-05:00', fields: { Subject: '2026 plan review: stayed on Northlake Advantage Plus (HMO)', Queue: 'Retention', Member: 'M-0001', Status: 'Closed' } },
  ],
};

/** Earlier write-back log entries (previous runs), newest first. */
export const WRITES_EARLIER = [
  { ref: 'W-0418', at: '2026-10-19T15:43:00-04:00', objectType: 'Activity', op: 'create', recordId: 'A-0991', summary: 'Communication logged · Voicemail from member' },
  { ref: 'W-0402', at: '2026-09-24T09:01:00-04:00', objectType: 'Member', op: 'update', recordId: 'M-0001', summary: 'Retention status: Non-renewal notice received' },
  { ref: 'W-0217', at: '2025-11-14T11:21:00-05:00', objectType: 'Activity', op: 'create', recordId: 'A-0712', summary: 'Communication logged · 2026 plan options (approved)' },
  { ref: 'W-0216', at: '2025-11-12T14:06:00-05:00', objectType: 'Case', op: 'update', recordId: 'C-2410', summary: 'Case closed · stayed on current plan' },
];

/** Decisions Keel prepared for other members earlier this week. Used on Performance & audit; they match each member's case lane. */
export const DECISIONS_EARLIER = [
  { id: 'DEC-2026-1018-LARSON', member: 'Donald Larson', what: 'Plan recommendation', outcome: 'Recommended Northlake Value (HMO)', note: 'Moving special period · 2 plans excluded', at: '2026-10-18T12:10:00-04:00', approvedBy: null, minutes: 5 },
  { id: 'DEC-2026-1017-WHITMAN', member: 'Barbara Whitman', what: 'Message check', outcome: 'Blocked: D-SNP offered before Medicaid approval', note: 'Corrected, then approved', at: '2026-10-17T10:15:00-04:00', approvedBy: 'Carol Sutton', minutes: 4 },
  { id: 'DEC-2026-1016-PARKER', member: 'Charles Parker', what: 'Plan recommendation', outcome: 'Stay on Northlake Choice (PPO)', note: 'All doctors and drugs still covered', at: '2026-10-16T16:40:00-04:00', approvedBy: 'Carol Sutton', minutes: 3 },
  { id: 'DEC-2026-1014-FOSTER', member: 'Evelyn Foster', what: 'Next action', outcome: 'Send renewal paperwork', note: 'No plan change needed', at: '2026-10-14T13:50:00-04:00', approvedBy: 'Carol Sutton', minutes: 2 },
];

/** Audit packages built earlier. */
export const AUDITS_EARLIER = [
  { id: 'AUD-2026-1017-WHITMAN', member: 'Barbara Whitman', at: '2026-10-17T10:40:00-04:00', files: 14 },
  { id: 'AUD-2026-1016-PARKER', member: 'Charles Parker', at: '2026-10-16T17:05:00-04:00', files: 14 },
  { id: 'AUD-2026-1014-FOSTER', member: 'Evelyn Foster', at: '2026-10-14T14:02:00-04:00', files: 11 },
  { id: 'AUD-2025-1112-HAYES', member: 'Dottie Hayes', at: '2025-11-14T11:30:00-05:00', files: 12 },
];

/** What Keel already prepared for each sample member: status pill, what it found, the next best action and where the case stands. */
export const MEMBER_BRIEFS = {
  'sample-m-02': { status: 'Needs info', tone: 'warn', found: 'Turned 65 this month, so her Initial Enrollment Period is open. No doctors or prescriptions on file yet, so no plan can be checked fairly.', next: 'Call her to collect doctors and prescriptions. Keel prepared the question list.', outcome: 'Call script ready · plan check runs as soon as her list is in' },
  'sample-m-03': { status: 'In review', tone: 'accent', found: 'Moved from Pinellas County, FL to Parma, OH. His Florida plan does not cover Ohio, so a moving special period lets him switch now.', next: 'Carol Sutton reviews the recommendation today.', outcome: 'Northlake Value (HMO) recommended · all 3 of his doctors in network' },
  'sample-m-04': { status: 'On hold', tone: 'warn', found: 'Medicaid application pending. A plan for people with both Medicare and Medicaid may fit once approved, but it cannot be offered before then.', next: 'Recheck on Nov 5, when the county decision is due.', outcome: 'An early message offering that plan was blocked by the rules and corrected' },
  'sample-m-05': { status: 'Waiting for reply', tone: 'neutral', found: 'Thinking of leaving over a $6 a month premium rise. His doctors and all 3 of his drugs stay covered in 2027.', next: 'Outreach sent Oct 16. Keel will flag his reply the moment it lands.', outcome: 'Retention message approved and sent · recommendation: stay on Northlake Choice (PPO)' },
  'sample-m-06': { status: 'Follow-up', tone: 'neutral', found: 'Renewing with no plan change. Asked for paper copies of her 2027 plan documents.', next: 'Confirm the documents arrived (task due Oct 24).', outcome: 'Renewal paperwork mailed Oct 14' },
  'sample-m-07': { status: 'Up next', tone: 'accent', found: 'His drug costs rose because Eliquis moved to a higher cost tier on his drug plan for 2027.', next: 'Keel checks other drug plans for him right after Dottie Hayes.', outcome: 'Queued for today' },
};

/** Week-to-date figures for the tiles, counted from the rows above plus today's case. */
export const WEEK = {
  prepared: DECISIONS_EARLIER.length + 1,
  blockedBeforeSending: DECISIONS_EARLIER.filter((d) => /Blocked/.test(d.outcome)).length,
  avgAgentMinutes: Math.round(DECISIONS_EARLIER.reduce((n, d) => n + d.minutes, 0) / DECISIONS_EARLIER.length),
};
