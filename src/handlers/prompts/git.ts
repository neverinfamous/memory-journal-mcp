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
pwsh -c "pnpm run check ; pnpm run test:coverage ; pnpm run test:e2e"
\`\`\`
If any gate fails, you must attempt to auto-fix the issue or request human-in-the-loop (HITL) assistance.

## 2. Commit Script Invocation
Once validation passes, stage your changes with \`git add\` and then use the \`commit.ts\` script via the \`agent-exec.ts\` runner. NEVER use raw \`git commit\`.

Write a payload to \`scratch/commit-payload.json\` and execute it:
\`\`\`json
{
  "type": "command",
  "command": "bun",
  "args": [
    "C:\\\\Users\\\\chris\\\\Desktop\\\\adamic\\\\.agents\\\\scripts\\\\commit.ts",
    "--msg", "feat(scope): conventional message here",
    "--history-file", "C:\\\\path\\\\to\\\\scratch\\\\history.txt",
    "--impact", "0.5",
    "--trust", "0.9",
    "--validation", "passed"
  ]
}
\`\`\`

## 3. Journal Entry (Optional but recommended for significance > 0.5)
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

## 1. Commit Script Invocation
Stage your changes with \`git add\` and then use the \`commit.ts\` script via the \`agent-exec.ts\` runner. NEVER use raw \`git commit\`.

Write a payload to \`scratch/commit-payload.json\` and execute it:
\`\`\`json
{
  "type": "command",
  "command": "bun",
  "args": [
    "C:\\\\Users\\\\chris\\\\Desktop\\\\adamic\\\\.agents\\\\scripts\\\\commit.ts",
    "--msg", "docs(scope): conventional message here",
    "--no-history",
    "--impact", "0.1",
    "--trust", "1.0",
    "--validation", "none"
  ]
}
\`\`\`

If you choose to write history, use \`--history-file\` instead of \`--no-history\`.

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
