# Code Mode Sandbox Tests

> **This README is optimized for AI agent consumption.**

This directory contains agent-optimized test prompts specifically designed to validate the `mj_execute_code` (Code Mode) sandbox capabilities. These tests verify the secure execution environment, the `mj.*` API bridge, workflow orchestration, and cross-group data operations.

> **Note:** Code Mode tests should be executed _after_ the core standard tests have completed, as they rely on a stable underlying database and robust tool handlers.

> **Important Constraints (P401):** When verifying Code Mode scripts, explicitly ensure that scripts processing errors correctly handle boundary detection. A returned object MUST NOT bleed raw MCP exceptions. Pay close attention to the `_meta.tokenEstimate` to ensure token payloads do not breach thresholds during heavy array iterations.

## Test Modules & Execution Workflow

> [!IMPORTANT]
> The exhaustive file list, sequence queue, dependency DAG, and execution workflow instructions have been centralized. 
> Please refer to [coordinator-workflow.md](coordinator-workflow.md) for the active test queue.

## Token Estimate Reporting

All test workflows in `test-server/codemode/` require the agent to track and report the token estimate used during the test pass.

**How to calculate:**

- Every tool execution returns a `_meta.tokenEstimate` object in the response. Sum these values. (Estimates use a content-type-aware heuristic: prose=4.0, json=2.8, code=3.2 bytes/token).
- _Alternatively_, you may read the `memory://metrics/summary` resource before and after testing to find the delta, or report the session totals via `memory://audit`.
- Always provide this **Total Token Estimate** clearly in your final test report summary so the user can track context window consumption. The tokens tracked should only count the estimated tokens that actually entered the context window.

## Resource Metric Validation

During or after your execution workflows, explicitly verify that resource read telemetry is accumulating accurately:

1. Perform a read on a known resource (e.g. `memory://briefing` or `memory://status`).
2. Attempt a read on an invalid resource to trigger an error path.
3. Read the `memory://metrics/resources` resource and `memory://metrics/summary`.
4. Validate that `total_resource_reads` and the specific breakdown count for the read resources accurately reflect your actions.
