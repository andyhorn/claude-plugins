import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  ARTIFACT_URL,
  branchLabel,
  docIdFor,
  findWorktreeRoot,
  isoSeconds,
  localRepoKey,
  repoKeyFromOrigin,
  resolveRepo,
} from '../../plugins/brief/scripts/lib/core/keys.mjs';

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const KEY = { repo: 'github.com/acme/widgets', repoName: 'widgets' };

describe('repoKeyFromOrigin', () => {
  const sameKey = [
    ['scp-like', 'git@github.com:acme/widgets.git'],
    ['scp-like without .git', 'git@github.com:acme/widgets'],
    ['scp-like without user', 'github.com:acme/widgets.git'],
    ['ssh with port', 'ssh://git@github.com:22/acme/widgets.git'],
    ['https', 'https://github.com/acme/widgets'],
    ['https with .git', 'https://github.com/acme/widgets.git'],
    ['https with trailing slash', 'https://github.com/acme/widgets/'],
    ['https with .git and trailing slash', 'https://github.com/acme/widgets.git/'],
    ['https with user:token and port', 'https://user:ghp_secret123@github.com:443/acme/widgets.git'],
    ['https with token only', 'https://ghp_secret123@github.com/acme/widgets'],
    ['http', 'http://github.com/acme/widgets.git'],
    ['git protocol', 'git://github.com/acme/widgets.git'],
    ['uppercase host', 'https://GitHub.COM/acme/widgets.git'],
    ['surrounding whitespace', '  https://github.com/acme/widgets.git\n'],
    ['password containing @', 'https://user:p@ss@github.com/acme/widgets'],
    ['query and fragment', 'https://github.com/acme/widgets?x=1#y'],
    ['query before .git', 'https://github.com/acme/widgets.git?x=1'],
    ['scp with mixed-case user and host', 'Git@GitHub.com:acme/widgets.git'],
  ];
  for (const [label, url] of sameKey) {
    it(`normalizes ${label}`, () => {
      assert.deepEqual(repoKeyFromOrigin(url), KEY);
    });
  }

  it('never leaks a token or port', () => {
    const key = repoKeyFromOrigin('https://user:ghp_secret123@github.com:8443/acme/widgets.git');
    assert.equal(JSON.stringify(key).includes('ghp_secret123'), false);
    assert.equal(JSON.stringify(key).includes('8443'), false);
  });

  it('keeps every path segment for GitLab subgroups', () => {
    assert.deepEqual(repoKeyFromOrigin('git@gitlab.com:group/sub/name.git'), {
      repo: 'gitlab.com/group/sub/name',
      repoName: 'name',
    });
    assert.deepEqual(repoKeyFromOrigin('https://gitlab.com/group/sub/deep/name'), {
      repo: 'gitlab.com/group/sub/deep/name',
      repoName: 'name',
    });
  });

  const rejected = [
    ['absolute path', '/srv/x.git'],
    ['relative path', '../x'],
    ['bare name', 'widgets'],
    ['file url', 'file:///srv/acme/widgets.git'],
    ['one segment', 'https://github.com/widgets'],
    ['dot-dot segment', 'https://github.com/acme/../widgets'],
    ['leading dot-dot segment', 'https://github.com/../widgets'],
    ['dot segment', 'https://github.com/acme/./widgets'],
    ['empty', ''],
    ['non-string', null],
  ];
  for (const [label, url] of rejected) {
    it(`rejects ${label}`, () => {
      assert.equal(repoKeyFromOrigin(url), null);
    });
  }
});

describe('ARTIFACT_URL', () => {
  it('accepts claude.ai artifact urls', () => {
    assert.match('https://claude.ai/artifact/x', ARTIFACT_URL);
    assert.match('https://claude.ai/code/artifact/abc-123', ARTIFACT_URL);
  });

  for (const url of ['http://claude.ai/artifact/x', 'https://claude.ai/artifact/x/y', 'https://claude.ai/artifact/x?y', 'https://evil.example/artifact/x']) {
    it(`rejects ${url}`, () => {
      assert.doesNotMatch(url, ARTIFACT_URL);
    });
  }
});

