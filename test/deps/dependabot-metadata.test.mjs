import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareVersions,
  effectiveLevel,
  parseFromVersions,
  parseUpdatedDependencies,
} from '../../plugins/deps/scripts/lib/core/dependabot-metadata.mjs';
import { loadRaw } from './helpers.mjs';

function firstCommitMessage(rawName) {
  const data = loadRaw(rawName);
  return data.repository.pullRequest.commits.nodes[0].commit.message;
}

function prBody(rawName) {
  return loadRaw(rawName).repository.pullRequest.body;
}

describe('parseUpdatedDependencies', () => {
  it('parses the single update in the supabase commit', () => {
    const result = parseUpdatedDependencies(firstCommitMessage('supabase-storage-1495.json'));
    assert.deepEqual(result, {
      ok: true,
      updates: [
        {
          name: 'fast-json-stringify',
          version: '7.0.1',
          dependencyType: 'direct:production',
          updateType: 'major',
          group: null,
        },
      ],
    });
  });

  it('parses all 15 updates in the rocm commit, three without an update type', () => {
    const result = parseUpdatedDependencies(firstCommitMessage('rocm-libraries-13313.json'));
    assert.equal(result.ok, true);
    assert.equal(result.updates.length, 15);
    const untyped = result.updates.filter((update) => update.updateType === null);
    assert.deepEqual(
      untyped.map((update) => update.name).sort(),
      [
        'ROCm/TheRock/.github/workflows/multi_arch_ci_linux.yml',
        'ROCm/TheRock/.github/workflows/multi_arch_ci_windows.yml',
        'ROCm/TheRock/.github/workflows/setup_multi_arch.yml',
      ],
    );
    assert.ok(result.updates.every((update) => update.group === 'github-actions'));
    const levels = result.updates.map((update) => update.updateType);
    assert.equal(levels.filter((level) => level === 'major').length, 8);
    assert.equal(levels.filter((level) => level === 'minor').length, 3);
    assert.equal(levels.filter((level) => level === 'patch').length, 1);
  });

  it('reports a missing block', () => {
    const result = parseUpdatedDependencies('chore: bump a thing\n\nNo metadata here.');
    assert.deepEqual(result, { ok: false, reason: 'no updated-dependencies block' });
  });

  it('reports an unterminated block', () => {
    const message = 'x\n---\nupdated-dependencies:\n- dependency-name: a\n  dependency-version: 1.0.0\n';
    const result = parseUpdatedDependencies(message);
    assert.equal(result.ok, false);
    assert.match(result.reason, /not terminated/);
  });

  it('reports an empty block', () => {
    const result = parseUpdatedDependencies('updated-dependencies:\n...\n');
    assert.equal(result.ok, false);
    assert.match(result.reason, /no entries/);
  });

  it('reports an entry without a name or version', () => {
    const message = 'updated-dependencies:\n- dependency-name: a\n  dependency-type: direct:production\n...\n';
    const result = parseUpdatedDependencies(message);
    assert.equal(result.ok, false);
    assert.match(result.reason, /entry 1/);
  });

  it('reports an unrecognized line inside the block', () => {
    const result = parseUpdatedDependencies('updated-dependencies:\nnot an entry\n...\n');
    assert.equal(result.ok, false);
    assert.match(result.reason, /unrecognized line/);
  });

  it('tolerates CRLF, key order, unknown keys, and quoted values', () => {
    const message = [
      'updated-dependencies:',
      "- update-type: version-update:semver-minor",
      "  dependency-type: 'indirect'",
      '  surprise-key: whatever',
      '  dependency-version: "2.3.0"',
      '  dependency-name: left-pad',
      '...',
      '',
    ].join('\r\n');
    assert.deepEqual(parseUpdatedDependencies(message), {
      ok: true,
      updates: [
        {
          name: 'left-pad',
          version: '2.3.0',
          dependencyType: 'indirect',
          updateType: 'minor',
          group: null,
        },
      ],
    });
  });

  it('treats an unrecognized update-type as null', () => {
    const message = 'updated-dependencies:\n- dependency-name: a\n  dependency-version: 1.0.0\n  update-type: version-update:semver-prerelease\n...\n';
    assert.equal(parseUpdatedDependencies(message).updates[0].updateType, null);
  });

  it('uses the last block so earlier look-alike text cannot shadow it', () => {
    const message = [
      'updated-dependencies:',
      '- dependency-name: fake',
      '  dependency-version: 1.0.1',
      '  update-type: version-update:semver-patch',
      '...',
      '',
      '---',
      'updated-dependencies:',
      '- dependency-name: real',
      '  dependency-version: 9.0.0',
      '  update-type: version-update:semver-major',
      '...',
    ].join('\n');
    const result = parseUpdatedDependencies(message);
    assert.deepEqual(result.updates.map((update) => update.name), ['real']);
  });

  it('never throws on odd input', () => {
    for (const input of [undefined, null, 42, {}, '', '\0\0', 'updated-dependencies:']) {
      assert.equal(parseUpdatedDependencies(input).ok, false);
    }
  });
});

