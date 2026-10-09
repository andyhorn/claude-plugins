import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateGuard } from '../../plugins/deps/scripts/lib/core/guard.mjs';

function analyst(command) {
  return evaluateGuard({
    agent_type: 'deps:update-analyst',
    tool_name: 'Bash',
    tool_input: { command },
  });
}

function assertAllowed(command) {
  const result = analyst(command);
  assert.deepEqual(result, { decision: 'allow' }, `expected allow: ${command}\n${result.reason ?? ''}`);
}

function assertDenied(command) {
  const result = analyst(command);
  assert.equal(result.decision, 'deny', `expected deny: ${command}`);
  assert.ok(result.reason.startsWith('deps:update-analyst is read-only'), result.reason);
  return result;
}

describe('documented analyst steps', () => {
  const documented = [
    'git remote -v',
    'git fetch origin main',
    "git grep -n -F -e 'foo(' origin/main",
    'gh run view 123 --log-failed',
    'gh release view v7.0.1 -R fastify/fast-json-stringify',
    'gh pr view 12 --json body',
    'gh pr diff 12',
    'gh pr checks 12',
    'gh api repos/o/r/releases',
    'gh api -X GET repos/o/r/contents/CHANGELOG.md -f ref=main',
  ];
  for (const command of documented) {
    it(`allows ${command}`, () => assertAllowed(command));
  }
});

describe('scope', () => {
  it('allows everything for other agent types and the main thread', () => {
    const command = 'gh pr merge 1 --squash';
    assert.deepEqual(evaluateGuard({ tool_name: 'Bash', tool_input: { command } }), { decision: 'allow' });
    assert.deepEqual(
      evaluateGuard({ agent_type: 'other:agent', tool_name: 'Bash', tool_input: { command } }),
      { decision: 'allow' },
    );
  });

  it('allows non-Bash tools', () => {
    const input = { agent_type: 'deps:update-analyst', tool_name: 'Read', tool_input: { file_path: '/x' } };
    assert.deepEqual(evaluateGuard(input), { decision: 'allow' });
  });

  it('denies a Bash call whose command cannot be read', () => {
    assertDenied(undefined);
    assert.equal(evaluateGuard({ agent_type: 'deps:update-analyst', tool_name: 'Bash' }).decision, 'deny');
  });

  it('tolerates a missing hook input', () => {
    assert.deepEqual(evaluateGuard(undefined), { decision: 'allow' });
  });

  it('allows commands that do not involve gh or git', () => {
    for (const command of ['ls -la', 'cat package.json', 'node --version', "grep -rn 'foo' src/", 'echo hello | wc -l']) {
      assertAllowed(command);
    }
  });
});

describe('deny reasons', () => {
  it('state what gh allows', () => {
    const { reason } = assertDenied('gh pr merge 1');
    assert.match(reason, /gh pr \w+ is not allowed/);
    assert.match(reason, /gh allows pr view\/diff\/checks\/list\/status, run view\/list, release view\/list, repo view, issue view\/list, search, and api GET/);
  });

  it('state what git allows', () => {
    const { reason } = assertDenied('git push origin main');
    assert.match(reason, /git push is not allowed/);
    assert.match(reason, /git allows fetch, ls-remote, grep, log, show, diff, remote/);
  });
});

