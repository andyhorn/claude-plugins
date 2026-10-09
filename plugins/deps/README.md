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
| `waiting` | The head commit moved during collection, CI is still running, or mergeability is still being computed. Run the triage again later. |
| `blocked` | CI is failing or absent, or the PR can't merge cleanly. PRs with failing CI are also analyzed. |
| `needs-analysis` | The bump is effectively major, or the update metadata is missing. The analyst reads the release notes. |
| `routine` | Every fact passes and every bump is a patch or minor update. |

`routine` means low review effort, not safe. You still read the diff before you merge.

## Facts

| Fact | What it checks |
| --- | --- |
| Provenance | The commit is signed by GitHub (`web-flow`), authored with Dependabot's numeric noreply email, and the PR isn't from a fork. |
| Bumps | Versions come from the `updated-dependencies` metadata in the commit, with a 0.x adjustment so `0.2.0` to `0.3.0` counts as a major bump. |
| CI | The status check rollup for the head commit, across every page of checks. |
| Mergeability | GitHub's `mergeable` and `mergeStateStatus` values. |
| Security | A `security` label, or a "Vulnerabilities fixed" section in the PR body. |

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
- The write guard is pattern-based. It narrows the risk without eliminating it, because other commands, such as interpreters, aren't inspected.
- npm lifecycle scripts aren't inspected.
- Security detection relies on a `security` label or a "Vulnerabilities fixed" section.

## Requirements

- Node 22 or newer.
- An authenticated `gh` CLI.
- A clone of the target repo as your working directory.
