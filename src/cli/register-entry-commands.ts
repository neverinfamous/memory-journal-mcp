import type { Command } from 'commander'
import { addAgentInstructions, withGroup, withValidation } from './program.js'
import { addCoreOptions, addDatabaseOptions, addOutputOptions } from './option-groups.js'
import {
    createEntryAction,
    updateEntryAction,
    createEntrySchema,
    updateEntrySchema,
} from './commands/entry.js'
import { ENTRY_TYPES } from '../types/entities.js'

/**
 * [BOUNDARY] Registration for the `entry` command group (split from `cli/index.ts`, L1).
 */

const ENTRY_AGENT_INSTRUCTIONS = `
🤖 AI AGENT INSTRUCTIONS:
- METADATA PAYLOAD: ALWAYS prefer using \`--metadata <path>\` to pass tags, scores, auto_context, and relationships in a single JSON file.
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.
- SNAKE_CASE FLAGS: Do not hallucinate snake_case CLI flags (like --project_number or --session_id). The CLI expects kebab-case (--project-number).`

const ENTRY_TYPE_HELP = `Entry type (one of: ${ENTRY_TYPES.join(', ')})`

/** Field flags shared by `entry create` and `entry update` (content flags are added per command). */
function addEntryFieldOptions(cmd: Command): void {
    cmd
        .option('--title <title>', 'Optional title (will be prepended as an H1 to content if provided, for agent compatibility)')
        .option('-t, --type <type>', ENTRY_TYPE_HELP)
        .option('--category <type>', 'Entry type (alias)')
        .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
        .option('--tag <tags>', 'Alias for --tags (Auto-healing agent hallucination)')
        .option('-p, --project <number>', 'Project number (alias)')
        .option('--project-number <number>', 'Project number')
        .option('--project_number <number>', 'Project number (alias)')
        .option('--trust, --trust-score <number>', 'Trust score (0.0 to 1.0)')
        .option('--trust_score <number>', 'Trust score (0.0 to 1.0) (alias)')
        .option('--confidence <number>', 'Trust score (0.0 to 1.0) (alias)')
        .option('--impact, --impact-score <number>', 'Impact score (0.0 to 1.0)')
        .option('--impact_score <number>', 'Impact score (0.0 to 1.0) (alias)')
        .option('--validation-status <status>', 'Validation status (passed|none|failed)')
        .option('--validation_status <status>', 'Validation status (passed|none|failed) (alias)')
        .option('--validation <status>', 'Validation status (passed|none|failed) (alias)')
        .option('-w, --workspace <id>', 'Workspace ID')
        .option('--workspace-id <id>', 'Workspace ID (alias)')
        .option('--workspace_id <id>', 'Workspace ID (alias)')
        .option('--session, --session-id <id>', 'Session ID')
        .option('--session_id <id>', 'Session ID (alias)')
        .option('--related-to <ids>', 'Comma-separated entry IDs to relate to')
        .option('--rel, --relationships <json>', 'JSON string of relationships')
        .option('--rel-file <path>', 'Load relationships JSON from a file')
        .option('--auto-context <json>', 'JSON string for auto context')
        .option('--auto-context-file <path>', 'Load auto context JSON from a file')
        .option('--metadata <path>', 'Load unified metadata JSON from a file (overrides individual flags)')
        .option('--team', 'Route to team database')
}

function finishEntryCommand(cmd: Command): void {
    addOutputOptions(cmd)
    addCoreOptions(cmd)
    addDatabaseOptions(cmd)
    addAgentInstructions(cmd, ENTRY_AGENT_INSTRUCTIONS)
}

export function registerEntryCommands(program: Command): void {
    const entryCmd = program.command('entry').description('Manage journal entries')

    const createEntryCmd = entryCmd
        .command('create [args...]')
        .description('Create a new journal entry directly in the database')
    withGroup(createEntryCmd, 'Command Options', (cmd: Command) => {
        cmd
            .option('-f, --file <path>', 'Load markdown content from a file')
            .option('--content-file <file>', 'Alias for --file (Auto-healing agent hallucination)')
            .option('-c, --content <string>', 'Raw markdown content string')
            .option('--body <string>', 'Alias for --content (Auto-healing agent hallucination)')
            .option('-s, --summary <summary>', 'Alias for --title (Auto-healing agent hallucination)')
        addEntryFieldOptions(cmd)
    })
    finishEntryCommand(createEntryCmd)
    createEntryCmd.action(withValidation(createEntrySchema, createEntryAction))

    const updateEntryCmd = entryCmd
        .command('update [content]')
        .description('Update an existing journal entry')
    withGroup(updateEntryCmd, 'Command Options', (cmd: Command) => {
        cmd
            .option('--id <number>', 'ID of the entry to update')
            .option('--expected-version <number>', 'Expected version of the entry (for concurrent modification safety)')
            .option('-f, --file <path>', 'Load new markdown content from a file')
            .option('--content-file <file>', 'Alias for --file (Auto-healing agent hallucination)')
            .option('-c, --content <string>', 'Raw new markdown content string')
            .option('--body <string>', 'Alias for --content (Auto-healing agent hallucination)')
            .option('-d, --description <string>', 'Alias for --content (Auto-healing agent hallucination)')
        addEntryFieldOptions(cmd)
    })
    finishEntryCommand(updateEntryCmd)
    updateEntryCmd.action(withValidation(updateEntrySchema, updateEntryAction))

    // Agent healing for the 'delete' hallucination
    entryCmd
        .command('delete [args...]', { hidden: true })
        .allowUnknownOption()
        .action(() => {
            process.stderr.write(`🛠️ AUTONOMOUS HEALING: The 'entry delete' command does not exist in the CLI. Deleting entries is an admin-level operation. Please use the MCP tool 'mj_execute_code' with 'mj.admin.batchDeleteEntries({ entry_ids: [...] })' instead.\n`)
            process.exit(1)
        })
}
