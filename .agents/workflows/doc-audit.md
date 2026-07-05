---
name: doc-audit
description: |
  Use when you need to run an exhaustive adversarial documentation audit for both the main repository and wiki, utilizing parallel subagents to eliminate drift.
  Do NOT use for standard code reviews or linting.
disable-model-invocation: true
---

# Unified Documentation & Wiki Audit

> **Prerequisite**: Ensure your Git working directories for both the Main Repository and the Wiki Repository (if it exists) are completely clean before starting.

Run a comprehensive subagent-based documentation audit to synchronize the repository (and its Wiki) against the source code.

## 1. Audit Initialization
<phase>
<instructions>
1. Ask the user for the absolute path to the **Main Repository**.
2. Identify whether the project is an MCP server, Cloudflare manager, or standalone library.
3. Check if a Wiki Repository exists (e.g., `<repo-name>.wiki`). Ask the user to confirm the path if one exists.
</instructions>
</phase>

---

## Phase 1: Source of Truth (SoT) Research
<phase>
As the primary agent, you must establish the ground truth. Do not guess; rely strictly on actual code and runtime execution, not just other documentation.

<instructions>
### Hunt for the following details in the Main Repository:
- **Capabilities**: Identify available tools, resources, and prompts directly from the source code (e.g., `src/server/mcp-server.ts`, `src/adapters/mysql/resources/`) or by executing the server to dump its runtime schema.
- **Configuration**: Extract active environment variables and CLI flags directly from the source code (e.g., `src/cli/program-options.ts`).
- **Architecture**: Run `bun C:\Users\chris\Desktop\adamic\.agents\scripts\get-git-history-json.ts` to look for major architectural changes or newly added namespaces.
- **Schemas**: Understand the core domain schemas, especially any new required parameters added to tools recently.
- **MCP Builder Rules**: If the project is an MCP server, cross-reference against `C:\Users\chris\Desktop\adamic\skills\mcp-builder\SKILL.md` (e.g., Dual-Schema Pattern, `:latest` docker tags).

Compile these factual baselines into an `ssot.md` scratch file for your subagents, but explicitly include the file paths to the actual source code so subagents can dynamically verify claims themselves rather than relying solely on your summary.
</instructions>
</phase>

---

## Phase 2: Main Repo Audit (Parallel Subagents)
<phase>
Divide the target files into logical groups and dispatch multiple parallel `main_repo_auditor` subagents with `enable_write_tools = false`.

**Target Files (Audit whatever exists)**: 
- **Core Docs**: `README.md`, `DOCKER_README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `UNRELEASED.md`
- **Config & Env**: `.env.example`, `server.json`, `mcp-config-example.json`, `docker-compose.yml`, `wrangler.toml`, `wrangler.jsonc`
- **GitHub Elements**: `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `.github/workflows/`
- **MCP & Instructions**: `test-server/code-map.md`, `test-server/tool-reference.md`, `src/constants/server-instructions/README.md`, `test-server/scripts/prompt-template.md`
- **Skills**: `skills/**/*.md` (e.g., `/mcp-builder`)
- **Testing Prompts**: `test-server/*/README.md`, `test-server/*/coordinator-workflow.md`

<instructions>
**Crucial Instructions for the Main Repo Subagent**:
- Cross-reference all files against the SSoT scratch file.
- **Marketing Compliance & Effectiveness**: Maximize the marketing aspect by structuring docs to put best features forward. Ensure READMEs and Wikis have a prominent "Value Proposition" block at the top. Use active voice, benefit-driven headers, and concise sentences (<15 words). Integrate visual layout standards where appropriate (e.g., 3-2 badge grid for MCPs).
- **Platform Limits**: Ensure `DOCKER_README.md` MUST NOT exceed Docker Hub's 25,000 character limit.
- **Configuration**: Ensure `.env.example`, `docker-compose.yml`, and `mcp-config-example.json` perfectly match the SSoT CLI flags/envs.
- **AI Instructions**: Ensure `.github/copilot-instructions.md` reflects the latest tool counts and architectural rules.
- **Error Handling**: If you encounter an unexpected error, fail gracefully and report back. Do not enter autonomous retry loops.
- **Discrepancy Resolution & No Deletion Heuristic**: The SSoT is a source of *factual constraints*, NOT an exhaustive list of allowed content. **NEVER** recommend deleting documentation based solely on a numerical mismatch or omission from the SSoT. If a document lists more capabilities than expected (e.g., dynamic resources), assume the document might be correct, flag it as a discrepancy, and request manual confirmation from the primary agent or user. Do NOT make documentation consistently wrong by deleting valid info.
- **Reporting**: Do NOT make any changes. Compile a detailed list of every contradiction or drift you find, specifying exactly what is wrong and how it should be fixed, and report this back to the primary agent.
</instructions>
</phase>

