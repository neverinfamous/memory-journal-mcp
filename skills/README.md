# Memory Journal Custom Skills

This directory contains highly customized, core operational skills specifically designed for the `memory-journal-mcp` server.

> [!NOTE]
> The general-purpose web, language, and ecosystem skills (previously housed here) have been migrated to their new canonical home in the Adamic repository (`adamic/skills`).

## Inventory

| Skill                        | Description                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `adversarial-code-quality`   | Multi-pass adversarial code quality audit — structured static analysis, findings checklist, and human-in-the-loop fixes               |
| `adversarial-performance`    | Multi-pass adversarial performance audit — iterative profiling, stress-testing critique, and Copilot validation                       |
| `adversarial-planner`        | Multi-pass adversarial planning — iterative plan drafting, structured critique, and Copilot validation                                |
| `adversarial-security`       | Multi-pass adversarial security audit — iterative threat modeling, attack surface analysis, and Copilot validation                    |
| `adversarial-seo`            | Adversarial SEO enforcement — proactive technical SEO, markup, and E-E-A-T guards                                                     |
| `adversarial-skill-audit`    | Multi-pass adversarial skill audit — iterative quality evaluation, trigger stress-testing, and Copilot validation                     |
| `adversarial-skill-builder`  | Guide for creating, evaluating, and refining agent skills — progressive disclosure, triggers, and testing                             |
| `adversarial-workflow-audit` | Multi-pass adversarial workflow audit — sequential clarity, HITL safety gates, loop prevention, and Copilot validation                |
| `github-issue-commander`     | GitHub pipeline workflows for orchestrating issues, milestones, and roadmap planning                                                  |
| `github-pr-commander`        | GitHub pipeline workflows for orchestrating pull requests, dependency updates, and changelogs                                         |
| `mj-mcp-optimize`            | Guided database pruning and optimization — importance audits, orphan cleanup, duplicate detection, and safe soft-delete               |

## Automated Auditing

The `adversarial-skill-audit` skill includes automated scripts for evaluating this skills directory:

- `skills/adversarial-skill-audit/scripts/check-skills.ps1`: Generates an inventory of all skills, checking line counts, trigger lengths, and frontmatter compliance.
- `skills/adversarial-skill-audit/scripts/run-copilot.ps1`: Runs independent validation against the Copilot CLI.
