# rigor

Session discipline for Claude Code. The plugin loads a short set of operating rules at the start of every session, and ships the skills and agents those rules call.

Credit: these rules are based on [a video](https://www.tiktok.com/@chasetalks1.0/video/7676275825049652493) by Chase Howard ([@chasetalks1.0](https://www.tiktok.com/@chasetalks1.0) on TikTok). The wording of the skills and agents was written for this plugin.

## What it does

- **Session-start rules.** A `SessionStart` hook prints `rules.md` into the session's context. The rules say: verify claims or mark them unconfirmed, check fresh facts instead of trusting memory, push back on the user's claims and plans, grade deliverables, and stress-test plans.
- **`rigor:grade-loop` skill.** Runs the verify command, then dispatches the `rigor:work-reviewer` agent to run an acceptance checklist first: every explicit requirement must be MET, every claim must be VERIFIED, there must be no REFUTED claims, and there must be no [BLOCKING] deductions. If the gate passes, the reviewer scores correctness out of 75 and polish out of 25 for a combined 0-100 total. The passing threshold is 85 without any [BLOCKING] items. The loop stops after 3 rounds and reports the open deductions.
- **`rigor:plan-stress-test` skill.** Dispatches the `rigor:operator` agent (the user's finite time, energy, interest and money) and the `rigor:adversary` agent (tries to make the plan fail) in parallel, then merges both into the plan.

## What it does not do

The rules are instructions. Nothing in the harness forces the model to follow them. The hook only makes sure they are in context, and they are loaded again after `/clear` and compaction.

The `rigor:work-reviewer` agent has no Edit, Write or Bash tool, and Claude Code enforces the tool list, so the reviewer cannot change files or run commands. You run the project's verify command and pass the exact command, exit status and full output in the review packet. The reviewer uses it to verify claims, mark explicit requirements MET or NOT MET, and gate acceptance before it scores.

## Scope defaults

`rules.md` is the single source for when each rule applies: what counts as a deliverable, which plans get a stress test, and that pushback covers claims, decisions and plans but not routine commands. Edit it to change those thresholds and what loads at session start. The skills point back to it.

## Requirements

- Node on `PATH`. CI runs this plugin's tests on Node 22 and the current LTS. The `SessionStart` hook runs `node`. Without it, the hook fails with a non-blocking notice and the rules do not load.

## Install

```
/plugin marketplace add andyhorn/claude-plugins
/plugin install rigor@andyhorn
```

The plugin namespaces its components, so the agents are `rigor:work-reviewer`, `rigor:operator` and `rigor:adversary`.