---

## Phase 3: Wiki Repo Audit (Parallel Subagents)
<phase>
If a Wiki Repository exists, do not audit linearly to prevent context exhaustion.

<instructions>
1. **Enumerate Files**: List all `.md` files in the Wiki Repository.
2. **Define Subagent**: Define a specialized `wiki_auditor` subagent type equipped with `enable_write_tools = false`.
3. **Dispatch Subagents**:
   - Divide the list of wiki markdown files logically into batches of 5-10 files.
   - Invoke parallel `wiki_auditor` subagents, assigning each batch to a different subagent.
   - **Crucial Instructions for Subagents**: 
     - "You must read **every single page** assigned to you."
     - "Define a clear stop condition: once you have processed your assigned batch of files, you MUST return and report." (Infinite Loop Prevention)
     - "Cross-reference your pages against the SSoT scratch file."
     - "Aggressively hunt for documentation drift, outdated schemas, missing tool parameters, and typos. Enhance the marketing tone of technical docs to emphasize core value."
     - "Discrepancy Resolution & No Deletion Heuristic: The SSoT is a factual constraint, not an exhaustive list. **NEVER** recommend deleting features, resources, or explanations simply because they are omitted from the SSoT or contradict a raw count. Assume the document might be correct, flag the discrepancy, and request confirmation. Do NOT delete valid info."
       > **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
     - "Error Handling: If you encounter an unexpected error, fail gracefully and report back. Do not enter autonomous retry loops."
     - "Reporting: Do NOT make any changes. Compile a detailed list of every contradiction or drift you find, specifying exactly what is wrong and how it should be fixed, and report this back to the primary agent."
</instructions>
</phase>

---

## Phase 4: Planning & Approval
<phase>
<instructions>
Once all subagents have completed their tasks and reported back, compile a single structured artifact detailing:
- **Summary of Audit**
- **Main Repo Drift**: Detailed list of which files had drift and the exact proposed fixes.
- **Wiki Repo Drift**: Detailed list of which pages had drift and the exact proposed fixes.

**CRITICAL STEP**: Compile all these findings into an `implementation_plan.md` artifact detailing exactly what changes will be made to which files. Use the artifact metadata to set `RequestFeedback: true`. **STOP and wait for the user's explicit approval before making any changes.**
</instructions>
</phase>

---

## Phase 5: Execution
<phase>
<instructions>
Once the user explicitly approves the implementation plan, proceed to make the changes.
You may use your own write tools, or dispatch new execution subagents equipped with `enable_write_tools = true` to systematically apply the approved changes across the repositories.
</instructions>
</phase>
</instructions>
</phase>

---

## Phase 5: Remediation & Committing
<phase>
<instructions>
> [!CAUTION]
> **STOP for HITL Approval**: Present the Phase 4 audit report artifact to the user. Do NOT proceed to commit until the user explicitly approves the changes.

Once approved by the user, proceed to commit the changes:

1. Commit the synchronization changes to the Wiki Repository (if applicable) using the enforced wrapper from the main repository. **You MUST run `git status --porcelain` first to identify modified files, and pass each explicitly using multiple `--add <file>` flags** (e.g., `bun C:\path\to\main-repo\.agents\scripts\commit.ts` with `--validation none --add file1.md --add file2.md`). Wildcard staging (`--add .`) is strictly forbidden by the wrapper. Do NOT use raw `git commit`.
2. Commit the Main Repository changes using the enforced wrapper in the same manner, passing each modified file explicitly (e.g., `bun .\.agents\scripts\commit.ts` with `--validation none --add file1.md`). Wildcard staging (`--add .`) is forbidden.
3. Inform the user that the unified audit is fully complete and present the final documentation audit report artifact.
</instructions>
</phase>
