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
Before committing, you MUST ensure that validation has passed. Check the "System Metadata" in your active Session Briefing to see the current test health indicators (e.g., \`Tests: ... pass ... · Lint & Typecheck: ✅\`).

- If the briefing indicates tests and linting have already passed, AND you have not made substantive code changes since that status was recorded, you may **bypass** running them again.
- If the test status is failing, unknown, or you have made substantive changes, you MUST run the validation commands natively in PowerShell before proceeding:
\`\`\`bash
npm run check || pnpm run check
\`\`\`
If any gate fails, you must attempt to auto-fix the issue or request human-in-the-loop (HITL) assistance.

## 2. Commit Invocation
Once validation is confirmed (or run), stage your changes and commit using standard native Git tooling.

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
> - \`validation\`: 'passed' (tests passed), 'none' (bypassed), or 'failed'
> 
> **Example \`commit.ts\` usage (Single Command):**
> \`\`\`bash
> bun path/to/commit.ts --msg "feat(scope): message" --history "Narrative explaining the change." --confidence <YOUR_SCORE_0.0_TO_1.0> --impact <IMPACT_SCORE> --validation <passed|none|failed> --add <specific-files-you-modified> --journal
> \`\`\`
> *(Note: Use \`--history-file scratch/narrative.txt\` instead of \`--history\` ONLY if your narrative is extremely long or contains complex quotes that risk shell-escaping issues. For trivial quick commits, you may omit \`--history\` and use \`--no-history\`.)*

## 3. Journal Entry
The \`--journal\` flag in \`commit.ts\` automatically creates a journal entry for substantive changes. It acts as an automated gatekeeper and will intelligently **skip** creating an entry if the impact score is trivial (< 0.4) and no history narrative is provided, keeping the journal noise-free. You should generally pass the \`--journal\` flag and trust the script to decide whether to record the commit. If for some reason you do not use \`--journal\`, you must manually create the entry via \`memory-journal-mcp entry create\`.`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}
