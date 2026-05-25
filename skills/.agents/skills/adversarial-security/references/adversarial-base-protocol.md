# Adversarial Base Protocol

This document defines the shared structural boilerplate for all adversarial skills in the ecosystem (`adversarial-security`, `adversarial-performance`, `adversarial-planner`, `adversarial-skill-audit`, `adversarial-workflow-audit`).

## Core Architecture: Dual Agent Roles

Adversarial skills operate with two distinct mental models. You are both agents — you must strictly switch perspectives at phase boundaries to counteract confirmation bias.

### Agent A — The Baseline / Recon Agent
**Mandate:** Establish ground truth, map the surface area, and catalog existing properties.
- Think like a defender, planner, or auditor documenting what *is* or what *should be*.
- Focus on completeness, accuracy, and baseline measurement.
- You are NOT looking for flaws in this phase.

### Agent B — The Adversary / Critique Agent
**Mandate:** Break, stress, or invalidate everything Agent A documented.
- Switch to a pessimistic, attacker, or stress-tester mindset.
- Assume Agent A missed something or that the documented properties are brittle.
- Find bypasses, edge cases, performance bottlenecks, or logical flaws.
- Provide concrete proof (e.g., attack vectors, quantitative impacts) — no vague concerns.

## The Multi-Pass Protocol Pipeline

All adversarial audits follow this iterative pipeline. Each phase must produce a structured journal entry.

| Phase | Agent Role | Action |
| --- | --- | --- |
| **0. Research** | Agent A | Use `search_web` or `grep_search` to find latest standards, benchmarks, or ecosystem guidelines before starting. |
| **1. Recon/Profile** | Agent A | Measure and document the baseline state. Output: Map or Profile artifact. |
| **2. Adversarial Review** | Agent B | Challenge the baseline. Output: Findings table with severity/impact ratings. |
| **3. Remediation** | Agent A | Develop a prioritized plan to fix the findings. Output: Remediation Plan. |
| **4. Copilot Validation** | External | Trigger an independent validation pass using `gh copilot` to reduce self-review bias. Output: Copilot Findings. |

## Journaling & Artifacts

- **Phase Isolation**: Do NOT skip phases or merge them. Produce the required journal entry for each phase.
- **Consolidated Report**: At the end of Phase 4, merge all findings, remediations, and external validation results into a single consolidated artifact for the user. Do not produce scattered phase artifacts outside of the journal.
- **Journal Opt-Out**: If the user explicitly opts out of journaling, proceed with the phases in memory and output the final consolidated report.

*Refer back to the specific `SKILL.md` for the exact definitions of Agent A/B for the given domain and the specific categories to audit.*
