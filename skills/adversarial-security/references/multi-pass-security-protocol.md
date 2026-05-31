# Multi-Pass Security Protocol

Detailed reference for the 4-phase adversarial security audit workflow. Read
this when executing the protocol for the full review dimensions, scoring
system, and output templates.

## Phase 1 — Reconnaissance (Agent A: Threat Modeler)

### Inputs

Before starting the reconnaissance, gather context from these sources:

1. **Repository structure** — directory layout, entry points, transports,
   data flows, and build configuration
2. **Existing security documentation** — `SECURITY.md`, security checklists,
   threat models, and compliance references
3. **Prior audits** — search the journal for related security entries:
   ```
   search_entries({
     query: "<repository name> security",
     entry_type: "security_recon",
     tags: ["adversarial-security"]
   })
   ```
4. **Dependency manifest** — `package.json`, `package-lock.json`,
   `Dockerfile`, and CI workflow files
5. **Project type** — auto-detect or use the explicit `PROJECT_TYPE` setting
   (see SKILL.md § Auto-Detection)

### Reconnaissance Structure

Produce a Markdown document with these sections:

```markdown
# Security Reconnaissance — [Repository Name]

## Project Profile

- **Type**: [auto-detected or explicit: mcp-server, web-app, cli-tool, library]
- **Language/Runtime**: [e.g., TypeScript/Node.js 24]
- **Transports**: [e.g., stdio, HTTP, SSE]
- **Auth Model**: [e.g., OAuth 2.1, bearer token, none]
- **Dependencies**: [total count, direct vs. transitive]
- **CI/CD**: [e.g., GitHub Actions, 13 workflows]

## Trust Boundaries

Diagram or list of trust boundaries:

- External → Server (HTTP transport, MCP protocol)
- Server → Database (SQL queries, file operations)
- Server → Sandbox (Code Mode execution)
- [etc.]

## Attack Surface Map

For each entry point, document:

- Entry point name and location (file:line)
- Input type (user query, HTTP request, MCP tool call, etc.)
- Validation present (Zod schema, parameterized query, etc.)
- Auth required (scope, role, none)

## Existing Defenses (per Category)

For each of the 10 audit categories (see audit-categories.md):

- What defenses are in place
- Coverage assessment: full / partial / none
- Evidence: file paths and code references

## Threat Model Summary

| Threat         | Entry Point         | Existing Defense                                | Coverage |
| -------------- | ------------------- | ----------------------------------------------- | -------- |
| SQL injection  | sqlite_read_query   | Parameterized queries + identifier sanitization | Full     |
| Code execution | sqlite_execute_code | vm sandbox + blocked patterns + timeout         | Partial  |
| [etc.]         |                     |                                                 |          |

## Gaps Identified

Preliminary list of areas where defenses appear weak or absent.
These are hypotheses — Agent B will validate or refute them.
```

### Journal

```
create_entry({
  content: "<full reconnaissance>",
  entry_type: "security_recon",
  tags: ["adversarial-security", "recon"],
  project_number: <project number>
})
```

---

## Phase 2 — Red Team Review (Agent B: Red Team)

Switch mental models. You are now an attacker whose job is to break every
defense documented in Phase 1. Do not trust the Threat Modeler's coverage
assessments — verify them by attempting to construct attack scenarios.

### Review Dimensions

Score each dimension on a 1–5 scale. Dimensions have different weights
reflecting their relative importance for security:

| Dimension             | Weight | Focus Areas                                                                                              |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| **Exploitability**    | 4      | Attack complexity, privileges required, user interaction needed, remote vs. local, automation potential  |
| **Impact**            | 3      | Confidentiality (data breach), integrity (data tampering), availability (DoS), privilege escalation, RCE |
| **Existing Defenses** | 2      | Are mitigations effective? Can they be bypassed? Are there defense-in-depth layers?                      |
| **Detection**         | 1      | Would exploitation be caught by logging, monitoring, CI gates, or audit trails?                          |

### Severity Mapping (CVSS-Inspired)

| Weighted Score | Severity | Meaning                                                                        |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| 4.0–5.0        | Critical | Exploitable remotely with low complexity, high impact, no effective mitigation |
| 3.0–3.9        | High     | Exploitable with moderate complexity or auth, significant impact               |
| 2.0–2.9        | Medium   | Requires specific preconditions or has limited blast radius                    |
| 1.0–1.9        | Low      | Theoretical risk, defense-in-depth improvement, hardening recommendation       |

### Depth Profiles

The `AUDIT_DEPTH` configuration controls which categories and dimensions
receive full scrutiny:

