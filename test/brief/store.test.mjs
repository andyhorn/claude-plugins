import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { readState, writeState } from '../../plugins/brief/scripts/lib/io/store.mjs';

const URL_OK = 'https://claude.ai/artifact/abc';
const roots = [];

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brief-store-')));
  roots.push(dir);
  return dir;
}

function dirWithState(content) {
  const dir = tempDir();
  writeFileSync(join(dir, 'state.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

after(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readState', () => {
  it('returns null for a missing directory or file', async () => {
    assert.equal(await readState(join(tempDir(), 'missing')), null);
    assert.equal(await readState(tempDir()), null);
  });

  it('returns null for invalid JSON', async () => {
    assert.equal(await readState(dirWithState('{oops')), null);
  });

  for (const [label, content] of [['null', 'null'], ['an array', '[]'], ['a number', '3'], ['a string', '"x"']]) {
    it(`returns null when the JSON is ${label}`, async () => {
      assert.equal(await readState(dirWithState(content)), null);
    });
  }

  it('returns null for a foreign or missing url', async () => {
    assert.equal(await readState(dirWithState({ url: 'https://evil.example/artifact/x', pageVersion: 1 })), null);
    assert.equal(await readState(dirWithState({ url: 'https://claude.ai/artifact/x?y', pageVersion: 1 })), null);
    assert.equal(await readState(dirWithState({ pageVersion: 1 })), null);
    assert.equal(await readState(dirWithState({ url: 42, pageVersion: 1 })), null);
  });

  const badVersions = [['missing', undefined], ['a string', '2'], ['a float', 1.5], ['zero', 0], ['negative', -1], ['unsafe', 2 ** 60]];
  for (const [label, pageVersion] of badVersions) {
    it(`returns null when pageVersion is ${label}`, async () => {
      assert.equal(await readState(dirWithState({ url: URL_OK, pageVersion })), null);
    });
  }

  it('returns only url and pageVersion for a valid state', async () => {
    const dir = dirWithState({ url: URL_OK, pageVersion: 3, extra: true });
    assert.deepEqual(await readState(dir), { url: URL_OK, pageVersion: 3 });
  });
});

describe('writeState', () => {
  it('creates the directory, round-trips and leaves no temporary files', async () => {
    const dir = join(tempDir(), 'nested', 'data');
    await writeState(dir, { url: URL_OK, pageVersion: 2 });
    assert.deepEqual(await readState(dir), { url: URL_OK, pageVersion: 2 });
    assert.deepEqual(readdirSync(dir), ['state.json']);
  });

  it('replaces an earlier state', async () => {
    const dir = tempDir();
    await writeState(dir, { url: URL_OK, pageVersion: 1 });
    await writeState(dir, { url: URL_OK, pageVersion: 4 });
    assert.deepEqual(await readState(dir), { url: URL_OK, pageVersion: 4 });
  });
});
