# `lib-agent-exec` Usability Testing Directory

This directory contains adversarial usability testing prompts for validating the core `lib-agent-exec` proxy layer and its native interceptors.

## Testing Scope
- **Payload Validation**: Ensures `command`, `script`, and `eval` schemas strictly adhere to Zod definitions and `ts-pattern` routing. Covers edge cases like `cwd`, `args`, `env`, `timeoutMs`, `stallTimeoutMs`, `target`, `stdin`, `integrationContext`, `templateOverride`, `expectJsonEnvelope`, `bypassInterceptors`, `webhookMethod`, `webhookHeaders`, `webhookPayloadTemplate`, `webhookTimeoutMs`, `onSuccess`, `onFailure`, `stdoutFile`, `stderrFile`, `maxBuffer`, `truncateOutputLength`, and `keepPayload`. It also covers `eval` and `script` interpreter overrides and CLI arguments like `--plugin`, `--payloadPath`, `--interceptors`, `--help`, and `--json`.
- **Auto-Healing Hints**: Verifies that the proxy outputs actionable hints for autonomous agents to fix bad commands without asking the user.
- **Environment & Immutability**: Validates PowerShell execution isolation (`-NonInteractive -NoProfile`), environment locking (`CI=1`), and dynamic payload `env` injection.
- **Interceptors**: Verifies that CLI proxies (`docker`, `npm`, `git`, `pwsh`, `bash`, `python`, `bun`, `gh`, `node`) gracefully handle filter exit codes (e.g. `grep`, `diff`, `npm outdated` returning 1 -> 0), strip blocking TTY flags (`-it`), trap interactive prompts/hanging REPLs, and block bad git flows.
- **Execution Target**: Validates both native Windows execution and `"target": "wsl2"` explicit traversal for pipelines.
- **Stream Multiplexing & Formatting**: Tests ANSI stripping, CRLF line ending resolution, and real-time buffer flushing (200ms interval).
- **Bypasses & Overrides**: Tests `--agent-bypass` flag, `native` prefix, and `Disable-AgentExec` escape hatches.
- **Security Validation**: Tests for string bounds limits, rejecting null bytes (`\x00`) and carriage returns (`\r`) in payload fields.

## Agent Guidelines
1. Do not merge or collapse tests unless authorized; isolated files prevent context-window exhaustion.
2. If tests fail, agents must formulate a hypothesis and write a failing unit test reproducing the bug in the main `lib-agent-exec/tests` suite *before* fixing the interceptor or core code.
3. Fixes in `lib-agent-exec` heavily rely on `ts-pattern` and `zod`. Agents must read the respective skills before modifying execution routing.
4. When editing or splitting files, remember to update `coordinator-workflow.md` accordingly.
