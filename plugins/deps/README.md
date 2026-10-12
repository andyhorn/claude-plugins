# deps

Dependabot PR triage for your repo. The plugin sorts open dependency PRs into review buckets using deterministic facts, then has a read-only agent compare release notes against your code.

## What it does

- Collects every open Dependabot PR and checks provenance, semver bump, CI, mergeability, and security labeling.
- Sorts each PR into a bucket and suggests an action for you to take.
- Dispatches a read-only analyst per PR that needs it. The analyst reads release notes and changelogs and searches your code for the APIs that changed.

The plugin never merges, approves, arms auto-merge, or changes settings. Its only write is an opt-in PR comment, posted with `--comment`.

## Usage

```text
/deps:triage
/deps:triage 123
/deps:triage 123 --comment
```

## Buckets

| Bucket | Rule |
| --- | --- |
| `attention` | The PR isn't from Dependabot, its commits fail the provenance check, it's a draft, or it targets a non-default branch. |
| `waiting` | The head commit moved during collection, CI is still running or only partly fetched, or mergeability is still being computed or the branch is behind its base. Run the triage again later. |
| `blocked` | CI is failing, absent, or entirely skipped, or the PR has merge conflicts. Only PRs with failing CI are also analyzed. |
| `needs-analysis` | At least one bump is effectively major or unknown, or the update metadata is missing. The analyst reads the release notes. |
| `routine` | Provenance checks out, every bump is effectively a patch or minor update, CI is green, and the PR is mergeable. |

`routine` means low review effort, not safe. You still read the diff before you merge. Within each bucket, PRs with security signals are listed first; they stay in their bucket and are not moved out of `routine`.

## Facts

| Fact | What it checks |
| --- | --- |
| Provenance | The commit is signed by GitHub (`web-flow`), authored with Dependabot's numeric noreply email, and the PR isn't from a fork. |
| Bumps | Versions come from the `updated-dependencies` metadata in Dependabot's first commit, with a 0.x adjustment so `0.2.0` to `0.3.0` counts as a major bump. |
| CI | The status check rollup for the head commit, across every page of checks. |
| Mergeability | GitHub's `mergeable` and `mergeStateStatus` values. A merge state of `BLOCKED` (such as required reviews) is informational and doesn't change the bucket. |
| Security | An open Dependabot alert whose patched version is at or below the bump's new version, or a `security` label. Dependabot adds no label or body marker by default. It affects ordering within a bucket, not the bucket. |

## Recommended Dependabot setup

Slow down new releases and group routine updates so the backlog stays small:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
      semver-major-days: 14
    groups:
      minor-and-patch:
        update-types: [minor, patch]
```

See the [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference) and GitHub's guide to [automating Dependabot with GitHub Actions](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/automating-dependabot-with-github-actions).

If you automate merging yourself:

- Prefer a `schedule` trigger over `pull_request` events started by Dependabot. Those events get a read-only token and no secrets.
- Merges made with `GITHUB_TOKEN` don't trigger downstream workflows. Use a GitHub App token if you need that.
- Protect the workflow and `dependabot.yml` with CODEOWNERS.

## Limitations

- Renovate PRs are listed but not parsed. They land in `attention` with the reason "not a Dependabot PR".
- The analyst can run only `gh` and `git` with read subcommands (no `git -C`), plus the read-only filters `cat`, `head`, `tail`, `wc`, `cut`, `tr`, `jq`, `grep`, and `sort` in pipelines. Output redirection, loops, `sh -c`, and interpreters are denied.
- The guard is still pattern-based. It narrows the risk rather than eliminating it.
- npm lifecycle scripts aren't inspected.
- Alert matching needs Dependabot alerts enabled and a token that can read them. Otherwise the report says alerts were unavailable and only the `security` label is used.
- The analyst treats fetched text as data. If PR bodies, release notes, or CI logs contain instructions aimed at an AI or reviewer, it doesn't follow them and reports them as suspicious content.

## Requirements

- Node 22 or newer.
- An authenticated `gh` CLI.
- For security matching: Dependabot alerts enabled on the repo and a token that can read them.
- A clone of the target repo as your working directory.
