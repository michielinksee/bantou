#!/usr/bin/env node
// CLI entry for the freee connection doctor.
//   npm run doctor:freee     (or: npx tsx src/bin/freee-doctor.ts)
// Prints the diagnostic as JSON. NEVER prints the access token.

import { runFreeeDoctor } from '../freee-doctor.js';

runFreeeDoctor()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message ?? String(err) }, null, 2));
    process.exit(1);
  });
