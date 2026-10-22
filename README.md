# claude-plugins

Claude Code plugins by Andy Horn.

## Install

```
/plugin marketplace add andyhorn/claude-plugins
/plugin install git@andyhorn
/plugin install workflow@andyhorn
/plugin install rigor@andyhorn
```

## Plugins

| Plugin | Contents |
| --- | --- |
| `git` | `/git:rebase` skill, with the `git:rebase-driver` and `git:rebase-resolver` agents. |
| `workflow` | `/workflow:align` for reaching a shared, written understanding of a task, `/workflow:triage` for sorting review findings into verdicts, `/workflow:docket` for walking the remaining decisions one at a time, and `/workflow:glossary` for building a shared domain vocabulary. |
| `rigor` | Session-start operating rules, the `rigor:grade-loop` and `rigor:plan-stress-test` skills, and the `rigor:work-reviewer`, `rigor:operator` and `rigor:adversary` agents. |

The `rigor` skills are based on [a video](https://www.tiktok.com/@chasetalks1.0/video/7676275825049652493) by Chase Howard ([@chasetalks1.0](https://www.tiktok.com/@chasetalks1.0) on TikTok).

The `workflow:glossary` entry format builds on the domain-modeling `GLOSSARY.md` format from [Matt Pocock's skills](https://github.com/mattpocock/skills).

## Local development

Load a plugin straight from the working tree:

```
claude --plugin-dir ./plugins/git
```

Validate manifests and components before tagging a release:

```
claude plugin validate .
claude plugin validate ./plugins/git
claude plugin validate ./plugins/workflow
claude plugin validate ./plugins/rigor
```
