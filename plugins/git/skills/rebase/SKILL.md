---
name: rebase
description: Use when asked to rebase the current git branch onto the repo's default branch (origin/main), or onto its parent branch if the PR is stacked (or fix/continue a rebase that's mid-conflict) — triggers on "rebase this branch", "rebase onto main", "/rebase", "fix these rebase conflicts". Drives the mechanical steps on a cheap model and escalates only actual conflict resolution to a stronger model, never guessing on a conflict it isn't confident about.
---

# Rebase

Rebase the current branch onto its **base branch**: the repo's default branch (`origin/main`) unless the PR is stacked, in which case its parent PR's branch. The base is *not* the branch's tracked upstream — that is normally the branch's own remote copy (`origin/<branch>`), which is the push target, and rebasing onto it is a no-op. The mechanical steps (fetch, drive `git rebase`, `--continue` after each conflict) run on `rebase-driver` (Sonnet). Conflict *content* resolution — the part that actually requires judgment — escalates to `rebase-resolver` (Opus), one conflict at a time. Nothing is force-pushed without your confirmation.

## Why split it this way

Driving a rebase is mostly mechanical: fetch, run the command, check output, continue. Resolving a conflict is not — it requires reading two commits' intent and picking (or synthesizing) the right outcome. Cheap model for the former, strong model for the latter, and a hard rule that the cheap model never touches conflict content, even when it looks trivial (whitespace, one-liner). "Looks trivial" is exactly the kind of judgment call that's supposed to escalate — a driver that starts making exceptions for "obvious" cases is a driver that will eventually be wrong about what's obvious. `rebase-driver` doesn't even have `Edit`/`Write` tools, so this isn't just a prompted rule — the most direct way to violate it is unavailable. (It still has `Bash`, which could in principle write a file another way; the tool restriction hardens the invariant, it doesn't make it airtight.)

## Preconditions

Before starting, verify and stop (report to the user, do not guess) if any of these fail:

- Working tree is clean (`git status --porcelain` empty). Do not auto-stash.
- Determine `BASE`:
  - If the user named a base, use it.
  - Otherwise default to the remote's default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (typically `origin/main`). Don't ask — this is what's wanted in the usual case.
  - Ask first only if the branch looks stacked: `gh pr view --json baseRefName -q .baseRefName` returns something other than the default branch, or the user mentions a predecessor/parent PR.
  - Never use `@{u}` as the base. If it equals `origin/$BRANCH`, it is the push target, not a base.
- Expect stale commits when the branch is the later part of a stack whose earlier PRs were squash-merged: those commits reappear as conflicts or empty commits. This is normal; the driver reports them (it never skips or drops), and the resolver decides.

## Flow

1. **Anchor.** Capture `ANCHOR=$(git rev-parse HEAD)` and `BRANCH=$(git branch --show-current)` before touching anything. This is the escape hatch for the whole run — `git rebase --abort` while mid-rebase, or `git reset --hard $ANCHOR` afterward, always returns to the pre-rebase state. Carry this in every status update you give the user.

2. **Fetch.** `git fetch` the remote that hosts `BASE`. Then capture the push-lease anchor: `REMOTE_ANCHOR=$(git rev-parse refs/remotes/origin/$BRANCH 2>/dev/null)` — the remote-tracking ref for the branch you'll eventually push *back* to, not `BASE` (those are different refs, e.g. `origin/main` vs `origin/feature`). If it doesn't exist, the branch has never been pushed — note that; the final push in step 8 will be a plain push, no lease possible or needed. `ANCHOR` and `REMOTE_ANCHOR` are two different SHAs for two different purposes: don't conflate them.

3. **Dispatch `rebase-driver`** (Agent tool, `subagent_type: "git:rebase-driver"`) — a **fresh agent every round**, never resumed via SendMessage. All the state that matters (git index, `REBASE_HEAD`) lives on disk, not in an agent's context, so there is nothing worth preserving between rounds; resuming a live agent only adds lifetime-management complexity for no benefit. Give it: the working directory, `BASE` to run `git rebase` onto (round 1 only; say explicitly that it is not the tracked upstream), and — from round 2 on — which file(s) the resolver just staged. The agent definition carries its own rules (mechanics only, never touches conflict content, reports conflicts with full diff + `REBASE_HEAD`); you only need to supply this round's context.

