# Rename notes
- Product renamed to **Keel** (was Arbor SalesIQ). Folder, CSS, env vars (KEEL_*), JS globals and audit schema ids follow.
- Characters renamed to American names:
  Margaret "Peg" Ellison -> Dorothy "Dottie" Hayes; Dr. Anita Okafor -> Dr. Karen Brennan; Dr. Samuel Reyes -> Dr. Steven Sullivan;
  Jordan Patel -> Ryan Mitchell; Dana Whitfield -> Carol Sutton; Ruth Kessler -> Frances Jennings; Luis Ortega -> Donald Larson;
  Eleanor Whitcomb -> Barbara Whitman; Gerald Pruitt -> Charles Parker; Nadia Farouk -> Evelyn Foster; Walter Hargrove -> George Holloway.
- Data hashes (snapshots, stored decision trace) recomputed; replay reproduces with a matching fingerprint.
- `.env` ships with an empty `OPENAI_API_KEY=`. With no key, the server now starts in offline mode instead of exiting.
- No Conceptvines references existed in the code.
