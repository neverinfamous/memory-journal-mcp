/**
 * Memory Journal MCP Server - Git History Prompts
 *
 * Prompts: commit, quick-commit (git-history-commit, git-history-quick-commit)
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'

export function getGitPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'commit',
            description: 'High-integrity procedure for committing code changes with validation gates',
            icons: [ICON_PROMPT],
            handler: (_args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Git History Commit Workflow

You are initiating a high-integrity procedure for committing code changes. You must follow these steps EXACTLY.

## 1. Validation Gates (MANDATORY)
Before committing, you MUST pass validation. Run the appropriate verification commands for the current repository. For example:
\`\`\`bash
npm run check || pnpm run check
\`\`\`
If any gate fails, you must attempt to auto-fix the issue or request human-in-the-loop (HITL) assistance.

## 2. Commit Invocation
Once validation passes, stage your changes and commit using standard native Git tooling.

> [!WARNING]
> **DO NOT USE \`git add .\` OR \`git commit -a\`**. You MUST only stage the specific files you modified (e.g., \`git add src/foo.ts\`) to avoid committing in-progress work from other agents or humans. Only use \`git add .\` if the user explicitly asks you to commit everything.

> **Environment Note:** If your system environment enforces custom wrappers like \`commit.ts\`, you MUST use them and pass the semantic flags appropriately instead of raw \`git commit\`. Note that \`commit.ts\` does not support the \`-F\` flag for the full message.
> **🛠️ AUTONOMOUS HEALING - PowerShell Operators:** You are executing commands in Windows PowerShell. You MUST use semicolons (\`;\`) to chain commands. DO NOT use Unix shell operators like \`&&\` or \`||\`, as they will throw a ParserError.
> **Scoring Guide (CRITICAL: Do NOT just rubber-stamp 1.0!):**
> - \`impact\`: 0.1 (trivial docs/chores) | 0.5 (standard features/fixes) | 0.9+ (core architecture)
> - \`confidence\`: 
>   - 0.3-0.5: Unverified, experimental, or complex changes without tests.
>   - 0.6-0.8: Standard changes, logic looks sound but full E2E validation was skipped.
>   - 0.9-1.0: Rigorously tested, proven, or completely trivial (like a typo fix).
> - \`validation\`: 'passed' (tests ran), 'none' (bypassed), or 'failed'
> 
> **Example \`commit.ts\` usage (Single Command):**
> \`\`\`bash
> bun path/to/commit.ts --msg "feat(scope): message" --history "Narrative explaining the change." --confidence <YOUR_SCORE_0.0_TO_1.0> --impact <IMPACT_SCORE> --validation passed --add <specific-files-you-modified> --journal
> \`\`\`
> *(Note: Use \`--history-file scratch/narrative.txt\` instead of \`--history\` ONLY if your narrative is extremely long or contains complex quotes that risk shell-escaping issues)*

## 3. Journal Entry
The \`--journal\` flag in \`commit.ts\` will **automatically** create a journal entry with the \`commit-narrative\` tag and the SHA, auto-linking it to the codebase. If for some reason you do not use \`--journal\`, you must manually create the entry via \`memory-journal-mcp entry create\`.`,
                            },
                        },
                    ],
                }
            },
        },
        {
            name: 'quick-commit',
            description: 'Fast procedure for committing code changes, bypassing validation gates',
            icons: [ICON_PROMPT],
            handler: (_args: Record<string, string> | undefined, _db: IDatabaseAdapter) => {
                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Git History Quick Commit Workflow

You are initiating a fast procedure for committing code changes.

> [!WARNING]
> This workflow BYPASSES validation gates (lint, tests). It should ONLY be used when the code is known to be sound or for trivial changes (e.g., documentation, simple typo fixes).

## 1. Commit Invocation
Stage your changes and commit using standard native Git tooling.

> [!WARNING]
> **DO NOT USE \`git add .\` OR \`git commit -a\`**. You MUST only stage the specific files you modified (e.g., \`git add src/foo.ts\`) to avoid committing in-progress work from other agents or humans. Only use \`git add .\` if the user explicitly asks you to commit everything.

> **Environment Note:** If your system environment enforces custom wrappers like \`commit.ts\`, you MUST use them instead of raw \`git commit\`.
> **🛠️ AUTONOMOUS HEALING - PowerShell Operators:** You are executing commands in Windows PowerShell. You MUST use semicolons (\`;\`) to chain commands. DO NOT use Unix shell operators like \`&&\` or \`||\`, as they will throw a ParserError.
> **Scoring Guide (CRITICAL: Do NOT just rubber-stamp 1.0!):**
> - \`impact\`: 0.1 (trivial docs/chores) | 0.5 (standard features/fixes) | 0.9+ (core architecture)
> - \`confidence\`: 
>   - 0.3-0.5: Unverified, experimental, or complex changes without tests.
>   - 0.6-0.8: Standard changes, logic looks sound but full E2E validation was skipped.
>   - 0.9-1.0: Rigorously tested, proven, or completely trivial (like a typo fix).
> - \`validation\`: 'passed' (tests ran), 'none' (bypassed), or 'failed'
> 
> **Example \`commit.ts\` usage for a quick commit (Single Command):**
> \`\`\`bash
> bun path/to/commit.ts --msg "docs(scope): message" --no-history --category Changed --confidence <YOUR_SCORE_0.0_TO_1.0> --impact <IMPACT_SCORE> --validation none --add <specific-files-you-modified> --journal
> \`\`\`

## 2. Journal Entry
The \`--journal\` flag in \`commit.ts\` will **automatically** create a journal entry. You should usually include it even for quick commits so the system maintains a comprehensive audit trail of all changes.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
