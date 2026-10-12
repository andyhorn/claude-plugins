import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs } from 'node:util';

import { PARSE_OPTIONS, validateArgs } from '../../plugins/brief/scripts/lib/core/args.mjs';

function validate(argv) {
  return validateArgs(parseArgs({ args: argv, ...PARSE_OPTIONS }));
}

function assertRejected(argv, pattern) {
  const result = validate(argv);
  assert.equal(result.ok, false);
  assert.match(result.error, pattern);
}

const URL_OK = 'https://claude.ai/code/artifact/abc-123';

describe('validateArgs', () => {
  it('accepts state without a set', () => {
    assert.deepEqual(validate(['state', '--data', '/d']), { ok: true, command: 'state', data: '/d', set: null });
  });

  it('accepts state with a set', () => {
    assert.deepEqual(validate(['state', '--data', '/d', '--set-url', URL_OK, '--page-version', '3']), {
      ok: true,
      command: 'state',
      data: '/d',
      set: { url: URL_OK, pageVersion: 3 },
    });
  });

  it('requires set-url and page-version together', () => {
    assertRejected(['state', '--data', '/d', '--set-url', URL_OK], /--set-url and --page-version together/);
    assertRejected(['state', '--data', '/d', '--page-version', '1'], /--set-url and --page-version together/);
  });

  const badVersions = ['0', '01', '-1', '1.5', 'x', '', '9007199254740993'];
  for (const version of badVersions) {
    it(`rejects page-version ${JSON.stringify(version)}`, () => {
      assertRejected(['state', '--data', '/d', '--set-url', URL_OK, `--page-version=${version}`], /--page-version must be a positive integer/);
    });
  }

  it('rejects set-url values that are not claude.ai artifact urls', () => {
    assertRejected(['state', '--data', '/d', '--set-url', 'https://evil.example/artifact/x', '--page-version', '1'], /--set-url must be a claude\.ai artifact URL/);
  });

  it('parses context, worktrees and tidy', () => {
    assert.deepEqual(validate(['context', '--data', '/d']), { ok: true, command: 'context', data: '/d', cwd: null });
    assert.deepEqual(validate(['context', '--data', '/d', '--cwd', '/w']), { ok: true, command: 'context', data: '/d', cwd: '/w' });
    assert.deepEqual(validate(['worktrees', '--data', '/d']), { ok: true, command: 'worktrees', data: '/d', pr: false });
    assert.deepEqual(validate(['worktrees', '--data', '/d', '--pr']), { ok: true, command: 'worktrees', data: '/d', pr: true });
    assert.deepEqual(validate(['tidy', '--data', '/d', '--entries', '/e']), { ok: true, command: 'tidy', data: '/d', entries: '/e' });
  });

  it('requires --data to be present and absolute', () => {
    assertRejected(['state'], /state requires --data/);
    assertRejected(['state', '--data', 'rel'], /--data must be an absolute path/);
    assertRejected(['state', '--data', '${CLAUDE_PLUGIN_DATA}'], /--data must be an absolute path/);
  });

  it('requires tidy --entries, absolute', () => {
    assertRejected(['tidy', '--data', '/d'], /tidy requires --entries/);
    assertRejected(['tidy', '--data', '/d', '--entries', 'rel'], /--entries must be an absolute path/);
  });

  it('requires an absolute --cwd', () => {
    assertRejected(['context', '--data', '/d', '--cwd', 'rel'], /--cwd must be an absolute path/);
  });

  describe('foreign options', () => {
    const flags = {
      'set-url': ['--set-url', URL_OK],
      'page-version': ['--page-version', '1'],
      cwd: ['--cwd', '/w'],
      pr: ['--pr'],
      entries: ['--entries', '/e'],
    };
    const foreign = {
      state: ['cwd', 'pr', 'entries'],
      context: ['set-url', 'page-version', 'pr', 'entries'],
      worktrees: ['set-url', 'page-version', 'cwd', 'entries'],
      tidy: ['set-url', 'page-version', 'cwd', 'pr'],
    };
    const required = { state: [], context: [], worktrees: [], tidy: ['--entries', '/e'] };

    for (const [command, names] of Object.entries(foreign)) {
      for (const name of names) {
        it(`rejects --${name} for ${command}`, () => {
          assertRejected([command, '--data', '/d', ...required[command], ...flags[name]], new RegExp(`--${name} does not apply to ${command}`));
        });
      }
    }
  });

  it('rejects a missing, unknown or doubled command', () => {
    assertRejected([], /missing command/);
    assertRejected(['nope', '--data', '/d'], /unknown command: nope/);
    assertRejected(['state', 'context', '--data', '/d'], /state takes no extra arguments/);
  });
});
