---
date: 2026-10-09
topic: brief-worktree-status
revised: 2026-10-09 (Claude-published Artifact replaces hook capture + Haiku summarizer)
---

# /brief: Worktree status and decision log

## What We're Building

A `brief` plugin for the `andyhorn` marketplace. It keeps a running log of the work in each git worktree of a repo and answers "where was I?" in two situations: coming back to a repo after a break, and switching between worktrees mid-session. Tools like Orca make it easy to run many worktrees in parallel. They make it harder to remember what each one was doing and why.

**Claude decides what is worth recording and publishes it to a live Artifact.** At key moments, the main Claude session writes a short entry to the database behind a private claude.ai Artifact: the dashboard. The moments are a decision made, a milestone reached, being blocked on you, and work finished or handed back. Each entry says what changed, what was decided and why, what comes next, and whether it needs you. The dashboard groups entries by repo and worktree and updates live, on any device.

The plugin has three parts:

- **Publish (Claude's judgment).** A skill tells Claude what a key moment is and exactly how to write an entry. Claude decides when.
- **Nudge (a hook).** If Claude did work in a turn and hasn't published since, a `Stop` hook gives it one short prompt to publish or skip. That catches the moment you walk away. The hook also tells Claude the deterministic facts for the entry: repo, worktree, branch, `HEAD`, and the Artifact URL. Claude never guesses its own keys.
- **Report.** `/brief` prints the dashboard link, creating the Artifact the first time. `/brief <worktree>` has Claude read that worktree's entries back and summarize them in the terminal, with current git and PR state.

## Why This Approach

The first version of this brainstorm and its plan used hook capture: documented hook payloads went into a per-session buffer, a deterministic record was written per turn, and a detached Haiku summarizer added the structured fields. A local HTML dashboard rendered the result. Planning and review showed what that costs:

- a buffer, a job queue, a lock, async-race rules, and an OAuth refresh risk from a second `claude` process;
- a thin "why", because Haiku saw only prompts, tool calls, and Claude's final message, never its reasoning;
- a self-refreshing local HTML renderer with a cache of `gh` data.

Letting the main model write the entry gives the best "why". The original brainstorm rejected that for cost and noise, but that was when Claude was forced to log every turn. With Claude choosing the moments, it publishes a few times per session, not every turn. The nudge appears only when there is unpublished work at turn end. The Artifact database provides the live, multi-device dashboard for free.

The trade-off is that capture depends on Claude's judgment. The nudge is the backstop. Some states can't be self-reported: Claude blocked on a permission prompt, or a crashed session. Those don't appear on the dashboard, and we accept that.

## Key Decisions

- **Name: `/brief`.** It avoids a clash with the built-in `/status`.
- **Claude decides when to publish.** A skill whose description triggers at key moments defines the moments and the entry format. A trivial turn gets no entry. It's always fine to skip.
- **Write target: the Artifact database (`ArtifactData`).** Each publish creates a **new** document, so one call needs no version read. The page derives each worktree's current state from its latest entry. Entries are append-only, and a correction is just a newer entry.
- **One Artifact per user**, covering every repo. Its URL is stored in `${CLAUDE_PLUGIN_DATA}`. `/brief` creates and publishes it on first use from a page shipped in the plugin, declaring the `db` and `user` capabilities.
- **The nudge fires at turn end.** It's a `Stop` hook that blocks once (guarded by `stop_hook_active`) when there has been work since the last publish. Small hooks track that: `PostToolUse` on edit and Bash tools marks the session dirty, and `PostToolUse` on `ArtifactData` clears it. The block reason carries the facts for the entry (repo key, worktree path, branch, `HEAD`, URL).
- **Entry shape (fixed):** `repo`, `worktree`, `branch`, `head`, `ts`, `session`, `status` (one of `working`, `needs-you`, `blocked`, `done`), `changed`, `decided[]` (each a decision plus its why), `next`, and `needs_you` (text or null).
- **`/brief` in the terminal:** prints or opens the dashboard link. `/brief <worktree>` reads that worktree's entries back with `ArtifactData`, adds live `git` and `gh` state, and summarizes.
- **Audience: the author first.** It requires a claude.ai login with Artifacts available. The README says so, and the plugin tells other users plainly that it isn't available to them.
- **Subagents don't publish.** Some lack the Artifact tools, and the main thread reports their work.
- **Packaging follows the `deps` plugin:** Node `.mjs` scripts for the hooks, `hooks/hooks.json`, `node --test` tests under `test/brief/`, and `claude plugin validate --strict` in CI. It is stacked on `feat/deps-triage-plugin-surface`.

## Open Questions

- **Approvals.** Each `ArtifactData` write probably needs your approval. Confirm whether an `ArtifactData` allow rule removes the prompt in default permission mode, and whether a plugin can ship that rule or the README must instruct it. This is a spike, and it decides whether the design is usable at all.
- **Nudge frequency.** Should the nudge fire on every turn with unpublished work, or only after a threshold (for example, 3 turns or 10 minutes since the last publish)? Should it be tunable via `userConfig`?
- **PR and CI on the dashboard.** The page can't call `gh`. Options: Claude includes the PR number in entries, and `/brief` writes a PR/CI snapshot document per repo each time it runs. Or show PR/CI only in the terminal `/brief <worktree>`.
- **Archiving.** When a worktree is removed or its PR merges, should `/brief` write an `archived` entry so the page moves it into a "recently finished" footer?
- **Identity keys.** Use the git common dir for the repo, hashed into a readable slug, and the worktree's top-level path for the worktree. Carried over from the earlier plan; confirm.
- **First-run race.** Two sessions could both create the Artifact. Use an `O_EXCL` marker in the data dir, or accept a rare duplicate.
- **Privacy.** Entries live on claude.ai (private Artifact). The skill must never put secrets or credentials in an entry.
