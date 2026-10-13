import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planTidy } from '../../plugins/brief/scripts/lib/core/tidy.mjs';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const REPO = 'github.com/acme/widgets';
const HOST = 'laptop';
const MAIN = '/w/main';
const LIVE = '/w/live';

const WORKTREES = [
  { path: MAIN, isMain: true, prunable: false },
  { path: LIVE, isMain: false, prunable: false },
];

function counter() {
  let n = 0;
  return () => {
    n += 1;
    return `r${String(n).padStart(5, '0')}`;
  };
}

function entry(docId, overrides = {}, { version = 1 } = {}) {
  return {
    docId,
    version,
    data: {
      v: 1,
      repo: REPO,
      repoName: 'widgets',
      host: HOST,
      worktree: LIVE,
      branch: 'feat/x',
      head: 'abc1234',
      ts: '2026-10-08T10:00:00Z',
      status: 'working',
      changed: 'did things',
      decided: [],
      next: 'more',
      needs_you: null,
      pr: null,
      ...overrides,
    },
  };
}

function plan(overrides) {
  return planTidy({ entries: [], worktrees: WORKTREES, prs: [], repo: REPO, host: HOST, now: NOW, newId: counter(), exists: () => false, ...overrides });
}

function archived(result) {
  return result.archive.flat();
}

function pruned(result) {
  return result.prune.flat();
}