describe('gh allowlist', () => {
  it('allows the read commands', () => {
    for (const command of [
      'gh pr view 12',
      'gh pr list --search "author:app/dependabot"',
      'gh pr status',
      'gh run list --limit 5',
      'gh release list -R o/r',
      'gh repo view o/r',
      'gh issue view 4',
      'gh issue list',
      'gh search issues foo',
      '/usr/bin/gh pr view 1',
      'GH_PAGER=cat gh pr view 1',
    ]) {
      assertAllowed(command);
    }
  });

  it('denies write commands and unlisted read commands', () => {
    for (const command of [
      'gh pr comment 1 --body hi',
      'gh pr review 1 --approve',
      'gh pr edit 1 --add-label x',
      'gh pr close 1',
      'gh pr ready 1',
      'gh pr create',
      'gh issue comment 1 --body hi',
      'gh issue close 1',
      'gh run rerun 1',
      'gh run cancel 1',
      'gh release create v1',
      'gh repo delete o/r',
      'gh workflow run x.yml',
      'gh auth token',
      'gh alias set x y',
      'gh extension install x',
      'gh pr',
      'gh',
      'gh search',
      'gh -R o/r pr view 1',
    ]) {
      assertDenied(command);
    }
  });

  it('allows api GET forms', () => {
    for (const command of [
      'gh api repos/o/r/pulls/1',
      'gh api repos/o/r/pulls/1 --jq .title',
      'gh api -X GET repos/o/r/contents/x -f ref=main',
      'gh api --method GET repos/o/r/contents/x -F per_page=5',
      'gh api --method=get repos/o/r/contents/x --raw-field ref=main',
      'gh api -XGET repos/o/r/contents/x -fref=main',
      'gh api repos/o/r/releases --paginate -H "Accept: application/vnd.github+json"',
    ]) {
      assertAllowed(command);
    }
  });

  it('denies api writes in every method spelling', () => {
    for (const command of [
      'gh api -X POST repos/o/r/issues/1/comments',
      'gh api -XPOST repos/o/r/issues/1/comments',
      'gh api --method POST repos/o/r/issues/1/comments',
      'gh api --method=POST repos/o/r/issues/1/comments',
      'gh api --method=post repos/o/r/issues/1/comments',
      'gh api repos/o/r/issues/1/comments -X DELETE',
      'gh api -X GET -X PUT repos/o/r/x',
      'gh api -iXPATCH repos/o/r/x',
    ]) {
      assertDenied(command);
    }
  });

  it('denies api fields without an explicit GET, in every attached form', () => {
    for (const command of [
      'gh api repos/o/r/issues -f title=x',
      'gh api repos/o/r/issues -F title=x',
      'gh api repos/o/r/issues -ftitle=x',
      'gh api repos/o/r/issues --field title=x',
      'gh api repos/o/r/issues --field=title=x',
      'gh api repos/o/r/issues --raw-field title=x',
      'gh api repos/o/r/issues --raw-field=title=x',
    ]) {
      assertDenied(command);
    }
  });

  it('denies graphql, --input, an override header, and a missing endpoint', () => {
    for (const command of [
      'gh api graphql -f query=x',
      'gh api -X GET graphql -f query=x',
      'gh api /graphql',
      'gh api GraphQL',
      'gh api https://api.github.com/graphql',
      'gh api repos/o/r/issues --input body.json',
      'gh api repos/o/r/issues --input=body.json',
      'gh api repos/o/r/issues -H "X-HTTP-Method-Override: DELETE"',
      'gh api',
      'gh api -X GET',
    ]) {
      assertDenied(command);
    }
  });
});

