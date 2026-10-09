#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { ANALYST_AGENT, evaluateGuard } from './lib/core/guard.mjs';

/**
 * Decides the hook outcome for one raw PreToolUse payload.
 *
 * Any failure on an analyst payload denies, because Claude Code treats a hook exit code other
 * than 2 as non-blocking and would run the command.
 *
 * @param {string} raw - The hook's stdin.
 * @param {(input: object) => { decision: 'allow' | 'deny', reason?: string }} [evaluate] - The guard.
 * @returns {{ code: 0 | 2, message?: string }} Exit code and the stderr message for a denial.
 */
export function runGuard(raw, evaluate = evaluateGuard) {
  const isAnalyst = raw.includes(ANALYST_AGENT);
  try {
    const verdict = evaluate(JSON.parse(raw));
    return verdict.decision === 'deny' ? { code: 2, message: verdict.reason } : { code: 0 };
  } catch {
    return isAnalyst
      ? { code: 2, message: `${ANALYST_AGENT} is read-only: the hook input could not be evaluated, so the command was denied` }
      : { code: 0 };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runGuard(readFileSync(0, 'utf8'));
  if (result.message) {
    process.stderr.write(`${result.message}\n`);
  }
  process.exit(result.code);
}
