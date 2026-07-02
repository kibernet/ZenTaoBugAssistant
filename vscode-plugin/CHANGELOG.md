# Changelog

## 1.2.0

- Fixed stale ZenTao bug list refresh results overwriting the currently selected project.
- Improved saved account and password restore behavior after reopening the view.
- Improved project-scoped member caching and manual member refresh behavior.

## 1.1.0

- Added Chat / CLI repair mode selection.
- Added configurable CLI command templates with `{promptFile}`, `{promptFileRaw}`, `{bugIds}`, and `{engine}` placeholders.
- Improved ZenTao Bug list compatibility across product, project, and execution bug views.
- Added AI diagnostic packages with Git context, candidate files, and verification guidance.
- Added code evidence packages from Git grep matches based on bug text keywords.
- Added repository-aware verification command suggestions for AI repair prompts.
- Added AI context quality review with scores, available signals, and context gaps.
- Added structured AI repair protocol for root cause, changes, verification, risk, and ZenTao writeback summaries.
- Added AI analysis panels before sending repair context to Chat or CLI.
- Added Git diff based ZenTao comment drafts for resolve/close workflow actions.
- Removed production debug telemetry hooks.
- Replaced internal default ZenTao URL with a generic placeholder.
- Made password persistence respect `zentaoBugAssistant.rememberPassword`.

## 1.0.0

- Initial VS Code / Cursor release.
- ZenTao login, project/member filtering, bug preview, AI repair prompts, and workflow actions.
