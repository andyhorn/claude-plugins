import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs } from 'node:util';

import { PARSE_OPTIONS, validateArgs } from '../../plugins/deps/scripts/lib/core/args.mjs';

function validate(argv) {
  return validateArgs(parseArgs({ ...PARSE_OPTIONS, args: argv }));
}

describe('PARSE_OPTIONS', () => {
  it('is strict and declares the two string options', () => {
    assert.equal(PARSE_OPTIONS.strict, true);
    assert.equal(PARSE_OPTIONS.allowPositionals, true);
    assert.deepEqual(PARSE_OPTIONS.options, {
      pr: { type: 'string' },
      'body-file': { type: 'string' },
    });
  });

  it('makes parseArgs reject unknown flags', () => {
    assert.throws(() => parseArgs({ ...PARSE_OPTIONS, args: ['collect', '--bogus'] }));
  });
});

describe('validateArgs collect', () => {
  it('accepts collect with no PR', () => {
    assert.deepEqual(validate(['collect']), { ok: true, command: 'collect', pr: null });
  });

  it('accepts collect with a PR number', () => {
    assert.deepEqual(validate(['collect', '42']), { ok: true, command: 'collect', pr: 42 });
  });

  it('rejects anything that is not a plain positive integer', () => {
    for (const bad of ['0', '-1', '01', '1.5', '1e3', ' 7', '7 ', 'abc', '', '99999999999999999999']) {
      const result = validateArgs({ values: {}, positionals: ['collect', bad] });
      assert.equal(result.ok, false, `accepted ${JSON.stringify(bad)}`);
      assert.match(result.error, /positive integer/);
    }
  });

  it('rejects extra positionals', () => {
    assert.equal(validate(['collect', '1', '2']).ok, false);
  });

  it('rejects --pr and --body-file', () => {
    assert.equal(validate(['collect', '--pr', '3']).ok, false);
    assert.equal(validate(['collect', '--body-file', 'x.md']).ok, false);
  });
});

describe('validateArgs comment', () => {
  it('accepts --pr and --body-file', () => {
    assert.deepEqual(validate(['comment', '--pr', '7', '--body-file', '/tmp/body.md']), {
      ok: true,
      command: 'comment',
      pr: 7,
      bodyFile: '/tmp/body.md',
    });
  });

  it('requires --pr', () => {
    const result = validate(['comment', '--body-file', 'b.md']);
    assert.equal(result.ok, false);
    assert.match(result.error, /--pr/);
  });

  it('rejects a bad --pr', () => {
    assert.equal(validate(['comment', '--pr', '0', '--body-file', 'b.md']).ok, false);
    assert.equal(validate(['comment', '--pr', 'x', '--body-file', 'b.md']).ok, false);
  });

  it('requires a non-empty --body-file', () => {
    assert.match(validate(['comment', '--pr', '7']).error, /--body-file/);
    assert.equal(validate(['comment', '--pr', '7', '--body-file', '']).ok, false);
  });

  it('rejects positionals', () => {
    assert.equal(validate(['comment', '7', '--pr', '7', '--body-file', 'b.md']).ok, false);
  });
});

describe('validateArgs command', () => {
  it('rejects an unknown command and lists the valid ones', () => {
    const result = validate(['merge']);
    assert.equal(result.ok, false);
    assert.match(result.error, /unknown command: merge/);
    assert.match(result.error, /collect, comment/);
  });

  it('rejects a missing command', () => {
    const result = validate([]);
    assert.equal(result.ok, false);
    assert.match(result.error, /missing command/);
    assert.match(result.error, /collect, comment/);
  });
});