- **Recon**: Categories 2 (Secrets), 3 (Injection), 4 (Auth) only. Focus on
  Exploitability + Impact dimensions. Best for quick triage.
- **Standard**: All 10 categories at stated weights. Default for most audits.
- **Paranoid**: All 10 categories + extended analysis:
  - Git history scanning for previously committed secrets
  - Prototype pollution chain analysis across dependency tree
  - ReDoS pattern analysis on all regex in codebase
  - Timing attack surface analysis on comparison operations
  - Supply chain deep dive (install scripts, typosquatting checks)
  - Cross-project ecosystem impact assessment

### Critique Output Format

```markdown
## Red Team Review — [Repository Name]

**Overall Security Score:** [weighted average] / 5.0
**Posture Grade:** [A–F]

### Grading Scale

| Grade | Score Range | Meaning                                                        |
| ----- | ----------- | -------------------------------------------------------------- |
| A     | 4.5–5.0     | Excellent — minimal risk, defense-in-depth present             |
| B     | 3.5–4.4     | Good — no critical issues, some hardening opportunities        |
| C     | 2.5–3.4     | Acceptable — medium-risk issues present, remediations needed   |
| D     | 1.5–2.4     | Poor — high-risk issues found, immediate action required       |
| F     | 1.0–1.4     | Failing — critical vulnerabilities, deployment not recommended |

### Findings

| #   | Category         | Severity | CWE     | Finding                                 | File:Line     | Exploitability         | Remediation             |
| --- | ---------------- | -------- | ------- | --------------------------------------- | ------------- | ---------------------- | ----------------------- |
| 1   | Input Validation | Critical | CWE-89  | SQL interpolation in dynamic query      | src/foo.ts:42 | Remote, no auth        | Use parameterized query |
| 2   | Auth             | High     | CWE-862 | Endpoint accessible without scope check | src/bar.ts:88 | Remote, auth bypass    | Add hasScope() guard    |
| 3   | Docker           | Medium   | CWE-250 | Container runs as root                  | Dockerfile:1  | Local, post-compromise | Add USER directive      |
| ... |                  |          |         |                                         |               |                        |                         |

### Dimension Scores

| Dimension         | Score | Weight | Weighted             |
| ----------------- | ----- | ------ | -------------------- |
| Exploitability    | [1–5] | 4      | [score × 4]          |
| Impact            | [1–5] | 3      | [score × 3]          |
| Existing Defenses | [1–5] | 2      | [score × 2]          |
| Detection         | [1–5] | 1      | [score × 1]          |
| **Total**         |       | **10** | **[sum]/50 = [avg]** |

### Category Breakdown

| Category            | Findings | Worst Severity | Coverage   |
| ------------------- | -------- | -------------- | ---------- |
| 1. Dependencies     | 0        | —              | ✅ Full    |
| 2. Secrets          | 1        | Low            | ✅ Full    |
| 3. Input Validation | 2        | Critical       | ⚠️ Partial |
| ...                 |          |                |            |

### Blocking Issues

List any findings that MUST be addressed before deployment or release.
These are non-negotiable — they represent exploitable vulnerabilities
with high impact.

### Attack Scenarios

For each critical/high finding, provide a concrete attack scenario:

#### Scenario: [Finding Title]

- **Attacker profile**: [External unauthenticated / Authenticated user / Admin]
- **Attack vector**: [Step-by-step exploitation path]
- **Preconditions**: [What must be true for the attack to work]
- **Impact**: [What the attacker achieves]
- **Proof of concept**: [Concrete example, payload, or code snippet]
```

### Journal

```
create_entry({
  content: "<full red team critique>",
  entry_type: "security_redteam",
  tags: ["adversarial-security", "redteam"],
  project_number: <project number>
})
```

---

## Phase 3 — Remediation Plan (Agent A: Threat Modeler)

Switch back to the Threat Modeler role. Address every finding from the red
team review with an explicit disposition.

### Disposition Table

For each finding, record one of:

| Disposition | Meaning                                                             |
| ----------- | ------------------------------------------------------------------- |
| **Accept**  | Implement the suggested remediation                                 |
| **Reject**  | Explain why the finding does not apply or is acceptable risk        |
| **Modify**  | Accept the finding but implement a different remediation            |
| **Defer**   | Acknowledge the risk but defer to a future milestone (must justify) |

### Remediation Plan Output

Produce the remediation plan prioritized by risk (exploitability × impact):

