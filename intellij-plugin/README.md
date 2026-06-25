# ZenTao Bug Assistant for IntelliJ IDEA

ZenTao Bug Assistant turns ZenTao bug reports into AI-ready code repair context inside IntelliJ IDEA. It does not try to replace ZenTao project management; it adds the missing engineering layer between a defect ticket and Claude Chat or CLI agents.

## Highlights

- ZenTao login and session keep-alive.
- Project, member, and status filters.
- Bug detail preview with screenshots and attachments.
- AI repair prompts for single bugs or the current unresolved list.
- AI diagnostic package with workspace path, Git branch, changed files, recent commits, candidate files, code evidence, and recommended verification commands.
- Code evidence package from Git-tracked source matches based on bug text keywords.
- Verification command suggestions for npm, Gradle, Maven, pytest, Go, Cargo, dotnet, Unity, and repository build scripts.
- AI context quality review with score, available signals, and context gaps before sending to an agent.
- Structured AI repair protocol for root cause, changed files, verification results, risks, and ZenTao writeback summary.
- AI analysis panel before sending repair context to Chat or CLI.
- Chat / CLI repair mode selection.
- Configurable CLI command template with `{promptFile}`, `{promptFileRaw}`, `{bugIds}`, and `{engine}` placeholders.
- Git diff based ZenTao comment draft when resolving or closing bugs.
- Inline ZenTao workflow actions: assign, confirm, resolve, close, and activate.

## Build

Run the repository-level build script:

```bat
build.bat
```

The IntelliJ plugin package is generated under `intellij-plugin/build/distributions/`.
