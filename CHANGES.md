# Keel Medicare demo: demo-polish changes

These edits were made to the **packaged build** (v0-b955bda), not the source repo. The next `npm run package` will overwrite them. Copy each change into the matching source file, then run `npm test`. Some unit and Playwright tests assert the old copy and the old tour, so expect to update them; the list at the end names the likely ones.

## What changed for the audience

1. **Keel prepares the case by itself.** When a run starts, it runs the four preparation steps with no clicks: open case, read voicemail, check plans, draft and check the email. It stops before every human step (agent edit, supervisor approval). Add `?prep=0` to get the old click-every-step mode.
2. **Home leads with the outcome.** A "Dottie's case is ready for you" panel shows the four steps ticking live, then the result in one sentence, with Review and See-her-email buttons.
3. **Dottie's overview has an outcome strip.** Doctors kept, medicines covered, premium against her limit, and the cheaper plan turned down because Dr. Sullivan is out of network.
4. **No empty pages.** The Sandbox CRM tabs, Performance & audit, and the six sample members show clearly labelled sample history ("Earlier · sample history").
5. **New 10-stop tour.** Prepared → outcome → her words → why → email → blocked edit → approval → reply → replay → audit. It starts on the auto-prep stop and has 6 presenter clicks instead of 14.
6. **Plain language.** "Request changes" became "Edit and send". "Scripted edit" became "Agent edit". "Trace hash" became "Fingerprint". Workflow step boxes show words (Intake, Read, Gate…) instead of out-of-order numbers. Fallback wording became "Offline backup answer".
7. **Address bar shows `#member/dottie-hayes/...`.** The stored id stays `ben-hayes`, because the data is hashed; the router maps between the two.
8. **The demo starts without internet.** A failed model check now logs a warning and starts in offline mode instead of exiting.
9. **Clear AI setup errors.** Before, the chat only said "The agent is not configured correctly." Now it says which part is wrong: the key is missing or wrong (401), the key can't use the chat model (403/404), or OpenAI rejected the request (400). The black window prints OpenAI's exact error. At startup, a banner says whether live AI is off because of the network, the key or model access. The chat uses `gpt-6-sol`; the case steps use `gpt-6-luna`.
10. **No API key ships in the zip.** `.env` holds a placeholder; the README says to paste a new, spend-capped key.

## Files

| File | Change | Source to port into |
|---|---|---|
| `public/keel/autoprep.js` | **New.** Auto-runs the 4 prep steps through `run.next()`; exposes `prep`, `prepDone()`, `prepSeconds()` | same path |
| `public/keel/history.js` | **New.** Sample history: CRM earlier records, earlier writes, earlier decisions and audits, sample-member briefs, week figures. Move it to `server/data/author/` if you want it hashed like the other data | same path, or data authoring |
| `public/css/demo-polish.css` | **New.** Styles for the prep panel, outcome strip, briefs and history sections | same path |
| `public/index.html` | Links `demo-polish.css` | same |
| `public/keel/pages/home.js` | Prep panel (`prepPanelHTML`), "Prepared for you this week" tile, real sample statuses in the feed, "Ready for review" pill, Needs-attention wording; imports `autoprep.js` (which starts it) | same |
| `public/keel/pages/member.js` | `outcomeStrip()` above the recommendation; sample-member page rebuilt from `MEMBER_BRIEFS`; workflow boxes show `m.short` | same |
| `public/keel/pages/crm.js` | Earlier records under each object tab, earlier writes under the log, "No change" in the Before column, friendlier empty states | same |
| `public/keel/pages/performance.js` | Week summary line, earlier decisions, approvals and audits per tab, "Fingerprint" column, fallback wording | same |
| `public/keel/router.js` | `dottie-hayes` ↔ `ben-hayes` alias in `parseHash` and `formatHash` | same |
| `public/keel/run.js` | `action.rep-edit` label → "Edit and send" (testid unchanged) | same |
| `public/js/views-stage.js` | Links use the `dottie-hayes` address | same |
| `public/js/views-compliance.js` | "Scripted edit" chip → "Agent edit" | same |
| `public/js/steps.js`, `public/js/views-chrome.js` | Fallback wording | same |
| `public/js/guide.js` | Act names (Prepared / Governed / Preserved), `auto` stops show "Keel is working…", tour starts at stop 1 when it opens with an auto stop, fallback note wording | same |
| `public/guide-script.json` | New 10-stop script (schema version 6; adds an optional `auto: true` field, so update `scripts/guide-schema.ts`) | same + schema |
| `public/keel/live-ask.js` | Shows the server's specific setup message for `config` errors | same |
| `public/chat.js` | Home chips start with "What needs me today?" | same |
| `server.mjs` | Offline start (model check warns instead of exiting, with a banner naming network / key / model access); `configMessage()` turns 401/403/404/400 into specific chat messages and logs OpenAI's error; timeline and audit-report fallback wording | `server/index.ts`; the timeline strings live in the run engine, the badge in the audit report builder |
| `.env` | Placeholder key | `.env.example` / packaging script |
| `README-START-HERE.txt` | Key setup, offline note, `?prep=0`, 10-minute talk track | `scripts/package-demo.mjs` template |

## Tests likely to need updating

- Tour tests: new stop ids, titles and texts, act names, and the auto first stop.
- Copy tests that look for "Request changes", "Scripted edit", "Trace hash" or "Fallback output (live call failed)".
- E2E flows that click Open case, Read the voicemail, Check plans or Draft outreach: with autoprep those steps run by themselves. Use `?prep=0` in those tests, or drop the clicks.
- Home tile test for "Members in book".
- Router round-trip test: `formatHash('member', { id: 'ben-hayes' })` now returns `#member/dottie-hayes/overview`.

## Checked in this build

- The full tour was clicked end to end: all 10 stops completed with no console errors.
- The demo started with no internet and ran in offline mode.
- Live OpenAI calls were **not** tested; the sandbox had no internet. Run the tour once with a real key before a client demo. Prep takes about 6 seconds offline; with live AI expect roughly 15–30 seconds.