describe('planTidy archive', () => {
  it('archives a worktree that was removed, with exact fields', () => {
    const gone = entry('20261008T100000Z-aaaaaa', { worktree: '/w/gone', pr: 12 });
    const result = plan({ entries: [gone] });
    assert.deepEqual(result.archive, [
      [
        {
          op: 'set',
          collection: 'entries',
          doc_id: '20261009T120000Z-r00001',
          data: {
            v: 1,
            repo: REPO,
            repoName: 'widgets',
            host: HOST,
            worktree: '/w/gone',
            branch: 'feat/x',
            head: 'abc1234',
            ts: '2026-10-09T12:00:00Z',
            status: 'archived',
            changed: 'Worktree removed.',
            decided: [],
            next: '',
            needs_you: null,
            pr: 12,
          },
        },
      ],
    ]);
    assert.deepEqual(result.prune, []);
    assert.equal(result.skipped, 0);
  });

  it('treats a prunable worktree as removed', () => {
    const worktrees = [WORKTREES[0], { path: LIVE, isMain: false, prunable: true }];
    const result = plan({ entries: [entry('a-1')], worktrees });
    assert.equal(archived(result)[0].data.changed, 'Worktree removed.');
  });

  const merged = (mergedAt) => [{ number: 5, state: 'MERGED', mergedAt, headRefName: 'feat/x' }];

  it('archives when the branch PR merged after the latest entry', () => {
    const result = plan({ entries: [entry('a-1')], prs: merged('2026-10-09T09:00:00Z') });
    const [write] = archived(result);
    assert.equal(write.data.changed, 'PR #5 merged.');
    assert.equal(write.data.pr, 5);
  });

  it('does not archive when the PR merged before the latest entry', () => {
    const result = plan({ entries: [entry('a-1')], prs: merged('2026-10-08T09:00:00Z') });
    assert.deepEqual(result.archive, []);
  });

  it('compares merge time as instants, not text', () => {
    const result = plan({ entries: [entry('a-1')], prs: merged('2026-10-08T11:30:00+02:00') });
    assert.deepEqual(result.archive, []);
  });

  it('does not archive on a PR that is only open', () => {
    const prs = [{ number: 5, state: 'OPEN', mergedAt: null, headRefName: 'feat/x' }];
    assert.deepEqual(plan({ entries: [entry('a-1')], prs }).archive, []);
  });

  it('lets an open PR on the same branch beat an older merged one', () => {
    const prs = [
      { number: 5, state: 'MERGED', mergedAt: '2026-10-09T09:00:00Z', headRefName: 'feat/x' },
      { number: 6, state: 'OPEN', mergedAt: null, headRefName: 'feat/x' },
    ];
    assert.deepEqual(plan({ entries: [entry('a-1')], prs }).archive, []);
  });

  it('never archives the main worktree', () => {
    const worktrees = [{ path: '/w/elsewhere', isMain: true, prunable: false }, WORKTREES[1]];
    const result = plan({ entries: [entry('a-1', { worktree: '/w/elsewhere' })], worktrees });
    assert.deepEqual(result.archive, []);
  });

  it('never archives the main worktree when it merged a PR', () => {
    const prs = merged('2026-10-09T09:00:00Z');
    const result = plan({ entries: [entry('a-1', { worktree: MAIN })], prs });
    assert.deepEqual(result.archive, []);
  });

  it('skips a worktree whose latest entry is already archived', () => {
    const result = plan({ entries: [entry('a-1', { worktree: '/w/gone', status: 'archived' })] });
    assert.deepEqual(result.archive, []);
  });

  it('archives again when a newer entry follows an archive', () => {
    const entries = [
      entry('a-1', { worktree: '/w/gone', status: 'archived', ts: '2026-10-01T00:00:00Z' }),
      entry('a-2', { worktree: '/w/gone', status: 'working', ts: '2026-10-02T00:00:00Z' }),
    ];
    assert.equal(archived(plan({ entries })).length, 1);
  });

  it('ignores other hosts and other repos', () => {
    const entries = [
      entry('a-1', { worktree: '/w/gone-a', host: 'desktop' }),
      entry('a-2', { worktree: '/w/gone-b', repo: 'github.com/acme/other' }),
    ];
    assert.deepEqual(plan({ entries }).archive, []);
  });

  it('ignores entries missing host, worktree or ts', () => {
    const entries = [
      entry('a-1', { host: undefined, worktree: '/w/gone-a' }),
      entry('a-2', { worktree: undefined }),
      entry('a-3', { ts: undefined, worktree: '/w/gone-c' }),
    ];
    assert.deepEqual(plan({ entries }), { archive: [], prune: [], skipped: 0 });
  });

  it('uses the latest entry, breaking ts ties by larger docId', () => {
    const entries = [
      entry('20261008T100000Z-aaaaaa', { worktree: '/w/gone', branch: 'older', ts: '2026-10-08T10:00:00Z' }),
      entry('20261008T100000Z-zzzzzz', { worktree: '/w/gone', branch: 'newer', ts: '2026-10-08T10:00:00Z' }),
    ];
    const [write] = archived(plan({ entries }));
    assert.equal(write.data.branch, 'newer');
  });

  it('builds each archive doc id from the injected clock and id source', () => {
    const entries = [entry('a-1', { worktree: '/w/gone-a' }), entry('a-2', { worktree: '/w/gone-b' })];
    const ids = archived(plan({ entries })).map((write) => write.doc_id);
    assert.deepEqual(ids, ['20261009T120000Z-r00001', '20261009T120000Z-r00002']);
  });

  it('does not archive a worktree that is absent from the list but still exists on disk', () => {
    const stillThere = new Set(['/w/other-clone']);
    const entries = [entry('a-1', { worktree: '/w/other-clone' }), entry('a-2', { worktree: '/w/gone' })];
    const result = plan({ entries, exists: (path) => stillThere.has(path) });
    assert.deepEqual(archived(result).map((write) => write.data.worktree), ['/w/gone']);
  });

  it('checks the worktree path itself', () => {
    const asked = [];
    plan({ entries: [entry('a-1', { worktree: '/w/gone' })], exists: (path) => asked.push(path) && false });
    assert.deepEqual(asked, ['/w/gone']);
  });

  it('does not consult the disk for worktrees that are still listed', () => {
    const result = plan({ entries: [entry('a-1')], exists: () => assert.fail('exists should not be called') });
    assert.deepEqual(result.archive, []);
  });

  it('writes nulls for fields a sparse entry lacks', () => {
    const sparse = entry('a-1', { worktree: '/w/gone', repoName: undefined, branch: undefined, head: undefined });
    const [write] = archived(plan({ entries: [sparse] }));
    assert.equal(write.data.repoName, null);
    assert.equal(write.data.branch, null);
    assert.equal(write.data.head, null);
    assert.equal(write.data.pr, null);
  });

  it('does not archive when the PR merged at exactly the latest entry time', () => {
    const prs = [{ number: 5, state: 'MERGED', mergedAt: '2026-10-08T10:00:00Z', headRefName: 'feat/x' }];
    assert.deepEqual(plan({ entries: [entry('a-1')], prs }).archive, []);
  });

  it('archives when the PR merged one second after the latest entry', () => {
    const prs = [{ number: 5, state: 'MERGED', mergedAt: '2026-10-08T10:00:01Z', headRefName: 'feat/x' }];
    assert.equal(archived(plan({ entries: [entry('a-1')], prs })).length, 1);
  });

  it('ignores a merged pull request from a fork', () => {
    const prs = [{ number: 5, state: 'MERGED', mergedAt: '2026-10-09T09:00:00Z', headRefName: 'feat/x', isCrossRepository: true }];
    assert.deepEqual(plan({ entries: [entry('a-1')], prs }).archive, []);
  });

  it('orders archive writes by worktree', () => {
    const entries = [entry('a-1', { worktree: '/w/zzz' }), entry('a-2', { worktree: '/w/aaa' })];
    const worktrees = archived(plan({ entries })).map((write) => write.data.worktree);
    assert.deepEqual(worktrees, ['/w/aaa', '/w/zzz']);
  });
});