```markdown
## Remediation Plan — [Repository Name]

### Disposition Summary

| #   | Finding           | Severity | Disposition | Rationale                                      |
| --- | ----------------- | -------- | ----------- | ---------------------------------------------- |
| 1   | SQL interpolation | Critical | Accept      | Will switch to parameterized query             |
| 2   | Auth bypass       | High     | Modify      | Using middleware guard instead of inline check |
| 3   | Root container    | Medium   | Defer       | Tracked in issue #42, post-v2 milestone        |

### Quick Wins (< 1 hour each)

Remediations that can be implemented immediately with minimal risk:

| #   | Finding | Fix | Effort |
| --- | ------- | --- | ------ |
| ... | ...     | ... | ...    |

### Architectural Changes

Remediations requiring design work or multi-file changes:

| #   | Finding | Approach | Files Affected | Effort |
| --- | ------- | -------- | -------------- | ------ |
| ... | ...     | ...      | ...            | ...    |

### Accepted Risks

Findings explicitly rejected or deferred with justification:

| #   | Finding | Disposition | Justification | Review Date |
| --- | ------- | ----------- | ------------- | ----------- |
| ... | ...     | ...         | ...           | ...         |

### Updated Security Score

After applying proposed remediations:

- **Before**: [score] / 5.0 (Grade [X])
- **After (projected)**: [score] / 5.0 (Grade [Y])
```

### Iteration Control

After remediation planning, check: has `MAX_AUDIT_PASSES` been reached?

- **No** → return to Phase 2 for another red team review of the remediation
  plan itself (does the fix introduce new vulnerabilities? Are there gaps in
  the remediation?)
- **Yes** → proceed to Phase 4

The default of 2 passes means: 1 initial red team + 1 review of the
remediation plan. For most repositories this is sufficient. Increase for
high-stakes production systems or compliance-critical codebases.

### Journal

```
create_entry({
  content: "<remediation plan with dispositions>",
  entry_type: "security_remediation",
  tags: ["adversarial-security", "remediation"],
  project_number: <project number>
})
```

---

## Phase 4 — External Validation (GitHub CLI)

If `COPILOT_VALIDATION` is enabled (default: `true`) and `gh copilot` is
available, invoke it for an independent review of the audit findings and
remediation plan.

See [copilot-security-prompts.md](copilot-security-prompts.md) for prompt
templates, correct CLI syntax, and parsing guidance.

> **⚠️ CRITICAL**: You MUST use `gh copilot -p "<prompt>"` (non-interactive
> mode). Do NOT use `gh copilot explain` which is interactive and will hang.
> Always `Set-Location` to the target repository before invoking. Include
> `--allow-tool "shell(find,cat,head,grep)"` so Copilot can read source files.

> **⚠️ NO FABRICATION**: You MUST actually execute the `gh copilot` commands
> and report their real output. Do NOT fabricate or predict Copilot findings.
> If the command fails or is unavailable, skip Phase 4 and document why.

After the Copilot pass, any new findings follow the same disposition process
from Phase 3. The final audit report is then presented to the user.

If `gh copilot` is not available, skip this phase gracefully and note:

```markdown
> **Phase 4 skipped**: `gh copilot` not available. The audit completed with
> internal adversarial review only (Phases 1–3). Install the GitHub CLI and
> authenticate (`gh auth login`) for external validation.
```

### Journal

```
create_entry({
  content: "<copilot findings + final dispositions>",
  entry_type: "security_copilot",
  tags: ["adversarial-security", "copilot"],
  project_number: <project number>
})
```

---

## Final Report Assembly

After all phases complete, produce a consolidated report artifact. This is
the primary deliverable for the user.

```markdown
# Adversarial Security Audit — [Repository Name]

**Date**: [ISO date]
**Audit Depth**: [recon | standard | paranoid]
**Project Type**: [auto-detected type]
**Passes Completed**: [N]
**External Validation**: [yes | skipped]

## Executive Summary

[2–3 sentence summary: overall posture, critical findings count, and
recommended immediate actions]

**Security Score**: [X] / 5.0 — Grade [A–F]

## Findings Summary

| Category        | Critical | High | Medium | Low | Total |
| --------------- | -------- | ---- | ------ | --- | ----- |
| 1. Dependencies | 0        | 0    | 0      | 0   | 0     |
| 2. Secrets      | ...      |      |        |     |       |
| ...             |          |      |        |     |       |
| **Total**       |          |      |        |     |       |

## Top 3 Urgent Remediations

1. [Most critical finding + remediation]
2. [Second most critical]
3. [Third most critical]

## Full Findings (by severity)

[All findings from Phase 2, grouped by severity descending]

## Remediation Plan

[From Phase 3 — disposition table + quick wins + architectural changes]

## Accepted Risks

[Findings explicitly deferred with justification and review dates]

## Appendix: Reconnaissance

[Condensed version of Phase 1 output — project profile, trust boundaries,
attack surface map]
```
