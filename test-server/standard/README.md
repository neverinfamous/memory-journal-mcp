# Standard Feature Tests

## Value Proposition
**Validate Capabilities Instantly.** Ensure rock-solid reliability across 108 MCP tools. Catch regressions early. Maintain perfect data integrity. Empower AI agents with deterministic, isolated test workflows.

> **This README is optimized for AI agent consumption.**

This directory contains the core modular test files for `memory-journal-mcp`. Execute direct `callTool` operations via MCP. Validate standard server capabilities seamlessly.

> **CRITICAL:** `test-seed.md` **must** be executed first in any test session. All other test files in this directory depend on the seed data being present. Once seeded, you may run any of the other tests independently.

## Test Sequence & Workflow

The exhaustive list of test files, their sequence (Dependency DAG), and the coordinator workflow are maintained in the [`coordinator-workflow.md`](./coordinator-workflow.md) file. Please refer to that document for the canonical list of tests and the proper execution sequence.

## Automated Boundary & Protocol Specs

Certain boundary and transport checks (such as 50 KB+ payloads, stdio pipe framing, and wire `outputSchema` checks) are automated directly in Vitest and Playwright rather than run interactively as agent MCP calls:

| Automated Spec | Purpose | Associated Workflow |
| --- | --- | --- |
| `tests/e2e/boundary.spec.ts` + `tests/e2e/security.spec.ts` | Verifies HTTP `413 Payload Too Large` (`> 1 MB`) and `create_entry` `50k`/`50,001`/`100k` length + type-mismatch boundaries | `test-integrity-part1.md` |
| `tests/e2e/stdio-transport.spec.ts` | Verifies stdio pipe `content` capacity (`50k`/`50,001`/`100k`) and SDK/team Zod coercion boundaries without `-32602` leakage | `test-integrity-part2.md` |
| `tests/handlers/tool-output-schemas.test.ts` + `tests/e2e/tools.spec.ts` | Verifies all 107 standard tools define `outputSchema` and advertise schemas/annotations over MCP `tools/list` | `test-schemas.md` |
| `tests/e2e/subscriptions.spec.ts` | Validates MCP real-time resource subscriptions on `memory://recent` and `memory://briefing` | `test-core-infra.md` |

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
