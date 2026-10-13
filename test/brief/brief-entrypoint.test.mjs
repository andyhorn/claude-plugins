import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('../../plugins/brief/scripts/', import.meta.url));
const roots = [];

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brief-entry-')));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const dir of roots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runScript(script, data) {
  return spawnSync(process.execPath, [script, 'state', '--data', data], { encoding: 'utf8' });
}

describe('brief.mjs as a process', () => {
  it('runs when invoked directly', () => {
    const result = runScript(join(SCRIPTS_DIR, 'brief.mjs'), tempDir());
    assert.equal(result.status, 4);
    assert.match(result.stderr, /brief is not set up; run \/brief/);
    assert.equal(result.stdout, '');
  });

  it('runs when invoked through a symlinked directory', () => {
    const link = join(tempDir(), 'scripts-link');
    symlinkSync(SCRIPTS_DIR, link);
    const result = runScript(join(link, 'brief.mjs'), tempDir());
    assert.equal(result.status, 4);
    assert.match(result.stderr, /brief is not set up; run \/brief/);
  });

  it('runs when invoked through a symlink to the file', () => {
    const link = join(tempDir(), 'brief-link.mjs');
    symlinkSync(join(SCRIPTS_DIR, 'brief.mjs'), link);
    const result = runScript(link, tempDir());
    assert.equal(result.status, 4);
  });

  it('prints usage and exits 2 for a bad command line', () => {
    const result = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'brief.mjs'), 'nope'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: brief\.mjs/);
  });
});