describe('localRepoKey', () => {
  it('names a non-bare repository after the directory above .git', () => {
    const key = localRepoKey('/Users/a/code/proj/.git', sha1);
    assert.deepEqual(key, { repo: `local/proj-${sha1('/Users/a/code/proj/.git').slice(0, 8)}`, repoName: 'proj' });
  });

  it('strips the .git suffix of a bare repository', () => {
    const key = localRepoKey('/srv/git/foo.git', sha1);
    assert.deepEqual(key, { repo: `local/foo-${sha1('/srv/git/foo.git').slice(0, 8)}`, repoName: 'foo' });
  });

  it('uses an 8 character hash and is stable', () => {
    const first = localRepoKey('/a/b/.git', sha1);
    assert.match(first.repo, /^local\/b-[0-9a-f]{8}$/);
    assert.deepEqual(localRepoKey('/a/b/.git', sha1), first);
  });
});

describe('resolveRepo', () => {
  it('prefers the origin key', () => {
    const result = resolveRepo({ originUrl: 'git@github.com:acme/widgets.git', commonDir: '/x/.git', sha1 });
    assert.deepEqual(result, KEY);
  });

  it('falls back to the local key without an origin', () => {
    const result = resolveRepo({ originUrl: null, commonDir: '/x/proj/.git', sha1 });
    assert.deepEqual(result, localRepoKey('/x/proj/.git', sha1));
  });

  it('falls back to the local key when the origin is a local path', () => {
    const result = resolveRepo({ originUrl: '/srv/x.git', commonDir: '/x/proj/.git', sha1 });
    assert.equal(result.repoName, 'proj');
  });
});

describe('findWorktreeRoot', () => {
  const exists = (...paths) => (candidate) => paths.includes(candidate);

  it('finds the root from a nested file', () => {
    assert.equal(findWorktreeRoot('/w/repo/src/deep/file.js', exists('/w/repo/.git')), '/w/repo');
  });

  it('accepts a .git file in a linked worktree', () => {
    assert.equal(findWorktreeRoot('/w/linked/src', exists('/w/linked/.git')), '/w/linked');
  });

  it('prefers the nearest .git', () => {
    assert.equal(findWorktreeRoot('/w/repo/sub/x', exists('/w/repo/.git', '/w/repo/sub/.git')), '/w/repo/sub');
  });

  it('normalizes trailing slashes', () => {
    assert.equal(findWorktreeRoot('/w/repo/src///', exists('/w/repo/.git')), '/w/repo');
  });

  it('supports a root-level .git', () => {
    assert.equal(findWorktreeRoot('/a/b', exists('/.git')), '/');
  });

  it('returns null when nothing is found', () => {
    assert.equal(findWorktreeRoot('/w/repo/src', exists()), null);
  });

  it('returns null for a relative path', () => {
    assert.equal(findWorktreeRoot('repo/src', () => true), null);
  });
});

describe('branchLabel', () => {
  it('uses the branch when present', () => {
    assert.equal(branchLabel('feat/x', 'abcdef0123'), 'feat/x');
  });

  it('labels a detached head with seven characters', () => {
    assert.equal(branchLabel(null, 'abcdef0123456'), 'detached@abcdef0');
    assert.equal(branchLabel('', 'abcdef0123456'), 'detached@abcdef0');
  });

  it('is null with neither', () => {
    assert.equal(branchLabel(null, null), null);
  });
});

describe('time keys', () => {
  const date = new Date('2026-10-09T23:15:00.789Z');

  it('formats seconds without milliseconds', () => {
    assert.equal(isoSeconds(date), '2026-10-09T23:15:00Z');
  });

  it('builds a doc id from the UTC parts', () => {
    assert.equal(docIdFor(date, 'a1b2c3'), '20261009T231500Z-a1b2c3');
  });
});