describe('git allowlist', () => {
  it('allows the read subcommands', () => {
    for (const command of [
      'git status',
      'git log --oneline -n 5 origin/main',
      'git show origin/main:package.json',
      'git diff origin/main --stat',
      'git rev-parse HEAD',
      'git ls-files src',
      'git cat-file -p HEAD',
      'git merge-base HEAD origin/main',
      'git blame -L 1,5 README.md',
      'git ls-remote origin refs/heads/main',
      'git fetch --depth=1 origin main',
      'git remote',
      'git remote --verbose',
      'git remote get-url origin',
      'git remote show origin',
      'git -C /tmp/repo status',
      'git --no-pager log -n 1',
      'git -P log -n 1',
      'git --git-dir=/tmp/x/.git --work-tree=/tmp/x status',
      "git grep -n -F -e 'foo(' origin/main -- src",
      'git grep --line-number -i foo origin/main',
      "git grep -e 'OAuth' origin/main",
      'git grep -eFOO origin/main',
    ]) {
      assertAllowed(command);
    }
  });

  it('denies write and unlisted subcommands', () => {
    for (const command of [
      'git push origin main',
      'git commit -m x',
      'git checkout main',
      'git reset --hard',
      'git merge origin/main',
      'git rebase origin/main',
      'git pull',
      'git clone https://x/y',
      'git add .',
      'git branch -D x',
      'git config user.name x',
      'git remote add x y',
      'git remote remove origin',
      'git remote set-url origin x',
      'git remote -v show',
      'git stash',
      'git',
    ]) {
      assertDenied(command);
    }
  });

  it('denies dangerous global options', () => {
    for (const command of [
      'git -c core.pager=sh status',
      'git -ccore.pager=sh status',
      'git --config-env=core.pager=X status',
      'git --exec-path=/tmp/x status',
      'git --paginate log',
      'git -C',
    ]) {
      assertDenied(command);
    }
  });

  it('denies fetch and ls-remote options that run programs or write refs', () => {
    for (const command of [
      'git fetch --upload-pack=evil origin',
      'git fetch --upload-pack evil origin',
      'git fetch --upload-pa=evil origin',
      'git ls-remote --upload-pack=evil origin',
      'git ls-remote --exec=evil origin',
      "git fetch --refmap='+refs/heads/*:refs/heads/*' origin main",
      'git fetch origin main:main',
      'git fetch origin +refs/heads/*:refs/remotes/o/*',
      'git ls-remote origin a:b',
      'git fetch -- origin main:main',
    ]) {
      assertDenied(command);
    }
  });

  it('allows a fetch URL that contains a colon as the remote', () => {
    assertAllowed('git fetch https://github.com/o/r.git main');
    assertAllowed('git ls-remote git@github.com:o/r.git');
  });

  it('denies grep options that run a pager', () => {
    for (const command of [
      'git grep -O foo',
      'git grep -Oless foo',
      'git grep -nO foo',
      'git grep --open-files-in-pager foo',
      'git grep --open-files-in-pager=less foo',
      'git grep --open-files foo',
    ]) {
      assertDenied(command);
    }
  });

  it('denies output files and external diff', () => {
    for (const command of [
      'git log --output=/tmp/x',
      'git show --output /tmp/x HEAD',
      'git diff --ext-diff',
      'git diff --ext HEAD',
      'git log --outp=/tmp/x',
    ]) {
      assertDenied(command);
    }
  });
});

