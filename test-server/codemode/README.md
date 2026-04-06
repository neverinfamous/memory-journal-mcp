# Code Mode Sandbox Tests

> **This README is optimized for AI agent consumption.**

This directory contains agent-optimized test prompts specifically designed to validate the `mj_execute_code` (Code Mode) sandbox capabilities. These tests verify the secure execution environment, the `mj.*` API bridge, workflow orchestration, and cross-group data operations.

> **Note:** Code Mode tests should be executed *after* the core standard tests have completed, as they rely on a stable underlying database and robust tool handlers.

## Test Modules

| File | Purpose | When to Read |
|---|---|---|
| `test-tools-codemode-1.md` | **Part 1: Foundations & Security** — Execution limits, readonly mode, error boundaries, injection prevention | Always run first |
| `test-tools-codemode-2.md` | **Part 2: Core Data Operations** — CRUD, searching, filtering, basic analytics | After Part 1 |
| `test-tools-codemode-3.md` | **Part 3: Workflows & Relationships** — Multi-step linked workflows, causal graphs | After Part 1 |
| `test-tools-codemode-4.md` | **Part 4: External, Admin & Team** — Cross-database operations, GitHub integration, system administration | After Part 1 |

## Execution Workflow

1. Navigate to the `test-server/codemode/` directory.
2. Read and execute `test-tools-codemode-1.md`.
3. Plan any code fixes based on errors. Wait to proceed until fixes are implemented and verified.
4. Continue with parts 2, 3, and 4 in any order.
