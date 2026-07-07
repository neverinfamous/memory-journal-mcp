# Agent Execution Bridge (`agent-exec.ts`)

> **🛡️ Adversarial Audit Status: Fully Compliant**
> This infrastructure module has been exhaustively audited against the `/cli-development` standards. It strictly enforces standard stream routing (all diagnostic output to `stderr`, reserved payload output to `stdout`), validates inputs via `zod`, leverages `ts-pattern` for deterministic routing, and guarantees deterministic execution without hanging processes.
**Purpose**: This module functions as a **hardened, deterministic execution substrate** for AI agents. It shields you from the inherent unreliability of interactive shell environments (hanging processes, TTY bugs, quoting flaws) by providing a robust, non-interactive execution bridge.

✨ **NEW: PowerShell Proxy Interceptors** ✨
You no longer need to manually craft JSON payloads for most standard commands! The PowerShell environment now automatically intercepts native CLI tools (`git`, `docker`, `bun`, `npm`, `npx`, `bunx`, `pnpm`, `gh`, `node`, `python`, etc.) via proxy functions. When you execute `run_command("bun run check")`, the proxy seamlessly intercepts it and routes it through `lib-agent-exec` securely under the hood.

You only need to manually pass a JSON payload (as described below) if you are executing complex scripts or raw `eval` code snippets that are not natively intercepted. By pairing this deterministic execution with a deterministic repository model (`lib-git-history`), we eliminate the two largest sources of friction in agentic workflows.

> [!TIP]
> **CLI Manual**: You can dynamically view the comprehensive CLI manual and pipeline usage guide by running `bun .\.agents\scripts\agent-exec.ts --help`. For agentic workflows, you can append `--json` to retrieve the manual as a structured JSON object. You can also supply `--plugin` (or `--interceptors`) with a path to a workspace file to load custom interceptor plugins at runtime.

## ⚠️ The `&&` Pipeline Chaining Rule & WSL2 Linux Support

> [!WARNING]
> Native commands run in **PowerShell 5.1**, which **DOES NOT SUPPORT** `&&` or `||` operators. If you run `run_command("bun check && bun test")`, the parser will instantly throw a fatal syntax error. 
> 
> Whenever you must chain commands natively or utilize robust Unix pipelines, you **MUST** leverage WSL2 execution by creating a JSON payload with `"target": "wsl2"` and running it via `agent-exec`. This routes the command seamlessly into the Linux VM environment, fully supporting `&&`, `||`, `|`, and other POSIX shell features.

## 🧹 Scratch Workspace Protocol