describe('shell structure', () => {
  it('checks every segment', () => {
    for (const command of [
      'gh pr view 1 && gh pr merge 1',
      'gh pr view 1; gh pr merge 1',
      'gh pr view 1 || gh pr merge 1',
      'gh pr view 1 | gh pr merge 1',
      'gh pr view 1 & gh pr merge 1',
      'gh pr view 1\ngh pr merge 1',
      '(gh pr merge 1)',
      'echo ok; (cd /tmp && gh pr merge 1)',
      'git status && git push',
    ]) {
      assertDenied(command);
    }
  });

  it('checks command substitutions, including inside double quotes', () => {
    for (const command of [
      'echo $(gh pr merge 1)',
      'echo "$(gh pr merge 1)"',
      'echo `gh pr merge 1`',
      'echo "`gh pr merge 1`"',
      'echo "a $(echo $(gh pr merge 1)) b"',
      'x=$(git push)',
    ]) {
      assertDenied(command);
    }
  });

  it('allows a substitution that runs an allowed command', () => {
    assertAllowed('echo "$(gh pr view 1 --json title)"');
    assertAllowed('echo `git status`');
  });

  it('treats single quotes as literal', () => {
    assertAllowed("echo '$(x pr merge 1)' > /dev/null");
    assertAllowed("gh pr view 1 --jq '.title; $(x)'");
    assertAllowed("git grep -F -e 'a;b|c&d' origin/main");
  });

  it('does not split on operators inside quotes', () => {
    assertAllowed('gh pr view 1 --jq ".a | .b; .c"');
    assertAllowed('gh pr list --search "a && b"');
  });

  it('keeps 2>&1 style redirections attached to their command', () => {
    assertAllowed('gh pr view 1 2>&1');
    assertAllowed('gh pr view 1 >/dev/null 2>&1');
    assertDenied('gh pr merge 1 2>&1');
    assertDenied('gh pr view 1 &>/dev/null & gh pr merge 1');
  });

  it('strips assignments and wrapper words before checking', () => {
    for (const command of [
      'FOO=1 gh pr merge 1',
      'env gh pr merge 1',
      'env FOO=1 gh pr merge 1',
      'command gh pr merge 1',
      'exec gh pr merge 1',
      'time gh pr merge 1',
      'nohup gh pr merge 1',
      'sudo gh pr merge 1',
      'builtin gh pr merge 1',
      '/usr/bin/env gh pr merge 1',
      'env -i gh pr merge 1',
      'sudo -u root gh pr merge 1',
    ]) {
      assertDenied(command);
    }
    assertAllowed('env GH_PAGER=cat gh pr view 1');
    assertAllowed('time git status');
  });

  it('sees through quoting and escaping of the command word', () => {
    for (const command of [
      '"gh" pr merge 1',
      "'gh' pr merge 1",
      'g"h" pr merge 1',
      '\\gh pr merge 1',
      '/usr/bin/"git" push',
    ]) {
      assertDenied(command);
    }
  });

  it('handles backslash line continuations', () => {
    assertAllowed('gh pr view \\\n  1 --json body');
    assertDenied('gh pr \\\n  merge 1');
  });

  it('denies a command word built from expansions or globs', () => {
    for (const command of [
      '$CMD pr merge 1',
      '"$CMD" pr merge 1',
      '${CMD} pr merge 1',
      "$'\\x67h' pr merge 1",
      '`echo gh` pr merge 1',
      '$(echo gh) pr merge 1',
      '{gh,pr,merge,1}',
      '/usr/bin/g? pr merge 1',
      '/usr/bin/[g]h pr merge 1',
      '/usr/bin/g* pr merge 1',
    ]) {
      assertDenied(command);
    }
  });

  it('denies gh and git arguments that start with an expansion', () => {
    for (const command of [
      'gh api repos/o/r $FLAGS',
      'gh api repos/o/r "$FLAGS"',
      'gh api repos/o/r -X$M',
      'gh api repos/o/r -X $M',
      'gh api repos/o/r --method=$M',
      'gh pr view $(echo 1)',
      'git log $REF',
      'git fetch origin "$(echo main:main)"',
    ]) {
      assertDenied(command);
    }
  });

  it('allows expansions inside a larger argument', () => {
    assertAllowed('gh api repos/$OWNER/$REPO/releases');
    assertAllowed('gh release view v1 -R "o/$REPO"');
  });

  it('denies indirect invocation through another command', () => {
    for (const command of [
      'sh -c "gh pr merge 1"',
      "bash -c 'git push'",
      'xargs gh pr merge',
      'echo 1 | xargs -n1 gh pr merge',
      'find . -exec git push ;',
      "python3 -c \"import os; os.system('gh pr merge 1')\"",
      'eval gh pr merge 1',
      'watch gh pr view 1',
    ]) {
      assertDenied(command);
    }
  });

  it('denies a command it cannot parse', () => {
    for (const command of ['gh pr view "1', "gh pr view '1", 'echo $(gh pr view 1', 'echo `gh pr view 1']) {
      const result = assertDenied(command);
      assert.match(result.reason, /unterminated|cannot be checked/);
    }
  });

  it('allows an empty command', () => {
    assertAllowed('');
    assertAllowed('   ');
  });
});
