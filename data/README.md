# data/

Synthetic scenario data for the Keel Medicare demo (see `notes/data-realism-spec.md`); drug names, counties, ZIP codes and CMS parameters are real public reference data; people, carriers, plans and providers are invented. Every record carries `fictional: true`. Owner: WP1.

Do not edit the JSON by hand. Edit `server/data/author/*.ts` and run `npx tsx server/data/author/index.ts`; the hashes are computed there. `tests/unit/data/scenario.test.ts` fails when a file differs from the script.

## Files

| Path | Shape (`shared/contracts.ts`) |
|---|---|
| `snapshots/snap-2025-10-15-py2026.json`, `snapshots/snap-2026-10-15-py2027.json` | `DataSnapshot` |
| `rules/pack-2025.3.json`, `rules/pack-2026.2.json` | `RulePack` (20 rules each, 3 disclosures) |
| `decisions/DEC-2025-1112-HAYES.input.json` | `StoredDecisionInput` (WP2 adds the `.trace.json` next to it) |
| `scenario/hayes-2027.json` | `ScenarioConfig` |
| `scenario/member-reply.json` | `SimulatedReply` (the scripted member reply) |
| `seeded-rep-edit.json` | `SeededRepEdit` (quotes noncompliant wording on purpose; the copy guard allowlists this file name) |
| `../server/signal/fallbacks/*.json` | `FallbackFile<...>`: `interpret-voicemail`, `interpret-reply`, `draft-outreach` (WP3 loads them) |

## Loader API (`server/data/load.ts`, `resolve.ts`, `scenario.ts`)

`loadSnapshot(id)`, `loadSnapshots()`, `snapshotAsOf(dateOrInstant, snapshots?)`, `relationsAsOf(snapshot, dateOrInstant)`, `entitiesOfKind(snapshot, kind)`, `loadRulePack(id)`, `loadRulePacks()`, `packAsOf(dateOrInstant, packs?)`, `verifySnapshot`, `verifyPack`, `etDate`, `loadScenarioConfig()`, `loadStoredDecisionInput(id)`, `loadSeededRepEdit()`, `loadSimulatedReply()`, `buildScenarioView()`, `createResolver(snapshot)`, `resolveDrug(name)`, `resolveProvider(name)`.

Loading validates with zod and re-computes `contentHash`; a bad file throws `DataIntegrityError`. Loaded objects are shared and cached: clone before changing. `server/rules/` must not import these (it is pure); WP4 loads and passes objects in.

Canonical JSON and SHA-256 (`server/data/hash.ts`): sorted keys at every depth, no whitespace, `undefined` members omitted. `contentHash` is the SHA-256 of the canonical JSON of the record without its `contentHash`.

## Conventions the rules and the signal layer rely on

- Entity ids are the same across both snapshots (`plan-H9701-011`, `prov-sullivan`, `fe-H9701-011-jardiance`, `ep-aep`); values differ by snapshot, so a diff matches by id.
- Plans: `plan-<contractPlanId>`; formularies `form-<contractPlanId>`; entries `fe-<contractPlanId>-<drug>` with drugs `eliquis`, `jardiance`, `atorvastatin`, `metformin-er`.
- A relation is visible on `d` when `validFrom <= d < validTo`. Plan-year facts (`OFFERED_IN`, `IN_NETWORK`, `HAS_FORMULARY`, `LISTS_DRUG`) are evaluated on the first day of the plan year (`planYear-01-01`). Advantage Plus `OFFERED_IN` ends with `validTo: 2027-01-01` (last day 2026-12-31).
- A provider or facility is out of network when it has no `IN_NETWORK` relation to the plan. The PDP lists everyone with `attrs.basis = "original-medicare"`.
- `snap-2026-10-15-py2027` also holds the member and communication records current to 2026-10-19 (consents, voicemail); the relations' `validFrom` keeps them invisible before that date.
- Fact ids used by the fallback draft: `fact:nonrenewal:<contractPlanId>`, `fact:election:<electionPeriodId>`, `fact:premium:<contractPlanId>`, `fact:network:<contractPlanId>:<providerId>`, `fact:formulary:<contractPlanId>:<drugId>`, `fact:copay:<contractPlanId>:<drugId>`, `fact:priorauth:<contractPlanId>:<drugId>`, `fact:pref:max-premium`. WP2 must produce the same ids or tell WP1 to change the fixture.
- Condition facts used by `appliesWhen`: `draft.channel` (`email|mail|phone|sms`) and `sender.employer` (`carrier|tpmo`).
- Rule params are a starting contract with the evaluators (see `server/data/author/rules.ts`); WP2 may ask WP1 to change them. `fix.params.template` placeholders are filled only from snapshot facts: `{county}`, `{planYear}`, `{mustKeepProviders}`, `{drugCountWord}`, `{minCopay}`, `{maxCopay}`, `{planName}`, `{planType}`, `{starRating}`, `{ratingYear}`, `{organizationCount}`, `{planCount}`.
- Severity: `block` stops delivery and is a "violation"; `hold` needs an action the gate can take (append a disclosure, route to approval); `warn` and `info` never stop a message.

## Provenance and caveats

- Part D deductible and out-of-pocket threshold: CY2027 Rate Announcement, Tables V-2 and V-6 (primary, checked 2026-10-20).
- MA in-network MOOP ceiling ($9,250 and $9,850): secondary source only, labelled `illustrative` in `params.verified`.
- Part B 2027 premium: not announced; stored as `null`.
- The CY2027 final rule removing the 48-hour Scope of Appointment wait took effect 2026-06-01 and applies to CY2027 marketing from 2026-10-01 (`WF-SOA` v3; verified 2026-10-20, `notes/compliance-review.md`). The D-SNP citation (42 CFR 422.2, 422.52(b)) is verified. The model sentences for the federal contracting statement and the Star Ratings statement are illustrative. `COST-ANNUAL` v1 (no out-of-pocket cap) is **fictional** rule behaviour invented for the replay; real 2026 Part D caps out-of-pocket drug spend at $2,100. Pack 2025.3 cites the eCFR text in force until 2026-05-31 (old numbering, superlatives paragraph, TPMO text naming the State Health Insurance Program).
- Policy rules (`basis: "policy"`) cite a `policy:` URL and are marked illustrative.
