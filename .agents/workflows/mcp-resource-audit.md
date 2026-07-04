---
description: Exhaustive adversarial audit of MCP server Resources to ensure compliance with the official protocol specification and internal token-efficiency standards.
---

# MCP Resource Audit Workflow

> **Prerequisite**: Ensure your Git working directory is completely clean before starting. Stash or commit any unrelated changes.
> **Prerequisite**: You MUST read the `/mcp-builder` skill before proceeding, as it contains the critical standards (e.g., ErrorFieldsMixin, YAML payload optimizations) that this audit enforces.

Run an exhaustive subagent-based documentation and coverage audit of the **Resources** (read-only, streamable context entities) exposed by an MCP server repository.

## 1. Audit Initialization

1. Ask the user for the absolute path to the target MCP repository, if they have not provided it (e.g. `C:\Users\chris\Desktop\memory-journal-mcp`). Do not guess; use the Briefing's registered workspaces to resolve the exact path.
2. Verify that the repository exposes Resources by checking the server initialization capability block (e.g., `capabilities: { resources: { ... } }`) in `src/index.ts` or `src/mcp-server.ts`.

---

## Phase 1: Source of Truth (SoT) Research

As the primary agent, you must first establish the ground truth for what resources are exposed by the server. 

1. Read the architectural logic flows in `test-server/code-map.md`.
2. Locate the resource registration logic (typically in `src/index.ts`, `src/mcp-server.ts`, or a dedicated `src/handlers/resources/` directory).
3. Compile a master mapping of all exposed resources, including:
   - Direct resources (e.g., `resources/list` and `resources/read`).
   - Resource Templates (e.g., `resources/templates/list` using RFC 6570).
4. Verify the existence of standard architectural resources as per `mcp-builder` guidelines (e.g., `{prefix}://help`, `{prefix}://briefing`, `{prefix}://audit`, and `{prefix}://metrics`). Note any missing standard resources.
5. **CRITICAL**: Write this master mapping to a scratch file (e.g., `<appDataDir>\brain\<conversation-id>\scratch\ssot-resources-mapping.md`). Do not pass massive SSoT strings directly into the subagents' prompts; pass the scratch file path instead.

---

## Phase 2: Parallel Subagent Resource Audit

You must exhaustively audit all resource handlers. To prevent context exhaustion, delegate this to subagents.

1. **Define Subagents**: Define a specialized `resource_auditor` subagent type equipped with `enable_write_tools = true`.
2. **Dispatch Subagents**:
   - Divide the resource handlers logically among the subagents.
   - Provide the SSoT mapping scratch file path to each subagent.
   - **Crucial Instructions for Subagents**:
     - "Ensure every resource correctly specifies a valid `uri` and a proper `mimeType` for its contents (e.g., `text/plain`, `application/json`, `image/png`)."
     - "Ensure standard JSON-RPC errors are returned correctly (`-32002` for Resource Not Found, `-32603` for Internal Error)."
     - "**Annotations Enforcement**: Check that resources utilize proper annotations (`audience`, `priority`, `lastModified`) where applicable, utilizing presets from `utils/resource-annotations.ts` (e.g. `HIGH_PRIORITY`, `ASSISTANT_FOCUSED`)."
     - "**Token Optimization Enforcement**: Ensure large text/JSON resources are serialized efficiently (prefer YAML/key-value over JSON) and that the payload explicitly includes a `_meta.tokenEstimate` field."
     - "**URI Scheme Enforcement**: Ensure `https://` is ONLY used if the client is expected to fetch it directly over the internet. Otherwise, use a custom scheme or `file://`. Custom schemes must strictly follow RFC3986."
     - "**Icon Enforcement**: Verify that resources include `icons: Icon[]` where appropriate, ensuring they are attached at the aggregation point (e.g., mapping functions) and NOT directly within the handler files, as per MCP 2025-11-25."
     - "If a resource utilizes a template, ensure it is properly exposed via the `resources/templates/list` capability."
     - "**Infinite Loop Prevention**: Do NOT exceed 3 execution attempts per handler. If you encounter complex or recurring errors, document the findings and return your report rather than looping indefinitely."
     - "Report back with a detailed summary of your changes."

---

## Phase 3: Subscription & Lifecycle Audit

Certain resources change over time and must notify the client.

1. **Identify Stateful Resources**: Identify any resources that represent live state (e.g., database schema changes, active connection pools). Distinguish between polling resources (e.g., `*://health`) and event-driven resources (e.g., `*://schema`).
2. **Audit Subscription Capabilities**:
   - Check the server capability declaration. If the server supports subscriptions or list changes, ensure `subscribe: true` and/or `listChanged: true` are declared.
   - Ensure the server properly emits `notifications/resources/updated` for subscribed clients when state changes.
   - Ensure the server emits `notifications/resources/list_changed` when new resources are added or removed dynamically.
3. Fix any gaps using your write tools.

---

## Phase 4: Final Consolidated Report & Committing

> [!IMPORTANT]
> **HITL Checkpoint**: STOP HERE. Present the full audit report artifact to the user. Wait for explicit approval before proceeding to commit.

1. **Consolidated Report**: Produce a single structured artifact detailing:
   - **Summary of Audit**
   - **Resource Fixes**: Which resources lacked `mimeType`, annotations, or token-optimized payloads and were fixed.
   - **Lifecycle Fixes**: Any capabilities or subscriptions that were corrected.
2. Commit the changes to the repository:
   > **Note:** Always use the repository's custom commit wrapper (like `commit.ts`) if available, to adhere to global rules.
   ```bash
   git add .
   bun path/to/commit.ts --msg "test: exhaustive mcp resource audit and protocol compliance" --category Changed --impact 0.5 --confidence 1.0
   ```
