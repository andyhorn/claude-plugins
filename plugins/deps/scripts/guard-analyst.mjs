#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { evaluateGuard } from './lib/core/guard.mjs';

const ANALYST_AGENT = 'deps:update-analyst';

function deny(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

const raw = readFileSync(0, 'utf8');
let input;
try {
  input = JSON.parse(raw);
} catch {
  if (raw.includes(ANALYST_AGENT)) {
    deny(`${ANALYST_AGENT} is read-only: the hook input could not be parsed, so the command was denied`);
  }
  process.exit(0);
}

const verdict = evaluateGuard(input);
if (verdict.decision === 'deny') {
  deny(verdict.reason);
}
process.exit(0);