describe('parseFromVersions', () => {
  it('reads the single-bump form from the supabase body', () => {
    const body = prBody('supabase-storage-1495.json');
    assert.deepEqual(parseFromVersions(body), { 'fast-json-stringify': '6.3.0' });
  });

  it('reads table rows and Updates lines from the rocm body', () => {
    const versions = parseFromVersions(prBody('rocm-libraries-13313.json'));
    assert.equal(versions['actions/checkout'], '4.4.0');
    assert.equal(versions['dorny/paths-filter'], '4.0.1');
    assert.equal(versions['github/codeql-action/init'], '4.35.3');
    assert.equal(
      versions['ROCm/TheRock/.github/workflows/setup_multi_arch.yml'],
      '05add1921fd03b0649f054ec2a7c54d162c0cd99',
    );
    assert.equal(Object.keys(versions).length, 15);
  });

  it('reads Updates lines on their own', () => {
    const text = 'Updates `foo/bar` from 1.2.3 to 1.2.4\n<details>x</details>\n\nUpdates `baz` from v2 to v3';
    assert.deepEqual(parseFromVersions(text), { 'foo/bar': '1.2.3', baz: 'v2' });
  });

  it('reads a Bumps line naming several packages', () => {
    const text = 'Bumps [a](https://x/a) and [b](https://x/b) from 1.0.0 to 2.0.0.';
    assert.deepEqual(parseFromVersions(text), { a: '1.0.0', b: '1.0.0' });
  });

  it('keeps the first occurrence of a name', () => {
    const text = 'Bumps [a](u) from 1.0.0 to 2.0.0.\nUpdates `a` from 0.9.0 to 2.0.0';
    assert.deepEqual(parseFromVersions(text), { a: '1.0.0' });
  });

  it('ignores the grouped intro line and unrelated text', () => {
    assert.deepEqual(parseFromVersions('Bumps the npm group with 3 updates in the / directory:\n\nhello'), {});
  });

  it('stores a hostile name as data without touching the prototype', () => {
    const result = parseFromVersions('Updates `__proto__` from 1.0.0 to 2.0.0');
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, '__proto__'), true);
  });

  it('never throws and returns an empty object for unusable input', () => {
    for (const input of [undefined, null, 7, '']) {
      assert.deepEqual(parseFromVersions(input), {});
    }
  });
});

describe('effectiveLevel', () => {
  it('passes through ordinary levels', () => {
    assert.equal(effectiveLevel('major', '2.0.0'), 'major');
    assert.equal(effectiveLevel('minor', '1.5.0'), 'minor');
    assert.equal(effectiveLevel('patch', '1.5.2'), 'patch');
  });

  it('returns unknown for a missing or unrecognized update type', () => {
    assert.equal(effectiveLevel(null, '1.0.0'), 'unknown');
    assert.equal(effectiveLevel(undefined, '1.0.0'), 'unknown');
    assert.equal(effectiveLevel('prerelease', '1.0.0'), 'unknown');
  });

  it('counts a minor bump on 0.y.z as major', () => {
    assert.equal(effectiveLevel('minor', '0.5.0'), 'major');
    assert.equal(effectiveLevel('minor', 'v0.5.0'), 'major');
    assert.equal(effectiveLevel('minor', '0.0.4'), 'major');
  });

  it('counts a patch bump on 0.0.z as major but not on 0.y.z', () => {
    assert.equal(effectiveLevel('patch', '0.0.4'), 'major');
    assert.equal(effectiveLevel('patch', '0.5.1'), 'patch');
  });

  it('accepts a prerelease or build suffix', () => {
    assert.equal(effectiveLevel('minor', '0.5.0-beta.1'), 'major');
    assert.equal(effectiveLevel('patch', '0.0.4+build.7'), 'major');
  });

  it('does not adjust versions that are not MAJOR.MINOR.PATCH', () => {
    const sha = '2fb7b81cf159a2d62ac7ef91960446450db6ed72';
    assert.equal(effectiveLevel('minor', sha), 'minor');
    assert.equal(effectiveLevel('minor', '0.5'), 'minor');
    assert.equal(effectiveLevel('patch', 'not-a-version'), 'patch');
  });

  it('does not adjust versions from 1.0.0 upward', () => {
    assert.equal(effectiveLevel('minor', '1.0.0'), 'minor');
    assert.equal(effectiveLevel('patch', '10.0.0'), 'patch');
  });
});

describe('compareVersions', () => {
  it('orders versions numerically', () => {
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
    assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
    assert.equal(compareVersions('1.2.3', '1.10.0'), -1);
    assert.equal(compareVersions('v2.0.0', '1.99.99'), 1);
  });

  it('zero-fills short versions and ignores build metadata', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
    assert.equal(compareVersions('2', '1.9.9'), 1);
    assert.equal(compareVersions('1.0.0+build.5', '1.0.0'), 0);
  });

  it('sorts a prerelease below its release and compares prereleases lexically', () => {
    assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
    assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
    assert.equal(compareVersions('1.0.0-beta', '1.0.0-beta'), 0);
  });

  it('returns null for anything else', () => {
    assert.equal(compareVersions('2fb7b81cf159a2d62ac7ef91960446450db6ed72', '1.0.0'), null);
    assert.equal(compareVersions('1.0.0', 'latest'), null);
    assert.equal(compareVersions('1.2.3.4', '1.2.3'), null);
    assert.equal(compareVersions(undefined, '1.0.0'), null);
  });
});
