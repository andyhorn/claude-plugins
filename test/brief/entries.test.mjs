import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { readSavedEntries } from '../../plugins/brief/scripts/lib/io/entries.mjs';

const roots = [];

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brief-entries-')));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readSavedEntries', () => {
  it('reads the wrapped and flat layouts from <out_dir>/entries', async () => {
    const outDir = tempDir();
    mkdirSync(join(outDir, 'entries'));
    writeFileSync(join(outDir, 'entries', 'one.json'), JSON.stringify({ version: 3, id: 'x', data: { a: 1 } }));
    writeFileSync(join(outDir, 'entries', 'two.json'), JSON.stringify({ version: 4, doc_id: 'y', id: 'z', a: 2 }));
    writeFileSync(join(outDir, 'entries', 'three.json'), JSON.stringify({ a: 3 }));
    writeFileSync(join(outDir, 'entries', 'notes.txt'), 'ignored');
    const result = await readSavedEntries(outDir);
    assert.deepEqual(result, {
      entries: [
        { docId: 'one', version: 3, data: { a: 1 } },
        { docId: 'three', version: null, data: { a: 3 } },
        { docId: 'two', version: 4, data: { a: 2 } },
      ],
      unreadable: 0,
    });
  });

  it('accepts the entries directory itself', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'one.json'), JSON.stringify({ version: 1, data: { a: 1 } }));
    assert.equal((await readSavedEntries(dir)).entries.length, 1);
  });

  it('counts invalid files instead of throwing', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.json'), '{oops');
    writeFileSync(join(dir, 'list.json'), '[1,2]');
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ version: 1, data: {} }));
    const result = await readSavedEntries(dir);
    assert.equal(result.entries.length, 1);
    assert.equal(result.unreadable, 2);
  });

  it('treats a non-integer version as unknown', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'str.json'), JSON.stringify({ version: '3', data: { a: 1 } }));
    writeFileSync(join(dir, 'float.json'), JSON.stringify({ version: 1.5, data: { a: 2 } }));
    const { entries } = await readSavedEntries(dir);
    assert.deepEqual(entries.map((entry) => entry.version), [null, null]);
  });

  it('rejects when the directory is missing', async () => {
    await assert.rejects(readSavedEntries(join(tempDir(), 'missing')));
  });
});
