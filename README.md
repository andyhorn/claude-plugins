# claude-plugins

Claude Code plugins by Andy Horn.

## Install

```
/plugin marketplace add andyhorn/claude-plugins
/plugin install git@andyhorn
/plugin install workflow@andyhorn
```

## Plugins

| Plugin | Contents |
| --- | --- |
| `git` | `/git:rebase` skill, with the `git:rebase-driver` and `git:rebase-resolver` agents. |
| `workflow` | `/workflow:docket` skill. |

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
```