> [!CAUTION]
> **STRICT SCRATCH FILE POLICY**: Agents often mistakenly create temporary files, scripts, or payloads in `.agents/scratch`, `.agents/scripts/scratch-repo`, or the root workspace. This is **STRICTLY FORBIDDEN**.
> 
> **ALWAYS** write your payloads, scripts, and temporary files exclusively to the isolated conversation directory:
> `<appDataDir>\brain\<conversation-id>\scratch\`
> 
> NEVER leave payload JSONs or scratch files in the active project workspace.

## 🚪 Interactive Mode & Bypassing the Proxy

If you are a **human user** attempting to run interactive commands natively in your PowerShell terminal (e.g., `gh auth login`), the proxy interceptor will normally block them. *Note: The proxy explicitly prints a helpful intercept message reminding users of these bypass methods whenever a command is forwarded.* You can bypass the proxy using the following methods:

1. **Per-Command Flag**: Append `--agent-bypass` to any command.
   *Example*: `gh auth login --agent-bypass`
2. **Native Passthrough Alias**: Prepend `native` to any command.
   *Example*: `native gh auth login`
3. **Session-Wide Toggle**: Temporarily disable the interceptor completely by running `Disable-AgentExec`. To turn it back on, run `Enable-AgentExec`. This writes a temporary state file to `$env:TEMP\.agent_exec_bypass`, meaning the bypass will safely persist across separate agent `run_command` tool calls.

## Payload Schemas

There are three execution types (`command`, `script`, `eval`). Always provide the payload via a `.json` file.

> [!NOTE]
> **Payload Validation**: Ensures `command`, `script`, and `eval` schemas strictly adhere to Zod definitions and `ts-pattern` routing. Covers edge cases like `cwd`, `args`, `env`, `timeoutMs`, `stallTimeoutMs`, `target`, `integrationContext`, `templateOverride`, `keepPayload`, `expectJsonEnvelope`, `bypassInterceptors`, `webhookHeaders`, `webhookPayloadTemplate`, `webhookMethod`, `webhookTimeoutMs`, `onSuccess`, `onFailure`, `stdin`, `stdoutFile`, `stderrFile`, `maxBuffer`, and `truncateOutputLength`.

### 1. Command Payload
Used for executing standard CLI binaries.
```json
{
  "type": "command",
  "command": "git",
  "args": ["log", "-n", "5"],
  "cwd": "C:\\path\\to\\dir", // Optional
  "env": { "CUSTOM_VAR": "value", "IS_TRUE": true, "PORT": 8080 }, // Optional (numbers and booleans are automatically coerced to strings)
  "stdin": "input string", // Optional (max 10MB, supports null bytes)
  "stdoutFile": "C:\\path\\to\\out.log", // Optional
  "stderrFile": "C:\\path\\to\\err.log", // Optional
  "maxBuffer": 10485760, // Optional
  "truncateOutputLength": 1048576, // Optional
  "keepPayload": false, // Optional
  "bypassInterceptors": true, // Optional (disables safety heuristics)
  "timeoutMs": 30000, // Optional
  "stallTimeoutMs": 10000, // Optional
  "expectJsonEnvelope": false, // Optional
  "onSuccess": ["http://localhost:9999/success"], // Optional (string or array of strings)
  "onFailure": "http://localhost:9999/fail", // Optional (string or array of strings)
  "webhookMethod": "POST", // Optional (GET, POST, PUT, PATCH, DELETE)
  "webhookHeaders": { "Authorization": "Bearer {{integrationContext.token}}" }, // Optional
  "webhookPayloadTemplate": { "status": "{{envelope.status}}", "data": "{{envelope.data}}" }, // Optional (Accepts string, object, or array)
  "webhookTimeoutMs": 5000, // Optional
  "target": "wsl2" // Optional (routes execution natively into the WSL2 Linux VM)
}
```
**CRITICAL**: Do NOT pass arguments containing spaces as part of the `command` string. Use the `args` array. (e.g. `{"command": "gh pr view"}` is invalid. Use `{"command": "gh", "args": ["pr", "view"]}`).

### 2. Script Payload
Used for executing a script file (e.g. `.ts`, `.py`, `.sh`).
```json
{
  "type": "script",
  "scriptPath": "C:\\path\\to\\script.ts", // Can also be a relative path (resolves against the payload's 'cwd')
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

### Note on Templates (`integrationContext`)
If an `integrationContext` object is provided in the payload, you may use template string substitution (e.g. `{{integrationContext.slackToken}}`) across the `command`, `args`, `env`, `scriptPath`, `code`, `templateOverride`, `webhookHeaders`, `onSuccess`, and `onFailure` properties. This simplifies injection of dynamic credentials and external configuration strings.

### Structured JSON Envelopes (`expectJsonEnvelope`)
All payload types (`command`, `script`, `eval`) support an optional boolean flag: `"expectJsonEnvelope": true`. 
When enabled, the execution bridge will actively parse the final output line of `stdout` for a structured JSON envelope. 
**CRITICAL**: The envelope MUST strictly match the schema (`{"status": "success" | "error"}`). If `status` is missing or contains any other value (e.g. `"in-progress"`), it will degrade gracefully and be printed to `stdout` as normal text, without overriding the exit code.
- **Smart Exit Codes**: If the envelope status is `"error"`, the physical process exit code is automatically overridden to a failure (even if the shell script exited `0`).
- **Webhook Integration**: Exposes the `{{envelope.data}}` and `{{envelope.status}}` template variables for use within `webhookPayloadTemplate`. Features like `webhookMethod`, `webhookHeaders`, `onSuccess`, and `onFailure` are fully supported for complex integrations.

## 🛠️ Handling Autonomous Healing Hints

When you execute a command and see a console error containing `🛠️ AUTONOMOUS HEALING:`, it means `agent-exec` had to automatically intercept your command to prevent execution failure (e.g., blocking an interactive prompt, stripping a hanging flag).

**If you encounter this hint during an autonomous task:**
1. **DO NOT ask the user for help.**
2. **Autonomously fix it:** Read the explicit guidance in the intercept message and immediately re-invoke the correct native tool or adjust the command parameters yourself.

## 9. Troubleshooting & Common Issues

### WSL2 Test Flakiness
When running the full test suite via `bun test`, WSL2-related tests may occasionally timeout or fail (e.g., `grep -E` tests or generic stream boundaries) due to high concurrency overloading the host's WSL instance. If you encounter WSL timeouts during a full suite run, run the failing tests in isolation to verify if they are genuinely broken.

### Zombie Processes
If you interrupt tests (or if a specific stress test fails), you might leave orphaned `node` or `wsl` processes holding file locks.

## Security & Reliability (Interception Rules)

To ensure non-interactive reliability, `agent-exec.ts` actively intercepts and modifies commands to prevent hanging and false positives. If you need to explicitly bypass these interceptors (e.g., for testing edge cases), you can set `"bypassInterceptors": true` in your JSON payload:


- **Graceful Filtering Tools**: Commands like `grep`, `egrep`, `rg`, `diff`, and `git diff` return exit code `1` when no matches/differences are found. Similarly, package manager commands like `npm outdated` or `pnpm outdated` return `1` when updates are available. The bridge automatically treats code `1` for these tools as a clean `0` success, preventing false-positive pipeline failures. This behavior correctly applies even when these commands are executed indirectly via shell wrappers (e.g. `wsl`, `bash -c`, or `powershell`), within `eval` snippets and `script` payloads, AND when the agent requests a JSON envelope (e.g., `--json`), outputting `status: "success"` instead of an error.
- **TTY Flag Stripping**: Docker TTY flags (`-t`, `--tty`) and interactive flags (`-i`) are automatically stripped.
- **PowerShell Padding**: If `pwsh` is called, `-NonInteractive -NoProfile` flags are forcefully injected.
- **Indefinite Blocking Prevention**: Utilities that inherently run indefinitely like `watch`, `tail -f`, and `docker logs -f` are blocked entirely.
- **TUI & Interactive App Blocking**: TUI apps (`vim`, `nano`, `less`, etc.) are blocked natively, wrapped via `wsl`, or launched inside containers via `docker exec`/`docker run` to prevent the agent from hanging.
- **Interactive REPL Blocks**: Attempting to launch `node`, `python`, or `bash` without arguments or a script file will be intercepted and terminated immediately to prevent hanging.
- **Shell Wrapper Blocking**: Wrapping standard tools (`git`, `docker`, `gh`, `npm`, `npx`, `bunx`, etc.) inside inline shell invocations (e.g., `pwsh -c "git log"`) bypasses the interceptor pipeline and is strictly blocked across native commands, `eval` snippets, and `script` payloads. Invoke the tool directly via a `command` payload, or write the raw script commands without an inline shell wrapper.
- **Prompt Detection & Stall Prevention**: Deep heuristic regexes detect unexpected interactive prompts (including standard package manager queries, `inquirer.js` progress flows, editor blocks like `Waiting for Emacs...`, standard TTY forced shells like `bash$`, `sh$`, and `bash-5.1$`, `title:`, `body:`, and `y/n` confirmations) and terminate the process to prevent indefinite hanging.
- **Git Interception**: The bridge aggressively intercepts forbidden git flows. History commands (`git log`, `git shortlog`, `git show`) and raw `git commit` are completely blocked to prevent unparsable text dumps and interactive hanging. You MUST use the deterministic wrappers (`bun .\\.agents\\scripts\\get-git-history-json.ts` and `bun .\\.agents\\scripts\\commit.ts`). Interactive patching (`-p`) and interactive rebasing (`-i`) are also blocked. While explicit file staging (`--add <path>`) is strongly preferred for atomic commits, wildcard staging (`--add .`) is fully supported by the commit wrapper as a convenient fallback for sweeping changes.
- **Quote Stripping**: Spurious quotes around arguments are stripped since the shell execution is bypassed.

## 🪤 Common PowerShell Hallucination Traps

Agents frequently hallucinate Unix tools or specific flags that break natively in PowerShell:

1. **`curl` & `wget`**: PowerShell natively aliases these to `Invoke-WebRequest`. Unix flags like `-s`, `-D`, or `-L` will instantly fail (e.g., `Missing an argument for parameter 'SessionVariable'`). 
   * **Fix**: Always use the native `read_url_content` tool. If you must use curl CLI, invoke `curl.exe` explicitly to bypass the PowerShell alias.
2. **`cat`, `ls`, `grep` & Native PowerShell Cmdlets**: PowerShell aliases `cat` to `Get-Content`, `ls` to `Get-ChildItem`, and lacks native Unix `grep` (often substituted with `Select-String`). Do NOT use these commands or their PowerShell cmdlet equivalents for file operations. They bypass the proxy's safety guardrails and will fail ungracefully if you hallucinate file paths.
   * **Fix**: You MUST use the agent-native tools instead for files: `view_file` (instead of cat/Get-Content), `list_dir` (instead of ls/Get-ChildItem), and `grep_search` (instead of grep/Select-String).
   * **Exception**: You ARE allowed to use `grep`, `rg`, or `cat` natively when piping data into them as a stream filter (e.g., `npm list | grep foo`). The interceptor will block them if used as standalone file commands without stdin.
3. **`gh run view --log`**: If a GitHub Action job is still running, this command exits with code 1 instead of waiting.
   * **Fix**: Do NOT poll this in a loop. Use the `schedule` tool to set an asynchronous timer to check back later.

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
- **Truncation**: Output is strictly capped. If a command exceeds the `maxBuffer` limit (default 10MB), the process tree will be forcibly terminated. You may specify `stdoutFile` or `stderrFile` in the payload to redirect massive outputs to disk and raise the buffer limit to 1GB. To prevent graceful truncation from triggering a `maxBuffer` crash, you can specify `truncateOutputLength` which limits the stored buffer and protects memory without killing the process.

## 🧪 Usability & Hallucination Testing

If you modify interceptors or execution logic, programmatic `bun test` passes are **not enough**. You MUST run the usability testing suite to ensure actual agents don't get trapped by false positives (e.g. `&&` chains or pipeline character bugs).
- **Run the Fuzzing Suite:** Ask the user to "Execute the usability testing coordinator workflow in adamic", or manually trigger the subagents defined in `.agents/scripts/usability/coordinator-workflow.md`.

---

## 📈 Continuous Self-Improvement
As an agent operating within this workspace, you are expected to practice continuous self-improvement. If you identify gaps, ambiguities, or missing instructions during an audit or execution task, **proactively update this `AGENT_README.md`** and relevant testing prompts. You are empowered to refine your own processes.
