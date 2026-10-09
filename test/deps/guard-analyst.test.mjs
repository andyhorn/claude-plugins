import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const SCRIPT = new URL('../../plugins/deps/scripts/guard-analyst.mjs', import.meta.url).pathname;

function runGuard(input) {
  return spawnSync('node', [SCRIPT], { input, encoding: 'utf8' });
}

function hookInput(agentType, command) {
  return JSON.stringify({ agent_type: agentType, tool_name: 'Bash', tool_input: { command } });
}

describe('guard-analyst', () => {
  it('denies a GitHub write by the analyst', () => {
    const result = runGuard(hookInput('deps:update-analyst', 'gh pr comment 1 --body x'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /read-only/);
  });

  it('allows a read by the analyst with no output', () => {
    const result = runGuard(hookInput('deps:update-analyst', 'gh pr view 1'));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('allows the main thread to write', () => {
    const result = runGuard(hookInput(null, 'gh pr comment 1 --body x'));
    assert.equal(result.status, 0);
  });

  it('denies malformed input that mentions the analyst', () => {
    const result = runGuard('{"agent_type":"deps:update-analyst", oops');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /deps:update-analyst/);
  });

  it('allows other malformed input', () => {
    assert.equal(runGuard('not json').status, 0);
  });
});