describe('planTidy prune', () => {
  const OLD = '2026-06-01T00:00:00Z';

  it('deletes old entries except the latest, pinned to version', () => {
    const entries = [
      entry('a-1', { ts: OLD }, { version: 3 }),
      entry('a-2', { ts: '2026-07-01T00:00:00Z' }, { version: 4 }),
      entry('a-3', { ts: '2026-10-08T00:00:00Z' }, { version: 5 }),
    ];
    const result = plan({ entries });
    assert.deepEqual(pruned(result), [
      { op: 'delete', collection: 'entries', doc_id: 'a-1', if_version: 3 },
      { op: 'delete', collection: 'entries', doc_id: 'a-2', if_version: 4 },
    ]);
  });

  it('keeps the latest entry of a worktree even when it is old', () => {
    const entries = [entry('a-1', { ts: '2026-01-01T00:00:00Z' }), entry('a-2', { ts: OLD })];
    assert.deepEqual(pruned(plan({ entries })), [{ op: 'delete', collection: 'entries', doc_id: 'a-1', if_version: 1 }]);
  });

  it('keeps entries newer than 90 days', () => {
    const entries = [entry('a-1', { ts: '2026-07-20T00:00:00Z' }), entry('a-2', { ts: '2026-10-08T00:00:00Z' })];
    assert.deepEqual(plan({ entries }).prune, []);
  });

  it('never prunes another host or repo', () => {
    const entries = [
      entry('a-1', { host: 'desktop', ts: OLD }),
      entry('a-2', { host: 'desktop', ts: '2026-10-08T00:00:00Z' }),
      entry('a-3', { repo: 'github.com/acme/other', ts: OLD }),
      entry('a-4', { repo: 'github.com/acme/other', ts: '2026-10-08T00:00:00Z' }),
    ];
    assert.deepEqual(plan({ entries }).prune, []);
  });

  it('prunes within each worktree group separately', () => {
    const entries = [
      entry('a-1', { worktree: LIVE, ts: OLD }),
      entry('a-2', { worktree: LIVE, ts: '2026-10-08T00:00:00Z' }),
      entry('b-1', { worktree: MAIN, ts: OLD }),
    ];
    assert.deepEqual(pruned(plan({ entries })).map((write) => write.doc_id), ['a-1']);
  });

  it('skips and counts entries that cannot be pinned', () => {
    const entries = [
      entry('a-1', { ts: OLD }, { version: null }),
      entry('a-2', { ts: OLD }, { version: 0 }),
      entry('a-3', { ts: OLD }, { version: 2 }),
      entry('a-4', { ts: '2026-10-08T00:00:00Z' }),
    ];
    const result = plan({ entries });
    assert.deepEqual(pruned(result), [{ op: 'delete', collection: 'entries', doc_id: 'a-3', if_version: 2 }]);
    assert.equal(result.skipped, 2);
  });

  it('skips and counts entries with an unparseable ts', () => {
    const entries = [entry('a-1', { ts: 'not a date' }), entry('a-2', { ts: '2026-10-08T00:00:00Z' })];
    const result = plan({ entries });
    assert.deepEqual(result.prune, []);
    assert.equal(result.skipped, 1);
  });

  it('keeps an entry exactly 90 days old and prunes one a second older', () => {
    const cutoff = (offsetSeconds) => new Date(NOW.getTime() - 90 * 24 * 3600 * 1000 - offsetSeconds * 1000).toISOString().replace('.000Z', 'Z');
    const entries = [
      entry('a-1', { ts: cutoff(0) }),
      entry('a-2', { ts: cutoff(1) }),
      entry('a-3', { ts: '2026-10-08T00:00:00Z' }),
    ];
    assert.deepEqual(pruned(plan({ entries })).map((write) => write.doc_id), ['a-2']);
  });

  it('treats a timestamp without Z or an offset as unparseable', () => {
    const entries = [entry('a-1', { ts: '2026-01-01T00:00:00' }), entry('a-2', { ts: '2026-10-08T00:00:00Z' })];
    const result = plan({ entries });
    assert.deepEqual(result.prune, []);
    assert.equal(result.skipped, 1);
  });

  it('reads an explicit offset as an instant', () => {
    const entries = [entry('a-1', { ts: '2026-06-01T02:00:00+02:00' }), entry('a-2', { ts: '2026-10-08T00:00:00Z' })];
    assert.equal(pruned(plan({ entries })).length, 1);
  });

  it('orders deletes by doc id within a worktree', () => {
    const entries = [entry('a-3', { ts: OLD }), entry('a-1', { ts: OLD }), entry('a-2', { ts: OLD }), entry('z-latest', { ts: '2026-10-08T00:00:00Z' })];
    assert.deepEqual(pruned(plan({ entries })).map((write) => write.doc_id), ['a-1', 'a-2', 'a-3']);
  });

  it('splits writes into batches of at most 50', () => {
    const old = Array.from({ length: 120 }, (_, index) => {
      const id = `a-${String(index).padStart(3, '0')}`;
      return entry(id, { ts: OLD });
    });
    const entries = [...old, entry('z-latest', { ts: '2026-10-08T00:00:00Z' })];
    const result = plan({ entries });
    assert.deepEqual(result.prune.map((batch) => batch.length), [50, 50, 20]);
    assert.ok(pruned(result).every((write) => write.if_version === 1));
  });

  it('splits archive writes into batches of at most 50', () => {
    const entries = Array.from({ length: 51 }, (_, index) => entry(`a-${index}`, { worktree: `/w/gone-${String(index).padStart(2, '0')}` }));
    assert.deepEqual(plan({ entries }).archive.map((batch) => batch.length), [50, 1]);
  });
});
