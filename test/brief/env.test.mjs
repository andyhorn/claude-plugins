import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { describe, it } from 'node:test';

import { createEnv } from '../../plugins/brief/scripts/lib/io/env.mjs';

describe('createEnv', () => {
  const env = createEnv();

  it('returns the current time as a Date', () => {
    const before = Date.now();
    const now = env.now();
    assert.ok(now instanceof Date);
    assert.ok(now.getTime() >= before && now.getTime() <= Date.now());
  });

  it('generates six lowercase base36 characters', () => {
    for (let index = 0; index < 200; index += 1) {
      assert.match(env.newId(), /^[0-9a-z]{6}$/);
    }
  });

  it('generates varying ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => env.newId()));
    assert.ok(ids.size > 1);
  });

  it('reports the machine hostname', () => {
    assert.notEqual(env.hostname(), '');
    assert.equal(env.hostname(), hostname());
  });

  it('hashes with SHA-1 in hex', () => {
    const expected = createHash('sha1').update('/some/path').digest('hex');
    assert.equal(env.sha1('/some/path'), expected);
    assert.match(env.sha1(''), /^[0-9a-f]{40}$/);
  });
});