4. **On a conflict report, dispatch `rebase-resolver`** (Agent tool, `subagent_type: "git:rebase-resolver"`) — one per conflicting commit (if that commit conflicts across multiple files, give it all of them together, since they share one intent; don't split a single commit's conflict across independent resolvers with no shared view of each other). Give it: both sides' diffs, the original commit's message/diff, and enough surrounding file content to judge intent. The agent definition carries its own rules (resolve confidently and stage, or refuse and report low-confidence rather than guess).
   - A low-confidence report **halts the entire rebase right there**. Leave the conflicted state as-is and report to the user with the escape hatch from step 1 — Opus is the top of the escalation chain; if it isn't sure, no one downstream should be either.

5. If the resolver resolved the conflict, go back to step 3 for another driver round. Repeat 3–5 until the driver reports a clean rebase or a resolver halts on low confidence.

6. **Verify.** Once the rebase is clean, determine the project's actual verify step — check the project's CLAUDE.md, then `.claude/agents/` conventions, then fall back to project-type detection (`package.json` → its test script, `pubspec.yaml` → `flutter test`/`very_good test`, `Cargo.toml` → `cargo test`, etc.). Run it and capture real output. If no verify step can be determined, say so explicitly in the summary — never let silence read as "verified." Note this only runs once, after every conflict is resolved — a failure here means something in the rebase is wrong but not which resolution caused it; that's a known v1 tradeoff, not a guarantee of per-conflict correctness.

7. **Summarize and gate the push.** Show the user: commits replayed, each conflict and how/why it was resolved, the verify output, and the escape hatch. Ask before pushing — do not push automatically.

8. **On confirmation, push.** If `REMOTE_ANCHOR` was captured in step 2 (branch has been pushed before): `git push --force-with-lease=$BRANCH:$REMOTE_ANCHOR` — pinned to the remote branch's own pre-rebase SHA, not `ANCHOR` (which is the *local* pre-rebase HEAD and asserts nothing about the remote). A bare `--force-with-lease` only protects against changes since your last fetch of that ref; pinning the explicit value is the actual guarantee. If no `REMOTE_ANCHOR` exists (never pushed before), do a plain `git push -u origin $BRANCH` — there's no remote state to protect yet.

9. **On decline,** leave the local rebase applied and remind the user of the escape hatch and that they can push manually later.

## Common mistakes

- Resuming the driver via SendMessage instead of a fresh dispatch each round — the git index is the source of truth, not agent memory; a fresh agent reading disk state is simpler and just as correct.
- Dispatching via a generic `Agent` call with an inline prompt instead of `subagent_type: "git:rebase-driver"` / `"git:rebase-resolver"` — that loses the driver's tool restriction (no `Edit`/`Write`) and risks the inline prompt drifting from the agent definition's rules over time.
- Letting the driver "just fix" a whitespace-only conflict itself. The rule has no trivial-case exception — that's the whole point.
- Bare `--force-with-lease`, or pinning it to `ANCHOR` (local pre-rebase HEAD) instead of `REMOTE_ANCHOR` (the remote branch's own pre-rebase SHA). They're different values for different purposes — mixing them up means the push is rejected on any branch with commits not yet pushed, which is the normal case for a branch about to be rebased.
- Treating "no verify command found" as "verification not needed" — report the gap explicitly instead of staying silent.
- Rebasing onto `@{u}` because it was "the tracked upstream". For a feature branch that's its own remote copy, so nothing happens. Use `BASE` (default `origin/main`).
- Asking which base to use when the answer is the default branch. Ask only for a stacked PR or an ambiguous base.
- Auto-stashing a dirty working tree — ambiguity that should stop the flow, not get resolved silently.
