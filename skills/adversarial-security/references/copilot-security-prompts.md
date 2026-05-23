# Copilot Security Prompts

Reference for Phase 4 of the adversarial security protocol — the independent
external validation pass using the GitHub Copilot CLI.

## Why Copilot?

After self-adversarial review (Phases 2–3), confirmation bias can still
persist because the same model produced both the reconnaissance and the red
team critique. The Copilot CLI invokes a fundamentally different model with a
separate context window, catching blind spots that internal review misses.

For security audits specifically, this matters because:

- The Threat Modeler may have over-documented defenses that look stronger
  than they are, and the Red Team (same model) may not have fully challenged
  those assumptions
- Copilot brings a fresh perspective without the context of prior phases,
  which can surface entirely new attack vectors
- Independent review is a standard practice in professional security auditing

## Prerequisites

1. **Copilot CLI installed**: `gh extension list | grep copilot` or install via `gh extension install github/gh-copilot`
2. **Authenticated**: `gh auth status` and `gh copilot --version`
3. **Skill dependency**: The `github-copilot-cli` skill documents setup
   details

If Copilot CLI is not available, skip Phase 4 gracefully and note the skip
in the journal entry. The audit is still valid with Phases 1–3 alone.

## Prompt Templates

These prompts are tailored for repository-wide security auditing. They
differ from the adversarial-planner's plan-specific prompts in that they
focus on concrete code patterns rather than architectural decisions.

### Full Repository Security Audit

> **Note:** The `gh copilot` CLI extension does not natively support non-interactive file stream piping for open-ended prompts like the deprecated `@github/copilot` npm package did.
> For Phase 4 audits, you must either:
> 1. Fall back to manual Copilot Chat window usage with the prompt templates.
> 2. Use `gh copilot explain <file>` individually for high-risk files.
> 3. Document the limitation in the `security_copilot` journal entry and mark Phase 4 as manually bypassed.

If using Copilot Chat manually, you can use these prompts:

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

## Parsing Copilot Output

Copilot returns unstructured Markdown. To integrate findings into the
protocol:

1. **Extract findings** — parse the Markdown for tables or numbered lists
2. **Map to categories** — classify each finding against the 10 audit
   categories (Dependencies, Secrets, Injection, Auth, Transport, Docker,
   CI/CD, Information Disclosure, Supply Chain, MCP-Specific)
3. **Assign CWE IDs** — if Copilot didn't provide CWEs, assign the most
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

- **`github-copilot-cli` skill** — CLI installation, authentication, and
  non-interactive piping patterns
- **`adversarial-planner/references/copilot-integration.md`** — Plan-specific
  review prompts (architecture, roadmap); use this skill for code-level
  security review instead
