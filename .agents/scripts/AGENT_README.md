# 🤖 Agent README: Core Infrastructure Scripts

**Purpose**: This directory (`.agents/scripts`) contains the critical infrastructure scripts that power agentic workflows within the `adamic` workspace. These scripts form the foundational architecture for deterministic agent operations.

> [!WARNING]
> **HIGH INTEGRITY ZONE**: Do not modify these files lightly. If you must make changes, you are required to validate your changes against their respective test suites and ensure you do not break the core execution bridges.

---

## 🧠 Architectural Philosophy

Together, these core libraries resolve the two largest sources of friction in agentic workflows: unpredictable command execution and opaque repository state.

- **`lib-agent-exec`** functions as a hardened, deterministic execution substrate. It shields agents from the inherent unreliability of interactive shell environments.
- **`lib-git-history`** serves as a structured repository intelligence layer. It elevates raw version control data far beyond a simple changelog parser into an actionable, semantic model.

By combining a deterministic execution bridge with a deterministic history model, agents can now reason over the repository and execute commands within it with unprecedented reliability.

> **🛡️ Adversarial Audit Status: Fully Compliant**
> Both `lib-agent-exec` and `lib-git-history` have been thoroughly audited against `/cli-development` and internal usability standards, guaranteeing safe, headless payload execution, `zod`-validated schemas, and strict `stderr`/`stdout` boundaries.
---

## 🧹 Scratch Workspace Protocol (CRITICAL)

> [!CAUTION]
> **STRICT SCRATCH FILE POLICY**: Agents consistently make the mistake of creating temporary files, mock repositories, or payload scripts in unauthorized directories like:
> - `C:\Users\chris\Desktop\adamic\.agents\scratch`
> - `C:\Users\chris\Desktop\adamic\.agents\scripts\scratch-repo`
> - `C:\Users\chris\Desktop\adamic\tmp`
> 
> This is **STRICTLY FORBIDDEN** and creates a messy workspace.
> 
> **ALWAYS** write your payloads, test scripts, and temporary files exclusively to your isolated conversation scratch directory:
> `<appDataDir>\brain\<conversation-id>\scratch\`
> 
> NEVER leave scratch files in the active project workspace.

---

## 🏗️ Core Infrastructure Tools

### 1. The Execution Bridge (`agent-exec.ts` & PowerShell Proxies)
The single source of truth for all non-interactive agent terminal commands (`git`, `docker`, `node`, `gh`, `bun`, etc.). 
- **Mechanism**: The environment utilizes PowerShell proxy functions to automatically intercept common CLI calls and route them through `agent-exec.ts`. The bridge spawns processes with `shell: false` to bypass terminal quoting, parsing bugs, and interactive prompts. It treats exit code `1` gracefully for filtering tools (`grep`, `diff`), aggressively strips ANSI escape codes, mitigates hanging processes, and truncates massive outputs to protect your token context window.
- **PowerShell 5.1 Limitations (The `&&` Rule) & WSL2 Linux Support**: Native terminal commands run in PowerShell 5.1, which **does not support** pipeline chain operators (`&&` or `||`). To bypass this limitation and safely chain commands or utilize native Unix pipelines, you **MUST** leverage robust Linux execution by writing a `target: "wsl2"` JSON payload for `agent-exec` (or creating a `.sh` script). This will automatically route execution securely into the WSL2 Linux VM.
- **Agent Usage**: You can execute standard commands natively and they will be securely intercepted. For executing raw code snippets, complex scripts, or pipeline chains, write a JSON payload to your designated scratch directory and execute it via `bun C:\Users\chris\Desktop\adamic\.agents\scripts\agent-exec.ts <path-to-payload>`.
- **Human Interactive Bypass**: If a human user needs to run an interactive flow (like `gh auth login`), they can bypass the proxy using the `--agent-bypass` flag, the `native` command prefix, or by toggling `Disable-AgentExec`. The proxy explicitly reminds users of these bypass methods via a CLI hint whenever an interception occurs.
- *Further Reading*: Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\agent-exec.ts --help` for the comprehensive CLI manual (including full documentation of all available Base Options) or use `--help --json` for a structured JSON envelope. You can also see `lib-agent-exec/AGENT_README.md` for detailed auto-healing behaviors.

### 2. The Commit Wrapper (`commit.ts`)
The engine for generating high-integrity conventional commits.
- **Mechanism**: Generates high-integrity conventional commits. It strictly enforces conventional commit standards, calculates impacts/trust metadata, and embeds this data into the Git log via trailers.
- **Agent Usage**: **NEVER** use `CHANGELOG.md` or raw `git commit`. **ALWAYS** immediately commit using the wrapper: `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --category Changed --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed`.
- **Additional Capabilities**: `commit.ts` natively supports several extended flags:
  - `--msg` / `--message` / `-m` / positional argument (commit subject)
  - `--add <path>` (explicit staging, can be used multiple times)
  - `--journal` / `--journal-project <id>` (automatic memory journaling)
  - `--history` / `--history-file <path>` / `--no-history` (history narratives)
  - `--significance <string>` (e.g. 'milestone', 'security')
  - `--category <string>` (explicit category override)
  - `--cwd <path>` (custom working directory)
  - `--trust <number>` (legacy, prefer `--confidence`)
  - `--help` (display usage documentation)

### 3. The History Extractor (`get-git-history-json.ts`)
The authoritative parser for extracting structured history from the repository.
- **Mechanism**: Translates raw `git log` text into structured JSON, reading the metadata trailers embedded by the commit prompts.
- **Agent Usage**: **NEVER** use `git log`, `git shortlog`, or `git show` for exploring history. Always use this script. Run `bun .\.agents\scripts\get-git-history-json.ts --help` to view the comprehensive manual of available filtering and formatting flags.
- *Further Reading*: See `lib-git-history/AGENT_README.md` for schema constraints and parsing strategies.

---

## 🧪 Testing and Validation

If you modify any of the scripts in this directory, you MUST validate your changes:
1. Ensure your scratch testing scripts are located in the correct `<appDataDir>\brain\<conversation-id>\scratch\` directory.
2. Execute the isolated tests using Bun: `bun test ./.agents/scripts` (do **NOT** use Vitest).
3. Always run the validation pipeline (`pnpm run check`) before committing.
