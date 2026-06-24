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
            arguments: [],
            handler: (_args: Record<string, string>, _db: IDatabaseAdapter) => {
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

> **Environment Note:** If your system environment enforces custom wrappers like \`commit.ts\`, you MUST use them and pass the semantic flags appropriately instead of raw \`git commit\`. Note that \`commit.ts\` does not support the \`-F\` flag for the full message.
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
> git add . ; bun path/to/commit.ts --msg "feat(scope): message" --history "Narrative explaining the change." --confidence <YOUR_SCORE_0.0_TO_1.0> --impact <IMPACT_SCORE> --validation passed
> \`\`\`
> *(Note: Use \`--history-file scratch/narrative.txt\` instead of \`--history\` ONLY if your narrative is extremely long or contains complex quotes that risk shell-escaping issues)*

If using raw \`git\`, write your commit message to a temporary file (e.g., \`scratch/commit-msg.txt\`) and ensure it includes the new semantic trailers:
\`\`\`text
feat(scope): conventional message here

History-Category: Changed
History-Entry: Narrative explaining the change.

History-Impact: <IMPACT_SCORE>
History-Confidence: <YOUR_SCORE_0.0_TO_1.0>
History-Significance: milestone
History-Validation: passed
\`\`\`

Then execute:
\`\`\`bash
git add .
git commit -F scratch/commit-msg.txt
\`\`\`

## 3. Journal Entry (Optional but recommended for impact > 0.5 or structural significance)
Call \`mj_execute_code\` to create a \`technical_note\` entry documenting the commit. Tag it with \`["commit-narrative"]\`. Include the commit SHA, the rationale, and any architectural shifts.`,
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
            arguments: [],
            handler: (_args: Record<string, string>, _db: IDatabaseAdapter) => {
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

> **Environment Note:** If your system environment enforces custom wrappers like \`commit.ts\`, you MUST use them instead of raw \`git commit\`.
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
> git add . ; bun path/to/commit.ts --msg "docs(scope): message" --no-history --category Changed --confidence <YOUR_SCORE_0.0_TO_1.0> --impact <IMPACT_SCORE> --validation none
> \`\`\`

If using raw \`git\`, write your commit message to a temporary file (e.g., \`scratch/commit-msg.txt\`) and ensure it follows Conventional Commits:
\`\`\`text
docs(scope): conventional message here

History-Category: Changed
History-Entry: Narrative explaining the change (optional for quick-commit).

History-Impact: <IMPACT_SCORE>
History-Confidence: <YOUR_SCORE_0.0_TO_1.0>
History-Validation: none
\`\`\`

Then execute:
\`\`\`bash
git add .
git commit -F scratch/commit-msg.txt
\`\`\`

## 2. Journal Entry
Since this is a quick commit, a journal entry is usually not required unless the change is structurally significant despite being quick.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
