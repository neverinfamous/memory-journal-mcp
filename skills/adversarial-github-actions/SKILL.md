---
name: adversarial-github-actions
description: |
  Multi-pass adversarial quality and security audit for GitHub Actions workflow files (.github/workflows/*.yml).
  Combines structured evaluation with adversarial stress-testing. Use to audit CI/CD pipelines,
  enforce strict SHA pinning, cache utilization, and deployment hygiene across NPM, Docker, and GitHub targets.
---

# Adversarial GitHub Actions Audit

A rigorous quality and security auditing system for GitHub Actions. Workflows are infrastructure-as-code and must be treated as critical production surfaces. This skill evaluates workflows to ensure they meet the 2026 Adamic CI/CD standards for security, reliability, and performance.

## When to Load

Load this skill when:
- Auditing existing CI/CD workflows (`.github/workflows/*.yml`).
- Reviewing a newly generated or modified GitHub Actions workflow before committing.
- The user asks to "audit our GitHub Actions", "harden our CI/CD", or "check workflow security".

## Adversarial Protocol

This skill uses the standard dual-agent adversarial pattern (Agent A: The Evaluator, Agent B: The Adversarial Tester) to audit the workflow configurations.
For the core pipeline rules, phase definitions, and agent switching protocols, read:
**[../adversarial-security/references/adversarial-base-protocol.md](../adversarial-security/references/adversarial-base-protocol.md)**

## Deep References

Before starting the audit, review the specific standards and rubrics:
- **[Deployment Variants Reference](references/variants.md):** Standards depending on target (NPM, Docker, GitHub-only).
- **[Audit Categories Reference](references/audit-categories.md):** The strict security, performance, and reliability rubrics.

## Execution Rules

1. **Variant Discovery:** The Evaluator must first determine the Deployment Variant (NPM, Docker, or GitHub-only) by reading the workflow structure and inputs.
2. **Strict SHA Pinning:** Any tag-based action usage (`@v4`) is an automatic Failure. Only full-length SHAs (`@692973e3d937129bcbf40652eb9f2f61becf3332`) are allowed.
3. **No Mocks Allowed:** Adversarial Tester must aggressively find untrusted input vectors (e.g., using `github.event.pull_request.title` directly in `run` scripts).
4. **Actionable Remediation:** Failures must include the exact YAML fix required. Do not just say "Add SHA pinning", provide the updated YAML block.

## Configuration

| Variable             | Default    | Description                                       |
| -------------------- | ---------- | ------------------------------------------------- |
| `TARGET_VARIANT`     | `auto`     | Can be forced to `npm`, `docker`, or `github`     |
| `MAX_AUDIT_PASSES`   | `2`        | Maximum stress-test cycles                        |

## Synergies

| Skill/Workflow         | Relationship                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `adversarial-security` | Can be used during the Evaluator phase for deep security analysis.               |
| `github-actions`       | The foundational CI/CD skill containing the templates this audit enforces.       |
