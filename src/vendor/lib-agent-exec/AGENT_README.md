# Agent Execution Bridge (`agent-exec.ts`)

**Purpose**: This module functions as a **hardened, deterministic execution substrate** for AI agents. It shields you from the inherent unreliability of interactive shell environments (hanging processes, TTY bugs, quoting flaws) by providing a robust, non-interactive execution bridge.

✨ **NEW: PowerShell Proxy Interceptors** ✨
You no longer need to manually craft JSON payloads for most standard commands! The PowerShell environment now automatically intercepts native CLI tools (`git`, `docker`, `bun`, `npm`, `gh`, `node`, `python`, etc.) via proxy functions. When you execute `run_command("bun run check")`, the proxy seamlessly intercepts it and routes it through `lib-agent-exec` securely under the hood.

You only need to manually pass a JSON payload (as described below) if you are executing complex scripts or raw `eval` code snippets that are not natively intercepted. By pairing this deterministic execution with a deterministic repository model (`lib-git-history`), we eliminate the two largest sources of friction in agentic workflows.

## 🧹 Scratch Workspace Protocol

> [!CAUTION]
> **STRICT SCRATCH FILE POLICY**: Agents often mistakenly create temporary files, scripts, or payloads in `.agents/scratch`, `.agents/scripts/scratch-repo`, or the root workspace. This is **STRICTLY FORBIDDEN**.
> 
> **ALWAYS** write your payloads, scripts, and temporary files exclusively to the isolated conversation directory:
> `<appDataDir>\brain\<conversation-id>\scratch\`
> 
> NEVER leave payload JSONs or scratch files in the active project workspace.

## Payload Schemas

There are three execution types (`command`, `script`, `eval`). Always provide the payload via a `.json` file.

### 1. Command Payload
Used for executing standard CLI binaries.
```json
{
  "type": "command",
  "command": "git",
  "args": ["log", "-n", "5"],
  "cwd": "C:\\path\\to\\dir", // Optional
  "env": { "CUSTOM_VAR": "value" }, // Optional
  "timeoutMs": 30000 // Optional
}
```
**CRITICAL**: Do NOT pass arguments containing spaces as part of the `command` string. Use the `args` array. (e.g. `{"command": "gh pr view"}` is invalid. Use `{"command": "gh", "args": ["pr", "view"]}`).

### 2. Script Payload
Used for executing a script file (e.g. `.ts`, `.py`, `.sh`).
```json
{
  "type": "script",
  "scriptPath": "C:\\path\\to\\script.ts",
  "args": ["--flag", "value"]
}
```

### 3. Eval Payload
Used for executing raw code snippets dynamically.
```json
{
  "type": "eval",
  "code": "console.log('Hello from eval!');",
  "interpreter": "bun" // Optional (defaults to bun, can be python, node, bash, pwsh)
}
```

## Security & Reliability (Auto-Healing)

To ensure non-interactive reliability, `agent-exec.ts` actively intercepts and modifies commands to prevent hanging:

- **TTY Flag Stripping**: Docker TTY flags (`-t`, `--tty`) and interactive flags (`-i`) are automatically stripped.
- **PowerShell Padding**: If `pwsh` is called, `-NonInteractive -NoProfile` flags are forcefully injected.
- **Indefinite Blocking Prevention**: Commands like `docker logs -f` have their `-f`/`--follow` flags stripped. Utilities that inherently run indefinitely like `watch` or `tail -f` are blocked entirely.
- **Interactive REPL Blocks**: Attempting to launch `node`, `python`, or `bash` without arguments or a script file will be intercepted and terminated immediately to prevent hanging.
- **Shell Wrapper Blocking**: Wrapping standard tools (`git`, `docker`, `gh`, `npm`, etc.) inside inline shell invocations (e.g., `pwsh -c "git log"`) bypasses the interceptor pipeline and is strictly blocked. Use a `script` payload or invoke the tool directly via a `command` payload.
- **Prompt Detection & Stall Prevention**: Deep heuristic regexes detect unexpected interactive prompts (including standard package manager queries, `inquirer.js` `? Prompt:` flows, `title:`, `body:`, and `y/n` confirmations) and terminate the process to prevent indefinite hanging.
- **Quote Stripping**: Spurious quotes around arguments are stripped since the shell execution is bypassed.

## Environment Variables & Immutability

The bridge standardizes the environment to enforce non-interactive behaviors. The following environment variables are **immutable** and cannot be overridden by your payload. Attempting to override them will result in a warning, but the execution will continue:

- `CI` (Always `1`)
- `NO_COLOR` (Always `1`)
- `PAGER` (Disabled to prevent `less`/`cat` blocking)
- `GIT_EDITOR`, `GH_EDITOR`, `EDITOR`, `VISUAL`, `GIT_SEQUENCE_EDITOR` (Always `true`)
- `GIT_ASKPASS`, `SSH_ASKPASS` (Always `agent-exec-blocked`)
- `GIT_TERMINAL_PROMPT`, `GH_PROMPT_DISABLED`

## Stream Management & Output
- **ANSI Stripping**: The bridge utilizes native C++ Node APIs (`util.stripVTControlCharacters`) to comprehensively strip terminal escape codes in real-time.
- **Carriage Returns**: Backspaces (`\b`) and carriage returns (`\r`) from animated progress bars are automatically resolved linearly ($O(N)$) before output.
- **Real-Time Flushing**: To ensure interactive prompts and paused progress bars are visible to agents, the `StreamManager` employs a 200ms inactivity timer to flush pending non-newline-terminated strings.
- **Truncation**: Output is strictly capped. If a command exceeds the `maxBuffer` limit (default 10MB), the process tree will be forcibly terminated. You may specify `stdoutFile` or `stderrFile` in the payload to redirect massive outputs to disk and raise the buffer limit to 1GB.
