/**
 * Memory Journal MCP Server - Git History Prompts
 *
 * Prompts: commit (git-history-commit)
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'

export function getGitPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'commit',
            description: 'Procedure for committing code changes with intelligent validation gates',
            icons: [ICON_PROMPT],
            arguments: [
                {
                    name: 'validation',
                    description: 'Validation level: none (default, skip), lint (lint+typecheck), full (all checks+tests)',
                    required: false,
                },
            ],
            handler: (args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                const validation = args?.['validation']?.toLowerCase() || 'none'

                let validationText: string
                if (validation === 'none') {
                    validationText = `\n> [!NOTE]\n> **Validation Bypassed**: You are executing a quick commit. Validation gates have been bypassed. Only proceed if you are confident the changes are safe or trivial.`
                } else if (validation === 'lint') {
                    validationText = `\n## 1. Validation (MANDATORY)\nYou MUST run the project's linting and type-checking tools before committing.\n- Consult the project's config files (\`package.json\`, \`Makefile\`, \`pyproject.toml\`, etc.) to determine the appropriate command (e.g., standard lint/check scripts, \`cargo clippy\`, \`ruff check .\`).\n- If any gate fails, attempt to auto-fix the issue or request human-in-the-loop (HITL) assistance.\n- **Graceful Fallback**: If you cannot determine the appropriate validation command for this project, warn the user, proceed without validation, and lower your confidence score.`
                } else {
                    validationText = `\n## 1. Validation (MANDATORY)\nYou MUST run the project's full validation suite (linting, type-checking, build, tests) before committing.\n- Consult the project's config files (\`package.json\`, \`Makefile\`, \`pyproject.toml\`, etc.) to determine the appropriate command (e.g., standard check/test scripts, \`cargo test\`, \`pytest\`).\n- If any gate fails, attempt to auto-fix the issue or request human-in-the-loop (HITL) assistance.\n- **Graceful Fallback**: If you cannot determine the appropriate validation command for this project, warn the user, proceed without validation, and lower your confidence score.`
                }

                const promptText = `# Git History Commit Workflow

You are initiating a high-integrity procedure for committing code changes. You must follow these steps EXACTLY.
${validationText}

## 2. Commit Invocation
Stage your changes and commit using standard Git tooling.

> [!WARNING]
> **DO NOT USE \`git add .\` OR \`git commit -a\`**. You MUST only stage the specific files you modified (e.g., \`git add src/foo.ts\`) to avoid committing in-progress work from other agents or humans. Only use \`git add .\` if the user explicitly asks you to commit everything.

> **Environment Note:** If your system environment enforces custom commit wrappers (e.g., via proxy interceptors or project rules), use them with the appropriate semantic flags (impact, confidence, validation). Otherwise, use standard \`git commit\` with conventional commit format.
> **🛠️ AUTONOMOUS HEALING - PowerShell Operators:** If you are executing commands natively in Windows PowerShell, you MUST use semicolons (\`;\`) to chain commands. DO NOT use Unix shell operators like \`&&\` or \`||\`, as they will throw a ParserError.

**Scoring Guide (CRITICAL: Do NOT just rubber-stamp 1.0!):**
- \`impact\`: 0.1 (trivial docs/chores) | 0.5 (standard features/fixes) | 0.9+ (core architecture)
- \`confidence\`: 
  - 0.3-0.5: Unverified, experimental, or complex changes without tests.
  - 0.6-0.8: Standard changes, logic looks sound but full E2E validation was skipped (e.g., validation=none or lint).
  - 0.9-1.0: Rigorously tested, proven (validation=full), or completely trivial (like a typo fix).
- \`validation\`: 'passed', 'none', or 'failed'

## 3. Journal Entry
Ensure a journal entry is created for substantive changes (impact > 0.4). If your environment's commit wrapper automatically handles this, you may rely on it. Otherwise, manually create the entry via the journal MCP.`

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: promptText,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
