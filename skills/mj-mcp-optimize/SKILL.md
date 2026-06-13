---
name: mj-mcp-optimize
description: Guide for modifying the `memory-journal-mcp` codebase (schemas, server instructions, proxy interceptors) to proactively prevent, mitigate, and heal LLM hallucinations for all future agents.
---

# Codebase Optimization & Anti-Hallucination Guardrails

The primary philosophy of this skill is: **When you (the agent) encounter a hallucination, confusion, or are forced to use introspection to figure out an API, DO NOT just work around it.** 

You must modify the server codebase to ensure future agents never face the same issue. This document details the 4 specific layers of the `memory-journal-mcp` architecture where you can implement these permanent fixes.

## Layer 1: Schema & Instruction Hardening (The First Line of Defense)

The most robust way to prevent a hallucination is to explicitly instruct the agent via the tools list or initialization payload.

* **Schema `.describe()` Tags:** When an agent hallucinates a property (e.g. inventing a `title` field instead of using `message`), update the Zod schema in `src/handlers/tools/*/schemas.ts`. Add an explicit "Anti-Hallucination Hint" in the `.describe()` string. These surface directly in the JSON Schema that agents see on `tools/list`.
    * *Example:* `.describe('Note: The primary text is stored in the `message` property (not `title` or `content`).')`
* **Tool Descriptions:** Update the `description` fields on tool definition files (e.g., `src/handlers/tools/*/tools.ts`). This is the agent's first impression of each tool.
* **Server Instructions:** If a structural hallucination persists (e.g. inventing `## Summary` sections instead of `## Accomplished`), update the `src/constants/server-instructions/overview.md` or `templates.md` files. These alter the context payload for all agents upon connection.

## Layer 2: Dispatcher Healing (Frictionless Recovery)

If agents consistently hallucinate inputs that can be logically inferred or normalized, heal them silently in the `secureDispatcher` (`src/codemode/api/handler.ts`) before they reach Zod validation.

* **Type Coercion:** If agents pass strings (e.g., `{ project_number: 'db-mcp' }`) instead of numbers, use the `projectRegistry` to auto-resolve string repo names into numeric IDs.
* **Case Normalization:** Because Zod schemas enforce `snake_case`, if an agent hallucinates `{ projectNumber: 123 }` in a batch payload, ensure the `deepCamelToSnake` normalizer in the dispatcher catches and heals it automatically to `project_number`.
* **Explicit Interception:** If a string cannot be coerced (e.g., `"P154"`), intercept it before validation and throw a highly actionable custom error explicitly guiding the agent to omit the field.

## Layer 3: Sandbox Proxy Interceptors (Actionable Errors)

When agents execute code in Code Mode (`mj_execute_code`), they often make standard Javascript mistakes. Instead of cryptic V8 runtime failures, add Proxy interceptors in `worker-api-proxy.ts` and `worker-result-proxy.ts` to throw explicit guidance.

* **Missing `await` Catching:** Agents frequently forget the `await` keyword. Wrap all RPC Promise returns in an additional Proxy. If the agent attempts to synchronously access a property (e.g. `result.success`), intercept it and throw: `"Attempted to access property 'success' on a Promise object. Did you forget to 'await' the tool call?"`
* **Array Method Healing:** Agents often assume tools like `searchEntries` return Arrays instead of Objects (e.g., `{ success: true, entries: [...] }`). The `wrapResult` proxy intercepts Array methods (like `.map`, `.filter`) called directly on the returned Object and binds them dynamically to the inner array (e.g. `.entries`).
* **Resource Hallucinations:** Agents often try to call raw resources like `await mj.core.getBriefing()`. Implement a custom interceptor that throws a highly actionable error suggesting the correct equivalent tool (e.g. `mj.core.getRecentEntries()`).

## Layer 4: Alias Management (The Shadowing Trap)

Agents commonly extrapolate method names based on patterns (e.g., trying to call `mj.listEntries()` instead of `mj.searchEntries()`). You can add aliases to gracefully handle these hallucinations.

* **Adding Aliases:** Add entries to the `METHOD_ALIASES` constant in `src/codemode/api-constants.ts` (e.g. `listEntries: 'searchEntries'`). The worker-side `shimMj` proxy resolves these seamlessly.
* **CRITICAL: The Alias Shadowing Bug Pattern:** `METHOD_ALIASES` resolve in the worker-side proxy **before** constructor-wired bindings are checked. If a `METHOD_ALIASES` entry maps to a method name that doesn't exist as an actual tool in that group, it will **shadow** a correctly wired constructor binding and silently fail. 
    * *Rule:* `METHOD_ALIASES` entries must point to either (a) a real tool method in the same group, or (b) another alias that eventually resolves to a real tool in the same group.
