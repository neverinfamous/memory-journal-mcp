---
description: High-quality workflow for autonomously bootstrapping a professional, SSoT-aligned GitHub Wiki for a repository.
disable-model-invocation: true
---

# Wiki Bootstrap

> **Prerequisite**: Ensure the user has enabled the Wiki feature on their GitHub repository and created the initial Home page (which provisions the `.wiki.git` repository).

Run an exhaustive process to bootstrap a complete, developer-focused Wiki that mirrors the primary repository's architecture and capabilities.

## 1. Initialization & Setup

1. Ask the user for the absolute path to the target repository workspace (e.g., `<workspace-root>`). Do not guess; use the Briefing's registered workspaces to resolve the exact path if needed.
2. Determine the `<repo-name>` from the workspace.
3. Clone the Wiki repository to a sibling directory of the workspace root (e.g., if workspace is `...\projects\my-repo`, clone to `...\projects\my-repo-wiki`).
   ```bash
   git clone git@github.com:neverinfamous/<repo-name>.wiki.git <path-to-sibling-dir>
   ```

---

## Phase 1: Source Code Research (Main Repo)

Before writing any documentation, establish the ground truth by scanning the main repository. Do not guess; rely strictly on file contents. If standard files are missing, search the repository for their equivalents.

1. **Architecture**: Read `test-server/code-map.md` (fallback: search for architecture docs or read `README.md`).
2. **Tooling**: Read `test-server/tool-reference.md`, `src/filtering/tool-constants.ts`, and `src/constants/server-instructions.ts` (fallback: search `src/` for tool definitions).
3. **Configuration**: Extract active environment variables and CLI flags from `.env.example`, `src/cli/program-options.ts`, or `README.md`.
4. **General**: Identify if this is an MCP server, standard library, or CLI tool to tailor the tone.

Extract all of this into a consolidated `ssot.md` scratch file.

---

## Phase 2: Wiki Content Generation

Generate the core markdown files in the cloned wiki repository. To prevent context exhaustion and infinite loops, **use parallel subagents** for file generation.

<instructions>
1. Define a `wiki_writer` subagent equipped with `enable_write_tools = true`.
2. Dispatch subagents to generate the following files. **CRITICAL**: For each subagent, specify a strict stop condition: "Once you have generated your assigned file, you MUST return and report."
3. Provide the `ssot.md` content to the subagents for context.
</instructions>

<guidelines>
- **Tone**: Professional, developer-focused, IT-ready.
- **Drift Prevention**: **NEVER hardcode version numbers or dates**. Use placeholders like `<latest-version>` or `:latest`. Avoid tying documentation to specific timeframes.
- **Single Source of Truth**: Do not create a Changelog. Rely on git history as the SSoT for changes.
</guidelines>

**Target Files (adjusting specific filenames as appropriate for the project):**

1. **`Home.md`**: High-level overview, primary capabilities, and a quick setup guide. (Overwrite the initial placeholder).
2. **`Architecture.md`**: System design, data flows, and internal logic (extracted from the architecture SSoT).
3. **`Configuration.md`**: Detailed explanation of environment variables, CLI flags, and deployment configurations.
4. **`Tools_and_Capabilities.md`**: A comprehensive reference of the tool schemas, parameters, and groupings.
   > **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
5. **`_Sidebar.md`**: Create a custom GitHub Wiki sidebar to easily navigate between `Home`, `Architecture`, `Configuration`, and `Tools and Capabilities`.

---

## Phase 3: Validation & Push

> [!CAUTION]
> **HITL Checkpoint**: STOP HERE. Present the generated Wiki content (or a summary of the files) to the user for approval. Do NOT proceed to commit until the user explicitly approves the changes. Ensure you specifically highlight that no version numbers were hardcoded.

Once explicitly approved by the user:
1. Stage, commit, and push the files directly to the `.wiki.git` repository:
   ```bash
   cd <path-to-sibling-dir>
   git add .
   git commit -m "docs: bootstrap high-quality developer wiki"
   git push origin master
   ```
   *(Note: GitHub Wikis typically use `master` as the default branch. Adjust to `main` if `master` fails).*

2. **Cleanup**: Remove the localized wiki clone to keep the workspace clean.
   ```pwsh
   Remove-Item -Recurse -Force <path-to-sibling-dir>
   ```
