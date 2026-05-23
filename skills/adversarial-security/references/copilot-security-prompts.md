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

1. **Copilot CLI installed**: `npm list -g @github/copilot`
2. **Authenticated**: `copilot auth` (requires browser approval)
3. **Skill dependency**: The `github-copilot-cli` skill documents setup
   details

If Copilot CLI is not available, skip Phase 4 gracefully and note the skip
in the journal entry. The audit is still valid with Phases 1–3 alone.

## Prompt Templates

These prompts are tailored for repository-wide security auditing. They
differ from the adversarial-planner's plan-specific prompts in that they
focus on concrete code patterns rather than architectural decisions.

### Full Repository Security Audit

Use this as the primary Phase 4 prompt:

```bash
echo "You are a senior security engineer performing a code audit. Review this repository for security vulnerabilities. Focus on:

1. **Injection vectors** — SQL injection, command injection, path traversal, prototype pollution. Look for string interpolation in queries, unsanitized user input, and dynamic code execution.
2. **Authentication & authorization gaps** — endpoints or tools accessible without proper auth, missing scope checks, token handling flaws.
3. **Secret exposure** — hardcoded credentials, API keys in source, .env files not gitignored, secrets in CI workflow files.
4. **Sandbox escapes** — if the project has sandboxed code execution (vm, worker_threads, isolated-vm), look for escape vectors via constructor chains, prototype access, or global leaks.
5. **Dependency risks** — known CVEs in dependencies, typosquatting potential, unnecessary transitive dependencies with broad permissions.

Here are the key source files:

$(find src/ -name '*.ts' -not -path '*/node_modules/*' | head -50 | while read f; do echo "=== $f ==="; head -100 "$f"; echo; done)

Output a Markdown table with columns: #, Category, Severity (Critical/High/Medium/Low), CWE ID, File:Line, Finding, Remediation." | copilot
```

### MCP-Specific Security Review

Use this when the target is an MCP server:

```bash
echo "You are a security researcher specializing in AI agent tool ecosystems. This repository implements an MCP (Model Context Protocol) server. Review it for MCP-specific security risks:

1. **Tool poisoning** — Do any tool \`description\` fields contain hidden instructions that could manipulate an AI agent? Check for prompt injection in tool descriptions, parameter descriptions, and schema metadata.
2. **Annotation accuracy** — Do \`readOnlyHint\`, \`destructiveHint\`, and \`openWorldHint\` annotations accurately reflect tool behavior? Mismatched annotations can bypass client safety gates.
3. **Credential echo** — Do any tool responses include sensitive data (API keys, tokens, connection strings, internal paths)?
4. **Scope enforcement** — Are permission scopes consistently checked across all tools, or can some tools be invoked without proper authorization?
5. **Input validation** — Are all tool input schemas properly validated with Zod/JSON Schema before execution, or do any tools blindly trust agent-provided parameters?

Here are the tool definitions and schemas:

$(find src/ -name '*.ts' -path '*/tools/*' | head -30 | while read f; do echo "=== $f ==="; head -80 "$f"; echo; done)

Output a structured assessment with findings table and severity ratings." | copilot
```

### Supply Chain & Dependency Review

Use this for `paranoid` depth audits or when the dependency tree is large:

```bash
echo "You are a supply chain security analyst. Review this project's dependency configuration for risks:

1. **Lock file integrity** — Is package-lock.json committed and used with npm ci in CI?
2. **Typosquatting** — Do any package names look suspicious or similar to popular packages?
3. **Install scripts** — Do any dependencies run preinstall/postinstall scripts?
4. **Deprecated packages** — Are there unmaintained dependencies with no security patches?
5. **Excessive permissions** — Do dependencies request filesystem, network, or native addon access that seems unnecessary for their purpose?
6. **Transitive vulnerabilities** — Are there deep transitive dependencies with known CVEs not caught by npm audit?

$(cat package.json)

$(head -200 package-lock.json)

Output a risk assessment with specific package names and recommendations." | copilot
```

### CI/CD Pipeline Security Review

Use this to validate the CI/CD security posture:

```bash
echo "You are a DevSecOps engineer. Review these GitHub Actions workflow files for security issues:

1. **Action pinning** — Are actions referenced by SHA hash or by mutable version tags?
2. **Secret handling** — Are secrets properly scoped and never logged or echoed?
3. **Permissions** — Do workflows follow least privilege (explicit permissions block)?
4. **Security gates** — Do security scan steps (npm audit, CodeQL, Trivy) hard-fail on findings?
5. **Artifact exposure** — Could build artifacts, coverage reports, or logs leak sensitive paths?
6. **Supply chain** — Is npm provenance enabled for publish workflows?

$(find .github/workflows -name '*.yml' | while read f; do echo "=== $f ==="; cat "$f"; echo; done)

Output a findings table with severity and concrete fixes." | copilot
```

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
