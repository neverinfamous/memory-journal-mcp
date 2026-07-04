# 🤖 Agent README: Core Scripts Auditing & Usability Testing

> **This directory is optimized for AI agent consumption.**

This directory contains workflows designed to harden the core script infrastructure (`lib-agent-exec`, `lib-git-history`, and `commit.ts`) and explicitly trigger agent hallucinations. The goal is absolute reliability, execution speed, and token efficiency for autonomous AI agents.

## Testing Philosophy

We utilize a two-tier testing architecture to ensure the core infrastructure is bulletproof:

### Tier 1: Usability Fuzzing
Organic testing prompts where subagents act intuitively, make assumptions, and purposefully use fragile terminal commands (e.g., pipeline operators, invalid flags, missing arguments, or interactive tools). This verifies that the safety interceptors in `lib-agent-exec` correctly identify the hallucination, provide an `AGENT HINT`, and the agent successfully autonomously heals. It also ensures the CLI features, extraction limits, and strict schemas for `lib-git-history` and `commit.ts` are fully functional and properly bounded.
- `lib-agent-exec/test-usability-agent-exec-*.md`
- `lib-git-history/test-usability-git-history-*.md`
- `commit/test-usability-commit-*.md`

## The Master Coordinator Workflow

Because testing and healing all edge cases at once exhausts an agent's context window, we execute them sequentially via the `coordinator-workflow.md`.

**Execution Loop:**
1. The coordinator orchestrates the Tier 1 Usability Fuzzing queue.
2. If ANY structural code changes were made and committed during the run, the coordinator loops back to step 1 to ensure no regressions were introduced. It repeats this until the codebase is 100% stable with zero failing tests.

---

> **🛡️ Dynamic Context Audit Status: Compliant (Last Audited: June 28, 2026)**
> All testing prompts and workflows in this directory have been exhaustively audited against the true source-of-truth schemas for `lib-agent-exec`, `lib-git-history`, and `commit.ts`.
> **CRITICAL NOTE:** While the `ssot-mapping.md` provides architectural invariants, `lib-git-history/schema.ts` is the ultimate structural arbiter. Features explicitly defined in `schema.ts` (e.g., qualitative sizes `XS, S, M, L, XL` or `isBreaking` flags) are considered canonical and MUST be tested, even if omitted from the high-level SSoT summary.
> Validation steps strictly enforce `bun run typecheck` and `bun run lint` during subagent tasks. The master coordinator runs the full `check` pipeline.
> 
> **Context Exhaustion Prevention:** Tests are required to be atomic and single-responsibility. If a test spans multiple features (e.g., testing multiple flags or aliases in a single sequence), it MUST be split into multiple smaller files (e.g., `test-usability-commit-cli-msg-alias-message.md`, `...-positional.md`, `...-short.md`). No context-exhausting prompts exist.

---

## 📈 Continuous Self-Improvement
As an agent operating within this workspace, you are expected to practice continuous self-improvement. If you identify gaps, ambiguities, or missing instructions during an audit or execution task, **proactively update this `AGENT_README.md`**, the testing prompts, and `coordinator-workflow.md`. You are empowered to refine your own testing and auditing processes.
