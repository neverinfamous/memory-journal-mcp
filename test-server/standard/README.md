# Standard Feature Tests

## Value Proposition
**Validate Capabilities Instantly.** Ensure rock-solid reliability across 108 MCP tools. Catch regressions early. Maintain perfect data integrity. Empower AI agents with deterministic, isolated test workflows.

> **This README is optimized for AI agent consumption.**

This directory contains the core modular test files for `memory-journal-mcp`. Execute direct `callTool` operations via MCP. Validate standard server capabilities seamlessly.

> **CRITICAL:** `test-seed.md` **must** be executed first in any test session. All other test files in this directory depend on the seed data being present. Once seeded, you may run any of the other tests independently.

## Test Sequence & Workflow

The exhaustive list of test files, their sequence (Dependency DAG), and the coordinator workflow are maintained in the [`coordinator-workflow.md`](./coordinator-workflow.md) file. Please refer to that document for the canonical list of tests and the proper execution sequence.

## Node.js Helper Scripts

Certain boundary tests (e.g., massive payload execution) exceed typical token context windows and cannot be efficiently run directly via MCP tool payloads. We provide raw Node.js scripts in `test-server/scripts/` to supplement the markdown test workflows:

| Script               | Purpose                                                                                                      | Associated Workflow |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------- |
| `test-http.mjs`      | Verifies HTTP transport 413 Payload Too Large limits                                                         | `test-integrity-part1.md` |
| `test-long-mcp.mjs`  | Verifies the maximum `content` length capacity limits (50k/100k boundaries)                                  | `test-integrity-part2.md` |
| `verify-schemas.mjs` | Programmatically verifies that all output schemas are strictly defined for `structuredContent` compatibility | `test-schemas.md`   |
| `test-subscribe.mjs` | Validates MCP real-time resource subscriptions and scope-based authorization boundaries                      | `test-core-infra.md`|

## Track Token Consumption

All test workflows in `test-server/standard/` require the agent to track and report the token estimate used during the test pass.

**How to calculate:**

- Every tool execution returns a `_meta.tokenEstimate` object in the response. Sum these values. (Estimates use a content-type-aware heuristic: prose=4.0, json=2.8, code=3.2 bytes/token).
- _Alternatively_, you may read the `memory://metrics/summary` resource before and after testing to find the delta, or report the session totals via `memory://audit`.
- Always provide this **Total Token Estimate** clearly in your final test report summary so the user can track context window consumption. The tokens tracked should only count the estimated tokens that actually entered the context window.

## Validate Telemetry Metrics

During or after your execution workflows, explicitly verify that resource read telemetry is accumulating accurately:

1. Perform a read on a known resource (e.g. `memory://briefing` or `memory://status`).
2. Attempt a read on an invalid resource to trigger an error path.
3. Read the `memory://metrics/resources` resource and `memory://metrics/summary`.
4. Validate that `total_resource_reads` and the specific breakdown count for the read resources accurately reflect your actions.
