---
description: Exhaustive adversarial documentation audit for both the main repository and wiki, utilizing parallel subagents to eliminate drift.
---

# Unified Documentation & Wiki Audit

> **Prerequisite**: Ensure your Git working directories for both the Main Repository and the Wiki Repository (if it exists) are completely clean before starting.

Run a comprehensive subagent-based documentation audit to synchronize the repository (and its Wiki) against the source code.

## 1. Audit Initialization

1. Ask the user for the absolute path to the **Main Repository**.
2. Identify whether the project is an MCP server, Cloudflare manager, or standalone library.
3. Check if a Wiki Repository exists (e.g., `<repo-name>.wiki`). Ask the user to confirm the path if one exists.

---

## Phase 1: Source of Truth (SoT) Research

As the primary agent, you must first establish the ground truth by scanning the main repository. Do not guess; rely strictly on file contents.

### Hunt for the following details in the Main Repository:
- **Capabilities**: Total counts of available tools, resources, and prompts (often found in `README.md`, `src/constants/`, or `server.json`).
- **Configuration**: Extract active environment variables and CLI flags (e.g., from `src/cli/program-options.ts`).
- **Architecture**: Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts` to look for major architectural changes or newly added namespaces.
- **Schemas**: Understand the core domain schemas, especially any new required parameters added to tools recently.
- **MCP Builder Rules**: If the project is an MCP server, cross-reference against `C:\Users\chris\Desktop\adamic\skills\mcp-builder\SKILL.md` (e.g., Dual-Schema Pattern, `:latest` docker tags).

Extract all of this into a consolidated `ssot.md` scratch file for your subagents to use.

---

## Phase 2: Main Repo Audit (Parallel Subagents)

Define and dispatch a `main_repo_auditor` subagent with `enable_write_tools = true`.

**Target Files (Audit whatever exists)**: 
- **Core Docs**: `README.md`, `DOCKER_README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `UNRELEASED.md`
- **Config & Env**: `.env.example`, `server.json`, `mcp-config-example.json`, `docker-compose.yml`, `wrangler.toml`, `wrangler.jsonc`
- **GitHub Elements**: `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `.github/workflows/`
- **MCP & Instructions**: `test-server/code-map.md`, `test-server/tool-reference.md`, `src/constants/server-instructions/README.md`, `test-server/scripts/prompt-template.md`
- **Testing Prompts**: `test-server/*/README.md`, `test-server/*/coordinator-workflow.md`

**Crucial Instructions for the Main Repo Subagent**:
- Cross-reference all files against the SSoT scratch file.
- **Marketing Compliance**: Enforce active voice, benefit-driven headers, and concise sentences (<15 words) on `README` intros and Release Highlights.
- **Platform Limits**: Ensure `DOCKER_README.md` MUST NOT exceed Docker Hub's 25,000 character limit.
- **Configuration**: Ensure `.env.example`, `docker-compose.yml`, and `mcp-config-example.json` perfectly match the SSoT CLI flags/envs.
- **AI Instructions**: Ensure `.github/copilot-instructions.md` reflects the latest tool counts and architectural rules.
- Fix all drift immediately inline using write tools.

---

## Phase 3: Wiki Repo Audit (Parallel Subagents)

If a Wiki Repository exists, do not audit linearly to prevent context exhaustion.

1. **Enumerate Files**: List all `.md` files in the Wiki Repository.
2. **Define Subagent**: Define a specialized `wiki_auditor` subagent type equipped with `enable_write_tools = true`.
3. **Dispatch Subagents**:
   - Divide the list of wiki markdown files logically into batches of 5-10 files.
   - Invoke parallel `wiki_auditor` subagents, assigning each batch to a different subagent.
   - **Crucial Instructions for Subagents**: 
     - "You must read **every single page** assigned to you."
     - "Cross-reference your pages against the SSoT scratch file."
     - "Aggressively hunt for documentation drift, outdated schemas, missing tool parameters, and typos."
       > **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
     - "Use your write tools to correct any drift immediately within the wiki file."

---

## Phase 4: Verification & Reporting

Once all subagents have completed their tasks and reported back, compile a single structured artifact detailing:
- **Summary of Audit**
- **Main Repo Fixes**: Including limit violations resolved.
- **Wiki Pages Edited**: Which files had drift and what was fixed.
- **Remaining Issues**: Any inconsistencies requiring human intervention.

---

## Phase 5: Remediation & Committing

Immediately after editing and/or validation is complete, proceed to commit the changes automatically:

1. Commit the synchronization changes to the Wiki Repository (if applicable) using standard terminal tools:
   ```bash
   git add .
   git commit -m "docs: exhaustive wiki audit and synchronization"
   ```
2. Commit the Main Repository changes using the enforced wrapper (e.g., `bun path/to/commit.ts` with `--validation none`).
3. Inform the user that the unified audit is fully complete and present the final documentation audit report artifact.
