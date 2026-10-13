import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countStatusRecords, parseWorktreeList } from '../../plugins/brief/scripts/lib/io/git.mjs';

const nul = (...fields) => `${fields.join('\0')}\0`;

describe('parseWorktreeList', () => {
  it('parses main, linked, detached, bare and prunable records', () => {
    const text = [
      nul('worktree /r/main', 'HEAD aaaa111', 'branch refs/heads/main'),
      nul('worktree /r/feat', 'HEAD bbbb222', 'branch refs/heads/feat/x', 'locked'),
      nul('worktree /r/det', 'HEAD cccc333', 'detached'),
      nul('worktree /r/gone', 'HEAD dddd444', 'branch refs/heads/old', 'prunable gitdir file points to non-existent location'),
      nul('worktree /r/bare.git', 'bare'),
    ].join('\0');
    assert.deepEqual(parseWorktreeList(text), [
      { path: '/r/main', head: 'aaaa111', branch: 'main', bare: false, prunable: false, isMain: true },
      { path: '/r/feat', head: 'bbbb222', branch: 'feat/x', bare: false, prunable: false, isMain: false },
      { path: '/r/det', head: 'cccc333', branch: null, bare: false, prunable: false, isMain: false },
      { path: '/r/gone', head: 'dddd444', branch: 'old', bare: false, prunable: true, isMain: false },
      { path: '/r/bare.git', head: null, branch: null, bare: true, prunable: false, isMain: false },
    ]);
  });

  it('keeps spaces in paths and maps an unborn head to null', () => {
    const text = nul('worktree /r/my repo', `HEAD ${'0'.repeat(40)}`, 'branch refs/heads/main');
    const [row] = parseWorktreeList(text);
    assert.equal(row.path, '/r/my repo');
    assert.equal(row.head, null);
  });

  it('returns an empty list for empty output', () => {
    assert.deepEqual(parseWorktreeList(''), []);
  });
});

describe('countStatusRecords', () => {
  it('counts one record per entry', () => {
    assert.equal(countStatusRecords(nul(' M a.txt', '?? b.txt', 'A  c.txt')), 3);
  });

  it('counts a rename or copy as one record', () => {
    assert.equal(countStatusRecords(nul('R  new.txt', 'old.txt', ' M a.txt', 'C  copy.txt', 'src.txt')), 3);
    assert.equal(countStatusRecords(nul(' R new.txt', 'old.txt')), 1);
  });

  it('is zero for a clean tree', () => {
    assert.equal(countStatusRecords(''), 0);
  });
});
