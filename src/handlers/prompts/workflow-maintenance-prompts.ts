/**
 * Maintenance Workflow Prompts (`project-setup`).
 * Extracted from `workflow.ts` to keep prompt modules below the 450-line budget and enforce `SCOPES.ADMIN`.
 */

import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'

const PROJECT_SETUP_PROMPT_TEXT = `# Project Initialization Workflow

When initializing a new project into the \`memory-journal-mcp\` global registry, you must follow these exact steps to ensure it is registered and tracked correctly.

## Primary Method: MCP Code Mode (Recommended)
You can natively register and initialize the project directly in the sandbox without needing to orchestrate shell commands.

1. Invoke the \`mj_execute_code\` tool.
2. Call the \`mj.admin.registerProject\` method:
\`\`\`javascript
const res = await mj.admin.registerProject("my-project", "C:/path/to/my-project", 123);
return res;
\`\`\`
This method automatically parses the config, registers the path, and securely initializes the database entry in one transaction.

## Fallback Method: Global CLI
If you prefer to use terminal commands, you can use the global CLI wrapper.

\`\`\`bash
memory-journal-mcp project create <project-name> --path <absolute-path-to-repo> --number <github-project-number>
\`\`\`

*Note: The CLI now AUTOMATICALLY initializes the project database entry under the hood. You no longer need to run a secondary \`memory-journal-mcp entry create\` command unless you explicitly pass the \`--skip-init\` flag.*

## Verify
Once the command or Code Mode execution succeeds, the project is officially registered and you may proceed with any further initialization tasks (e.g., scaffolding files, setting up CI/CD).`

export function getWorkflowMaintenancePromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'project-setup',
            description:
                'Guide for initializing and registering a new project in the memory-journal-mcp global registry',
            icons: [ICON_PROMPT],
            capabilities: { requiresAdminScope: true },
            handler: () => ({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: PROJECT_SETUP_PROMPT_TEXT,
                        },
                    },
                ],
            }),
        },
    ]
}
