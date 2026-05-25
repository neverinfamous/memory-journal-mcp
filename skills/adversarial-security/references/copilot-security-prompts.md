# GitHub CLI Security Prompts

Reference for Phase 4 of the adversarial security protocol — the independent
external validation pass using the GitHub CLI.

## Why External Validation?

After self-adversarial review (Phases 2–3), confirmation bias can still
persist because the same model produced both the reconnaissance and the red
team critique. The GitHub CLI invokes a fundamentally different model with a
separate context window, catching blind spots that internal review misses.

For security audits specifically, this matters because:

- The Threat Modeler may have over-documented defenses that look stronger
  than they are, and the Red Team (same model) may not have fully challenged
  those assumptions
- An independent model brings a fresh perspective without the context of
  prior phases, which can surface entirely new attack vectors
- Independent review is a standard practice in professional security auditing

## Prerequisites

1. **GitHub CLI installed**: `gh --version` (v2.x+)
2. **Authenticated**: `gh auth status`
3. **Copilot access**: `gh copilot --version` — the `copilot` subcommand is
   built into modern `gh` CLI (no separate extension needed)

If `gh copilot` is not available, skip Phase 4 gracefully and note the skip
in the journal entry. The audit is still valid with Phases 1–3 alone.

## Execution Mode

> **⚠️ NON-INTERACTIVE ONLY**: `gh copilot` must be run with the `-p`
> (or `--prompt`) flag for non-interactive execution. The legacy
> `gh copilot explain` syntax is interactive and will hang in agent contexts.

**Correct invocation pattern:**
```
Set-Location <target-repo>
gh copilot -p "<prompt text>" --allow-tool "shell(find,cat,head,grep)"
```

**Key flags:**
- `-p` / `--prompt`: Non-interactive mode (REQUIRED for agents)
- `--allow-tool "shell(find,cat,head,grep)"`: Grants Copilot read-only
  shell access to browse the repository. Without this, Copilot cannot
  inspect source files and findings will be shallow.

**Operational notes:**
- Always `Set-Location` (or `cd`) to the target repository BEFORE invoking.
  Copilot uses the cwd as its workspace root.
- Each prompt invocation runs independently — there is no conversation state
  between calls.
- Expect 60–120 seconds per prompt. In environments with hard synchronous timeouts (like Antigravity's 10s `WaitMsBeforeAsync` limit), allow the command to naturally fall into the background. Use the `schedule` tool or wait for the system notification to retrieve the results. Do not skip execution due to timeout constraints.
- Long prompts work fine — the CLI accepts multi-line strings in quotes.

> **⚠️ NO FABRICATION**: You MUST actually execute `gh copilot` and include
> its real output verbatim. Do NOT fabricate, summarize from memory, or
> predict what Copilot would say. If the command fails, document the failure
> instead of producing synthetic output. The entire value of Phase 4 depends
> on genuine independent analysis.

## Prompt Templates

These prompts are tailored for repository-wide security auditing. They
differ from the adversarial-planner's plan-specific prompts in that they
focus on concrete code patterns rather than architectural decisions.

### Full Repository Security Audit

**General Security Review:**
"You are a senior security engineer performing a code audit. Review this repository for security vulnerabilities. Focus on:
1. **Injection vectors** — SQL injection, command injection, path traversal, prototype pollution.
2. **Authentication & authorization gaps**
3. **Secret exposure**
4. **Sandbox escapes**
5. **Dependency risks**"

**MCP-Specific Security Review:**
"You are a security researcher specializing in AI agent tool ecosystems. Review this MCP server for security risks:
1. **Tool poisoning** — Do any tool `description` fields contain hidden instructions?
2. **Annotation accuracy** — Do annotations accurately reflect tool behavior?
3. **Credential echo** — Do any tool responses include sensitive data?
4. **Scope enforcement** — Are permission scopes consistently checked?
5. **Input validation** — Are all tool input schemas properly validated?"

**Supply Chain & Dependency Review:**
"You are a supply chain security analyst. Review this project's dependency configuration for risks:
1. **Lock file integrity**
2. **Typosquatting**
3. **Install scripts**
4. **Deprecated packages**
5. **Excessive permissions**
6. **Transitive vulnerabilities**"

**CI/CD Pipeline Security Review:**
"You are a DevSecOps engineer. Review these GitHub Actions workflow files for security issues:
1. **Action pinning**
2. **Secret handling**
3. **Permissions**
4. **Security gates**
5. **Artifact exposure**
6. **Supply chain**"

## Parsing Output

The external review returns unstructured Markdown. To integrate findings into
the protocol:

1. **Extract findings** — parse the Markdown for tables or numbered lists
2. **Map to categories** — classify each finding against the 10 audit
   categories (Dependencies, Secrets, Injection, Auth, Transport, Docker,
   CI/CD, Information Disclosure, Supply Chain, MCP-Specific)
3. **Assign CWE IDs** — if the review didn't provide CWEs, assign the most
   relevant ID from the audit-categories reference
4. **Deduplicate** — compare against Phase 2 findings; skip items already
   addressed in the remediation plan
5. **Disposition** — apply the same Accept/Reject/Modify/Defer framework
   from Phase 3 for any new findings

## Prompt Selection Guide

| Audit Depth | Project Type | Prompts to Use |
| --- | --- | --- |
| Recon | Any | Full Repository only |
| Standard | Non-MCP | Full Repository + CI/CD |
| Standard | MCP Server | Full Repository + MCP-Specific + CI/CD |
| Paranoid | Any | All 4 prompts |

## Cross-References

- **`adversarial-planner/references/copilot-integration.md`** — Plan-specific
  review prompts (architecture, roadmap); use this skill for code-level
  security review instead
