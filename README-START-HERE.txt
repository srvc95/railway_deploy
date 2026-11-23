Keel, Medicare retention demo - START HERE
====================================================

BEFORE THE FIRST RUN
1. Unzip the whole folder anywhere (a normal folder, not inside the zip viewer).
2. Open the file .env in Notepad and paste an OpenAI key after OPENAI_API_KEY= (it ships empty).
   Use a NEW key with a low spending limit. Keep this folder private once the key is in it.

TO RUN
3. Double-click start.bat. A black window opens; keep it open during the demo.
4. Your browser opens by itself with the guided tour (the first start can take up to a minute).
5. Close the browser tab when done: Keel stops by itself.

NO INTERNET? It still works. If OpenAI cannot be reached (client Wi-Fi) or the key is empty, the demo starts in
offline mode and the AI steps use prepared backup answers. The black window says so.

Tour on/off: Alt+G, or add ?guide=0 / ?guide=1 to the address.
Old click-every-step mode (Keel does not prepare the case by itself): add ?prep=0 to the address.
If port 3000 is busy: open a command prompt in this folder, run  set PORT=3010  then  start.bat

THE 10-MINUTE TALK TRACK (the tour follows it)
Act 1 - Prepared
  1. Home: Keel prepares Dottie's case on its own. Say nothing; let the room watch the four steps tick.
     Line: "Nobody asked it to do this. This is what Ryan finds when he opens his laptop."
  2. Outcome: she keeps both doctors and all 4 medicines for $18 a month.
     Line: "The cheaper plan would have cost her her heart doctor. Keel caught that."
  3. Her words: every preference quotes the voicemail. Nothing is made up.
  4. Why this plan: every rule, version and record behind the choice.
Act 2 - Governed
  5. Her email is written and checked.
  6. Ryan edits it to text her that drugs are "free". Blocked: 4 rules, she asked not to be texted.
     Line: "This is the mistake that gets agencies fined. It never left the building."
  7. Supervisor approves. Email sent, CRM updated, follow-up task and prior-approval case opened.
Act 3 - Preserved
  8. Dottie replies. Keel reads it and sets the next action.
  9. Replay last year's decision with last year's rules: same result, same fingerprint.
 10. Audit package: "Prepared, governed, preserved."

Build: v0-b955bda + demo-polish (see CHANGES.md)
