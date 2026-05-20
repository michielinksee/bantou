#!/usr/bin/env node
// Reset demo state — clears the demo memory file.
// Run this before each demo to start fresh.

import { existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = join(__dirname, '..', '.demo-memory.json');

if (existsSync(MEMORY_PATH)) {
  unlinkSync(MEMORY_PATH);
  console.log(`✓ Demo memory cleared: ${MEMORY_PATH}`);
} else {
  console.log(`✓ Demo memory already clean (no file at ${MEMORY_PATH})`);
}

console.log('\nReady for demo. Run:');
console.log('  node demo/run-demo.mjs');
